import OpenAI from 'openai'
import * as db from './database'
import { BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { TASK_VALIDATION_PROMPT } from './prompts/task_validation'
import { TASK_DEDUPLICATION_PROMPT } from './prompts/task_deduplication'

let scanInterval: NodeJS.Timeout | null = null
let isScanning = false

/**
 * 发送 macOS 系统通知（使用 osascript 命令）
 */
function sendSystemNotification(title: string, message: string): void {
  // 转义特殊字符
  const escapedTitle = title.replace(/"/g, '\\"')
  const escapedMessage = message.replace(/"/g, '\\"')

  const script = `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}" sound name "default"'`

  exec(script, (error) => {
    if (error) {
      console.error(`[TaskScanner] Failed to send notification:`, error)
    } else {
      console.log(`[TaskScanner] Notification sent: ${title}`)
    }
  })
}

/**
 * 发送任务状态变更通知
 */
function sendTaskNotification(taskTitle: string, action: 'abandoned' | 'validated'): void {
  const title = action === 'abandoned' ? '✅ 任务已清理' : '✓ 任务验证通过'
  const body = action === 'abandoned'
    ? `已自动废弃无效任务:\n${taskTitle}`
    : `任务验证通过:\n${taskTitle}`

  // 发送 macOS 系统通知
  sendSystemNotification(title, body)

  // 同时发送到渲染进程（用于应用内更新 UI）
  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (mainWindow) {
    mainWindow.webContents.send('task-status-notification', {
      message: body,
      type: action,
      taskTitle
    })
  }
}

/**
 * 使用 AI 判断任务是否有效
 */
async function validateTaskWithAI(taskTitle: string, taskDescription: string | null): Promise<boolean> {
  try {
    const apiKey = db.getSetting('api_key')
    const baseURL = db.getSetting('endpoint') || 'https://api.openai.com/v1'
    const model = db.getSetting('model_name') || 'gpt-4o-mini'

    if (!apiKey) {
      console.warn('[TaskScanner] No API key configured, skipping validation')
      return true // 如果没有配置 API Key，默认认为任务有效
    }

    const openai = new OpenAI({
      apiKey,
      baseURL
    })

    // 组合任务标题和描述
    const taskText = taskDescription
      ? `${taskTitle}\n描述：${taskDescription}`
      : taskTitle

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: TASK_VALIDATION_PROMPT + taskText
        }
      ],
      temperature: 0.1,
      max_tokens: 10
    })

    const response = completion.choices[0]?.message?.content?.trim().toUpperCase()
    console.log(`[TaskScanner] AI validation for "${taskTitle}": ${response}`)

    return response === 'YES'
  } catch (error) {
    console.error('[TaskScanner] AI validation failed:', error)
    return true // 出错时默认认为任务有效，避免误删
  }
}

/**
 * 使用 AI 识别并合并重复任务
 */
