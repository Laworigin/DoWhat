# OpenClaw 功能使用指南

## 🎯 如何验证 OpenClaw 功能

### 步骤 1：启动应用
```bash
cd /Users/wisdomtree/Desktop/tmp/cli_test/my-context
npm run dev
```

### 步骤 2：点击 OpenClaw 导航入口
在应用的左侧导航栏中，找到并点击 **"OpenClaw"** 图标（或文字链接）

### 步骤 3：查看 OpenClaw 页面
点击后，应该会看到以下三种状态之一：

#### 状态 1：未安装 OpenClaw
- 显示 "OpenClaw 未安装" 提示
- 提供 "开始安装" 按钮
- 点击按钮后会自动执行安装流程

#### 状态 2：安装中
- 显示安装进度条
- 实时显示安装日志
- 包含以下步骤：
  1. 检查 OpenClaw CLI
  2. 创建配置目录
  3. 生成配置文件
  4. 启动 Gateway 服务

#### 状态 3：安装完成
- 显示 "OpenClaw 已就绪" 状态
- 提供两个选项：
  - **配置 IM 接入**：连接钉钉/飞书等即时通讯工具
  - **跳过 IM 配置**：直接使用 WebChat 界面

### 步骤 4：使用 OpenClaw
- 如果选择 "跳过 IM 配置"，会直接显示 WebChat 界面
- 可以在 WebChat 中与 OpenClaw AI 助手对话

## 🔧 配置 API Key

在使用 OpenClaw 前，需要先配置 Anthropic API Key：

1. 点击左侧导航栏的 **"Settings"**
2. 在 "API Configuration" 部分输入你的 API Key
3. 点击 **"Save & Test Connection"** 保存
4. API Key 会自动同步到 OpenClaw 配置文件

## ✅ 验证清单

- [ ] 应用成功启动
- [ ] 左侧导航栏显示 "OpenClaw" 入口
- [ ] 点击 "OpenClaw" 后页面正常渲染
- [ ] 安装流程自动执行（如果未安装）
- [ ] Gateway 服务成功启动（端口 18789）
- [ ] WebChat 界面正常显示（如果跳过 IM 配置）

## 🐛 常见问题

### Q: 点击 "OpenClaw" 后页面空白？
A: 检查浏览器控制台是否有错误信息，确保 React 组件正确加载

### Q: 安装失败？
A: 检查以下几点：
- OpenClaw CLI 是否已全局安装（`which openclaw`）
- 配置目录权限是否正确（`~/.openclaw/`）
- Gateway 端口 18789 是否被占用

### Q: WebChat 无法连接？
A: 确保：
- Gateway 服务正在运行（`lsof -i :18789`）
- API Key 已正确配置
- 网络连接正常

---

**生成时间**：2026-03-29 01:29:00
