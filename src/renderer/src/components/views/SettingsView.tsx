import { useState, useEffect } from 'react'
import {
  BookOpen,
  Monitor,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Plus,
  Minus,
  Eye,
  EyeOff
} from 'lucide-react'

const ModelConfigForm: React.FC = () => {
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState('https://dashscope.aliyuncs.com/compatible-mode/v1')
  const [modelName, setModelName] = useState('qwen-turbo')
  const [isApiKeyMissing, setIsApiKeyMissing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testAnswer, setTestAnswer] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    const loadSettings = async (): Promise<void> => {
      const savedKey = await window.api.getSettings('api_key')
      const savedEndpoint = await window.api.getSettings('endpoint')
      const savedModel = await window.api.getSettings('model_name')
      if (savedKey) {
        setApiKey(savedKey)
        setIsApiKeyMissing(false)
        // 如果有保存的 key，我们假设它之前是连通的，或者你可以选择在启动时静默验证一次
        setIsConnected(true)
      } else {
        setIsApiKeyMissing(true)
        setIsConnected(false)
      }
      if (savedEndpoint) setEndpoint(savedEndpoint)
      if (savedModel) setModelName(savedModel)
    }
    loadSettings()
  }, [])

  const saveAndTestConnection = async (): Promise<void> => {
    if (!apiKey.trim()) {
      setTestResult('error')
      setTestAnswer('请输入 API Key')
      return
    }

    setTesting(true)
    setTestResult(null)
    setTestAnswer('')
    try {
      console.log('[Settings] Starting save and test connection...', { endpoint, modelName })
      // 保存到 SQLite
      await window.api.saveSettings('api_key', apiKey)
      await window.api.saveSettings('endpoint', endpoint)
      await window.api.saveSettings('model_name', modelName)

      console.log('[Settings] Saved settings to DB, now calling testLLMConnection...')
      // 调用真实的 LLM 接口测试 1+1
      if (typeof window.api.testLLMConnection !== 'function') {
        throw new Error(
          'window.api.testLLMConnection is not a function. Preload script might not have been updated.'
        )
      }
      const result = await window.api.testLLMConnection(apiKey, endpoint, modelName)
      console.log('[Settings] testLLMConnection result:', result)

      if (result.success) {
        setTestResult('success')
        // 成功时不再展示具体回答，只在控制台打印
        setTestAnswer('')
        setIsApiKeyMissing(false)
        setIsConnected(true)

        // 3秒后自动隐藏成功提示
        setTimeout(() => {
          setTestResult(null)
        }, 3000)
      } else {
        setTestResult('error')
        setTestAnswer(result.error || '连接测试失败，请检查 API Key 和 Endpoint')
        setIsConnected(false)
      }
    } catch (error) {
      console.error('[Settings] Error during test connection:', error)
      setTestResult('error')
      setTestAnswer(`系统错误: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">模型配置</h2>
        {isConnected && (
          <div className="flex items-center px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 rounded-full bg-green-500 mr-2 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
            <span className="text-xs font-medium text-green-400">已接入</span>
          </div>
        )}
      </div>

      {isApiKeyMissing && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 p-4 rounded-xl mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-bold">请先配置您的 API Key</h3>
            <p className="text-sm text-yellow-400/80 mt-1">
              AI 上下文分析功能需要连接到大模型服务。请填入您的 API Key 以启用核心功能。
            </p>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2.5">API Key</label>
          <div className="relative group">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="
                w-full
                p-3.5
                pr-12
                bg-macos-cardBg
                border border-macos-divider
                rounded-xl
                focus:outline-none
                focus:border-macos-systemBlue
                transition-colors
                text-white
              "
              placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="
                absolute
                right-3.5
                top-1/2
                -translate-y-1/2
                p-1.5
                text-gray-500
                hover:text-gray-300
                transition-colors
                focus:outline-none
              "
              title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
            >
              {showApiKey ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2.5">Endpoint 接入点</label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="
              w-full
              p-3.5
              bg-macos-cardBg
              border border-macos-divider
              rounded-xl
              text-white
              focus:outline-none
              focus:border-macos-systemBlue
            "
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2.5">
            模型名称 (Model Name)
          </label>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="
              w-full
              p-3.5
              bg-macos-cardBg
              border border-macos-divider
              rounded-xl
              text-white
              focus:outline-none
              focus:border-macos-systemBlue
            "
            placeholder="e.g., qwen-turbo, gpt-4, etc."
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={saveAndTestConnection}
            disabled={testing}
            className="
              px-5 py-2.5
              bg-macos-systemBlue
              hover:bg-opacity-90
              rounded-xl
              font-medium
              transition-colors
              flex items-center
              text-white
            "
          >
            {testing ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                正在验证...
              </>
            ) : (
              '保存并验证'
            )}
          </button>
        </div>

        {testResult && (
          <div
            className={`
              p-3.5
              rounded-xl
              flex flex-col
              mt-2
              ${
                testResult === 'success'
                  ? 'bg-green-900/30 text-green-200'
                  : 'bg-red-900/30 text-red-200'
              }
            `}
          >
            <div className="flex items-center">
              {testResult === 'success' ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  <span className="font-medium">验证成功！</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 mr-2" />
                  <span className="font-medium">验证失败</span>
                </>
              )}
            </div>
            {testResult === 'error' && testAnswer && (
              <div className="mt-2 text-sm opacity-90 pl-6">{testAnswer}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const MonitorSettingsForm: React.FC = () => {
  const [interval, setIntervalValue] = useState<number>(5)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    const loadSettings = async (): Promise<void> => {
      const savedInterval = await window.api.getSettings('capture_interval')
      if (savedInterval) {
        setIntervalValue(parseInt(savedInterval, 10))
      }
    }
    loadSettings()
  }, [])

  const handleSave = async (): Promise<void> => {
    if (interval < 5 || interval > 120 || interval % 5 !== 0) {
      setSaveMessage('频率必须在 5 到 120 之间，且为 5 的倍数')
      return
    }

    setIsSaving(true)
    try {
      await window.api.saveSettings('capture_interval', interval.toString())
      setSaveMessage('保存成功！')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save monitor settings:', error)
      setSaveMessage('保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  const handleIncrement = (): void => {
    setIntervalValue((prev) => Math.min(120, prev + 5))
  }

  const handleDecrement = (): void => {
    setIntervalValue((prev) => Math.max(5, prev - 5))
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-medium">监控偏好</h2>
      <div className="space-y-5">
        <div>
          <div className="text-sm font-medium mb-2.5">屏幕监控频率 (秒)</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-macos-cardBg border border-macos-divider rounded-xl overflow-hidden">
              <button
                onClick={handleDecrement}
                disabled={interval <= 5}
                className="p-3.5 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="number"
                min="5"
                max="120"
                step="5"
                value={interval}
                onChange={(e) => setIntervalValue(Number(e.target.value))}
                className="
                  w-16
                  text-center
                  bg-transparent
                  text-white
                  focus:outline-none
                  [appearance:textfield]
                  [&::-webkit-outer-spin-button]:appearance-none
                  [&::-webkit-inner-spin-button]:appearance-none
                "
              />
              <button
                onClick={handleIncrement}
                disabled={interval >= 120}
                className="p-3.5 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <span className="text-sm text-gray-400">最小 5 秒，最大 120 秒，必须是 5 的倍数。</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4">
          {saveMessage && (
            <span
              className={`text-sm ${saveMessage.includes('成功') ? 'text-green-400' : 'text-red-400'}`}
            >
              {saveMessage}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="
              px-5 py-2.5
              bg-macos-systemBlue
              hover:bg-opacity-90
              rounded-xl
              font-medium
              text-white
              transition-colors
            "
          >
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}

const AboutSection: React.FC = () => (
  <div className="space-y-6">
    <h2 className="text-xl font-medium">关于 DoWhat</h2>
    <div className="space-y-4.5">
      <div>
        <div className="text-sm text-gray-400">版本</div>
        <div>v1.0.0</div>
      </div>
      <div>
        <div className="text-sm text-gray-400">构建信息</div>
        <div>2026-03-23</div>
      </div>
      <div>
        <div className="text-sm text-gray-400">开源协议</div>
        <div>MIT License</div>
      </div>
    </div>
  </div>
)

interface SettingsViewProps {
  activeTab: string
  setActiveTab: (tab: string) => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({ activeTab, setActiveTab }) => (
  <div className="flex-1 flex bg-black/10 backdrop-blur-md text-white font-sans">
    <div className="w-64 p-4 border-r border-macos-divider">
      {[
        { id: 'model', icon: BookOpen, label: '模型配置' },
        { id: 'monitor', icon: Monitor, label: '监控偏好' },
        { id: 'about', icon: Info, label: '关于' }
      ].map((tab) => (
        <div
          key={tab.id}
          className={`
            flex items-center
            h-12
            px-5
            rounded-xl
            cursor-pointer
            transition-all
            duration-200
            mb-1
            ${
              activeTab === tab.id
                ? 'bg-white/10 border border-macos-divider text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/5 hover:text-white hover:backdrop-blur-sm'
            }
          `}
          onClick={() => setActiveTab(tab.id)}
        >
          <tab.icon
            className={`w-4 h-4 mr-3.5 ${activeTab === tab.id ? 'text-macos-systemBlue' : ''}`}
          />
          <span className="text-sm font-medium">{tab.label}</span>
          {activeTab === tab.id && (
            <div className="ml-auto w-1.5 h-1.5 bg-macos-systemBlue rounded-full shadow-[0_0_8px_rgba(0,122,255,0.5)]"></div>
          )}
        </div>
      ))}
    </div>

    <div className="flex-1 p-8 overflow-y-auto">
      {activeTab === 'model' && <ModelConfigForm />}
      {activeTab === 'monitor' && <MonitorSettingsForm />}
      {activeTab === 'about' && <AboutSection />}
    </div>
  </div>
)
