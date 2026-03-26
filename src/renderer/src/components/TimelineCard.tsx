import { PlayCircle, CheckCircle, XCircle } from 'lucide-react'

interface TimelineCardProps {
  time: string
  summary: string
  status: 'active' | 'completed' | 'error'
}

export const TimelineCard: React.FC<TimelineCardProps> = ({ time, summary, status }) => (
  <div className="border border-macos-divider rounded-xl p-4 hover:border-white/20 transition-colors bg-white/5">
    <div className="flex items-start">
      <div className="w-16 text-sm text-gray-400 mt-1.5">{time}</div>
      <div className="flex-1">
        <div
          className="
          rounded-xl overflow-hidden mb-3
          transform transition-transform group-hover:scale-[1.02]
        "
        >
          <div className="relative">
            <div
              className="w-full h-32 rounded-lg overflow-hidden"
              style={{
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg width=\"400\" height=\"240\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Crect width=\"100%\" height=\"100%\" fill=\"%231e3a8a\"/%3E%3Cpath d=\"M0 120 L400 120\" stroke=\"%230ea5e9\" stroke-width=\"1\"/%3E%3Cpath d=\"M200 0 L200 240\" stroke=\"%230ea5e9\" stroke-width=\"1\" opacity=\"0.5\"/%3E%3C/svg>")',
                backgroundSize: 'cover',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)'
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-black/10 to-transparent"></div>
              <div className="absolute bottom-2 right-2 bg-black/30 text-xs px-2 py-1 rounded">
                DoWhat UI
              </div>
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-300 mb-2.5">{summary}</p>

        <div className="flex space-x-2">
          {status === 'active' && (
            <span className="flex items-center text-macos-systemBlue text-xs">
              <PlayCircle className="w-3 h-3 mr-1" />
              活动中
            </span>
          )}
          {status === 'completed' && (
            <span className="flex items-center text-macos-systemGreen text-xs">
              <CheckCircle className="w-3 h-3 mr-1" />
              已完成
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center text-macos-systemRed text-xs">
              <XCircle className="w-3 h-3 mr-1" />
              有错误
            </span>
          )}
        </div>
      </div>
    </div>
  </div>
)
