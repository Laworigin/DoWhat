import Database from 'better-sqlite3'
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

    db = new Database(dbPath, { verbose: console.log })

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

      CREATE TABLE IF NOT EXISTS model_pricing (
        model_name TEXT PRIMARY KEY,
        input_price_per_1m REAL NOT NULL,  -- 每百万 input token 的美元价格
        output_price_per_1m REAL NOT NULL, -- 每百万 output token 的美元价格
        updated_at INTEGER NOT NULL
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

  const stmt = db.prepare(
    'SELECT * FROM contexts WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC'
  )
  return stmt.all(startOfDay, endOfDay)
}

// Backlog 相关
export function getBacklog(): unknown[] {
  if (!db) return []
  return db.prepare('SELECT * FROM backlog ORDER BY created_at DESC').all()
}

export function updateBacklogStatus(id: string, completed: boolean): void {
  if (!db) return
  db.prepare('UPDATE backlog SET completed = ? WHERE id = ?').run(completed ? 1 : 0, id)
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
 * 获取今日可见任务列表（task_date = 今天，非隐藏）
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
 * 跨日继承：将历史未完成任务复制到今天
 * 规则：completed=0 且 task_date != 今天 且 is_hidden=0 的任务，
 * 若今天尚无对应的继承记录（通过 origin_id 去重），则复制一条新记录到今天。
 * 返回继承的任务数量。
 */
export function inheritUnfinishedTasks(): number {
  if (!db) return 0

  const today = new Date().toISOString().split('T')[0]

  // 查询所有历史未完成任务（不属于今天的）
  const unfinishedHistoryTasks = db.prepare(`
    SELECT * FROM backlog
    WHERE completed = 0
      AND is_hidden = 0
      AND (task_date IS NULL OR task_date != ?)
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

  console.log(`[DB] inheritUnfinishedTasks: inherited ${inheritedCount} tasks to ${today}`)
  return inheritedCount
}

// 统计相关
export function getStatsSummary(
  start: number,
  end: number
): {
  total_count: number
  top_intents: unknown[]
  flow_data: number[]
  context_switches: number
} | null {
  if (!db) return null

  // 计算总截屏数量
  const totalContexts = db
    .prepare('SELECT COUNT(*) as count FROM contexts WHERE timestamp >= ? AND timestamp <= ?')
    .get(start, end) as { count: number }

  // 获取最常出现的意图分类
  const topIntents = db
    .prepare(
      `
    SELECT intent_tags, COUNT(*) as count
    FROM contexts
    WHERE timestamp >= ? AND timestamp <= ?
    GROUP BY intent_tags
    ORDER BY count DESC
    LIMIT 5
  `
    )
    .all(start, end)

  // 计算上下文切换次数 (意图标签发生变化)
  const contexts = db
    .prepare('SELECT intent_tags FROM contexts WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC')
    .all(start, end) as { intent_tags: string }[]

  let switches = 0
  for (let i = 1; i < contexts.length; i++) {
    if (contexts[i].intent_tags !== contexts[i - 1].intent_tags) {
      switches++
    }
  }

  // 获取时间序列数据 (按小时或天分组，这里简单按 12 个时间点切分)
  const interval = (end - start) / 12
  const flowData: number[] = []
  for (let i = 0; i < 12; i++) {
    const tStart = start + i * interval
    const tEnd = tStart + interval
    const count = db
      .prepare('SELECT COUNT(*) as count FROM contexts WHERE timestamp >= ? AND timestamp < ?')
      .get(tStart, tEnd) as { count: number }
    flowData.push(count.count)
  }

  return {
    total_count: totalContexts.count,
    top_intents: topIntents,
    flow_data: flowData,
    context_switches: switches
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
    .prepare('SELECT * FROM contexts WHERE timestamp >= ? ORDER BY timestamp ASC')
    .all(timestamp)
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
