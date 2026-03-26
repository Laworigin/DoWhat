<div align="center">

# DoWhat · 做啥

**Your AI-native personal work agent — an intelligent digital twin for your professional life**

[中文文档](./README_CN.md) · [Report Bug](https://github.com/your-repo/issues) · [Request Feature](https://github.com/your-repo/issues)

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/electron-39-47848F?logo=electron)
![React](https://img.shields.io/badge/react-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/typescript-5-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## What is DoWhat?

DoWhat (做啥) is not just a desktop app — it's your **AI-native personal work agent**, a digital twin that lives on your machine and silently builds a complete picture of your professional life.

Powered by built-in **[OpenClaw](https://github.com/openclaw/openclaw)** integration, DoWhat acts as an always-on agentic co-pilot: it **observes your screen every 15 seconds**, uses AI vision to understand your current intent, autonomously organizes your work into structured activity sessions, and proactively manages your task backlog — all without you lifting a finger.

Think of it as giving yourself a **second brain for work**. While you focus on execution, DoWhat's agent layer is continuously perceiving, reasoning, and planning in the background. At the end of the day, you get a complete, AI-curated record of what you did, what's pending, and what matters next.

> **Privacy first**: All data (screenshots, AI analysis, database) is stored locally on your machine. Nothing is sent to any server except the AI API calls you configure.

---

## ✨ Features

### 🔍 Passive Screen Awareness
- Captures a screenshot every **15 seconds** automatically
- Uses AI vision (OpenAI-compatible API) to analyze screen content and infer your current intent
- Detects active application, task context, and tags (e.g. `#IDE`, `#Browser`, `#Terminal`)

### 📊 Context Dashboard
- Groups activity into **15-minute time slots** with AI-generated summaries
- Visual timeline showing your activity density across 24 hours
- Snapshot grid with preview thumbnails — expand any slot to see all screenshots
- Current intent card showing what AI thinks you're doing right now

### 📋 Backlog & Task Management
- AI automatically extracts tasks from your work context and adds them to a backlog
- Simple todo-style checklist — mark tasks as done as you go
- Pipeline panel showing today's tasks with AI-suggested priorities

### 📈 Stats & Review
- Daily activity statistics with token usage and cost tracking
- AI-generated insights about your work patterns
- Historical review by date

### ⚙️ Fully Configurable
- Bring your own OpenAI-compatible API key (supports any provider)
- Configurable capture interval, model selection, and more
- Data stored in system `userData` directory — safe across app updates

---

## 🏗️ Architecture

```
ContextAgent
├── Main Process (Electron)
│   ├── capturer.ts        — Screenshot capture loop (every 15s)
│   ├── database.ts        — SQLite via better-sqlite3 (local storage)
│   └── index.ts           — IPC handlers, AI API calls
├── Renderer (React + TypeScript)
│   ├── ContextView        — Main dashboard: timeline, snapshot grid
│   ├── BacklogView        — Task backlog and pipeline panel
│   ├── StatsView          — Usage statistics and insights
│   └── SettingsView       — API key, model, and preferences
└── Prompts
    ├── aggregation        — Slot summary generation prompt
    └── pipeline_optimization — Backlog task extraction prompt
```

**Tech Stack**: Electron 39 · React 19 · TypeScript 5 · Tailwind CSS 4 · SQLite (better-sqlite3) · OpenAI SDK · electron-vite

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- An **OpenAI-compatible API key** (OpenAI, Azure OpenAI, or any compatible provider)
- macOS (recommended), Windows, or Linux

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/dowhat.git
cd dowhat

# Install dependencies
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

### First-time Setup

1. Launch the app
2. Go to **Settings** (⚙️ in the sidebar)
3. Enter your OpenAI-compatible API key and base URL
4. Select your preferred vision model (e.g. `gpt-4o`, `gpt-4o-mini`)
5. Click **Start AI Sensing** at the bottom left to begin capture

---

## 🔒 Privacy & Data

| What | Where |
|------|-------|
| Screenshots | `~/Library/Application Support/DoWhat/snapshots/` (macOS) |
| Database | `~/Library/Application Support/DoWhat/dowhat.db` |
| API calls | Sent to your configured API endpoint only |

No telemetry. No cloud sync. No accounts required.

---

## 🛠️ Development

### Recommended IDE

[VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

### Scripts

```bash
npm run dev          # Start development server
npm run build        # Type-check and build
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript type checking
npm run format       # Format with Prettier
```

### Project Structure

```
src/
├── main/            # Electron main process
│   ├── capturer.ts  # Screen capture & AI analysis loop
│   ├── database.ts  # SQLite database operations
│   ├── index.ts     # App entry, IPC handlers
│   └── prompts/     # AI prompt templates
├── preload/         # Electron preload scripts
└── renderer/        # React frontend
    └── src/
        ├── components/
        │   ├── views/   # Page-level components
        │   └── ...
        └── App.tsx
```

---

## 🗺️ Roadmap

- [ ] Multi-monitor support
- [ ] Export activity report (PDF / Markdown)
- [ ] Weekly / monthly review summaries
- [ ] Plugin system for custom AI providers
- [ ] Mobile companion app for remote review

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## ⭐ Star History

[![GitHub stars](https://img.shields.io/github/stars/Laworigin/DoWhat?style=social)](https://github.com/Laworigin/DoWhat/stargazers)

[![Star History Chart](https://api.star-history.com/svg?repos=Laworigin/DoWhat&type=Date)](https://star-history.com/#Laworigin/DoWhat&Date)

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Made with ❤️ by DoWhat · <a href="./README_CN.md">查看中文文档</a>
</div>
