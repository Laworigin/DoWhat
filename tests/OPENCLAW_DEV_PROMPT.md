# 🦞 DoWhat × OpenClaw 集成开发需求

> **重要**：这是一个长时间开发任务，开发者需要自主完成所有开发、测试、调试工作，确保交付完整可用的功能。

> **🚨 最高优先级约束：绝对不能影响任何现有功能。** 所有现有功能（Context 看板、长线规划、统计与复盘、系统设置、截屏采集、AI 分析等）必须在开发完成后仍然 100% 正常工作。如果新增代码导致任何现有功能报错、崩溃或不可用，视为任务失败。修改现有文件时，只做**增量添加**，不要修改、删除、重构任何现有逻辑。
>
> **🚫 绝对禁止推送到远程仓库。** 不允许执行 `git push`、`git push origin`、`gh pr create` 或任何将代码推送到 GitHub 远程仓库的操作。所有变更仅保留在本地。可以使用 `git add` 和 `git commit` 进行本地版本管理，但**绝对不能 push**。

---

## 零、任务目标（一句话）

**在 DoWhat 左侧导航栏"系统设置"下方新增 "OpenClaw" 入口，用户点击后看到一键安装引导 → 自动安装 OpenClaw → IM 接入向导（微信/飞书扫码）→ 嵌入 OpenClaw WebChat UI。整个过程用户只需点击按钮和扫码，无需任何命令行操作。**

### 验收标准（必须全部满足才算完成）

0. 🚨 **所有现有功能正常工作**（Context 看板、长线规划、统计与复盘、系统设置、截屏采集、AI 分析），无报错、无崩溃、无行为变化
1. ✅ 左侧导航栏"系统设置"下方出现 "OpenClaw" 入口（小龙虾图标）
2. ✅ 点击进入后看到安装引导页，点击「一键安装」按钮
3. ✅ 安装过程中显示实时进度（"正在安装..."、"正在配置..."）
4. ✅ 安装完成后自动进入 IM 接入向导（微信/飞书选择页）
5. ✅ 选择 IM 后能看到二维码（或跳过）
6. ✅ 完成后进入 WebChat UI（webview 嵌入 `http://127.0.0.1:18789`）
7. ✅ DoWhat 启动时自动启动 OpenClaw Gateway 进程
8. ✅ DoWhat 退出时自动关闭 OpenClaw Gateway 进程
9. ✅ 在 DoWhat 设置页面修改 API Key 后，自动同步到 OpenClaw
10. ✅ 安装失败时显示报错详情 + 重试按钮
11. ✅ 编译无错误，运行无崩溃，UI 风格与现有页面一致

---

## 一、项目背景

**DoWhat** 是一个基于 Electron 39 + React 19 + TypeScript + Tailwind CSS 4 的桌面应用，核心功能是通过截屏采集 + AI 分析来自动识别用户任务。项目使用 SQLite (better-sqlite3) 本地存储，OpenAI 兼容 API 进行 AI 推理。

**OpenClaw** 是一个开源个人 AI 助手（`https://github.com/openclaw/openclaw`），基于 Node.js/TypeScript，可以在 20+ 个聊天渠道（微信、飞书、Telegram 等）上运行。它通过 `npm install -g openclaw` 安装，通过 `openclaw gateway --port 18789` 启动 WebSocket Gateway 并提供内置 WebChat UI。

**目标**：在 DoWhat 中集成 OpenClaw，让用户通过一键安装 + 扫码接入 IM 的极简流程，即可在 DoWhat 和聊天软件上使用 AI 助手。

---

## 二、技术栈约束

- **DoWhat 技术栈**：Electron 39 + electron-vite 5 + React 19 + TypeScript + Tailwind CSS 4.2 + better-sqlite3
- **OpenClaw 技术栈**：Node.js 24（推荐）/ 22.16+，npm 全局安装
- **通信方式**：Main ↔ Renderer 通过 `ipcMain.handle` / `ipcRenderer.invoke`，Preload 层 `contextBridge.exposeInMainWorld`
- **数据存储**：SQLite `settings` 表（key-value），路径 `app.getPath('userData')/context_agent.db`
- **样式系统**：macOS 原生风格，毛玻璃效果 `bg-black/10 backdrop-blur-md`，自定义 `macos-*` 配色

### 关键文件路径

