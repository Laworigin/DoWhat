import React, { useState, useEffect, useCallback } from 'react'
import { Download, MessageSquare, SkipForward, RefreshCw, Wifi, WifiOff, Loader2, CheckCircle2, XCircle, ArrowRight, RotateCcw } from 'lucide-react'

type Phase = 'install' | 'im-wizard' | 'webchat'

interface InstallStatus {
  installed: boolean
  imConfigured: boolean
  imSkipped: boolean
  channels: string[]
}

export const OpenClawView: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('install')
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Install phase state
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<{ step: string; message: string } | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  // IM wizard state
  const [selectedChannel, setSelectedChannel] = useState<'weixin' | 'feishu' | null>(null)
  const [channelConnecting, setChannelConnecting] = useState(false)
  const [channelConnected, setChannelConnected] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [qrData, setQrData] = useState<{ data: string; type: string } | null>(null)
  const [connectionProgress, setConnectionProgress] = useState(0)
  const [connectionMessage, setConnectionMessage] = useState('')

  // Gateway state
  const [gatewayRunning, setGatewayRunning] = useState(false)

  const determinePhase = useCallback((status: InstallStatus): Phase => {
    if (!status.installed) return 'install'
    if (!status.imConfigured && !status.imSkipped) return 'im-wizard'
    return 'webchat'
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const status = await window.api.openclawGetInstallStatus()
      setInstallStatus(status)
      setPhase(determinePhase(status))

      const gatewayStatus = await window.api.openclawGatewayStatus()
      setGatewayRunning(gatewayStatus.running)
    } catch (err) {
      console.error('Failed to load OpenClaw status:', err)
    } finally {
      setLoading(false)
    }
  }, [determinePhase])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Listen for install progress events
  useEffect(() => {
    window.api.onOpenclawInstallProgress((data) => {
      setInstallProgress(data)
      if (data.step === 'done') {
        setInstalling(false)
        setInstallError(null)
        loadStatus()
      }
    })

    window.api.onOpenclawInstallError((data) => {
      setInstallError(data.detail || data.error)
      setInstalling(false)
    })

    window.api.onOpenclawChannelQrcode((data) => {
      setQrData({ data: data.qrData, type: data.type })
    })

    const unsubscribe = window.api.onOpenclawChannelStatus((data) => {
      if (data.status === 'connected') {
        setChannelConnected(true)
        setChannelConnecting(false)
        setConnectionProgress(100)
        setConnectionMessage('连接成功！正在跳转...')
        // 连接成功后自动跳转到 webchat 阶段
        // 后端已确保数据库先更新，所以可以立即刷新状态
        setTimeout(() => {
          loadStatus()
        }, 500)
      } else if (data.status === 'error') {
        setChannelError(data.error || '连接失败')
        setChannelConnecting(false)
        setConnectionProgress(0)
      } else if (data.status === 'connecting') {
        setChannelConnecting(true)
        setConnectionProgress(0)
      }
    })

    return unsubscribe
  }, [loadStatus])

  // 虚拟进度条效果
  useEffect(() => {
    if (!channelConnecting || channelConnected) return

    const messages = [
      '正在初始化连接...',
      '正在检测 OpenClaw 版本...',
      '正在匹配兼容版本...',
      '正在安装插件...',
      '正在配置环境...',
      '正在生成二维码...',
      '等待扫码...',
      '马上就好，请稍候...',
      '正在建立连接...',
      '即将完成...'
    ]

    let progress = 0
    let messageIndex = 0

    const progressInterval = setInterval(() => {
      if (channelConnected) {
        clearInterval(progressInterval)
        return
      }

      // 进度增长速度：前期快，后期慢
      if (progress < 30) {
        progress += Math.random() * 8 + 2 // 2-10%
      } else if (progress < 60) {
        progress += Math.random() * 5 + 1 // 1-6%
      } else if (progress < 85) {
        progress += Math.random() * 3 + 0.5 // 0.5-3.5%
      } else {
        progress += Math.random() * 1 // 0-1%
      }

      progress = Math.min(progress, 95) // 最多到 95%，等待真正连接成功
      setConnectionProgress(Math.floor(progress))

      // 每 3-5 秒切换一次提示文案
      if (Math.random() > 0.7 && messageIndex < messages.length - 1) {
        messageIndex++
        setConnectionMessage(messages[messageIndex])
      }
    }, 800)

    setConnectionMessage(messages[0])

    return () => clearInterval(progressInterval)
  }, [channelConnecting, channelConnected])

  const handleInstall = async (): Promise<void> => {
    setInstalling(true)
    setInstallError(null)
    setInstallProgress({ step: 'npm-install', message: '正在准备安装...' })
    await window.api.openclawInstall()
  }

  const handleSetupChannel = async (channel: 'weixin' | 'feishu'): Promise<void> => {
    setSelectedChannel(channel)
    setChannelConnecting(true)
    setChannelError(null)
    setChannelConnected(false)
    setQrData(null)
    await window.api.openclawSetupChannel(channel)
  }

  const handleSkipIm = async (): Promise<void> => {
    await window.api.openclawSkipIm()
    loadStatus()
  }

  const handleReset = async (): Promise<void> => {
    if (!confirm('确定要重置 OpenClaw 吗？这将删除所有配置并卸载 OpenClaw。')) return
    setLoading(true)
    await window.api.openclawReset()
    setInstallProgress(null)
    setInstallError(null)
    setSelectedChannel(null)
    setChannelConnecting(false)
    setChannelConnected(false)
    setQrData(null)
    loadStatus()
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-12 pb-6 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 flex items-center justify-center shadow-lg">
              <span className="text-xl">🦞</span>
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">OpenClaw</h1>
              <p className="text-xs text-gray-500 mt-0.5">AI 个人助手 · 多渠道 IM 接入</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {phase === 'webchat' && (
              <div className="flex items-center gap-2">
                {gatewayRunning ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
                    <Wifi className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-[11px] font-bold text-green-400">Gateway 运行中</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                    <WifiOff className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[11px] font-bold text-red-400">Gateway 未运行</span>
                  </div>
                )}
              </div>
            )}
            {installStatus?.installed && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-[11px] font-bold text-gray-400">重装</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {phase === 'install' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <InstallPhase
              installing={installing}
              progress={installProgress}
              error={installError}
              onInstall={handleInstall}
            />
          </div>
        )}

        {phase === 'im-wizard' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <ImWizardPhase
              selectedChannel={selectedChannel}
              connecting={channelConnecting}
              connected={channelConnected}
              error={channelError}
              qrData={qrData}
              connectionProgress={connectionProgress}
              connectionMessage={connectionMessage}
              onSetupChannel={handleSetupChannel}
              onSkip={handleSkipIm}
              onBack={handleSkipIm}
            />
          </div>
        )}

        {phase === 'webchat' && (
          <WebChatPhase
            gatewayRunning={gatewayRunning}
            channels={installStatus?.channels || []}
            onManageIm={() => setPhase('im-wizard')}
          />
        )}
      </div>
    </div>
  )
}

