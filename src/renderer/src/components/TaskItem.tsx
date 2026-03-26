import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface TaskItemProps {
  task: string
  isP0?: boolean
  index: number
  onEdit: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export const TaskItem: React.FC<TaskItemProps> = ({ task, isP0, index, onEdit }) => (
  <div
    className={`
      p-4 rounded-xl
      border
      transition-all
      duration-200
      group
      ${isP0 ? 'border-2 border-macos-systemRed/30' : 'border-macos-divider'}
    `}
  >
    <div className="flex items-start">
      {isP0 && <AlertTriangle className="w-4 h-4 mt-0.5 mr-3 text-macos-systemRed flex-shrink-0" />}
      <input
        type="text"
        value={task}
        onChange={onEdit}
        placeholder={isP0 ? '输入高优任务...' : '输入常规任务...'}
        className={`
          flex-1
          bg-transparent
          outline-none
          text-sm
          ${isP0 ? 'text-white' : 'text-gray-300'}
          ${index === 0 && isP0 ? 'animate-pulse-slow' : ''}
        `}
      />
    </div>
  </div>
)
