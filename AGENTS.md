# AGENTS.md — DoWhat Project Guide for AI Agents

> If README is for humans, AGENTS.md is the project manual for AI Agents.
> This is the core artifact of the Readability pillar in Harness Engineering.

---

## WHAT — Project Overview

**DoWhat** is an AI-powered personal work journal desktop application for professionals.

- **Core Feature**: Periodic screenshots → AI vision analysis → Auto-generated work journal
- **Platform**: macOS desktop application
- **Tech Stack**: Electron 39 + React 19 + TypeScript 5.9 + Tailwind CSS 4
- **Database**: better-sqlite3 (local SQLite)
- **AI Integration**: OpenAI SDK (vision API for screenshot analysis)
- **Build Tools**: electron-vite + electron-builder
- **Package Manager**: npm

### Directory Structure

```
src/
├── main/                          # Main process (Node.js environment)
│   ├── index.ts                   # App entry, window management, IPC handler registration, data migration
│   ├── database.ts                # SQLite database operations (CRUD, schema management)
│   ├── capturer.ts                # Screenshot logic (periodic capture, image processing)
│   ├── openclaw.ts                # AI analysis logic (OpenAI vision API calls)
│   ├── maintenance.ts             # Maintenance tasks (cleanup expired data)
│   ├── taskAbandonmentScanner.ts  # Task abandonment detection
│   └── prompts/                   # AI prompt templates
├── renderer/                      # Renderer process (browser environment)
│   └── src/
│       ├── App.tsx                # Root component
│       ├── main.tsx               # React entry point
│       ├── i18n.ts                # Internationalization (zh/en translations, LanguageContext)
│       ├── components/            # UI components
│       ├── types/                 # TypeScript type definitions
│       └── assets/                # Static assets
├── preload/                       # Preload scripts (IPC bridge layer)
│   ├── index.ts                   # window.api exposed IPC interfaces
│   └── index.d.ts                 # Type declarations
└── prompts/                       # Shared prompts

.harness/                          # Harness Engineering feedback loop files
├── lessons-learned.md             # Error experience log (feedback flywheel artifact)
└── verification-checklist.md      # Verification checklist (hard constraint enforcement)

.aone_copilot/rules/               # Development rules (always loaded)
├── harness-engineering.md         # Master guide (three pillars + feedback flywheel)
├── 01-readability.md              # Pillar 1
├── 02-defense-mechanisms.md       # Pillar 2
└── 03-feedback-loops.md           # Pillar 3
```

---

## HOW — Development & Verification

### Common Commands

| Action | Command |
|---|---|
| Install dependencies | `npm install` |
| Development mode | `npm run dev` |
| Type checking | `npm run typecheck` |
| Main process type check only | `npm run typecheck:node` |
| Renderer process type check only | `npm run typecheck:web` |
| Lint check | `npm run lint` |
| Build (includes type check) | `npm run build` |
| Package macOS DMG | `npm run build:mac` |
| Format code | `npm run format` |

### Development Workflow

```
1. Modify code
2. npm run typecheck  ← MUST pass
3. npm run lint       ← MUST pass
4. npm run dev        ← Verify functionality in dev mode
5. If packaging → npm run build:mac → Verify artifact cleanliness
```

### IPC Communication Pattern

All renderer ↔ main process communication MUST go through the preload bridge:

```
Renderer Process            Preload                      Main Process
Component calls             window.api.xxx()             ipcMain.handle('xxx', ...)
window.api.getSnapshots()  →  ipcRenderer.invoke()  →   Handler processes & returns
```

---

## RULES — Inviolable Constraints

### Process Isolation (Most Important)

- ❌ Renderer process MUST NOT directly import `fs`, `path`, `child_process` or any Node.js modules
- ❌ Renderer process MUST NOT use `ipcRenderer` directly; MUST go through `window.api` bridge
- ✅ All cross-process communication MUST be registered in `src/preload/index.ts`

### Data Storage (Battle-Tested Hard Constraints)

- ❌ NEVER use `process.cwd()` for data paths — unpredictable after packaging
- ✅ MUST use `app.getPath('userData')` for databases, screenshots, and config files
- ✅ Data migration MUST have precondition guards and idempotency guarantees

### Build Artifacts

- ❌ NEVER package `*.db`, `*.db-shm`, `*.db-wal`, or `snapshots/` into the app
- ✅ `electron-builder.yml` has exclusion rules configured; MUST preserve them when modifying
- ✅ macOS signing MUST include `com.apple.security.cs.disable-library-validation` entitlement

### Internationalization

- ✅ All user-facing text MUST be added to both zh and en translations in `src/renderer/src/i18n.ts`
- ❌ NEVER hardcode Chinese or English text directly in components

### Error Handling

- ❌ NEVER leave empty catch blocks
- ❌ NEVER throw bare strings
- ✅ IPC handlers MUST have try-catch with structured error responses
- ✅ Logs MUST use `[ModuleName]` prefix: `[DB]`, `[Capturer]`, `[Migration]`

---

## HARNESS — Feedback Loop Mechanism

This project follows the Harness Engineering methodology. Core feedback loop:

```
Error occurs → Root cause analysis → Update rules/constraints/verification → Log to .harness/lessons-learned.md → Never repeat
```

- Every mistake MUST be logged in `.harness/lessons-learned.md`
- Every new feature MUST pass `.harness/verification-checklist.md`
- Detailed rules are in `.aone_copilot/rules/` (three pillar files)

---

## Known Pitfalls (Extracted from lessons-learned.md)

| Pitfall | Consequence | Defense |
|---|---|---|
| Using `process.cwd()` for data storage | Wrong paths after packaging, app shows blank screen | Hard constraint: only use `app.getPath('userData')` |
| Not excluding `.db` files from build | Users see developer's historical data | `electron-builder.yml` exclusion rules |
| macOS ad-hoc code signing | Team ID mismatch crash on Sequoia | entitlements + layer-by-layer re-signing |
| Non-idempotent data migration | Runs every startup, overwrites paths | Precondition guards + migration markers |
