# DoWhat 项目经验教训记录

> 每次踩坑后必须在此记录。这是 Harness Engineering 闭环飞轮的实体文件。
> 格式：按时间倒序排列，最新的在最前面。

---

## 2026-04-15: ensureYesterdayReportOnStartup 限制在 10:30 之前导致日报漏生成

- **问题**：14 号有完整的截屏数据，但 15 号查看历史报告时发现 14 号的日报完全缺失。13 号及之前的日报都正常
- **根因**：缺约束 — `ensureYesterdayReportOnStartup` 函数有一个 `isBeforeScheduledTime` 守卫，限制只在 0:00-10:30 之间才触发昨日日报生成。如果用户在 10:30 之后才启动应用，这个兜底就完全不工作。而定时任务 `runDailyReportTick` 只在 10:30 精确命中一分钟，如果应用在那一分钟没运行也会错过
- **修复**：移除 `ensureYesterdayReportOnStartup` 中的时间限制，无论何时启动应用，只要昨天的日报不存在就立即生成。已有的 `db.getDailyReport(yesterday)` 幂等性检查足以防止重复生成
- **系统改进**：
  1. 兜底机制不应该有时间窗口限制 — 兜底的意义就是"无论如何都能补上"
  2. 定时任务 + 启动兜底的组合模式中，兜底必须覆盖定时任务可能错过的所有场景
  3. 批量回溯（`setTimeout 15s`）虽然也能补生成历史日报，但它只在启动后 15 秒执行一次，且依赖 `getContextDatesWithData` 返回的日期列表
- **状态**：✅ 已修复

---

## 2026-04-13: 周报洞察报告取数范围错误，总结的是上周而非本周

- **问题**：「本周复盘」的 Agent 智能洞察报告内容总结的是上周的工作，而非当前这周的。用户在周一查看时，报告内容全是上周的活动
- **根因**：缺约束 — `generateAndCacheInsight` 函数中周报的时间范围计算使用 `now - 7 * oneDay`（过去7天），而非从本周一 00:00:00 开始。同时月报也用 `now - 30 * oneDay` 而非本月1号。另外 `get-stats-insight` handler 的缓存读取没有时效性校验，缓存 key 只是 `'week'`，跨周后仍返回旧缓存
- **修复**：
  1. `capturer.ts` 的 `generateAndCacheInsight`：周报改为从本周一 00:00 开始，月报改为从本月1号 00:00 开始，与前端 `StatsView.tsx` 的时间范围计算保持一致
  2. `index.ts` 的 `get-stats-insight` handler：增加缓存时效性校验 `cached.updated_at >= start`，确保缓存属于当前周期
- **系统改进**：
  1. 前后端涉及同一时间范围的计算逻辑必须保持一致，建议提取为共享工具函数
  2. 缓存系统必须有时效性校验机制，不能仅靠 key 匹配就返回缓存
  3. "过去N天"和"本周/本月"是两种完全不同的语义，选择时必须明确业务需求
- **状态**：✅ 已修复，已纳入反馈回路

---

## 2026-04-13: 在 JSX 中插入条件渲染时 div 闭合层级错乱导致编译失败

- **问题**：在 StatsView.tsx 中为 `activeCycle` 新增 `'history'` 分支时，用 `{condition ? <A/> : (<>...原有内容...</>)}` 包裹原有内容，但原有内容末尾的 `</div></div>` 是关闭外层容器的，被错误地包进了 Fragment 内部，导致 JSX 闭合层级错乱，babel 编译报错 `Expected corresponding closing tag for <>`
- **根因**：缺验证 — 修改完代码后没有在开发模式下验证就宣称任务完成，违反了"约束一：改了代码必须验证"。同时对 JSX 嵌套层级的理解不够精确，反复打补丁式修复失败 4 次
- **修复**：
  1. 用 `grep` 精确统计 Fragment 内部的 div 打开/关闭数量，确认 Fragment 内部的 div 是自闭合的
  2. 将 `</div></div>` 移到条件渲染 `)}` 之后，确保外层容器的闭合在条件渲染外面
  3. 将 `ReportExportModal` 用 `{activeCycle !== 'history' && (...)}` 包裹，避免 history 模式下渲染
- **系统改进**：
  1. 在复杂 JSX 中插入条件渲染时，必须先用 grep 或手动计数确认 div 嵌套层级，再动手修改
  2. 每次代码修改后必须立即运行 `read_lints` 或 `npm run typecheck` 验证，禁止"嘴上完成"
  3. 同一方案失败 2 次后必须换思路（如从逐行打补丁改为用 grep 精确分析后一次性重写）
- **状态**：✅ 已修复，已纳入反馈回路

---

## 2026-04-03: migrateData 缺乏幂等性导致 image_local_path 被反复拼接膨胀到 79657 字符

