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
  top_intents: { intent_tags: string; count: number }[]
  flow_data: number[]
  context_switches: number
}

export const StatsView: React.FC = () => {
  const [activeCycle, setActiveCycle] = useState<'day' | 'week' | 'month'>('week')
  const [stats, setStats] = useState<StatsData | null>(null)
  const [insight, setInsight] = useState<{ insight_text: string; warning_text?: string } | null>(
    null
  )
  const [loadingInsight, setLoadingInsight] = useState(false)

  useEffect(() => {
    const loadStats = async (): Promise<void> => {
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      let start = now - oneDay

      if (activeCycle === 'week') start = now - 7 * oneDay
      if (activeCycle === 'month') start = now - 30 * oneDay

      const data = (await window.api.getStatsSummary(start, now)) as StatsData
      setStats(data)

      // 异步加载 AI 洞察
      setLoadingInsight(true)
      try {
        const insightData = await window.api.getStatsInsight(start, now)
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

  // 计算显示数值
  const deepWorkHours = stats?.total_count ? Math.floor((stats.total_count * 5) / 60) : 0
  const deepWorkMins = stats?.total_count ? (stats.total_count * 5) % 60 : 0
  const hasData = stats && stats.total_count > 0

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
                舟
              </h1>
              <p className="text-[13px] text-gray-500 font-medium">
                {activeCycle === 'week' ? 'Mar 18 - Mar 24, 2026' : 'March 2026'}
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
              trend={
                hasData
                  ? activeCycle === 'day'
                    ? '+20% 较昨日'
                    : activeCycle === 'week'
                      ? '+12% 较上周'
                      : '+5% 较上月'
                  : '暂无数据'
              }
              trendType="up"
              icon={Zap}
              iconColor="text-green-400"
            />
            <MetricCard
              title="无效上下文切换"
              value={hasData ? `${stats.context_switches}` : '0'}
              unit="次"
              trend={
                hasData
                  ? `专注度 ${(100 - Math.min(100, (stats.context_switches / (stats.total_count || 1)) * 100)).toFixed(0)}%`
                  : '暂无数据'
              }
              trendType={hasData && stats.context_switches > 100 ? 'down' : 'up'}
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
                  <svg className="w-full h-full" viewBox="0 0 400 100" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const data = stats.flow_data || []
                      const max = Math.max(...data, 1)
                      const points = data.map((val: number, i: number) => {
                        const x = (i / (data.length - 1)) * 400
                        const y = 90 - (val / max) * 80 // 留出一点边距
                        return { x, y }
                      })

                      // 构建平滑曲线路径
                      let d = `M${points[0].x},${points[0].y}`
                      for (let i = 0; i < points.length - 1; i++) {
                        const p0 = points[i]
                        const p1 = points[i + 1]
                        const cpX = (p0.x + p1.x) / 2
                        d += ` C${cpX},${p0.y} ${cpX},${p1.y} ${p1.x},${p1.y}`
                      }

                      const fillPath = `${d} L400,100 L0,100 Z`

                      return (
                        <>
                          <path
                            d={fillPath}
                            fill="url(#chartGradient)"
                            className="transition-all duration-1000 ease-in-out"
                          />
                          <path
                            d={d}
                            fill="none"
                            stroke="#6366f1"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            className="transition-all duration-1000 ease-in-out"
                          />
                          {points.map((p: { x: number; y: number }, i: number) => (
                            <circle
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r="3"
                              fill="#6366f1"
                              stroke="#000"
                              strokeWidth="1"
                            />
                          ))}
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
                <div className="flex justify-between mt-4 px-1 text-[10px] text-gray-600 font-bold uppercase tracking-widest">
                  {activeCycle === 'day' ? (
                    <>
                      <span>09:00</span>
                      <span>12:00</span>
                      <span>15:00</span>
                      <span>18:00</span>
                      <span>21:00</span>
                    </>
                  ) : activeCycle === 'week' ? (
                    <>
                      <span>周一</span>
                      <span>周二</span>
                      <span>周三</span>
                      <span>周四</span>
                      <span>周五</span>
                      <span>周末</span>
                    </>
                  ) : (
                    <>
                      <span>第一周</span>
                      <span>第二周</span>
                      <span>第三周</span>
                      <span>第四周</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-2xl p-6 shadow-sm">
              <h3 className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-8">
                算力意图分布
              </h3>
              <div className="space-y-6">
                {hasData && stats?.top_intents?.length > 0 ? (
                  stats.top_intents.map((intent: { intent_tags: string; count: number }, i: number) => (
                    <IntentBar
                      key={i}
                      label={JSON.parse(intent.intent_tags)[0]}
                      percentage={Math.round((intent.count / stats.total_count) * 100)}
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
                {loadingInsight && (
                  <span className="text-[10px] text-indigo-400 font-bold animate-pulse">
                    正在分析深度数据...
                  </span>
                )}
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