| 文件 | 说明 |
|------|------|
| `src/renderer/src/components/PrimaryNav.tsx` | 左侧主导航栏 |
| `src/renderer/src/App.tsx` | 主应用 + 路由逻辑（通过 activeSection 状态控制） |
| `src/renderer/src/components/views/SettingsView.tsx` | 系统设置页面（含模型配置、监控偏好、关于） |
| `src/main/index.ts` | Electron 主进程（窗口创建 + IPC 注册） |
| `src/main/database.ts` | SQLite 数据库（settings 表 key-value 存储） |
| `src/preload/index.ts` | Preload 层（contextBridge 暴露 API） |
| `src/renderer/src/types/electron.d.ts` | IPC 类型定义 |

### 现有 IPC 通信模式

```
Renderer (React) → window.api.xxx() → Preload (ipcRenderer.invoke) → Main (ipcMain.handle) → Database/System
```

### 现有设置存储方式

```typescript
// database.ts
saveSetting(key: string, value: string): void
getSetting(key: string): string | null
```

### 现有 API Key 配置

DoWhat 存储了三个配置项：
- `api_key` — OpenAI 兼容的 API Key
- `endpoint` — API 接入点（默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`）
- `model_name` — 模型名称（默认 `qwen-turbo`）

---

## 三、核心需求

### 3.1 导航栏新增 OpenClaw 入口

**位置**：左侧主导航栏（`PrimaryNav.tsx`），在"系统设置"下方新增一个独立入口。

**要求**：
- 导航项名称：**OpenClaw**
- 图标：使用小龙虾图标 🦞（如 lucide-react 没有小龙虾，可使用 `Bug` 图标或自定义 SVG 小龙虾图标）
- 样式与现有导航项（Context 看板、长线规划、统计与复盘、系统设置）保持一致
- 点击后切换到 `OpenClawView` 视图

**涉及文件**：
- `src/renderer/src/components/PrimaryNav.tsx` — 添加导航项
- `src/renderer/src/App.tsx` — 添加 `activeSection === 'openclaw'` 的路由分支

---

### 3.2 OpenClaw 视图 — 三阶段状态机

新建 `src/renderer/src/components/views/OpenClawView.tsx`，根据安装状态展示不同界面：

#### 阶段 1：未安装 → 安装引导页

**触发条件**：`settings` 表中 `openclaw_installed` 不为 `'true'`

**UI 设计**：
- 居中卡片布局，macOS 毛玻璃风格
- 顶部：OpenClaw Logo + 标题 "OpenClaw — 你的个人 AI 助手"
- 中间：简短介绍文案（"在微信、飞书等聊天工具上使用 AI 助手"）
- 底部：**「一键安装」** 按钮（`macos-systemBlue` 蓝色，圆角）
- 安装过程中：按钮变为 loading 状态 + 进度文案（"正在安装 OpenClaw..."、"正在配置..."、"安装完成！"）
- 安装失败：显示**报错详情**（可折叠的错误日志）+ **「重试」按钮**

**安装流程（后台自动执行）**：

1. **执行 `npm install -g openclaw@latest`**（使用 Electron 自带的 Node.js）

2. **执行 `openclaw onboard`**（交互式命令，需要自动化回答）

   ⚠️ **关键：`openclaw onboard` 是交互式 CLI，必须通过 stdin 自动化回答以下选项**：

   | 配置项 | 自动回答 |
   |--------|----------|
   | I understand this is powerful and inherently risky. Continue? | **Yes** |
   | Onboarding mode | **QuickStart** |
   | Model/auth provider | **Skip for now**（稍后配置百炼模型） |
   | Filter models by provider | **All providers** |
   | Default model | **Keep current** |
   | Select channel (QuickStart) | **Skip for now**（稍后配置渠道） |
   | Configure skills now? (recommended) | **No** |
   | Enable hooks? | 按空格键选中选项，按回车键进入下一步 |
   | How do you want to hatch your bot? | **Do this later** |

   实现方式：使用 `child_process.spawn` 创建子进程，监听 stdout 输出，根据输出内容通过 stdin 写入对应的回答。使用模式匹配检测每个问题，然后自动输入正确的选项。

3. **从 DoWhat 的 `settings` 表读取 `api_key` 和 `endpoint`，写入 `~/.openclaw/.env` 文件**：
   ```
   OPENAI_API_KEY=<DoWhat的api_key>
   OPENAI_BASE_URL=<DoWhat的endpoint>
   ```

4. **生成随机 `OPENCLAW_GATEWAY_TOKEN` 并写入 `.env`**

5. **将 `openclaw_installed` 设为 `'true'` 存入 `settings` 表**

6. **自动进入阶段 2**

#### 阶段 2：已安装但未配置 IM → IM 接入向导

**触发条件**：`openclaw_installed === 'true'` 且 `openclaw_im_configured` 不为 `'true'` 且 `openclaw_im_skipped` 不为 `'true'`

**UI 设计**：
- 标题："选择接入方式"
- 两个可勾选的卡片：
  - **微信** — 微信图标 + "通过微信使用 AI 助手" + 副标题 "仅支持 iOS 设备"
  - **飞书** — 飞书图标 + "通过飞书使用 AI 助手"
- 用户可以勾选一个或多个（也可以跳过，提供"跳过，稍后配置"链接）
- **跳过行为**：点击"跳过"时，将 `openclaw_im_skipped` 设为 `'true'`，直接进入阶段 3
- 底部：**「开始接入」** 按钮

**接入流程**：

**微信接入**：
1. 后台执行 `npx -y @tencent-weixin/openclaw-weixin-cli@latest install`
2. 捕获 stdout 输出，解析出二维码 URL 或二维码数据
3. 在 DoWhat 界面中渲染二维码，提示用户 "请用微信扫描二维码"
4. 监听命令输出，检测到连接成功后自动进入下一步
5. 失败时显示报错详情 + 重试按钮

**飞书接入**：
1. 后台执行 `npx -y @larksuite/openclaw-lark install`
2. 同样捕获 stdout，解析并渲染二维码
3. 提示用户 "请用飞书扫描二维码"
4. 监听连接成功，自动进入下一步
5. 失败时显示报错详情 + 重试按钮

**二维码展示方案**：
- 捕获子进程的 stdout 输出流
- 检测输出中的二维码内容（通常是 URL 或 ASCII 二维码）
- 如果是 URL，使用 `qrcode` npm 包在前端生成二维码图片
- 如果是 ASCII 二维码，直接用等宽字体在 `<pre>` 标签中展示
- **必须确保二维码可以被手机正常扫描**

**接入完成后**：
- 将 `openclaw_im_configured` 设为 `'true'`
- 记录已接入的渠道 `openclaw_channels`（JSON 数组，如 `["weixin","feishu"]`）
- 自动进入阶段 3

#### 阶段 3：已安装已配置 → WebChat UI

**触发条件**：`openclaw_installed === 'true'` 且（`openclaw_im_configured === 'true'` 或 `openclaw_im_skipped === 'true'`）

> **状态判断优先级**：先判断阶段 1（未安装），再判断阶段 2（已安装但未配置且未跳过），最后进入阶段 3（兜底）。

**UI 设计**：
- 使用 Electron 的 `<webview>` 标签嵌入 `http://127.0.0.1:18789`
- webview 占满整个内容区域
- 顶部工具栏：
  - OpenClaw 状态指示灯（绿色 = Gateway 运行中，红色 = 已停止）
  - 「管理 IM 接入」按钮（点击可重新进入阶段 2 的 IM 配置）
  - 「重新安装」按钮（重置安装状态）
