import { desktopCapturer, screen, systemPreferences, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import sharp from 'sharp'
import OpenAI from 'openai'
import * as db from './database'
import { runStorageMaintenance } from './maintenance'
import { TASK_DISCOVERY_PROMPT, TASK_COMPLETION_PROMPT, TASK_PRIORITY_PROMPT, TASK_CLASSIFICATION_PROMPT, TASK_CONSOLIDATION_PROMPT, DAILY_WORK_SUMMARY_PROMPT } from './prompts/pipeline_optimization'
import { REPORT_PERSONAL_GENERATE_PROMPT } from './prompts/report_personal'
import { generateReport } from './reportGenerator'

/**
 * 从本地文件加载提示词
 */
function loadPrompt(name: string): string {
  try {
    const promptPath = path.join(__dirname, 'prompts', `${name}.txt`)
    // 兼容开发模式和打包后的路径
    const finalPath = fs.existsSync(promptPath)
      ? promptPath
      : path.join(process.cwd(), 'src/main/prompts', `${name}.txt`)

    const content = fs.readFileSync(finalPath, 'utf8')
    console.log(`[Prompt] 成功加载提示词: ${name} (长度: ${content.length})`)
    return content
  } catch (error) {
    console.error(`[Prompt] 加载提示词 ${name} 失败:`, error)
    return ''
  }
}

let baseAppDataPath: string = process.cwd()

/**
 * 设置应用数据根目录 (如 app.getPath('userData'))
 */
export function setAppDataPath(p: string): void {
  baseAppDataPath = p
  console.log(`[Capturer] Base path set to: ${baseAppDataPath}`)
}

let captureInterval: NodeJS.Timeout | null = null
let lastImageBuffer: Buffer | null = null
let lastIntent: string = ''
let consecutiveSameIntentCount: number = 0
let lastMaintenanceTime: number = 0
const SIMILARITY_THRESHOLD = 0.95 // 相似度阈值，低于此值则认为有变化
const VISION_COOLDOWN_LIMIT = 5 // 连续相同意图达到此值时，进入冷却状态


// Helper to get current date, hour and 5-minute block for path
const getDatedPath = (): { dayPath: string; hourPath: string; minutePath: string } => {
  const now = new Date()
  const year = now.getFullYear()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  const hour = now.getHours().toString().padStart(2, '0')

  // 计算 5 分钟级别的时间块 (00, 05, 10, ... 55)
  const minute = now.getMinutes()
  const minuteBlock = (Math.floor(minute / 5) * 5).toString().padStart(2, '0')

  const dayPath = path.join(baseAppDataPath, 'snapshots', `${year}-${month}-${day}`)
  const hourPath = path.join(dayPath, hour)
  const minutePath = path.join(hourPath, minuteBlock)

  return { dayPath, hourPath, minutePath }
}

async function captureScreen(): Promise<void> {
  // 核心安全触发：仅在权限已授权时执行
  if (
    process.platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('screen') !== 'granted'
  ) {
    console.warn('[Capturer] 缺少屏幕录制权限，跳过本次截图。')
    return
  }

  // 1. 精准捕捉活跃屏幕
  const point = screen.getCursorScreenPoint()
  const currentDisplay = screen.getDisplayNearestPoint(point)
  const { width, height } = currentDisplay.size

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: width, height: height }
    })

    const activeScreenSource = sources.find(
      (source) => source.display_id === currentDisplay.id.toString()
    )

    if (activeScreenSource) {
      const image = activeScreenSource.thumbnail
      const buffer = image.toJPEG(90)

      // 图像防抖：与上一张图进行比对
      const currentSmallBuffer = await sharp(buffer)
        .grayscale()
        .resize(20, 20, { fit: 'fill' })
        .raw()
        .toBuffer()
      if (lastImageBuffer) {
        let changedPixels = 0
        for (let i = 0; i < lastImageBuffer.length; i++) {
          if (lastImageBuffer[i] !== currentSmallBuffer[i]) {
            changedPixels++
          }
        }
        const changePercentage = changedPixels / lastImageBuffer.length

        // 动态阈值：降低在重复意图时的重整阈值
        const currentThreshold =
          consecutiveSameIntentCount >= VISION_COOLDOWN_LIMIT
            ? 1 - 0.9 // 至少 10% 变化（之前是 30%）
            : 1 - SIMILARITY_THRESHOLD // 5% 变化

        if (changePercentage < currentThreshold) {
          console.log(
            `[Diff] 画面变化较小 (${(changePercentage * 100).toFixed(2)}% < ${(currentThreshold * 100).toFixed(2)}%)，跳过分析`
          )
          return
        }
      }
      lastImageBuffer = currentSmallBuffer // 更新 buffer 用于下次比较

      // 准备保存目录 (细化到 5 分钟级别)
      const { minutePath } = getDatedPath()
      if (!fs.existsSync(minutePath)) {
        fs.mkdirSync(minutePath, { recursive: true })
      }

      const timestamp = Date.now()
      const fileName = `${timestamp}.jpg`
      const absolutePath = path.join(minutePath, fileName)

      // 2. 保存截图 (保持原始分辨率和质量，确保 AI 识别准确度)
      await sharp(buffer)
        .jpeg({ quality: 90 })
        .toFile(absolutePath)

      console.log(`[Capture] 截图保存成功: ${absolutePath}`)

      // 核心链路 3: 组装 Prompt 与 LLM 视觉分析接口联调
      await analyzeAndSaveContext(absolutePath, timestamp)
    } else {
      console.log('未找到活跃屏幕')
    }
  } catch (error) {
    console.error('截图失败:', error)
  }
}

/**
 * AI 视觉分析 (OpenAI 兼容协议，使用 Base64 上传)
 */
async function analyzeAndSaveContext(imagePath: string, timestamp: number): Promise<void> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen3.5-plus'

  if (!apiKey || !endpoint) {
    console.warn('[LLM] API Key 或 Endpoint 未配置，跳过 AI 分析。')
    return
  }

  try {
    // 1. 初始化 OpenAI 客户端
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: endpoint.trim().replace(/\/+$/, '') // 确保没有末尾斜杠
    })

    // 2. 读取本地图像并转换为 Base64 (参考用户提供的 readFileSync 模式)
    const encodeImage = (p: string): string => {
      const stats = fs.statSync(p)
      console.log(`[LLM] 正在读取图片: ${p}, 大小: ${stats.size} 字节`)
      if (stats.size === 0) throw new Error('截图文件大小为 0')
      const imageFile = fs.readFileSync(p)
      return imageFile.toString('base64')
    }
    const base64Image = encodeImage(imagePath)

    console.log(`[LLM] Base64 长度: ${base64Image.length}`)

    // 3. 准备 OpenAI 兼容协议的 Payload
    const visionPrompt = loadPrompt('vision')
    console.log(`[LLM] 提示词加载完毕，长度: ${visionPrompt.length}`)

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: visionPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            },
            {
              type: 'text',
              text: '请根据提供的截图，识别当前应用、操作内容并返回 JSON 格式结果。'
            }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (!content) throw new Error('AI 返回内容为空')

    console.log(`[LLM] 原始返回结果: ${content}`)

    const usage = response.usage?.total_tokens || 0

    // 清洗 Markdown 代码块标签
    const cleanContent = content
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim()

    let aiData: {
      intent: string
      tags: string[]
      is_productive: boolean
      category: string
      secondary_activity?: string
      contains_okr?: boolean
    }
    try {
      aiData = JSON.parse(cleanContent)
    } catch (e) {
      console.error(`[LLM] JSON 解析失败: ${cleanContent}`, e)
      // 回退逻辑
      aiData = {
        intent: '正在执行操作 (解析失败)',
        tags: ['未知'],
        is_productive: true,
        category: '其他'
      }
    }

    // OKR 实时检测已移除：改为用户手动录入文字后 AI 解析

    // 4.1 数据入库与推送（任务识别由 AI 在15分钟槽归纳时统一处理，不在此处自动创建流水账任务）
    const tagsWithCategory = [
      ...(aiData.tags || []),
      aiData.category,
      ...(aiData.secondary_activity ? [aiData.secondary_activity] : [])
    ]
    db.saveContext(timestamp, imagePath, aiData.intent, JSON.stringify(tagsWithCategory))
    db.saveTokenUsage(usage, modelName, 'vision')

    // 更新防刷机制状态
    if (aiData.intent === lastIntent) {
      consecutiveSameIntentCount++
    } else {
      consecutiveSameIntentCount = 0
    }
    lastIntent = aiData.intent

    console.log(
      `[DB] AI 分析成功: ${aiData.intent} (Tokens: ${usage}, 连续计数: ${consecutiveSameIntentCount})`
    )

    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      mainWindow.webContents.send('new-context-saved', {
        timestamp,
        image_local_path: imagePath,
        ai_summary: aiData.intent,
        intent_tags: tagsWithCategory,
        is_productive: aiData.is_productive,
        category: aiData.category, // 增加发送 category
        token_usage: usage
      })
    }

    processTieredSummaries()
  } catch (error) {
    console.error('[LLM] AI 视觉分析失败:', error)
  }
}

interface OkrKeyResult {
  name: string
  baseline: string
  stretch?: string
  longTerm?: string
}

interface OkrObjective {
  title: string
  key_results: (string | OkrKeyResult)[]
}

/**
 * 从指定截图中提取 OKR objectives（不存储，只返回提取结果）
 * 用于多截图合并提取场景
 */
async function extractOkrObjectivesFromImage(
  imagePath: string,
  openai: OpenAI,
  modelName: string
): Promise<{ objectives: OkrObjective[]; sourceDescription: string } | null> {
  try {
    if (!fs.existsSync(imagePath)) {
      console.log(`[OKR] 截图文件不存在，跳过: ${imagePath}`)
      return null
    }

    const base64Image = fs.readFileSync(imagePath).toString('base64')
    const okrPrompt = loadPrompt('okr_extraction')

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: okrPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            { type: 'text', text: '请从截图中提取完整的 OKR 内容。' }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (!content) return null

    const usage = response.usage?.total_tokens || 0
    db.saveTokenUsage(usage, modelName, 'okr_extraction')

    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim()
    const okrData = JSON.parse(cleanContent) as {
      has_okr: boolean
      objectives: OkrObjective[]
      source_description: string
    }

    if (!okrData.has_okr || okrData.objectives.length === 0) {
      console.log('[OKR] 截图中未检测到有效的 OKR 内容')
      return null
    }

    console.log(`[OKR] 从截图提取到 ${okrData.objectives.length} 个目标 (${usage} tokens)`)
    return { objectives: okrData.objectives, sourceDescription: okrData.source_description }
  } catch (error) {
    console.error('[OKR] OKR 提取失败:', (error as Error).message)
    return null
  }
}

