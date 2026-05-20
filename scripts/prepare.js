#!/usr/bin/env node
require('./_load-env')
// 工作流模式：解析视频 → 把 prompt 复制到剪贴板 → 打开 ChatGPT 网页 + 参考图
// 用户在 ChatGPT 里 Cmd+V 贴文字 + 拖参考图 + 等生图 + 保存
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, spawnSync } = require('child_process')

const url = process.argv[2]
if (!url) {
  console.error('用法: prepare.js <video_url>')
  process.exit(1)
}

const VIDEO_API = process.env.VIDEO_API_BASE || 'https://daily-digest-rust.vercel.app'
const VIDEO_API_TOKEN = process.env.VIDEO_API_TOKEN || ''
const SKILL_DIR = path.dirname(path.dirname(__filename))
const REFERENCE_PATH = path.join(SKILL_DIR, 'reference.png')

;(async () => {
  // 1. 解析视频章节
  console.log('[1/3] 调 NeuraRead API 解析视频章节...')
  const aRes = await fetch(`${VIDEO_API}/api/video-analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(VIDEO_API_TOKEN ? { 'Authorization': `Bearer ${VIDEO_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(180000),
  })
  if (!aRes.ok) {
    const txt = await aRes.text().catch(() => '')
    console.error(`视频解析失败 HTTP ${aRes.status}: ${txt.slice(0, 200)}`)
    process.exit(1)
  }
  const data = await aRes.json()
  if (data.error) {
    console.error('视频解析返回错误:', data.error)
    process.exit(1)
  }

  const title = data.video?.title || ''
  const chapters = data.chapters || []
  if (!chapters.length) {
    console.error('视频没有章节内容')
    process.exit(1)
  }
  console.log(`  ✓ 标题: ${title.slice(0, 40)}`)
  console.log(`  ✓ 章节: ${chapters.length} 段`)

  // 2. 拼 prompt（你给 ChatGPT 的标准格式）
  const items = chapters.map((c, i) => {
    const ts = c.startTime ? `[${c.startTime}] ` : ''
    const t = (c.title || `第 ${i + 1} 段`).replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '')
    const sum = c.summary || ''
    const bullets = Array.isArray(c.bullets) ? c.bullets.map(b => `  - ${b}`).join('\n') : ''
    return [ts + t, sum, bullets].filter(Boolean).join('\n')
  }).join('\n\n')
  const prompt = `帮我根据视频内容，生成手绘总结仿照图片：\n\n${items}`

  // 3. 把 prompt 写到剪贴板
  console.log('[2/3] 复制 prompt 到剪贴板...')
  try {
    const pbcopy = spawn('pbcopy')
    pbcopy.stdin.write(prompt)
    pbcopy.stdin.end()
    await new Promise((resolve) => pbcopy.on('close', resolve))
    console.log('  ✓ 剪贴板已就绪（直接 Cmd+V 粘贴）')
  } catch (e) {
    console.warn('  ✗ pbcopy 失败，prompt 保存到文件:', e.message)
    const fp = path.join(os.tmpdir(), `sketchnote-prompt-${Date.now()}.txt`)
    fs.writeFileSync(fp, prompt)
    console.log(`  → ${fp}`)
  }

  // 4. 打开 ChatGPT 网页 + 参考图
  console.log('[3/3] 打开 ChatGPT 网页 + 参考图...')
  spawnSync('open', ['https://chatgpt.com/?model=gpt-5'])
  if (fs.existsSync(REFERENCE_PATH)) {
    spawnSync('open', ['-R', REFERENCE_PATH]) // -R 在 Finder 里高亮显示，方便拖拽
    console.log(`  ✓ ChatGPT 已打开`)
    console.log(`  ✓ Finder 已定位到参考图：${REFERENCE_PATH}`)
  } else {
    console.log(`  ✓ ChatGPT 已打开`)
    console.log(`  ⚠ 参考图未找到 (${REFERENCE_PATH})`)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ 准备完成 — 现在在 ChatGPT 里：')
  console.log('   1. 把 Finder 里的 reference.png 拖进 ChatGPT 对话框')
  console.log('   2. Cmd+V 粘贴 prompt')
  console.log('   3. 回车 → 等 GPT-5 出图')
  console.log('   4. 满意后右键图片 → 保存到 ~/Downloads/')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
