import OpenAI from 'openai'
import * as db from './database'
import {
  REPORT_PERSONAL_SUFFICIENCY_PROMPT,
  REPORT_PERSONAL_GENERATE_PROMPT,
  REPORT_PERSONAL_REFINE_PROMPT,
  REPORT_TRANSLATE_PROMPT
} from './prompts/report_personal'
import {
  REPORT_PROFESSIONAL_GENERATE_PROMPT,
  REPORT_PROFESSIONAL_REFINE_PROMPT
} from './prompts/report_professional'

// ─── Types ──────────────────────────────────────────────────────────────────

type ReportType = 'daily' | 'weekly' | 'monthly'
type ReportVersion = 'personal' | 'professional'

interface GenerateReportParams {
  reportType: ReportType
  version: ReportVersion
  startMs: number
  endMs: number
  userNotes: string
  language: 'zh' | 'en'
}

interface RefineReportParams {
  originalData: string
  previousReport: string
  userFeedback: string
  language: 'zh' | 'en'
  version: ReportVersion
}

interface TranslateReportParams {
  report: string
  targetLanguage: 'zh' | 'en'
}

// ─── AI Client Helper ───────────────────────────────────────────────────────

function createOpenAIClient(): { client: OpenAI; modelName: string } {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen3.5-plus'

  if (!apiKey || !endpoint) {
    throw new Error('[Report] API Key 或 Endpoint 未配置，请在系统设置中配置')
  }

  const client = new OpenAI({
    apiKey,
    baseURL: endpoint.trim().replace(/\/+$/, '')
  })

  return { client, modelName }
}

async function callAI(
  client: OpenAI,
  modelName: string,
  systemPrompt: string,
  userMessage: string,
  useJsonFormat: boolean = false
): Promise<{ content: string; tokens: number }> {
  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    ...(useJsonFormat ? { response_format: { type: 'json_object' as const } } : {})
  })

  const content = response.choices[0].message.content || ''
  const tokens = response.usage?.total_tokens || 0

  return { content, tokens }
}

// ─── Data Collection ────────────────────────────────────────────────────────

function collectReportData(startMs: number, endMs: number): {
  slotSummaries: { slot_start_ms: number; summary: string }[]
  contexts: { id: number; timestamp: number; ai_summary: string; intent_tags: string }[]
  tasks: unknown[]
  dateRange: string
} {
  const slotSummaries = db.getSlotSummariesInRange(startMs, endMs)

  const startDate = new Date(startMs).toISOString().split('T')[0]
  const endDate = new Date(endMs).toISOString().split('T')[0]
  const tasks = db.getBacklogInDateRange(startDate, endDate)

  const contexts = db.getContextsInRange(startMs, endMs)

  const dateRange = startDate === endDate
    ? startDate
    : `${startDate} ~ ${endDate}`

  return { slotSummaries, contexts, tasks, dateRange }
}

function formatSlotSummariesForAI(
  slotSummaries: { slot_start_ms: number; summary: string }[]
): string {
  return slotSummaries.map(slot => {
    const time = new Date(slot.slot_start_ms)
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
    return `[${timeStr}] ${slot.summary}`
  }).join('\n')
}

function formatTasksForAI(tasks: unknown[]): string {
  return (tasks as Array<{
    title: string
    completed: boolean
    completed_by?: string | null
    category: string
    description?: string
  }>).map(task => {
    const status = task.completed
      ? `✅ 已完成(${task.completed_by === 'ai' ? 'AI识别' : '手动'})`
      : '⏳ 进行中'
    const desc = task.description ? ` - ${task.description}` : ''
    return `[${status}] ${task.title}${desc}`
  }).join('\n')
}

function formatContextsForAI(
  contexts: { id: number; timestamp: number; ai_summary: string; intent_tags: string }[]
): string {
  return contexts.map(ctx => {
    const time = new Date(ctx.timestamp)
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
    return `[${timeStr}] ${ctx.ai_summary} (${ctx.intent_tags})`
  }).join('\n')
}

// ─── Phase 1: Data Sufficiency Check ────────────────────────────────────────

async function checkDataSufficiency(
  client: OpenAI,
  modelName: string,
  slotSummaries: { slot_start_ms: number; summary: string }[],
  reportType: ReportType
): Promise<string[]> {
  const formattedSlots = slotSummaries.map(slot => {
    const time = new Date(slot.slot_start_ms)
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
    return { slot_time: timeStr, summary: slot.summary }
  })

  const userMessage = JSON.stringify({
    slot_summaries: formattedSlots,
    report_type: reportType
  })

  const { content, tokens } = await callAI(
    client, modelName,
    REPORT_PERSONAL_SUFFICIENCY_PROMPT,
    userMessage,
    true
  )
  db.saveTokenUsage(tokens, modelName, 'report_sufficiency')

  const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim()
  const result = JSON.parse(cleanContent) as { insufficient_slots: string[] }

  console.log(`[Report] 数据充分性评估完成: ${result.insufficient_slots.length} 个时间槽信息不足`)
  return result.insufficient_slots
}