// ===== Phase 1: Install =====
const InstallPhase: React.FC<{
  installing: boolean
  progress: { step: string; message: string } | null
  error: string | null
  onInstall: () => void
}> = ({ installing, progress, error, onInstall }) => {
  const stepLabels: Record<string, string> = {
    'npm-install': '安装 OpenClaw 包',
    'onboard': '初始化配置',
    'write-env': '写入 API 配置',
    'done': '安装完成',
    'error': '安装失败'
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-4">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 via-red-500/20 to-pink-500/20 border border-orange-500/20 flex items-center justify-center">
            <span className="text-4xl">🦞</span>
          </div>
          <h2 className="text-2xl font-black text-white">安装 OpenClaw</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            OpenClaw 是你的 AI 个人助手，支持微信、飞书等 20+ 聊天渠道。
            <br />
            点击下方按钮一键安装，整个过程约需 1-3 分钟。
          </p>
        </div>

        {!installing && !error && (
          <button
            onClick={onInstall}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 text-white font-bold text-sm hover:from-orange-400 hover:to-pink-400 transition-all shadow-lg shadow-orange-500/20"
          >
            <Download className="w-4 h-4" />
            一键安装
          </button>
        )}

        {installing && progress && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
              <span className="text-sm font-bold text-orange-400">
                {progress.message}
              </span>
            </div>

            <div className="space-y-2">
              {Object.entries(stepLabels).filter(([key]) => key !== 'error').map(([key, label]) => {
                const currentStepIndex = Object.keys(stepLabels).indexOf(progress.step)
                const thisStepIndex = Object.keys(stepLabels).indexOf(key)
                const isCompleted = thisStepIndex < currentStepIndex
                const isCurrent = key === progress.step
                const isPending = thisStepIndex > currentStepIndex

                return (
                  <div key={key} className="flex items-center gap-2 text-left px-4">
                    {isCompleted && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                    {isCurrent && <Loader2 className="w-4 h-4 text-orange-400 animate-spin shrink-0" />}
                    {isPending && <div className="w-4 h-4 rounded-full border border-gray-600 shrink-0" />}
                    <span className={`text-xs font-medium ${isCompleted ? 'text-green-400' : isCurrent ? 'text-orange-400' : 'text-gray-600'}`}>
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <div className="flex items-start gap-2">
                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="text-sm font-bold text-red-400">安装失败</p>
                  <p className="text-xs text-red-400/70 mt-1 break-all">{error}</p>
                </div>
              </div>
            </div>
            <button
              onClick={onInstall}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-sm hover:bg-white/10 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== Phase 2: IM Wizard =====
const ImWizardPhase: React.FC<{
  selectedChannel: 'weixin' | 'feishu' | null
  connecting: boolean
  connected: boolean
  error: string | null
  qrData: { data: string; type: string } | null
  connectionProgress: number
  connectionMessage: string
  onSetupChannel: (channel: 'weixin' | 'feishu') => void
  onSkip: () => void
  onBack: () => void
}> = ({ selectedChannel, connecting, connected, error, qrData, connectionProgress, connectionMessage, onSetupChannel, onSkip, onBack }) => {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg w-full space-y-8">
        <div className="text-center space-y-3">
          <h2 className="text-2xl font-black text-white">接入 IM 渠道</h2>
          <p className="text-sm text-gray-400">
            选择一个聊天渠道，扫码登录后即可通过 IM 与 AI 助手对话。
            <br />
            你也可以跳过此步骤，稍后在设置中配置。
          </p>
        </div>

        {!selectedChannel && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => onSetupChannel('weixin')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-green-500/30 transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                  <MessageSquare className="w-7 h-7 text-green-400" />
                </div>
                <span className="text-sm font-bold text-white">微信</span>
              </button>

              <button
                onClick={() => onSetupChannel('feishu')}
                className="flex flex-col items-center gap-3 p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-blue-500/30 transition-all group"
              >
                <div className="w-14 h-14 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                  <MessageSquare className="w-7 h-7 text-blue-400" />
                </div>
                <span className="text-sm font-bold text-white">飞书</span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onBack}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-medium text-white hover:bg-white/10 hover:border-white/20 transition-all"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
                返回
              </button>
              <button
                onClick={onSkip}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-medium text-white hover:bg-white/10 hover:border-white/20 transition-all"
              >
                <SkipForward className="w-4 h-4" />
                跳过，稍后配置
              </button>
            </div>
          </div>
        )}

        {selectedChannel && (
          <div className="space-y-6">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white">
                  {selectedChannel === 'weixin' ? '微信' : '飞书'}
                </span>
              </span>
            </div>

            {connecting && !qrData && (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />

                {/* 进度条 */}
                <div className="w-full max-w-sm space-y-2">
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500 ease-out"
                      style={{ width: `${connectionProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{connectionMessage || '正在初始化...'}</span>
                    <span className="text-indigo-400 font-bold">{connectionProgress}%</span>
                  </div>
                </div>
              </div>
            )}

            {qrData && !connected && (
              <div className="flex flex-col items-center gap-4">
                {qrData.type === 'url' ? (
                  <div className="p-4 bg-white rounded-xl">
                    <img
                      src={qrData.data}
                      alt="扫码登录"
                      className="w-48 h-48 object-contain"
                    />
                  </div>
                ) : (
                  <pre className="text-[6px] leading-[6px] font-mono text-white bg-white/5 p-4 rounded-xl whitespace-pre">
                    {qrData.data}
                  </pre>
                )}
                <p className="text-sm text-gray-400">请使用{selectedChannel === 'weixin' ? '微信' : '飞书'}扫描上方二维码</p>
              </div>
            )}

            {connected && (
              <div className="flex flex-col items-center gap-4">
                <CheckCircle2 className="w-12 h-12 text-green-400" />
                <span className="text-lg font-bold text-green-400">✅ 与{selectedChannel === 'weixin' ? '微信' : '飞书'}连接成功！</span>
                <p className="text-sm text-gray-400">你现在可以开始使用 OpenClaw 了</p>
                <button
                  onClick={() => loadStatus()}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold hover:from-indigo-600 hover:to-purple-600 transition-all shadow-lg hover:shadow-xl"
                >
                  <MessageSquare className="w-4 h-4" />
                  进入 OpenClaw
                </button>
              </div>
            )}

            {error && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                  <XCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => onSetupChannel(selectedChannel)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-bold text-white hover:bg-white/10 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重试
                  </button>
                  <button
                    onClick={onSkip}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    跳过
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
// ===== Phase 3: WebChat =====
const WebChatPhase: React.FC<{
  gatewayRunning: boolean
  channels: string[]
  onManageIm: () => void
}> = ({ gatewayRunning, channels, onManageIm }) => {
  const webviewRef = React.useRef<HTMLElement | null>(null)
  const [dashboardUrl, setDashboardUrl] = React.useState<string>('')
  const [urlError, setUrlError] = React.useState<string>('')
  const [token, setToken] = React.useState<string>('')

  React.useEffect(() => {
    // Fetch dashboard URL with token
    const fetchDashboardUrl = async (): Promise<void> => {
      try {
        const url = await window.api.openclawGetDashboardUrl()
        console.log('[OpenClaw] Loading webview with URL:', url)

        // Extract token from URL (format: http://127.0.0.1:18789/#token=xxx)
        const tokenMatch = url.match(/#token=([^&]+)/)
        if (tokenMatch) {
          const extractedToken = tokenMatch[1]
          setToken(extractedToken)
          console.log('[OpenClaw] Extracted token:', extractedToken)
        }

        setDashboardUrl(url)
        setUrlError('')
      } catch (err) {
        console.error('[OpenClaw] Failed to get dashboard URL:', err)
        setUrlError(err instanceof Error ? err.message : 'Failed to get dashboard URL')
      }
    }

    if (gatewayRunning) {
      fetchDashboardUrl()
    }
  }, [gatewayRunning])

  // Auto-connect WebSocket when webview loads
  React.useEffect(() => {
    if (!dashboardUrl || !token || !webviewRef.current) return

    const webview = webviewRef.current as any

    const handleDidFinishLoad = (): void => {
      console.log('[OpenClaw] Webview loaded, injecting WebSocket connection script')

      // Inject script to establish WebSocket connection
      const script = `
        (function() {
          console.log('[OpenClaw Inject] Starting WebSocket connection...');

          // Connect to Gateway WebSocket
          const wsUrl = 'ws://127.0.0.1:18789';
          const token = '${token}';

          try {
            const ws = new WebSocket(wsUrl);

            ws.onopen = function() {
              console.log('[OpenClaw Inject] WebSocket connected');
              // Send authentication message
              ws.send(JSON.stringify({
                type: 'auth',
                token: token
              }));
            };

            ws.onmessage = function(event) {
              console.log('[OpenClaw Inject] WebSocket message:', event.data);
            };

            ws.onerror = function(error) {
              console.error('[OpenClaw Inject] WebSocket error:', error);
            };

            ws.onclose = function() {
              console.log('[OpenClaw Inject] WebSocket closed');
            };
          } catch (error) {
            console.error('[OpenClaw Inject] Failed to create WebSocket:', error);
          }
        })();
      `

      webview.executeJavaScript(script)
    }

    webview.addEventListener('did-finish-load', handleDidFinishLoad)

    return () => {
      webview.removeEventListener('did-finish-load', handleDidFinishLoad)
    }
  }, [dashboardUrl, token])

  if (!gatewayRunning) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <WifiOff className="w-12 h-12 text-gray-500 mx-auto" />
          <h3 className="text-lg font-bold text-white">Gateway 未运行</h3>
          <p className="text-sm text-gray-400">
            OpenClaw Gateway 尚未启动，请重启 DoWhat 应用。
          </p>
        </div>
      </div>
    )
  }

  if (urlError) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <XCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h3 className="text-lg font-bold text-white">获取 Dashboard URL 失败</h3>
          <p className="text-sm text-gray-400 break-all max-w-md">
            {urlError}
          </p>
        </div>
      </div>
    )
  }

  if (!dashboardUrl) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mx-auto" />
          <h3 className="text-lg font-bold text-white">正在获取 Dashboard URL...</h3>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-black/20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[11px] font-bold text-gray-400">在线</span>
          </div>
          {channels.length > 0 && (
            <div className="flex items-center gap-1">
              {channels.map((ch) => (
                <span key={ch} className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-bold text-gray-400">
                  {ch === 'weixin' ? '微信' : ch === 'feishu' ? '飞书' : ch}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onManageIm}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
        >
          管理 IM
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* WebView Container */}
      <div className="flex-1 min-h-0 relative">
        <webview
          ref={webviewRef}
          src={dashboardUrl}
          className="flex-1 w-full h-full"
          style={{ border: 'none' }}
        />
      </div>
    </div>
  )
}