/**
 * 将提取到的 OKR objectives 合并去重后持久化存储
 * 去重逻辑：按 objective title 的前缀（如 "O1:"、"O2:"）去重，保留内容更丰富的版本
 */
function saveOkrToSettings(
  allObjectives: OkrObjective[],
  sourceDescription: string,
  sourceImagePath: string
): void {
  // 按 title 前缀去重（如 "O1: xxx" 和 "O1: yyy" 视为同一个 Objective）
  const objectiveMap = new Map<string, OkrObjective>()
  for (const objective of allObjectives) {
    // 提取前缀 "O1"、"O2" 等作为去重 key
    const prefixMatch = objective.title.match(/^O\d+/i)
    const deduplicationKey = prefixMatch ? prefixMatch[0].toUpperCase() : objective.title

    const existing = objectiveMap.get(deduplicationKey)
    if (!existing || objective.key_results.length > existing.key_results.length) {
      objectiveMap.set(deduplicationKey, objective)
    }
  }

  const mergedObjectives = Array.from(objectiveMap.values())
    .sort((objectiveA, objectiveB) => {
      // 按 O1, O2, O3 排序
      const numA = parseInt(objectiveA.title.match(/\d+/)?.[0] || '0')
      const numB = parseInt(objectiveB.title.match(/\d+/)?.[0] || '0')
      return numA - numB
    })

  const okrJson = JSON.stringify({
    objectives: mergedObjectives,
    source_description: sourceDescription
  })
  db.saveSetting('okr_current', okrJson)
  db.saveSetting('okr_source_image', sourceImagePath)
  db.saveSetting('okr_updated_at', new Date().toISOString())

  console.log(`[OKR] ✅ OKR 已合并并持久化存储 (${mergedObjectives.length} 个目标)`)

  // 通知前端 OKR 已更新
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (mainWindow) {
    mainWindow.webContents.send('okr-updated', { objectives: mergedObjectives })
  }
}

/**
 * 从用户手动输入的文字中解析 OKR，调用 AI 提取结构化数据并存储。
 * 替代原有的截图自动识别方案，由用户主动粘贴 OKR 文字触发。
 */
export async function parseOkrFromText(
  inputText: string
): Promise<{ success: boolean; objectiveCount: number; error?: string }> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'gpt-4o'

  if (!apiKey || !endpoint) {
    return { success: false, objectiveCount: 0, error: 'API 未配置' }
  }

  if (!inputText || inputText.trim().length < 10) {
    return { success: false, objectiveCount: 0, error: '输入文字过短，请粘贴完整的 OKR 内容' }
  }

  const parsePrompt = loadPrompt('okr_parse_text')
  if (!parsePrompt) {
    return { success: false, objectiveCount: 0, error: 'prompt 加载失败' }
  }

  try {
    const openai = new OpenAI({ apiKey, baseURL: endpoint.trim().replace(/\/+$/, '') })

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: parsePrompt },
        { role: 'user', content: inputText.trim() }
      ],
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (!content) {
      return { success: false, objectiveCount: 0, error: 'AI 返回空内容' }
    }

    const usage = response.usage?.total_tokens || 0
    db.saveTokenUsage(usage, modelName, 'okr_parse_text')

    const okrData = JSON.parse(content) as {
      has_okr: boolean
      objectives: OkrObjective[]
      source_description: string
    }

    if (!okrData.has_okr || !okrData.objectives || okrData.objectives.length === 0) {
      return { success: false, objectiveCount: 0, error: '未能从文字中识别出有效的 OKR 内容' }
    }

    // 直接覆盖存储（用户手动录入的优先级最高）
    const okrJson = JSON.stringify({
      objectives: okrData.objectives,
      source_description: okrData.source_description || '用户手动录入'
    })
    db.saveSetting('okr_current', okrJson)
    db.saveSetting('okr_updated_at', new Date().toISOString())

    console.log(`[OKR] ✅ 从用户输入文字中解析出 ${okrData.objectives.length} 个目标 (${usage} tokens)`)

    // 通知前端 OKR 已更新
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (mainWindow) {
      mainWindow.webContents.send('okr-updated', { objectives: okrData.objectives })
    }

    return { success: true, objectiveCount: okrData.objectives.length }
  } catch (error) {
    console.error('[OKR] 文字解析失败:', (error as Error).message)
    return { success: false, objectiveCount: 0, error: (error as Error).message }
  }
}



/**
 * 用 LLM 从候选截图描述中筛选出"用户正在查看真正 OKR 文档"的截图
 *
 * 解决的核心问题：contexts 表中大量包含 OKR 关键词的记录其实是开发截图（编辑代码、查看 DoWhat UI 等），
 * 硬编码排除规则太死板且无法适应新场景。用 LLM 做一轮轻量级筛选，只传 ai_summary 文本，成本极低。
 */
async function filterOkrCandidatesWithLLM(
  candidates: { id: number; ai_summary: string }[],
  openai: OpenAI,
  modelName: string
): Promise<number[]> {
  const filterPrompt = loadPrompt('okr_filter')

  // 构造候选列表文本
  const candidateList = candidates
    .map(ctx => `[id=${ctx.id}] ${ctx.ai_summary}`)
    .join('\n')

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: filterPrompt },
      { role: 'user', content: candidateList }
    ],
    temperature: 0
  })

  const content = response.choices[0].message.content
  if (!content) return []

  const usage = response.usage?.total_tokens || 0
  db.saveTokenUsage(usage, modelName, 'okr_filter')

  const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim()
  const selectedIds = JSON.parse(cleanContent) as number[]
  return Array.isArray(selectedIds) ? selectedIds : []
}

/**
 * 主动扫描历史截图中的 OKR 内容（LLM 智能筛选方案）
 *
 * Step 1: 宽泛搜索 — 从 contexts 表取大量候选（LIMIT 200）
 * Step 2: LLM 筛选 — 把所有候选的 ai_summary 喂给大模型，让它判断哪些是"用户正在查看真正的 OKR 文档"
 * Step 3: 精准提取 — 只对 LLM 筛选出的截图调用 Vision API 提取完整 OKR
 *
 * 只在尚未存储 OKR 时执行，一旦提取成功就永久记忆。
 */
export async function scanAndExtractOkr(openai: OpenAI, modelName: string): Promise<void> {
  // 检查是否已有 OKR（持久记忆）
  const existingOkr = db.getSetting('okr_current')
  if (existingOkr) {
    console.log('[OKR] 已有持久化 OKR，跳过扫描')
    return
  }

  console.log('[OKR] 未找到已存储的 OKR，开始智能扫描...')

  // ─── Step 1: 宽泛搜索，取大量候选 ───
  const okrKeywords = ['OKR', 'okr', '试用期OKR', '绩效目标', '季度目标', '年度OKR', '季度OKR']
  const matchedContexts = db.searchContextsByKeywords(okrKeywords, 200)

  if (matchedContexts.length === 0) {
    console.log('[OKR] 历史截图中未找到 OKR 相关记录，等待后续截图')
    return
  }

  console.log(`[OKR] Step1: 宽泛搜索找到 ${matchedContexts.length} 条候选`)

  // ─── Step 2: LLM 智能筛选 ───
  try {
    const selectedIds = await filterOkrCandidatesWithLLM(matchedContexts, openai, modelName)

    if (selectedIds.length === 0) {
      console.log('[OKR] Step2: LLM 判断所有候选均非真正 OKR 文档，等待后续截图')
      return
    }

    console.log(`[OKR] Step2: LLM 筛选出 ${selectedIds.length} 张真正的 OKR 截图: [${selectedIds.join(', ')}]`)

    // ─── Step 3: 遍历所有截图，收集 objectives 后合并存储 ───
    const selectedContexts = matchedContexts.filter(ctx => selectedIds.includes(ctx.id))
    const collectedObjectives: OkrObjective[] = []
    let lastSourceDescription = ''
    let lastSourceImagePath = ''

    for (const ctx of selectedContexts) {
      console.log(`[OKR] Step3: 提取 OKR: ${ctx.ai_summary.substring(0, 100)}`)
      const result = await extractOkrObjectivesFromImage(ctx.image_local_path, openai, modelName)
      if (result) {
        collectedObjectives.push(...result.objectives)
        lastSourceDescription = result.sourceDescription
        lastSourceImagePath = ctx.image_local_path
      }
    }

    if (collectedObjectives.length === 0) {
      console.log('[OKR] Step3: 所有筛选出的截图均未提取到有效 OKR 结构，等待后续截图')
      return
    }

    // 合并去重后一次性存储
    saveOkrToSettings(collectedObjectives, lastSourceDescription, lastSourceImagePath)
    console.log('[OKR] ✅ OKR 智能扫描完成，已从多张截图合并提取')
  } catch (error) {
    console.error('[OKR] LLM 筛选失败，跳过本次扫描:', error instanceof Error ? error.message : error)
  }
}

interface ContextRecord {
  timestamp: number
  ai_summary: string
}

interface SummaryRecord {
  timestamp: number
  content: string
}

/**
 * 分级总结核心逻辑 (1min, 5min, 15min, 30min, 60min)
 */
