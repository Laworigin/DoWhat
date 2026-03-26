import React from 'react'
import { LucideProps } from 'lucide-react'

interface NavItemProps {
  icon: React.ComponentType<LucideProps>
  label: string
  active: boolean
  onClick: () => void
}

export const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, onClick }) => (
  <li
    className={`
      flex items-center
      h-12
      px-5
      rounded-xl
      cursor-pointer
      transition-all
      duration-200
      ${
        active
          ? 'bg-white/10 border border-macos-divider text-white'
          : 'text-gray-400 hover:bg-white/5 hover:text-white hover:backdrop-blur-sm'
      }
    `}
    onClick={onClick}
  >
    <Icon className="w-5 h-5 mr-3.5" />
    {label}
    {active && <div className="ml-auto w-1.5 h-1.5 bg-macos-systemBlue rounded-full"></div>}
  </li>
)
