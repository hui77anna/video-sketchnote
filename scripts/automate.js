#!/usr/bin/env node
// 浏览器自动化模式：Playwright 操作 ChatGPT 网页拿真实生图结果
// 第一次跑：弹出 Chrome 让你手动登录 ChatGPT，之后 cookie 持久化
const fs = require('fs')
const path = require('path')
const os = require('os')
const { chromium } = require('playwright')

const url = process.argv[2]
if (!url) {
  console.error('用法: automate.js <video_url>')
  process.exit(1)
}

const VIDEO_API = process.env.VIDEO_API_BASE || 'https://daily-digest-rust.vercel.app'
const SKILL_DIR = path.dirname(path.dirname(__filename))
const REFERENCE_PATH = path.join(SKILL_DIR, 'reference.png')
const USER_DATA_DIR = path.join(SKILL_DIR, 'chrome-profile')
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads')

;(async () => {
  // 1. 解析视频
  console.log('[1/5] 解析视频章节...')
  const aRes = await fetch(`${VIDEO_API}/api/video-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(180000),
  })
  if (!aRes.ok) {
    console.error(`视频解析失败 HTTP ${aRes.status}`)
    process.exit(1)
  }
  const data = await aRes.json()
  const chapters = data.chapters || []
  if (!chapters.length) { console.error('没有章节'); process.exit(1) }
  console.log(`  ✓ ${chapters.length} 段章节`)

  // 2. 拼 prompt
  const items = chapters.map((c, i) => {
    const ts = c.startTime ? `[${c.startTime}] ` : ''
    const t = (c.title || `第 ${i + 1} 段`).replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '')
    const sum = c.summary || ''
    const bullets = Array.isArray(c.bullets) ? c.bullets.map(b => `  - ${b}`).join('\n') : ''
    return [ts + t, sum, bullets].filter(Boolean).join('\n')
  }).join('\n\n')
  const prompt = `帮我根据视频内容，生成手绘总结仿照图片：\n\n${items}`

  // 3. 启动浏览器（持久化 profile）
  console.log('[2/5] 启动 Chrome（首次需手动登录 ChatGPT）...')
  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true })
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  })
  const page = context.pages()[0] || await context.newPage()

  // 4. 打开 ChatGPT
  console.log('[3/5] 打开 chatgpt.com...')
  await page.goto('https://chatgpt.com/?model=gpt-5', { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 等待对话框出现（如果未登录会出现登录按钮，用户需手动登录）
  console.log('  等待对话框（如未登录请在浏览器中手动登录后回车继续）...')
  try {
    await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 120000 })
  } catch {
    console.error('  等不到对话框，请确认已登录 ChatGPT')
    await context.close()
    process.exit(1)
  }
  console.log('  ✓ ChatGPT 就绪')

  // 5. 上传参考图（如果存在）
  if (fs.existsSync(REFERENCE_PATH)) {
    console.log('[4/5] 上传参考图...')
    // ChatGPT 用 hidden input[type="file"]，用 setInputFiles 直接注入
    const fileInput = await page.$('input[type="file"]')
    if (fileInput) {
      await fileInput.setInputFiles(REFERENCE_PATH)
      console.log('  ✓ 参考图已上传')
      // 等待预览缩略图出现，确认上传完成
      await page.waitForTimeout(3000)
    } else {
      console.warn('  ⚠ 没找到 file input，跳过参考图上传')
    }
  } else {
    console.log('[4/5] 无参考图，跳过')
  }

  // 6. 输入 prompt
  console.log('[5/5] 输入 prompt + 提交...')
  // ChatGPT 用 ProseMirror 编辑器（contenteditable div），不是 textarea
  // 用 locator 找第一个 visible 的输入区，click 时 force 避免被遮挡误判
  const promptArea = page.locator('#prompt-textarea, div[contenteditable="true"]').first()
  await promptArea.waitFor({ state: 'visible', timeout: 30000 })
  await promptArea.click({ force: true })
  await page.waitForTimeout(500)
  // 用键盘输入（contenteditable 不能 fill，必须 type）
  await page.keyboard.type(prompt, { delay: 5 })
  await page.waitForTimeout(2000)
  // 找发送按钮，优先 data-testid，否则按 Enter
  const sendBtn = page.locator('[data-testid="send-button"], [data-testid="composer-send-button"], button[aria-label*="发送" i], button[aria-label*="send" i]').first()
  if (await sendBtn.count() > 0) {
    await sendBtn.click({ force: true }).catch(async () => {
      await page.keyboard.press('Enter')
    })
  } else {
    await page.keyboard.press('Enter')
  }
  console.log('  ✓ 已提交，等待 ChatGPT 生图（通常 30-90 秒）...')

  // 7. 等待图片生成
  // ChatGPT 出图后，会在最新一条 assistant message 里出现 <img>
  let imgUrl = null
  const startTime = Date.now()
  const maxWait = 5 * 60 * 1000 // 5 分钟超时
  while (Date.now() - startTime < maxWait) {
    await page.waitForTimeout(3000)
    // 找最新一条助手消息里的图片
    imgUrl = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="oaiusercontent"], img[src*="files.oaiusercontent"], img[alt*="生成"], img[alt*="image"], main img')
      for (let i = imgs.length - 1; i >= 0; i--) {
        const src = imgs[i].src
        // 跳过头像/icon（通常 < 100px）
        if (imgs[i].naturalWidth >= 256 || imgs[i].width >= 256) return src
      }
      return null
    })
    if (imgUrl) break
    process.stdout.write('.')
  }
  console.log()

  if (!imgUrl) {
    console.error('  ✗ 等不到生成的图片，请手动检查 ChatGPT 是否出图（浏览器保持打开）')
    process.exit(1)
  }
  console.log(`  ✓ 拿到图片 URL`)

  // 8. 下载图片
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
  const filename = `sketchnote-chatgpt-${Date.now()}.png`
  const fp = path.join(DOWNLOADS_DIR, filename)

  // 用浏览器 fetch 拿图（保留 cookie/session）
  const buf = await page.evaluate(async (url) => {
    const r = await fetch(url)
    const ab = await r.arrayBuffer()
    return Array.from(new Uint8Array(ab))
  }, imgUrl)
  fs.writeFileSync(fp, Buffer.from(buf))

  console.log(`\n✅ ${fp}`)
  console.log('（浏览器会保持打开 5 秒后关闭）')
  await page.waitForTimeout(5000)
  await context.close()
})().catch(async (e) => {
  console.error('错误:', e.message)
  process.exit(1)
})
