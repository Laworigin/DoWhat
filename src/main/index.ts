import { app, shell, BrowserWindow, ipcMain, systemPreferences, protocol, net, session } from 'electron'
import * as fs from 'fs'
app.commandLine.appendSwitch('no-sandbox')
import * as path from 'path'
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
  generateStatsInsight,
  setAppDataPath
} from './capturer'

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
      webSecurity: false // 允许从 file:// 加载本地图片
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
    mainWindow.webContents.openDevTools() // 自动打开开发者工具
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 自动迁移数据：从项目根目录迁移到 userData 目录
 */
function migrateData(userDataPath: string): void {
  const rootPath = process.cwd()
  const oldDbPath = path.join(rootPath, 'context_agent.db')
  const newDbPath = path.join(userDataPath, 'context_agent.db')
  const oldSnapshotsPath = path.join(rootPath, 'snapshots')
  const newSnapshotsPath = path.join(userDataPath, 'snapshots')

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
  if (fs.existsSync(oldSnapshotsPath)) {
    if (!fs.existsSync(newSnapshotsPath)) {
      console.log(`[Migration] Moving snapshots from ${oldSnapshotsPath} to ${newSnapshotsPath}`)
      try {
        // 使用同步方法递归创建目录并复制/移动
        fs.mkdirSync(newSnapshotsPath, { recursive: true })
        // 简单重命名（如果跨分区会失败，但此处通常在同一个用户目录下）
        try {
          fs.renameSync(oldSnapshotsPath, newSnapshotsPath)
          console.log('[Migration] Snapshots moved successfully')
        } catch (renameErr) {
          console.warn('[Migration] renameSync failed, falling back to recursive copy/delete')
          // Fallback logic if needed, but for now focus on the DB
        }
      } catch (err) {
        console.error('[Migration] Snapshots migration failed:', err)
      }
    }
  }

  // 3. 更新数据库中的路径（如果数据库已迁移）
  if (fs.existsSync(newDbPath)) {
    try {
      const Database = require('better-sqlite3')
      const mdb = new Database(newDbPath)

      // 将旧的项目根目录路径替换为新的 userData 路径
      const oldPrefix = rootPath
      const newPrefix = userDataPath

      console.log(`[Migration] Updating database paths: ${oldPrefix} -> ${newPrefix}`)

      mdb.prepare(`
        UPDATE contexts
        SET image_local_path = REPLACE(image_local_path, ?, ?)
        WHERE image_local_path LIKE ?
      `).run(oldPrefix, newPrefix, `${oldPrefix}%`)

      mdb.close()
      console.log('[Migration] Database paths updated successfully')
    } catch (dbErr) {
      console.error('[Migration] Failed to update database paths:', dbErr)
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // 设置 Content-Security-Policy，允许加载 local-file:// 图片
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    console.log('[Main] onHeadersReceived for:', details.url)
    console.log('[Main] Original headers:', JSON.stringify(details.responseHeaders))

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com local-file:;"
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

  // 初始化迁移
  const userDataPath = app.getPath('userData')
  migrateData(userDataPath)

  // 初始化数据库，必须在 app ready 之后调用 getPath
  db.initDatabase(userDataPath)
  setAppDataPath(userDataPath)

  // 跨日继承：将历史未完成任务迁移到今天
  const inheritedCount = db.inheritUnfinishedTasks()
  if (inheritedCount > 0) {
    console.log(`[Main] Inherited ${inheritedCount} unfinished tasks to today`)
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

  ipcMain.handle('get-backlog', () => {
    return db.getBacklog()
  })

  ipcMain.handle('update-backlog-status', (_, id, completed) => {
    return db.updateBacklogStatus(id, completed)
  })

  ipcMain.handle('get-visible-backlog', () => {
    return db.getVisibleBacklog()
  })

  ipcMain.handle('get-projects', () => {
    return db.getProjects()
  })

  ipcMain.handle('get-stats-summary', (_, start, end) => {
    return db.getStatsSummary(start, end)
  })

  ipcMain.handle('get-stats-insight', async (_, start, end) => {
    return generateStatsInsight(start, end)
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
    if (shouldStart) {
      // 从数据库读取用户设置的频率，如果没有则默认 5 秒 (5000ms)
      const savedInterval = db.getSetting('capture_interval')
      const intervalMs = savedInterval ? parseInt(savedInterval, 10) * 1000 : 5000
      console.log(`[Main] Starting capture loop with interval: ${intervalMs}ms`)
      startCaptureLoop(intervalMs)
      startSlotSummaryLoop()
      startDailyPricingLoop()
    } else {
      console.log('[Main] Stopping capture loop')
      stopCaptureLoop()
      stopSlotSummaryLoop()
      stopDailyPricingLoop()
    }
  })

  ipcMain.handle('get-slot-summaries', (_, date: string) => {
    return db.getSlotSummariesForDate(date)
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

  createWindow()

  // 应用启动时，若 AI 感知已开启则自动恢复捕获和槽摘要任务
  const aiSensing = db.getSetting('ai_sensing') === 'true'
  if (aiSensing) {
    const savedInterval = db.getSetting('capture_interval')
    const intervalMs = savedInterval ? parseInt(savedInterval, 10) * 1000 : 5000
    console.log(`[Main] Auto-starting capture loop: ${intervalMs}ms`)
    startCaptureLoop(intervalMs)
    startSlotSummaryLoop()
    startDailyPricingLoop()
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