// ─── Phase 2: Generate Report ───────────────────────────────────────────────

export async function generateReport(params: GenerateReportParams): Promise<string> {
  const { reportType, version, startMs, endMs, userNotes, language } = params
  const { client, modelName } = createOpenAIClient()

  console.log(`[Report] 开始生成${version === 'personal' ? '个人版' : '专业版'}${reportType}报告`)

  // Step 1: Collect data
  const { slotSummaries, contexts, tasks, dateRange } = collectReportData(startMs, endMs)

  if (slotSummaries.length === 0 && contexts.length === 0) {
    return language === 'zh'
      ? `## ${dateRange} 工作报告\n\n暂无数据记录。请确保 AI 感知已开启并运行一段时间后再生成报告。`
      : `## ${dateRange} Work Report\n\nNo data recorded. Please ensure AI perception is enabled and running for a while before generating a report.`
  }

  // Step 2: Check data sufficiency
  let enrichedSlotData = formatSlotSummariesForAI(slotSummaries)

  if (slotSummaries.length > 0) {
    const insufficientSlots = await checkDataSufficiency(client, modelName, slotSummaries, reportType)

    if (insufficientSlots.length > 0) {
      console.log(`[Report] 补充 ${insufficientSlots.length} 个时间槽的详细截图描述`)

      for (const slotTime of insufficientSlots) {
        const [hours, minutes] = slotTime.split(':').map(Number)
        const slotStartMs = new Date(startMs)
        slotStartMs.setHours(hours, minutes, 0, 0)
        const slotEndMs = new Date(slotStartMs.getTime() + 15 * 60 * 1000)

        const slotContexts = contexts.filter(
          ctx => ctx.timestamp >= slotStartMs.getTime() && ctx.timestamp < slotEndMs.getTime()
        )

        if (slotContexts.length > 0) {
          const detailStr = formatContextsForAI(slotContexts)
          enrichedSlotData += `\n\n--- 补充详情 [${slotTime}] ---\n${detailStr}`
        }
      }
    }
  }

  // Step 3: Generate report
  const systemPrompt = version === 'personal'
    ? REPORT_PERSONAL_GENERATE_PROMPT
    : REPORT_PROFESSIONAL_GENERATE_PROMPT

  const userMessage = [
    `slot_summaries:\n${enrichedSlotData}`,
    `\ntasks:\n${formatTasksForAI(tasks)}`,
    `\nreport_type: ${reportType}`,
    `\ndate_range: ${dateRange}`,
    `\nuser_notes: ${userNotes || '无'}`,
    `\nlanguage: ${language}`
  ].join('\n')

  const { content: report, tokens } = await callAI(client, modelName, systemPrompt, userMessage)
  db.saveTokenUsage(tokens, modelName, 'report_generate')

  console.log(`[Report] 报告生成完成，消耗 ${tokens} tokens`)
  return report
}

// ─── Phase 3: Refine Report ─────────────────────────────────────────────────

export async function refineReport(params: RefineReportParams): Promise<string> {
  const { originalData, previousReport, userFeedback, language, version } = params
  const { client, modelName } = createOpenAIClient()

  console.log('[Report] 开始微调报告')

  const systemPrompt = version === 'personal'
    ? REPORT_PERSONAL_REFINE_PROMPT
    : REPORT_PROFESSIONAL_REFINE_PROMPT

  const userMessage = [
    `original_data:\n${originalData}`,
    `\nprevious_report:\n${previousReport}`,
    `\nuser_feedback: ${userFeedback}`,
    `\nlanguage: ${language}`
  ].join('\n')

  const { content: refined, tokens } = await callAI(client, modelName, systemPrompt, userMessage)
  db.saveTokenUsage(tokens, modelName, 'report_refine')

  console.log(`[Report] 报告微调完成，消耗 ${tokens} tokens`)
  return refined
}

// ─── Phase 4: Translate Report ──────────────────────────────────────────────

export async function translateReport(params: TranslateReportParams): Promise<string> {
  const { report, targetLanguage } = params
  const { client, modelName } = createOpenAIClient()

  console.log(`[Report] 开始翻译报告至 ${targetLanguage}`)

  const userMessage = [
    `report:\n${report}`,
    `\ntarget_language: ${targetLanguage}`
  ].join('\n')

  const { content: translated, tokens } = await callAI(client, modelName, REPORT_TRANSLATE_PROMPT, userMessage)
  db.saveTokenUsage(tokens, modelName, 'report_translate')

  console.log(`[Report] 翻译完成，消耗 ${tokens} tokens`)
  return translated
}