- 如果 IM 未配置，顶部显示一个提示条引导用户配置 IM

---

### 3.3 OpenClaw Gateway 进程管理

**位置**：`src/main/index.ts` 或新建 `src/main/openclaw.ts`

**启动时**：
- DoWhat 应用启动时（`app.whenReady()` 之后），检查 `openclaw_installed` 是否为 `'true'`
- 如果已安装，使用 `child_process.spawn` 启动 `openclaw gateway --port 18789`
- 将子进程引用保存在模块级变量中
- 监听子进程的 `error` 和 `exit` 事件，记录日志

**退出时**：
- `app.on('before-quit')` 或 `app.on('will-quit')` 时，kill OpenClaw Gateway 子进程
- 使用 `process.kill(pid, 'SIGTERM')` 优雅关闭
- 设置超时，如果 5 秒内未退出则 `SIGKILL`

**健康检查**：
- 提供 IPC handler `openclaw-gateway-status`，返回 Gateway 是否在运行

---

### 3.4 IPC 通信层

**新增 IPC Handlers**（`src/main/index.ts`）：

| Handler | 类型 | 功能 |
|---------|------|------|
| `openclaw-install` | `ipcMain.handle` | 启动安装流程，立即返回 `{ success: true }`，实际进度通过事件推送 |
| `openclaw-setup-channel` | `ipcMain.handle` | 启动 IM 接入流程，立即返回，二维码和状态通过事件推送 |
| `openclaw-gateway-status` | `ipcMain.handle` | 获取 Gateway 运行状态（同步返回） |
| `openclaw-get-install-status` | `ipcMain.handle` | 获取安装状态（同步返回） |
| `openclaw-reset` | `ipcMain.handle` | 重置安装状态（清除 settings + 删除 ~/.openclaw） |
| `openclaw-sync-apikey` | `ipcMain.handle` | 同步 DoWhat 的 API Key 到 OpenClaw .env |
| `openclaw-skip-im` | `ipcMain.handle` | 跳过 IM 配置（设置 `openclaw_im_skipped = 'true'`） |

