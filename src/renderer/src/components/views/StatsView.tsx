import React, { useState, useEffect } from 'react'
import {
  CalendarDays,
  CalendarRange,
  CalendarClock,
  Download,
  Zap,
  Shuffle,
  Code2,
  TrendingUp,
  TrendingDown,
  Sparkles,
  AlertCircle
} from 'lucide-react'

import { LucideProps } from 'lucide-react'

interface NavItemProps {
  icon: React.ComponentType<LucideProps>
  label: string
  active: boolean
  onClick: () => void
}

const SecondaryNavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, onClick }) => (
  <div
    onClick={onClick}
    className={`flex items-center p-2.5 mx-2 rounded-lg cursor-pointer transition-all duration-200 ${active ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
  >
    <Icon className={`w-4 h-4 mr-3 ${active ? 'text-white' : 'text-gray-500'}`} />
    <span className="text-[13px] font-medium">{label}</span>
  </div>
)

const MetricCard: React.FC<{
  title: string
  value: string
  unit?: string
  trend?: string
  trendType?: 'up' | 'down'
  icon: React.ComponentType<LucideProps>
  iconColor: string
}> = ({ title, value, unit, trend, trendType, icon: Icon, iconColor }) => (
  <div className="bg-white/5 border border-white/5 rounded-xl p-5 flex flex-col gap-4 flex-1 shadow-sm hover:bg-white/[0.07] transition-all">
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-gray-400 font-medium">{title}</span>
      <div className={`p-1.5 rounded-lg bg-opacity-10 ${iconColor.replace('text-', 'bg-')}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
    </div>
    <div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
        {unit && <span className="text-sm text-gray-500 font-medium">{unit}</span>}
      </div>
      {trend && (
        <div
          className={`flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full w-fit text-[10px] font-bold ${trendType === 'up' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}
        >
          {trendType === 'up' ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {trend}
        </div>
      )}
    </div>
  </div>
)

const IntentBar: React.FC<{ label: string; percentage: number; color: string }> = ({
  label,
  percentage,
  color
}) => (
  <div className="space-y-2">
    <div className="flex justify-between text-[11px] font-medium">
      <span className="text-gray-400 truncate max-w-[70%]">{label}</span>
      <span className="text-white/80">{percentage}%</span>
    </div>
    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${color} transition-all duration-1000 ease-out`}
        style={{ width: `${percentage}%` }}
      ></div>
    </div>
  </div>
)

interface StatsData {
  total_count: number
  tagged_count: number
  top_intents: { intent_tags: string; count: number }[]
  flow_data: number[]
  context_switches: number
  active_minutes: number
  prev_active_minutes: number
  prev_context_switches: number
}

export const StatsView: React.FC = () => {
  const [activeCycle, setActiveCycle] = useState<'day' | 'week' | 'month'>('week')
  const [stats, setStats] = useState<StatsData | null>(null)
  const [insight, setInsight] = useState<{ insight_text: string; warning_text?: string; updated_at?: number } | null>(
    null
  )
  const [loadingInsight, setLoadingInsight] = useState(false)
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; x: number; y: number; val: number; label: string } | null>(null)

  useEffect(() => {
    const loadStats = async (): Promise<void> => {
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      let start: number

      if (activeCycle === 'day') {
        // 今日日报：从当天 00:00:00 开始
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        start = today.getTime()
      } else if (activeCycle === 'week') {
        start = now - 7 * oneDay
      } else {
        start = now - 30 * oneDay
      }

      const data = (await window.api.getStatsSummary(start, now)) as StatsData
      setStats(data)

      // 优先从缓存加载 AI 洞察（传入 cycle 参数）
      setLoadingInsight(true)
      try {
        const insightData = await window.api.getStatsInsight(start, now, activeCycle)
        setInsight(insightData)
      } catch (err) {
        console.error('Failed to load insight:', err)
      } finally {
        setLoadingInsight(false)
      }
    }
    loadStats()
  }, [activeCycle])

  const exportLabel =
    activeCycle === 'day' ? '导出日报' : activeCycle === 'week' ? '导出周报' : '导出月报'

  // 基于后端返回的实际活跃分钟数计算显示值
  const deepWorkHours = stats?.active_minutes ? Math.floor(stats.active_minutes / 60) : 0
  const deepWorkMins = stats?.active_minutes ? stats.active_minutes % 60 : 0
  const hasData = stats && stats.total_count > 0

  // 计算趋势百分比（与上一周期对比）
  const getWorkTrend = (): { text: string; type: 'up' | 'down' } => {
    if (!stats || !stats.active_minutes) return { text: '暂无数据', type: 'up' }
    if (!stats.prev_active_minutes) return { text: '无历史对比', type: 'up' }
    const diff = ((stats.active_minutes - stats.prev_active_minutes) / stats.prev_active_minutes) * 100
    const label = activeCycle === 'day' ? '较昨日' : activeCycle === 'week' ? '较上周' : '较上月'
    if (diff >= 0) return { text: `+${Math.round(diff)}% ${label}`, type: 'up' }
    return { text: `${Math.round(diff)}% ${label}`, type: 'down' }
  }

  const getSwitchTrend = (): { text: string; type: 'up' | 'down' } => {
    if (!hasData) return { text: '暂无数据', type: 'up' }
    // 基于有标签的截屏数计算专注度，避免大量无标签截屏稀释比例
    const taggedBase = Math.max(stats.tagged_count || stats.total_count, 1)
    const focusRate = 100 - Math.min(100, (stats.context_switches / taggedBase) * 100)
    return { text: `专注度 ${Math.max(0, Math.round(focusRate))}%`, type: focusRate >= 50 ? 'up' : 'down' }
  }

  // 动态计算日期范围文本
  const getDateRangeText = (): string => {
    const now = new Date()
    if (activeCycle === 'day') {
      return now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    }
    if (activeCycle === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const fmt = (d: Date): string => `${d.getMonth() + 1}月${d.getDate()}日`
      return `${fmt(weekAgo)} - ${fmt(now)}, ${now.getFullYear()}`
    }
    return now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  }

  const workTrend = getWorkTrend()
  const switchTrend = getSwitchTrend()

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-black/5 backdrop-blur-sm">
      {/* Secondary Sidebar */}
      <div className="w-[220px] bg-black/10 border-r border-white/5 p-4 flex flex-col gap-8 shrink-0">
        <div>
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-3">
            报告周期
          </h3>
          <div className="space-y-1">
            <SecondaryNavItem
              icon={CalendarDays}
              label="今日日报"
              active={activeCycle === 'day'}
              onClick={() => setActiveCycle('day')}
            />
            <SecondaryNavItem
              icon={CalendarRange}
              label="本周复盘"
              active={activeCycle === 'week'}
              onClick={() => setActiveCycle('week')}
            />
            <SecondaryNavItem
              icon={CalendarClock}
              label="月度度量"
              active={activeCycle === 'month'}
              onClick={() => setActiveCycle('month')}
            />
          </div>
        </div>

        <div>
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-3">
            数据切片
          </h3>
          <div className="space-y-1">
            <div className="flex items-center p-2.5 mx-2 rounded-lg cursor-pointer text-green-400 bg-green-400/5 border border-green-400/10 shadow-lg shadow-green-400/5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 mr-3 shadow-[0_0_8px_rgba(74,222,128,0.5)]"></div>
              <span className="text-[12px] font-bold">高优深度工作 (Deep Work)</span>
            </div>
            <div className="flex items-center p-2.5 mx-2 rounded-lg cursor-pointer text-gray-500 hover:text-gray-300 transition-all hover:bg-white/5">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-700 mr-3"></div>
              <span className="text-[12px] font-medium">上下文切换/中断</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
        <div className="max-w-[1000px] w-full mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
                {activeCycle === 'day'
                  ? '今日效能简报'
                  : activeCycle === 'week'
                    ? '本周效能复盘'
                    : '月度效能度量'}
              </h1>
              <p className="text-[13px] text-gray-500 font-medium">
                {getDateRangeText()}
              </p>
            </div>
            <button className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white/90 text-[13px] font-bold px-4 py-2.5 rounded-xl border border-white/5 transition-all active:scale-95 shadow-lg">
              <Download className="w-4 h-4" />
              {exportLabel}
            </button>
          </div>

          {/* Metrics Row */}
          <div className="flex gap-5 mb-8">
            <MetricCard
              title={
                activeCycle === 'day'
                  ? '今日深度工作'
                  : activeCycle === 'week'
                    ? '总计深度工作'
                    : '月度深度工作'
              }
              value={`${deepWorkHours}`}
              unit={`h ${deepWorkMins} m`}
              trend={workTrend.text}
              trendType={workTrend.type}
              icon={Zap}
              iconColor="text-green-400"
            />
            <MetricCard
              title="无效上下文切换"
              value={hasData ? `${stats.context_switches}` : '0'}
              unit="次"
              trend={switchTrend.text}
              trendType={switchTrend.type}
              icon={Shuffle}
              iconColor="text-red-400"
            />
            <MetricCard
              title="核心耗时意图"
              value={
                hasData
                  ? stats?.top_intents?.[0]
                    ? JSON.parse(stats.top_intents[0].intent_tags)[0]
                    : '暂无'
                  : '暂无数据'
              }
              trend={hasData ? '占用主要工作时长' : '开启 AI 感知以获取'}
              trendType="up"
              icon={Code2}
              iconColor="text-indigo-400"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-3 gap-5 mb-8">
            <div className="col-span-2 bg-white/5 border border-white/5 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-[13px] font-bold text-gray-400 uppercase tracking-wider">
                  {activeCycle === 'day'
                    ? '今日心流分布 (Hourly Flow)'
                    : activeCycle === 'week'
                      ? '每日心流趋势 (Daily Flow Trend)'
                      : '月度心流概览 (Monthly Flow Overview)'}
                </h3>
              </div>
              {/* Dynamic SVG Line Chart */}
              <div className="h-48 w-full relative">
                {hasData ? (
                  <svg className="w-full h-full" viewBox="0 0 400 120">
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const data = stats.flow_data || []
                      const maxScore = 100
                      const chartLeft = 35
                      const chartRight = 395
                      const chartWidth = chartRight - chartLeft
                      const chartTop = 5
                      const chartBottom = 95

                      const points = data.map((val: number, i: number) => {
                        const x = chartLeft + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : 0)
                        const y = chartBottom - (val / maxScore) * (chartBottom - chartTop)
                        return { x, y, val }
                      })

                      // 用所有点构建完整曲线（包括值为 0 的点），保证时间轴连续
                      const activePoints = points.filter((p) => p.val > 0)

                      let linePath = ''
                      let fillPath = ''
                      if (points.length > 0) {
                        linePath = `M${points[0].x},${points[0].y}`
                        for (let i = 0; i < points.length - 1; i++) {
                          const p0 = points[i]
                          const p1 = points[i + 1]
                          const cpX = (p0.x + p1.x) / 2
                          linePath += ` C${cpX},${p0.y} ${cpX},${p1.y} ${p1.x},${p1.y}`
                        }
                        fillPath = `${linePath} L${points[points.length - 1].x},${chartBottom} L${points[0].x},${chartBottom} Z`
                      }

                      return (
                        <>
                          {/* Y 轴刻度线和标签 */}
                          {[0, 25, 50, 75, 100].map((tick) => {
                            const y = chartBottom - (tick / maxScore) * (chartBottom - chartTop)
                            return (
                              <g key={tick}>
                                <line x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3 3" />
                                <text x={chartLeft - 5} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="8">{tick}</text>
                              </g>
                            )
                          })}
                          {/* X 轴基线 */}
                          <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                          {fillPath && (
                            <path
                              d={fillPath}
                              fill="url(#chartGradient)"
                              className="transition-all duration-1000 ease-in-out"
                            />
                          )}
                          {linePath && (
                            <path
                              d={linePath}
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="transition-all duration-1000 ease-in-out"
                            />
                          )}
                          {/* 只在有数据的小时画圆点，支持 hover tooltip */}
                          {activePoints.map((p, i: number) => {
                            // 计算该数据点在原始 data 数组中的索引
                            const originalIndex = points.indexOf(p)
                            // 生成 tooltip 标签
                            let tooltipLabel = ''
                            if (activeCycle === 'day') {
                              tooltipLabel = `${String(originalIndex).padStart(2, '0')}:00`
                            } else {
                              const now = Date.now()
                              const oneDay = 24 * 60 * 60 * 1000
                              const periodStart = activeCycle === 'week' ? now - 7 * oneDay : now - 30 * oneDay
                              const pointDate = new Date(periodStart + originalIndex * oneDay)
                              tooltipLabel = `${pointDate.getMonth() + 1}月${pointDate.getDate()}日`
                            }
                            return (
                              <g key={i}>
                                <circle
                                  cx={p.x}
                                  cy={p.y}
                                  r="3"
                                  fill={hoveredPoint?.index === originalIndex ? '#818cf8' : '#6366f1'}
                                  stroke="#1a1a2e"
                                  strokeWidth="1.5"
                                  className="cursor-pointer transition-all"
                                />
                                {/* 透明的更大热区，方便鼠标悬浮 */}
                                <circle
                                  cx={p.x}
                                  cy={p.y}
                                  r="8"
                                  fill="transparent"
                                  className="cursor-pointer"
                                  onMouseEnter={() => setHoveredPoint({ index: originalIndex, x: p.x, y: p.y, val: p.val, label: tooltipLabel })}
                                  onMouseLeave={() => setHoveredPoint(null)}
                                />
                              </g>
                            )
                          })}
                          {/* Hover Tooltip */}
                          {hoveredPoint && (
                            <g>
                              <rect
                                x={hoveredPoint.x - 35}
                                y={hoveredPoint.y - 28}
                                width="70"
                                height="22"
                                rx="4"
                                fill="rgba(0,0,0,0.85)"
                                stroke="rgba(99,102,241,0.4)"
                                strokeWidth="0.5"
                              />
                              <text x={hoveredPoint.x} y={hoveredPoint.y - 18} textAnchor="middle" fill="#e0e7ff" fontSize="7" fontWeight="bold">
                                {hoveredPoint.label}
                              </text>
                              <text x={hoveredPoint.x} y={hoveredPoint.y - 10} textAnchor="middle" fill="#a5b4fc" fontSize="6">
                                投入度 {hoveredPoint.val}
                              </text>
                            </g>
                          )}
                          {/* X 轴时间标签 */}
                          {activeCycle === 'day' && [0, 4, 8, 12, 16, 20, 24].map((hour) => {
                            const x = chartLeft + (hour / 23) * chartWidth
                            return (
                              <text key={hour} x={x} y={chartBottom + 14} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">
                                {hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`}
                              </text>
                            )
                          })}
                          {activeCycle === 'week' && ['周一', '周二', '周三', '周四', '周五', '周末'].map((label, i) => {
                            const x = chartLeft + (i / 5) * chartWidth
                            return (
                              <text key={label} x={x} y={chartBottom + 14} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">{label}</text>
                            )
                          })}
                          {activeCycle === 'month' && ['第一周', '第二周', '第三周', '第四周'].map((label, i) => {
                            const x = chartLeft + (i / 3) * chartWidth
                            return (
                              <text key={label} x={x} y={chartBottom + 14} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">{label}</text>
                            )
                          })}
                        </>
                      )
                    })()}
                  </svg>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center border-b border-white/5 pb-6">
                    <svg
                      className="w-full h-full opacity-10"
                      viewBox="0 0 400 100"
                      preserveAspectRatio="none"
                    >
                      <path
                        d="M0,90 L400,90"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeDasharray="4 4"
                      />
                    </svg>
                    <span className="absolute text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      开启感知以生成趋势
                    </span>
                  </div>
                )}

              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-2xl p-6 shadow-sm">
              <h3 className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-8">
                算力意图分布
              </h3>
              <div className="space-y-6">
                {hasData && stats?.top_intents?.length > 0 ? (
                  (() => {
                    const intentTotalCount = stats.top_intents.reduce((sum: number, item: { count: number }) => sum + item.count, 0)
                    return stats.top_intents.map((intent: { intent_tags: string; count: number }, i: number) => (
                      <IntentBar
                        key={i}
                        label={JSON.parse(intent.intent_tags)[0]}
                        percentage={Math.round((intent.count / Math.max(intentTotalCount, 1)) * 100)}
                        color={
                          [
                            'bg-indigo-500',
                            'bg-purple-500',
                            'bg-pink-500',
                            'bg-orange-500',
                            'bg-green-500'
                          ][i % 5]
                        }
                      />
                    ))
                  })()
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-gray-500 space-y-2">
                    <Code2 className="w-8 h-8 opacity-20" />
                    <span className="text-xs font-medium">暂无意图数据，请开启 AI 感知</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Insight Card */}
          <div className="bg-white/5 border border-indigo-500/20 rounded-2xl p-6 flex gap-5 group hover:bg-indigo-500/[0.03] transition-all shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0 border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
              <Sparkles
                className={`w-6 h-6 text-indigo-400 ${loadingInsight ? 'animate-spin' : 'animate-pulse'}`}
              />
            </div>
            <div className="space-y-3 flex-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-[15px] font-bold text-white tracking-tight">
                    Agent 智能洞察报告
                  </h3>
                  <span className="text-[10px] font-black bg-indigo-500 text-white px-2 py-0.5 rounded uppercase tracking-widest">
                    AI GENERATED
                  </span>
                </div>
                {loadingInsight ? (
                  <span className="text-[10px] text-indigo-400 font-bold animate-pulse">
                    正在分析深度数据...
                  </span>
                ) : insight?.updated_at ? (
                  <span className="text-[10px] text-gray-500 font-medium">
                    更新于 {new Date(insight.updated_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                ) : null}
              </div>
              <div className="text-[14px] leading-relaxed text-gray-400 font-medium">
                {loadingInsight ? (
                  <div className="space-y-2">
                    <div className="h-4 bg-white/5 rounded w-3/4 animate-pulse"></div>
                    <div className="h-4 bg-white/5 rounded w-1/2 animate-pulse"></div>
                  </div>
                ) : insight ? (
                  <>
                    <p className="text-gray-300 mb-3">{insight.insight_text}</p>
                    {insight.warning_text && (
                      <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/10 mt-4">
                        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <p className="text-[13px] leading-relaxed text-red-200/70 font-medium">
                          <span className="text-red-400 font-bold">效率流失预警：</span>{' '}
                          {insight.warning_text}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <p>暂无足够的数据生成洞察报告，请开启 AI 感知并保持工作一段时间。</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
