import { spawn, ChildProcess, execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import * as net from 'net'
import { saveSetting, getSetting } from './database'

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw')
const OPENCLAW_ENV_FILE = path.join(OPENCLAW_DIR, '.env')
const GATEWAY_PORT = 18789

let gatewayProcess: ChildProcess | null = null

function getEnhancedPath(): string {
  const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const currentPath = process.env.PATH || ''
  const pathParts = currentPath.split(':')
  for (const extra of extraPaths) {
    if (!pathParts.includes(extra)) {
      pathParts.unshift(extra)
    }
  }
  return pathParts.join(':')
}

function getSpawnEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getEnhancedPath() }
}

function findNpmPath(): string {
  try {
    const npmPath = execSync('which npm', { env: getSpawnEnv() }).toString().trim()
    if (npmPath) return npmPath
  } catch {
    // fallback
  }
  const candidates = ['/usr/local/bin/npm', '/opt/homebrew/bin/npm', '/usr/bin/npm']
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return 'npm'
}

function findOpenclawPath(): string {
  try {
    const globalRoot = execSync(`${findNpmPath()} root -g`, { env: getSpawnEnv() }).toString().trim()
    const openclawBin = path.join(globalRoot, '.bin', 'openclaw')
    if (fs.existsSync(openclawBin)) return openclawBin

    const openclawPkg = path.join(globalRoot, 'openclaw')
    if (fs.existsSync(openclawPkg)) {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(openclawPkg, 'package.json'), 'utf-8'))
      if (pkgJson.bin) {
        const binName = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin.openclaw || Object.values(pkgJson.bin)[0]
        return path.join(openclawPkg, binName as string)
      }
    }
  } catch {
    // fallback
  }
  try {
    const whichResult = execSync('which openclaw', { env: getSpawnEnv() }).toString().trim()
    if (whichResult) return whichResult
  } catch {
    // fallback
  }
  return 'openclaw'
}

function sendProgress(mainWindow: BrowserWindow | null, step: string, message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('openclaw-install-progress', { step, message })
  }
}

function sendError(mainWindow: BrowserWindow | null, error: string, detail?: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('openclaw-install-error', { error, detail })
  }
}

function sendChannelQrcode(mainWindow: BrowserWindow | null, channel: string, qrData: string, type: 'url' | 'ascii'): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('openclaw-channel-qrcode', { channel, qrData, type })
  }
}

function sendChannelStatus(mainWindow: BrowserWindow | null, channel: string, status: 'connecting' | 'connected' | 'error', error?: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('openclaw-channel-status', { channel, status, error })
  }
}

export async function installOpenclaw(mainWindow: BrowserWindow | null): Promise<{ success: boolean; error?: string }> {
  try {
    sendProgress(mainWindow, 'npm-install', '正在全局安装 OpenClaw...')

    const npmPath = findNpmPath()
    await new Promise<void>((resolve, reject) => {
      const child = spawn(npmPath, ['install', '-g', 'openclaw'], {
        env: getSpawnEnv(),
        shell: true
      })

      let stderr = ''
      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`npm install failed with code ${code}: ${stderr}`))
        }
      })

      child.on('error', (err) => {
        reject(err)
      })
    })

    sendProgress(mainWindow, 'onboard', '正在执行 OpenClaw 初始化配置...')

    await runOnboard()

    sendProgress(mainWindow, 'write-env', '正在写入 API 配置...')

    await syncApiKeyToOpenclaw()

    const token = crypto.randomBytes(32).toString('hex')
    saveSetting('openclaw_gateway_token', token)
    saveSetting('openclaw_installed', 'true')

    sendProgress(mainWindow, 'done', 'OpenClaw 安装完成！')
    return { success: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    sendError(mainWindow, '安装失败', errorMessage)
    return { success: false, error: errorMessage }
  }
}

