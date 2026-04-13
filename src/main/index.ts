import { app, shell, BrowserWindow, ipcMain, systemPreferences, protocol, net, session } from 'electron'
import * as fs from 'fs'
app.commandLine.appendSwitch('no-sandbox')
import * as path from 'path'
// import { exec } from 'child_process' // 已禁用测试通知，不再需要
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import OpenAI from 'openai'
import * as db from './database'
import { AGGREGATION_SYSTEM_PROMPT } from './prompts/aggregation'
import { PIPELINE_OPTIMIZATION_PROMPT } from './prompts/pipeline_optimization'
import {
  startCaptureLoop,
  stopCaptureLoop,
  startSlotSummaryLoop,
  stopSlotSummaryLoop,
  startDailyPricingLoop,
  stopDailyPricingLoop,
  startInsightCacheLoop,
  stopInsightCacheLoop,
  generateStatsInsight,
  generateDailyReport,
  setAppDataPath,
  parseOkrFromText,
  bootstrapBacklogFromHistory,
  startDailyReportLoop,
  stopDailyReportLoop,
  ensureYesterdayReportOnStartup
} from './capturer'
import { setMaintenanceBasePath } from './maintenance'
import { generateReport, refineReport, translateReport } from './reportGenerator'
import {
  installOpenclaw,
  syncApiKeyToOpenclaw,
  setupChannel,
  startGateway,
  stopGateway,
  isGatewayRunning,
  getInstallStatus,
  skipImConfiguration,
  resetOpenclaw,
  getDashboardUrl,
  GATEWAY_PORT_NUMBER
} from './openclaw'
import {
  startTaskAbandonmentScanner,
  stopTaskAbandonmentScanner,
  triggerManualScan
} from './taskAbandonmentScanner'

// 测试通知定时器（已禁用，只保留真实的任务状态变更通知）
// let testNotificationTimer: NodeJS.Timeout | null = null

/**
 * 启动测试通知定时器 - 每分钟发送一次系统通知
 * 注：已禁用，只保留真实的任务状态变更通知
 */
/*
function startTestNotificationTimer(): void {
  if (testNotificationTimer) {
    return
  }

  // 立即发送一次测试通知
  sendTestNotification()

  // 每 60 秒发送一次测试通知
  testNotificationTimer = setInterval(() => {
    sendTestNotification()
  }, 60000)

  console.log('[Test Notification] Timer started - will send notification every 60 seconds')
}
*/

/**
 * 停止测试通知定时器
 * 注：已禁用
 */
/*
function stopTestNotificationTimer(): void {
  if (testNotificationTimer) {
    clearInterval(testNotificationTimer)
    testNotificationTimer = null
    console.log('[Test Notification] Timer stopped')
  }
}
*/

/**
 * 发送测试通知 - 使用 macOS 原生通知
 * 注：已禁用
 */
/*
function sendTestNotification(): void {
  const now = new Date()
  const timeString = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  // 使用 macOS 的 osascript 命令发送系统通知
  const title = '🔔 DoWhat 测试通知'
  const message = `系统通知测试 - ${timeString}\n\n如果你看到这条通知，说明 macOS 系统通知功能正常工作！`

  // 转义特殊字符
  const escapedTitle = title.replace(/"/g, '\\"')
  const escapedMessage = message.replace(/"/g, '\\"')

  const script = `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}" sound name "default"'`

  exec(script, (error) => {
    if (error) {
      console.error(`[Test Notification] Failed to send notification:`, error)
    } else {
      console.log(`[Test Notification] Sent at ${timeString}`)
    }
  })
}
*/

// 允许加载本地图片
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, standard: true, supportFetchAPI: true } }
])

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1204,
    height: 845,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // 允许从 file:// 加载本地图片
      webviewTag: true // 允许使用 webview 标签（OpenClaw WebChat UI）
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

}

/**
 * 自动迁移数据：从项目根目录迁移到 userData 目录
 */
