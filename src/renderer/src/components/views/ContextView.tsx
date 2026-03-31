import React, { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Activity, Clock, PanelLeftClose, PanelLeftOpen, Layers, CheckCircle2, Circle, ChevronDown, ChevronUp, RefreshCcw, Plus, Pencil } from 'lucide-react'

// ─── BacklogItem 数据模型 ───────────────────────────────────────────────────
interface BacklogItem {
  id: string | number
  title: string
  category: string
  priority?: number
  completed: boolean
  created_at: string
  /** 任务所属日期，格式 YYYY-MM-DD，用于跨日继承后的展示过滤 */
  task_date?: string
  /** 指向最原始任务的 ID，跨日继承时用于去重追溯 */
  origin_id?: string | null
  description?: string
  subtasks?: { title: string; completed: boolean }[]
}



// ─── PipelineItem：单条任务卡片 ──────────────────────────────────────────────
interface PipelineItemProps {
  item: BacklogItem
  onToggle: (id: string, completed: boolean) => void
  onEdit?: (item: BacklogItem) => void
  variant?: 'focus' | 'today' | 'backlog'
  isPromoted?: boolean
}

const PipelineItem: React.FC<PipelineItemProps> = ({ item, onToggle, onEdit, variant = 'today', isPromoted }) => {
  const variantStyles = {
    focus: 'bg-red-500/8 border-red-500/25 hover:border-red-500/50',
    today: 'bg-indigo-500/5 border-indigo-500/20 hover:border-indigo-500/40 hover:bg-indigo-500/8',
    backlog: 'bg-white/[0.02] border-white/8 hover:border-white/15'
  }

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData('application/task-id', String(item.id))
    event.dataTransfer.setData('application/task-category', item.category)
    event.dataTransfer.setData('application/task-priority', String(item.priority ?? 3))
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable={!item.completed}
      onDragStart={handleDragStart}
      className={`
        group p-3 rounded-xl border transition-all duration-300 relative overflow-hidden
        ${!item.completed ? 'cursor-grab active:cursor-grabbing' : ''}
        ${item.completed ? 'bg-white/[0.02] border-white/5 opacity-50' : variantStyles[variant]}
      `}
    >
      {/* 优先级角标 */}
      {item.priority && !item.completed && (
        <div className={`absolute top-0 right-0 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-tighter rounded-bl-lg ${
          item.priority === 1 ? 'bg-red-500/80 text-white' :
          item.priority === 2 ? 'bg-orange-500/80 text-white' : 'bg-blue-500/80 text-white'
        }`}>
          P{item.priority}
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-1">
        <p className={`text-[12px] leading-snug flex-1 ${item.completed ? 'text-gray-500 line-through' : 'text-white'}`}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {!item.completed && onEdit && (
            <button
              onClick={() => onEdit(item)}
              className="mt-0.5 text-gray-600 hover:text-blue-400 transition-colors"
              title="编辑任务"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onToggle(String(item.id), !item.completed)}
            className={`mt-0.5 transition-colors ${item.completed ? 'text-green-500' : 'text-gray-600 hover:text-indigo-400'}`}
          >
            {item.completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 任务描述 */}
      {item.description && !item.completed && (
        <p className="text-[10px] leading-relaxed text-gray-400 mb-1.5 line-clamp-2">
          {item.description}
        </p>
      )}

      {/* AI 推荐徽章 */}
      {isPromoted && !item.completed && (
        <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-[8px] font-bold text-violet-400 uppercase tracking-wider">
          ✦ AI 推荐
        </span>
      )}

      <div className="flex items-center justify-between mt-1">
        <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold ${item.completed ? 'bg-white/5 text-gray-500 border border-white/5' : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'}`}>
          {item.category.toUpperCase()}
        </span>
        <span className="text-[10px] text-gray-600 font-mono">
          {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ─── SectionHeader：可折叠区块标题（提取到外部避免 react-hooks/static-components 错误）───
interface SectionHeaderProps {
  label: string
  count: number
  dotColor: string
  collapsed: boolean
  onToggleCollapse: () => void
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ label, count, dotColor, collapsed, onToggleCollapse }) => (
  <button
    onClick={onToggleCollapse}
    className="w-full flex items-center gap-2 mb-2 group hover:opacity-80 transition-opacity"
  >
    <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
    <span className="text-[9px] font-black tracking-[0.2em] text-gray-500">{label}</span>
    <span className="text-[9px] font-black text-gray-600">{count}</span>
    <span className="ml-auto text-gray-600 group-hover:text-gray-400 transition-colors">
      {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
    </span>
  </button>
)

// ─── PipelinePanel：四区分层面板（最高优先级 / 日常任务 / 待处理 / 已完成）───
interface PipelinePanelProps {
  backlog: BacklogItem[]
  slotSummaries: Map<number, string>
  onToggle: (id: string, completed: boolean) => void
  onRefresh: () => void
}

const PipelinePanel: React.FC<PipelinePanelProps> = ({ backlog, slotSummaries, onToggle, onRefresh }) => {
  const [isHighPriorityCollapsed, setIsHighPriorityCollapsed] = useState(false)
  const [isDailyCollapsed, setIsDailyCollapsed] = useState(false)
  const [isBacklogCollapsed, setIsBacklogCollapsed] = useState(false)
  const [isCompletedCollapsed, setIsCompletedCollapsed] = useState(true)
  const [isBacklogExpanded, setIsBacklogExpanded] = useState(false)
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [showEditTaskDialog, setShowEditTaskDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<BacklogItem | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskDescription, setEditTaskDescription] = useState('')
  const [dragOverZone, setDragOverZone] = useState<string | null>(null)

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnter = (zone: string) => (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOverZone(zone)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    const relatedTarget = event.relatedTarget as Node | null
    if (!event.currentTarget.contains(relatedTarget)) {
      setDragOverZone(null)
    }
  }

  const handleDrop = (targetZone: string) => async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDragOverZone(null)

    const taskId = event.dataTransfer.getData('application/task-id')
    if (!taskId) return

    let newCategory: string
    let newPriority: number

    switch (targetZone) {
      case 'high-priority':
        newCategory = event.dataTransfer.getData('application/task-category') || 'backlog'
        newPriority = 1
        break
      case 'daily':
        newCategory = 'day'
        newPriority = 3
        break
      case 'backlog':
        newCategory = 'backlog'
        newPriority = 3
        break
      default:
        return
    }

    await window.api.reclassifyTask(taskId, newCategory, newPriority)
    await onRefresh()
  }

  const dropZoneHighlight = (zone: string): string =>
    dragOverZone === zone ? 'ring-2 ring-offset-1 ring-offset-transparent rounded-xl transition-all duration-200' : ''

  const dropZoneRingColor: Record<string, string> = {
    'high-priority': 'ring-red-500/60',
    daily: 'ring-indigo-500/60',
    backlog: 'ring-amber-500/60'
  }

  const handleAddTask = async (): Promise<void> => {
    if (!newTaskTitle.trim()) return

    await window.api.addManualTask(newTaskTitle.trim(), newTaskDescription.trim() || undefined)
    setShowAddTaskDialog(false)
    setNewTaskTitle('')
    setNewTaskDescription('')
    await onRefresh()
  }

  const handleEditTask = (item: BacklogItem): void => {
    setEditingTask(item)
    setEditTaskTitle(item.title)
    setEditTaskDescription(item.description || '')
    setShowEditTaskDialog(true)
  }

  const handleUpdateTask = async (): Promise<void> => {
    if (!editingTask || !editTaskTitle.trim()) return

    await window.api.updateTask(
      String(editingTask.id),
      editTaskTitle.trim(),
      editTaskDescription.trim() || undefined
    )
    setShowEditTaskDialog(false)
    setEditingTask(null)
    setEditTaskTitle('')
    setEditTaskDescription('')
    await onRefresh()
  }

  const activeTasks = backlog.filter((item) => !item.completed)
  const completedTasks = backlog.filter((item) => item.completed)

  // 最高优先级：priority === 1，按创建时间倒序
  const highPriorityTasks = activeTasks
    .filter((item) => item.priority === 1)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // 日常任务：category === 'day' 且非最高优先级，按优先级排序
  const dailyTasks = activeTasks
    .filter((item) => item.category === 'day' && item.priority !== 1)
    .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))

  // 待处理：category 为 'backlog'/'week'/'month' 且非最高优先级，按优先级+时间排序
  const backlogCategories = new Set(['backlog', 'week', 'month'])
  const backlogTasks = activeTasks
    .filter((item) => backlogCategories.has(item.category?.toLowerCase() ?? '') && item.priority !== 1)
    .sort((a, b) => {
      const priorityDiff = (a.priority ?? 3) - (b.priority ?? 3)
      if (priorityDiff !== 0) return priorityDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const visibleBacklogTasks = isBacklogExpanded ? backlogTasks : backlogTasks.slice(0, 5)

  return (
    <div className="space-y-4">
      {/* ── 最高优先级 ── */}
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter('high-priority')}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop('high-priority')}
        className={`p-2 -m-2 ${dropZoneHighlight('high-priority')} ${dropZoneRingColor['high-priority'] ?? ''}`}
      >
        <SectionHeader
          label="🔥 最高优先级"
          count={highPriorityTasks.length}
          dotColor="bg-red-500"
          collapsed={isHighPriorityCollapsed}
          onToggleCollapse={() => setIsHighPriorityCollapsed((prev) => !prev)}
        />
        {!isHighPriorityCollapsed && (
          <div className="space-y-2">
            {highPriorityTasks.map((item) => (
              <PipelineItem key={item.id} item={item} onToggle={onToggle} onEdit={handleEditTask} variant="focus" />
            ))}
            {highPriorityTasks.length === 0 && dragOverZone !== 'high-priority' && (
              <div className="py-3 text-center border border-dashed border-white/5 rounded-xl">
                <p className="text-[10px] text-gray-600 font-bold tracking-widest">
                  拖拽任务到此处设为最高优先级
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 日常任务 ── */}
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter('daily')}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop('daily')}
        className={`p-2 -m-2 ${dropZoneHighlight('daily')} ${dropZoneRingColor['daily'] ?? ''}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <SectionHeader
            label="📋 日常任务"
            count={dailyTasks.length}
            dotColor="bg-indigo-500"
            collapsed={isDailyCollapsed}
            onToggleCollapse={() => setIsDailyCollapsed((prev) => !prev)}
          />
          <button
            onClick={() => setShowAddTaskDialog(true)}
            className="p-1 hover:bg-white/10 rounded-lg text-gray-500 hover:text-indigo-400 transition-colors"
            title="添加任务"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {!isDailyCollapsed && (
          <div className="space-y-2">
            {dailyTasks.map((item) => (
              <PipelineItem key={item.id} item={item} onToggle={onToggle} onEdit={handleEditTask} variant="today" />
            ))}
            {dailyTasks.length === 0 && (
              <div className="py-6 text-center border border-dashed border-white/5 rounded-xl">
                <p className="text-[10px] text-gray-600 font-bold tracking-widest">
                  暂无日常任务
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 待处理 ── */}
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter('backlog')}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop('backlog')}
        className={`p-2 -m-2 ${dropZoneHighlight('backlog')} ${dropZoneRingColor['backlog'] ?? ''}`}
      >
        <SectionHeader
          label="📥 待处理"
          count={backlogTasks.length}
          dotColor="bg-amber-500"
          collapsed={isBacklogCollapsed}
          onToggleCollapse={() => setIsBacklogCollapsed((prev) => !prev)}
        />
        {!isBacklogCollapsed && (
          <>
            <div className="space-y-2">
              {visibleBacklogTasks.map((item) => (
                <PipelineItem key={item.id} item={item} onToggle={onToggle} onEdit={handleEditTask} variant="backlog" />
              ))}
              {backlogTasks.length === 0 && (
                <div className="py-3 text-center border border-dashed border-white/5 rounded-xl">
                  <p className="text-[10px] text-gray-600 font-bold tracking-widest">
                    暂无待处理任务
                  </p>
                </div>
              )}
            </div>
            {backlogTasks.length > 5 && (
              <button
                onClick={() => setIsBacklogExpanded((prev) => !prev)}
                className="mt-2 w-full py-1.5 flex items-center justify-center gap-1.5 text-[9px] font-black text-gray-500 hover:text-gray-300 tracking-widest transition-colors"
              >
                {isBacklogExpanded ? (
                  <><ChevronUp className="w-3 h-3" /> 收起</>
                ) : (
                  <><ChevronDown className="w-3 h-3" /> 查看全部 {backlogTasks.length} 条</>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 已完成 ── */}
      {(() => {
        // 从 slotSummaries 提取去重的已完成事项
        const completedActivities: { title: string; description: string; time: string }[] = []
        const seenTitles = new Set<string>()
        const sortedSlots = Array.from(slotSummaries.entries()).sort((a, b) => a[0] - b[0])
        for (const [slotMs, summaryJson] of sortedSlots) {
          try {
            const parsed = JSON.parse(summaryJson)
            const title = parsed.title || ''
            if (title && !seenTitles.has(title)) {
              seenTitles.add(title)
              const slotTime = new Date(slotMs)
              const timeStr = `${String(slotTime.getHours()).padStart(2, '0')}:${String(slotTime.getMinutes()).padStart(2, '0')}`
              completedActivities.push({ title, description: parsed.description || '', time: timeStr })
            }
          } catch { /* skip non-JSON */ }
        }
        const totalCompleted = completedTasks.length + completedActivities.length

        return (
          <div className="pt-2 border-t border-white/5">
            <SectionHeader
              label="✅ 已完成"
              count={totalCompleted}
              dotColor="bg-green-500"
              collapsed={isCompletedCollapsed}
              onToggleCollapse={() => setIsCompletedCollapsed((prev) => !prev)}
            />
            {!isCompletedCollapsed && (
              <div className="space-y-1.5">
                {/* 手动标记完成的 backlog 任务 */}
                {completedTasks.map((item) => (
                  <PipelineItem key={item.id} item={item} onToggle={onToggle} onEdit={handleEditTask} variant="today" />
                ))}
                {/* AI 识别的已完成活动 */}
                {completedActivities.map((activity, index) => (
                  <div key={`activity-${index}`} className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-green-500 text-[10px]">✓</span>
                        <span className="text-[12px] text-gray-400 font-medium truncate">{activity.title}</span>
                      </div>
                      <span className="text-[10px] text-gray-600 font-mono shrink-0 ml-2">{activity.time}</span>
                    </div>
                    {activity.description && (
                      <p className="text-[10px] text-gray-600 mt-1 ml-5 line-clamp-1">{activity.description}</p>
                    )}
                  </div>
                ))}
                {totalCompleted === 0 && (
                  <div className="py-6 text-center border border-dashed border-white/5 rounded-xl">
                    <p className="text-[10px] text-gray-600 font-bold tracking-widest">
                      今日暂无已完成任务
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {backlog.length === 0 && (
        <div className="py-10 text-center border-2 border-dashed border-white/5 rounded-2xl">
          <p className="text-[11px] text-gray-500 font-bold tracking-widest italic">
            等待 AI 发现第一个任务...
          </p>
        </div>
      )}

      {/* ── 添加任务对话框 ── */}
      {showAddTaskDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="w-[320px] bg-gray-900/95 border border-white/20 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
            <h3 className="text-[13px] font-black text-white tracking-tight mb-4">
              添加新任务
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 mb-1.5">
                  任务标题 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="输入任务标题..."
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 mb-1.5">
                  任务描述 <span className="text-gray-600">(可选)</span>
                </label>
                <textarea
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  placeholder="输入任务描述..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowAddTaskDialog(false)
                    setNewTaskTitle('')
                    setNewTaskDescription('')
                  }}
                  className="flex-1 py-2 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold text-gray-400 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleAddTask}
                  disabled={!newTaskTitle.trim()}
                  className="flex-1 py-2 px-3 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-lg text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  确认添加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 编辑任务对话框 ── */}
      {showEditTaskDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="w-[320px] bg-gray-900/95 border border-white/20 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
            <h3 className="text-[13px] font-black text-white tracking-tight mb-4">
              编辑任务
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 mb-1.5">
                  任务标题 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={editTaskTitle}
                  onChange={(e) => setEditTaskTitle(e.target.value)}
                  placeholder="输入任务标题..."
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 mb-1.5">
                  任务描述 <span className="text-gray-600">(可选)</span>
                </label>
                <textarea
                  value={editTaskDescription}
                  onChange={(e) => setEditTaskDescription(e.target.value)}
                  placeholder="输入任务描述..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowEditTaskDialog(false)
                    setEditingTask(null)
                    setEditTaskTitle('')
                    setEditTaskDescription('')
                  }}
                  className="flex-1 py-2 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold text-gray-400 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleUpdateTask}
                  disabled={!editTaskTitle.trim()}
                  className="flex-1 py-2 px-3 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-lg text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  确认修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TaskTag ──────────────────────────────────────────────────────────────────
interface TaskTagProps {
  label: string
  type?: 'orange' | 'gray' | 'purple' | 'green'
}

const TaskTag: React.FC<TaskTagProps> = ({ label, type = 'gray' }) => {
  const styles = {
    orange: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    green: 'bg-green-500/10 text-green-400 border border-green-500/20',
    gray: 'bg-white/5 text-gray-500 border border-white/5'
  }

  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold ${styles[type]}`}>{label}</span>
  )
}

// ... (ContextCard 组件保持原样，但增加对本地路径的处理)
interface ContextCardProps {
  time: string
  summary: string
  screenshotUrl: string
  compact?: boolean
}

const ContextCard: React.FC<ContextCardProps> = ({ time, summary, screenshotUrl, compact = false }) => {
  // 使用 encodeURI 保留路径分隔符，同时处理空格等特殊字符
  // 注意：需要处理 Windows 反斜杠的情况，统一转换为正斜杠
  const normalizedPath = screenshotUrl.replace(/\\/g, '/')
  const safeUrl = `local-file://${normalizedPath}`

  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (compact) {
    return (
      <>
        {/* Thumbnail */}
        <div
          className="relative aspect-[16/10] bg-white/5 rounded-lg border border-white/5 overflow-visible group cursor-pointer hover:z-[60]"
          title={`${time}`}
          onClick={() => setLightboxOpen(true)}
        >
          {/* 实际图片层：hover 时 scale 放大，z-index 提高 */}
          <div
            className="absolute inset-0 rounded-lg overflow-hidden bg-cover bg-center grayscale-[0.3]
                        group-hover:grayscale-0 group-hover:scale-[2.8] group-hover:z-[60]
                        transition-all duration-200 ease-out origin-center shadow-none group-hover:shadow-2xl group-hover:ring-2 group-hover:ring-indigo-400/60"
            style={{ backgroundImage: `url("${safeUrl}")` }}
          />
        </div>

        {/* Lightbox */}
        {lightboxOpen && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <div
              className="relative max-w-[90vw] max-h-[90vh] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10"
            >
              <img
                src={safeUrl}
                alt={summary}
                className="block max-w-[90vw] max-h-[85vh] object-contain"
              />
              {/* Caption */}
              <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-xs text-white/90 font-medium leading-snug">{summary}</p>
                <span className="text-[10px] text-gray-400 font-mono">{time}</span>
              </div>
              {/* Close button */}
              <button
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur flex items-center justify-center text-white/70 hover:text-white transition-all"
                onClick={() => setLightboxOpen(false)}
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="bg-white/5 rounded-xl border border-white/5 overflow-hidden group transition-all duration-300 hover:border-white/10 hover:bg-white/8 shadow-sm">
      <div
        className="aspect-[16/10] bg-cover bg-center grayscale-[0.2] group-hover:grayscale-0 transition-all duration-500"
        style={{ backgroundImage: `url("${safeUrl}")` }}
      ></div>
      <div className="p-2.5">
        <p className="text-[11px] font-bold text-white/80 mb-0.5 truncate tracking-tight">
          {summary}
        </p>
        <div className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5 text-gray-600" />
          <span className="text-[9px] text-gray-600 font-black uppercase tracking-widest">
            {time}
          </span>
        </div>
      </div>
    </div>
  )
}

interface ContextItem {
  id?: number
  timestamp: number
  image_local_path: string
  ai_summary: string
  intent_tags: string[]
  is_productive?: boolean
}

// 聚合后的 Context 组
interface ContextGroup {
  key: string
  summary: string
  description?: string
  tags?: string[]
  items: ContextItem[]
  startTime: number
  endTime: number
}

/**
 * 从 ai_summary 中提取标题（单行展示）
 * - JSON 格式：取 title 字段
 * - 纯文本：取第一个分隔符前的内容，最多 20 字
 */
const parseSummaryText = (text: string): string => {
  if (!text) return 'Unknown Activity'
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed)
      return data.title || data.content || data.intent || text
    } catch {
      const titleMatch = trimmed.match(/"title"\s*:\s*"([^"]+)"/)
      if (titleMatch) return titleMatch[1]
      return text
    }
  }
  const separatorMatch = trimmed.match(/^(.{1,20})[，,。.；;：:]/)
  if (separatorMatch) return separatorMatch[1]
  return trimmed.length > 20 ? trimmed.slice(0, 20) : trimmed
}

/**
 * 从 ai_summary 中提取详细描述
 * - JSON 格式：取 intent 字段
 * - 纯文本：直接返回完整原文
 */
const parseIntentDescription = (text: string): string => {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed)
      return data.intent || ''
    } catch {
      const intentMatch = trimmed.match(/"intent"\s*:\s*"([^"]+)"/)
      if (intentMatch) return intentMatch[1]
      return ''
    }
  }
  return trimmed
}