async function processTieredSummaries(): Promise<void> {
  const now = Date.now()

  // 每天运行一次磁盘维护 (除启动外)
  if (now - lastMaintenanceTime > 24 * 60 * 60 * 1000) {
    runStorageMaintenance().catch((err) => console.error('[Maintenance] 定期维护失败:', err))
    lastMaintenanceTime = now
  }

  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen3.5-plus'

  if (!apiKey || !endpoint) return

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: endpoint.trim().replace(/\/+$/, '')
  })

  // 定义层级：[分钟, 来源层级(-1表示raw context), 是否触发Backlog]
  const levels = [
    { mins: 1, sourceLevel: -1, triggerBacklog: false },
    { mins: 5, sourceLevel: 1, triggerBacklog: false },
    { mins: 10, sourceLevel: 5, triggerBacklog: false },
    { mins: 15, sourceLevel: 10, triggerBacklog: true },
    { mins: 30, sourceLevel: 15, triggerBacklog: false },
    { mins: 60, sourceLevel: 30, triggerBacklog: false }
  ]

  for (const level of levels) {
    const lastTs = db.getLastSummaryTimestamp(level.mins)
    const intervalMs = level.mins * 60 * 1000

    // 检查是否到了该层级的总结时间
    if (now - lastTs < intervalMs) continue

    try {
      let sourceTexts = ''
      if (level.sourceLevel === -1) {
        // L1: 从原始 context 中提取
        const contexts = db.getContextsSince(lastTs) as ContextRecord[]
        if (contexts.length === 0) continue
        sourceTexts = contexts.map((c) => `- ${c.ai_summary}`).join('\n')
      } else {
        // Higher levels: 从下一级 summary 中提取
        const summaries = db.getSummariesSince(lastTs, level.sourceLevel) as SummaryRecord[]
        if (summaries.length === 0) continue
        sourceTexts = summaries.map((s) => s.content).join('\n')
      }

      console.log(`[LLM] 正在生成 ${level.mins} 分钟级别总结...`)

      const prompt =
        level.mins === 1
          ? `你是一个极致精简的生产力记录员。请将以下过去 1 分钟内的屏幕行为合并为一段话，准确描述用户这一分钟具体在做什么：\n${sourceTexts}`
          : `请根据以下过去 ${level.mins} 分钟的子阶段总结，聚合出一个更高层级的阶段性产出描述：\n${sourceTexts}`

      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content:
              loadPrompt('summary').replace('[LEVEL_MINS]', level.mins.toString()) ||
              '总结用户的生产力行为记录。'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      const content = response.choices[0].message.content
      if (!content) continue

      console.log(`[LLM] ${level.mins} 分钟总结返回结果: ${content}`)

      const usage = response.usage?.total_tokens || 0
      db.saveTokenUsage(usage, modelName, 'summary')

      // 解析标题
      const summaryTitle = content.replace(/```json/g, '').replace(/```/g, '').trim()

      // 如果是触发 Backlog 的层级 (15min)，执行聚合优化逻辑
      if (level.triggerBacklog) {
        console.log(`[Capturer] 触发 15 分钟级别任务聚合与优化...`)
        optimizeBacklogState(summaryTitle).catch((err) =>
          console.error('[Capturer] optimizeBacklogState Error:', err)
        )
      }

      // 统一保存 Title 到 summaries 表
      db.saveSummary(now, level.mins, summaryTitle, modelName)

      // 触发 UI 更新：15min 总结推送专属事件，其余层级推送通用事件
      const mainWindow = BrowserWindow.getAllWindows()[0]
      if (mainWindow) {
        if (level.triggerBacklog) {
          mainWindow.webContents.send('new-15min-summary', {
            timestamp: now,
            content: summaryTitle
          })
        } else {
          mainWindow.webContents.send('new-context-saved')
        }
      }

      console.log(`[LLM] ${level.mins} 分钟总结已保存 (Tokens: ${usage})`)
    } catch (error) {
      console.error(`[LLM] ${level.mins} 分钟总结生成失败:`, error)
    }
  }
}

/**
 * 生成统计洞察报告 (AI 分析阶段性总结)
 */
export async function generateStatsInsight(
  start: number,
  end: number,
  cycle?: 'day' | 'week' | 'month'
): Promise<{ insight_text: string; warning_text?: string }> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen3.5-plus'

  if (!apiKey || !endpoint) {
    throw new Error('API Key 或 Endpoint 未配置')
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: endpoint.trim().replace(/\/+$/, '')
  })

  // 获取该时间段内的 15 分钟级别总结 (L15)
  const summaries = db.getSummariesSince(start, 15) as SummaryRecord[]
  const filteredSummaries = summaries.filter((s) => s.timestamp <= end)

  if (filteredSummaries.length === 0) {
    return {
      insight_text: '暂无足够的数据生成洞察报告，请开启 AI 感知并保持工作一段时间。'
    }
  }

  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  const contextTexts = filteredSummaries
    .map((s) => {
      const date = new Date(s.timestamp)
      if (cycle === 'week') {
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${dayNames[date.getDay()]}`
        return `- [${dateStr}] ${s.content}`
      } else if (cycle === 'month') {
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`
        return `- [${dateStr}] ${s.content}`
      }
      return `- [${date.toLocaleTimeString()}] ${s.content}`
    })
    .join('\n')

  const now = new Date()
  let progressInfo = ''
  if (cycle === 'week') {
    const dayOfWeek = now.getDay()
    const weekDayName = dayNames[dayOfWeek]
    progressInfo = `今天是${weekDayName}（${now.getMonth() + 1}月${now.getDate()}日），本周已过 ${dayOfWeek === 0 ? 7 : dayOfWeek}/7 天。`
  } else if (cycle === 'month') {
    const dayOfMonth = now.getDate()
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    progressInfo = `今天是${now.getMonth() + 1}月${dayOfMonth}日，本月共 ${lastDay} 天，已过 ${dayOfMonth}/${lastDay} 天。`
  }

  try {
    const cyclePromptMap: Record<string, string> = {
      day: 'stats_insight_daily',
      week: 'stats_insight_weekly',
      month: 'stats_insight_monthly'
    }
    const promptName = cycle ? (cyclePromptMap[cycle] || 'stats_insight') : 'stats_insight'

    let systemPrompt = loadPrompt(promptName) || '生成生产力洞察报告并返回 JSON。'
    if (progressInfo) {
      systemPrompt = systemPrompt.replace('[PROGRESS_INFO]', progressInfo)
    }

    let userMessage = `这是用户在该时段内的行为总结：\n${contextTexts}`
    if (progressInfo) {
      userMessage = `【当前进度】${progressInfo}\n\n${userMessage}`
    }

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (!content) throw new Error('AI 返回内容为空')

    console.log(`[LLM] 统计洞察返回结果: ${content}`)

    const usage = response.usage?.total_tokens || 0
    db.saveTokenUsage(usage, modelName, 'insight')

    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleanContent)
  } catch (error) {
    console.error('[LLM] 生成统计洞察失败:', error)
    return {
      insight_text: 'AI 洞察生成失败，请检查网络连接或 API 配置。'
    }
  }
}

/**
 * 为指定日期生成日报（复用 stats_insight_daily prompt）并持久化到 daily_reports 表。
 * 如果数据库中已有该日期的日报，直接返回（不重复生成）。
 */
export async function generateDailyReport(
  date: string
): Promise<{ insight_text: string; warning_text?: string; generated: boolean }> {
  // 先检查数据库中是否已有该日期的日报
  const existing = db.getDailyReport(date)
  if (existing) {
    return {
      insight_text: existing.insight_text,
      warning_text: existing.warning_text ?? undefined,
      generated: false
    }
  }

  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen3.5-plus'

  if (!apiKey || !endpoint) {
    throw new Error('API Key 或 Endpoint 未配置')
  }

  // 优先使用 slot_summaries（15分钟槽归纳），fallback 到 contexts（原始截图记录）
  const slotSummaries = db.getSlotSummariesForDate(date)
  let contextTexts: string

  if (slotSummaries.length > 0) {
    contextTexts = slotSummaries
      .sort((a, b) => a.slot_start_ms - b.slot_start_ms)
      .map((slot) => {
        const time = new Date(slot.slot_start_ms)
        return `- [${time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}] ${slot.summary}`
      })
      .join('\n')
  } else {
    // Fallback: 从 contexts 表获取当天的截图记录
    const contexts = db.getContextsForDate(date) as { timestamp: number; ai_summary: string }[]
    if (contexts.length === 0) {
      return { insight_text: '当天没有记录到任何工作数据。', generated: false }
    }
    contextTexts = contexts
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((ctx) => {
        const time = new Date(ctx.timestamp)
        return `- [${time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}] ${ctx.ai_summary || '(无描述)'}`
      })
      .join('\n')
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: endpoint.trim().replace(/\/+$/, '')
  })

  const systemPrompt = REPORT_PERSONAL_GENERATE_PROMPT

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            `report_type: daily`,
            `date_range: ${date}`,
            `language: zh`,
            `user_notes: 无`,
            ``,
            `slot_summaries:`,
            contextTexts
          ].join('\n')
        }
      ]
    })

    const content = response.choices[0].message.content
    if (!content) throw new Error('AI 返回内容为空')

    console.log(`[DailyReport] ${date} 日报生成完成`)

    const usage = response.usage?.total_tokens || 0
    db.saveTokenUsage(usage, modelName, 'daily_report')

    // 新 prompt 返回 Markdown 格式，直接作为 insight_text 存储
    const reportMarkdown = content.trim()

    // 持久化到 daily_reports 表
    db.saveDailyReport(date, reportMarkdown)

    return { insight_text: reportMarkdown, generated: true }
  } catch (error) {
    console.error(`[DailyReport] ${date} 日报生成失败:`, (error as Error).message)
    throw error
  }
}

/**
 * 音频监听与摘要逻辑 (集成 Whisper)
 * 需要用户安装 BlackHole 虚拟声卡并将系统输出重定向至此
 */
export async function startAudioMonitoring(): Promise<void> {
  console.log('[Audio] 启动系统音频监控 (Whisper 模式)...')
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')

  if (!apiKey || !endpoint) return

  // 这里的逻辑通常需要使用 node-record-lpcm16 或类似库配合 ffmpeg
  // 定期将音频片段发送给 OpenAI Whisper API 进行转录
  console.log('[Audio] 正在监听系统音频流，准备提炼会议 TODO...')
}

export function startCaptureLoop(interval: number = 5000): void {
  if (captureInterval) {
    clearInterval(captureInterval)
  }
  console.log(`开始以 ${interval}ms 的间隔进行截屏...`)
  captureInterval = setInterval(captureScreen, interval)

  // 启动时进行一次磁盘维护
  runStorageMaintenance().catch((err) => console.error('[Maintenance] 启动维护失败:', err))
}

export function stopCaptureLoop(): void {
  if (captureInterval) {
    console.log('停止截屏循环')
    clearInterval(captureInterval)
    captureInterval = null
  }
}

// ─── 15分钟槽归纳定时任务 ───────────────────────────────────────────────────