function migrateData(userDataPath: string): void {
  const migrationMarker = path.join(userDataPath, '.migration-completed')

  // 幂等性守卫：如果已经迁移过，直接跳过
  if (fs.existsSync(migrationMarker)) {
    console.log('[Migration] Already completed, skipping')
    return
  }

  const rootPath = process.cwd()
  const oldDbPath = path.join(rootPath, 'context_agent.db')
  const newDbPath = path.join(userDataPath, 'context_agent.db')
  const oldSnapshotsPath = path.join(rootPath, 'snapshots')
  const newSnapshotsPath = path.join(userDataPath, 'snapshots')

  // 前置条件：旧数据必须存在才执行迁移
  if (!fs.existsSync(oldDbPath) && !fs.existsSync(oldSnapshotsPath)) {
    console.log('[Migration] No old data found, marking as completed')
    fs.writeFileSync(migrationMarker, Date.now().toString())
    return
  }

  // 1. 迁移数据库
  if (fs.existsSync(oldDbPath)) {
    const shouldMigrateDb =
      !fs.existsSync(newDbPath) || fs.statSync(newDbPath).size < fs.statSync(oldDbPath).size

    if (shouldMigrateDb) {
      console.log(`[Migration] Copying database from ${oldDbPath} to ${newDbPath}`)
      try {
        fs.copyFileSync(oldDbPath, newDbPath)
        console.log('[Migration] Database migrated successfully')
      } catch (err) {
        console.error('[Migration] Database migration failed:', err)
      }
    }
  }

  // 2. 迁移截图目录
  if (fs.existsSync(oldSnapshotsPath) && !fs.existsSync(newSnapshotsPath)) {
    console.log(`[Migration] Moving snapshots from ${oldSnapshotsPath} to ${newSnapshotsPath}`)
    try {
      fs.mkdirSync(newSnapshotsPath, { recursive: true })
      try {
        fs.renameSync(oldSnapshotsPath, newSnapshotsPath)
        console.log('[Migration] Snapshots moved successfully')
      } catch (renameErr) {
        console.warn('[Migration] renameSync failed, falling back to recursive copy/delete')
      }
    } catch (err) {
      console.error('[Migration] Snapshots migration failed:', err)
    }
  }

  // 3. 更新数据库中的路径（仅当旧路径确实存在于数据库中时）
  if (fs.existsSync(newDbPath)) {
    try {
      const Database = require('better-sqlite3')
      const mdb = new Database(newDbPath)

      const oldPrefix = rootPath
      const newPrefix = userDataPath

      // 安全检查：仅替换确实以旧路径开头的记录，避免重复替换
      const affectedCount = mdb
        .prepare(`SELECT COUNT(*) as cnt FROM contexts WHERE image_local_path LIKE ?`)
        .get(`${oldPrefix}%`) as { cnt: number }

      if (affectedCount.cnt > 0) {
        console.log(`[Migration] Updating ${affectedCount.cnt} database paths: ${oldPrefix} -> ${newPrefix}`)
        mdb.prepare(`
          UPDATE contexts
          SET image_local_path = REPLACE(image_local_path, ?, ?)
          WHERE image_local_path LIKE ?
        `).run(oldPrefix, newPrefix, `${oldPrefix}%`)
        console.log('[Migration] Database paths updated successfully')
      } else {
        console.log('[Migration] No paths need updating')
      }

      mdb.close()
    } catch (dbErr) {
      console.error('[Migration] Failed to update database paths:', dbErr)
    }
  }

  // 标记迁移完成，后续启动不再执行
  fs.writeFileSync(migrationMarker, Date.now().toString())
  console.log('[Migration] Migration completed and marked')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // 拦截 OpenClaw Gateway 的 favicon.ico 请求，重定向到项目中的 openclaw.svg
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`http://127.0.0.1:${GATEWAY_PORT_NUMBER}/favicon.ico`] },
    (details, callback) => {
      const openclawLogoPath = path.join(__dirname, '../../resources/openclaw.svg')
      console.log(`[OpenClaw] Intercepting favicon.ico request, redirecting to: ${openclawLogoPath}`)

      callback({
        redirectURL: `file://${openclawLogoPath}`
      })
    }
  )

  // 设置 Content-Security-Policy，允许加载外部图片（包括 mintcdn.com）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    console.log('[Main] onHeadersReceived for:', details.url)
    console.log('[Main] Original headers:', JSON.stringify(details.responseHeaders))

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: local-file:;"
        ]
      }
    })
  })

  // 注册本地文件协议
  protocol.handle('local-file', (request) => {
    try {
      const parsedUrl = new URL(request.url)
      // Electron 可能将 path 的开头部分识别为 host (例如 Users -> users)
      // 这里将 host 和 pathname 拼接回来，并进行解码
      let filePath = decodeURIComponent(parsedUrl.host + parsedUrl.pathname)

      // 检查并修复绝对路径 (macOS/Linux)
      const isMacAbsoluteMissingSlash = /^(users|home|bin|usr|etc|var|opt|tmp)/i.test(filePath)
      const isWindowsAbsolute = /^[a-zA-Z]:/.test(filePath)

      if (isMacAbsoluteMissingSlash && !filePath.startsWith('/') && !isWindowsAbsolute) {
        filePath = '/' + filePath
      }

      // 如果既不是绝对路径也不像绝对路径，则认为是相对于 userData 的路径
      if (!filePath.startsWith('/') && !isWindowsAbsolute) {
        filePath = path.join(app.getPath('userData'), filePath)
      }

      console.log(`[Protocol] Loading local file: ${filePath}`)
      return net.fetch('file://' + filePath)
    } catch (error) {
      console.error(`[Protocol] Failed to load local file: ${request.url}`, error)
      return new Response('Not Found', { status: 404 })
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // 初始化迁移（仅在打包后的生产环境执行，dev 模式下不需要迁移）
  const userDataPath = app.getPath('userData')
  if (!is.dev) {
    migrateData(userDataPath)
  }

  // 初始化数据库，必须在 app ready 之后调用 getPath
  db.initDatabase(userDataPath)
  setAppDataPath(userDataPath)
  setMaintenanceBasePath(userDataPath)

  // 跨日继承：将历史未完成任务迁移到今天
  const inheritedCount = db.inheritUnfinishedTasks()
  if (inheritedCount > 0) {
    console.log(`[Main] Inherited ${inheritedCount} unfinished tasks to today`)
  }

  // 清理超出上限的低优先级待处理任务，保持每日列表简洁
  const hiddenCount = db.cleanupExcessTasks(10)
  if (hiddenCount > 0) {
    console.log(`[Main] Cleaned up ${hiddenCount} excess tasks to keep daily list focused`)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // IPC handlers for database
  ipcMain.handle('save-settings', (_, key, value) => {
    db.saveSetting(key, value)
  })
  ipcMain.handle('get-settings', (_, key) => {
    return db.getSetting(key)
  })
  ipcMain.handle('get-contexts', (_, date) => {
    return db.getContextsForDate(date)
  })

  ipcMain.handle('get-context-detail', (_, contextId: number) => {
    return db.getContextDetail(contextId)
  })

  ipcMain.handle('update-backlog-status', (_, id, completed) => {
    db.updateBacklogStatus(id, completed)
  })

  ipcMain.handle('get-backlog', () => {
    // 返回今日可见任务（跨日继承机制已在启动时将历史任务带入今日）
    return db.getVisibleBacklog()
  })

  ipcMain.handle('get-visible-backlog', () => {
    return db.getVisibleBacklog()
  })

  ipcMain.handle('add-manual-task', (_, title: string, description?: string) => {
    const taskId = `manual_task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const today = new Date().toISOString().split('T')[0]

    db.addBacklogItem({
      id: taskId,
      title: title.trim(),
      description: description?.trim() || '',
      progress: 0,
      subtasks: '',
      category: 'day',
      priority: 3,
      completed: false,
      is_hidden: false,
      is_abandoned: false,
      task_date: today,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    console.log(`[Main] Manual task added: ${title}`)
  })

  ipcMain.handle('update-task', (_, id: string, title: string, description?: string) => {
    db.updateBacklogItem(id, title, description)
    console.log(`[Main] Task updated: ${id}`)
  })

  ipcMain.handle('reclassify-task', (_, id: string, category: string, priority: number) => {
    db.reclassifyTask(id, category, priority)
    console.log(`[Main] Task reclassified: ${id} → category=${category}, priority=${priority}`)
  })

  ipcMain.handle('get-projects', () => {
    return db.getProjects()
  })

  ipcMain.handle('get-stats-summary', (_, start, end) => {
    return db.getStatsSummary(start, end)
  })

  ipcMain.handle('get-stats-insight', async (_, start, end, cycle?: string) => {
    // 优先从缓存读取，但必须校验缓存属于当前周期（防止跨周/跨月返回旧数据）
    if (cycle) {
      const cached = db.getInsightCache(cycle)
      if (cached && cached.updated_at >= start) {
        return {
          insight_text: cached.insight_text,
          warning_text: cached.warning_text,
          updated_at: cached.updated_at
        }
      }
    }
    // 缓存不存在或已过期，回退到实时生成
    return generateStatsInsight(start, end, cycle as 'day' | 'week' | 'month' | undefined)
  })

  ipcMain.handle('get-monthly-tokens', () => {
    return db.getMonthlyTokenUsage()
  })

  ipcMain.handle('get-model-pricing', (_, modelName: string) => {
    return db.getModelPricing(modelName)
  })

  ipcMain.handle('get-latest-summary', (_, level) => {
    return db.getLatestSummary(level)
  })

  ipcMain.handle('get-summaries-for-date', (_, date, level) => {
    return db.getSummariesForDate(date, level)
  })

  // ─── Report Generation IPC Handlers ─────────────────────────────────────────

  ipcMain.handle('generate-report', async (_, params: {
    reportType: 'daily' | 'weekly' | 'monthly'
    version: 'personal' | 'professional'
    startMs: number
    endMs: number
    userNotes: string
    language: 'zh' | 'en'
  }) => {
    try {
      console.log(`[Main] Generating ${params.version} ${params.reportType} report`)
      const report = await generateReport(params)
      return { success: true, report }
    } catch (error) {
      console.error('[Main] Report generation failed:', (error as Error).message)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('refine-report', async (_, params: {
    originalData: string
    previousReport: string
    userFeedback: string
    language: 'zh' | 'en'
    version: 'personal' | 'professional'
  }) => {
    try {
      console.log('[Main] Refining report')
      const report = await refineReport(params)
      return { success: true, report }
    } catch (error) {
      console.error('[Main] Report refinement failed:', (error as Error).message)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('translate-report', async (_, params: {
    report: string
    targetLanguage: 'zh' | 'en'
  }) => {
    try {
      console.log(`[Main] Translating report to ${params.targetLanguage}`)
      const report = await translateReport(params)
      return { success: true, report }
    } catch (error) {
      console.error('[Main] Report translation failed:', (error as Error).message)
      return { success: false, error: (error as Error).message }
    }
  })

  // IPC handlers for permissions
  ipcMain.handle('check-screen-permission', () => {
    // Note: getMediaAccessStatus('screen') is not supported on all Electron versions,
    // but works on recent macOS.
    return systemPreferences.getMediaAccessStatus('screen')
  })

  ipcMain.handle('open-system-preferences', () => {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  })

  ipcMain.handle('toggle-capture', (_, shouldStart) => {
    // 持久化 AI 感知状态，确保重启后能正确恢复
    db.saveSetting('ai_sensing', shouldStart ? 'true' : 'false')

    if (shouldStart) {
      // 从数据库读取用户设置的频率，如果没有则默认 5 秒 (5000ms)
      const savedInterval = db.getSetting('capture_interval')
      const intervalMs = savedInterval ? parseInt(savedInterval, 10) * 1000 : 5000
      console.log(`[Main] Starting capture loop with interval: ${intervalMs}ms`)
      startCaptureLoop(intervalMs)
      startSlotSummaryLoop()
      startDailyPricingLoop()
      startInsightCacheLoop()
      startDailyReportLoop()

      // 启动时兜底：0:00-10:30 之间自动生成昨天的日报
      ensureYesterdayReportOnStartup().catch((err) =>
        console.error('[Main] Ensure yesterday report failed:', (err as Error).message)
      )

      // 延迟 10 秒后触发 backlog 冷启动检查
      setTimeout(() => {
        bootstrapBacklogFromHistory().catch((err) =>
          console.error('[Main] Bootstrap backlog failed:', (err as Error).message)
        )
      }, 10_000)
    } else {
      console.log('[Main] Stopping capture loop')
      stopCaptureLoop()
      stopSlotSummaryLoop()
      stopDailyPricingLoop()
      stopInsightCacheLoop()
      stopDailyReportLoop()
    }
  })

  ipcMain.handle('get-ai-sensing-status', () => {
    return db.getSetting('ai_sensing') !== 'false'
  })

  ipcMain.handle('get-slot-summaries', (_, date: string) => {
    return db.getSlotSummariesForDate(date)
  })

  ipcMain.handle('get-daily-work-summary', (_, date: string) => {
    return db.getDailyWorkSummary(date) ?? null
  })

  ipcMain.handle('get-scheduled-reports', (_, reportType?: string) => {
    if (reportType) {
      return db.getScheduledReportsByType(reportType)
    }
    return db.getAllScheduledReports()
  })

  ipcMain.handle('get-scheduled-report-detail', (_, reportType: string, version: string, dateRange: string) => {
    return db.getScheduledReport(reportType, version, dateRange)
  })

  // 临时：手动触发批量生成历史日报 + 上周周报
  ipcMain.handle('trigger-batch-reports', async () => {
    const { generateReport } = await import('./reportGenerator')
    const versions: Array<'personal' | 'professional'> = ['personal', 'professional']
    const results: string[] = []

    // 1. 查询所有有截屏数据的日期
    const allDates = db.getContextDatesWithData()

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    // 过滤掉今天（今天还没结束，不生成日报）
    const historicalDates = allDates.filter(d => d !== todayStr)
    results.push(`[BatchReport] 发现 ${historicalDates.length} 个历史日期有数据: ${historicalDates.join(', ')}`)
    console.log(results[results.length - 1])

    // 2. 为每个历史日期生成日报（个人版 + 专业版）
    for (const dateStr of historicalDates) {
      const dayStart = new Date(dateStr + 'T00:00:00')
      const dayEnd = new Date(dateStr + 'T23:59:59.999')

      for (const version of versions) {
        const existing = db.getScheduledReport('daily', version, dateStr)
        if (existing) {
          results.push(`[BatchReport] 日报 ${version}/${dateStr} 已存在，跳过`)
          console.log(results[results.length - 1])
          continue
        }
        try {
          console.log(`[BatchReport] 生成日报 ${version}/${dateStr}...`)
          const report = await generateReport({
            reportType: 'daily', version,
            startMs: dayStart.getTime(), endMs: dayEnd.getTime(),
            userNotes: '', language: 'zh'
          })
          db.saveScheduledReport('daily', version, dateStr, report)
          results.push(`[BatchReport] ✅ 日报 ${version}/${dateStr} 生成成功`)
          console.log(results[results.length - 1])
        } catch (error) {
          const msg = `[BatchReport] ❌ 日报 ${version}/${dateStr} 失败: ${(error as Error).message}`
          results.push(msg)
          console.error(msg)
        }
      }
    }

    // 3. 生成上周周报（个人版 + 专业版）
    const lastMonday = new Date(today)
    const dow = today.getDay()
    lastMonday.setDate(today.getDate() - (dow === 0 ? 13 : dow + 6))
    lastMonday.setHours(0, 0, 0, 0)
    const lastSunday = new Date(lastMonday)
    lastSunday.setDate(lastMonday.getDate() + 6)
    lastSunday.setHours(23, 59, 59, 999)
    const fmtDate = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const weekRange = `${fmtDate(lastMonday)} ~ ${fmtDate(lastSunday)}`

    for (const version of versions) {
      const existing = db.getScheduledReport('weekly', version, weekRange)
      if (existing) {
        results.push(`[BatchReport] 周报 ${version}/${weekRange} 已存在，跳过`)
        console.log(results[results.length - 1])
        continue
      }
      try {
        console.log(`[BatchReport] 生成周报 ${version}/${weekRange}...`)
        const report = await generateReport({
          reportType: 'weekly', version,
          startMs: lastMonday.getTime(), endMs: lastSunday.getTime(),
          userNotes: '', language: 'zh'
        })
        db.saveScheduledReport('weekly', version, weekRange, report)
        results.push(`[BatchReport] ✅ 周报 ${version}/${weekRange} 生成成功`)
        console.log(results[results.length - 1])
      } catch (error) {
        const msg = `[BatchReport] ❌ 周报 ${version}/${weekRange} 失败: ${(error as Error).message}`
        results.push(msg)
        console.error(msg)
      }
    }

    return results
  })

  ipcMain.handle('get-daily-report-dates', () => {
    // 合并两个来源：已生成日报的日期 + 有数据但尚未生成日报的日期
    const reportDates = new Set(db.getDailyReportDates())
    const contextDates = db.getDistinctContextDates()
    for (const date of contextDates) {
      reportDates.add(date)
    }
    return Array.from(reportDates).sort().reverse()
  })

  ipcMain.handle('get-daily-report', async (_, date: string) => {
    try {
      // 1. 先从数据库直接读取已持久化的日报
      const existing = db.getDailyReport(date)
      if (existing) {
        return {
          success: true,
          insight_text: existing.insight_text,
          warning_text: existing.warning_text ?? undefined
        }
      }

      // 2. 数据库中没有该日期的日报，立即生成并持久化
      const result = await generateDailyReport(date)
      return { success: true, insight_text: result.insight_text, warning_text: result.warning_text }
    } catch (error) {
      console.error('[Main] Daily report retrieval failed:', (error as Error).message)
      return { success: false, insight_text: '', error: (error as Error).message }
    }
  })

  ipcMain.handle('test-llm-connection', async (_, apiKey, endpoint, modelName) => {
    console.log(`[Main] Received test-llm-connection request, modelName: ${modelName}`)
    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: endpoint.trim().replace(/\/+$/, '')
      })

      const response = await openai.chat.completions.create({
        model: modelName || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              "You are a helpful assistant. Please answer the user's question directly with only the final result, no explanation."
          },
          { role: 'user', content: '1+1等于几' }
        ],
        max_tokens: 10
      })

      console.log(`[Main] API response received`)

      if (response.choices && response.choices.length > 0) {
        return { success: true, message: '连接成功' }
      } else {
        throw new Error('API 返回内容异常')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '连接失败'
      console.error('[Main] LLM Test Connection failed:', error)
      return { success: false, message: errorMessage }
    }
  })

  ipcMain.handle('ai-smart-grouping', async (_, apiKey, endpoint, modelName, contexts) => {
    console.log(`[Main] Received ai-smart-grouping request, count: ${contexts.length}`)
    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: endpoint.trim().replace(/\/+$/, '')
      })

      // 简化 Context 数据以减少 Token 消耗
      // @ts-ignore
      const simplifiedContexts = contexts.map((c) => ({
        id: c.id,
        time: new Date(c.timestamp).toLocaleTimeString(),
        summary: c.ai_summary,
        tags: c.intent_tags
      }))

      const prompt = `
Input Activities:
${JSON.stringify(simplifiedContexts)}
`

      const response = await openai.chat.completions.create({
        model: modelName || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: AGGREGATION_SYSTEM_PROMPT + ' Respond in JSON format.'
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })

      const content = response.choices[0].message.content
      console.log(`[Main] AI Grouping response length:`, content?.length)
      if (!content) throw new Error('Empty response from AI')

      const result = JSON.parse(content)
      return result // Expecting { groups: [[id1, id2], [id3]] }
    } catch (error) {
      console.error('[Main] AI Grouping failed:', error)
      // 发生错误时返回空，前端应处理 fallback
      return { groups: [] }
    }
  })

  ipcMain.handle('ai-summarize-slot', async (_, apiKey, endpoint, modelName, summaries: string[]) => {
    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: endpoint.trim().replace(/\/+$/, '')
      })

      const summaryList = summaries
        .filter((s) => s && s.trim())
        .slice(0, 30) // 最多取 30 条，避免 token 过多
        .map((s, i) => `${i + 1}. ${s}`)
        .join('\n')

      const response = await openai.chat.completions.create({
        model: modelName || 'qwen-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个工作效率分析助手。根据用户在某段时间内的屏幕活动记录，归纳出这段时间的核心工作内容。要求：只返回一句话，严格控制在20个汉字以内，不要加任何标点符号或解释，直接输出核心内容。'
          },
          {
            role: 'user',
            content: `以下是这15分钟内的屏幕活动记录：\n${summaryList}\n\n请归纳这段时间主要在做什么（20字以内，一句话）：`
          }
        ],
        max_tokens: 60,
        temperature: 0.3
      })

      const result = response.choices[0].message.content?.trim() || ''
      return { summary: result }
    } catch (error) {
      console.error('[Main] AI Summarize Slot failed:', error)
      return { summary: '' }
    }
  })

  ipcMain.handle('ai-optimize-backlog', async (_, apiKey, endpoint, modelName, backlogItems) => {
    console.log(`[Main] Received ai-optimize-backlog request, count: ${backlogItems.length}`)
    try {
      const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: endpoint.trim().replace(/\/+$/, '')
      })

      const payload = backlogItems.map(item => ({
        id: item.id,
        title: item.title,
        subtasks: item.subtasks,
        category: item.category
      }))

      const response = await openai.chat.completions.create({
        model: modelName || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: PIPELINE_OPTIMIZATION_PROMPT + ' Respond in JSON format.'
          },
          { role: 'user', content: `Current Backlog:\n${JSON.stringify(payload)}` }
        ],
        response_format: { type: 'json_object' }
      })

      const content = response.choices[0].message.content
      if (!content) throw new Error('Empty response from AI')
      return JSON.parse(content)
    } catch (error) {
      console.error('[Main] AI Pipeline Optimization failed:', error)
      return { tasks: [] }
    }
  })

  // ===== OpenClaw IPC Handlers =====
  ipcMain.handle('openclaw-install', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0] || null
    return installOpenclaw(mainWindow)
  })

  ipcMain.handle('openclaw-setup-channel', async (_, channel: 'weixin' | 'feishu') => {
    const mainWindow = BrowserWindow.getAllWindows()[0] || null
    return setupChannel(mainWindow, channel)
  })

  ipcMain.handle('openclaw-gateway-status', async () => {
    const running = await isGatewayRunning()
    return { running, port: GATEWAY_PORT_NUMBER }
  })

  ipcMain.handle('openclaw-get-install-status', () => {
    return getInstallStatus()
  })

  ipcMain.handle('openclaw-reset', async () => {
    resetOpenclaw()
  })

  ipcMain.handle('openclaw-sync-apikey', async () => {
    return syncApiKeyToOpenclaw()
  })

  ipcMain.handle('openclaw-skip-im', async () => {
    skipImConfiguration()
  })

  ipcMain.handle('openclaw-get-dashboard-url', async () => {
    return getDashboardUrl()
  })

  // IPC handler for task abandonment scanner
  ipcMain.handle('trigger-task-scan', async () => {
    return triggerManualScan()
  })

  // IPC handler for parsing OKR from user-provided text
  ipcMain.handle('parse-okr-text', async (_event, inputText: string) => {
    try {
      const result = await parseOkrFromText(inputText)
      return result
    } catch (error) {
      console.error('[Main] OKR text parse failed:', (error as Error).message)
      return { success: false, objectiveCount: 0, error: (error as Error).message }
    }
  })

  // IPC handler for manual backlog bootstrap (cold start)
  ipcMain.handle('bootstrap-backlog', async () => {
    try {
      const result = await bootstrapBacklogFromHistory()
      return { success: true, created: result.created, summary: result.summary }
    } catch (error) {
      console.error('[Main] Backlog bootstrap failed:', (error as Error).message)
      return { success: false, error: (error as Error).message }
    }
  })

  createWindow()

  // ═══ 临时：启动后 15 秒自动触发批量生成历史日报 + 上周周报 ═══
  setTimeout(async () => {
    console.log('[BatchReport] 🚀 自动触发批量报告生成...')
    try {
      const { generateReport } = await import('./reportGenerator')
      const versions: Array<'personal' | 'professional'> = ['personal', 'professional']

      const allDates = db.getContextDatesWithData()
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const historicalDates = allDates.filter(d => d !== todayStr)
      console.log(`[BatchReport] 发现 ${historicalDates.length} 个历史日期: ${historicalDates.join(', ')}`)

      // 日报
      for (const dateStr of historicalDates) {
        const dayStart = new Date(dateStr + 'T00:00:00')
        const dayEnd = new Date(dateStr + 'T23:59:59.999')
        for (const version of versions) {
          if (db.getScheduledReport('daily', version, dateStr)) {
            console.log(`[BatchReport] 日报 ${version}/${dateStr} 已存在，跳过`)
            continue
          }
          try {
            console.log(`[BatchReport] 生成日报 ${version}/${dateStr}...`)
            const report = await generateReport({
              reportType: 'daily', version,
              startMs: dayStart.getTime(), endMs: dayEnd.getTime(),
              userNotes: '', language: 'zh'
            })
            db.saveScheduledReport('daily', version, dateStr, report)
            console.log(`[BatchReport] ✅ 日报 ${version}/${dateStr} 完成`)
          } catch (error) {
            console.error(`[BatchReport] ❌ 日报 ${version}/${dateStr} 失败:`, (error as Error).message)
          }
        }
      }

      // 上周周报
      const lastMonday = new Date(today)
      const dow = today.getDay()
      lastMonday.setDate(today.getDate() - (dow === 0 ? 13 : dow + 6))
      lastMonday.setHours(0, 0, 0, 0)
      const lastSunday = new Date(lastMonday)
      lastSunday.setDate(lastMonday.getDate() + 6)
      lastSunday.setHours(23, 59, 59, 999)
      const fmtDate = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const weekRange = `${fmtDate(lastMonday)} ~ ${fmtDate(lastSunday)}`

      for (const version of versions) {
        if (db.getScheduledReport('weekly', version, weekRange)) {
          console.log(`[BatchReport] 周报 ${version}/${weekRange} 已存在，跳过`)
          continue
        }
        try {
          console.log(`[BatchReport] 生成周报 ${version}/${weekRange}...`)
          const report = await generateReport({
            reportType: 'weekly', version,
            startMs: lastMonday.getTime(), endMs: lastSunday.getTime(),
            userNotes: '', language: 'zh'
          })
          db.saveScheduledReport('weekly', version, weekRange, report)
          console.log(`[BatchReport] ✅ 周报 ${version}/${weekRange} 完成`)
        } catch (error) {
          console.error(`[BatchReport] ❌ 周报 ${version}/${weekRange} 失败:`, (error as Error).message)
        }
      }

      console.log('[BatchReport] 🎉 批量报告生成全部完成！')
    } catch (error) {
      console.error('[BatchReport] 批量生成失败:', (error as Error).message)
    }
  }, 15000)
  // ═══ 临时代码结束 ═══

  // 应用启动时，默认开启 AI 感知（除非用户显式关闭过）
  const aiSensingSetting = db.getSetting('ai_sensing')
  const aiSensing = aiSensingSetting !== 'false'
  if (aiSensing) {
    // 持久化默认开启状态（首次启动时 ai_sensing 为 null，写入 'true'）
    if (!aiSensingSetting) {
      db.saveSetting('ai_sensing', 'true')
    }
    const savedInterval = db.getSetting('capture_interval')
    const intervalMs = savedInterval ? parseInt(savedInterval, 10) * 1000 : 5000
    console.log(`[Main] Auto-starting capture loop: ${intervalMs}ms`)
    startCaptureLoop(intervalMs)
    startSlotSummaryLoop()
    startDailyPricingLoop()
    startInsightCacheLoop()

    // 延迟 10 秒后触发 backlog 冷启动检查
    setTimeout(() => {
      bootstrapBacklogFromHistory().catch((err) =>
        console.error('[Main] Bootstrap backlog on startup failed:', (err as Error).message)
      )
    }, 10_000)
  }

  // 应用启动时，若 OpenClaw 已安装则自动启动 Gateway
  startGateway()

  // 启动任务废弃扫描器（每分钟扫描一次）
  startTaskAbandonmentScanner()

  // 启动测试通知定时器（每分钟发送一次测试通知）
  // 注释掉测试通知，只保留真实的任务状态变更通知
  // startTestNotificationTimer()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 应用退出前关闭 OpenClaw Gateway 和任务扫描器
app.on('before-quit', () => {
  stopGateway()
  stopTaskAbandonmentScanner()
  // stopTestNotificationTimer() // 已注释掉测试通知
  stopCaptureLoop()
  stopSlotSummaryLoop()
  stopDailyPricingLoop()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
