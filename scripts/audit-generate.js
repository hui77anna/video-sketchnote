#!/usr/bin/env node
require('./_load-env')
// audit-generate.js — 生成"事实核查结论"版手账图
// 输入：核查后的中文内容（通过 -f 文件路径 或 stdin 喂入）
// 输出：~/Downloads/sketchnote-audit-<ts>.png
//
// 使用方式：
//   node audit-generate.js -f /tmp/audit-content.txt
//   echo "..." | node audit-generate.js
//   node audit-generate.js < /tmp/audit-content.txt
//
// 输入文本结构建议（让 GPT-5 转写时有方向感）：
//   主标题：xxx——核查后的真相
//   整体摘要：xxx
//   章节大纲：
//     第 1 章 · xxx
//       - ✅/⚠️/❓ 关键事实
//     ...
//   关键亮点：xxx
//   底部金句：xxx

const fs = require('fs')
const path = require('path')
const os = require('os')

const OPENAI_KEY = process.env.OPENAI_API_KEY
if (!OPENAI_KEY) {
  console.error('错误: OPENAI_API_KEY 环境变量未设置')
  process.exit(1)
}
const SKILL_DIR = path.dirname(path.dirname(__filename))

function loadRef() {
  const candidates = [
    path.join(SKILL_DIR, 'reference.png'),
    path.join(SKILL_DIR, 'reference.jpg'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p)
      const ext = path.extname(p).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext
      return `data:image/${mime};base64,${buf.toString('base64')}`
    }
  }
  return null
}

async function readInput() {
  const args = process.argv.slice(2)
  const fileIdx = args.indexOf('-f')
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    return fs.readFileSync(args[fileIdx + 1], 'utf-8')
  }
  // 从 stdin 读
  if (process.stdin.isTTY) {
    console.error('用法: audit-generate.js -f <file> 或通过 stdin 喂入内容')
    process.exit(1)
  }
  return await new Promise((resolve, reject) => {
    let buf = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', c => buf += c)
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', reject)
  })
}

