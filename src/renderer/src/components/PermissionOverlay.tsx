import React from 'react'
import { MonitorOff, ExternalLink, ShieldAlert } from 'lucide-react'

interface PermissionOverlayProps {
  onCheckAgain: () => void
}

export const PermissionOverlay: React.FC<PermissionOverlayProps> = ({ onCheckAgain }) => {
  const handleOpenSettings = async (): Promise<void> => {
    await window.api.openSystemPreferences()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="max-w-md w-full p-10 flex flex-col items-center text-center space-y-8 bg-white/5 border border-white/10 rounded-[40px] shadow-2xl shadow-black/60 relative overflow-hidden group">
        {/* Decorative Glow */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/20 blur-[80px] rounded-full group-hover:bg-indigo-500/30 transition-all duration-700"></div>
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/20 blur-[80px] rounded-full group-hover:bg-purple-500/30 transition-all duration-700"></div>

        {/* Icon with breathing effect */}
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full animate-pulse scale-150"></div>
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg relative z-10">
            <MonitorOff className="w-10 h-10 text-white" />
          </div>
        </div>

        <div className="space-y-4 relative z-10">
          <h1 className="text-3xl font-black text-gray-100 tracking-tighter">需要屏幕录制权限</h1>
          <p className="text-[15px] text-gray-400 leading-relaxed font-medium">
            DoWhat 需要获取屏幕画面才能进行 AI 上下文分析。
          </p>
          <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-left space-y-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-[13px] text-gray-300 font-medium">
                我们承诺：所有截图均经过本地极速压缩，并且只会发送给您自行配置的大模型接口，绝不上传至任何第三方服务器。
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 w-full relative z-10">
          <button
            onClick={handleOpenSettings}
            className="flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white text-[16px] font-black px-8 py-4 rounded-2xl transition-all active:scale-95 shadow-2xl shadow-indigo-500/30 w-full group"
          >
            去系统设置中开启
            <ExternalLink className="w-5 h-5 opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>

          <button
            onClick={onCheckAgain}
            className="text-[13px] font-bold text-gray-500 hover:text-gray-300 transition-colors py-2"
          >
            我已开启，点击重试
          </button>
        </div>

        <p className="text-[11px] font-bold text-gray-600 uppercase tracking-widest relative z-10">
          开启权限后，建议重启 DoWhat 以确保最佳体验
        </p>
      </div>
    </div>
  )
}