### ⚠️ 关键：长时间操作的进度推送

安装和 IM 接入是**长时间异步操作**（可能需要几分钟），不能用 `ipcMain.handle` 的返回值传递进度。必须使用 `mainWindow.webContents.send()` 从 Main 进程**主动推送事件**到 Renderer。

**进度推送事件定义**：

| 事件名 | 方向 | 数据格式 | 说明 |
|--------|------|----------|------|
| `openclaw-install-progress` | Main → Renderer | `{ step: string, message: string }` | 安装进度。step 枚举：`npm-install`、`onboard`、`write-env`、`done`、`error` |
| `openclaw-install-error` | Main → Renderer | `{ error: string, detail?: string }` | 安装失败 |
| `openclaw-channel-qrcode` | Main → Renderer | `{ channel: string, qrData: string, type: 'url' \| 'ascii' }` | 二维码数据推送 |
| `openclaw-channel-status` | Main → Renderer | `{ channel: string, status: 'connecting' \| 'connected' \| 'error', error?: string }` | IM 接入状态 |

**Renderer 端监听方式**（通过 Preload 暴露）：

```typescript
// preload/index.ts 中暴露事件监听
onOpenclawInstallProgress: (callback: (data: { step: string; message: string }) => void) => {
  ipcRenderer.on('openclaw-install-progress', (_event, data) => callback(data))
},
onOpenclawInstallError: (callback: (data: { error: string; detail?: string }) => void) => {
  ipcRenderer.on('openclaw-install-error', (_event, data) => callback(data))
},
onOpenclawChannelQrcode: (callback: (data: { channel: string; qrData: string; type: string }) => void) => {
  ipcRenderer.on('openclaw-channel-qrcode', (_event, data) => callback(data))
},
onOpenclawChannelStatus: (callback: (data: { channel: string; status: string; error?: string }) => void) => {
  ipcRenderer.on('openclaw-channel-status', (_event, data) => callback(data))
},
```

**新增 Preload API（请求类）**（`src/preload/index.ts`）：

```typescript
openclawInstall: () => ipcRenderer.invoke('openclaw-install'),
openclawSetupChannel: (channel: 'weixin' | 'feishu') => ipcRenderer.invoke('openclaw-setup-channel', channel),
openclawGatewayStatus: () => ipcRenderer.invoke('openclaw-gateway-status'),
openclawGetInstallStatus: () => ipcRenderer.invoke('openclaw-get-install-status'),
openclawReset: () => ipcRenderer.invoke('openclaw-reset'),
openclawSyncApiKey: () => ipcRenderer.invoke('openclaw-sync-apikey'),
openclawSkipIm: () => ipcRenderer.invoke('openclaw-skip-im'),
```

**类型定义**（`src/renderer/src/types/electron.d.ts`）：

```typescript
// 请求类 API
openclawInstall: () => Promise<{ success: boolean; error?: string }>
openclawSetupChannel: (channel: 'weixin' | 'feishu') => Promise<{ success: boolean; error?: string }>
openclawGatewayStatus: () => Promise<{ running: boolean; port: number }>
openclawGetInstallStatus: () => Promise<{ installed: boolean; imConfigured: boolean; imSkipped: boolean; channels: string[] }>
openclawReset: () => Promise<void>
openclawSyncApiKey: () => Promise<{ success: boolean; error?: string }>
openclawSkipIm: () => Promise<void>

// 事件监听类 API
onOpenclawInstallProgress: (callback: (data: { step: string; message: string }) => void) => void
onOpenclawInstallError: (callback: (data: { error: string; detail?: string }) => void) => void
onOpenclawChannelQrcode: (callback: (data: { channel: string; qrData: string; type: string }) => void) => void
onOpenclawChannelStatus: (callback: (data: { channel: string; status: string; error?: string }) => void) => void
```

---

### 3.5 API Key 同步机制

