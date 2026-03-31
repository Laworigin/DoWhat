import React, { useState, useEffect } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'

interface NotificationData {
  message: string
  type: 'abandoned' | 'validated'
  taskTitle: string
}

export const TaskNotification: React.FC = () => {
  const [notification, setNotification] = useState<NotificationData | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const handleNotification = (_event: unknown, data: NotificationData): void => {
      setNotification(data)
      setIsVisible(true)

      // 3秒后自动隐藏
      setTimeout(() => {
        setIsVisible(false)
        // 动画结束后清空数据
        setTimeout(() => setNotification(null), 300)
      }, 3000)
    }

    // 监听主进程发送的通知事件
    window.electron.ipcRenderer.on('task-status-notification', handleNotification)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('task-status-notification')
    }
  }, [])

  if (!notification) return null

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
      style={{ pointerEvents: 'none' }}
    >
      <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl p-4 min-w-[320px] max-w-[400px]">
        <div className="flex items-start gap-3">
          {notification.type === 'abandoned' ? (
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/90 break-words">
              {notification.message}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
