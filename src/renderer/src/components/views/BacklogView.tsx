import React, { useState, useEffect } from 'react'
import {
  Layers,
  Calendar,
  Trophy,
  Archive,
  Plus,
  Sparkles,
  CheckCircle2,
  Circle,
  FileText,
  Bot
} from 'lucide-react'

interface NavItemProps {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  count?: number
  active: boolean
  onClick: () => void
}

const SecondaryNavItem: React.FC<NavItemProps> = ({
  icon: Icon,
  label,
  count,
  active,
  onClick
}) => (
  <div
    onClick={onClick}
    className={`flex items-center p-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-300 ${active ? 'bg-white/10 text-white shadow-lg' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}
  >
    <Icon className={`w-4 h-4 mr-3 ${active ? 'text-indigo-400' : 'text-gray-600'}`} />
    <span className="text-[13px] font-bold tracking-tight">{label}</span>
    {count !== undefined && (
      <span
        className={`ml-auto text-[9px] font-black px-1.5 py-0.5 rounded-md ${active ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-gray-700'}`}
      >
        {count}
      </span>
    )}
  </div>
)

const ProjectFolderItem: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({
  label,
  active,
  onClick
}) => (
  <div
    onClick={onClick}
    className={`flex items-center p-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-300 ${active ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/10' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}
  >
    <FileText className={`w-4 h-4 mr-3 ${active ? 'text-indigo-400' : 'text-gray-600'}`} />
    <span className="text-[12px] font-bold tracking-tight">{label}</span>
  </div>
)

const TodoCard: React.FC<{
  id: string
  title: string
  completed?: boolean
  isAiGenerated?: boolean
  createdAt?: number
  onToggle: (id: string) => void
}> = ({ id, title, completed, isAiGenerated, createdAt, onToggle }) => {
  const timeLabel = createdAt
    ? new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-200 group hover:bg-white/[0.04] ${
        completed ? 'border-white/[0.03] opacity-40' : 'border-white/[0.06] bg-white/[0.02]'
      }`}
    >
      <button
        onClick={() => onToggle(id)}
        className="mt-0.5 shrink-0 transition-transform active:scale-90"
      >
        {completed ? (
          <CheckCircle2 className="w-4 h-4 text-green-500/70" />
        ) : (
          <Circle className="w-4 h-4 text-gray-700 group-hover:text-gray-500 transition-colors" />
        )}
      </button>
      <p
        className={`flex-1 text-[13px] font-medium leading-snug tracking-tight ${
          completed ? 'text-gray-600 line-through' : 'text-white/75'
        }`}
      >
        {title}
      </p>
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        {isAiGenerated && (
          <span aria-label="AI 识别">
            <Bot className="w-3 h-3 text-indigo-500/50" />
          </span>
        )}
        {timeLabel && (
          <span className="text-[10px] font-bold text-gray-800">{timeLabel}</span>
        )}
      </div>
    </div>
  )
}

interface BacklogItem {
  id: string
  title: string
  completed: boolean
  category: string
  created_at: number
  task_date?: string
  is_hidden?: number
}

interface ProjectItem {
  id: string
  name: string
}