**时机**：
1. OpenClaw 安装时，从 DoWhat settings 读取 `api_key` 和 `endpoint`，写入 `~/.openclaw/.env`
2. 用户在 DoWhat 设置页面修改 API Key 后，同步更新 `~/.openclaw/.env`

**实现**：
- 在 `SettingsView.tsx` 的 `saveAndTestConnection` 函数中，保存成功后额外调用 `window.api.openclawSyncApiKey()`
- 新增 IPC handler `openclaw-sync-apikey`，读取 DoWhat 的 api_key 和 endpoint，更新 `~/.openclaw/.env` 文件

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/renderer/src/components/PrimaryNav.tsx` | 修改 | 添加 OpenClaw 导航项（小龙虾图标） |
| `src/renderer/src/App.tsx` | 修改 | 添加 OpenClaw 路由分支 |
| `src/renderer/src/components/views/OpenClawView.tsx` | **新建** | OpenClaw 主视图（三阶段状态机） |
| `src/main/index.ts` | 修改 | 添加 IPC handlers + Gateway 进程管理 |
| `src/main/openclaw.ts` | **新建** | OpenClaw 安装、配置、进程管理逻辑 |
| `src/preload/index.ts` | 修改 | 暴露 OpenClaw 相关 API |
| `src/renderer/src/types/electron.d.ts` | 修改 | 添加 OpenClaw API 类型定义 |
| `src/renderer/src/components/views/SettingsView.tsx` | 修改 | API Key 保存后同步到 OpenClaw |
| `package.json` | 修改 | 添加 `qrcode` 依赖（用于二维码渲染） |

---

## 五、用户交互流程图

```
用户点击左侧导航 "OpenClaw"
         │
         ▼
    ┌─────────────┐
    │ 已安装？      │
    └─────┬───────┘
     No   │   Yes
     ▼    │    ▼
┌─────────┐  ┌──────────────┐
│ 安装引导  │  │ IM 已配置？    │
│ 页面     │  └──────┬───────┘
│          │   No    │   Yes
│ [一键安装]│   ▼     │    ▼
└────┬─────┘ ┌───────┐ ┌──────────┐
     │       │IM 接入 │ │ WebChat  │
     │       │向导    │ │ UI       │
     ▼       │       │ │(webview) │
  安装中...   │[微信]  │ │          │
  ├ npm install│[飞书]  │ │ 顶部工具栏│
  ├ onboard   │       │ │ ├状态灯   │
  ├ 写入.env  │[开始]  │ │ ├管理IM  │
  ├ 完成 ✓    │       │ │ └重装    │
  │           └───┬───┘ └──────────┘
  │               │
  │          扫码中...
  │          ├ 渲染二维码
  │          ├ 等待扫码
  │          ├ 连接成功 ✓
  │               │
  └───────────────┘
         │
         ▼
    WebChat UI
```

---

## 六、OpenClaw Onboard 自动化配置

`openclaw onboard` 是交互式 CLI 工具，必须通过程序自动化回答。以下是必须严格遵守的配置序列：

| # | 配置项 | 自动回答 | 实现方式 |
|---|--------|----------|----------|
| 1 | I understand this is powerful and inherently risky. Continue? | **Yes** | 检测到 "risky" 关键词 → 写入 "Y\n" |
| 2 | Onboarding mode | **QuickStart** | 检测到 "Onboarding mode" → 写入选择 QuickStart 的按键 |
| 3 | Model/auth provider | **Skip for now** | 检测到 "Model/auth provider" → 选择 Skip for now |
| 4 | Filter models by provider | **All providers** | 检测到 "Filter models" → 选择 All providers |
| 5 | Default model | **Keep current** | 检测到 "Default model" → 选择 Keep current |
| 6 | Select channel (QuickStart) | **Skip for now** | 检测到 "Select channel" → 选择 Skip for now |
| 7 | Configure skills now? | **No** | 检测到 "Configure skills" → 写入 "N\n" 或选择 No |
| 8 | Enable hooks? | 按空格选中，按回车确认 | 检测到 "Enable hooks" → 写入 " \n"（空格+回车） |
| 9 | How do you want to hatch your bot? | **Do this later** | 检测到 "hatch your bot" → 选择 Do this later |

**实现建议**：
```typescript
// 使用 node-pty 或 expect-like 模式
const child = spawn('openclaw', ['onboard'], { stdio: ['pipe', 'pipe', 'pipe'] })

