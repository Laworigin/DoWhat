<div align="center">

# DoWhat · 做啥

**AI 时代的个人职场智能体分身 — 你的工作，从此有了数字化的记忆与大脑**

[English](./README.md) · [提交 Bug](https://github.com/your-repo/issues) · [功能建议](https://github.com/your-repo/issues)

![平台](https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/electron-39-47848F?logo=electron)
![React](https://img.shields.io/badge/react-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/typescript-5-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## DoWhat 是什么？

DoWhat（做啥）不只是一款桌面软件——它是你在 AI 时代的**个人职场智能体分身**，一个常驻本地、持续感知、自主规划的数字化工作大脑。

DoWhat 内置集成了 **[OpenClaw](https://github.com/openclaw/openclaw)**，以智能体（Agent）的方式运作：每 15 秒静默感知你的屏幕，通过 AI 视觉理解你当前的工作意图，自主将你的工作整理成结构化的活动记录，并主动维护你的任务 Backlog——全程无需你手动操作。

把它想象成给自己配备了一个**永不下班的 AI 工作助理**。你专注于执行，DoWhat 的智能体层在后台持续感知、推理、规划。每天结束时，你将获得一份完整的、由 AI 整理的工作全景：做了什么、还剩什么、下一步该做什么。

> **隐私优先**：所有数据（截图、AI 分析结果、数据库）均存储在本地设备上。除了你自行配置的 AI API 调用外，不会向任何服务器发送任何数据。

---

## ✨ 功能特性

### 🔍 被动式屏幕感知
- 每 **15 秒**自动截取一次屏幕
- 使用 AI 视觉（兼容 OpenAI 的 API）分析屏幕内容，推断当前意图
- 识别当前活跃应用、任务上下文和标签（如 `#IDE`、`#Browser`、`#Terminal`）

### 📊 Context 看板
- 将活动按 **15 分钟时间槽**分组，并生成 AI 摘要
- 24 小时活动密度可视化时间轴
- 截图缩略图网格，默认展示前两行预览，点击可展开查看全部截图
- 当前意图卡片，实时显示 AI 对你正在做什么的判断

### 📋 Backlog 与任务管理
- AI 自动从工作上下文中提取任务并加入 Backlog
- 简洁的待办清单样式，随时勾选完成
- Pipeline 面板展示今日任务，支持 AI 优先级建议

### 📈 统计与复盘
- 每日活动统计，包含 Token 用量和费用追踪
- AI 生成的工作模式洞察报告
- 按日期查看历史记录

### ⚙️ 高度可配置
- 自带 OpenAI 兼容 API Key（支持任意兼容提供商）
- 可配置截图间隔、模型选择等参数
- 数据存储在系统 `userData` 目录，应用更新后数据安全保留

---

## 🏗️ 架构设计

```
DoWhat
├── 主进程 (Electron)
│   ├── capturer.ts        — 截图捕获循环（每 15 秒）
│   ├── database.ts        — SQLite 本地存储（better-sqlite3）
│   └── index.ts           — IPC 处理器、AI API 调用
├── 渲染进程 (React + TypeScript)
│   ├── ContextView        — 主看板：时间轴、截图网格
│   ├── BacklogView        — 任务 Backlog 与 Pipeline 面板
│   ├── StatsView          — 使用统计与洞察报告
│   └── SettingsView       — API Key、模型与偏好设置
└── Prompts（AI 提示词）
    ├── aggregation        — 时间槽摘要生成提示词
    └── pipeline_optimization — Backlog 任务提取提示词
```

**技术栈**：Electron 39 · React 19 · TypeScript 5 · Tailwind CSS 4 · SQLite (better-sqlite3) · OpenAI SDK · electron-vite

---

## 🚀 快速开始

### 环境要求

- **Node.js** 18+
- 一个 **OpenAI 兼容的 API Key**（OpenAI、Azure OpenAI 或任意兼容提供商）
- macOS（推荐）、Windows 或 Linux

### 安装

```bash
# 克隆仓库
git clone https://github.com/your-repo/dowhat.git
cd dowhat

# 安装依赖
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

### 首次使用配置

1. 启动应用
2. 点击侧边栏的 **系统设置**（⚙️）
3. 填入你的 OpenAI 兼容 API Key 和 Base URL
4. 选择你偏好的视觉模型（如 `gpt-4o`、`gpt-4o-mini`）
5. 点击左下角的 **开启 AI 感知** 开始截图捕获

---

## 🔒 隐私与数据

| 数据类型 | 存储位置 |
|---------|---------|
| 截图文件 | `~/Library/Application Support/DoWhat/snapshots/`（macOS） |
| 数据库 | `~/Library/Application Support/DoWhat/dowhat.db` |
| API 调用 | 仅发送至你配置的 API 端点 |

无遥测。无云同步。无需注册账号。

---

## 🛠️ 开发指南

### 推荐 IDE

[VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

### 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 类型检查并构建
npm run lint         # 运行 ESLint
npm run typecheck    # 运行 TypeScript 类型检查
npm run format       # 使用 Prettier 格式化代码
```

### 项目结构

```
src/
├── main/            # Electron 主进程
│   ├── capturer.ts  # 屏幕捕获与 AI 分析循环
│   ├── database.ts  # SQLite 数据库操作
│   ├── index.ts     # 应用入口、IPC 处理器
│   └── prompts/     # AI 提示词模板
├── preload/         # Electron 预加载脚本
└── renderer/        # React 前端
    └── src/
        ├── components/
        │   ├── views/   # 页面级组件
        │   └── ...
        └── App.tsx
```

---

## 🗺️ 路线图

- [ ] 多显示器支持
- [ ] 导出活动报告（PDF / Markdown）
- [ ] 周报 / 月报汇总
- [ ] 自定义 AI 提供商插件系统
- [ ] 移动端伴侣应用（远程查看）

---

## 🤝 参与贡献

欢迎提交 Pull Request！

1. Fork 本仓库
2. 创建你的功能分支（`git checkout -b feature/amazing-feature`）
3. 提交你的改动（`git commit -m 'Add some amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 发起 Pull Request

---

## ⭐ Star 增长曲线

<a href="https://www.star-history.com/?repos=Laworigin%2FDoWhat&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Laworigin/DoWhat&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Laworigin/DoWhat&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Laworigin/DoWhat&type=date&legend=top-left" />
  </picture>
</a>

---

## 📄 开源协议

本项目基于 MIT 协议开源，详见 [LICENSE](LICENSE) 文件。

---

<div align="center">
用 ❤️ 打造 by DoWhat · <a href="./README.md">View English Docs</a>
</div>