- **问题**：打包后的应用每次启动都执行 `migrateData`，其中的 `REPLACE(image_local_path, oldPrefix, newPrefix)` SQL 会把已经包含 `userDataPath` 的路径再次替换拼接，导致路径指数级膨胀（从 ~100 字符膨胀到 79657 字符），截图缩略图全部无法加载显示为空白
- **根因**：缺约束 — `migrateData` 函数没有幂等性保障（无迁移标记文件），每次启动都无条件执行路径替换
- **修复**：
  1. 添加 `.migration-completed` 标记文件实现幂等性，迁移完成后写入标记，后续启动直接跳过
  2. 添加前置条件守卫：旧数据不存在时直接标记完成
  3. 添加安全检查：仅替换确实以旧路径开头的记录
  4. 用脚本扫描 snapshots 目录建立 timestamp→实际路径映射，批量修复 9025 条损坏记录
- **系统改进**：已纳入硬约束 — **数据迁移必须有幂等性保障**（标记文件 + 前置条件守卫），`REPLACE` SQL 必须有精确的 WHERE 条件防止重复替换
- **状态**：✅ 已修复，已纳入硬约束

---

## 2026-04-01: Electron preload 修改后未重启 dev server 导致 window.api.xxx is not a function

- **问题**：修改 `src/preload/index.ts` 新增了 `generateReport` 等 IPC 桥接方法后，前端调用 `window.api.generateReport()` 报错 `is not a function`
- **根因**：缺信息 — Electron 的 preload 脚本只在窗口创建时加载一次，`npm run dev` 的热更新只对 renderer 代码生效，preload 和 main 进程代码修改后必须重启 dev server
- **修复**：重启 `npm run dev` 后功能正常。同时在前端加上 `typeof xxx !== 'function'` 防御性检查，当 API 不可用时显示友好提示而非原始错误
- **系统改进**：修改 preload/main 进程代码后，验收步骤必须包含"重启 dev server"。前端调用新增 IPC 方法时必须加防御性检查
- **状态**：✅ 已修复，已加防御性检查

---

## 2026-04-01: 验收只做静态 lint 检查，未验证运行时行为

- **问题**：报告导出功能开发完成后，只用 `read_lints` 做了静态检查就宣称任务完成，没有考虑 Electron 的 preload 热更新限制，导致用户实际使用时报错
- **根因**：缺验证 — 验收流程不完整，只覆盖了编译期检查（类型/lint），没有覆盖运行时验证（API 可用性、进程重启）
- **修复**：在验收清单中增加"运行时验证"步骤：修改 preload/main 代码后必须提醒用户重启 dev server，并在前端加防御性检查
- **系统改进**：验收不能只做静态检查。涉及 Electron 多进程架构的修改，必须明确告知用户哪些修改需要重启才能生效
- **状态**：✅ 已更新验收流程

---

## 2026-04-01: 使用非视觉模型（qwen-plus）做截图识别导致完全幻觉

- **问题**：使用 qwen-plus（纯语言模型）调用 Vision API 识别截图，API 不报错但图片被静默忽略（`prompt_tokens: 144`，图片 token 为 0），模型根据 prompt 上下文凭空编造识别结果（把 Chrome 浏览器识别成 VS Code 编辑 TypeScript）
- **根因**：缺信息 — 不了解阿里通义千问模型系列的区别：qwen-plus 是纯语言模型，不具备真正的图片理解能力；dashscope 兼容模式不会拒绝图片参数，而是静默忽略
- **修复**：Vision 识别必须使用 qwen-vl 系列模型（如 `qwen-vl-plus`、`qwen-vl-max`）或支持多模态的 `qwen3.5-plus`。验证方法：检查 API 返回的 `prompt_tokens` 是否包含图片 token（正常应 >1000，若 <200 说明图片未被处理）
- **系统改进**：已纳入硬约束 — **Vision API 调用必须使用多模态模型**（qwen-vl-plus/qwen-vl-max/qwen3.5-plus），禁止使用纯语言模型（qwen-plus/qwen-turbo）。上线前必须用 `prompt_tokens` 验证图片是否被正确编码
- **状态**：✅ 已纳入硬约束

---

## 2026-04-01: 降低截图分辨率/质量导致 AI Vision 模型严重幻觉

- **问题**：为控制磁盘占用，将截图从 1920×1080/q90 降至 1280×720/q60，导致 qwen3.5-plus 的 vision 模型无法正确识别屏幕内容，产生严重幻觉（把钉钉聊天识别成 VS Code 编辑 JWT 代码）
- **根因**：缺验证 — 修改截图质量后没有验证 AI 识别准确度，只关注了磁盘占用指标
- **修复**：恢复原始 1920×1080/q90 截图质量，不对截图执行任何压缩操作。数据膨胀问题通过其他手段解决（缩短保留天数、修复清理逻辑、自动 VACUUM）
- **系统改进**：已纳入硬约束 — **禁止降低截图分辨率或质量**，这是 AI 识别准确度的生命线。磁盘优化只能通过清理策略（保留天数、VACUUM）实现，不能牺牲输入质量
- **状态**：✅ 已纳入硬约束