let outputBuffer = ''
child.stdout.on('data', (data) => {
  outputBuffer += data.toString()

  if (outputBuffer.includes('risky') && !answered.risky) {
    child.stdin.write('Y\n')
    answered.risky = true
  }
  // ... 依次匹配其他问题
})
```

---

## 七、开发过程规范

### 7.1 测试应用管理

**⚠️ 每次重启测试应用前，必须确保已打开的测试应用已关闭**：
- 在启动 `npm run dev` 或 `electron-vite dev` 之前，先执行 `pkill -f "electron"` 或 `pkill -f "DoWhat"` 关闭所有已有的 Electron 进程
- 避免打开一堆重复的应用窗口

### 7.2 OpenClaw 安装状态重置

**⚠️ 每次测试安装流程前，必须重置 OpenClaw 安装状态**：
- 清除 DoWhat 数据库中的 `openclaw_installed`、`openclaw_im_configured`、`openclaw_channels` 设置项
- 删除 `~/.openclaw/` 目录（`rm -rf ~/.openclaw`）
- 卸载全局 openclaw（`npm uninstall -g openclaw`）
- 这样确保每次都走完整的安装流程

### 7.3 自主验证

**开发者必须自主进行以下验证**：
1. **检查编译日志**：确保 `npm run dev` 没有编译错误
2. **检查界面截图**：启动应用后截图验证 UI 是否正确
3. **检查控制台日志**：查看 Electron 主进程和渲染进程的日志，确保没有运行时错误
4. **验证完整流程**：
   - 点击 OpenClaw 导航项 → 看到安装引导页
   - 点击一键安装 → 看到安装进度
   - 安装完成 → 看到 IM 接入向导
   - 选择 IM → 看到二维码（或跳过）
   - 进入 WebChat UI → webview 正常加载
5. **验证 Gateway 进程管理**：
   - DoWhat 启动时 Gateway 自动启动
   - DoWhat 退出时 Gateway 自动关闭

### 7.4 持续优化

- 如果发现 UI 不美观或交互不流畅，主动优化
- 如果发现 bug，主动修复
- 如果发现性能问题，主动优化
- 确保最终交付的功能完整、稳定、美观

---

## 八、注意事项

1. **不要复制 OpenClaw 源码**到 DoWhat 项目中，通过 `npm install -g` 全局安装
2. **Electron webview 安全**：需要在 `BrowserWindow` 的 `webPreferences` 中启用 `webviewTag: true`
3. **进程隔离**：OpenClaw Gateway 作为独立子进程运行，不要阻塞 Electron 主进程
4. **错误处理**：所有子进程操作都需要 try-catch，安装/接入失败时提供清晰的错误信息和重试机制
5. **样式一致性**：新增的 UI 必须与 DoWhat 现有的 macOS 毛玻璃风格保持一致，使用 `macos-*` 配色系统
6. **API Key 安全**：写入 `~/.openclaw/.env` 时注意文件权限，建议设置为 `0600`
7. **IPC 通信中的进度反馈**：安装和 IM 接入是长时间操作，需要通过 `mainWindow.webContents.send()` 实时推送进度到前端（详见 3.4 节的进度推送事件定义）
8. **⚠️ PATH 问题（极易翻车）**：Electron 打包后的应用从 Dock/Finder 启动时，**不会继承用户的 shell PATH**（如 `~/.zshrc` 中配置的 nvm/node 路径）。因此：
   - 执行 `npm install -g openclaw` 时，必须使用**绝对路径**调用 npm，如 `/usr/local/bin/npm` 或通过 `which npm` 动态查找
   - 执行 `openclaw` 命令时，必须先通过 `npm root -g` 找到全局安装目录，然后拼接 `openclaw` 的绝对路径
   - 推荐做法：在 spawn 时设置 `env: { ...process.env, PATH: '/usr/local/bin:/opt/homebrew/bin:' + process.env.PATH }` 确保常见路径在 PATH 中
   - 或者使用 `shell: true` 选项让 spawn 通过 shell 执行，这样会加载 shell 的 PATH 配置
9. **settings 表新增字段汇总**：本次需要在 settings 表中新增以下 key-value 配置项：
   - `openclaw_installed` — 是否已安装（`'true'` / 不存在）
   - `openclaw_im_configured` — 是否已配置 IM（`'true'` / 不存在）
   - `openclaw_im_skipped` — 是否跳过了 IM 配置（`'true'` / 不存在）
   - `openclaw_channels` — 已接入的渠道（JSON 数组字符串，如 `'["weixin","feishu"]'`）
   - `openclaw_gateway_token` — Gateway 认证 token（随机生成的字符串）