const SLOT_DURATION_MS = 15 * 60 * 1000 // 15分钟
const SLOT_REFRESH_INTERVAL_MS = 10 * 1000 // 每10秒刷新一次

let slotSummaryInterval: NodeJS.Timeout | null = null
// 防止并发：记录正在归纳中的槽，避免同一槽被重复调用 AI
const pendingSlotSummarizations = new Set<number>()

/**
 * 计算给定时间戳所属的15分钟槽起始时间（固定对齐到整点，如 09:00, 09:15, 09:30...）
 */
function getSlotStartMs(timestampMs: number): number {
  return Math.floor(timestampMs / SLOT_DURATION_MS) * SLOT_DURATION_MS
}

/**
 * 对指定槽调用 AI 归纳，结果写入 slot_summaries 表
 */
async function summarizeSlot(slotStartMs: number): Promise<void> {
  if (pendingSlotSummarizations.has(slotStartMs)) return
  pendingSlotSummarizations.add(slotStartMs)

  try {
    const apiKey = db.getSetting('api_key')
    const endpoint = db.getSetting('endpoint')
    const modelName = db.getSetting('model_name') || 'qwen-turbo'

    if (!apiKey || !endpoint) {
      console.warn('[SlotSummary] API Key 或 Endpoint 未配置，跳过槽归纳。')
      return
    }

    const slotEndMs = slotStartMs + SLOT_DURATION_MS
    const contexts = db.getContextsSince(slotStartMs) as ContextRecord[]
    const slotContexts = contexts.filter((c) => c.timestamp < slotEndMs)

    if (slotContexts.length === 0) {
      console.log(`[SlotSummary] 槽 ${new Date(slotStartMs).toLocaleTimeString()} 无数据，跳过。`)
      return
    }

    const summaryList = slotContexts
      .slice(0, 30)
      .map((c, index) => `${index + 1}. ${c.ai_summary}`)
      .join('\n')

    console.log(`[SlotSummary] 正在归纳槽 ${new Date(slotStartMs).toLocaleTimeString()}，共 ${slotContexts.length} 条记录...`)

    const openai = new OpenAI({
      apiKey,
      baseURL: endpoint.trim().replace(/\/+$/, '')
    })

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: `你是一个工作效率分析助手。根据用户在某段时间内的屏幕活动记录，生成一份结构化的活动摘要。
必须严格按照以下 JSON 格式返回，不要输出任何其他内容：
{"title":"...", "description":"..."}

字段要求：
- title：15字以内的核心标题，概括这段时间最主要的工作
- description：2-3句话的详细描述，说明具体做了什么、用了哪些工具/应用、涉及哪些具体内容（如文件名、功能点、任务名称等），让人一眼能看出这15分钟的工作细节`
        },
        {
          role: 'user',
          content: `以下是这15分钟内的屏幕活动记录（按时间顺序）：\n${summaryList}\n\n请生成结构化摘要（JSON格式）：`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature: 0.3
    })

    const resultText = response.choices[0].message.content?.trim() || ''
    if (!resultText) {
      console.warn('[SlotSummary] AI 返回内容为空，跳过写入。')
      return
    }

    const usage = response.usage?.total_tokens || 0
    db.upsertSlotSummary(slotStartMs, resultText)
    db.saveTokenUsage(usage, modelName, 'summary')

    console.log(`[SlotSummary] 槽 ${new Date(slotStartMs).toLocaleTimeString()} 归纳完成: "${resultText}"`)
  } catch (error) {
    console.error(`[SlotSummary] 槽 ${new Date(slotStartMs).toLocaleTimeString()} 归纳失败:`, error)
  } finally {
    pendingSlotSummarizations.delete(slotStartMs)
  }
}

/**
 * 每10秒执行一次：检查最近15分钟槽，触发 AI 归纳并写入 DB
 */
async function runSlotSummaryTick(): Promise<void> {
  const now = Date.now()
  const currentSlotStartMs = getSlotStartMs(now)

  // 始终刷新当前槽（最近15分钟）
  await summarizeSlot(currentSlotStartMs)
}

export function startSlotSummaryLoop(): void {
  if (slotSummaryInterval) {
    clearInterval(slotSummaryInterval)
  }
  console.log('[SlotSummary] 启动15分钟槽归纳定时任务（每10秒刷新）...')

  // 启动时先清理非 JSON 格式的旧数据，让 AI 用新 prompt 重新归纳
  const deletedCount = db.deleteNonJsonSlotSummaries()
  if (deletedCount > 0) {
    console.log(`[SlotSummary] 已清理 ${deletedCount} 条非 JSON 格式的旧摘要，将触发重新归纳`)
  }

  // 回溯当天所有缺少有效摘要的槽进行重新归纳
  backfillTodaySlots().catch((err) => console.error('[SlotSummary] 回溯归纳失败:', err))

  // 启动时立即执行一次当前槽
  runSlotSummaryTick().catch((err) => console.error('[SlotSummary] 初始归纳失败:', err))
  slotSummaryInterval = setInterval(() => {
    runSlotSummaryTick().catch((err) => console.error('[SlotSummary] 定时归纳失败:', err))
    // 每次 slot 归纳后也刷新每日工作总结
    generateDailyWorkSummary().catch((err) => console.error('[DailyWorkSummary] 生成失败:', err))
  }, SLOT_REFRESH_INTERVAL_MS)

  // 启动时也立即生成一次每日工作总结
  generateDailyWorkSummary().catch((err) => console.error('[DailyWorkSummary] 初始生成失败:', err))
}

/**
 * 生成每日工作总结：基于 slot_summaries 和 backlog 任务状态，
 * 用 AI 生成一段自然语言的工作日志，存入 daily_work_summary 表。
 */
async function generateDailyWorkSummary(): Promise<void> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen-turbo'

  if (!apiKey || !endpoint) {
    console.log('[DailyWorkSummary] API 未配置，跳过')
    return
  }

  const today = new Date().toISOString().split('T')[0]

  // 收集今天的 slot 总结
  const slotSummaries = db.getSlotSummariesForDate(today)
  if (slotSummaries.length === 0) {
    console.log('[DailyWorkSummary] 今日无 slot 数据，跳过')
    return
  }

  // 解析 slot 总结为可读文本
  const slotTexts = slotSummaries
    .sort((a, b) => a.slot_start_ms - b.slot_start_ms)
    .map(slot => {
      const time = new Date(slot.slot_start_ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      try {
        const parsed = JSON.parse(slot.summary)
        return `[${time}] ${parsed.title}：${parsed.description || ''}`
      } catch {
        return `[${time}] ${slot.summary}`
      }
    })
    .join('\n')

  // 收集今天的任务状态
  const allBacklog = db.getBacklog() as { id: string; title: string; completed: number; task_date: string; is_hidden: number }[]
  const todayTasks = allBacklog.filter(item => item.task_date === today && !item.is_hidden)
  const completedTasks = todayTasks.filter(item => item.completed).map(item => item.title)
  const pendingTasks = todayTasks.filter(item => !item.completed).map(item => item.title)

  try {
    const openai = new OpenAI({ apiKey, baseURL: endpoint.trim().replace(/\/+$/, '') })

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: DAILY_WORK_SUMMARY_PROMPT },
        {
          role: 'user',
          content: `### slot_summaries:\n${slotTexts}\n\n### completed_tasks:\n${completedTasks.length > 0 ? completedTasks.map(t => `- ${t}`).join('\n') : '（暂无）'}\n\n### pending_tasks:\n${pendingTasks.length > 0 ? pendingTasks.map(t => `- ${t}`).join('\n') : '（暂无）'}`
        }
      ],
      max_tokens: 600,
      temperature: 0.4
    })

    const summaryText = response.choices[0].message.content?.trim() || ''
    if (summaryText) {
      db.upsertDailyWorkSummary(today, summaryText)
      console.log(`[DailyWorkSummary] 今日工作总结已更新 (${summaryText.length} 字)`)
    }

    const tokens = response.usage?.total_tokens || 0
    db.saveTokenUsage(tokens, modelName, 'daily_work_summary')
  } catch (error) {
    console.error('[DailyWorkSummary] AI 生成失败:', error)
  }
}

/**
 * 回溯当天所有有 context 数据但缺少有效 JSON 摘要的槽，逐个触发 AI 归纳。
 * 避免一次性发起过多请求，每个槽之间间隔 2 秒。
 */
