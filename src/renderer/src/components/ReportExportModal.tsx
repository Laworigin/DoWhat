
import React, { useState, useEffect, useRef } from 'react'
import { X, Copy, FileDown, RefreshCw, Languages, Sparkles, FileText, Briefcase, Loader2, CheckCircle2 } from 'lucide-react'

const PROGRESS_MESSAGES = [
  '正在收集工作数据...',
  '分析截屏活动记录...',
  '评估数据充分性...',
  '补充关键时间段详情...',
  '构建报告结构...',
  'AI 正在撰写报告...',
  '润色文案表达...',
  '即将完成，请稍候...'
]

const ENCOURAGEMENT_TIPS = [
  '💡 好的复盘是成长的加速器',
  '📊 数据驱动的工作回顾更客观',
  '🎯 AI 正在从你的工作轨迹中提炼价值',
  '✨ 每一次记录都是对努力的尊重',
  '🧠 让 AI 帮你发现工作中的隐藏模式',
  '🚀 结构化的报告让沟通效率翻倍',
  '📝 自动生成，省下的时间去做更重要的事'
]

type ReportType = 'daily' | 'weekly' | 'monthly'
type ReportVersion = 'personal' | 'professional'
type ReportLanguage = 'zh' | 'en'

interface ReportApiResult {
  success: boolean
  report?: string
  error?: string
}

interface ReportApi {
  generateReport: (params: {
    reportType: ReportType
    version: ReportVersion
    startMs: number
    endMs: number
    userNotes: string
    language: ReportLanguage
  }) => Promise<ReportApiResult>
  refineReport: (params: {
    originalData: string
    previousReport: string
    userFeedback: string
    language: ReportLanguage
    version: ReportVersion
  }) => Promise<ReportApiResult>
  translateReport: (params: {
    report: string
    targetLanguage: ReportLanguage
  }) => Promise<ReportApiResult>
}

