import React, { useState, useEffect } from 'react'
import { PrimaryNav } from './components/PrimaryNav'
import { ContextView } from './components/views/ContextView'
import { SettingsView } from './components/views/SettingsView'
import { BacklogView } from './components/views/BacklogView'
import { StatsView } from './components/views/StatsView'
import { PermissionOverlay } from './components/PermissionOverlay'
import { OpenClawView } from './components/views/OpenClawView'
import { TaskNotification } from './components/TaskNotification'

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-screen bg-black/40 backdrop-blur-3xl text-white font-sans antialiased select-none overflow-hidden relative">
    {/* 全宽拖拽条 - 覆盖窗口顶部，高度与 hiddenInset 红绿灯对齐 */}
    <div
      className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
      style={{ height: '28px', WebkitAppRegion: 'drag' } as React.CSSProperties}
    />
    {children}
  </div>
)

function App(): React.ReactElement {
  const [activeSection, setActiveSection] = useState('context')
  const [settingsTab, setSettingsTab] = useState('model')
  const [hasPermission, setHasPermission] = useState<boolean>(true)
  const [isCapturing, setIsCapturing] = useState<boolean>(false)

  const checkPermission = async (): Promise<void> => {
    // @ts-ignore: window.api is injected via preload script
    const status = await window.api.checkScreenPermission()
    setHasPermission(status === 'granted')
  }

  const toggleCapturing = async (): Promise<void> => {
    if (!isCapturing) {
      // @ts-ignore: window.api is injected via preload script
      const apiKey = await window.api.getSettings('api_key')
      if (!apiKey) {
        alert('请先在设置中配置 API Key')
        setActiveSection('settings')
        setSettingsTab('model')
        return
      }
    }

    const nextState = !isCapturing
    // @ts-ignore: window.api is injected via preload script
    await window.api.toggleCapture(nextState)
    setIsCapturing(nextState)
  }

  useEffect(() => {
    const init = async (): Promise<void> => {
      await checkPermission()
    }
    init()
    // 轮询检查权限，方便用户在后台开启后无感恢复
    const timer = setInterval(checkPermission, 3000)

    // 监听主进程推送的新 context
    window.electron.ipcRenderer.on('new-context-saved', (_event, newContext) => {
      // 这里可以触发一个 toast 通知，或者直接更新对应视图的状态
      console.log('New context received from main process:', newContext)
    })

    return () => {
      clearInterval(timer)
      window.electron.ipcRenderer.removeAllListeners('new-context-saved')
    }
  }, [])

  return (
    <MainLayout>
      {!hasPermission && <PermissionOverlay onCheckAgain={checkPermission} />}
      <TaskNotification />
      <PrimaryNav
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        isCapturing={isCapturing}
        toggleCapturing={toggleCapturing}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {activeSection === 'context' && <ContextView />}

        {activeSection === 'backlog' && <BacklogView />}

        {activeSection === 'stats' && <StatsView />}

        {activeSection === 'settings' && (
          <SettingsView activeTab={settingsTab} setActiveTab={setSettingsTab} />
        )}

        {activeSection === 'openclaw' && <OpenClawView />}
      </main>
    </MainLayout>
  )
}

export default App