async function backfillTodaySlots(): Promise<void> {
  const now = Date.now()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartMs = todayStart.getTime()

  const year = todayStart.getFullYear()
  const month = String(todayStart.getMonth() + 1).padStart(2, '0')
  const day = String(todayStart.getDate()).padStart(2, '0')
  const todayDateStr = `${year}-${month}-${day}`

  const existingSummaries = db.getSlotSummariesForDate(todayDateStr)
  const validSlotKeys = new Set(
    existingSummaries
      .filter((s) => s.summary.trim().startsWith('{'))
      .map((s) => s.slot_start_ms)
  )

  // 找出当天所有有 context 数据的槽
  const contexts = db.getContextsSince(todayStartMs) as ContextRecord[]
  const slotKeysWithData = new Set<number>()
  contexts.forEach((c) => {
    if (c.timestamp < now) {
      slotKeysWithData.add(getSlotStartMs(c.timestamp))
    }
  })

  // 找出需要重新归纳的槽（有数据但无有效 JSON 摘要）
  const slotsToBackfill = Array.from(slotKeysWithData)
    .filter((slotMs) => !validSlotKeys.has(slotMs))
    .sort((a, b) => b - a)

  if (slotsToBackfill.length === 0) return

  console.log(`[SlotSummary] 发现 ${slotsToBackfill.length} 个槽需要回溯归纳...`)

  for (const slotMs of slotsToBackfill) {
    await summarizeSlot(slotMs)
    // 每个槽之间间隔 2 秒，避免 API 限流
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  console.log(`[SlotSummary] 回溯归纳完成`)
}

export function stopSlotSummaryLoop(): void {
  if (slotSummaryInterval) {
    console.log('[SlotSummary] 停止15分钟槽归纳定时任务')
    clearInterval(slotSummaryInterval)
    slotSummaryInterval = null
  }
}
/**
 * 后端异步执行 Backlog 的 AI 优化（去重与优先级分配）
 */
/**
 * 后端异步执行 Backlog 的 AI 优化（合并、更新进度、分配优先级）
 */
/**
 * 冷启动：基于当天所有行为数据，一次性生成分层待办任务（backlog/week/month）。
 * 当检测到当天 backlog 为空且有足够的行为数据时自动触发，也可通过 IPC 手动触发。
 */
export async function bootstrapBacklogFromHistory(): Promise<{ created: number; summary: string }> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'gpt-4o'

  if (!apiKey || !endpoint) {
    console.log('[Bootstrap] 跳过：API 未配置')
    return { created: 0, summary: '' }
  }

  const today = new Date().toISOString().split('T')[0]

  // 收集当天所有 slot 总结
  const slotSummaries = db.getSlotSummariesForDate(today) as { slot_start_ms: number; summary: string }[]
  if (slotSummaries.length < 2) {
    console.log(`[Bootstrap] 跳过：行为数据不足 (slots: ${slotSummaries.length})`)
    return { created: 0, summary: '行为数据不足，等待更多截图分析' }
  }

  // 提取 slot 总结文本
  const summaryTexts = slotSummaries.map((slot) => {
    const time = new Date(slot.slot_start_ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    try {
      const parsed = JSON.parse(slot.summary)
      return `[${time}] ${parsed.title || parsed.description || slot.summary}`
    } catch {
      return `[${time}] ${slot.summary}`
    }
  })

  // 收集已有任务标题（去重用）
  const allBacklog = db.getBacklog() as { id: string; title: string; task_date: string; is_hidden: number }[]
  const existingTitles = allBacklog
    .filter(item => !item.is_hidden)
    .map(item => item.title)

  // 读取用户 OKR
  const currentOkr = db.getSetting('okr_current') || ''

  // 加载 prompt
  const bootstrapPrompt = loadPrompt('backlog_bootstrap')
  if (!bootstrapPrompt) {
    console.error('[Bootstrap] 无法加载 backlog_bootstrap prompt')
    return { created: 0, summary: 'prompt 加载失败' }
  }

  console.log(`[Bootstrap] 开始全量分析... (slots: ${slotSummaries.length}, 已有任务: ${existingTitles.length})`)

  try {
    const openai = new OpenAI({ apiKey, baseURL: endpoint.trim().replace(/\/+$/, '') })

    const userContent = [
      `### slot_summaries:\n${summaryTexts.join('\n')}`,
      `\n### existing_tasks:\n${JSON.stringify(existingTitles)}`,
      currentOkr ? `\n### user_okr:\n${currentOkr}` : ''
    ].filter(Boolean).join('\n')

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: bootstrapPrompt },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (!content) {
      console.error('[Bootstrap] AI 返回空内容')
      return { created: 0, summary: 'AI 返回空内容' }
    }

    const result = JSON.parse(content) as {
      tasks: { title: string; description?: string; category: string; priority?: number }[]
      analysis_summary?: string
    }

    const usage = response.usage?.total_tokens || 0
    db.saveTokenUsage(usage, modelName, 'backlog_bootstrap')

    if (!result.tasks || !Array.isArray(result.tasks)) {
      console.log('[Bootstrap] AI 未返回有效任务')
      return { created: 0, summary: result.analysis_summary || '' }
    }

    // 本地去重 + 写入数据库
    const existingLower = existingTitles.map(t => t.toLowerCase().trim())
    let createdCount = 0

    for (const task of result.tasks) {
      if (!task.title || task.title.trim() === '') continue

      const normalizedTitle = task.title.toLowerCase().trim()
      const isDuplicate = existingLower.some(existing =>
        existing === normalizedTitle ||
        existing.includes(normalizedTitle) ||
        normalizedTitle.includes(existing)
      )

      if (isDuplicate) {
        console.log(`[Bootstrap] 跳过重复任务: "${task.title}"`)
        continue
      }

      const validCategories = new Set(['backlog', 'week', 'month'])
      const category = validCategories.has(task.category) ? task.category : 'backlog'
      const priority = typeof task.priority === 'number' && task.priority >= 1 && task.priority <= 5
        ? task.priority
        : 3

      const taskId = `bootstrap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      db.addBacklogItem({
        id: taskId,
        title: task.title.trim(),
        description: task.description?.trim() || '',
        progress: 0,
        subtasks: '',
        color: category === 'month' ? 'bg-purple-500' : category === 'week' ? 'bg-blue-500' : 'bg-indigo-500',
        category,
        project_id: null,
        created_at: Date.now(),
        priority
      })

      existingLower.push(normalizedTitle)
      createdCount++
      console.log(`[Bootstrap] 创建任务 [${category}]: "${task.title}"`)
    }

    // 通知前端刷新
    if (createdCount > 0) {
      const windows = BrowserWindow.getAllWindows()
      windows.forEach(w => w.webContents.send('backlog-updated'))
    }

    console.log(`[Bootstrap] 完成：创建 ${createdCount} 个任务`)
    return { created: createdCount, summary: result.analysis_summary || '' }
  } catch (error) {
    console.error('[Bootstrap] 全量分析失败:', (error as Error).message)
    return { created: 0, summary: (error as Error).message }
  }
}

/**
 * 后端异步执行 Backlog 的 AI 分析：
 * - 识别最近活动中出现的新待办任务，追加到数据库
 * - 识别已完成的任务，更新完成状态
 * 不修改已有任务的标题、不合并任务、不删除/隐藏任务
 */
async function optimizeBacklogState(newActivity?: string): Promise<void> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name')

  if (!apiKey || !endpoint || !newActivity) return

  try {
    const openai = new OpenAI({ apiKey, baseURL: endpoint.trim().replace(/\/+$/, '') })
    const today = new Date().toISOString().split('T')[0]
    const allBacklog = db.getBacklog() as { id: string; title: string; description?: string; priority: number; completed: number; task_date: string; is_hidden: number }[]
    const todayItems = allBacklog.filter(item => item.task_date === today && !item.is_hidden)

    // 冷启动检测：当天无任何任务时，触发全量分析
    if (todayItems.length === 0) {
      console.log('[Capturer] 检测到当天 backlog 为空，触发冷启动全量分析...')
      const bootstrapResult = await bootstrapBacklogFromHistory()
      if (bootstrapResult.created > 0) {
        console.log(`[Capturer] 冷启动完成，已创建 ${bootstrapResult.created} 个任务，跳过增量分析`)
        return
      }
    }

    // 聚合最近的 slot summaries 作为更丰富的 recent_activity 上下文
    const recentSlotSummaries = db.getSlotSummariesForDate(today)
    const recentSummaryTexts = recentSlotSummaries
      .slice(0, 8) // 最近 8 个 slot（约 2 小时）
      .map(slot => {
        try {
          const parsed = JSON.parse(slot.summary)
          return parsed.title || parsed.description || slot.summary
        } catch {
          return slot.summary
        }
      })
      .filter(Boolean)

    const fullRecentActivity = [
      newActivity,
      ...(recentSummaryTexts.length > 0 ? ['--- 更早的活动记录 ---', ...recentSummaryTexts] : [])
    ].join('\n')

    let hasChanges = false

    // ─── Step 1: 新任务识别（独立 AI 调用）───────────────────────────────
    const todayTaskCount = db.getTodayTaskCount()
    const maxDailyTasks = 15

    if (todayTaskCount >= maxDailyTasks) {
      console.log(`[Capturer] Step1: 跳过新任务识别，今日任务已达上限 (${todayTaskCount}/${maxDailyTasks})`)
    } else {
    console.log(`[Capturer] Step1: 识别新任务... (现有任务: ${todayItems.length}, 今日总量: ${todayTaskCount}/${maxDailyTasks})`)
    try {
      const existingTitles = todayItems.map(item => item.title)
      const discoveryResponse = await openai.chat.completions.create({
        model: modelName || 'gpt-4o',
        messages: [
          { role: 'system', content: TASK_DISCOVERY_PROMPT },
          { role: 'user', content: `### existing_titles:\n${JSON.stringify(existingTitles)}\n\n### today_task_count: ${todayTaskCount}\n\n### recent_activity:\n${newActivity}` }
        ],
        response_format: { type: 'json_object' }
      })

      const discoveryContent = discoveryResponse.choices[0].message.content
      if (discoveryContent) {
        const discoveryResult = JSON.parse(discoveryContent)
        if (discoveryResult.new_tasks && Array.isArray(discoveryResult.new_tasks)) {
          const existingTitlesLower = todayItems.map(item => item.title.toLowerCase().trim())

          for (const newTask of discoveryResult.new_tasks as { title: string; description?: string; category?: string }[]) {
            if (!newTask.title || newTask.title.trim() === '') continue
            const normalizedNewTitle = newTask.title.toLowerCase().trim()

            // 本地去重
            const isDuplicate = existingTitlesLower.some(existingTitle => {
              if (existingTitle === normalizedNewTitle) return true
              if (existingTitle.includes(normalizedNewTitle) || normalizedNewTitle.includes(existingTitle)) return true
              return calculateTokenOverlap(existingTitle, normalizedNewTitle) > 0.6
            })

            if (isDuplicate) {
              console.log(`[Capturer] 跳过重复任务: "${newTask.title}"`)
              continue
            }

            const taskId = `ai_task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
            db.addBacklogItem({
              id: taskId,
              title: newTask.title.trim(),
              description: newTask.description?.trim() || '',
              progress: 0,
              subtasks: '',
              color: 'bg-indigo-500',
              category: newTask.category || 'backlog',
              project_id: null,
              created_at: Date.now(),
              priority: 3
            })
            existingTitlesLower.push(normalizedNewTitle)
            console.log(`[Capturer] 新任务已追加: "${newTask.title}"`)
            hasChanges = true
          }
        }
      }
      const discoveryTokens = discoveryResponse.usage?.total_tokens || 0
      db.saveTokenUsage(discoveryTokens, modelName || 'gpt-4o', 'task_discovery')
    } catch (error) {
      console.error('[Capturer] Step1 新任务识别失败:', error)
    }
    } // end of daily task limit else block

    // ─── Step 2: 完成状态判断（独立 AI 调用）───────────────────────────────
    const uncompletedTasks = todayItems.filter(item => !item.completed)
    if (uncompletedTasks.length > 0) {
      console.log(`[Capturer] Step2: 判断完成状态... (未完成任务: ${uncompletedTasks.length})`)
      try {
        const tasksForCompletion = uncompletedTasks.map(item => ({ id: item.id, title: item.title }))
        const completionResponse = await openai.chat.completions.create({
          model: modelName || 'gpt-4o',
          messages: [
            { role: 'system', content: TASK_COMPLETION_PROMPT },
            { role: 'user', content: `### uncompleted_tasks:\n${JSON.stringify(tasksForCompletion, null, 2)}\n\n### recent_activity:\n${fullRecentActivity}` }
          ],
          response_format: { type: 'json_object' }
        })

        const completionContent = completionResponse.choices[0].message.content
        if (completionContent) {
          const completionResult = JSON.parse(completionContent)
          if (completionResult.completed_task_ids && Array.isArray(completionResult.completed_task_ids)) {
            for (const taskId of completionResult.completed_task_ids as string[]) {
              const originalTask = uncompletedTasks.find(item => item.id === taskId)
              if (!originalTask) continue
              db.updateBacklogStatus(taskId, true, 'ai')
              console.log(`[Capturer] 任务已标记完成(AI识别): "${originalTask.title}"`)
              hasChanges = true
            }
          }
        }
        const completionTokens = completionResponse.usage?.total_tokens || 0
        db.saveTokenUsage(completionTokens, modelName || 'gpt-4o', 'task_completion')
      } catch (error) {
        console.error('[Capturer] Step2 完成状态判断失败:', error)
      }
    }

    // ─── Step 3: 优先级评估（独立 AI 调用）───────────────────────────────
    // 重新获取未完成任务（Step2 可能已标记了一些为完成）
    const refreshedBacklog = db.getBacklog() as { id: string; title: string; priority: number; completed: number; task_date: string; is_hidden: number }[]
    const currentUncompletedTasks = refreshedBacklog.filter(item => item.task_date === today && !item.is_hidden && !item.completed)
    if (currentUncompletedTasks.length > 0) {
      console.log(`[Capturer] Step3: 评估优先级... (未完成任务: ${currentUncompletedTasks.length})`)
      try {
        const tasksForPriority = currentUncompletedTasks.map(item => ({ id: item.id, title: item.title, priority: item.priority ?? 3 }))
        const priorityResponse = await openai.chat.completions.create({
          model: modelName || 'gpt-4o',
          messages: [
            { role: 'system', content: TASK_PRIORITY_PROMPT },
            { role: 'user', content: `### uncompleted_tasks:\n${JSON.stringify(tasksForPriority, null, 2)}\n\n### recent_activity:\n${newActivity}` }
          ],
          response_format: { type: 'json_object' }
        })

        const priorityContent = priorityResponse.choices[0].message.content
        if (priorityContent) {
          const priorityResult = JSON.parse(priorityContent)
          const highPriorityIds = new Set<string>(
            Array.isArray(priorityResult.high_priority_task_ids) ? priorityResult.high_priority_task_ids : []
          )

          for (const task of currentUncompletedTasks) {
            const shouldBeHighPriority = highPriorityIds.has(task.id)
            const currentlyHighPriority = task.priority === 1

            if (shouldBeHighPriority && !currentlyHighPriority) {
              db.updateBacklogPriority(task.id, 1)
              console.log(`[Capturer] 任务提升为最高优先级: "${task.title}"`)
              hasChanges = true
            } else if (!shouldBeHighPriority && currentlyHighPriority) {
              db.updateBacklogPriority(task.id, 3)
              console.log(`[Capturer] 任务降级为普通优先级: "${task.title}"`)
              hasChanges = true
            }
          }
        }
        const priorityTokens = priorityResponse.usage?.total_tokens || 0
        db.saveTokenUsage(priorityTokens, modelName || 'gpt-4o', 'task_priority')
      } catch (error) {
        console.error('[Capturer] Step3 优先级评估失败:', error)
      }
    }

    // ─── Step 3.5: 任务合并归类（超限时由 AI 合并相似任务）──────────────────────
    // 各分区数量上限
    const ZONE_LIMITS = { high_priority: 5, daily: 5, backlog: 10 }

    // 重新获取最新任务列表（Step 2/3 可能已修改了状态）
    const latestBacklog = db.getBacklog() as { id: string; title: string; description?: string; category: string; priority: number; completed: number; task_date: string; is_hidden: number }[]
    const latestTodayActive = latestBacklog.filter(item => item.task_date === today && !item.is_hidden && !item.completed)

    const zoneHighPriority = latestTodayActive.filter(item => item.priority === 1)
    const zoneDaily = latestTodayActive.filter(item => item.category === 'day' && item.priority !== 1)
    const backlogCats = new Set(['backlog', 'week', 'month'])
    const zoneBacklog = latestTodayActive.filter(item => backlogCats.has(item.category?.toLowerCase() ?? '') && item.priority !== 1)

    const overflowZones: { zone: string; tasks: typeof latestTodayActive; limit: number }[] = []
    if (zoneHighPriority.length > ZONE_LIMITS.high_priority) {
      overflowZones.push({ zone: 'high_priority', tasks: zoneHighPriority, limit: ZONE_LIMITS.high_priority })
    }
    if (zoneDaily.length > ZONE_LIMITS.daily) {
      overflowZones.push({ zone: 'daily', tasks: zoneDaily, limit: ZONE_LIMITS.daily })
    }
    if (zoneBacklog.length > ZONE_LIMITS.backlog) {
      overflowZones.push({ zone: 'backlog', tasks: zoneBacklog, limit: ZONE_LIMITS.backlog })
    }

    for (const { zone, tasks: zoneTasks, limit } of overflowZones) {
      console.log(`[Capturer] Step3.5: ${zone} 分区超限 (${zoneTasks.length}/${limit})，触发 AI 合并归类...`)
      try {
        const tasksForConsolidation = zoneTasks.map(item => ({
          id: item.id,
          title: item.title,
          description: item.description || ''
        }))

        const consolidationResponse = await openai.chat.completions.create({
          model: modelName || 'gpt-4o',
          messages: [
            { role: 'system', content: TASK_CONSOLIDATION_PROMPT },
            { role: 'user', content: `### overflow_zone: ${zone}\n### max_count: ${limit}\n### tasks:\n${JSON.stringify(tasksForConsolidation, null, 2)}` }
          ],
          response_format: { type: 'json_object' }
        })

        const consolidationContent = consolidationResponse.choices[0].message.content
        if (consolidationContent) {
          const consolidationResult = JSON.parse(consolidationContent) as {
            merges?: { merged_title: string; merged_description: string; source_task_ids: string[]; keep_category: string; keep_priority: number }[]
            hide_task_ids?: string[]
          }

          // 执行合并：隐藏旧任务，创建合并后的新任务
          if (consolidationResult.merges && Array.isArray(consolidationResult.merges)) {
            for (const merge of consolidationResult.merges) {
              if (!merge.source_task_ids || merge.source_task_ids.length < 2) continue

              // 隐藏被合并的旧任务
              for (const sourceId of merge.source_task_ids) {
                db.hideBacklogItem(sourceId, true)
                console.log(`[Capturer] 合并隐藏: "${zoneTasks.find(t => t.id === sourceId)?.title || sourceId}"`)
              }

              // 创建合并后的新任务
              const mergedTaskId = `merged_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
              const mergedCategory = merge.keep_category || (zone === 'daily' ? 'day' : 'backlog')
              const mergedPriority = zone === 'high_priority' ? 1 : (merge.keep_priority || 3)
              db.addBacklogItem({
                id: mergedTaskId,
                title: merge.merged_title.trim(),
                description: merge.merged_description?.trim() || '',
                progress: 0,
                subtasks: '',
                color: 'bg-indigo-500',
                category: mergedCategory,
                project_id: null,
                created_at: Date.now(),
                priority: mergedPriority
              })
              console.log(`[Capturer] 合并创建: "${merge.merged_title}" (来源: ${merge.source_task_ids.length} 个任务)`)
              hasChanges = true
            }
          }

          // 隐藏低价值任务（合并后仍超限时使用）
          if (consolidationResult.hide_task_ids && Array.isArray(consolidationResult.hide_task_ids)) {
            for (const hideId of consolidationResult.hide_task_ids) {
              db.hideBacklogItem(hideId, true)
              console.log(`[Capturer] 超限隐藏: "${zoneTasks.find(t => t.id === hideId)?.title || hideId}"`)
              hasChanges = true
            }
          }
        }

        const consolidationTokens = consolidationResponse.usage?.total_tokens || 0
        db.saveTokenUsage(consolidationTokens, modelName || 'gpt-4o', 'task_consolidation')
      } catch (error) {
        console.error(`[Capturer] Step3.5 ${zone} 合并归类失败:`, error)
      }
    }

    // ─── Step 4: OKR 驱动的长线任务分类（将 backlog 任务提升为 week/month）──────────
    const classifiableBacklog = db.getBacklog() as { id: string; title: string; description?: string; category: string; priority?: number; completed: number; task_date: string; is_hidden: number }[]
    const backlogOnlyTasks = classifiableBacklog.filter(
      item => !item.completed && !item.is_hidden && (!item.category || item.category === 'backlog')
    )
    if (backlogOnlyTasks.length > 0) {
      console.log(`[Capturer] Step4: OKR 驱动的长线任务分类... (backlog 任务: ${backlogOnlyTasks.length})`)
      try {
        const tasksForClassification = backlogOnlyTasks.map(item => ({
          id: item.id,
          title: item.title,
          description: item.description || ''
        }))

        // 读取用户 OKR 用于任务对齐
        const currentOkr = db.getSetting('okr_current')
        let okrSection = ''
        if (currentOkr) {
          const okrUpdatedAt = db.getSetting('okr_updated_at') || '未知'
          okrSection = `\n\n### user_okr (最后更新: ${okrUpdatedAt}):\n${currentOkr}`
          console.log('[Capturer] Step4: 已加载用户 OKR 用于任务对齐')
        }

        const classificationResponse = await openai.chat.completions.create({
          model: modelName || 'gpt-4o',
          messages: [
            { role: 'system', content: TASK_CLASSIFICATION_PROMPT },
            { role: 'user', content: `### backlog_tasks:\n${JSON.stringify(tasksForClassification, null, 2)}\n\n### recent_activity:\n${fullRecentActivity}${okrSection}` }
          ],
          response_format: { type: 'json_object' }
        })

        const classificationContent = classificationResponse.choices[0].message.content
        if (classificationContent) {
          const classificationResult = JSON.parse(classificationContent)
          if (classificationResult.classifications && Array.isArray(classificationResult.classifications)) {
            for (const classification of classificationResult.classifications as { task_id: string; new_category: string; reason: string }[]) {
              const validCategories = new Set(['week', 'month'])
              if (!validCategories.has(classification.new_category)) continue

              const targetTask = backlogOnlyTasks.find(item => item.id === classification.task_id)
              if (!targetTask) continue

              const taskPriority = 'priority' in targetTask ? (targetTask as { priority?: number }).priority ?? 3 : 3
              db.reclassifyTask(classification.task_id, classification.new_category, taskPriority)
              console.log(`[Capturer] 任务提升为 ${classification.new_category}: "${targetTask.title}" (${classification.reason})`)
              hasChanges = true
            }
          }
        }
        const classificationTokens = classificationResponse.usage?.total_tokens || 0
        db.saveTokenUsage(classificationTokens, modelName || 'gpt-4o', 'task_classification')
      } catch (error) {
        console.error('[Capturer] Step4 长线任务分类失败:', error)
      }
    }

    if (hasChanges) {
      const windows = BrowserWindow.getAllWindows()
      windows.forEach(w => w.webContents.send('backlog-updated'))
    }
  } catch (error) {
    console.error('[Capturer] optimizeBacklogState failed:', error)
  }
}

