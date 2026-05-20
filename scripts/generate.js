#!/usr/bin/env node
require('./_load-env')
const fs = require('fs')
const path = require('path')
const os = require('os')

const url = process.argv[2]
const refArg = process.argv[3]
if (!url) {
  console.error('用法: generate.js <video_url> [reference_image_path]')
  process.exit(1)
}

const OPENAI_KEY = process.env.OPENAI_API_KEY
if (!OPENAI_KEY) {
  console.error('错误: OPENAI_API_KEY 环境变量未设置')
  process.exit(1)
}

const VIDEO_API = process.env.VIDEO_API_BASE || 'https://daily-digest-rust.vercel.app'
const VIDEO_API_TOKEN = process.env.VIDEO_API_TOKEN || ''
const SKILL_DIR = path.dirname(path.dirname(__filename))
// 参考图查找顺序：命令行参数 > skill 目录里的 reference.png/jpg > 无参考
function loadReferenceImage() {
  const candidates = [
    refArg,
    path.join(SKILL_DIR, 'reference.png'),
    path.join(SKILL_DIR, 'reference.jpg'),
    path.join(SKILL_DIR, 'reference.jpeg'),
    path.join(SKILL_DIR, 'reference.webp'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p)
      const ext = path.extname(p).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext
      return { dataUri: `data:image/${mime};base64,${buf.toString('base64')}`, path: p }
    }
  }
  return null
}

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
  const durationSec = Number(data.video?.duration) || 0
  const summary = data.summary || ''
  const chapters = data.chapters || []
  const highlights = data.highlights || []
  const transcript = data.transcript || ''

  const chapterTextTotal = chapters.reduce((sum, c) => {
    return sum + (c.title || '').length + (c.summary || '').length +
      ((c.bullets || []).join('').length)
  }, 0)
  const totalContent = chapterTextTotal + transcript.length + summary.length
  if (totalContent < 100) {
    console.error(`✗ 视频解析返回内容近乎为空（${totalContent} 字），无法生成。可能是解析失败或视频私密。`)
    process.exit(1)
  }
  console.log(`  ✓ 标题: ${title.slice(0, 40)}`)
  console.log(`  ✓ 时长: ${durationSec || '?'}s`)
  console.log(`  ✓ 章节: ${chapters.length} 段, transcript: ${transcript.length} 字, highlights: ${highlights.length} 条, 章节内容: ${chapterTextTotal} 字, 总计: ${totalContent} 字`)

  // 2. 拼 prompt — 包含完整信息（标题+整体摘要+章节+亮点+transcript）
  const items = chapters.map((c, i) => {
    const ts = c.startTime ? `[${c.startTime}] ` : ''
    const t = (c.title || `第 ${i + 1} 段`).replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '')
    const sum = c.summary || ''
    const bullets = Array.isArray(c.bullets) ? c.bullets.map(b => `  - ${b}`).join('\n') : ''
    return [ts + t, sum, bullets].filter(Boolean).join('\n')
  }).join('\n\n')

  const highlightsText = highlights.map(h => {
    const ts = h.timestamp ? `[${h.timestamp}] ` : ''
    return `${ts}${h.desc || h.title || ''}`
  }).filter(Boolean).join('\n')

  const promptParts = [
    '帮我根据视频内容，生成手绘总结仿照图片：',
    '',
    `视频标题：${title}`,
    summary ? `\n整体摘要：${summary}` : '',
    items ? `\n章节大纲：\n${items}` : '',
    highlightsText ? `\n关键亮点：\n${highlightsText}` : '',
    transcript ? `\n完整逐字稿：\n${transcript}` : '',
  ].filter(Boolean)
  const prompt = promptParts.join('\n')
  console.log(`  ✓ 拼接 prompt 共 ${prompt.length} 字`)

  // ===== 严格模式：必须有参考图，否则直接拒绝 =====
  const ref = loadReferenceImage()
  if (!ref) {
    console.error(`✗ 必须放参考图：${path.join(SKILL_DIR, 'reference.png')}`)
    console.error('  没有参考图无法保证风格一致性，按用户要求严格模式不允许跳过此步。')
    process.exit(1)
  }
  console.log(`[2/3] 参考图: ${ref.path} → 喂给 GPT-5`)


  // ========== Step A: GPT-5 用 sketchnote system prompt + 参考图 转写为详细英文 prompt ==========
  console.log('  [Step A] GPT-5 转写为详细英文 prompt（sketchnote 专用 system prompt）...')
  const sketchnoteSystem = `你是 sketchnote 图像 prompt 工程师。任务：把用户提供的视频内容（中文）+ 参考图（风格示范）转写为一段超详细的英文画面 prompt，将由 gpt-image-2 模型直接渲染。

【硬性规则】
- 输出**只**返回最终英文 prompt，不要任何解释、前缀、markdown
- 长度 400-700 英文词
- 必须包含视频中**所有章节**的关键中文文字（标题、关键 bullet、关键数字）原样保留——gpt-image-2 需要这些中文字符去渲染
- 严格按照参考图的视觉风格：观察并复制其颜色块、布局、装饰密度、插画风格

【prompt 结构（必须依次包含）】

1. **媒介与尺寸**：A hand-drawn watercolor and ink sketchnote on cream beige paper (#FAF5E8) with subtle paper texture, 1024x1536 portrait.

2. **整体布局**：竖版 1024×1536。N 个大横向章节卡片块从上到下堆叠（每个章节 = 一个独立彩色边框的大块）。**每个大块内部不是简单一列**，而是包含 3-5 个子区块（嵌套结构）：例如左侧"作用"子框 + 右侧"来源"子网格 + 右上角"小贴士"子框。子区块用淡色虚线/浅色块分隔，整个章节卡片用主色实线粗边框包围。这种"大块套小块"的嵌套层次必须做到——参考图核心特征。

3. **每个章节详细描述**（每章 80-150 词）：
   - 圆形数字 badge（实心 ~70px 圆 + 白色 ① ② ③ 数字）
   - 章节标题（中文圆润手写体 ~24pt，颜色匹配 badge）— 必须保留视频原文 Chinese 标题
   - 正文/bullets（3-4 项，每项配手绘小图标 + 中文原文）
   - 拟人化插画（笑脸食物 / 内脏 / 工具 / 设备）
   - 关键数字（百分比 / 克数 / 时长，大字 + 强调线）

4. **配色方案**：明确列出 5-6 个 hex
   Color palette: mint green #B8E6B8, peach orange #FFD4A8, sky blue #B8DCF0, soft pink #FFC4D9, lavender #D9C4FF, cream paper #FAF5E8.

5. **装饰元素**：sparkles ✨, hearts ♡, checkmarks ✓, curved arrows, small flowers, scattered in empty corners.

6. **文字质量**：All Chinese characters crisp, complete strokes, fully legible. Rounded brush handwriting (not technical pen). Adequate breathing room.

7. **底部 takeaway**：椭圆胶囊条总结一句话。

8. **禁止项**：No photographs, no gradients, no digital UI, no emoji unicode, no neon colors, no dark backgrounds.`

  const writeRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5',
      instructions: sketchnoteSystem,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: ref.dataUri },
          { type: 'input_text', text: prompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(540000),
  })

  if (!writeRes.ok) {
    const t = await writeRes.text().catch(() => '')
    console.error(`✗ GPT-5 转写失败 HTTP ${writeRes.status}: ${t.slice(0, 300)}`)
    console.error('（严格模式：不降级到次档，请修复后重试）')
    process.exit(1)
  }
  const writeData = await writeRes.json()
  const msg = (writeData.output || []).find(o => o.type === 'message')
  const detailedPrompt = msg?.content?.[0]?.text?.trim()
  if (!detailedPrompt || detailedPrompt.length < 200) {
    console.error(`✗ GPT-5 转写返回内容太短或为空（长度 ${detailedPrompt?.length || 0}）`)
    process.exit(1)
  }
  console.log(`  ✓ 转写完成（${detailedPrompt.length} 字符）`)

  // ========== Step B: gpt-image-2 渲染（严格模式：只用最强模型，不降级）==========
  console.log('  [Step B] gpt-image-2 渲染（严格模式，不降级）...')
  const MAX_ATTEMPTS = 3
  let imgB64 = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: detailedPrompt,
          n: 1,
          size: '1024x1536',
          quality: 'high',
        }),
        signal: AbortSignal.timeout(540000),
      })
      if (!imgRes.ok) {
        const t = await imgRes.text().catch(() => '')
        const transient = imgRes.status >= 500 || imgRes.status === 429
        console.error(`✗ gpt-image-2 第 ${attempt}/${MAX_ATTEMPTS} 次失败 HTTP ${imgRes.status}: ${t.slice(0, 200)}`)
        if (!transient || attempt === MAX_ATTEMPTS) {
          console.error('（严格模式：不降级到 chatgpt-image-latest / 1.5 / 1，请修复后重试）')
          process.exit(1)
        }
      } else {
        const imgData = await imgRes.json()
        imgB64 = imgData.data?.[0]?.b64_json
        if (imgB64) break
        console.error(`✗ 第 ${attempt}/${MAX_ATTEMPTS} 次没返回 b64_json`)
      }
    } catch (e) {
      console.error(`✗ 第 ${attempt}/${MAX_ATTEMPTS} 次网络错: ${e.message || e}`)
      if (attempt === MAX_ATTEMPTS) {
        console.error('（已重试 3 次仍失败，请检查网络或稍后再试）')
        process.exit(1)
      }
    }
    const wait = attempt * 10000
    console.log(`  ⏳ 等 ${wait / 1000}s 后重试...`)
    await new Promise(r => setTimeout(r, wait))
  }
  if (!imgB64) {
    console.error('✗ 重试用尽，仍没拿到图')
    process.exit(1)
  }

  // Step C: 保存
  const outDir = path.join(os.homedir(), 'Downloads')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const fp = path.join(outDir, `sketchnote-${Date.now()}.png`)
  fs.writeFileSync(fp, Buffer.from(imgB64, 'base64'))
  console.log('  ✓ 模型: gpt-5 (转写) + gpt-image-2 (渲染)')
  console.log('[3/3] 保存完成')
  console.log(`✅ ${fp}`)
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
