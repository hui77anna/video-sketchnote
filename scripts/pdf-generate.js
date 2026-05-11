#!/usr/bin/env node
// PDF 分支：LlamaParse 解析 PDF → GPT-5 提章节 → gpt-image-2 出手绘总结图
// 复用 video 流水线后半段（sketchnote 转写 prompt + gpt-image-2 渲染）
const fs = require('fs')
const path = require('path')
const os = require('os')

const pdfPath = process.argv[2]
const refArg = process.argv[3]
if (!pdfPath) {
  console.error('用法: pdf-generate.js <pdf_path> [reference_image_path]')
  process.exit(1)
}
if (!fs.existsSync(pdfPath)) {
  console.error(`✗ 文件不存在: ${pdfPath}`)
  process.exit(1)
}
if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
  console.error(`✗ 只支持 .pdf 文件，收到: ${path.extname(pdfPath)}`)
  process.exit(1)
}

const OPENAI_KEY = process.env.OPENAI_API_KEY
const LLAMA_KEY = process.env.LLAMA_CLOUD_API_KEY
if (!OPENAI_KEY) {
  console.error('✗ OPENAI_API_KEY 环境变量未设置')
  process.exit(1)
}
if (!LLAMA_KEY) {
  console.error('✗ LLAMA_CLOUD_API_KEY 未设置（去 https://cloud.llamaindex.ai 申请，免费 1000 页/月）')
  process.exit(1)
}

const SKILL_DIR = path.dirname(path.dirname(__filename))
const LLAMA_BASE = 'https://api.cloud.llamaindex.ai/api/v1/parsing'

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

async function llamaParseUpload(filePath) {
  const fileBuf = fs.readFileSync(filePath)
  const blob = new Blob([fileBuf], { type: 'application/pdf' })
  const form = new FormData()
  form.append('file', blob, path.basename(filePath))
  form.append('result_type', 'markdown')
  form.append('language', 'ch_sim')

  const res = await fetch(`${LLAMA_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LLAMA_KEY}` },
    body: form,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`LlamaParse upload HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = await res.json()
  if (!data.id) throw new Error(`LlamaParse upload 响应无 job id: ${JSON.stringify(data).slice(0, 200)}`)
  return data.id
}

async function llamaParsePoll(jobId, maxWaitMs = 300000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxWaitMs) {
    await new Promise(r => setTimeout(r, 4000))
    const res = await fetch(`${LLAMA_BASE}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${LLAMA_KEY}` },
    })
    if (!res.ok) continue
    const s = await res.json()
    if (s.status === 'SUCCESS') return
    if (s.status === 'ERROR' || s.status === 'CANCELLED') {
      throw new Error(`LlamaParse 任务失败: ${s.status} ${s.error_message || ''}`)
    }
    process.stdout.write('.')
  }
  throw new Error('LlamaParse 轮询超时（>5min）')
}

async function llamaParseResult(jobId) {
  const res = await fetch(`${LLAMA_BASE}/job/${jobId}/result/markdown`, {
    headers: { Authorization: `Bearer ${LLAMA_KEY}` },
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`LlamaParse 取结果 HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.markdown || ''
}

async function extractChapters(markdown) {
  // 长文档截断（保护 GPT-5 上下文）
  const MAX_INPUT = 80000
  const truncated = markdown.length > MAX_INPUT
  const input = truncated ? markdown.slice(0, MAX_INPUT) + '\n\n...[内容超长已截断]' : markdown

  const sys = `你是文档结构化助手。任务：把用户给的 markdown 转换成手绘总结所需的章节结构。

【硬性规则】
- 只返回纯 JSON，不要 markdown 代码块、不要解释
- 章节数 4-7 段（根据内容长度自适应；论文/长文取 5-7，短文章取 4-5）
- 每个章节 bullets 3-5 条
- title 简洁有力，10-18 字以内，可以加 emoji 但不强求
- summary 1-2 句话讲清楚这章在说什么
- bullets 是这章的具体要点/数字/结论，要具象不要抽象
- 中文输入输出中文，英文输入输出中文（翻译过来，因为后续渲染需要中文）

【输出 schema】
{
  "title": "整本文档/文章的标题",
  "summary": "整体一句话总结（30-60 字）",
  "chapters": [
    { "title": "章节标题", "summary": "章节摘要", "bullets": ["要点1", "要点2", "要点3"] }
  ]
}`

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5',
      instructions: sys,
      input: [{ role: 'user', content: [{ type: 'input_text', text: input }] }],
    }),
    signal: AbortSignal.timeout(300000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`GPT-5 提章节失败 HTTP ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = await res.json()
  const msg = (data.output || []).find(o => o.type === 'message')
  let txt = msg?.content?.[0]?.text?.trim() || ''
  // 防御：万一包了 ```json
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed
  try {
    parsed = JSON.parse(txt)
  } catch (e) {
    throw new Error(`GPT-5 返回不是合法 JSON: ${txt.slice(0, 300)}`)
  }
  if (!parsed.chapters?.length) throw new Error('GPT-5 没产出章节')
  return { ...parsed, _truncated: truncated }
}