/**
 * 计算两个字符串的 token（字符）重叠率，用于简易去重判断
 * 将字符串拆分为 2-gram 集合，计算 Jaccard 相似度
 */
function calculateTokenOverlap(stringA: string, stringB: string): number {
  const getBigrams = (text: string): Set<string> => {
    const bigrams = new Set<string>()
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.slice(i, i + 2))
    }
    return bigrams
  }

  const bigramsA = getBigrams(stringA)
  const bigramsB = getBigrams(stringB)

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1

  let intersectionCount = 0
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersectionCount++
  }

  const unionSize = bigramsA.size + bigramsB.size - intersectionCount
  return unionSize === 0 ? 0 : intersectionCount / unionSize
}

// ─── 每日模型价格更新任务 ────────────────────────────────────────────────────

const DAILY_PRICING_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 小时
let dailyPricingTimer: NodeJS.Timeout | null = null

/**
 * 常见模型的内置兜底价格表（每百万 token 的美元价格）。
 * 当 AI 查询失败或 DB 中无数据时，使用此表作为默认值。
 * 价格来源：各厂商官网公开定价（2025年）。
 */
const BUILTIN_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Anthropic Claude
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-sonnet-20240229': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-4-5': { input: 3, output: 15 },
  'claude-4-6': { input: 3, output: 15 },
  // 阿里通义千问
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'qwen-plus': { input: 0.8, output: 2 },
  'qwen-max': { input: 2.4, output: 9.6 },
  'qwen-long': { input: 0.07, output: 0.14 },
  'qwen2.5-72b-instruct': { input: 0.56, output: 2.24 },
  'qwen2.5-7b-instruct': { input: 0.07, output: 0.14 },
  // DeepSeek
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Google Gemini
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // 百度文心
  'ernie-4.0-8k': { input: 0.28, output: 0.84 },
  'ernie-3.5-8k': { input: 0.014, output: 0.042 },
}

