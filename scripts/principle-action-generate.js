#!/usr/bin/env node
// principle-action-generate.js — 生成"原理 + 行动"双栏横版手账图
// 左半：图形化解释核心原理 / 逻辑链
// 右半：基于原理推出的"该做"和"不该做"清单
//
// 用法：
//   node principle-action-generate.js -f /tmp/principle-content.txt
//   echo "..." | node principle-action-generate.js
//
// 输入文本结构建议：
//   主标题：xxx 的第一性原理
//   核心原理（左半 — 用于图形化）：
//     原理一句话：xxx
//     公式/等式：xxx
//     可视化要点：xxx
//   该做（右半上半 — ✅）：
//     - ✅ 行动 1
//     - ✅ 行动 2
//     ...
//   不该做（右半下半 — ✗）：
//     - ✗ 反例 1
//     - ✗ 反例 2
//     ...
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
  if (process.stdin.isTTY) {
    console.error('用法: principle-action-generate.js -f <file> 或通过 stdin 喂入内容')
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
    console.error(`✗ 输入太短（${content.length} 字）`)
    process.exit(1)
  }
  console.log(`[1/2] 输入 ${content.length} 字 → GPT-5 转写英文 prompt...`)

  const ref = loadRef()
  if (!ref) {
    console.error('✗ 必须放参考图：~/.claude/skills/video-sketchnote/reference.png')
    process.exit(1)
  }

  const sketchnoteSystem = `你是 sketchnote 图像 prompt 工程师，专门生成"原理 + 行动"双栏横版手账图。任务：把核心原理 + 行动清单的中文内容 + 参考图（风格示范）转写为一段超详细的英文画面 prompt，由 gpt-image-2 直接渲染。

【核心定位】
这是"原理推行动"图——左半图形化解释为什么，右半告诉用户该做什么不该做什么。读者一图秒懂逻辑链 + 实操清单。

【硬性规则】
- 输出**只**返回最终英文 prompt，不要任何解释、前缀、markdown
- 长度 500-900 英文词
- 必须保留所有关键中文文字（标题、原理公式、行动条目）原样
- 严格按照参考图的水彩手绘风格、配色、卡通度、字体感
- 横版 1536×1024，**左半 = 原理图示，右半 = 行动清单**（左右两半要清晰分块，中间可有手绘虚线/箭头分隔）

【prompt 结构（必须依次包含）】

1. 媒介与尺寸：A hand-drawn watercolor and ink sketchnote on cream beige paper (#FAF5E8) with subtle paper texture, **1536x1024 landscape**.

2. 整体布局：
   - 顶部：横向标题条带（占高度约 12%），中文圆润手写体大标题
   - 主体分左右两大区：
     * **左半（约 55%宽）= "原理图示"**：一个大的可视化图形，用图标/箭头/公式/流程图把原理表达出来。这是核心——读者应该一眼看到"原理是什么"。可以是天平、流程图、公式、对比图、能量流动图、漏斗等。原理表达必须**有视觉冲击力**，不是简单的文字列表。
     * **右半（约 45%宽）= "行动清单"**：上下分两块
       - 上半："✅ 该做" — 4-6 条 bullet，每条带 ✓ 图标 + 颜色块 + 简短手绘小图标
       - 下半："✗ 不该做" — 4-6 条 bullet，每条带 ✗ 图标 + 红橙色块 + 反例小图标
   - 底部：金句胶囊条横跨整图宽度

3. 左半"原理图示"详细要求：
   - 必须有 1 个**主视觉**（central visual metaphor），例如"天平 + 两边砝码"、"能量进出漏斗"、"公式等式"、"流程图箭头链"
   - 主视觉要够大，占左半 60% 以上空间
   - 配 2-3 个辅助小图（拟人化器官、食物、动作小人、计算器、烧杯等）解释细节
   - 关键公式/数字必须放大加粗 + 颜色强调
   - 不能只是文字列表——必须图形化

4. 右半"行动清单"详细要求：
   - 上半 ✅ 区用绿色/薄荷色调（mint #B8E6B8, sage #C4E0C4）
   - 下半 ✗ 区用橙红色调（peach #FFD4A8, alert red #FFB0B0）
   - 每条 bullet 短句（中文 < 20 字最佳），配一个手绘 emoji-style 小图标（不要 Unicode emoji，要手绘版）
   - ✅ 和 ✗ 区中间用波浪线 / 虚线分隔
   - 末尾可加一个"⚠️ 警示" 区（黄色），若用户给了警示内容

5. 配色方案：
   Color palette: mint green #B8E6B8 (✅), peach orange #FFD4A8 (⚠️), alert red #FFB0B0 (✗), sky blue #B8DCF0 (logic/principle), soft pink #FFC4D9 (decoration), warning yellow #FFE5A3, cream paper #FAF5E8.

6. 装饰元素：sparkles ✨, checkmarks ✓ ✗, curved arrows pointing from 原理 → 行动 (visual connection between left and right halves), small hearts, light flowers in corners.

7. 文字质量：All Chinese characters crisp, complete strokes, fully legible. Rounded brush handwriting (not technical pen). Adequate breathing room. Left side 原理图示 has fewer words (more visual), right side 行动清单 has more text bullets.

8. 底部金句胶囊：椭圆胶囊条，横跨整图宽度，金黄底色（#FFE5A3），一句话总结原理→行动的核心。

9. 禁止项：No photographs, no gradients, no digital UI, no Unicode emoji in body (✓✗ 可以手绘风格), no neon colors, no dark backgrounds. Left half MUST be visually-driven (not just text), right half MUST be a clear bulleted list.`

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

  console.log('[2/2] gpt-image-2 渲染（横版 1536x1024）...')
  let imgB64 = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-image-2', prompt: detailedPrompt, n: 1, size: '1536x1024', quality: 'high' }),
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
  const fp = path.join(outDir, `sketchnote-principle-${Date.now()}.png`)
  fs.writeFileSync(fp, Buffer.from(imgB64, 'base64'))
  console.log(`✅ ${fp}`)
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