---

## 2026-04-01: maintenance.ts 使用 process.cwd() 导致截图清理逻辑完全失效

- **问题**：`maintenance.ts` 中的 `basePath` 默认使用 `process.cwd()`，打包后指向系统目录，导致截图归档清理逻辑找不到 snapshots 目录，从不执行清理，截图无限增长到 14 GB
- **根因**：缺约束 — `process.cwd()` 的硬约束只在 `index.ts` 的迁移逻辑中被修复，没有全局排查其他文件
- **修复**：添加 `setMaintenanceBasePath()` 函数，在 `index.ts` 中用 `app.getPath('userData')` 初始化；改为直接删除超过 3 天的截图目录（不再归档压缩）
- **系统改进**：全局排查并修复了所有 `process.cwd()` 的使用。已有的硬约束需要定期全局扫描执行
- **状态**：✅ 已修复

---

## 2026-04-01: getContextsForDate 查询去掉 image_local_path 导致缩略图消失

- **问题**：优化数据库查询时，将 `image_local_path` 从 `getContextsForDate` 的 SELECT 字段中移除（认为是"重型字段"），导致 ContextView 缩略图全部显示为空白
- **根因**：缺验证 — `image_local_path` 只是一个文件路径字符串（几十字节），不是重型数据，但没有验证前端依赖关系就移除了
- **修复**：将 `image_local_path` 加回查询字段
- **系统改进**：修改数据库查询字段前，必须检查前端组件对返回字段的依赖关系
- **状态**：✅ 已修复

---

## 2026-03-31: process.cwd() 在打包后指向不可预测的路径

- **问题**：`migrateData` 函数使用 `process.cwd()` 获取项目根路径，打包后 cwd 返回的是 macOS 的系统目录（如 `/`），导致 better-sqlite3 的 REPLACE 操作把数据库中所有路径替换为错误值，应用启动后窗口不显示
- **根因**：缺约束 — 没有硬性禁止在数据路径相关逻辑中使用 `process.cwd()`
- **修复**：在 `migrateData` 第 3 步添加前置条件守卫，只在旧路径的 db 文件确实存在且 rootPath !== userDataPath 时才执行路径更新
- **系统改进**：已纳入 `02-防御机制.md` 硬约束 — 数据存储路径只允许 `app.getPath('userData')`
- **状态**：✅ 已纳入硬约束

---

## 2026-03-31: 打包产物包含本地数据库文件

- **问题**：`electron-builder` 打包时把项目根目录下的 `context_agent.db` 也打包进了 .app，导致新用户打开应用时看到开发者的历史数据
- **根因**：缺验证 — `electron-builder.yml` 的 files 排除规则没有覆盖 `.db` 文件
- **修复**：在 `electron-builder.yml` 中添加排除规则：`!**/*.db`、`!**/*.db-shm`、`!**/*.db-wal`、`!**/snapshots/**`
- **系统改进**：已纳入 `verification-checklist.md` — 每次打包前必须验证产物干净性
- **状态**：✅ 已纳入验证清单

---

## 2026-03-31: macOS Sequoia 代码签名 Team ID 不一致导致崩溃

- **问题**：ad-hoc 签名的 Electron 应用在 macOS Sequoia 26.2 上运行时崩溃，错误信息：`mapping process and mapped file (non-platform) have different Team IDs`
- **根因**：缺信息 — 不了解 macOS Sequoia 的 Code Signing Monitor (CSM) 对 ad-hoc 签名应用的严格校验机制
- **修复**：添加 `com.apple.security.cs.disable-library-validation` 到 entitlements，然后逐层重签名（从内到外：.node → .dylib → frameworks → helpers → main app）
- **系统改进**：已记录签名流程到 `02-防御机制.md`，签名流程必须自动化脚本化
- **状态**：✅ 已记录

---

## 2026-03-31: 打包后应用与开发模式共用 userData 目录

- **问题**：打包后的 .app 和 `npm run dev` 共用同一个 `~/Library/Application Support/dowhat/` 目录，导致打包后的应用读取到开发调试时的历史数据
- **根因**：缺信息 — 这是 Electron 的正常行为（同一个 appId 共用 userData），对新用户无影响
- **修复**：确认这是预期行为，新用户的 userData 目录是空的
- **系统改进**：已记录为已知行为，不需要额外处理
- **状态**：ℹ️ 已知行为，无需修复