// ─── 模块级时间格式化工具函数 ────────────────────────────────────────────────

const formatTime = (ts: number): string => {
  const date = new Date(ts)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

const formatDuration = (start: number, end: number): string => {
  const diff = Math.abs(start - end)
  const minutes = Math.floor(diff / 1000 / 60)
  if (minutes < 1) return '< 1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

// ─── ContextGroupCard：单个快照分组卡片（可折叠）────────────────────────────

interface ContextGroupCardProps {
  group: ContextGroup
  isExpanded: boolean
  onToggle: (key: string) => void
}

function ContextGroupCard({ group, isExpanded, onToggle }: ContextGroupCardProps): React.ReactElement {
  const handleToggle = (): void => onToggle(group.key)
  const firstItem = group.items[group.items.length - 1]
  const lastItem = group.items[0]

  // 每行约显示 12 列（lg 断点），两行预览约 24 张
  const PREVIEW_COUNT = 24
  const hasMore = group.items.length > PREVIEW_COUNT
  const visibleItems = isExpanded ? group.items : group.items.slice(0, PREVIEW_COUNT)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 bg-white/[0.02] rounded-xl border border-white/5 hover:bg-white/[0.04] transition-colors relative overflow-hidden">
      {/* 标题行 */}
      <div
        className="flex items-start justify-between p-3 gap-3 cursor-pointer select-none"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-black text-gray-200 tracking-tight leading-none mb-1 truncate">
              {parseSummaryText(group.summary)}
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
              <span>{formatTime(firstItem.timestamp)} - {formatTime(lastItem.timestamp)}</span>
              <span>•</span>
              <span>{formatDuration(group.startTime, firstItem.timestamp)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-black text-gray-600 bg-black/20 px-2.5 py-1 rounded-md uppercase tracking-widest border border-white/5 whitespace-nowrap">
            {group.items.length} Snapshots
          </span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
          )}
        </div>
      </div>

      {/* 描述区域：始终显示在标题下方 */}
      {group.description && (
        <div className="px-3 pb-2">
          <p className="text-[12px] text-gray-400 leading-relaxed font-medium bg-white/[0.03] px-3 py-2 rounded-lg border border-white/5 border-l-2 border-l-indigo-500/40 animate-in fade-in slide-in-from-top-1 duration-200">
            {group.description}
          </p>
        </div>
      )}

      {/* 截图区域：默认展示前两行，展开后显示全部 */}
      <div className="px-3 pb-3">
        {isExpanded && group.tags && group.tags.length > 0 && (
          <div className="flex gap-1.5 mb-2.5 flex-wrap">
            {group.tags.map((tag, tagIndex) => (
              <TaskTag key={tagIndex} label={tag} type="gray" />
            ))}
          </div>
        )}
        <div className="grid grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-14 gap-1.5">
          {visibleItems.map((item) => (
            <ContextCard
              key={`${item.timestamp}-${item.id}`}
              time={formatTime(item.timestamp)}
              summary={item.ai_summary}
              screenshotUrl={item.image_local_path}
              compact={true}
            />
          ))}
        </div>

        {/* 未展开且有更多截图时，显示"查看全部"按钮 */}
        {!isExpanded && hasMore && (
          <button
            onClick={handleToggle}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-black text-gray-600 hover:text-gray-400 uppercase tracking-widest transition-colors"
          >
            <ChevronDown className="w-3 h-3" />
            查看全部 {group.items.length} 张截图
          </button>
        )}

        {/* 已展开时，显示"收起"按钮 */}
        {isExpanded && hasMore && (
          <button
            onClick={handleToggle}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-black text-gray-600 hover:text-gray-400 uppercase tracking-widest transition-colors"
          >
            <ChevronUp className="w-3 h-3" />
            收起
          </button>
        )}
      </div>
    </div>
  )
}