interface ReportExportModalProps {
  visible: boolean
  onClose: () => void
  reportType: ReportType
  startMs: number
  endMs: number
}

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  visible,
  onClose,
  reportType,
  startMs,
  endMs
}) => {
  const [version, setVersion] = useState<ReportVersion>('personal')
  const [language, setLanguage] = useState<ReportLanguage>('zh')
  const [userNotes, setUserNotes] = useState('')
  const [report, setReport] = useState('')
  const [generating, setGenerating] = useState(false)
  const [refining, setRefining] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [refineFeedback, setRefineFeedback] = useState('')
  const [showRefineInput, setShowRefineInput] = useState(false)
  const [progressIndex, setProgressIndex] = useState(0)
  const [tipIndex, setTipIndex] = useState(0)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (generating) {
      setProgressIndex(0)
      setTipIndex(Math.floor(Math.random() * ENCOURAGEMENT_TIPS.length))

      progressTimerRef.current = setInterval(() => {
        setProgressIndex(prev => Math.min(prev + 1, PROGRESS_MESSAGES.length - 1))
        setTipIndex(Math.floor(Math.random() * ENCOURAGEMENT_TIPS.length))
      }, 4000)
    } else {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
    }
  }, [generating])

  if (!visible) return null

  const reportTypeLabel = reportType === 'daily' ? '日报' : reportType === 'weekly' ? '周报' : '月报'

  const reportApi = window.api as unknown as ReportApi

  const handleGenerate = async (): Promise<void> => {
    if (typeof reportApi.generateReport !== 'function') {
      setError('报告生成功能尚未加载，请重启应用（Ctrl+C 后重新 npm run dev）')
      return
    }

    setGenerating(true)
    setError('')
    setReport('')
    setShowRefineInput(false)

    try {
      const result = await reportApi.generateReport({
        reportType,
        version,
        startMs,
        endMs,
        userNotes: userNotes.trim(),
        language
      })

      if (result.success) {
        setReport(result.report ?? '')
      } else {
        setError(result.error || '报告生成失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const handleRefine = async (): Promise<void> => {
    if (!refineFeedback.trim() || !report) return
    if (typeof reportApi.refineReport !== 'function') {
      setError('微调功能尚未加载，请重启应用')
      return
    }

    setRefining(true)
    setError('')

    try {
      const result = await reportApi.refineReport({
        originalData: '',
        previousReport: report,
        userFeedback: refineFeedback.trim(),
        language,
        version
      })

      if (result.success) {
        setReport(result.report ?? '')
        setRefineFeedback('')
        setShowRefineInput(false)
      } else {
        setError(result.error || '微调失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRefining(false)
    }
  }

  const handleTranslate = async (): Promise<void> => {
    if (!report) return
    if (typeof reportApi.translateReport !== 'function') {
      setError('翻译功能尚未加载，请重启应用')
      return
    }

    setTranslating(true)
    setError('')

    const targetLanguage: ReportLanguage = language === 'zh' ? 'en' : 'zh'

    try {
      const result = await reportApi.translateReport({
        report,
        targetLanguage
      })

      if (result.success) {
        setReport(result.report ?? '')
        setLanguage(targetLanguage)
      } else {
        setError(result.error || '翻译失败')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setTranslating(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，请手动选择文本复制')
    }
  }

  const handleSaveFile = (): void => {
    if (!report) return
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${reportTypeLabel}_${new Date().toISOString().split('T')[0]}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const isProcessing = generating || refining || translating

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="w-[720px] max-h-[85vh] bg-gray-900/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-black text-white tracking-tight">
                AI 智能{reportTypeLabel}
              </h2>
              <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                基于工作数据自动生成结构化报告
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Config Area */}
        <div className="px-6 py-4 border-b border-white/5 space-y-4">
          {/* Version Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setVersion('personal')}
              disabled={isProcessing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold transition-all ${
                version === 'personal'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              个人版
            </button>
            <button
              onClick={() => setVersion('professional')}
              disabled={isProcessing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold transition-all ${
                version === 'professional'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              专业版
            </button>

            <div className="ml-auto flex items-center gap-2">
              {/* Language Toggle */}
              <button
                onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 transition-all"
              >
                <Languages className="w-3.5 h-3.5" />
                {language === 'zh' ? '中文' : 'EN'}
              </button>
            </div>
          </div>

          {/* User Notes */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">
              补充说明（可选）
            </label>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              disabled={isProcessing}
              placeholder="补充今天的重要会议、决策、或其他 AI 无法感知的工作内容..."
              className="w-full h-16 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[12px] text-white placeholder-gray-600 resize-none focus:outline-none focus:border-indigo-500/40 transition-colors"
            />
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-black bg-indigo-500 hover:bg-indigo-400 text-white transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {PROGRESS_MESSAGES[progressIndex]}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                生成{version === 'personal' ? '个人版' : '专业版'}{reportTypeLabel}
              </>
            )}
          </button>
        </div>

        {/* Report Preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
          {error && (
            <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] text-red-300 font-medium">
              {error}
            </div>
          )}

          {report ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-300 font-mono bg-transparent p-0 m-0 border-none">
                {report}
              </pre>
            </div>
          ) : generating ? (
            <div className="flex flex-col items-center justify-center h-48 space-y-6">
              {/* Progress Steps */}
              <div className="w-full max-w-md space-y-2">
                {PROGRESS_MESSAGES.slice(0, Math.min(progressIndex + 2, PROGRESS_MESSAGES.length)).map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all duration-500 ${
                      idx < progressIndex
                        ? 'text-green-400/70'
                        : idx === progressIndex
                          ? 'text-indigo-300 bg-indigo-500/10 border border-indigo-500/20'
                          : 'text-gray-600'
                    }`}
                  >
                    {idx < progressIndex ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : idx === progressIndex ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-gray-700 shrink-0" />
                    )}
                    <span className="text-[11px] font-medium">{msg}</span>
                  </div>
                ))}
              </div>

              {/* Encouragement Tip */}
              <p className="text-[11px] text-gray-500 font-medium animate-pulse transition-all duration-1000">
                {ENCOURAGEMENT_TIPS[tipIndex]}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600 space-y-3">
              <FileText className="w-10 h-10 opacity-20" />
              <p className="text-[12px] font-medium">点击上方按钮生成报告</p>
              <p className="text-[10px] text-gray-700">
                {version === 'personal' ? '个人版：轻松自然，适合个人复盘' : '专业版：结构严谨，适合团队汇报'}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {report && (
          <div className="px-6 py-4 border-t border-white/10 space-y-3">
            {/* Refine Input */}
            {showRefineInput && (
              <div className="flex gap-2">
                <input
                  value={refineFeedback}
                  onChange={(e) => setRefineFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleRefine()
                    }
                  }}
                  disabled={refining}
                  placeholder="告诉 AI 你想怎么调整，如：更简洁一些、补充项目进度..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 transition-colors"
                />
                <button
                  onClick={handleRefine}
                  disabled={refining || !refineFeedback.trim()}
                  className="px-4 py-2 rounded-lg text-[11px] font-bold bg-indigo-500 hover:bg-indigo-400 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '微调'}
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRefineInput(!showRefineInput)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                微调
              </button>
              <button
                onClick={handleTranslate}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 transition-all"
              >
                {translating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Languages className="w-3.5 h-3.5" />
                )}
                翻译为{language === 'zh' ? '英文' : '中文'}
              </button>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 transition-all"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-green-400">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      复制
                    </>
                  )}
                </button>
                <button
                  onClick={handleSaveFile}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  保存为文件
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
