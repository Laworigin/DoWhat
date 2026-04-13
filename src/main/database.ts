import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

let db: Database.Database

// 初始化数据库
export function initDatabase(appDataPath?: string): void {
  try {
    // 方案：优先使用传入的 appDataPath (userData)，否则回退到 process.cwd()
    const dbPath = appDataPath
      ? path.join(appDataPath, 'context_agent.db')
      : path.join(process.cwd(), 'context_agent.db')

    console.log('[DB] Using database path:', dbPath)

    db = new Database(dbPath)

    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        image_local_path TEXT,
        ai_summary TEXT,
        intent_tags TEXT
      );

      CREATE TABLE IF NOT EXISTS backlog (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        progress INTEGER DEFAULT 0,
        subtasks TEXT,
        color TEXT,
        completed INTEGER DEFAULT 0,
        category TEXT, -- 'week', 'month', 'backlog'
        project_id TEXT,
        created_at INTEGER NOT NULL,
        priority INTEGER DEFAULT 3,
        is_hidden INTEGER DEFAULT 0,
        task_date TEXT,   -- 任务所属日期 YYYY-MM-DD，用于按日查询和跨日继承
        origin_id TEXT    -- 跨日继承时指向最原始任务的 ID，始终指向源头
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        tokens INTEGER NOT NULL,
        model TEXT,
        type TEXT -- 'vision', 'audio', 'summary'
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level INTEGER NOT NULL, -- 1, 5, 10, 15, 30, 60 (minutes)
        content TEXT NOT NULL,
        model TEXT
      );

      CREATE TABLE IF NOT EXISTS slot_summaries (
        slot_start_ms INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        summary TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_work_summary (
        date TEXT PRIMARY KEY,
        summary_text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_pricing (
        model_name TEXT PRIMARY KEY,
        input_price_per_1m REAL NOT NULL,  -- 每百万 input token 的美元价格
        output_price_per_1m REAL NOT NULL, -- 每百万 output token 的美元价格
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS insight_cache (
        cycle TEXT PRIMARY KEY,  -- 'day', 'week', 'month'
        insight_text TEXT NOT NULL,
        warning_text TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_reports (
        date TEXT PRIMARY KEY,          -- YYYY-MM-DD
        insight_text TEXT NOT NULL,
        warning_text TEXT,
        generated_at INTEGER NOT NULL   -- 生成时间戳（毫秒）
      );

      CREATE TABLE IF NOT EXISTS scheduled_reports (
        report_type TEXT NOT NULL,      -- 'daily' | 'weekly' | 'monthly'
        version TEXT NOT NULL,          -- 'personal' | 'professional'
        date_range TEXT NOT NULL,       -- 'YYYY-MM-DD' 或 'YYYY-MM-DD ~ YYYY-MM-DD'
        report_text TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        PRIMARY KEY (report_type, version, date_range)
      );
    `)

    // 迁移：为旧数据库添加缺失的字段
    const tableInfo = db.prepare("PRAGMA table_info(backlog)").all() as { name: string }[]
    const columns = tableInfo.map(c => c.name)

    if (!columns.includes('priority')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN priority INTEGER DEFAULT 3')
        console.log('[DB] Added priority column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add priority column:', e)
      }
    }

    if (!columns.includes('is_abandoned')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN is_abandoned INTEGER DEFAULT 0')
        console.log('[DB] Added is_abandoned column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add is_abandoned column:', e)
      }
    }

    if (!columns.includes('is_hidden')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN is_hidden INTEGER DEFAULT 0')
        console.log('[DB] Added is_hidden column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add is_hidden column:', e)
      }
    }

    if (!columns.includes('task_date')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN task_date TEXT')
        // 为旧数据补填 task_date：根据 created_at 时间戳转换为 YYYY-MM-DD
        db.exec(`
          UPDATE backlog
          SET task_date = date(created_at / 1000, 'unixepoch', 'localtime')
          WHERE task_date IS NULL
        `)
        console.log('[DB] Added task_date column to backlog and backfilled existing rows')
      } catch (e) {
        console.error('[DB] Failed to add task_date column:', e)
      }
    }

    if (!columns.includes('origin_id')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN origin_id TEXT')
        console.log('[DB] Added origin_id column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add origin_id column:', e)
      }
    }

    if (!columns.includes('description')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN description TEXT')
        console.log('[DB] Added description column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add description column:', e)
      }
    }

    if (!columns.includes('is_abandoned')) {
      try {
        db.exec('ALTER TABLE backlog ADD COLUMN is_abandoned INTEGER DEFAULT 0')
        console.log('[DB] Added is_abandoned column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add is_abandoned column:', e)
      }
    }

    if (!columns.includes('completed_by')) {
      try {
        db.exec("ALTER TABLE backlog ADD COLUMN completed_by TEXT DEFAULT NULL")
        console.log('[DB] Added completed_by column to backlog')
      } catch (e) {
        console.error('[DB] Failed to add completed_by column:', e)
      }
    }

    // Performance: add indexes for frequently queried timestamp columns
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contexts_timestamp ON contexts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_summaries_timestamp ON summaries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_slot_summaries_date ON slot_summaries(date);
      CREATE INDEX IF NOT EXISTS idx_backlog_task_date ON backlog(task_date);
    `)

    // Performance: optimize WAL mode and memory usage
    db.pragma('journal_mode = WAL')
    db.pragma('cache_size = -2000')

    // Auto-cleanup: remove data older than 30 days to prevent database bloat
    cleanupOldData()

    console.log(`[DB] Database initialized successfully at: ${dbPath}`)
  } catch (error) {
    console.error('[DB] Database initialization failed:', error)
    throw error // Rethrow to be caught by the main process
  }
}

// 设置项的 CRUD
export function saveSetting(key: string, value: string): void {
  if (!db) return
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  stmt.run(key, value)
}

export function getSetting(key: string): string | null {
  if (!db) return null
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const result = stmt.get(key) as { value: string } | undefined
  return result ? result.value : null
}

// Context 记录的 CRUD
export function saveContext(
  timestamp: number,
  imagePath: string,
  summary: string,
  tags: string
): void {
  if (!db) return
  const stmt = db.prepare(
    'INSERT INTO contexts (timestamp, image_local_path, ai_summary, intent_tags) VALUES (?, ?, ?, ?)'
  )
  stmt.run(timestamp, imagePath, summary, tags)
}

export function getContextsForDate(date: string): unknown[] {
  if (!db) return []
  const startOfDay = new Date(date).setHours(0, 0, 0, 0)
  const endOfDay = new Date(date).setHours(23, 59, 59, 999)

  // Select fields needed for list rendering (image_local_path is a lightweight path string, needed for thumbnails)
  const stmt = db.prepare(
    'SELECT id, timestamp, image_local_path, ai_summary, intent_tags FROM contexts WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC'
  )
  return stmt.all(startOfDay, endOfDay)
}

/**
 * Get full context detail including image_local_path (on-demand, for detail panel)
 */
export function getContextDetail(contextId: number): unknown | null {
  if (!db) return null
  return db.prepare('SELECT * FROM contexts WHERE id = ?').get(contextId) ?? null
}

// Backlog 相关
export function getBacklog(): unknown[] {
  if (!db) return []
  // 过滤掉被标记为废弃/隐藏的任务 (is_hidden = 1 或 is_abandoned = 1)
  return db.prepare('SELECT * FROM backlog WHERE is_hidden = 0 AND is_abandoned = 0 ORDER BY created_at DESC').all()
}

export function updateBacklogStatus(id: string, completed: boolean, completedBy?: 'manual' | 'ai'): void {
  if (!db) return
  const completedValue = completed ? 1 : 0
  const completedByValue = completed ? (completedBy ?? 'manual') : null
  db.prepare('UPDATE backlog SET completed = ?, completed_by = ? WHERE id = ?').run(completedValue, completedByValue, id)
}

/**
 * 更新任务优先级
 */
export function updateBacklogPriority(id: string, priority: number): void {
  if (!db) return
  db.prepare('UPDATE backlog SET priority = ? WHERE id = ?').run(priority, id)
}

/**
 * 隐藏或显示任务
 */
export function hideBacklogItem(id: string, isHidden: boolean): void {
  if (!db) return
  db.prepare('UPDATE backlog SET is_hidden = ? WHERE id = ?').run(isHidden ? 1 : 0, id)
}

/**
 * 标记任务为废弃状态（隐藏任务）
 * 注意：同时隐藏该任务的所有跨日继承任务（通过 origin_id 关联）
 */
export function abandonBacklogItem(id: string, isAbandoned: boolean): void {
  if (!db) return
  const flagValue = isAbandoned ? 1 : 0

  // 先查出该任务的 origin_id（如果有的话）
  const task = db.prepare('SELECT origin_id FROM backlog WHERE id = ?').get(id) as { origin_id: string | null } | undefined
  const trueOriginId = task?.origin_id ?? id

  // 同时设置 is_hidden 和 is_abandoned，确保废弃任务在所有视图中不可见
  db.prepare('UPDATE backlog SET is_hidden = ?, is_abandoned = ? WHERE id = ?').run(flagValue, flagValue, id)

  // 同时处理所有以该任务为 origin 的继承任务（跨日继承的副本）
  db.prepare('UPDATE backlog SET is_hidden = ?, is_abandoned = ? WHERE origin_id = ?').run(flagValue, flagValue, id)

  // 如果该任务本身是继承任务，也处理同一 origin 的所有兄弟继承任务
  if (trueOriginId !== id) {
    db.prepare('UPDATE backlog SET is_hidden = ?, is_abandoned = ? WHERE id = ? OR origin_id = ?').run(flagValue, flagValue, trueOriginId, trueOriginId)
  }
}

/**
 * 重新分类任务（修改 category 和 priority）
 * 用于拖拽调整任务分类
 */
export function reclassifyTask(id: string, category: string, priority: number): void {
  if (!db) return
  db.prepare('UPDATE backlog SET category = ?, priority = ? WHERE id = ?').run(category, priority, id)
}

// 项目相关
export function getProjects(): unknown[] {
  if (!db) return []
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()
}

/**
 * 智能更新或新增任务项 (用于 AI 聚合后的同步)
 */
export function upsertBacklogItem(item: {
  id: string
  title: string
  description?: string
  progress: number
  subtasks: string
  color: string
  category: string
  priority?: number
  completed?: boolean
  project_id?: string | null
  created_at?: number
  task_date?: string
  origin_id?: string | null
}): void {
  if (!db) return

  const now = Date.now()
  const priority = item.priority ?? 3
  const isCompleted = item.completed ? 1 : 0
  const createdAt = item.created_at ?? now
  const taskDate = item.task_date ?? new Date(createdAt).toISOString().split('T')[0]
  const originId = item.origin_id ?? null
  const description = item.description ?? null

  db.prepare(`
    INSERT INTO backlog (id, title, description, progress, subtasks, color, completed, category, project_id, created_at, priority, is_hidden, task_date, origin_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      progress = excluded.progress,
      subtasks = excluded.subtasks,
      color = excluded.color,
      completed = excluded.completed,
      category = excluded.category,
      priority = excluded.priority,
      task_date = excluded.task_date,
      origin_id = excluded.origin_id
  `).run(
    item.id,
    item.title,
    description,
    item.progress,
    item.subtasks,
    item.color,
    isCompleted,
    item.category,
    item.project_id || null,
    createdAt,
    priority,
    taskDate,
    originId
  )
}

export function addBacklogItem(item: any): void {
  upsertBacklogItem(item)
}

/**
 * 更新任务的标题和描述
 */
export function updateBacklogItem(id: string, title: string, description?: string): void {
  if (!db) return

  db.prepare(
    'UPDATE backlog SET title = ?, description = ? WHERE id = ?'
  ).run(title.trim(), description?.trim() || '', id)

  console.log(`[DB] Task updated: ${id}`)
}

/**
 * 获取今日可见任务列表（task_date = 今天，非隐藏，非废弃）
 * 按优先级升序（1最高）、创建时间降序排列
 */
export function getVisibleBacklog(): any[] {
  if (!db) return []
  const today = new Date().toISOString().split('T')[0]
  return db.prepare(
    'SELECT * FROM backlog WHERE is_hidden = 0 AND task_date = ? ORDER BY priority ASC, created_at DESC'
  ).all(today)
}

/**
 * 清理超出上限的低优先级待处理任务
 * 保留 priority 最高的 maxVisible 个未完成任务，其余标记为 is_hidden=1
 * 在应用启动时调用，确保每日任务列表简洁聚焦
 */
export function cleanupExcessTasks(maxVisible: number = 10): number {
  if (!db) return 0

  const today = new Date().toISOString().split('T')[0]

  // 获取今日所有未完成、未隐藏的任务，按优先级排序
  const pendingTasks = db.prepare(`
    SELECT id FROM backlog
    WHERE completed = 0 AND is_hidden = 0 AND task_date = ?
    ORDER BY priority ASC, created_at DESC
  `).all(today) as { id: string }[]

  if (pendingTasks.length <= maxVisible) return 0

  // 超出上限的任务 ID
  const tasksToHide = pendingTasks.slice(maxVisible)
  const hideStmt = db.prepare('UPDATE backlog SET is_hidden = 1 WHERE id = ?')

  for (const task of tasksToHide) {
    hideStmt.run(task.id)
  }

  console.log(`[DB] cleanupExcessTasks: hidden ${tasksToHide.length} low-priority tasks (kept top ${maxVisible})`)
  return tasksToHide.length
}

/**
 * 获取今日任务总数（包括已完成和未完成，不含隐藏）
 * 用于每日日程总量上限控制
 */
export function getTodayTaskCount(): number {
  if (!db) return 0
  const today = new Date().toISOString().split('T')[0]
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM backlog WHERE is_hidden = 0 AND task_date = ?'
  ).get(today) as { count: number }
  return result.count
}

/**
 * 获取今日待处理的任务（未完成、未隐藏、task_date = 今天）
 * 用于定时扫描和 AI 去重判断
 * 只扫描今日任务，避免处理大量历史任务导致去重效果差
 */
export function getPendingTasksForScan(): any[] {
  if (!db) return []
  const today = new Date().toISOString().split('T')[0]
  return db.prepare(
    'SELECT * FROM backlog WHERE completed = 0 AND is_hidden = 0 AND task_date = ? ORDER BY created_at DESC'
  ).all(today)
}

/**
 * 跨日继承：将历史未完成任务复制到今天
 * 规则：completed=0 且 task_date != 今天 且 is_hidden=0 的任务，
 * 若今天尚无对应的继承记录（通过 origin_id 去重），则复制一条新记录到今天。
 * 返回继承的任务数量。
 */
export function inheritUnfinishedTasks(): number {
  if (!db) return 0

  const today = new Date().toISOString().split('T')[0]

  // 每日继承上限：只继承优先级最高的 N 个任务，避免任务列表无限膨胀
  const maxInheritCount = 5

  // 查询所有历史未完成任务（不属于今天的），按优先级排序（1=最高）
  const unfinishedHistoryTasks = db.prepare(`
    SELECT * FROM backlog
    WHERE completed = 0
      AND is_hidden = 0
      AND (task_date IS NULL OR task_date != ?)
    ORDER BY priority ASC, created_at DESC
  `).all(today) as any[]

  if (unfinishedHistoryTasks.length === 0) return 0

  // 查询今天已有的所有 origin_id（用于去重，避免重复继承）
  const todayOriginIds = new Set(
    (db.prepare(`
      SELECT origin_id FROM backlog
      WHERE task_date = ? AND origin_id IS NOT NULL
    `).all(today) as { origin_id: string }[]).map(row => row.origin_id)
  )

  // 今天已有的任务 id 集合（防止 origin_id 为 null 时与自身 id 重复）
  const todayTaskIds = new Set(
    (db.prepare('SELECT id FROM backlog WHERE task_date = ?').all(today) as { id: string }[])
      .map(row => row.id)
  )

  const now = Date.now()
  let inheritedCount = 0

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO backlog
      (id, title, description, progress, subtasks, color, completed, category, project_id, created_at, priority, is_hidden, task_date, origin_id)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?)
  `)

  for (const task of unfinishedHistoryTasks) {
    // 达到继承上限后停止，保持每日任务聚焦
    if (inheritedCount >= maxInheritCount) break

    // origin_id 始终指向最原始的任务 ID
    const trueOriginId: string = task.origin_id ?? task.id

    // 如果今天已经有这个 origin_id 的继承记录，跳过
    if (todayOriginIds.has(trueOriginId)) continue

    // 生成新的继承任务 ID，避免与原任务 ID 冲突
    const newId = `inherited_${today}_${trueOriginId}`

    // 如果今天已经有这个 id，也跳过
    if (todayTaskIds.has(newId)) continue

    insertStmt.run(
      newId,
      task.title,
      task.description || null,
      task.progress,
      task.subtasks,
      task.color,
      task.category,
      task.project_id || null,
      now,
      task.priority ?? 3,
      today,
      trueOriginId
    )

    todayOriginIds.add(trueOriginId)
    todayTaskIds.add(newId)
    inheritedCount++
  }

  const skippedCount = unfinishedHistoryTasks.length - inheritedCount
  console.log(`[DB] inheritUnfinishedTasks: inherited ${inheritedCount} tasks to ${today} (skipped ${skippedCount} lower-priority tasks, max=${maxInheritCount})`)
  return inheritedCount
}

// 统计相关

/**
 * 根据截屏时间戳序列计算实际活跃分钟数
 * 相邻截屏间隔 ≤ 2 分钟视为连续活跃，超过 2 分钟视为离开
 */
function calculateActiveMinutes(timestamps: number[]): number {
  if (timestamps.length < 2) return timestamps.length > 0 ? 1 : 0

  const maxGapMs = 2 * 60 * 1000
  let totalActiveMs = 0

  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1]
    if (gap <= maxGapMs) {
      totalActiveMs += gap
    }
  }

  return Math.round(totalActiveMs / 60000)
}

export function getStatsSummary(
  start: number,
  end: number
): {
  total_count: number
  tagged_count: number
  top_intents: unknown[]
  flow_data: number[]
  context_switches: number
  active_minutes: number
  prev_active_minutes: number
  prev_context_switches: number
} | null {
  if (!db) return null

  // 计算总截屏数量
  const totalContexts = db
    .prepare('SELECT COUNT(*) as count FROM contexts WHERE timestamp >= ? AND timestamp <= ?')
    .get(start, end) as { count: number }

  // 计算有意图标签的截屏总数
  const taggedContexts = db
    .prepare("SELECT COUNT(*) as count FROM contexts WHERE timestamp >= ? AND timestamp <= ? AND intent_tags IS NOT NULL AND intent_tags != ''")
    .get(start, end) as { count: number }

  // 获取最常出现的意图分类（返回原始 intent_tags，前端负责提取第一个标签并合并去重）
  const topIntents = db
    .prepare(
      `
    SELECT intent_tags, COUNT(*) as count
    FROM contexts
    WHERE timestamp >= ? AND timestamp <= ?
      AND intent_tags IS NOT NULL AND intent_tags != ''
    GROUP BY intent_tags
    ORDER BY count DESC
    LIMIT 20
  `
    )
    .all(start, end)

  // 获取所有截屏时间戳，用于计算活跃时间和上下文切换
  const contexts = db
    .prepare('SELECT timestamp, intent_tags FROM contexts WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC')
    .all(start, end) as { timestamp: number; intent_tags: string }[]

  // 计算上下文切换次数
  let switches = 0
  for (let i = 1; i < contexts.length; i++) {
    if (contexts[i].intent_tags !== contexts[i - 1].intent_tags) {
      switches++
    }
  }

  // 计算实际活跃分钟数
  const activeMinutes = calculateActiveMinutes(contexts.map((c) => c.timestamp))

  // 计算上一周期的数据用于趋势对比
  const periodLength = end - start
  const prevStart = start - periodLength
  const prevEnd = start

  const prevContexts = db
    .prepare('SELECT timestamp, intent_tags FROM contexts WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC')
    .all(prevStart, prevEnd) as { timestamp: number; intent_tags: string }[]

  const prevActiveMinutes = calculateActiveMinutes(prevContexts.map((c) => c.timestamp))

  let prevSwitches = 0
  for (let i = 1; i < prevContexts.length; i++) {
    if (prevContexts[i].intent_tags !== prevContexts[i - 1].intent_tags) {
      prevSwitches++
    }
  }

  // 计算心流投入度时间序列
  // 日报：按 24 小时制（每小时一个数据点）
  // 周报/月报：按天（每天一个数据点）
  const periodMs = end - start
  const oneDayMs = 24 * 60 * 60 * 1000
  const isDaily = periodMs <= oneDayMs * 1.5

  let flowData: number[]

  // 从 intent_tags JSON 中提取工作主题（前两个标签），用于判断是否切换了工作内容
  // 例如 ["Chrome","HR政策发布平台","外籍津贴","报销指引","文档"] → "Chrome|HR政策发布平台"
  function extractIntentTopic(intentTags: string): string {
    try {
      const tags = JSON.parse(intentTags)
      if (Array.isArray(tags) && tags.length > 0) {
        return tags.slice(0, 2).join('|')
      }
    } catch {
      // JSON 解析失败，回退到原始字符串
    }
    return intentTags || ''
  }

  if (isDaily) {
    // 日报模式：固定 24 个数据点（00:00-23:00），每小时一个投入度分数
    const dayStart = new Date(start)
    dayStart.setHours(0, 0, 0, 0)
    const baseMs = dayStart.getTime()
    const oneHourMs = 60 * 60 * 1000
    // 活跃密度基准：200 条/小时（约每 18 秒一次截屏，代表高效工作状态）
    const densityBaseline = 200

    flowData = []
    for (let hour = 0; hour < 24; hour++) {
      const hourStart = baseMs + hour * oneHourMs
      const hourEnd = hourStart + oneHourMs

      const hourContexts = db
        .prepare('SELECT timestamp, intent_tags FROM contexts WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC')
        .all(hourStart, hourEnd) as { timestamp: number; intent_tags: string }[]

      if (hourContexts.length === 0) {
        flowData.push(0)
        continue
      }

      // 活跃密度分（0-100）：用平方根缩放，让中低截屏数也有合理分数
      const densityScore = Math.min(100, Math.sqrt(hourContexts.length / densityBaseline) * 100)

      // 专注连续性分（0-100）：基于工作主题（前两个标签）判断切换
      let intentSwitches = 0
      for (let j = 1; j < hourContexts.length; j++) {
        if (extractIntentTopic(hourContexts[j].intent_tags) !== extractIntentTopic(hourContexts[j - 1].intent_tags)) {
          intentSwitches++
        }
      }
      const switchRate = hourContexts.length > 1 ? intentSwitches / (hourContexts.length - 1) : 0
      const focusScore = (1 - switchRate) * 100

      // 综合投入度 = 活跃密度 × 0.75 + 专注连续性 × 0.25
      const engagementScore = Math.round(densityScore * 0.75 + focusScore * 0.25)
      flowData.push(engagementScore)
    }
  } else {
    // 周报/月报模式：按天切分
    const days = Math.ceil(periodMs / oneDayMs)
    // 每天密度基准：200 * 10 小时 = 2000 条/天
    const densityBaselinePerDay = 2000
    flowData = []
    for (let d = 0; d < days; d++) {
      const dayStartMs = start + d * oneDayMs
      const dayEndMs = Math.min(dayStartMs + oneDayMs, end)

      const dayContexts = db
        .prepare('SELECT timestamp, intent_tags FROM contexts WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC')
        .all(dayStartMs, dayEndMs) as { timestamp: number; intent_tags: string }[]

      if (dayContexts.length === 0) {
        flowData.push(0)
        continue
      }

      const densityScore = Math.min(100, Math.sqrt(dayContexts.length / densityBaselinePerDay) * 100)

      let intentSwitches = 0
      for (let j = 1; j < dayContexts.length; j++) {
        if (extractIntentTopic(dayContexts[j].intent_tags) !== extractIntentTopic(dayContexts[j - 1].intent_tags)) {
          intentSwitches++
        }
      }
      const switchRate = dayContexts.length > 1 ? intentSwitches / (dayContexts.length - 1) : 0
      const focusScore = (1 - switchRate) * 100

      const engagementScore = Math.round(densityScore * 0.75 + focusScore * 0.25)
      flowData.push(engagementScore)
    }
  }

  return {
    total_count: totalContexts.count,
    tagged_count: taggedContexts.count,
    top_intents: topIntents,
    flow_data: flowData,
    context_switches: switches,
    active_minutes: activeMinutes,
    prev_active_minutes: prevActiveMinutes,
    prev_context_switches: prevSwitches
  }
}

// Summary 记录的 CRUD
export function saveSummary(
  timestamp: number,
  level: number,
  content: string,
  model: string
): void {
  if (!db) return
  db.prepare('INSERT INTO summaries (timestamp, level, content, model) VALUES (?, ?, ?, ?)').run(
    timestamp,
    level,
    content,
    model
  )
}

export function getSummariesSince(timestamp: number, level: number): unknown[] {
  if (!db) return []
  return db
    .prepare('SELECT * FROM summaries WHERE timestamp >= ? AND level = ? ORDER BY timestamp ASC')
    .all(timestamp, level)
}

export function getSummariesForDate(date: string, level: number): unknown[] {
  if (!db) return []
  const startOfDay = new Date(date).setHours(0, 0, 0, 0)
  const endOfDay = new Date(date).setHours(23, 59, 59, 999)
  return db
    .prepare('SELECT * FROM summaries WHERE timestamp >= ? AND timestamp <= ? AND level = ? ORDER BY timestamp DESC')
    .all(startOfDay, endOfDay, level)
}

export function getLastSummaryTimestamp(level: number): number {
  if (!db) return 0
  const result = db
    .prepare('SELECT MAX(timestamp) as last_ts FROM summaries WHERE level = ?')
    .get(level) as { last_ts: number }
  return result?.last_ts || 0
}

export function getLatestSummary(level: number): { content: string; timestamp: number } | null {
  if (!db) return null
  return db
    .prepare('SELECT content, timestamp FROM summaries WHERE level = ? ORDER BY timestamp DESC LIMIT 1')
    .get(level) as { content: string; timestamp: number } | undefined ?? null
}

export function getContextsSince(timestamp: number): unknown[] {
  if (!db) return []
  return db
    .prepare('SELECT id, timestamp, ai_summary, intent_tags FROM contexts WHERE timestamp >= ? ORDER BY timestamp ASC')
    .all(timestamp)
}

/**
 * 搜索 contexts 表中 ai_summary 包含指定关键词的记录
 * 用于主动扫描历史截图中的 OKR 内容
 * 按时间倒序返回，优先返回最近的匹配
 */
export function searchContextsByKeywords(keywords: string[], limit: number = 10): { id: number; timestamp: number; ai_summary: string; image_local_path: string }[] {
  if (!db || keywords.length === 0) return []
  const conditions = keywords.map(() => 'ai_summary LIKE ?').join(' OR ')
  const params = keywords.map(kw => `%${kw}%`)
  return db
    .prepare(`SELECT id, timestamp, ai_summary, image_local_path FROM contexts WHERE (${conditions}) AND image_local_path IS NOT NULL ORDER BY timestamp DESC LIMIT ?`)
    .all(...params, limit) as { id: number; timestamp: number; ai_summary: string; image_local_path: string }[]
}

/**
 * 搜索 slot_summaries 表中 summary 包含指定关键词的记录
 * slot_summaries 是 15 分钟的活动总结，比单张截图的 ai_summary 信息更丰富
 * 返回匹配的时间段起始时间戳，用于定位对应的截图
 */
export function searchSlotSummariesByKeywords(keywords: string[], limit: number = 10): { slot_start_ms: number; summary: string }[] {
  if (!db || keywords.length === 0) return []
  const conditions = keywords.map(() => 'summary LIKE ?').join(' OR ')
  const params = keywords.map(kw => `%${kw}%`)
  return db
    .prepare(`SELECT slot_start_ms, summary FROM slot_summaries WHERE (${conditions}) ORDER BY slot_start_ms DESC LIMIT ?`)
    .all(...params, limit) as { slot_start_ms: number; summary: string }[]
}

/**
 * 获取指定时间段内 ai_summary 包含关键词的截图记录
 * 用于从 slot_summaries 定位到的时间段中找到具体的 OKR 截图
 */
export function getContextsInRangeByKeywords(startMs: number, endMs: number, keywords: string[], limit: number = 5): { id: number; timestamp: number; ai_summary: string; image_local_path: string }[] {
  if (!db || keywords.length === 0) return []
  const conditions = keywords.map(() => 'ai_summary LIKE ?').join(' OR ')
  const params = keywords.map(kw => `%${kw}%`)
  return db
    .prepare(`SELECT id, timestamp, ai_summary, image_local_path FROM contexts WHERE timestamp >= ? AND timestamp < ? AND (${conditions}) AND image_local_path IS NOT NULL ORDER BY timestamp ASC LIMIT ?`)
    .all(startMs, endMs, ...params, limit) as { id: number; timestamp: number; ai_summary: string; image_local_path: string }[]
}

// 每日工作总结相关

/**
 * 获取指定日期的每日工作总结
 */
export function getDailyWorkSummary(date: string): { summary_text: string; updated_at: number } | undefined {
  if (!db) return undefined
  return db
    .prepare('SELECT summary_text, updated_at FROM daily_work_summary WHERE date = ?')
    .get(date) as { summary_text: string; updated_at: number } | undefined
}

/**
 * 插入或更新每日工作总结
 */
export function upsertDailyWorkSummary(date: string, summaryText: string): void {
  if (!db) return
  db.prepare(`
    INSERT INTO daily_work_summary (date, summary_text, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      summary_text = excluded.summary_text,
      updated_at = excluded.updated_at
  `).run(date, summaryText, Date.now())
}

// Token 相关
export function saveTokenUsage(tokens: number, model: string, type: string): void {
  if (!db) return
  db.prepare('INSERT INTO token_usage (timestamp, tokens, model, type) VALUES (?, ?, ?, ?)').run(
    Date.now(),
    tokens,
    model,
    type
  )
}

export function getMonthlyTokenUsage(): number {
  if (!db) return 0
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)

  const result = db
    .prepare('SELECT SUM(tokens) as total FROM token_usage WHERE timestamp >= ?')
    .get(startOfMonth.getTime()) as { total: number }
  return result.total || 0
}

// Slot Summary 相关（15分钟槽的 AI 归纳摘要）
export function upsertSlotSummary(slotStartMs: number, summary: string): void {
  if (!db) return
  // 使用本地时间格式化日期，避免 UTC 时区偏移
  const d = new Date(slotStartMs)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  db.prepare(`
    INSERT INTO slot_summaries (slot_start_ms, date, summary, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slot_start_ms) DO UPDATE SET
      summary = excluded.summary,
      updated_at = excluded.updated_at
  `).run(slotStartMs, date, summary, Date.now())
}

export function getSlotSummariesForDate(date: string): { slot_start_ms: number; summary: string; updated_at: number }[] {
  if (!db) return []
  return db
    .prepare('SELECT slot_start_ms, summary, updated_at FROM slot_summaries WHERE date = ? ORDER BY slot_start_ms DESC')
    .all(date) as { slot_start_ms: number; summary: string; updated_at: number }[]
}

export function getDistinctContextDates(): string[] {
  if (!db) return []
  const rows = db
    .prepare(`
      SELECT DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime') as date
      FROM contexts
      ORDER BY date DESC
    `)
    .all() as { date: string }[]
  return rows.map((row) => row.date)
}

/**
 * 删除所有非 JSON 格式的旧 slot_summaries 记录（summary 不以 '{' 开头），
 * 让后端定时任务重新用新 prompt 归纳生成 JSON 格式的 {title, description}。
 * 返回被删除的记录数。
 */
export function deleteNonJsonSlotSummaries(): number {
  if (!db) return 0
  const result = db.prepare(`DELETE FROM slot_summaries WHERE TRIM(summary) NOT LIKE '{%'`).run()
  return result.changes
}

// Model Pricing 相关
export function upsertModelPricing(modelName: string, inputPricePer1m: number, outputPricePer1m: number): void {
  if (!db) return
  db.prepare(`
    INSERT INTO model_pricing (model_name, input_price_per_1m, output_price_per_1m, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(model_name) DO UPDATE SET
      input_price_per_1m = excluded.input_price_per_1m,
      output_price_per_1m = excluded.output_price_per_1m,
      updated_at = excluded.updated_at
  `).run(modelName, inputPricePer1m, outputPricePer1m, Date.now())
}

export function getModelPricing(modelName: string): { input_price_per_1m: number; output_price_per_1m: number; updated_at: number } | null {
  if (!db) return null
  return db
    .prepare('SELECT input_price_per_1m, output_price_per_1m, updated_at FROM model_pricing WHERE model_name = ?')
    .get(modelName) as { input_price_per_1m: number; output_price_per_1m: number; updated_at: number } | null
}

// Insight Cache 相关（持久化洞察报告缓存）
export function upsertInsightCache(
  cycle: string,
  insightText: string,
  warningText: string | null
): void {
  if (!db) return
  db.prepare(`
    INSERT INTO insight_cache (cycle, insight_text, warning_text, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cycle) DO UPDATE SET
      insight_text = excluded.insight_text,
      warning_text = excluded.warning_text,
      updated_at = excluded.updated_at
  `).run(cycle, insightText, warningText, Date.now())
}

export function getInsightCache(cycle: string): { insight_text: string; warning_text: string | null; updated_at: number } | null {
  if (!db) return null
  return db
    .prepare('SELECT insight_text, warning_text, updated_at FROM insight_cache WHERE cycle = ?')
    .get(cycle) as { insight_text: string; warning_text: string | null; updated_at: number } | undefined ?? null
}

/**
 * 获取指定时间范围内的 slot_summaries（15分钟槽归纳）
 * 用于洞察报告生成
 */
export function getSlotSummariesInRange(startMs: number, endMs: number): { slot_start_ms: number; summary: string }[] {
  if (!db) return []
  return db
    .prepare('SELECT slot_start_ms, summary FROM slot_summaries WHERE slot_start_ms >= ? AND slot_start_ms < ? ORDER BY slot_start_ms ASC')
    .all(startMs, endMs) as { slot_start_ms: number; summary: string }[]
}

/**
 * 获取指定时间范围内的 contexts（截图识别记录）
 * 用于报告生成时补充详细的截图描述
 */
export function getContextsInRange(startMs: number, endMs: number): { id: number; timestamp: number; ai_summary: string; intent_tags: string }[] {
  if (!db) return []
  return db
    .prepare('SELECT id, timestamp, ai_summary, intent_tags FROM contexts WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC')
    .all(startMs, endMs) as { id: number; timestamp: number; ai_summary: string; intent_tags: string }[]
}

/**
 * 获取指定日期范围内的 backlog 任务（含已完成和未完成）
 * 用于报告生成时展示任务状态
 */
export function getBacklogInDateRange(startDate: string, endDate: string): unknown[] {
  if (!db) return []
  return db
    .prepare(`SELECT * FROM backlog WHERE is_hidden = 0 AND is_abandoned = 0 AND (task_date >= ? AND task_date <= ?) ORDER BY created_at DESC`)
    .all(startDate, endDate)
}

const CONTEXT_RETENTION_DAYS = 7
const SUMMARY_RETENTION_DAYS = 7
const TOKEN_USAGE_RETENTION_DAYS = 14
const SLOT_SUMMARY_RETENTION_DAYS = 7

/**
 * Auto-cleanup: remove data older than retention period to prevent database bloat.
 * Aggressive retention policy to prevent the 14 GB bloat seen in production:
 * - contexts: 7 days (generates ~3600 rows/day at 5s intervals)
 * - summaries: 7 days (6 tiers × hundreds of rows/day)
 * - token_usage: 14 days
 * - slot_summaries: 7 days
 * After cleanup, runs VACUUM to reclaim disk space.
 */
function cleanupOldData(): void {
  if (!db) return

  try {
    const contextsCutoff = Date.now() - CONTEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const summariesCutoff = Date.now() - SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const tokenCutoff = Date.now() - TOKEN_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const slotCutoffDate = new Date(Date.now() - SLOT_SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    const contextsDel = db.prepare('DELETE FROM contexts WHERE timestamp < ?').run(contextsCutoff)
    const summariesDel = db.prepare('DELETE FROM summaries WHERE timestamp < ?').run(summariesCutoff)
    const tokenDel = db.prepare('DELETE FROM token_usage WHERE timestamp < ?').run(tokenCutoff)
    const slotDel = db.prepare('DELETE FROM slot_summaries WHERE date < ?').run(slotCutoffDate)

    const totalDeleted = contextsDel.changes + summariesDel.changes + tokenDel.changes + slotDel.changes
    if (totalDeleted > 0) {
      console.log(`[DB] Auto-cleanup: removed ${contextsDel.changes} contexts, ${summariesDel.changes} summaries, ${tokenDel.changes} token_usage, ${slotDel.changes} slot_summaries`)
      // Reclaim disk space after large deletions
      db.exec('VACUUM')
      console.log('[DB] VACUUM completed — disk space reclaimed')
    }

    // Log database file size for monitoring
    logDatabaseSize()
  } catch (error) {
    console.error('[DB] Auto-cleanup failed:', error)
  }
}

/**
 * Log the current database file size for monitoring.
 * Warns if the database exceeds 500 MB.
 */
function logDatabaseSize(): void {
  try {
    const dbPath = db.pragma('database_list') as { file: string }[]
    if (dbPath.length > 0 && dbPath[0].file) {
      const stats = fs.statSync(dbPath[0].file)
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)
      console.log(`[DB] Database size: ${sizeMB} MB`)
      if (stats.size > 500 * 1024 * 1024) {
        console.warn(`[DB] ⚠️ Database size exceeds 500 MB (${sizeMB} MB). Consider reducing retention periods.`)
      }
    }
  } catch (error) {
    console.error('[DB] Failed to check database size:', error)
  }
}

// Daily Reports 相关（持久化日报）

export interface DailyReportRow {
  date: string
  insight_text: string
  warning_text: string | null
  generated_at: number
}

export function saveDailyReport(date: string, insightText: string, warningText?: string): void {
  if (!db) return
  db.prepare(`
    INSERT OR REPLACE INTO daily_reports (date, insight_text, warning_text, generated_at)
    VALUES (?, ?, ?, ?)
  `).run(date, insightText, warningText ?? null, Date.now())
  console.log(`[DB] Daily report saved for ${date}`)
}

export function getDailyReport(date: string): DailyReportRow | null {
  if (!db) return null
  const row = db
    .prepare('SELECT date, insight_text, warning_text, generated_at FROM daily_reports WHERE date = ?')
    .get(date) as DailyReportRow | undefined
  return row ?? null
}

export function getDailyReportDates(): string[] {
  if (!db) return []
  const rows = db
    .prepare('SELECT date FROM daily_reports ORDER BY date DESC')
    .all() as { date: string }[]
  return rows.map((row) => row.date)
}

// Scheduled Reports 相关（定时生成的日/周/月报告）

export interface ScheduledReportRow {
  report_type: string
  version: string
  date_range: string
  report_text: string
  generated_at: number
}

export function saveScheduledReport(
  reportType: string,
  version: string,
  dateRange: string,
  reportText: string
): void {
  if (!db) return
  db.prepare(`
    INSERT OR REPLACE INTO scheduled_reports (report_type, version, date_range, report_text, generated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(reportType, version, dateRange, reportText, Date.now())
  console.log(`[DB] Scheduled report saved: ${reportType}/${version} for ${dateRange}`)
}

export function getScheduledReport(
  reportType: string,
  version: string,
  dateRange: string
): ScheduledReportRow | null {
  if (!db) return null
  const row = db
    .prepare('SELECT * FROM scheduled_reports WHERE report_type = ? AND version = ? AND date_range = ?')
    .get(reportType, version, dateRange) as ScheduledReportRow | undefined
  return row ?? null
}

export function getScheduledReportsByType(reportType: string): ScheduledReportRow[] {
  if (!db) return []
  return db
    .prepare('SELECT * FROM scheduled_reports WHERE report_type = ? ORDER BY date_range DESC')
    .all(reportType) as ScheduledReportRow[]
}

export function getAllScheduledReports(): ScheduledReportRow[] {
  if (!db) return []
  return db
    .prepare('SELECT * FROM scheduled_reports ORDER BY generated_at DESC')
    .all() as ScheduledReportRow[]
}

/**
 * 获取所有有 AI 分析数据的历史日期（用于批量回溯生成报告）
 */
export function getContextDatesWithData(): string[] {
  if (!db) return []
  const rows = db.prepare(`
    SELECT DISTINCT date(timestamp / 1000, 'unixepoch', 'localtime') as day
    FROM contexts
    WHERE ai_summary IS NOT NULL AND ai_summary != ''
    ORDER BY day DESC
  `).all() as { day: string }[]
  return rows.map(r => r.day)
}