// 简单的 Timeline 组件
const Timeline: React.FC<{ contexts: ContextItem[] }> = ({ contexts }) => {
  if (contexts.length === 0) return null

  // 计算时间范围（从最早到最晚，或者固定 00:00 - 24:00）
  // 这里我们固定展示当天 08:00 到 24:00 或者是数据覆盖的范围
  // 为了简单直观，我们把一天分成 1440 分钟，绘制有数据的部分

  // 简单的可视化：将一天划分为 96 个格子 (每 15 分钟一个)
  const timeSlots = new Array(96).fill(0).map((_, i) => ({
    time: i * 15, // minutes from 00:00
    count: 0,
    hasProductive: false,
    hasUnproductive: false
  }))

  contexts.forEach(ctx => {
    const date = new Date(ctx.timestamp)
    const minutes = date.getHours() * 60 + date.getMinutes()
    const slotIndex = Math.floor(minutes / 15)
    if (slotIndex >= 0 && slotIndex < 96) {
      timeSlots[slotIndex].count++
      // 这里假设 intent_tags 或者其他字段能判断 productive，暂时只用 count
    }
  })

  // 找到第一个和最后一个有数据的索引，用于缩放视图（可选），这里先全量展示但高亮有数据区域

  return (
    <div className="w-full bg-white/5 rounded-xl border border-white/5 p-4 mb-8">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
          ACTIVITY TIMELINE (24H)
        </span>
        <div className="flex gap-3">
           <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-orange-500/50"></div>
              <span className="text-[9px] text-gray-500 font-bold">Active</span>
           </div>
        </div>
      </div>

      <div className="relative h-8 flex items-end gap-[1px]">
        {timeSlots.map((slot, i) => {
          const height = Math.min(100, slot.count * 20) // Max height cap
          const isActive = slot.count > 0

          return (
            <div
              key={i}
              className={`flex-1 rounded-t-sm transition-all duration-300 ${isActive ? 'bg-orange-500' : 'bg-white/10'}`}
              style={{
                height: isActive ? `${Math.max(20, height)}%` : '4px',
                opacity: isActive ? 0.8 : 0.1
              }}
              title={`${Math.floor(slot.time / 60).toString().padStart(2, '0')}:${(slot.time % 60).toString().padStart(2, '0')} - ${slot.count} snapshots`}
            ></div>
          )
        })}
      </div>
      <div className="flex justify-between mt-2 text-[9px] text-gray-600 font-mono">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>
  )
}