/**
 * 根据模型名称模糊匹配内置价格表。
 * 支持部分匹配，例如 "claude-3-5-sonnet" 可以匹配 "claude-3-5-sonnet-20241022"。
 */
function lookupBuiltinPricing(modelName: string): { input: number; output: number } | null {
  const lowerName = modelName.toLowerCase()

  // 精确匹配优先
  if (BUILTIN_MODEL_PRICING[lowerName]) {
    return BUILTIN_MODEL_PRICING[lowerName]
  }

  // 模糊匹配：找到包含模型名的最长键
  let bestMatch: string | null = null
  for (const key of Object.keys(BUILTIN_MODEL_PRICING)) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      if (!bestMatch || key.length > bestMatch.length) {
        bestMatch = key
      }
    }
  }

  return bestMatch ? BUILTIN_MODEL_PRICING[bestMatch] : null
}

/**
 * 调用 AI 查询当前使用模型的最新定价，并写入 DB。
 * 优先使用内置价格表作为兜底，再尝试让 AI 报告最新价格更新。
 */
async function fetchAndSaveModelPricing(): Promise<void> {
  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name')

  if (!modelName) {
    console.log('[Pricing] 未配置模型名称，跳过价格更新')
    return
  }

  // 1. 先检查 DB 里是否已有价格数据，如果没有则用内置兜底价格写入
  const existingPricing = db.getModelPricing(modelName)
  if (!existingPricing) {
    const builtinPricing = lookupBuiltinPricing(modelName)
    if (builtinPricing) {
      db.upsertModelPricing(modelName, builtinPricing.input, builtinPricing.output)
      console.log(`[Pricing] 使用内置价格初始化 ${modelName}: input=$${builtinPricing.input}/1M, output=$${builtinPricing.output}/1M`)
    } else {
      console.log(`[Pricing] 模型 ${modelName} 无内置价格，将尝试 AI 查询`)
    }
  }

  // 2. 如果没有 API 配置，跳过 AI 查询
  if (!apiKey || !endpoint) {
    console.log('[Pricing] 缺少 API 配置，跳过 AI 价格查询')
    return
  }

  // 3. 尝试通过 AI 查询最新价格（可能比内置价格更新）
  try {
    const openai = new OpenAI({
      apiKey,
      baseURL: endpoint.trim().replace(/\/+$/, '')
    })

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: `你是一个了解自身定价信息的 AI 助手。请严格按照以下 JSON 格式返回你当前模型（${modelName}）的官方定价，不要输出任何其他内容：
{"input_price_per_1m": <每百万 input token 的美元价格，数字>, "output_price_per_1m": <每百万 output token 的美元价格，数字>}

价格单位为美元（USD）。如果你不确定，请返回 {"input_price_per_1m": 0, "output_price_per_1m": 0}。`
        },
        {
          role: 'user',
          content: `请告诉我模型 ${modelName} 的当前官方定价（JSON格式）：`
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 60,
      temperature: 0
    })

    const resultText = response.choices[0].message.content?.trim() || ''
    if (!resultText) return

    const parsed = JSON.parse(resultText)
    const inputPrice = Number(parsed.input_price_per_1m)
    const outputPrice = Number(parsed.output_price_per_1m)

    // 只有 AI 返回了有效的正数价格才更新（避免用 0 覆盖内置价格）
    if (!isNaN(inputPrice) && !isNaN(outputPrice) && inputPrice > 0 && outputPrice > 0) {
      db.upsertModelPricing(modelName, inputPrice, outputPrice)
      console.log(`[Pricing] AI 更新模型 ${modelName} 价格: input=$${inputPrice}/1M, output=$${outputPrice}/1M`)
    }
  } catch (error) {
    console.log('[Pricing] AI 价格查询失败（已有兜底价格）:', (error as Error).message)
  }
}

export function startDailyPricingLoop(): void {
  if (dailyPricingTimer) {
    clearInterval(dailyPricingTimer)
  }
  console.log('[Pricing] 启动每日模型价格更新任务...')
  // 启动时立即执行一次
  fetchAndSaveModelPricing().catch((err) => console.error('[Pricing] 初始价格获取失败:', err))
  dailyPricingTimer = setInterval(() => {
    fetchAndSaveModelPricing().catch((err) => console.error('[Pricing] 定时价格更新失败:', err))
  }, DAILY_PRICING_INTERVAL_MS)
}

export function stopDailyPricingLoop(): void {
  if (dailyPricingTimer) {
    console.log('[Pricing] 停止每日模型价格更新任务')
    clearInterval(dailyPricingTimer)
    dailyPricingTimer = null
  }
}

// ==================== 洞察报告定时缓存 ====================

const INSIGHT_DAY_INTERVAL_MS = 10 * 60 * 1000   // 日报：每 10 分钟更新

let insightCacheTimer: NodeJS.Timeout | null = null
let lastWeeklyInsightDate = ''
let lastMonthlyInsightDate = ''

/**
 * 为指定周期生成洞察报告并缓存到数据库
 */
async function generateAndCacheInsight(cycle: 'day' | 'week' | 'month'): Promise<void> {
  const now = Date.now()

  let startMs: number
  if (cycle === 'day') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    startMs = today.getTime()
  } else if (cycle === 'week') {
    // 本周复盘：从本周一 00:00:00 开始（与前端 StatsView 保持一致）
    const monday = new Date()
    const dayOfWeek = monday.getDay()
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    monday.setDate(monday.getDate() - diffToMonday)
    monday.setHours(0, 0, 0, 0)
    startMs = monday.getTime()
  } else {
    // 月度度量：从本月1号 00:00:00 开始（与前端 StatsView 保持一致）
    const firstDay = new Date()
    firstDay.setDate(1)
    firstDay.setHours(0, 0, 0, 0)
    startMs = firstDay.getTime()
  }

  // 从 slot_summaries 获取该周期内的所有 15 分钟槽归纳
  const slotSummaries = db.getSlotSummariesInRange(startMs, now)

  if (slotSummaries.length === 0) {
    console.log(`[InsightCache] ${cycle} 周期无 slot_summaries 数据，跳过`)
    return
  }

  const apiKey = db.getSetting('api_key')
  const endpoint = db.getSetting('endpoint')
  const modelName = db.getSetting('model_name') || 'qwen3.5-plus'

  if (!apiKey || !endpoint) return

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: endpoint.trim().replace(/\/+$/, '')
  })

  // 将 slot_summaries 的 JSON 内容提取为可读文本，周/月报使用宏观时间粒度
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const contextTexts = slotSummaries.map((s) => {
    const date = new Date(s.slot_start_ms)
    let timeStr: string
    if (cycle === 'week') {
      timeStr = `${date.getMonth() + 1}/${date.getDate()} ${dayNames[date.getDay()]}`
    } else if (cycle === 'month') {
      timeStr = `${date.getMonth() + 1}/${date.getDate()}`
    } else {
      timeStr = date.toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    }
    try {
      const parsed = JSON.parse(s.summary)
      return `- [${timeStr}] ${parsed.title || ''}: ${parsed.description || ''}`
    } catch {
      return `- [${timeStr}] ${s.summary}`
    }
  }).join('\n')

  // 生成周/月进度信息
  const currentDate = new Date()
  let progressInfo = ''
  if (cycle === 'week') {
    const dayOfWeek = currentDate.getDay()
    const weekDayName = dayNames[dayOfWeek]
    progressInfo = `今天是${weekDayName}（${currentDate.getMonth() + 1}月${currentDate.getDate()}日），本周已过 ${dayOfWeek === 0 ? 7 : dayOfWeek}/7 天。`
  } else if (cycle === 'month') {
    const dayOfMonth = currentDate.getDate()
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
    progressInfo = `今天是${currentDate.getMonth() + 1}月${dayOfMonth}日，本月共 ${lastDay} 天，已过 ${dayOfMonth}/${lastDay} 天。`
  }

  try {
    const cyclePromptMap: Record<string, string> = {
      day: 'stats_insight_daily',
      week: 'stats_insight_weekly',
      month: 'stats_insight_monthly'
    }
    const promptName = cyclePromptMap[cycle] || 'stats_insight'

    let systemPrompt = loadPrompt(promptName) || '生成生产力洞察报告并返回 JSON。'
    if (progressInfo) {
      systemPrompt = systemPrompt.replace('[PROGRESS_INFO]', progressInfo)
    }

    let userMessage = `这是用户在该时段内的行为总结（共 ${slotSummaries.length} 个15分钟时段）：\n${contextTexts}`
    if (progressInfo) {
      userMessage = `【当前进度】${progressInfo}\n\n${userMessage}`
    }

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      response_format: { type: 'json_object' }
    })

    const content = response.choices[0].message.content
    if (!content) return

    const usage = response.usage?.total_tokens || 0
    db.saveTokenUsage(usage, modelName, 'insight')

    const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleanContent) as { insight_text?: string; warning_text?: string }

    if (parsed.insight_text) {
      db.upsertInsightCache(cycle, parsed.insight_text, parsed.warning_text || null)
      console.log(`[InsightCache] ${cycle} 洞察报告已缓存 (${slotSummaries.length} 个槽, ${usage} tokens)`)
    }
  } catch (error) {
    console.error(`[InsightCache] ${cycle} 洞察生成失败:`, (error as Error).message)
  }
}

