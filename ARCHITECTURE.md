## DoWhat — Architecture

> **Vision**: Build a digital twin that understands what you're doing,
> helps you figure out what to focus on, and eventually does part of the work for you.

---

### What is DoWhat

DoWhat is an **AI-powered personal work journal & task planner**.
It captures screenshots and audio, analyzes them with AI vision and speech-to-text,
and automatically manages your task backlog — identifying new tasks, marking
completed ones, and prioritizing what matters most.

Screenshot + Audio = **complete behavioral trajectory** of everything you do on your computer,
including meetings, calls, and conversations that screens alone cannot capture.

The core value proposition is **task planning accuracy**:
helping users clearly see what they should invest their time in right now.

---

### System Architecture

```
+------------------------------------------------------------------+
|                         DoWhat Desktop App                        |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |                     Renderer (React 19)                     |  |
|  |  +-------------+ +-------------+ +-----------+ +----------+|  |
|  |  | ContextView | | BacklogView | | StatsView | | Settings ||  |
|  |  | Timeline    | | Task Board  | | Insights  | | API Key  ||  |
|  |  +-------------+ +-------------+ +-----------+ +----------+|  |
|  +---------------------------+--------------------------------+   |
|                              | IPC (contextBridge)                |
|  +---------------------------+--------------------------------+   |
|  |                     Preload (Bridge)                        |  |
|  |                30+ IPC methods exposed                      |  |
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
|  |  |            AI Prompt Layer (8+ Prompts)                |  |  |
|  |  |  vision.txt          | summary.txt                    |  |  |
|  |  |  aggregation.ts      | stats_insight.txt              |  |  |
|  |  |  TASK_DISCOVERY      | TASK_COMPLETION                |  |  |
|  |  |  TASK_PRIORITY       | audio_summary.txt (planned)    |  |  |
|  |  +-------------------------------------------------------+  |  |
|  +-------------------------------------------------------------+  |
|                              |                                    |
|  +---------------------------+--------------------------------+   |
|  |                    External Dependencies                    |  |
|  |  +----------+ +----------+ +-------------+ +------------+  |  |
|  |  | OpenAI   | | SQLite   | | macOS Screen| | macOS Audio|  |  |
|  |  | API      | | (local)  | | Capture     | | Capture    |  |  |
|  |  +----------+ +----------+ +-------------+ +------------+  |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

---

### Core: Task Planning Engine

> **This is the heart of DoWhat.** Everything else exists to serve this engine.
> We will invest heavily in improving task identification accuracy
> and planning rationality.

```
+===================================================================+
||                    TASK PLANNING ENGINE                          ||
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
||  |  4. Task Board (User-facing)                         |       ||
||  |                                                      |       ||
||  |  [Highest Priority]  priority=1, sorted by time      |       ||
||  |  [Daily Tasks]       category=day, sorted by pri     |       ||
||  |  [Backlog]           category=backlog, sorted by pri |       ||
||  |  [Completed]         completed=true, collapsed       |       ||
||  +-----------------------------------------------------+       ||
+===================================================================+
```

**Why 3 separate AI calls instead of 1?**

| Concern | Single call | 3 separate calls |
|---------|-------------|------------------|
| **Accuracy** | Model tries to do 3 things at once, often gets confused | Each call has a single clear objective |
| **Context** | Same context for all tasks | Completion check gets 2h history; Discovery gets only recent |
| **Fault tolerance** | One failure = everything fails | Each step independent, partial success OK |
| **Debuggability** | Hard to tell which part went wrong | Clear per-step logging and token tracking |

---

### What's Built vs What's Next

#### Already Implemented

| Module | Description | Key Files |
|--------|-------------|-----------|
| **Screen Capture** | 60s interval, sharp compression, Vision AI analysis | `capturer.ts` |
| **Audio Capture** | Continuous mic/system audio recording, STT, meeting detection | `recorder.ts` (planned) |
| **Slot Summary** | 15-min aggregation of raw captures into activity summaries | `summary.txt`, `aggregation.ts` |
| **Task Discovery** | AI identifies new tasks from recent activity | `TASK_DISCOVERY_PROMPT` |
| **Task Completion** | AI judges which tasks are done (2h context window) | `TASK_COMPLETION_PROMPT` |
| **Task Priority** | AI evaluates priority, bidirectional adjustment | `TASK_PRIORITY_PROMPT` |
| **Local Dedup** | 2-gram Jaccard similarity prevents duplicate tasks | `capturer.ts` |
| **SQLite Storage** | 6 tables, fully local, no cloud dependency | `database.ts` |
| **4 Frontend Views** | Context / Backlog / Stats / Settings | `renderer/src/components/views/` |
| **IPC Bridge** | 30+ methods connecting frontend to backend | `preload/index.ts` |
| **Stats & Insights** | Work statistics, AI-generated insights, token usage | `StatsView.tsx`, `stats_insight.txt` |
| **Storage Maintenance** | Auto-cleanup of old screenshots | `maintenance.ts` |
| **Multi-screen** | Capture and analyze multiple displays | `capturer.ts` |
| **Cross-day Inheritance** | Auto carry-over unfinished tasks to next day | `capturer.ts` |

#### Next Milestone: OpenClaw Integration

> **Goal**: Download DoWhat + configure API Key = ready to use OpenClaw.
> OpenClaw provides the execution capability; DoWhat provides the brain.

```
+-------------------------------------------------------------------+
|                    DoWhat + OpenClaw                               |
|                                                                   |
|  +---------------------------+  +------------------------------+  |
|  |        DoWhat (Brain)     |  |     OpenClaw (Hands)         |  |
|  |                           |  |                              |  |
|  |  * Perceive user activity |  |  * Computer Use              |  |
|  |  * Identify tasks         |  |  * Tool Calling              |  |
|  |  * Prioritize work        |  |  * Multi-step execution      |  |
|  |  * Track completion       |  |  * Desktop automation        |  |
|  |  * Provide context        +->+  * Code generation           |  |
|  |                           |  |                              |  |
|  |  Reuses existing API Key  |  |  Receives task + context     |  |
|  |  No extra configuration   |  |  Reports results back        |  |
|  +---------------------------+  +------------------------------+  |
+-------------------------------------------------------------------+
```

| Item | Detail |
|------|--------|
| **Zero config** | Reuses DoWhat's existing API Key and Endpoint |
| **Context injection** | Feeds DoWhat's behavioral history into OpenClaw Agent |
| **Task delegation** | One-click delegate from backlog to OpenClaw |
| **Result writeback** | OpenClaw auto-updates backlog on completion |
| **Local-first** | Runs inside Electron, data stays on device |

#### Future: Smarter Task Planning

> These improvements make DoWhat's core value — **task planning** — even better.

| Feature | Description | Status |
|---------|-------------|--------|
| **Behavior pattern learning** | Learn user's work rhythms to predict task priority | Planned |
| **Cross-day task inheritance** | Smarter carry-over of unfinished tasks | Done |
| **Proactive suggestions** | "You've been on this for 2h, consider switching" | Planned |
| **Fatigue detection** | Detect low-productivity periods, suggest breaks | Planned |
| **User preference profile** | Build a model of user's work style over time | Planned |
| **Multi-screen support** | Capture and analyze multiple displays | Done |
| **Audio context awareness** | Detect meetings vs solo work from audio patterns | Planned |
| **Long-term memory compression** | Compress old summaries to save context window | Planned |

---

### Data Flow

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

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Electron 39 + electron-vite |
| **Frontend** | React 19 + TypeScript + Tailwind CSS 4 |
| **Backend** | Node.js (Electron Main Process) |
| **Database** | SQLite (better-sqlite3), fully local |
| **AI** | OpenAI API (any compatible endpoint) |
| **Image** | sharp (screenshot compression) |
| **Audio** | Web Audio API + Whisper STT (planned) |
| **Build** | electron-builder (macOS / Windows / Linux) |

---

### Project Structure

```
dowhat/
├── src/
│   ├── main/                            # Electron Main Process
│   │   ├── index.ts                     # Window + IPC registration
│   │   ├── capturer.ts                  # Screen capture + AI pipeline
│   │   ├── recorder.ts                  # Audio capture + STT (planned)
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

### Roadmap

```
  v1.0 (Current)            v2.0 (Next)              v3.0 (Future)
  ================          ================         ================
  Perceive + Plan           OpenClaw Integration     Smarter Planning

  * Screen capture          * Audio capture + STT    * Behavior learning
  * Vision AI analysis      * Integrate OpenClaw     * Proactive suggest
  * 15-min slot summary     * Agent chat panel       * Fatigue detection
  * Task auto-management    * One-click delegate     * Audio context aware
  * Stats & insights        * Result writeback       * User profiling
  * Local SQLite            * Reuse API Key          * Long-term memory
  ================          ================         ================
       Done                    In Progress               Planned
```