async function runOnboard(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const openclawPath = findOpenclawPath()
    const child = spawn(openclawPath, ['onboard'], {
      env: getSpawnEnv(),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let outputBuffer = ''
    const answered: Record<string, boolean> = {}
    let timeoutId: NodeJS.Timeout | null = null

    const resetTimeout = (): void => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('OpenClaw onboard timed out after 120 seconds'))
      }, 120000)
    }

    resetTimeout()

    const handleOutput = (data: Buffer): void => {
      const text = data.toString()
      outputBuffer += text
      resetTimeout()

      if (outputBuffer.includes('risky') && !answered.risky) {
        child.stdin?.write('Y\n')
        answered.risky = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Onboarding mode') && !answered.onboardingMode) {
        setTimeout(() => child.stdin?.write('\n'), 300)
        answered.onboardingMode = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Model/auth provider') && !answered.modelProvider) {
        setTimeout(() => {
          child.stdin?.write('\u001B[B')
          setTimeout(() => child.stdin?.write('\n'), 200)
        }, 300)
        answered.modelProvider = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Filter models') && !answered.filterModels) {
        setTimeout(() => child.stdin?.write('\n'), 300)
        answered.filterModels = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Default model') && !answered.defaultModel) {
        setTimeout(() => child.stdin?.write('\n'), 300)
        answered.defaultModel = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Select channel') && !answered.selectChannel) {
        setTimeout(() => {
          child.stdin?.write('\u001B[B')
          setTimeout(() => child.stdin?.write('\n'), 200)
        }, 300)
        answered.selectChannel = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Configure skills') && !answered.configureSkills) {
        setTimeout(() => child.stdin?.write('N\n'), 300)
        answered.configureSkills = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('Enable hooks') && !answered.enableHooks) {
        setTimeout(() => child.stdin?.write(' \n'), 300)
        answered.enableHooks = true
        outputBuffer = ''
      }

      if (outputBuffer.includes('hatch your bot') && !answered.hatchBot) {
        setTimeout(() => {
          child.stdin?.write('\u001B[B')
          setTimeout(() => child.stdin?.write('\n'), 200)
        }, 300)
        answered.hatchBot = true
        outputBuffer = ''
      }
    }

    child.stdout?.on('data', handleOutput)
    child.stderr?.on('data', handleOutput)

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0 || code === null) {
        resolve()
      } else {
        reject(new Error(`openclaw onboard exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(err)
    })
  })
}

export async function syncApiKeyToOpenclaw(): Promise<{ success: boolean; error?: string }> {
  try {
    const apiKey = getSetting('api_key')
    const endpoint = getSetting('endpoint')

    if (!apiKey) {
      return { success: false, error: 'API Key 未配置' }
    }

    if (!fs.existsSync(OPENCLAW_DIR)) {
      fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
    }

    let envContent = ''
    if (fs.existsSync(OPENCLAW_ENV_FILE)) {
      envContent = fs.readFileSync(OPENCLAW_ENV_FILE, 'utf-8')
    }

    const envLines = envContent.split('\n').filter((line) => {
      const trimmed = line.trim()
      return trimmed && !trimmed.startsWith('OPENAI_API_KEY=') && !trimmed.startsWith('OPENAI_BASE_URL=') && !trimmed.startsWith('GATEWAY_DISABLE_AUTH=')
    })

    envLines.push(`OPENAI_API_KEY=${apiKey}`)
    if (endpoint) {
      envLines.push(`OPENAI_BASE_URL=${endpoint}`)
    }
    // 禁用 Gateway Token 验证（开发模式）
    envLines.push('GATEWAY_DISABLE_AUTH=true')

    fs.writeFileSync(OPENCLAW_ENV_FILE, envLines.join('\n') + '\n', { mode: 0o600 })
    return { success: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { success: false, error: errorMessage }
  }
}

export async function setupChannel(mainWindow: BrowserWindow | null, channel: 'weixin' | 'feishu'): Promise<{ success: boolean; error?: string }> {
  try {
    sendChannelStatus(mainWindow, channel, 'connecting')

    console.log(`[OpenClaw] Setting up channel: ${channel}`)

    // 微信渠道使用专门的 CLI 工具
    let command: string
    let args: string[]

    if (channel === 'weixin') {
      command = 'npx'
      args = ['-y', '@tencent-weixin/openclaw-weixin-cli@latest', 'install']
      console.log(`[OpenClaw] Using WeChat CLI: npx -y @tencent-weixin/openclaw-weixin-cli@latest install`)
    } else {
      // 飞书渠道使用 openclaw channels add
      const openclawPath = findOpenclawPath()
      command = openclawPath
      args = ['channels', 'add']
      console.log(`[OpenClaw] Using openclaw path: ${openclawPath}`)
    }

    const child = spawn(command, args, {
      env: getSpawnEnv(),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let outputBuffer = ''
    let errorBuffer = ''
    let channelSelected = false

    const handleOutput = (data: Buffer): void => {
      const text = data.toString()
      console.log(`[OpenClaw Channel ${channel}] stdout:`, text)
      outputBuffer += text

      // Auto-select channel when prompted
      if (!channelSelected && (text.includes('Select') || text.includes('选择') || text.includes('weixin') || text.includes('feishu'))) {
        console.log(`[OpenClaw] Auto-selecting channel: ${channel}`)
        const channelInput = channel === 'weixin' ? '1\n' : '2\n'
        child.stdin?.write(channelInput)
        channelSelected = true
      }

      const urlMatch = outputBuffer.match(/https?:\/\/[^\s]+/)
      if (urlMatch) {
        console.log(`[OpenClaw] Found QR code URL: ${urlMatch[0]}`)
        sendChannelQrcode(mainWindow, channel, urlMatch[0], 'url')
      }

      const asciiQrMatch = outputBuffer.match(/[█▄▀\s]{10,}/)
      if (asciiQrMatch) {
        console.log(`[OpenClaw] Found ASCII QR code`)
        sendChannelQrcode(mainWindow, channel, asciiQrMatch[0], 'ascii')
      }

      if (outputBuffer.includes('success') || outputBuffer.includes('connected') || outputBuffer.includes('登录成功')) {
        console.log(`[OpenClaw] Channel ${channel} connected successfully`)

        // 先更新数据库状态
        const existingChannels = getSetting('openclaw_channels')
        let channels: string[] = []
        if (existingChannels) {
          try {
            channels = JSON.parse(existingChannels)
          } catch {
            channels = []
          }
        }
        if (!channels.includes(channel)) {
          channels.push(channel)
        }
        saveSetting('openclaw_channels', JSON.stringify(channels))
        saveSetting('openclaw_im_configured', 'true')

        // 数据库更新完成后再发送连接成功状态
        sendChannelStatus(mainWindow, channel, 'connected')
      }
    }

    const handleError = (data: Buffer): void => {
      const text = data.toString()
      console.error(`[OpenClaw Channel ${channel}] stderr:`, text)
      errorBuffer += text
      // Also treat stderr as potential output containing QR codes
      handleOutput(data)
    }

    child.stdout?.on('data', handleOutput)
    child.stderr?.on('data', handleError)

    return new Promise((resolve) => {
      child.on('close', (code) => {
        console.log(`[OpenClaw] Channel setup process exited with code: ${code}`)
        console.log(`[OpenClaw] Output buffer:`, outputBuffer)
        console.log(`[OpenClaw] Error buffer:`, errorBuffer)

        if (code === 0) {
          resolve({ success: true })
        } else {
          const errorMsg = errorBuffer || outputBuffer || `Process exited with code ${code}`
          sendChannelStatus(mainWindow, channel, 'error', errorMsg)
          resolve({ success: false, error: errorMsg })
        }
      })

      child.on('error', (err) => {
        console.error(`[OpenClaw] Channel setup error:`, err)
        sendChannelStatus(mainWindow, channel, 'error', err.message)
        resolve({ success: false, error: err.message })
      })
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[OpenClaw] Setup channel exception:`, errorMessage)
    sendChannelStatus(mainWindow, channel, 'error', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Check if OpenClaw Gateway is already running by checking the port
 */
export async function isGatewayRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => {
        // Port is in use, gateway is running
        resolve(true)
      })
      .once('listening', () => {
        // Port is free, gateway is not running
        tester.close()
        resolve(false)
      })
      .listen(GATEWAY_PORT_NUMBER, '127.0.0.1')
  })
}

