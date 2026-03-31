import { desktopCapturer, screen, systemPreferences, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import sharp from 'sharp'
import OpenAI from 'openai'
import * as db from './database'
import { runStorageMaintenance } from './maintenance'
import { TASK_DISCOVERY_PROMPT, TASK_COMPLETION_PROMPT, TASK_PRIORITY_PROMPT } from './prompts/pipeline_optimization'

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

      // 2. 提升截图清晰度 (为了 AI 识别，确保质量)
      await sharp(buffer)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, progressive: true })
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
              text: '请根据提供的截图，识别当前应用、操作内容，并严格按如下 JSON schema 返回结果：\n{"intent": string, "tags": string[], "is_productive": boolean, "category": "编程|会议|沟通|设计|文档|调研|闲暇|其他", "secondary_activity": string}'
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1,
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
  end: number
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

  const contextTexts = filteredSummaries
    .map((s) => `- [${new Date(s.timestamp).toLocaleTimeString()}] ${s.content}`)
    .join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: loadPrompt('stats_insight') || '生成生产力洞察报告并返回 JSON。'
        },
        {
          role: 'user',
          content: `这是用户在该时段内的行为总结：\n${contextTexts}`
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
  }, SLOT_REFRESH_INTERVAL_MS)
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
    console.log(`[Capturer] Step1: 识别新任务... (现有任务: ${todayItems.length})`)
    try {
      const existingTitles = todayItems.map(item => item.title)
      const discoveryResponse = await openai.chat.completions.create({
        model: modelName || 'gpt-4o',
        messages: [
          { role: 'system', content: TASK_DISCOVERY_PROMPT },
          { role: 'user', content: `### existing_titles:\n${JSON.stringify(existingTitles)}\n\n### recent_activity:\n${newActivity}` }
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
              db.updateBacklogStatus(taskId, true)
              console.log(`[Capturer] 任务已标记完成: "${originalTask.title}"`)
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
  const oneDay = 24 * 60 * 60 * 1000

  let startMs: number
  if (cycle === 'day') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    startMs = today.getTime()
  } else if (cycle === 'week') {
    startMs = now - 7 * oneDay
  } else {
    startMs = now - 30 * oneDay
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

  // 将 slot_summaries 的 JSON 内容提取为可读文本
  const contextTexts = slotSummaries.map((s) => {
    const timeStr = new Date(s.slot_start_ms).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
    try {
      const parsed = JSON.parse(s.summary)
      return `- [${timeStr}] ${parsed.title || ''}: ${parsed.description || ''}`
    } catch {
      return `- [${timeStr}] ${s.summary}`
    }
  }).join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: loadPrompt('stats_insight') || '生成生产力洞察报告并返回 JSON。'
        },
        {
          role: 'user',
          content: `这是用户在该时段内的行为总结（共 ${slotSummaries.length} 个15分钟时段）：\n${contextTexts}`
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
