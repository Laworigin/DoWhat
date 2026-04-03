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
  Bot,
  Target,
  RefreshCw,
  ChevronLeft,
  ChevronRight
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
  completedBy?: string | null
  isAiGenerated?: boolean
  createdAt?: number
  onToggle: (id: string) => void
}> = ({ id, title, completed, completedBy, isAiGenerated, createdAt, onToggle }) => {
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
          completed ? 'text-gray-600' : 'text-white/75'
        }`}
      >
        {title}
        {completed ? (
          <span className={`ml-2 inline-flex items-center text-[8px] font-black px-1.5 py-0.5 rounded-md ${completedBy === 'ai' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-green-500/15 text-green-400'}`}>
            {completedBy === 'ai' ? 'AI 识别' : '手动'}
          </span>
        ) : null}
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
  is_abandoned?: number
  completed_by?: string | null
}

interface ProjectItem {
  id: string
  name: string
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

interface OkrData {
  objectives: OkrObjective[]
  source_description?: string
}

export const BacklogView: React.FC = () => {
  const [activeSubNav, setActiveSubNav] = useState('global')
  const [tasks, setTasks] = useState<BacklogItem[]>([])
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [okrData, setOkrData] = useState<OkrData | null>(null)
  const [okrUpdatedAt, setOkrUpdatedAt] = useState<string>('')
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [okrInputText, setOkrInputText] = useState('')
  const [isParsingOkr, setIsParsingOkr] = useState(false)
  const [okrParseError, setOkrParseError] = useState('')
  const [showOkrInput, setShowOkrInput] = useState(false)
  const [parsingTipIndex, setParsingTipIndex] = useState(0)
  const [reportDates, setReportDates] = useState<string[]>([])
  const [selectedReportDate, setSelectedReportDate] = useState<string | null>(null)
  const [dailyReport, setDailyReport] = useState<{ insight_text: string; warning_text?: string } | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [reportTipIndex, setReportTipIndex] = useState(0)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const parsingTips = [
    '正在阅读你的 OKR 内容...',
    '识别目标（Objective）结构中...',
    '提取关键结果（Key Results）...',
    '拆分合格指标、高绩效指标、长期指标...',
    '构建结构化数据中...',
    'AI 正在理解你的绩效目标...',
    '快好了，正在做最后的格式化...',
    '马上就好，请再等一下 ☕'
  ]

  useEffect(() => {
    if (!isParsingOkr) {
      setParsingTipIndex(0)
      return
    }
    const timer = setInterval(() => {
      setParsingTipIndex((prev) => (prev + 1) % parsingTips.length)
    }, 2500)
    return (): void => clearInterval(timer)
  }, [isParsingOkr])

  const reportLoadingTips = [
    '正在收集当天的工作记录...',
    '分析你的工作节奏和心流时段...',
    '识别高效时段和碎片化切换...',
    '生成生产力洞察报告...',
    '快好了，正在总结核心产出...',
    '马上就好 ☕'
  ]

  useEffect(() => {
    if (!isLoadingReport) {
      setReportTipIndex(0)
      return
    }
    const timer = setInterval(() => {
      setReportTipIndex((prev) => (prev + 1) % reportLoadingTips.length)
    }, 3000)
    return (): void => clearInterval(timer)
  }, [isLoadingReport])

  const loadData = async (): Promise<void> => {
    const backlogData = await window.api.getBacklog()
    const projectsData = await window.api.getProjects()
    setTasks(backlogData as BacklogItem[])
    setProjects(projectsData as ProjectItem[])

    // 加载 OKR 数据
    const okrRaw = await window.api.getSettings('okr_current')
    if (okrRaw) {
      try {
        setOkrData(JSON.parse(okrRaw) as OkrData)
      } catch {
        setOkrData(null)
      }
    }
    const updatedAt = await window.api.getSettings('okr_updated_at')
    if (updatedAt) {
      setOkrUpdatedAt(updatedAt as string)
    }

    // 加载日报日期列表
    const dates = await window.api.getDailyReportDates() as string[]
    setReportDates(dates)
  }

  useEffect(() => {
    void loadData()

    // 监听实时更新事件
    const unsubscribeBacklog = window.electron.ipcRenderer.on('backlog-updated', () => {
      void loadData()
    })
    const unsubscribeOkr = window.electron.ipcRenderer.on('okr-updated', () => {
      void loadData()
    })

    return (): void => {
      unsubscribeBacklog()
      unsubscribeOkr()
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
  const completedTasks = todayTasks.filter((t) => t.completed)

  const loadDailyReport = async (date: string): Promise<void> => {
    setSelectedReportDate(date)
    setDailyReport(null)
    setIsLoadingReport(true)
    try {
      const result = await window.api.getDailyReport(date) as {
        success: boolean
        insight_text: string
        warning_text?: string
        error?: string
      }
      if (result.success) {
        setDailyReport({ insight_text: result.insight_text, warning_text: result.warning_text })
      } else {
        setDailyReport({ insight_text: result.error || '日报生成失败' })
      }
    } catch (error) {
      setDailyReport({ insight_text: (error as Error).message })
    } finally {
      setIsLoadingReport(false)
    }
  }

  const renderContent = (): React.ReactNode => {
    if (activeSubNav === 'daily-reports') {
      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      const [year, month] = currentMonth.split('-').map(Number)
      const monthDates = reportDates.filter((d) => d.startsWith(currentMonth))

      const formatDateLabel = (dateStr: string): string => {
        const date = new Date(dateStr + 'T00:00:00')
        const todayStr = new Date().toISOString().split('T')[0]
        const yesterdayDate = new Date()
        yesterdayDate.setDate(yesterdayDate.getDate() - 1)
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0]

        if (dateStr === todayStr) return '今天'
        if (dateStr === yesterdayStr) return '昨天'
        return `${date.getMonth() + 1}月${date.getDate()}日 ${dayNames[date.getDay()]}`
      }

      const goToPrevMonth = (): void => {
        const prevDate = new Date(year, month - 2, 1)
        setCurrentMonth(`${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`)
        setSelectedReportDate(null)
        setDailyReport(null)
      }

      const goToNextMonth = (): void => {
        const nextDate = new Date(year, month, 1)
        setCurrentMonth(`${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`)
        setSelectedReportDate(null)
        setDailyReport(null)
      }

      const nowMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
      const isCurrentMonth = currentMonth === nowMonth

      return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* 标题 + 月份切换 */}
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-black text-white tracking-tighter flex items-center gap-3">
              <FileText className="w-7 h-7 text-amber-400" />
              历史日报
            </h1>
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevMonth}
                className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[12px] font-black text-white/70 min-w-[80px] text-center">
                {year}年{month}月
              </span>
              <button
                onClick={goToNextMonth}
                disabled={isCurrentMonth}
                className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 月度统计 */}
          <div className="flex items-center gap-4 px-1">
            <span className="text-[11px] font-bold text-gray-500">
              本月记录 <span className="text-amber-400/80">{monthDates.length}</span> 天
            </span>
          </div>

          {monthDates.length === 0 ? (
            <div className="py-20 text-center bg-white/[0.02] rounded-2xl border border-dashed border-white/5">
              <FileText className="w-10 h-10 mx-auto mb-4 opacity-10" />
              <p className="text-[14px] font-black tracking-tight text-gray-600">{month}月暂无日报数据</p>
              <p className="text-[11px] text-gray-700 mt-2">开启 AI 感知后，系统会自动记录你的工作数据</p>
            </div>
          ) : (
            <div className="space-y-3">
              {monthDates.map((date) => {
                const isSelected = selectedReportDate === date
                return (
                  <div key={date}>
                    {/* 日期行 */}
                    <button
                      onClick={() => {
                        if (isSelected) {
                          setSelectedReportDate(null)
                          setDailyReport(null)
                        } else {
                          void loadDailyReport(date)
                        }
                      }}
                      className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-all ${
                        isSelected
                          ? 'bg-amber-500/[0.06] border-amber-500/15'
                          : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-amber-500/15' : 'bg-white/5'
                        }`}>
                          <span className={`text-[11px] font-black ${
                            isSelected ? 'text-amber-400' : 'text-gray-500'
                          }`}>
                            {new Date(date + 'T00:00:00').getDate()}
                          </span>
                        </div>
                        <span className={`text-[13px] font-bold ${
                          isSelected ? 'text-white/90' : 'text-white/60'
                        }`}>
                          {formatDateLabel(date)}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-gray-600">{date}</span>
                    </button>

                    {/* 展开的日报内容 */}
                    {isSelected && (
                      <div className="mt-2 ml-4 mr-1 animate-in fade-in slide-in-from-top-2 duration-300">
                        {isLoadingReport ? (
                          <div className="px-5 py-8 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                            <div className="flex flex-col items-center gap-4">
                              <div className="flex gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-400/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-2 h-2 rounded-full bg-amber-400/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-2 h-2 rounded-full bg-amber-400/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                              </div>
                              <p className="text-[11px] font-bold text-amber-300/60 transition-all duration-500">
                                {reportLoadingTips[reportTipIndex]}
                              </p>
                            </div>
                          </div>
                        ) : dailyReport ? (
                          <div className="px-5 py-4 rounded-xl bg-gradient-to-br from-amber-500/[0.04] to-transparent border border-amber-500/10">
                            <div className="flex items-start gap-2.5 mb-3">
                              <Sparkles className="w-4 h-4 text-amber-400/70 shrink-0 mt-0.5" />
                              <span className="text-[10px] font-black text-amber-400/60 uppercase tracking-widest">工作日志</span>
                            </div>
                            <div className="ml-6 text-[13px] text-white/70 font-medium leading-relaxed whitespace-pre-wrap [&>*]:mb-2 daily-report-content">
                              {dailyReport.insight_text.split('\n').map((line, lineIndex) => {
                                const trimmed = line.trim()
                                if (!trimmed) return <br key={lineIndex} />
                                if (trimmed.startsWith('## ')) {
                                  return <h3 key={lineIndex} className="text-[15px] font-black text-white/90 mt-4 mb-2">{trimmed.slice(3)}</h3>
                                }
                                if (trimmed.startsWith('### ')) {
                                  return <h4 key={lineIndex} className="text-[13px] font-black text-amber-400/80 mt-3 mb-1">{trimmed.slice(4)}</h4>
                                }
                                if (trimmed.startsWith('> ')) {
                                  return <p key={lineIndex} className="text-[11px] text-gray-500 italic border-l-2 border-amber-500/20 pl-3 my-1">{trimmed.slice(2)}</p>
                                }
                                if (trimmed.startsWith('- [ ] ')) {
                                  return <p key={lineIndex} className="text-[12px] text-white/50 ml-2">☐ {trimmed.slice(6)}</p>
                                }
                                if (trimmed.startsWith('- ')) {
                                  return <p key={lineIndex} className="text-[12px] text-white/60 ml-2">• {trimmed.slice(2)}</p>
                                }
                                if (trimmed.startsWith('  - ')) {
                                  return <p key={lineIndex} className="text-[12px] text-white/50 ml-6">◦ {trimmed.slice(4)}</p>
                                }
                                return <p key={lineIndex} className="text-[13px] text-white/70">{line}</p>
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    if (activeSubNav === 'okr') {
      return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-black text-white tracking-tighter flex items-center gap-3">
              <Target className="w-7 h-7 text-indigo-400" />
              我的 OKR
            </h1>
            {okrUpdatedAt && (
              <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                更新于 {new Date(okrUpdatedAt).toLocaleDateString('zh-CN')}
              </span>
            )}
          </div>

          {/* OKR 手动录入区域 */}
          {showOkrInput && (
            <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.06] to-transparent p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-black text-white/80 tracking-tight">
                  粘贴你的 OKR 内容
                </h3>
                <button
                  onClick={() => {
                    setShowOkrInput(false)
                    setOkrInputText('')
                    setOkrParseError('')
                  }}
                  className="text-[11px] font-bold text-gray-600 hover:text-gray-400 transition-colors"
                >
                  取消
                </button>
              </div>
              <textarea
                value={okrInputText}
                onChange={(e) => setOkrInputText(e.target.value)}
                placeholder={'将你的 OKR 内容粘贴到这里，支持任意格式...\n\n例如：\nO1: 提升产品安全能力\n  KR1: 完成全站漏洞扫描覆盖率 > 95%\n  KR2: 高危漏洞修复周期 < 3 天'}
                className="w-full h-40 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white/80 font-medium placeholder-gray-700 resize-none focus:outline-none focus:border-indigo-500/40 transition-colors"
              />
              {okrParseError && (
                <p className="text-[11px] font-bold text-red-400/80">{okrParseError}</p>
              )}
              <button
                onClick={async (): Promise<void> => {
                  setIsParsingOkr(true)
                  setOkrParseError('')
                  try {
                    const result = await window.api.parseOkrText(okrInputText) as {
                      success: boolean
                      objectiveCount: number
                      error?: string
                    }
                    if (result.success) {
                      setShowOkrInput(false)
                      setOkrInputText('')
                      await loadData()
                    } else {
                      setOkrParseError(result.error || '解析失败')
                    }
                  } catch (error) {
                    setOkrParseError((error as Error).message)
                  } finally {
                    setIsParsingOkr(false)
                  }
                }}
                disabled={isParsingOkr || okrInputText.trim().length < 10}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 text-[12px] font-black hover:bg-indigo-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isParsingOkr ? 'animate-spin' : ''}`} />
                {isParsingOkr ? 'AI 解析中...' : 'AI 智能解析'}
              </button>

              {/* 解析等待时的轮播文案 */}
              {isParsingOkr && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/10">
                  <div className="flex gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <p className="text-[11px] font-bold text-indigo-300/70 transition-all duration-500">
                    {parsingTips[parsingTipIndex]}
                  </p>
                </div>
              )}
            </div>
          )}

          {okrData && okrData.objectives.length > 0 ? (
            <div className="space-y-6">
              {/* 重新录入按钮 */}
              {!showOkrInput && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowOkrInput(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black text-gray-600 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" />
                    重新录入
                  </button>
                </div>
              )}

              {okrData.objectives.map((objective, objectiveIndex) => (
                <div
                  key={objectiveIndex}
                  className="rounded-2xl border border-indigo-500/10 bg-gradient-to-br from-indigo-500/[0.04] to-transparent overflow-hidden"
                >
                  {/* Objective 标题 */}
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
                    <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
                      <span className="text-[11px] font-black text-indigo-400">O{objectiveIndex + 1}</span>
                    </div>
                    <h2 className="text-[15px] font-black text-white/90 tracking-tight">{objective.title}</h2>
                  </div>

                  {/* Key Results */}
                  <div className="p-5 space-y-4">
                    {objective.key_results.map((krItem, krIndex) => {
                      // 兼容旧数据（string）和新数据（OkrKeyResult 对象）
                      const isStructured = typeof krItem === 'object' && krItem !== null && 'name' in krItem
                      const krName = isStructured ? (krItem as OkrKeyResult).name : (krItem as string)
                      const krData = isStructured ? (krItem as OkrKeyResult) : null

                      return (
                        <div key={krIndex} className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4">
                          {/* KR 标题 */}
                          <div className="flex items-start gap-2.5 mb-3">
                            <div className="w-5 h-5 rounded-md bg-indigo-500/10 flex items-center justify-center shrink-0 mt-0.5">
                              <span className="text-[8px] font-black text-indigo-400/70">KR</span>
                            </div>
                            <p className="text-[13px] font-bold text-white/75 leading-snug">{krName}</p>
                          </div>

                          {/* 分层指标（新结构） */}
                          {krData && (
                            <div className="ml-7 space-y-2.5">
                              {krData.baseline && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 bg-blue-500/10 text-blue-400/70">
                                    合格
                                  </span>
                                  <p className="text-[11px] text-gray-400 font-medium leading-snug">{krData.baseline}</p>
                                </div>
                              )}
                              {krData.stretch && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 bg-amber-500/10 text-amber-400/70">
                                    高绩效
                                  </span>
                                  <p className="text-[11px] text-gray-400 font-medium leading-snug">{krData.stretch}</p>
                                </div>
                              )}
                              {krData.longTerm && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 bg-emerald-500/10 text-emerald-400/70">
                                    长期
                                  </span>
                                  <p className="text-[11px] text-gray-400 font-medium leading-snug">{krData.longTerm}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : !showOkrInput ? (
            <div className="py-20 text-center bg-white/[0.02] rounded-2xl border border-dashed border-white/5">
              <Target className="w-10 h-10 mx-auto mb-4 opacity-10" />
              <p className="text-[14px] font-black tracking-tight text-gray-600">
                暂无 OKR 数据
              </p>
              <p className="text-[11px] text-gray-700 mt-2 mb-5">
                粘贴你的 OKR 内容，AI 将自动解析为结构化数据
              </p>
              <button
                onClick={() => setShowOkrInput(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 text-[12px] font-black hover:bg-indigo-500/25 transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                录入我的 OKR
              </button>
            </div>
          ) : null}
        </div>
      )
    }

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
                  completedBy={task.completed_by}
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
                  completedBy={task.completed_by}
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
                      completedBy={task.completed_by}
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
                      completedBy={task.completed_by}
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
                      completedBy={task.completed_by}
                      isAiGenerated={task.id.startsWith('ai_task_')}
                      createdAt={task.created_at}
                      onToggle={toggleTask}
                    />
                  ))
                ) : (
                  <div className="py-12 text-center bg-white/[0.01] rounded-xl border border-dashed border-white/5">
                    <Bot className="w-8 h-8 mx-auto mb-3 text-gray-800" />
                    <p className="text-[13px] font-bold text-gray-700">暂无待办任务</p>
                    <p className="text-[11px] text-gray-800 mt-1 mb-4">AI 将在下一个15分钟槽自动识别并添加</p>
                    <button
                      onClick={async (): Promise<void> => {
                        setIsBootstrapping(true)
                        try {
                          await window.api.bootstrapBacklog()
                          await loadData()
                        } finally {
                          setIsBootstrapping(false)
                        }
                      }}
                      disabled={isBootstrapping}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/15 text-indigo-400 text-[12px] font-bold hover:bg-indigo-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isBootstrapping ? 'animate-spin' : ''}`} />
                      {isBootstrapping ? 'AI 分析中...' : 'AI 智能规划'}
                    </button>
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
              count={completedTasks.length}
              active={activeSubNav === 'completed'}
              onClick={() => setActiveSubNav('completed')}
            />
            <SecondaryNavItem
              icon={Target}
              label="我的 OKR"
              active={activeSubNav === 'okr'}
              onClick={() => setActiveSubNav('okr')}
            />
            <SecondaryNavItem
              icon={FileText}
              label="历史日报"
              count={reportDates.length}
              active={activeSubNav === 'daily-reports'}
              onClick={() => setActiveSubNav('daily-reports')}
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
