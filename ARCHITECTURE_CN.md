## DoWhat — 架构文档

> **愿景**：构建用户的数字分身——理解你在做什么，帮你梳理该做什么，最终替你完成一部分工作。

---

### DoWhat 是什么

DoWhat 是一款 **AI 驱动的个人工作日志与任务规划桌面应用**。
它通过定时截屏 + 音频采集，结合 AI 视觉分析和语音转文字，自动记录用户的工作上下文，
智能归纳活动摘要，并自动管理待办任务——识别新任务、标记已完成任务、评估优先级。

截屏 + 音频 = **完整的行为轨迹**，覆盖用户在电脑上的一切操作，
包括会议、通话、讨论等仅靠屏幕截图无法捕获的语音内容。

核心价值主张是 **任务规划的准确性**：
帮助用户清晰地看到当前最应该投入时间的事情。

---

### 系统架构

```
+------------------------------------------------------------------+
|                       DoWhat Desktop App                          |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |                   Renderer (React 19)                       |  |
|  |  +-------------+ +-------------+ +-----------+ +----------+|  |
|  |  | ContextView | | BacklogView | | StatsView | | Settings ||  |
|  |  | Timeline    | | Task Board  | | Insights  | | API Key  ||  |
|  |  +-------------+ +-------------+ +-----------+ +----------+|  |
|  +---------------------------+--------------------------------+   |
|                              | IPC (contextBridge)                |
|  +---------------------------+--------------------------------+   |
|  |                     Preload (Bridge)                        |  |
|  |              30+ IPC methods exposed                        |  |
|  +---------------------------+--------------------------------+   |
|                              |                                    |
|  +---------------------------+--------------------------------+   |
|  |                     Main Process                            |  |
|  |  +----------+ +----------+ +----------+ +----------+ +----+  |  |
|  |  | index.ts | | capturer | | recorder | | database | |main|  |  |
|  |  | Window   | | Screen   | | Audio    | | SQLite   | |tena|  |  |
|  |  | IPC Reg  | | AI Pipe  | | STT Pipe | | CRUD     | |nce |  |  |
|  |  +----------+ +----+-----+ +-----+----+ +----------+ +----+  |  |
|  |                     |                                       |  |
|  |  +------------------+------------------------------------+  |  |
|  |  |           AI Prompt Layer (8+ Prompts)                 |  |  |
|  |  |  vision.txt          | summary.txt                    |  |  |
|  |  |  aggregation.ts      | stats_insight.txt              |  |  |
|  |  |  TASK_DISCOVERY      | TASK_COMPLETION                |  |  |
|  |  |  TASK_PRIORITY       | audio_summary.txt (planned)    |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
|                              |                                    |
|  +---------------------------+--------------------------------+   |
|  |                   External Dependencies                     |  |
|  |  +----------+ +----------+ +-------------+ +------------+  |  |
|  |  | OpenAI   | | SQLite   | | macOS Screen| | macOS Audio|  |  |
|  |  | API      | | (local)  | | Capture     | | Capture    |  |  |
|  |  +----------+ +----------+ +-------------+ +------------+  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

---

### 核心：任务规划引擎

> **这是 DoWhat 的心脏。** 其他一切都是为这个引擎服务的。
> 我们会在任务识别的准确性和规划的合理性上持续投入大量精力。

```
+===================================================================+
||                      TASK PLANNING ENGINE                        ||
||                                                                 ||
||  +-------------------------+    +-------------------+             ||
||  |  1. Perception          |    |  2. Memory        |             ||
||  |  (Screen + Audio)       |--->|  (SQLite Local)   |             ||
||  |                         |    |                   |             ||
||  |  Screen:                |    |  * contexts       |             ||
||  |  * 60s interval         |    |  * audio_contexts |             ||
||  |  * Vision AI            |    |  * slot_summaries |             ||
||  |  * Slot summary         |    |  * backlog        |             ||
||  |  * Aggregation          |    |  * token_usage    |             ||
||  |                         |    |                   |             ||
||  |  Audio (planned):       |    |                   |             ||
||  |  * Continuous recording |    |                   |             ||
||  |  * Speech-to-Text (STT) |    |                   |             ||
||  |  * Meeting detection    |    |                   |             ||
||  |  * Audio slot summary   |    |                   |             ||
||  +-------------------------+    +--------+----------+             ||
||                                    |                            ||
||                                    v                            ||
||  +-----------------------------------------------------+       ||
||  |  3. Task Intelligence (3 independent AI calls)       |       ||
||  |                                                      |       ||
||  |  +---------------+  +---------------+  +-----------+ |       ||
||  |  | Discovery     |  | Completion    |  | Priority  | |       ||
||  |  | "What's new?" |  | "What's done?"|  | "What's   | |       ||
||  |  |               |  |               |  |  urgent?" | |       ||
||  |  | IN:  titles + |  | IN:  tasks +  |  | IN: tasks | |       ||
||  |  |   activity    |  |   2h history  |  |  + recent | |       ||
||  |  | OUT: new      |  | OUT: done     |  | OUT: high | |       ||
||  |  |   tasks[]     |  |   task_ids[]  |  |  pri ids[]| |       ||
||  |  +-------+-------+  +-------+-------+  +-----+-----+ |       ||
||  |          |                  |                  |       |       ||
||  |          v                  v                  v       |       ||
||  |  +----------------------------------------------+     |       ||
||  |  |  Local Dedup (2-gram Jaccard > 0.6 = skip)   |     |       ||
||  |  +----------------------------------------------+     |       ||
||  +-----------------------------------------------------+       ||
||                                    |                            ||
||                                    v                            ||
||  +-----------------------------------------------------+       ||
||  |  4. Task Board                                       |       ||
||  |                                                      |       ||
||  |  [Highest Priority]  priority=1, sorted by time      |       ||
||  |  [Daily Tasks]       category=day, sorted by pri     |       ||
||  |  [Backlog]           category=backlog, sorted by pri |       ||
||  |  [Completed]         completed=true, collapsed       |       ||
||  +-----------------------------------------------------+       ||
+===================================================================+
```

**为什么拆成 3 个独立 AI 调用而不是 1 个？**

| 关注点 | 单次调用 | 3 次独立调用 |
|--------|---------|-------------|
| **准确性** | 模型同时做 3 件事，容易混淆 | 每次调用只有一个明确目标 |
| **上下文** | 所有任务共用相同上下文 | 完成判断用 2h 历史；发现只用最近活动 |
| **容错性** | 一个失败 = 全部失败 | 每步独立，部分成功也 OK |
| **可调试性** | 难以定位哪个环节出错 | 每步独立日志和 token 追踪 |

---

### 已实现 vs 待开发

#### 已实现模块

| 模块 | 说明 | 关键文件 |
|------|------|---------|
| **截屏采集** | 60s 间隔，sharp 压缩，Vision AI 分析 | `capturer.ts` |
| **音频采集** | 持续录制麦克风/系统音频，语音转文字，会议检测 | `recorder.ts`（规划中） |
| **Slot 归纳** | 15 分钟聚合原始截图为活动摘要 | `summary.txt`, `aggregation.ts` |
| **新任务识别** | AI 从最近活动中识别新任务 | `TASK_DISCOVERY_PROMPT` |
| **完成状态判断** | AI 判断哪些任务已完成（2h 上下文窗口） | `TASK_COMPLETION_PROMPT` |
| **优先级评估** | AI 评估优先级，支持双向调整 | `TASK_PRIORITY_PROMPT` |
| **本地去重** | 2-gram Jaccard 相似度防止重复任务 | `capturer.ts` |
| **SQLite 存储** | 6 张表，纯本地，无云依赖 | `database.ts` |
| **5 个前端视图** | Context / Backlog / Stats / OpenClaw / Settings | `renderer/src/components/views/` |
| **IPC 通信层** | 30+ 方法连接前后端 | `preload/index.ts` |
| **统计与洞察** | 工作统计、AI 洞察、Token 用量 | `StatsView.tsx`, `stats_insight.txt` |
| **存储维护** | 自动清理过期截图 | `maintenance.ts` |
| **多屏采集** | 采集和分析多个显示器 | `capturer.ts` |
| **跨天任务继承** | 未完成任务自动延续到次日 | `capturer.ts` |
| **OpenClaw 集成** | 自动安装、Gateway 管理、IM 配置、WebView | `openclaw.ts`, `OpenClawView.tsx` |

#### ✅ OpenClaw 集成（已完成）

> **已实现**：下载 DoWhat + 配置 API Key = 直接使用 OpenClaw。
> OpenClaw 提供执行能力；DoWhat 提供大脑。

```
+-------------------------------------------------------------------+
|                    DoWhat + OpenClaw                               |
|                                                                   |
|  +---------------------------+  +------------------------------+  |
|  |      DoWhat (Brain)       |  |     OpenClaw (Hands)         |  |
|  |                           |  |                              |  |
|  |  * Perceive user activity |  |  * Computer Use              |  |
|  |  * Identify tasks         |  |  * Tool Calling              |  |
|  |  * Prioritize work        |  |  * Multi-step execution      |  |
|  |  * Track completion       |  |  * Desktop automation        |  |
|  |  * Provide context        +->+  * Code generation           |  |
|  |                           |  |  * IM 集成（微信/飞书）       |  |
|  |  Reuses existing API Key  |  |  Receives task + context     |  |
|  |  No extra configuration   |  |  Reports results back        |  |
|  +---------------------------+  +------------------------------+  |
+-------------------------------------------------------------------+
```

| 项目 | 说明 | 状态 |
|------|------|------|
| **零额外配置** | 复用 DoWhat 已有的 API Key 和 Endpoint | ✅ 已完成 |
| **自动安装** | 首次启动时自动安装 OpenClaw CLI | ✅ 已完成 |
| **Gateway 管理** | 随应用生命周期自动启停 Gateway 进程 | ✅ 已完成 |
| **IM 连接** | 支持连接微信或飞书进行即时通讯 | ✅ 已完成 |
| **WebView 集成** | 在 DoWhat UI 中嵌入 OpenClaw Dashboard | ✅ 已完成 |
| **上下文注入** | 将 DoWhat 的行为历史注入 OpenClaw Agent | 🔄 规划中 |
| **任务委派** | 从 backlog 一键委派给 OpenClaw 执行 | 🔄 规划中 |
| **结果回写** | OpenClaw 完成后自动更新 backlog 状态 | 🔄 规划中 |
| **本地优先** | 运行在 Electron 内，数据不离开设备 | ✅ 已完成 |

#### 远期：更智能的任务规划

> 这些改进让 DoWhat 的核心价值——**任务规划**——变得更好。

| 功能 | 说明 | 状态 |
|------|------|------|
| **行为模式学习** | 学习用户工作节奏，预测任务优先级 | 规划中 |
| **跨天任务继承** | 更智能地延续未完成任务 | 已实现 |
| **主动建议** | "你已经做这件事 2 小时了，考虑切换一下" | 规划中 |
| **疲劳检测** | 检测低效时段，建议休息 | 规划中 |
| **用户偏好画像** | 随时间构建用户工作风格模型 | 规划中 |
| **多屏支持** | 采集和分析多个显示器 | 已实现 |
| **OpenClaw 集成** | 内置智能体，支持 IM 连接和任务执行 | 已实现 |
| **音频上下文感知** | 通过音频模式检测会议 vs 独立工作 | 规划中 |
| **长期记忆压缩** | 压缩旧摘要以节省上下文窗口 | 规划中 |

---

### 数据流

```
User works at computer
        |
        +------------------+
        |                  |
        v (every 60s)      v (continuous)