;(async () => {
  // [1/4] LlamaParse
  console.log('[1/4] LlamaParse 解析 PDF...')
  console.log(`  → ${pdfPath}`)
  const jobId = await llamaParseUpload(pdfPath)
  console.log(`  → job_id: ${jobId}（轮询中`)
  await llamaParsePoll(jobId)
  process.stdout.write('\n')
  const markdown = await llamaParseResult(jobId)
  if (markdown.length < 500) {
    console.error(`✗ markdown 内容太少（${markdown.length} 字），PDF 可能是扫描件无文本层或 LlamaParse 解析失败`)
    process.exit(1)
  }
  console.log(`  ✓ markdown ${markdown.length} 字`)

  // [2/4] 提章节
  console.log('[2/4] GPT-5 提取章节结构...')
  const struct = await extractChapters(markdown)
  console.log(`  ✓ 标题: ${struct.title?.slice(0, 50) || '(空)'}`)
  console.log(`  ✓ 章节: ${struct.chapters.length} 段${struct._truncated ? ' (输入已截断)' : ''}`)

  // [3/4] 拼 prompt + GPT-5 转写为详细英文 sketchnote prompt
  const items = struct.chapters.map((c, i) => {
    const t = (c.title || `第 ${i + 1} 段`)
    const sum = c.summary || ''
    const bullets = Array.isArray(c.bullets) ? c.bullets.map(b => `  - ${b}`).join('\n') : ''
    return [t, sum, bullets].filter(Boolean).join('\n')
  }).join('\n\n')

  const prompt = [
    '帮我根据 PDF 文档内容，生成手绘总结仿照图片：',
    '',
    `文档标题：${struct.title || ''}`,
    struct.summary ? `\n整体摘要：${struct.summary}` : '',
    `\n章节大纲：\n${items}`,
  ].filter(Boolean).join('\n')
  console.log(`  → prompt ${prompt.length} 字`)

  const ref = loadReferenceImage()
  if (!ref) {
    console.error('✗ 必须放参考图：~/.claude/skills/video-sketchnote/reference.png')
    process.exit(1)
  }
  console.log(`[3/4] 参考图: ${ref.path} → GPT-5 转写为详细英文 prompt...`)

  const sketchnoteSystem = `你是 sketchnote 图像 prompt 工程师。任务：把用户提供的文档内容（中文）+ 参考图（风格示范）转写为一段超详细的英文画面 prompt，将由 gpt-image-2 模型直接渲染。

【硬性规则】
- 输出**只**返回最终英文 prompt，不要任何解释、前缀、markdown
- 长度 400-700 英文词
- 必须包含文档中**所有章节**的关键中文文字（标题、关键 bullet、关键数字）原样保留——gpt-image-2 需要这些中文字符去渲染
- 严格按照参考图的视觉风格：观察并复制其颜色块、布局、装饰密度、插画风格

【prompt 结构（必须依次包含）】

1. **媒介与尺寸**：A hand-drawn watercolor and ink sketchnote on cream beige paper (#FAF5E8) with subtle paper texture, 1024x1536 portrait.

2. **整体布局**：竖版 1024×1536。N 个大横向章节卡片块从上到下堆叠（每个章节 = 一个独立彩色边框的大块）。**每个大块内部不是简单一列**，而是包含 3-5 个子区块（嵌套结构）：例如左侧"作用"子框 + 右侧"来源"子网格 + 右上角"小贴士"子框。子区块用淡色虚线/浅色块分隔，整个章节卡片用主色实线粗边框包围。这种"大块套小块"的嵌套层次必须做到——参考图核心特征。

3. **每个章节详细描述**（每章 80-150 词）：
   - 圆形数字 badge（实心 ~70px 圆 + 白色 ① ② ③ 数字）
   - 章节标题（中文圆润手写体 ~24pt，颜色匹配 badge）— 必须保留文档原文 Chinese 标题
   - 正文/bullets（3-4 项，每项配手绘小图标 + 中文原文）
   - 拟人化插画（笑脸食物 / 内脏 / 工具 / 设备 / 书 / 数据图）
   - 关键数字（百分比 / 数量 / 单位，大字 + 强调线）

4. **配色方案**：明确列出 5-6 个 hex
   Color palette: mint green #B8E6B8, peach orange #FFD4A8, sky blue #B8DCF0, soft pink #FFC4D9, lavender #D9C4FF, cream paper #FAF5E8.

5. **装饰元素**：sparkles ✨, hearts ♡, checkmarks ✓, curved arrows, small flowers, scattered in empty corners.

6. **文字质量**：All Chinese characters crisp, complete strokes, fully legible. Rounded brush handwriting (not technical pen). Adequate breathing room.

7. **底部 takeaway**：椭圆胶囊条总结一句话。

8. **禁止项**：No photographs, no gradients, no digital UI, no emoji unicode, no neon colors, no dark backgrounds.`

  const writeRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
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
    process.exit(1)
  }
  const writeData = await writeRes.json()
  const msg = (writeData.output || []).find(o => o.type === 'message')
  const detailedPrompt = msg?.content?.[0]?.text?.trim()
  if (!detailedPrompt || detailedPrompt.length < 200) {
    console.error(`✗ GPT-5 转写返回内容太短或为空（${detailedPrompt?.length || 0} 字）`)
    process.exit(1)
  }
  console.log(`  ✓ 转写完成（${detailedPrompt.length} 字符）`)

  // [4/4] gpt-image-2 渲染
  console.log('[4/4] gpt-image-2 渲染...')
  const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
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
    console.error(`✗ gpt-image-2 渲染失败 HTTP ${imgRes.status}: ${t.slice(0, 300)}`)
    process.exit(1)
  }
  const imgData = await imgRes.json()
  const imgB64 = imgData.data?.[0]?.b64_json
  if (!imgB64) {
    console.error('✗ gpt-image-2 没返回 b64_json')
    process.exit(1)
  }
  const outDir = path.join(os.homedir(), 'Downloads')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const baseName = path.basename(pdfPath, '.pdf').slice(0, 30).replace(/[^\w一-龥-]/g, '_')
  const fp = path.join(outDir, `sketchnote-pdf-${baseName}-${Date.now()}.png`)
  fs.writeFileSync(fp, Buffer.from(imgB64, 'base64'))
  console.log(`✅ ${fp}`)
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
