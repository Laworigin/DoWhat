import React, { useState, useEffect, useCallback } from 'react'
import { Target, Folder, BarChart3, Settings, Shell } from 'lucide-react'

// 前端内置兜底价格表，与 capturer.ts 中的 BUILTIN_MODEL_PRICING 保持一致
// 当 preload 的 getModelPricing 不可用或 DB 无数据时作为兜底
const FRONTEND_FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'claude-4-5': { input: 3, output: 15 },
  'claude-4-6': { input: 3, output: 15 },
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'qwen-plus': { input: 0.8, output: 2 },
  'qwen-max': { input: 2.4, output: 9.6 },
  'qwen-long': { input: 0.07, output: 0.14 },
  'qwen2.5-72b-instruct': { input: 0.56, output: 2.24 },
  'qwen3.5-plus': { input: 0.004, output: 0.012 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
}

function getFallbackPricing(modelName: string): { input: number; output: number } | null {
  const lowerName = modelName.toLowerCase()
  if (FRONTEND_FALLBACK_PRICING[lowerName]) {
    return FRONTEND_FALLBACK_PRICING[lowerName]
  }
  let bestMatch: string | null = null
  for (const key of Object.keys(FRONTEND_FALLBACK_PRICING)) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      if (!bestMatch || key.length > bestMatch.length) {
        bestMatch = key
      }
    }
  }
  return bestMatch ? FRONTEND_FALLBACK_PRICING[bestMatch] : null
}

interface NavItemProps {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  count?: number
  active: boolean
  onClick: () => void
}

const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, onClick }) => (
  <li
    className={`
      flex items-center
      h-9
      px-3
      mx-1.5
      rounded-lg
      cursor-pointer
      transition-all
      duration-300
      group
      ${
        active
          ? 'bg-white/10 text-white shadow-sm'
          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
      }
    `}
    onClick={onClick}
  >
    <Icon
      className={`w-4 h-4 mr-2.5 ${active ? 'text-indigo-400' : 'text-gray-600 group-hover:text-gray-400'}`}
    />
    <span className="text-[12px] font-bold tracking-tight">{label}</span>
  </li>
)

interface PrimaryNavProps {
  activeSection: string
  setActiveSection: (section: string) => void
  isCapturing: boolean
  toggleCapturing: () => void
}

