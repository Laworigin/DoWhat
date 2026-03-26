module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        4: '4px',
        8: '8px',
        12: '12px',
        16: '16px',
        20: '20px',
        24: '24px',
        28: '28px',
        32: '32px',
        36: '36px',
        40: '40px',
        44: '44px',
        48: '48px'
      },
      colors: {
        macos: {
          systemBlue: '#007AFF',
          systemRed: '#FF3B30',
          systemGreen: '#34C759',
          sidebarBg: 'rgba(24, 24, 28, 0.7)',
          cardBg: 'rgba(36, 36, 40, 0.7)',
          divider: 'rgba(84, 84, 88, 0.3)'
        }
      }
    }
  },
  plugins: []
}
