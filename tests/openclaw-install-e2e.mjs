/**
 * OpenClaw 安装流程 E2E 测试脚本
 *
 * 通过 puppeteer-core 连接到 Electron 应用的 CDP 端口，
 * 驱动 UI 走通完整的 OpenClaw 安装流程：
 *   1. 重置安装状态 + 刷新页面
 *   2. 点击侧边栏 <li> 导航到 OpenClaw 页面
 *   3. 点击"一键安装"按钮
 *   4. 等待安装进度完成（npm install → onboard → write-env → done）
 *   5. 验证进入 IM 接入向导阶段
 *   6. 点击"跳过"按钮
 *   7. 验证进入 WebChat 阶段
 *
 * 使用方式：node tests/openclaw-install-e2e.mjs
 * 前提：Electron 应用已用 --remote-debugging-port=9222 启动
 */

import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots')
const CDP_URL = 'http://127.0.0.1:9222'
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

let screenshotIndex = 0
async function screenshot(page, label) {
  screenshotIndex++
  const name = `${String(screenshotIndex).padStart(2, '0')}-${label}.png`
  const filePath = path.join(SCREENSHOT_DIR, name)
  await page.screenshot({ path: filePath, fullPage: false })
  log(`📸 ${filePath}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  log('🚀 开始 OpenClaw 安装流程 E2E 测试')
  log('='.repeat(60))

  // ── Step 1: 连接 CDP ──
  log('📡 连接到 Electron 应用 (CDP: 9222)...')
  const browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null })
  const pages = await browser.pages()
  log(`📄 发现 ${pages.length} 个页面`)

  let page = pages.find(p => p.url().includes('localhost:5173') || p.url().includes('index.html'))
  if (!page) {
    page = pages.find(p => !p.url().startsWith('devtools://')) || pages[0]
    log(`⚠️ 未精确匹配主页面，使用: ${page.url()}`)
  } else {
    log(`✅ 主页面: ${page.url()}`)
  }

  await screenshot(page, 'initial')

  // ── Step 2: 重置 OpenClaw 状态 ──
  log('\n📋 Step 2: 重置 OpenClaw 安装状态...')
  try {
    await page.evaluate(() => window.api?.openclawReset?.())
    log('✅ 重置完成')
  } catch (err) {
    log(`⚠️ 重置调用失败（可能已是干净状态）: ${err.message}`)
  }

  // 重置后必须 reload 页面，让 React 重新 mount 并从 DB 读取最新状态
  log('🔄 刷新页面以加载重置后的状态...')
  await page.reload({ waitUntil: 'networkidle0', timeout: 15000 })
  await sleep(2000)
  await screenshot(page, 'after-reset-reload')

  // ── Step 3: 点击侧边栏 "OpenClaw" 导航 ──
  // PrimaryNav 使用 <li> 元素，内含 <span> 文本 "OpenClaw"
  log('\n📋 Step 3: 导航到 OpenClaw 页面...')
  const navClicked = await page.evaluate(() => {
    // 搜索所有 li、span、div 中包含 "OpenClaw" 文本的可点击元素
    const candidates = document.querySelectorAll('li, span, div, a, button, nav *')
    for (const el of candidates) {
      // 只匹配直接文本节点包含 OpenClaw 的元素（避免匹配到父容器）
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent)
        .join('')
      const spanText = el.tagName === 'SPAN' ? el.textContent : ''
      if (directText.includes('OpenClaw') || spanText === 'OpenClaw') {
        // 如果是 span，点击其父 li
        const target = el.tagName === 'SPAN' && el.parentElement?.tagName === 'LI' ? el.parentElement : el
        target.click()
        return `clicked <${target.tagName.toLowerCase()}>: "${target.textContent.trim().substring(0, 40)}"`
      }
    }
    // 兜底：遍历所有 li 找包含 OpenClaw 的
    for (const li of document.querySelectorAll('li')) {
      if (li.textContent?.includes('OpenClaw')) {
        li.click()
        return `clicked li (fallback): "${li.textContent.trim().substring(0, 40)}"`
      }
    }
    return null
  })

  if (navClicked) {
    log(`✅ ${navClicked}`)
  } else {
    log('❌ 未找到 OpenClaw 导航项！列出侧边栏所有 li:')
    const allLi = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav li')).map(li => li.textContent?.trim().substring(0, 60))
    )
    log(`  侧边栏 li 列表: ${JSON.stringify(allLi)}`)
  }

  await sleep(1500)
  await screenshot(page, 'openclaw-page')

  // 验证是否成功进入 OpenClaw 页面
  const openclawPageCheck = await page.evaluate(() => {
    const body = document.body.innerText
    return {
      hasInstallButton: body.includes('一键安装'),
      hasInstallTitle: body.includes('安装 OpenClaw'),
      hasImWizard: body.includes('接入 IM') || body.includes('微信') || body.includes('飞书'),
      hasWebChat: body.includes('WebChat') || body.includes('Gateway'),
      preview: body.substring(0, 300)
    }
  })

  log(`📄 页面状态: 安装按钮=${openclawPageCheck.hasInstallButton}, 安装标题=${openclawPageCheck.hasInstallTitle}, IM向导=${openclawPageCheck.hasImWizard}, WebChat=${openclawPageCheck.hasWebChat}`)

  // 如果已经在 IM 向导或 WebChat 阶段，说明之前安装过但重置没生效，跳到对应步骤
  if (openclawPageCheck.hasImWizard || openclawPageCheck.hasWebChat) {
    log('ℹ️ OpenClaw 已安装，直接进入后续阶段验证')
  }

  // ── Step 4: 点击"一键安装"按钮 ──
  if (openclawPageCheck.hasInstallButton || openclawPageCheck.hasInstallTitle) {
    log('\n📋 Step 4: 点击"一键安装"按钮...')
    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('一键安装')),
        { timeout: 10000 }
      )
      const clicked = await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.includes('一键安装')) {
            btn.click()
            return true
          }
        }
        return false
      })
      log(clicked ? '✅ 已点击"一键安装"' : '❌ 未找到按钮')
    } catch (err) {
      log(`❌ 等待"一键安装"超时: ${err.message}`)
      await screenshot(page, 'install-button-not-found')
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1500))
      log(`📄 页面文本:\n${bodyText}`)
    }

    await sleep(2000)
    await screenshot(page, 'install-started')

    // ── Step 5: 等待安装完成 ──
    log('\n📋 Step 5: 等待安装完成...')
    log('⏳ npm install -g openclaw → onboard → write-env → done')
    log(`⏳ 最长等待 ${INSTALL_TIMEOUT_MS / 1000}s`)

    const startTime = Date.now()
    let installCompleted = false
    let lastSnapshot = ''

    while (Date.now() - startTime < INSTALL_TIMEOUT_MS) {
      await sleep(5000)
      const elapsed = Math.round((Date.now() - startTime) / 1000)

      const progress = await page.evaluate(() => {
        const body = document.body.innerText
        return {
          hasProgress: body.includes('正在') || body.includes('安装 OpenClaw 包') || body.includes('初始化配置'),
          hasImWizard: body.includes('接入 IM') || body.includes('微信') || body.includes('飞书') || body.includes('跳过'),
          hasWebChat: body.includes('WebChat') || body.includes('Gateway'),
          hasError: body.includes('安装失败') || body.includes('重试'),
          snippet: body.substring(0, 200)
        }
      })

      if (progress.snippet !== lastSnapshot) {
        lastSnapshot = progress.snippet
        log(`📊 [${elapsed}s] ${progress.hasProgress ? '安装进行中...' : '状态变化'}`)
      }

      if (progress.hasImWizard) {
        log(`✅ [${elapsed}s] 安装完成 → IM 接入向导`)
        installCompleted = true
        await screenshot(page, 'install-done-im-wizard')
        break
      }
      if (progress.hasWebChat) {
        log(`✅ [${elapsed}s] 安装完成 → WebChat`)
        installCompleted = true
        await screenshot(page, 'install-done-webchat')
        break
      }
      if (progress.hasError) {
        log(`❌ [${elapsed}s] 安装出错`)
        await screenshot(page, 'install-error')
        break
      }
      if (elapsed % 30 === 0 && elapsed > 0) {
        await screenshot(page, `progress-${elapsed}s`)
      }
    }

    if (!installCompleted) {
      log(`⚠️ 安装超时`)
      await screenshot(page, 'install-timeout')
    }
  }

  // ── Step 6: IM 向导 → 点击"跳过" ──
  log('\n📋 Step 6: 处理 IM 接入向导...')
  const skipResult = await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      const text = btn.textContent || ''
      if (text.includes('跳过') || text.includes('暂不配置')) {
        btn.click()
        return `clicked: ${text.trim()}`
      }
    }
    return null
  })

  if (skipResult) {
    log(`✅ ${skipResult}`)
    await sleep(3000)
    await screenshot(page, 'after-skip-im')
  } else {
    log('ℹ️ 未找到跳过按钮（可能已跳过或不在 IM 向导页）')
  }

  // ── Step 7: 验证最终状态 ──
  log('\n📋 Step 7: 验证最终状态...')
  await screenshot(page, 'final-state')

  const finalState = await page.evaluate(() => {
    const body = document.body.innerText
    return {
      hasWebChat: body.includes('WebChat') || body.includes('Gateway') || body.includes('聊天'),
      hasImWizard: body.includes('接入 IM') || body.includes('微信') || body.includes('飞书'),
      hasInstall: body.includes('一键安装'),
      preview: body.substring(0, 800)
    }
  })

  log('\n' + '='.repeat(60))
  log('📊 测试结果汇总:')
  log('='.repeat(60))

  if (finalState.hasWebChat) {
    log('✅ 最终状态: WebChat — 安装流程完全走通！')
  } else if (finalState.hasImWizard) {
    log('✅ 最终状态: IM 接入向导 — 安装成功，等待 IM 配置')
  } else if (finalState.hasInstall) {
    log('❌ 最终状态: 仍在安装引导页')
  } else {
    log('⚠️ 最终状态: 未知')
  }

  log(`\n📁 截图: ${SCREENSHOT_DIR}`)
  browser.disconnect()
  log('\n🏁 测试完成！')
}

main().catch(err => {
  console.error('❌ 测试失败:', err)
  process.exit(1)
})