export async function startGateway(): Promise<void> {
  // Check if gateway is already running by checking the port
  const isRunning = await isGatewayRunning()
  if (isRunning) {
    console.log('[OpenClaw Gateway] Already running on port', GATEWAY_PORT)
    return
  }

  if (gatewayProcess) {
    console.log('[OpenClaw Gateway] Process already exists')
    return
  }

  try {
    const openclawPath = findOpenclawPath()
    console.log('[OpenClaw Gateway] Starting gateway...')

    gatewayProcess = spawn(openclawPath, ['gateway', 'start'], {
      env: getSpawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    gatewayProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      console.log('[OpenClaw Gateway]', output.trim())
    })

    gatewayProcess.stderr?.on('data', (data) => {
      const output = data.toString()
      console.error('[OpenClaw Gateway Error]', output.trim())
    })

    gatewayProcess.on('close', (code, signal) => {
      console.log(`[OpenClaw Gateway] Exited with code ${code}, signal ${signal}`)
      gatewayProcess = null
    })

    gatewayProcess.on('error', (err) => {
      console.error('[OpenClaw Gateway] Error:', err)
      gatewayProcess = null
    })

    // Wait a bit for gateway to start
    await new Promise((resolve) => setTimeout(resolve, 2000))
    console.log('[OpenClaw Gateway] Started successfully')
  } catch (err) {
    console.error('[OpenClaw Gateway] Failed to start:', err)
    gatewayProcess = null
    throw err
  }
}