async function deduplicateTasksWithAI(tasks: Array<{ id: string | number; title: string; description: string | null }>): Promise<void> {
  if (tasks.length < 2) {
    console.log('[TaskScanner] Not enough tasks for deduplication')
    return
  }

  try {
    const apiKey = db.getSetting('api_key')
    const baseURL = db.getSetting('endpoint') || 'https://api.openai.com/v1'
    const model = db.getSetting('model_name') || 'gpt-4o-mini'

    if (!apiKey) {
      console.warn('[TaskScanner] No API key configured, skipping deduplication')
      return
    }

    const openai = new OpenAI({
      apiKey,
      baseURL
    })

    // 准备任务列表
    const taskList = tasks.map(task => ({
      id: String(task.id),
      title: task.title,
      description: task.description || ''
    }))

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: TASK_DEDUPLICATION_PROMPT + JSON.stringify(taskList, null, 2)
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })

    const response = completion.choices[0]?.message?.content?.trim()
    console.log(`[TaskScanner] Deduplication response: ${response}`)

    if (!response) {
      console.warn('[TaskScanner] Empty deduplication response')
      return
    }

    // 解析 JSON 响应（处理可能的 Markdown 代码块标记）
    let groups: Array<{ group_id: number; task_ids: string[]; reason: string }>
    try {
      // 移除可能的 Markdown 代码块标记
      let cleanedResponse = response
      if (response.startsWith('```json')) {
        cleanedResponse = response.replace(/^```json\s*/, '').replace(/\s*```$/, '')
      } else if (response.startsWith('```')) {
        cleanedResponse = response.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }

      groups = JSON.parse(cleanedResponse)
      console.log(`[TaskScanner] Parsed ${groups.length} duplicate groups`)
    } catch (parseError) {
      console.error('[TaskScanner] Failed to parse deduplication response:', parseError)
      console.error('[TaskScanner] Raw response:', response)
      return
    }

    if (!Array.isArray(groups) || groups.length === 0) {
      console.log('[TaskScanner] No duplicate tasks found')
      return
    }

    let mergedCount = 0
    const mergedGroups: string[] = []

    // 处理每个重复任务组
    for (const group of groups) {
      if (!group.task_ids || group.task_ids.length < 2) {
        continue
      }

      console.log(`[TaskScanner] Found duplicate group: ${group.reason}`)
      console.log(`[TaskScanner] Task IDs: ${group.task_ids.join(', ')}`)

      // 找出这组任务中最详细的任务（标题最长的）作为保留任务
      const groupTasks = tasks.filter(t => group.task_ids.includes(String(t.id)))
      const keepTask = groupTasks.reduce((prev, current) =>
        (current.title.length > prev.title.length) ? current : prev
      )

      // 废弃其他重复任务
      let groupMergedCount = 0
      for (const task of groupTasks) {
        if (task.id !== keepTask.id) {
          console.log(`[TaskScanner] Marking duplicate task as abandoned: ${task.id} - "${task.title}"`)
          db.abandonBacklogItem(String(task.id), true)
          groupMergedCount++
          mergedCount++
        }
      }

      // 记录合并的组信息
      if (groupMergedCount > 0) {
        mergedGroups.push(`${groupMergedCount + 1} 个关于"${group.reason.replace(/这些任务都是关于|的任务/g, '').trim()}"的任务`)
      }
    }

    console.log(`[TaskScanner] Deduplication completed. Merged ${mergedCount} duplicate tasks`)

    // 发送系统通知
    if (mergedCount > 0) {
      sendSystemNotification(
        '🔄 任务已自动去重',
        `已合并 ${mergedCount} 个重复任务:\n${mergedGroups.join('\n')}`
      )
      console.log(`[TaskScanner] Merged groups: ${mergedGroups.join(', ')}`)
    }
  } catch (error) {
    console.error('[TaskScanner] Deduplication failed:', error)
  }
}

/**
 * 扫描并标记废弃任务
 */
async function scanAndAbandonTasks(): Promise<void> {
  if (isScanning) {
    console.log('[TaskScanner] Scan already in progress, skipping')
    return
  }

  isScanning = true
  console.log('[TaskScanner] Starting task deduplication scan...')

  try {
    const pendingTasks = db.getPendingTasksForScan()
    console.log(`[TaskScanner] Found ${pendingTasks.length} pending tasks to scan`)

    // 任务去重合并（禁用任务验证功能，避免误判）
    if (pendingTasks.length >= 2) {
      console.log(`[TaskScanner] Starting deduplication for ${pendingTasks.length} tasks`)
      await deduplicateTasksWithAI(pendingTasks)
    } else {
      console.log(`[TaskScanner] Not enough tasks for deduplication (need at least 2)`)
    }

    console.log(`[TaskScanner] Scan completed`)
  } catch (error) {
    console.error('[TaskScanner] Scan failed:', error)
  } finally {
    isScanning = false
  }
}

/**
 * 启动定时扫描（每分钟执行一次）
 */
export function startTaskAbandonmentScanner(): void {
  if (scanInterval) {
    console.log('[TaskScanner] Scanner already running')
    return
  }

  console.log('[TaskScanner] Starting task abandonment scanner (interval: 60s)')

  // 立即执行一次
  scanAndAbandonTasks()

  // 每分钟执行一次
  scanInterval = setInterval(() => {
    scanAndAbandonTasks()
  }, 60 * 1000) // 60秒
}

/**
 * 停止定时扫描
 */
export function stopTaskAbandonmentScanner(): void {
  if (scanInterval) {
    console.log('[TaskScanner] Stopping task abandonment scanner')
    clearInterval(scanInterval)
    scanInterval = null
  }
}

/**
 * 手动触发一次扫描
 */
export async function triggerManualScan(): Promise<{ scanned: number; abandoned: number }> {
  console.log('[TaskScanner] Manual scan triggered')

  const pendingTasks = db.getPendingTasksForScan()
  const totalTasks = pendingTasks.length
  let abandonedCount = 0

  for (const task of pendingTasks) {
    const isValid = await validateTaskWithAI(task.title, task.description)

    if (!isValid) {
      db.abandonBacklogItem(task.id, true)
      sendTaskNotification(task.title, 'abandoned')
      abandonedCount++
    }
  }

  return {
    scanned: totalTasks,
    abandoned: abandonedCount
  }
}