+----------------+  +------------------+
| Screen Capture |  | Audio Capture    |
+-------+--------+  | (planned)        |
        |  image    +--------+---------+
        v                    |  audio stream
+----------------+           v
| Vision AI      |    +----------------+
+-------+--------+    | Speech-to-Text |
        |              +-------+--------+
        |  structured          |  transcript
        |  JSON                |
        v                      v
+----------------+     +--------------------+
| contexts table |     | audio_contexts     |
+-------+--------+     +----------+---------+
        |                         |
        +------------+------------+
                     |
                     v (every 15 min)
          +--------------------+
          | Slot Summary       |
          | (screen + audio)   |---->  slot_summaries table
          +----------+---------+
        |
        v (after each slot)
+----------------------------------------------+
| Task Planning Engine (3 AI calls)            |
| Step 1: Discovery  --> backlog INSERT        |
| Step 2: Completion --> backlog UPDATE done    |
| Step 3: Priority   --> backlog UPDATE pri    |
+----------------------------------------------+
        |
        v (IPC push)
+----------------+
| Frontend       | <-- backlog-updated event
| real-time sync |
+----------------+
```

---

### 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | Electron 39 + electron-vite |
| **前端** | React 19 + TypeScript + Tailwind CSS 4 |
| **后端** | Node.js (Electron Main Process) |
| **数据库** | SQLite (better-sqlite3)，纯本地存储 |
| **AI** | OpenAI API（兼容任意 OpenAI 格式的 endpoint） |
| **图像处理** | sharp（截图压缩） |
| **音频处理** | Web Audio API + Whisper STT（规划中） |
| **构建** | electron-builder (macOS / Windows / Linux) |

---

### 项目结构

```
dowhat/
├── src/
│   ├── main/                            # Electron Main Process
│   │   ├── index.ts                     # Window + IPC registration
│   │   ├── capturer.ts                  # Screen capture + AI pipeline
│   │   ├── recorder.ts                  # Audio capture + STT (planned)
│   │   ├── openclaw.ts                  # OpenClaw 安装与 Gateway 管理
│   │   ├── database.ts                  # SQLite (7+ tables)
│   │   ├── maintenance.ts              # Storage cleanup
│   │   └── prompts/                     # AI Prompt layer
│   │       ├── vision.txt               #   Screenshot analysis
│   │       ├── audio_summary.txt        #   Audio segment summary (planned)
│   │       ├── summary.txt              #   15-min slot summary (screen+audio)
│   │       ├── aggregation.ts           #   Cross-slot aggregation
│   │       ├── pipeline_optimization.ts #   Task planning (3 prompts)
│   │       └── stats_insight.txt        #   Statistics insight
│   │
│   ├── preload/                         # IPC Bridge
│   │   ├── index.ts                     #   30+ API methods
│   │   └── index.d.ts                   #   Type declarations
│   │
│   └── renderer/                        # React Frontend
│       └── src/
│           ├── App.tsx                  #   Router + layout
│           ├── components/
│           │   ├── PrimaryNav.tsx        #   Left navigation
│           │   ├── NavItem.tsx           #   Nav item component
│           │   ├── TaskItem.tsx          #   Task card component
│           │   ├── TimelineCard.tsx      #   Timeline card
│           │   ├── SectionHeader.tsx     #   Section header
│           │   ├── PermissionOverlay.tsx #   Permission guide
│           │   └── views/
│           │       ├── ContextView.tsx   #   Timeline + summary + tasks
│           │       ├── BacklogView.tsx   #   Task board (4 groups)
│           │       ├── StatsView.tsx     #   Work stats + AI insights
│           │       ├── OpenClawView.tsx  #   OpenClaw 智能体与 IM 配置
│           │       └── SettingsView.tsx  #   Model configuration
│           └── types/
│               └── electron.d.ts        #   IPC type definitions
│
├── resources/                           # App icons
├── scripts/                             # Build scripts
├── electron-builder.yml                 # Packaging config
├── electron.vite.config.ts              # Vite config
├── tailwind.config.js                   # Tailwind config
└── package.json                         # Dependencies
```

---

### 路线图

```
  v1.0 (已完成)             v2.0 (当前)              v3.0 (未来)
  ================          ================         ================
  感知 + 规划               OpenClaw 集成            更智能的规划

  * 屏幕截图                * OpenClaw 自动安装      * 行为模式学习
  * Vision AI 分析          * Gateway 管理           * 主动建议
  * 15 分钟时间槽摘要       * IM 连接                * 疲劳检测
  * 任务自动管理            * WebView 集成           * 音频上下文感知
  * 统计与洞察              * 音频采集 + STT         * 用户偏好画像
  * 本地 SQLite             * Agent 对话面板         * 长期记忆压缩
  * 多屏支持                * 任务委派               * 上下文注入
  ================          ================         ================
       已完成                   部分完成                 规划中
```