export function stopGateway(): void {
  if (!gatewayProcess) return

  const pid = gatewayProcess.pid
  if (!pid) {
    gatewayProcess = null
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // process may already be dead
  }

  setTimeout(() => {
    if (gatewayProcess && gatewayProcess.pid) {
      try {
        process.kill(gatewayProcess.pid, 'SIGKILL')
      } catch {
        // ignore
      }
    }
    gatewayProcess = null
  }, 5000)

  console.log('[OpenClaw Gateway] Stopping...')
}

export function getInstallStatus(): { installed: boolean; imConfigured: boolean; imSkipped: boolean; channels: string[] } {
  // 实际检查 OpenClaw CLI 是否已安装
  let cliInstalled = false
  try {
    const openclawPath = findOpenclawPath()
    execSync(`${openclawPath} --version`, { env: getSpawnEnv(), stdio: 'pipe' })
    cliInstalled = true
  } catch {
    cliInstalled = false
  }

  // 检查配置文件是否存在
  const configExists = fs.existsSync(OPENCLAW_ENV_FILE)

  // 如果 CLI 已安装且配置文件存在，但数据库标志未设置，则自动设置
  if (cliInstalled && configExists && getSetting('openclaw_installed') !== 'true') {
    console.log('[OpenClaw] Detected existing installation, updating database flag')
    saveSetting('openclaw_installed', 'true')

    // 如果配置文件中有 SKIP_IM_SETUP=true，则标记为已跳过 IM 配置
    try {
      const envContent = fs.readFileSync(OPENCLAW_ENV_FILE, 'utf-8')
      if (envContent.includes('SKIP_IM_SETUP=true')) {
        saveSetting('openclaw_im_skipped', 'true')
      }
    } catch {
      // ignore
    }
  }

  const installed = cliInstalled && configExists
  const imConfigured = getSetting('openclaw_im_configured') === 'true'
  const imSkipped = getSetting('openclaw_im_skipped') === 'true'
  let channels: string[] = []
  const channelsStr = getSetting('openclaw_channels')
  if (channelsStr) {
    try {
      channels = JSON.parse(channelsStr)
    } catch {
      channels = []
    }
  }
  return { installed, imConfigured, imSkipped, channels }
}

export function skipImConfiguration(): void {
  saveSetting('openclaw_im_skipped', 'true')
}

export function resetOpenclaw(): void {
  saveSetting('openclaw_installed', '')
  saveSetting('openclaw_im_configured', '')
  saveSetting('openclaw_im_skipped', '')
  saveSetting('openclaw_channels', '')
  saveSetting('openclaw_gateway_token', '')

  stopGateway()

  try {
    if (fs.existsSync(OPENCLAW_DIR)) {
      fs.rmSync(OPENCLAW_DIR, { recursive: true, force: true })
    }
  } catch (err) {
    console.error('[OpenClaw] Failed to remove ~/.openclaw:', err)
  }

  try {
    const npmPath = findNpmPath()
    execSync(`${npmPath} uninstall -g openclaw`, { env: getSpawnEnv() })
  } catch {
    // ignore uninstall errors
  }
}

export const GATEWAY_PORT_NUMBER = GATEWAY_PORT

/**
 * Get the dashboard URL with token by reading from clawdbot.json
 * @returns Promise<string> - Dashboard URL with token (e.g., http://127.0.0.1:18789/#token=xxx)
 */
export async function getDashboardUrl(): Promise<string> {
  try {
    const clawdbotConfigPath = path.join(os.homedir(), '.clawdbot', 'clawdbot.json')
    console.log('[OpenClaw] getDashboardUrl: Reading config from', clawdbotConfigPath)

    if (!fs.existsSync(clawdbotConfigPath)) {
      throw new Error('OpenClaw configuration file not found at ~/.clawdbot/clawdbot.json')
    }

    const configContent = fs.readFileSync(clawdbotConfigPath, 'utf-8')
    const config = JSON.parse(configContent)
    console.log('[OpenClaw] getDashboardUrl: Config loaded, gateway auth:', config?.gateway?.auth)

    const token = config?.gateway?.auth?.token
    if (!token) {
      throw new Error('Gateway token not found in OpenClaw configuration')
    }

    const port = config?.gateway?.port || GATEWAY_PORT
    const url = `http://127.0.0.1:${port}/#token=${token}`
    console.log('[OpenClaw] getDashboardUrl: Generated URL:', url)

    return url
  } catch (err) {
    console.error('[OpenClaw] getDashboardUrl: Error:', err)
    throw new Error(`Failed to get dashboard URL: ${err instanceof Error ? err.message : String(err)}`)
  }
}