export const PrimaryNav: React.FC<PrimaryNavProps> = ({
  activeSection,
  setActiveSection,
  isCapturing,
  toggleCapturing
}) => {
  const [tokenUsage, setTokenUsage] = useState<number>(0)
  const [estimatedCostUsd, setEstimatedCostUsd] = useState<number | null>(null)

  // 纯数据获取函数，不直接调用 setState，避免 react-hooks/set-state-in-effect lint 错误
  const fetchTokenAndCost = useCallback(async (): Promise<{
    usage: number
    costUsd: number | null
  }> => {
    const usage = await window.api.getMonthlyTokens()

    // 读取当前模型价格，计算资金成本
    const modelName = await window.api.getSettings('model_name')
    if (!modelName) return { usage, costUsd: null }

    // 优先从 DB 读取价格（需要 preload 已更新）
    let inputPrice: number | null = null
    let outputPrice: number | null = null

    if (typeof window.api.getModelPricing === 'function') {
      const pricing = await window.api.getModelPricing(modelName)
      if (pricing) {
        inputPrice = pricing.input_price_per_1m
        outputPrice = pricing.output_price_per_1m
      }
    }

    // 如果 DB 没有价格，用前端内置兜底价格表（和 capturer.ts 保持一致）
    if (inputPrice === null || outputPrice === null) {
      const fallbackPricing = getFallbackPricing(modelName)
      if (fallbackPricing) {
        inputPrice = fallbackPricing.input
        outputPrice = fallbackPricing.output
      }
    }

    if (inputPrice !== null && outputPrice !== null) {
      // 用 input/output 均价估算（因为 token_usage 表只记录总量，不区分 input/output）
      const avgPricePer1m = (inputPrice + outputPrice) / 2
      const costUsd = (usage / 1_000_000) * avgPricePer1m
      return { usage, costUsd }
    }

    return { usage, costUsd: null }
  }, [])

  useEffect(() => {
    let isMounted = true

    const refresh = async (): Promise<void> => {
      try {
        const { usage, costUsd } = await fetchTokenAndCost()
        if (!isMounted) return
        setTokenUsage(usage)
        setEstimatedCostUsd(costUsd)
      } catch (error) {
        console.error('Failed to fetch token usage or pricing:', error)
      }
    }

    void refresh()

    // 监听新 context 推送时更新 token
    const unsubscribe = window.electron.ipcRenderer.on('new-context-saved', () => {
      void refresh()
    })

    // 监听 backlog 更新（通常伴随 summary 生成，消耗 token）
    const unsubscribeBacklog = window.electron.ipcRenderer.on('backlog-updated', () => {
      void refresh()
    })

    return (): void => {
      isMounted = false
      unsubscribe()
      unsubscribeBacklog()
    }
  }, [fetchTokenAndCost])

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
    return tokens.toString()
  }

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
    return `$${usd.toFixed(3)}`
  }

  return (
    <div className="w-[200px] bg-black/20 backdrop-blur-3xl border-r border-white/5 flex flex-col shrink-0 h-full">
      {/* Mac Traffic Lights Safe Area - 拖拽区域（仅顶部高度对齐红绿灯） */}
      <div className="h-7 w-full shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Logo Section */}
      <div className="px-5 mt-3 mb-6 flex items-center gap-2.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
          <span className="text-white text-xs font-black">D</span>
        </div>
        <span className="text-[15px] font-black text-white tracking-tighter uppercase">
          DoWhat
        </span>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-1.5 custom-scrollbar">
        <ul className="space-y-1">
          <NavItem
            icon={Target}
            label="Context 看板"
            active={activeSection === 'context'}
            onClick={() => setActiveSection('context')}
          />
          <NavItem
            icon={Folder}
            label="长线规划"
            active={activeSection === 'backlog'}
            onClick={() => setActiveSection('backlog')}
          />
          <NavItem
            icon={BarChart3}
            label="统计与复盘"
            active={activeSection === 'stats'}
            onClick={() => setActiveSection('stats')}
          />
          <NavItem
            icon={Settings}
            label="系统设置"
            active={activeSection === 'settings'}
            onClick={() => setActiveSection('settings')}
          />
          <NavItem
            icon={Shell}
            label="OpenClaw"
            active={activeSection === 'openclaw'}
            onClick={() => setActiveSection('openclaw')}
          />
        </ul>
      </nav>

      {/* Bottom Section: Token & Status */}
      <div className="p-5 border-t border-white/5 space-y-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-600 font-bold tracking-tight">本月 Token</span>
            <span className="text-[11px] text-white/60 font-black tabular-nums">
              {formatTokens(tokenUsage)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-600 font-bold tracking-tight">估算费用 (USD)</span>
            <span className="text-[11px] font-black tabular-nums text-indigo-400">
              {estimatedCostUsd !== null ? formatCost(estimatedCostUsd) : '—'}
            </span>
          </div>
        </div>

        <button
          onClick={toggleCapturing}
          className={`
            flex items-center justify-center gap-2 py-2 px-3 rounded-xl w-full transition-all duration-300 border
            ${
              isCapturing
                ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:border-green-500/40'
                : 'bg-gray-500/10 border-gray-500/20 text-gray-400 hover:border-gray-500/40'
            }
          `}
        >
          <div
            className={`w-2 h-2 rounded-full ${isCapturing ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}`}
          ></div>
          <span className="text-[11px] font-black tracking-widest uppercase">
            {isCapturing ? 'AI 感知已开启' : '开启 AI 感知'}
          </span>
        </button>
      </div>
    </div>
  )
}
