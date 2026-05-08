#!/usr/bin/env node
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
    headers: { 'Content-Type': 'application/json' },
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
  const summary = data.summary || ''
  const chapters = data.chapters || []
  const highlights = data.highlights || []
  const transcript = data.transcript || ''
  if (!chapters.length && !summary && !transcript) {
    console.error('视频没有任何内容，可能解析失败或视频太短')
    process.exit(1)
  }
  console.log(`  ✓ 标题: ${title.slice(0, 40)}`)
  console.log(`  ✓ 章节: ${chapters.length} 段, transcript: ${transcript.length} 字, highlights: ${highlights.length} 条`)

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

  // 3. 调 OpenAI Responses API（gpt-5 + image_generation），失败 fallback gpt-4.1 → gpt-4o
  const ref = loadReferenceImage()
  if (ref) console.log(`[2/3] 参考图: ${ref.path} → 喂给 GPT-5`)
  else console.log('[2/3] 无参考图（提示：放一张样图到 ~/.claude/skills/video-sketchnote/reference.png 可大幅提升风格一致性）')

  // ========== 方案 D 主路径：GPT-5 用专用 system prompt 转写 → gpt-image-1 生图 ==========
  // 模仿 ChatGPT 网页内部的 prompt 改写流程
  if (ref) {
    console.log('  [Step A] GPT-5 转写为详细英文 prompt（sketchnote 专用 system prompt）...')
    try {
      const sketchnoteSystem = `你是 sketchnote 图像 prompt 工程师。任务：把用户提供的视频内容（中文）+ 参考图（风格示范）转写为一段超详细的英文画面 prompt，将由 gpt-image-1 模型直接渲染。

【硬性规则】
- 输出**只**返回最终英文 prompt，不要任何解释、前缀、markdown
- 长度 400-700 英文词
- 必须包含视频中**所有章节**的关键中文文字（标题、关键 bullet、关键数字）原样保留——gpt-image-1 需要这些中文字符去渲染
- 严格按照参考图的视觉风格：观察并复制其颜色块、布局、装饰密度、插画风格

【prompt 结构（必须依次包含）】

1. **媒介与尺寸**："A hand-drawn watercolor and ink sketchnote illustration on cream beige paper (#FAF5E8) with subtle paper texture, 1024x1024 square."

2. **整体布局**：竖版 1024×1536 画布。N 个大横向章节卡片块（每个章节 = 一个独立彩色边框的大块）从上到下堆叠。**每个大块内部不是简单一列**，而是包含 3-5 个**子区块**（嵌套结构）：例如左侧一个"作用"子框，右侧一个"来源"子网格（含多个食物 icon + label），右上角一个"提示"小贴士子框。子区块用淡色虚线/浅色块分隔，整个章节卡片用主色实线粗边框包围。这种"大块套小块"的嵌套层次必须做到——参考图这种"手账"风格的核心特征就是嵌套密度。

3. **每个章节详细描述**（按顺序，每章 80-150 词）：
   - 圆形数字 badge（"a solid colored circle (~70px) with white number ①/②/③ inside, positioned at row's left edge, color: [each section uses a different color from palette below]"）
   - 章节标题文字（"original Chinese title in rounded brush handwriting at ~24pt, color matching the badge"）— 必须包含视频原文 Chinese 标题
   - 正文/bullets（"3-4 hand-drawn bullet items with small icons, each with the following Chinese text: '...'"）— 每个 bullet 的中文内容必须列出
   - 插画描述（"a kawaii personified [食物/器官/工具] with friendly smile, holding/showing [视频里的具体物品]"）
   - 关键数字（如有）："[X]% / [Y]克 in large bold [color] handwriting, with a hand-drawn accent stroke around it"

4. **配色方案**：明确列出 5-6 个颜色 hex
   "Color palette: mint green #B8E6B8 (section 1), peach orange #FFD4A8 (section 2), sky blue #B8DCF0 (section 3), soft pink #FFC4D9 (section 4), lavender #D9C4FF (section 5), cream paper #FAF5E8."

5. **装饰元素**：sparkles ✨, hearts ♡, checkmarks ✓, curved arrows, small flowers, scattered in empty corners.

6. **文字质量要求**："All Chinese characters must be crisp, complete strokes, fully legible. Use rounded brush-style handwriting, not technical pen. Adequate breathing space between text and decorations."

7. **底部 takeaway**：椭圆胶囊条总结一句话。

8. **禁止项**："No photographs, no gradients, no digital UI, no emoji unicode characters, no neon colors, no dark backgrounds."

【参考图分析方法】
- 数参考图的章节行数 → 决定本图行数
- 看参考图章节标题的颜色块形状 → 复刻
- 看参考图的插画密度 → 复刻
- 看参考图装饰元素分布 → 复刻

记住：gpt-image-1 看到 prompt 后会照实渲染，所以你的 prompt 越具体（颜色 hex、字号、位置、文字原文），生成图越接近参考。`

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
        signal: AbortSignal.timeout(180000),
      })

      if (writeRes.ok) {
        const writeData = await writeRes.json()
        const msg = (writeData.output || []).find(o => o.type === 'message')
        const detailedPrompt = msg?.content?.[0]?.text?.trim()
        if (detailedPrompt && detailedPrompt.length > 200) {
          console.log(`  ✓ 转写完成（${detailedPrompt.length} 字符）`)
          console.log('  [Step B] gpt-image-1 渲染...')
          // 优先 gpt-image-2（2026-04-21 最新架构含原生推理层）
          // chatgpt-image-latest 是 OpenAI 内部旧快照，gpt-image-2 才是当前最强 API 模型
          let imgRes
          for (const cfg of [
            { model: 'gpt-image-2', prompt: detailedPrompt, n: 1, size: '1024x1536', quality: 'high' },
            { model: 'chatgpt-image-latest', prompt: detailedPrompt, n: 1, size: '1024x1536', quality: 'high' },
            { model: 'gpt-image-1.5', prompt: detailedPrompt, n: 1, size: '1024x1536', quality: 'high' },
            { model: 'gpt-image-1', prompt: detailedPrompt, n: 1, size: '1024x1536', quality: 'high' },
          ]) {
            console.log(`    尝试 ${cfg.model}${cfg.quality_mode ? ' + ' + cfg.quality_mode : ''}...`)
            imgRes = await fetch('https://api.openai.com/v1/images/generations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`,
              },
              body: JSON.stringify(cfg),
              signal: AbortSignal.timeout(300000),
            })
            if (imgRes.ok) {
              console.log(`    ✓ 成功使用 ${cfg.model}${cfg.quality_mode ? ' + ' + cfg.quality_mode : ' + ' + cfg.quality}`)
              break
            }
            const errTxt = await imgRes.text().catch(() => '')
            console.warn(`    ✗ ${cfg.model}: ${imgRes.status} ${errTxt.slice(0, 150)}`)
          }
          if (imgRes.ok) {
            const imgData = await imgRes.json()
            const imgB64 = imgData.data?.[0]?.b64_json
            if (imgB64) {
              const outDir = path.join(os.homedir(), 'Downloads')
              if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
              const fp = path.join(outDir, `sketchnote-${Date.now()}.png`)
              fs.writeFileSync(fp, Buffer.from(imgB64, 'base64'))
              console.log(`  ✓ 模型: gpt-5 (转写) + gpt-image-1 (渲染)`)
              console.log(`[3/3] 保存完成`)
              console.log(`✅ ${fp}`)
              return
            }
          } else {
            const t = await imgRes.text().catch(() => '')
            console.warn(`  ✗ Step B 失败: ${imgRes.status} ${t.slice(0, 200)}`)
          }
        }
      } else {
        const t = await writeRes.text().catch(() => '')
        console.warn(`  ✗ Step A 失败: ${writeRes.status} ${t.slice(0, 200)}`)
      }
    } catch (e) {
      console.warn(`  ✗ 方案 D 异常，降级: ${e.message}`)
    }
  }

  // ========== Fallback 1：原 Responses API + image_generation tool ==========
  // 模拟 ChatGPT 网页对话：用户拖一张参考图 + 贴 prompt，就这样
  const inputContent = ref
    ? [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: ref.dataUri },
          { type: 'input_text', text: prompt },
        ],
      }]
    : prompt

  console.log('  调 OpenAI Responses API（GPT-5 + image_generation tool 单步）...')
  const models = ['gpt-5']
  let b64 = null
  let usedModel = null
  let lastErr = null
  for (const model of models) {
    try {
      const oRes = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model,
          input: inputContent,
          tools: [{ type: 'image_generation', size: '1024x1536', quality: 'high' }],
        }),
        signal: AbortSignal.timeout(540000),
      })
      if (!oRes.ok) {
        const t = await oRes.text().catch(() => '')
        lastErr = `${model} HTTP ${oRes.status}: ${t.slice(0, 400)}`
        console.warn(`  ✗ ${lastErr}`)
        continue
      }
      const oData = await oRes.json()
      const imgCall = (oData.output || []).find(o => o.type === 'image_generation_call')
      if (imgCall?.result) {
        b64 = imgCall.result
        usedModel = model
        break
      }
      const outputTypes = (oData.output || []).map(o => o.type).join(',')
      const firstText = (oData.output || []).find(o => o.type === 'message')?.content?.[0]?.text?.slice(0, 200) || ''
      lastErr = `${model}: 没找到 image_generation_call.result（output types: ${outputTypes}; text: ${firstText}）`
      console.warn(`  ✗ ${lastErr}`)
    } catch (e) {
      lastErr = `${model}: ${e.message}`
      console.warn(`  ✗ ${lastErr}`)
    }
  }

  // Fallback 到直接 images API（不经 chat 润色）
  if (!b64) {
    console.log('  Responses API 全部失败，降级直接 /v1/images/generations...')
    const fallbackRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1536',
        quality: 'high',
      }),
      signal: AbortSignal.timeout(120000),
    })
    if (!fallbackRes.ok) {
      const t = await fallbackRes.text().catch(() => '')
      console.error('OpenAI 全部失败')
      console.error('  Responses 链最后错误:', lastErr)
      console.error(`  images API: HTTP ${fallbackRes.status} ${t.slice(0, 200)}`)
      process.exit(1)
    }
    const fData = await fallbackRes.json()
    b64 = fData.data?.[0]?.b64_json
    usedModel = 'gpt-image-1 (direct)'
  }

  if (!b64) {
    console.error('未拿到图片 base64')
    process.exit(1)
  }
  console.log(`  ✓ 模型: ${usedModel}`)

  // 4. 保存
  const outDir = path.join(os.homedir(), 'Downloads')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const filename = `sketchnote-${Date.now()}.png`
  const fp = path.join(outDir, filename)
  fs.writeFileSync(fp, Buffer.from(b64, 'base64'))
  console.log(`[3/3] 保存完成`)
  console.log(`✅ ${fp}`)
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