async function runInsightCacheTick(): Promise<void> {
  const todayStr = new Date().toISOString().split('T')[0]

  // 日报：每次 tick 都更新（10 分钟间隔由 setInterval 控制）
  await generateAndCacheInsight('day')

  // 周报：每天只更新一次
  if (lastWeeklyInsightDate !== todayStr) {
    await generateAndCacheInsight('week')
    lastWeeklyInsightDate = todayStr
  }

  // 月报：每天只更新一次
  if (lastMonthlyInsightDate !== todayStr) {
    await generateAndCacheInsight('month')
    lastMonthlyInsightDate = todayStr
  }
}

export function startInsightCacheLoop(): void {
  if (insightCacheTimer) {
    clearInterval(insightCacheTimer)
  }
  console.log('[InsightCache] 启动洞察报告定时缓存任务（日报每10分钟，周报/月报每天）...')

  // 启动后延迟 30 秒执行第一次（等 slot_summaries 先准备好）
  setTimeout(() => {
    runInsightCacheTick().catch((err) => console.error('[InsightCache] 初始洞察生成失败:', err))
  }, 30 * 1000)

  insightCacheTimer = setInterval(() => {
    runInsightCacheTick().catch((err) => console.error('[InsightCache] 定时洞察生成失败:', err))
  }, INSIGHT_DAY_INTERVAL_MS)
}

export function stopInsightCacheLoop(): void {
  if (insightCacheTimer) {
    console.log('[InsightCache] 停止洞察报告定时缓存任务')
    clearInterval(insightCacheTimer)
    insightCacheTimer = null
  }
}

// ==================== 日报定时生成任务 ====================

let dailyReportTimer: NodeJS.Timeout | null = null
const DAILY_REPORT_CHECK_INTERVAL_MS = 60 * 1000 // 每分钟检查一次是否到了 10:30

/**
 * 获取昨天的日期字符串 (YYYY-MM-DD)
 */
function getYesterdayDateString(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
}

/**
 * 定时检查：如果当前时间是 10:30，自动生成定时报告
 * - 每天：生成昨天的日报（个人版 + 专业版）
 * - 每周一：生成上周的周报（个人版 + 专业版）
 * - 每月1号：生成上月的月报（个人版 + 专业版）
 */
async function runDailyReportTick(): Promise<void> {
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()

  // 只在 10:30 这一分钟内触发（每分钟检查一次，所以只会命中一次）
  if (hour !== 10 || minute !== 30) return

  // 1. 生成昨天的日报（保留原有逻辑）
  const yesterday = getYesterdayDateString()
  const existing = db.getDailyReport(yesterday)
  if (existing) {
    console.log(`[DailyReport] ${yesterday} 日报已存在，跳过定时生成`)
  } else {
    console.log(`[DailyReport] 定时任务触发：开始生成 ${yesterday} 的日报...`)
    try {
      await generateDailyReport(yesterday)
      console.log(`[DailyReport] 定时任务完成：${yesterday} 日报已生成并持久化`)
    } catch (error) {
      console.error(`[DailyReport] 定时任务失败：${yesterday}`, (error as Error).message)
    }
  }

  // 2. 生成定时报告（日/周/月 × 个人/专业）
  await generateScheduledReports(now)
}

/**
 * 生成定时报告：日报（每天）、周报（每周一）、月报（每月1号）
 * 每种报告同时生成个人版和专业版
 */
async function generateScheduledReports(now: Date): Promise<void> {
  const versions: Array<'personal' | 'professional'> = ['personal', 'professional']

  // ── 日报：每天生成昨天的 ──
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStr = formatDateString(yesterdayDate)
  const yesterdayStart = new Date(yesterdayDate)
  yesterdayStart.setHours(0, 0, 0, 0)
  const yesterdayEnd = new Date(yesterdayDate)
  yesterdayEnd.setHours(23, 59, 59, 999)

  for (const version of versions) {
    const existingDaily = db.getScheduledReport('daily', version, yesterdayStr)
    if (existingDaily) continue
    try {
      console.log(`[ScheduledReport] 生成日报 ${version}/${yesterdayStr}...`)
      const report = await generateReport({
        reportType: 'daily', version, startMs: yesterdayStart.getTime(), endMs: yesterdayEnd.getTime(),
        userNotes: '', language: 'zh'
      })
      db.saveScheduledReport('daily', version, yesterdayStr, report)
    } catch (error) {
      console.error(`[ScheduledReport] 日报 ${version}/${yesterdayStr} 生成失败:`, (error as Error).message)
    }
  }

  // ── 周报：每周一生成上周的 ──
  if (now.getDay() === 1) {
    const lastMonday = new Date(now)
    lastMonday.setDate(lastMonday.getDate() - 7)
    lastMonday.setHours(0, 0, 0, 0)
    const lastSunday = new Date(now)
    lastSunday.setDate(lastSunday.getDate() - 1)
    lastSunday.setHours(23, 59, 59, 999)
    const weekRange = `${formatDateString(lastMonday)} ~ ${formatDateString(lastSunday)}`

    for (const version of versions) {
      const existingWeekly = db.getScheduledReport('weekly', version, weekRange)
      if (existingWeekly) continue
      try {
        console.log(`[ScheduledReport] 生成周报 ${version}/${weekRange}...`)
        const report = await generateReport({
          reportType: 'weekly', version, startMs: lastMonday.getTime(), endMs: lastSunday.getTime(),
          userNotes: '', language: 'zh'
        })
        db.saveScheduledReport('weekly', version, weekRange, report)
      } catch (error) {
        console.error(`[ScheduledReport] 周报 ${version}/${weekRange} 生成失败:`, (error as Error).message)
      }
    }
  }

  // ── 月报：每月1号生成上月的 ──
  if (now.getDate() === 1) {
    const lastMonthEnd = new Date(now)
    lastMonthEnd.setDate(0) // 上月最后一天
    lastMonthEnd.setHours(23, 59, 59, 999)
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1, 0, 0, 0, 0)
    const monthRange = `${formatDateString(lastMonthStart)} ~ ${formatDateString(lastMonthEnd)}`

    for (const version of versions) {
      const existingMonthly = db.getScheduledReport('monthly', version, monthRange)
      if (existingMonthly) continue
      try {
        console.log(`[ScheduledReport] 生成月报 ${version}/${monthRange}...`)
        const report = await generateReport({
          reportType: 'monthly', version, startMs: lastMonthStart.getTime(), endMs: lastMonthEnd.getTime(),
          userNotes: '', language: 'zh'
        })
        db.saveScheduledReport('monthly', version, monthRange, report)
      } catch (error) {
        console.error(`[ScheduledReport] 月报 ${version}/${monthRange} 生成失败:`, (error as Error).message)
      }
    }
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function startDailyReportLoop(): void {
  if (dailyReportTimer) {
    clearInterval(dailyReportTimer)
  }
  console.log('[DailyReport] 启动日报定时生成任务（每天 10:30 自动生成上一天日报）...')

  dailyReportTimer = setInterval(() => {
    runDailyReportTick().catch((err) => console.error('[DailyReport] 定时检查失败:', err))
  }, DAILY_REPORT_CHECK_INTERVAL_MS)
}

export function stopDailyReportLoop(): void {
  if (dailyReportTimer) {
    console.log('[DailyReport] 停止日报定时生成任务')
    clearInterval(dailyReportTimer)
    dailyReportTimer = null
  }
}

/**
 * 启动时兜底检查：无论何时启动，只要昨天的日报尚未生成，就立即生成。
 * 之前限制在 0:00-10:30 之间才触发，导致用户在 10:30 之后启动应用时昨天的日报永远不会被生成。
 */
export async function ensureYesterdayReportOnStartup(): Promise<void> {
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()

  const yesterday = getYesterdayDateString()
  const existing = db.getDailyReport(yesterday)
  if (existing) return

  console.log(`[DailyReport] 启动兜底：当前时间 ${hour}:${String(minute).padStart(2, '0')}，尝试生成 ${yesterday} 的日报...`)
  try {
    await generateDailyReport(yesterday)
    console.log(`[DailyReport] 启动兜底完成：${yesterday} 日报已生成并持久化`)
  } catch (error) {
    console.error(`[DailyReport] 启动兜底失败：${yesterday}`, (error as Error).message)
  }
}
