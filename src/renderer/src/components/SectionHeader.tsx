import React from 'react'

interface SectionHeaderProps {
  title: string
  count: number
  total: number
  isP0?: boolean
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, count, total, isP0 }) => (
  <div className="flex items-center justify-between mb-5">
    <h2
      className={`
      text-lg font-medium
      ${isP0 ? 'text-macos-systemRed' : 'text-white'}
    `}
    >
      {title}
    </h2>
    <span className="text-sm text-gray-400">
      {count}/{total}
    </span>
  </div>
)