export const ContextView: React.FC = () => {
  // 确保始终使用今天的日期（去除时分秒，只保留年月日）
  const getTodayDate = (): Date => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return now
  }

  const [currentDate, setCurrentDate] = useState(getTodayDate())
  const [contexts, setContexts] = useState<ContextItem[]>([])
  const [groupedContexts, setGroupedContexts] = useState<ContextGroup[]>([])
  const [currentIntent, setCurrentIntent] = useState<ContextItem | null>(null)
  const [backlog, setBacklog] = useState<BacklogItem[]>([])

  const [stageSummary, setStageSummary] = useState<string>('')
  const [allSummaries, setAllSummaries] = useState<{ timestamp: number; content: string }[]>([])
  const [isPipelineOpen, setIsPipelineOpen] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // slot_summaries：key 为槽起始时间戳（ms），value 为 AI 归纳摘要
  const [slotSummaries, setSlotSummaries] = useState<Map<number, string>>(new Map())

  // 注意：不再强制切换到今天，允许用户自由查看历史数据
  // 如果需要在跨日时自动切换，可以在这里添加逻辑，但要注意不要影响用户手动切换日期的功能

  // 从数据库加载当天所有槽摘要
  const loadSlotSummaries = async (): Promise<void> => {
    // 使用本地时间格式化日期，避免 UTC 时区偏移（与 loadContexts 保持一致）
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const data = await window.api.getSlotSummaries(dateStr)
    const summaryMap = new Map<number, string>()
    data.forEach((row) => {
      summaryMap.set(row.slot_start_ms, row.summary)
    })
    setSlotSummaries(summaryMap)
  }

  const toggleGroup = (key: string): void => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 加载 Context 数据
  const loadContexts = async (): Promise<void> => {
    // 使用本地时间格式化日期，避免 UTC 时区偏移问题
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const data = (await window.api.getContexts(dateStr)) as ContextItem[]

    const parsedData = data.map((item) => ({
      ...item,
      intent_tags:
        typeof item.intent_tags === 'string' ? JSON.parse(item.intent_tags) : item.intent_tags
    }))

    setContexts(parsedData)
    if (parsedData.length > 0) {
      setCurrentIntent(parsedData[0]) // 最新的一个作为当前意图
    }
  }

  // 加载任务数据
  const loadBacklog = async (): Promise<void> => {
    try {
      const data = await window.api.getVisibleBacklog()
      setBacklog(data || [])
    } catch (err) {
      console.error('[ContextView] loadBacklog failed:', err)
    }
  }

  // 每 5 分钟定时刷新 backlog
  useEffect(() => {
    const FIVE_MINUTES_MS = 5 * 60 * 1000
    const intervalId = setInterval(async () => {
      try {
        const latestBacklog = (await window.api.getVisibleBacklog()) as BacklogItem[]
        setBacklog(latestBacklog || [])
      } catch (err) {
        console.error('[ContextView] 定时刷新 backlog 失败:', err)
      }
    }, FIVE_MINUTES_MS)

    return () => clearInterval(intervalId)
  }, [])

  // 加载最新阶段总结
  const loadStageSummary = async (): Promise<void> => {
    const summary = await window.api.getLatestSummary(1) // 1-minute level
    if (summary) setStageSummary(summary.content)
  }

  // 加载聚合总结列表 (5分钟级别)
  const loadSummaries = async (): Promise<void> => {
    // 使用本地时间格式化日期，避免 UTC 时区偏移
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`
    const data = await window.api.getSummariesForDate(dateStr, 5)
    setAllSummaries(data)
  }

  useEffect(() => {
    let isMounted = true
    const fetchData = async (): Promise<void> => {
      await Promise.all([loadContexts(), loadBacklog(), loadStageSummary(), loadSummaries(), loadSlotSummaries()])
    }

    if (isMounted) {
      fetchData()
    }

    // 每10秒轮询一次槽摘要（主进程后台每10秒归纳写入 DB，前端同步读取）
    const slotSummaryPollingId = setInterval(() => {
      loadSlotSummaries()
    }, 10 * 1000)

    // 监听新 Context 推送
    const unsubscribeNew = window.electron.ipcRenderer.on(
      'new-context-saved',
      (_event, newContext: ContextItem) => {
        if (!newContext) return
        const parsedContext = {
          ...newContext,
          intent_tags:
            typeof newContext.intent_tags === 'string'
              ? JSON.parse(newContext.intent_tags)
              : newContext.intent_tags ?? []
        }
        setContexts((prev) => [parsedContext, ...prev])
        setCurrentIntent(parsedContext)
        loadStageSummary() // 实时刷新总结标题
      }
    )

    // 监听任务更新
    const unsubscribeBacklog = window.electron.ipcRenderer.on('backlog-updated', () => {
      loadBacklog()
    })

    return (): void => {
      isMounted = false
      clearInterval(slotSummaryPollingId)
      unsubscribeNew()
      unsubscribeBacklog()
    }
  }, [currentDate])

  // 按固定 15 分钟时间槽聚合，摘要直接从 slotSummaries（DB 读取）匹配，无需异步 AI 调用
  useEffect(() => {
    if (contexts.length === 0) {
      setGroupedContexts([])
      return
    }

    // 将每个 context 归入对应的 15 分钟槽（以槽的起始时间戳为 key）
    const slotMap = new Map<number, ContextItem[]>()
    contexts.forEach((item) => {
      const slotStartMs = Math.floor(item.timestamp / (15 * 60 * 1000)) * (15 * 60 * 1000)
      const existing = slotMap.get(slotStartMs) ?? []
      existing.push(item)
      slotMap.set(slotStartMs, existing)
    })

    // 按时间倒序排列各槽（最新的在前）
    const sortedSlotKeys = Array.from(slotMap.keys()).sort((a, b) => b - a)

    const groups: ContextGroup[] = sortedSlotKeys.map((slotStartMs) => {
      const slotItems = slotMap.get(slotStartMs)!
      const sortedItems = [...slotItems].sort((a, b) => b.timestamp - a.timestamp)
      const timestamps = sortedItems.map((i) => i.timestamp)
      const slotEndMs = slotStartMs + 15 * 60 * 1000 - 1
      const slotDate = new Date(slotStartMs)
      const hh = slotDate.getHours().toString().padStart(2, '0')
      const mm = slotDate.getMinutes().toString().padStart(2, '0')

      // 优先从 DB 读取的 slotSummaries 中匹配摘要，尝试解析 JSON 格式
      const dbRaw = slotSummaries.get(slotStartMs)
      let slotTitle = ''
      let slotDescription = ''

      if (dbRaw) {
        const trimmed = dbRaw.trim()
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed)
            slotTitle = parsed.title?.trim() || ''
            slotDescription = parsed.description?.trim() || ''
          } catch {
            slotTitle = trimmed
          }
        } else {
          slotTitle = trimmed
        }
      }

      // DB 无摘要时，从截图的 ai_summary 中聚合出更有意义的标题和描述
      if (!slotTitle) {
        // 收集所有不重复的 ai_summary 原文（去重、过滤空值）
        const uniqueSummaries: string[] = []
        const seenSummaries = new Set<string>()
        slotItems.forEach((item) => {
          const raw = (item.ai_summary || '').trim()
          if (raw && raw !== 'Unknown Activity' && !seenSummaries.has(raw)) {
            seenSummaries.add(raw)
            uniqueSummaries.push(raw)
          }
        })

        // 提取应用名频率，用于标题
        const appFrequency = new Map<string, number>()
        slotItems.forEach((item) => {
          const text = parseSummaryText(item.ai_summary || '')
          if (text && text !== 'Unknown Activity') {
            appFrequency.set(text, (appFrequency.get(text) ?? 0) + 1)
          }
        })

        // 标题：用频率最高的应用名 + "使用中"，表示正在归纳
        let topApp = ''
        let maxCount = 0
        appFrequency.forEach((count, app) => {
          if (count > maxCount) {
            maxCount = count
            topApp = app
          }
        })
        slotTitle = topApp ? `${topApp} 使用中（归纳中...）` : `${hh}:${mm} 的活动`

        // 描述：将去重后的 ai_summary 拼接为详细描述，让用户能展开查看
        if (!slotDescription && uniqueSummaries.length > 0) {
          slotDescription = uniqueSummaries.slice(0, 10).join('；')
        }
      }

      const groupResult = {
        key: `slot-${slotStartMs}`,
        summary: slotTitle,
        description: slotDescription || undefined,
        items: sortedItems,
        startTime: Math.min(...timestamps),
        endTime: Math.min(Math.max(...timestamps), slotEndMs)
      }

      return groupResult
    })

    setGroupedContexts(groups)
  }, [contexts, allSummaries, slotSummaries])

  const formatDate = (date: Date): string => {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}年${month}月${day}日`
  }

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Pipeline Section Toggle Button - 当面板关闭时显示在左侧 */}
      {!isPipelineOpen && (
        <button
          onClick={() => setIsPipelineOpen(true)}
          className="absolute left-4 top-4 z-50 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 rounded-lg text-gray-400 hover:text-white transition-all shadow-lg"
          title="展开今日任务"
        >
          <PanelLeftOpen className="w-5 h-5" />
        </button>
      )}

      {/* Pipeline Section (保持静态 UI，后续对接 Backlog) */}
      <div
        className={`
          border-r border-white/5 flex flex-col h-full bg-black/10 shrink-0 transition-all duration-300 ease-in-out overflow-hidden
          ${isPipelineOpen ? 'w-[360px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-full'}
        `}
      >
        <div className="p-3.5 space-y-5 overflow-y-auto custom-scrollbar w-[360px]">
          {/* Header with Close Button */}
          <div className="flex items-center justify-between">
             <div>
               <h2 className="text-[15px] font-black text-white tracking-tight uppercase tracking-widest">
                今日任务 <span className="text-indigo-400">PIPELINE</span>
              </h2>
             </div>
             <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer">
                  <RefreshCcw className="w-3.5 h-3.5" />
                </div>
                <button
                  onClick={() => setIsPipelineOpen(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500 hover:text-gray-300 transition-colors"
                  title="收起面板"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
             </div>
          </div>

          {/* Date Picker */}
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5 shadow-inner">
            <span className="text-[13px] font-black text-white tracking-tight uppercase tracking-widest">
              {formatDate(currentDate)}
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  const d = new Date(currentDate)
                  d.setDate(d.getDate() - 1)
                  setCurrentDate(d)
                }}
                className="p-1 hover:bg-white/10 rounded-lg transition-all active:scale-90"
              >
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              <button
                onClick={() => {
                  const d = new Date(currentDate)
                  d.setDate(d.getDate() + 1)
                  setCurrentDate(d)
                }}
                className="p-1 hover:bg-white/10 rounded-lg transition-all active:scale-90"
              >
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Today's Pipeline (三区分层：FOCUS / TODAY / BACKLOG) */}
          <PipelinePanel
            backlog={backlog}
            slotSummaries={slotSummaries}
            onToggle={async (id, completed) => {
              await window.api.updateBacklogStatus(id, completed)
              await loadBacklog()
            }}
            onRefresh={async () => {
              await loadBacklog()
            }}
          />
        </div>
      </div>

      {/* Context Grid Section */}
      <div className="flex-1 flex flex-col h-full bg-black/20 min-w-0">
        <div className="p-4 xl:p-6 overflow-y-auto space-y-4 custom-scrollbar">
          {/* Current Intent Card */}
          <div className="max-w-[1400px] w-full mx-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-black text-gray-600 uppercase tracking-[0.25em]">
                当前屏幕识别意图 (CURRENT INTENT)
              </span>
            </div>
            {/* ... Intent Card ... */}
            <div className="relative p-[18px] rounded-2xl bg-white/5 border border-orange-500/20 overflow-hidden group shadow-xl transition-all hover:bg-white/[0.06] mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent"></div>
              {currentIntent ? (
                <>
                  <div className="flex items-start justify-between relative z-10">
                    <h3 className="text-[16px] font-black text-white tracking-tight leading-snug max-w-[85%] truncate">
                      {parseSummaryText(currentIntent.ai_summary)}
                    </h3>
                    <div className="flex gap-1.5 items-end h-6 mt-1 shrink-0">
                      {[0.4, 0.7, 1, 0.6, 0.8, 0.5, 0.9, 0.4, 0.7, 0.5].map((h, i) => (
                        <div
                          key={i}
                          className="w-[2.5px] bg-orange-500/80 rounded-full animate-pulse"
                          style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
                        ></div>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const aiSummary = currentIntent.ai_summary || ''
                    const isJsonSummary = aiSummary.trim().startsWith('{')

                    // JSON 格式：title 作标题，intent 作描述，两者天然不同
                    // 纯文本格式：ai_summary 作标题，stageSummary 作描述（stageSummary 通常是更详细的阶段描述）
                    // 若 stageSummary 也没有，则不展示描述区域
                    let displayDescription = ''
                    if (isJsonSummary) {
                      displayDescription = parseIntentDescription(aiSummary)
                    } else {
                      // 纯文本时，描述优先用 stageSummary
                      // stageSummary 本身也可能是 JSON，需要提取可读文本而非原始 JSON
                      if (stageSummary) {
                        const stageTrimmed = stageSummary.trim()
                        if (stageTrimmed.startsWith('{')) {
                          try {
                            const stageData = JSON.parse(stageTrimmed)
                            // 优先取 intent，其次取 title，避免展示原始 JSON
                            displayDescription = stageData.intent || stageData.title || ''
                          } catch {
                            const intentMatch = stageTrimmed.match(/"intent"\s*:\s*"([^"]+)"/)
                            const titleMatch = stageTrimmed.match(/"title"\s*:\s*"([^"]+)"/)
                            displayDescription = intentMatch?.[1] || titleMatch?.[1] || ''
                          }
                        } else {
                          displayDescription = stageTrimmed
                        }
                      }
                    }

                    return displayDescription ? (
                      <p className="mt-2 text-[12px] text-orange-200/60 font-medium leading-relaxed line-clamp-3 animate-in fade-in slide-in-from-left-1 duration-700">
                        {displayDescription}
                      </p>
                    ) : null
                  })()}
                  <div className="flex gap-2.5 mt-4 relative z-10 items-center">
                    {currentIntent.intent_tags?.map((tag, index) => (
                      <TaskTag key={`${tag}-${index}`} label={`#${tag}`} type="orange" />
                    ))}
                    <div className="flex items-center gap-1.5 ml-auto text-orange-400/40 text-[10px] font-black uppercase tracking-widest">
                      <Activity className="w-3 h-3 animate-spin-slow" />
                      <span>AI 实时感知中...</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-24 flex items-center justify-center text-gray-600 font-bold uppercase tracking-widest italic">
                  等待 AI 第一次感知...
                </div>
              )}
            </div>

            {/* Timeline */}
            <Timeline contexts={contexts} />
          </div>

          {/* Context Grid - Grouped by Consecutive Tasks */}
          <div className="max-w-[1400px] w-full mx-auto space-y-3.5">
            {groupedContexts.map((group) => (
              <ContextGroupCard
                key={group.key}
                group={group}
                isExpanded={expandedGroups.has(group.key)}
                onToggle={toggleGroup}
              />
            ))}

            {groupedContexts.length === 0 && (
               <div className="text-center py-20">
                  <p className="text-gray-600 text-xs font-bold uppercase tracking-widest">今日暂无活动记录</p>
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