export const BacklogView: React.FC = () => {
  const [activeSubNav, setActiveSubNav] = useState('global')
  const [tasks, setTasks] = useState<BacklogItem[]>([])
  const [projects, setProjects] = useState<ProjectItem[]>([])

  const loadData = async (): Promise<void> => {
    const backlogData = await window.api.getBacklog()
    const projectsData = await window.api.getProjects()
    setTasks(backlogData as BacklogItem[])
    setProjects(projectsData as ProjectItem[])
  }

  useEffect(() => {
    void loadData()

    // 监听实时更新事件
    const unsubscribe = window.electron.ipcRenderer.on('backlog-updated', () => {
      void loadData()
    })

    return (): void => {
      unsubscribe()
    }
  }, [])

  const toggleTask = async (id: string): Promise<void> => {
    const task = tasks.find((t) => t.id === id)
    if (!task) return

    const nextState = !task.completed
    await window.api.updateBacklogStatus(id, nextState)

    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, completed: nextState } : t
      )
    )
  }

  const today = new Date().toISOString().split('T')[0]

  // 今日任务（未隐藏）
  const todayTasks = tasks.filter(
    (t) => !t.is_hidden && (!t.task_date || t.task_date === today)
  )
  const activeTasks = todayTasks.filter((t) => !t.completed)
  const completedTasks = tasks.filter((t) => t.completed)

  const renderContent = (): React.ReactNode => {
    if (activeSubNav === 'completed') {
      return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black text-white/90 tracking-tighter flex items-center gap-3">
              <Archive className="w-6 h-6 text-indigo-400" />
              已完成任务归档
            </h1>
            <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
              共 {completedTasks.length} 项记录
            </span>
          </div>
          <div className="space-y-2">
            {completedTasks.length > 0 ? (
              completedTasks.map((task) => (
                <TodoCard
                  key={task.id}
                  id={task.id}
                  title={task.title}
                  completed={task.completed}
                  isAiGenerated={task.id.startsWith('ai_task_')}
                  createdAt={task.created_at}
                  onToggle={toggleTask}
                />
              ))
            ) : (
              <div className="py-20 text-center text-gray-600 bg-white/[0.02] rounded-2xl border border-dashed border-white/5">
                <Archive className="w-10 h-10 mx-auto mb-4 opacity-10" />
                <p className="text-[14px] font-black tracking-tight text-gray-600">
                  暂无已完成的任务
                </p>
              </div>
            )}
          </div>
        </div>
      )
    }

    if (activeSubNav.startsWith('folder-')) {
      const folderProject = projects.find((p) => p.id === activeSubNav)
      const folderName = folderProject?.name ?? '项目文件夹'
      const folderTasks = activeTasks.filter((t) => t.category === activeSubNav)

      return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/10">
                <FileText className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white tracking-tighter">{folderName}</h1>
                <p className="text-gray-600 font-bold text-[11px] mt-0.5 uppercase tracking-widest">
                  项目文件夹 • {folderTasks.length} 项待办
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {folderTasks.length > 0 ? (
              folderTasks.map((task) => (
                <TodoCard
                  key={task.id}
                  id={task.id}
                  title={task.title}
                  completed={task.completed}
                  isAiGenerated={task.id.startsWith('ai_task_')}
                  createdAt={task.created_at}
                  onToggle={toggleTask}
                />
              ))
            ) : (
              <div className="py-16 text-center text-gray-700 bg-white/[0.01] rounded-xl border border-dashed border-white/5 text-[12px] font-bold">
                该项目暂无待办任务
              </div>
            )}
          </div>
        </div>
      )
    }

    const isGlobal = activeSubNav === 'global'
    const isWeek = activeSubNav === 'week'
    const isMonth = activeSubNav === 'month'

    const filteredWeekTasks = activeTasks.filter((t) => t.category === 'week')
    const filteredMonthTasks = activeTasks.filter((t) => t.category === 'month')
    // 今日 backlog：category 为 backlog 或未分类的任务
    const backlogTasks = activeTasks.filter(
      (t) => !t.category || t.category === 'backlog'
    )

    return (
      <div className="animate-in fade-in duration-700">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-5">
            <h1 className="text-3xl font-black text-white tracking-tighter">
              {isGlobal && '今日待办'}
              {isWeek && '本周冲刺'}
              {isMonth && '本月里程碑'}
            </h1>
            <div className="flex items-center gap-3 bg-white/5 px-4 py-1.5 rounded-xl border border-white/10 shadow-inner">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              <span className="text-[11px] text-gray-500 font-bold uppercase tracking-widest">
                {isGlobal ? '待完成: ' : isWeek ? '任务: ' : '里程碑: '}
                <span className="text-white font-black ml-1">
                  {isGlobal
                    ? backlogTasks.length
                    : isWeek
                      ? filteredWeekTasks.length
                      : filteredMonthTasks.length}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-10">
          {(isGlobal || isWeek) && (
            <section>
              <h2 className="flex items-center gap-3 text-[11px] font-black text-white/20 uppercase tracking-[0.3em] mb-4">
                <Calendar className="w-4 h-4" />
                本周冲刺
              </h2>
              <div className="space-y-2">
                {filteredWeekTasks.length > 0 ? (
                  filteredWeekTasks.map((task) => (
                    <TodoCard
                      key={task.id}
                      id={task.id}
                      title={task.title}
                      completed={task.completed}
                      isAiGenerated={task.id.startsWith('ai_task_')}
                      createdAt={task.created_at}
                      onToggle={toggleTask}
                    />
                  ))
                ) : (
                  <div className="p-6 text-center bg-white/[0.01] rounded-xl border border-dashed border-white/5 text-gray-700 font-bold text-[12px]">
                    本周暂无活跃任务
                  </div>
                )}
              </div>
            </section>
          )}

          {(isGlobal || isMonth) && (
            <section>
              <h2 className="flex items-center gap-3 text-[11px] font-black text-white/20 uppercase tracking-[0.3em] mb-4">
                <Trophy className="w-4 h-4" />
                本月里程碑
              </h2>
              <div className="space-y-2">
                {filteredMonthTasks.length > 0 ? (
                  filteredMonthTasks.map((task) => (
                    <TodoCard
                      key={task.id}
                      id={task.id}
                      title={task.title}
                      completed={task.completed}
                      isAiGenerated={task.id.startsWith('ai_task_')}
                      createdAt={task.created_at}
                      onToggle={toggleTask}
                    />
                  ))
                ) : (
                  <div className="p-6 text-center bg-white/[0.01] rounded-xl border border-dashed border-white/5 text-gray-700 font-bold text-[12px]">
                    本月暂无里程碑
                  </div>
                )}
              </div>
            </section>
          )}

          {isGlobal && (
            <section>
              <h2 className="flex items-center gap-3 text-[11px] font-black text-white/20 uppercase tracking-[0.3em] mb-4">
                <Archive className="w-4 h-4" />
                今日待办
                <span className="ml-1 text-[9px] font-black text-indigo-500/50 normal-case tracking-normal flex items-center gap-1">
                  <Bot className="w-3 h-3" />
                  AI 每15分钟自动识别
                </span>
              </h2>
              <div className="space-y-2">
                {backlogTasks.length > 0 ? (
                  backlogTasks.map((task) => (
                    <TodoCard
                      key={task.id}
                      id={task.id}
                      title={task.title}
                      completed={task.completed}
                      isAiGenerated={task.id.startsWith('ai_task_')}
                      createdAt={task.created_at}
                      onToggle={toggleTask}
                    />
                  ))
                ) : (
                  <div className="py-12 text-center bg-white/[0.01] rounded-xl border border-dashed border-white/5">
                    <Bot className="w-8 h-8 mx-auto mb-3 text-gray-800" />
                    <p className="text-[13px] font-bold text-gray-700">暂无待办任务</p>
                    <p className="text-[11px] text-gray-800 mt-1">AI 将在下一个15分钟槽自动识别并添加</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-black/5">
      {/* Stretched Secondary Navigation */}
      <div className="w-[280px] bg-black/20 border-r border-white/5 p-6 flex flex-col gap-10 shrink-0">
        <div>
          <h3 className="text-[10px] font-black text-gray-700 uppercase tracking-[0.3em] px-3 mb-5">
            时间视图
          </h3>
          <div className="space-y-1.5">
            <SecondaryNavItem
              icon={Layers}
              label="全局规划轴"
              active={activeSubNav === 'global'}
              onClick={() => setActiveSubNav('global')}
            />
            <SecondaryNavItem
              icon={Calendar}
              label="本周冲刺"
              count={tasks.filter((t) => t.category === 'week' && !t.completed).length}
              active={activeSubNav === 'week'}
              onClick={() => setActiveSubNav('week')}
            />
            <SecondaryNavItem
              icon={Trophy}
              label="本月里程碑"
              count={tasks.filter((t) => t.category === 'month' && !t.completed).length}
              active={activeSubNav === 'month'}
              onClick={() => setActiveSubNav('month')}
            />
            <SecondaryNavItem
              icon={Archive}
              label="已完成任务"
              count={tasks.filter((t) => t.completed).length}
              active={activeSubNav === 'completed'}
              onClick={() => setActiveSubNav('completed')}
            />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between px-3 mb-5">
            <h3 className="text-[10px] font-black text-gray-700 uppercase tracking-[0.3em]">
              项目文件夹
            </h3>
            <button className="text-gray-700 hover:text-white transition-colors p-1 hover:bg-white/5 rounded-lg">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1.5">
            {projects.map((p) => (
              <ProjectFolderItem
                key={p.id}
                label={p.name}
                active={activeSubNav === p.id}
                onClick={() => setActiveSubNav(p.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Optimized Main Content Area */}
      <div className="flex-1 p-10 xl:p-12 overflow-y-auto relative custom-scrollbar">
        <div className="max-w-[1000px] mx-auto">{renderContent()}</div>
      </div>
    </div>
  )
}