;(async () => {
  const content = (await readInput()).trim()
  if (content.length < 100) {
    console.error(`✗ 输入太短（${content.length} 字），无法生成审核图`)
    process.exit(1)
  }
  console.log(`[1/2] 输入 ${content.length} 字 → GPT-5 转写英文 prompt...`)

  const ref = loadRef()
  if (!ref) {
    console.error(`✗ 必须放参考图：${path.join(SKILL_DIR, 'reference.png')}`)
    process.exit(1)
  }

  const sketchnoteSystem = `你是 sketchnote 图像 prompt 工程师，专门生成"事实核查结论版"手账图。任务：把核查后的中文内容 + 参考图（风格示范）转写为一段超详细的英文画面 prompt，由 gpt-image-2 直接渲染。

【核心定位】
这是审核结论图，不是普通总结。必须凸显"哪些是真的、哪些可疑、哪些是反向证据"——而不是把每条都画得同样确定。

【硬性规则】
- 输出**只**返回最终英文 prompt，不要任何解释、前缀、markdown
- 长度 500-800 英文词
- 必须保留所有章节的关键中文文字（标题、bullet、数字、✅⚠️❓✗ 证据标记）原样
- 严格按照参考图的视觉风格：复制其颜色块、布局、装饰密度、插画风格
- 凡是输入里带 ❓ 标记的数字 → 必须在图里加问号水印或"出处？"标签
- 凡是带 ⚠️ 的 bullet → 配警示色（黄/橙）
- 凡是带 ✅ 的 bullet → 配安心色（绿/蓝）
- 凡是带 ✗ 或反向证据 → 配警示色（红/橙）+ 反对图标

【prompt 结构（必须依次包含）】

1. 媒介与尺寸：A hand-drawn watercolor and ink sketchnote on cream beige paper (#FAF5E8) with subtle paper texture, 1024x1536 portrait.

2. 整体布局：竖版 1024×1536。主标题加副标题"核查后的真相"。N 个章节卡片块从上到下堆叠，每个卡片内部有 3-5 个嵌套子区块。子区块用淡色虚线分隔。

3. 每章详细描述（每章 80-150 词）：
   - 圆形数字 badge（实心 ~70px 圆 + 白色 ① ② ③ 数字）
   - 章节标题（中文圆润手写体 ~24pt）
   - bullets（3-4 项，每项配 ✅⚠️❓✗ 标记 + 手绘小图标 + 中文原文）
   - 拟人化插画
   - 关键数字（凡可疑数字必须配 ❓ 问号水印）

4. 配色方案：
   Color palette: mint green #B8E6B8 (✅), warning yellow #FFE5A3 (⚠️), peach orange #FFD4A8 (❓), sky blue #B8DCF0 (中性), soft pink #FFC4D9, alert red #FFB0B0 (✗), cream paper #FAF5E8.

5. 装饰元素：sparkles ✨, checkmarks ✓ ✗, question marks ❓, magnifying glass 🔍 (画成手绘版), curved arrows, scale ⚖️ (画成手绘版).

6. 文字质量：All Chinese characters crisp, complete strokes, fully legible. Rounded brush handwriting. Adequate breathing room.

7. 底部金句：椭圆胶囊条总结一句话，强调"研究方向可信，细节需谨慎"那种平衡判断。

8. 禁止项：No photographs, no gradients, no digital UI, no emoji unicode in body text (✅⚠️❓✗ 可以), no neon colors, no dark backgrounds.`

  const writeRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5',
      instructions: sketchnoteSystem,
      input: [{ role: 'user', content: [
        { type: 'input_image', image_url: ref },
        { type: 'input_text', text: content },
      ]}],
    }),
    signal: AbortSignal.timeout(540000),
  })

  if (!writeRes.ok) {
    const t = await writeRes.text().catch(() => '')
    console.error(`✗ GPT-5 转写失败 HTTP ${writeRes.status}: ${t.slice(0, 400)}`)
    process.exit(1)
  }
  const writeData = await writeRes.json()
  const msg = (writeData.output || []).find(o => o.type === 'message')
  const detailedPrompt = msg?.content?.[0]?.text?.trim()
  if (!detailedPrompt || detailedPrompt.length < 300) {
    console.error(`✗ GPT-5 转写太短（${detailedPrompt?.length || 0} 字符）`)
    process.exit(1)
  }
  console.log(`  ✓ 英文 prompt ${detailedPrompt.length} 字符`)

  console.log('[2/2] gpt-image-2 渲染（严格模式，不降级）...')
  let imgB64 = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: detailedPrompt, n: 1, size: '1024x1536', quality: 'high' }),
        signal: AbortSignal.timeout(540000),
      })
      if (r.ok) {
        const d = await r.json()
        imgB64 = d.data?.[0]?.b64_json
        if (imgB64) break
        console.error(`✗ 第 ${attempt}/3 次没返回 b64_json`)
      } else {
        const t = await r.text().catch(() => '')
        const transient = r.status >= 500 || r.status === 429
        console.error(`✗ 第 ${attempt}/3 次 HTTP ${r.status}: ${t.slice(0, 200)}`)
        if (!transient) process.exit(1)
      }
    } catch (e) {
      console.error(`✗ 第 ${attempt}/3 次 ${e.message}`)
    }
    if (attempt < 3) {
      const wait = attempt * 10000
      console.log(`  ⏳ 等 ${wait / 1000}s 后重试...`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  if (!imgB64) {
    console.error('✗ 重试用尽')
    process.exit(1)
  }

  const outDir = path.join(os.homedir(), 'Downloads')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const fp = path.join(outDir, `sketchnote-audit-${Date.now()}.png`)
  fs.writeFileSync(fp, Buffer.from(imgB64, 'base64'))
  console.log(`✅ ${fp}`)
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
