#!/usr/bin/env node
// action-manual-generate.js — 生成"操作手册"竖版长图（4-5 个详细行动卡片堆叠）
// 用于原理-行动模式的深度扩展，每个行动展开成多条具体执行细节
// （工具/数字/食物源/频率/动作名/参考范围/误区）
//
// 用法：
//   node action-manual-generate.js -f /tmp/manual-content.txt [--suffix training]
//   echo "..." | node action-manual-generate.js
//
// 输入文本结构：
//   主标题：xxx 操作手册 · 训练篇/饮食篇
//   副标题：xxx
//   章节列表（每章 = 一个行动卡片）：
//     第 ⑥ 节 · 力量训练 3 次/周
//       要点：
//         - 工具/食物源：xxx
//         - 频率：xxx
//         - 数字/参考：xxx
//         - 注意/误区：xxx
//     第 ⑤ 节 · ...
//   底部金句

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
  const p = path.join(SKILL_DIR, 'reference.png')
  if (!fs.existsSync(p)) return null
  const buf = fs.readFileSync(p)
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function readInput() {
  const args = process.argv.slice(2)
  const fileIdx = args.indexOf('-f')
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    return fs.readFileSync(args[fileIdx + 1], 'utf-8')
  }
  if (process.stdin.isTTY) {
    console.error('用法: action-manual-generate.js -f <file> [--suffix tag]')
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
  if (content.length < 200) {
    console.error(`✗ 输入太短（${content.length} 字）`)
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const suffixIdx = args.indexOf('--suffix')
  const suffix = suffixIdx >= 0 && args[suffixIdx + 1] ? `-${args[suffixIdx + 1]}` : ''

  console.log(`[1/2] 输入 ${content.length} 字 → GPT-5 转写英文 prompt...`)

  const ref = loadRef()
  if (!ref) {
    console.error('✗ 必须放参考图：~/.claude/skills/video-sketchnote/reference.png')
    process.exit(1)
  }

  const sketchnoteSystem = `你是 sketchnote 图像 prompt 工程师，专门生成"操作手册"型详细竖版长图。任务：把多个行动条目展开成详细可执行清单（带工具/数字/食物源/频率/动作名/参考范围/误区），输出为英文画面 prompt，由 gpt-image-2 直接渲染。

【核心定位】
这是"详细操作手册"图——每个行动展开成 4-6 条具体执行 bullet，读者拿到就能照着做。不是抽象原理，是 standing order。

【硬性规则】
- 输出**只**返回最终英文 prompt，不要任何解释、前缀、markdown
- 长度 500-900 英文词
- 必须保留所有关键中文文字（标题、行动名、数字、食物源、动作名）原样
- 严格按照参考图的水彩手绘风格、配色、卡通度、字体感
- **竖版 1024×1536**，4-5 个行动卡片从上到下堆叠

【prompt 结构（必须依次包含）】

1. 媒介与尺寸：A hand-drawn watercolor and ink sketchnote on cream beige paper (#FAF5E8) with subtle paper texture, **1024×1536 portrait**.

2. 整体布局：
   - 顶部：横向标题条带（约 8% 高度），中文圆润手写体标题 + 副标题
   - 主体：4-5 个**行动卡片**从上到下垂直堆叠，每个卡片占主体高度的 18-22%
   - 底部：金句胶囊条（约 6% 高度）

3. 每个行动卡片详细要求（这是核心，每卡片必须 80-150 词描述）：
   - 顶部左侧：圆形编号 badge（⑨/⑧/.../①），实心圆，白色数字
   - 顶部右侧：行动标题（中文圆润手写体 20pt，简短）
   - 卡片主体分两栏：
     * 左栏 35%：一个**手绘动作/食物/工具大图**（例如：哑铃、深蹲小人、鸡胸肉、计算器、体脂秤、闹钟），占该卡片左侧主视觉
     * 右栏 65%：4-6 条具体执行 bullet
       - 每条带不同的子图标（✦ 工具 / 📊 数字 / 🍴 食物 / ⏱ 频率 / ⚠️ 误区 — 全部手绘版，不要 Unicode emoji）
       - 关键数字大字加粗加颜色（例如"1.6-2.2 g/kg"、"3 次/周"、"23 g/100g"）
       - 食物源/动作名/工具名加颜色背景方块
   - 卡片用淡色边框（与该卡片主题色一致），不同卡片用不同颜色
   - 卡片之间用波浪线/虚线分隔

4. 配色方案（每卡片一个主题色）：
   Color palette: mint green #B8E6B8, peach orange #FFD4A8, sky blue #B8DCF0, soft pink #FFC4D9, lavender #D9C4FF, warning yellow #FFE5A3, cream paper #FAF5E8, accent red #FF8888 (for 误区/警示).

5. 装饰元素：sparkles ✨, small flowers, curved arrows pointing to key numbers, dotted underlines for emphasis, small "TIP" stickers in corners.

6. 文字质量：All Chinese characters crisp, complete strokes, fully legible. Rounded brush handwriting. **关键数字必须最大最显眼**（让人一眼看到"1.6-2.2 g/kg"这种核心剂量）。每个 bullet 短句 ≤ 25 字。

7. 底部金句：椭圆胶囊条横跨整图，金黄底色，一句话总结手册可以怎么用。

8. 禁止项：No photographs, no gradients, no digital UI, no Unicode emoji in body (手绘风 ✓✗ 可以), no neon colors, no dark backgrounds. **不许把卡片画成简单 bullet list**——必须有左栏主视觉 + 右栏详细 bullet 的双栏结构。`

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

  console.log('[2/2] gpt-image-2 渲染（竖版 1024×1536）...')
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
  const fp = path.join(outDir, `sketchnote-manual${suffix}-${Date.now()}.png`)
  fs.writeFileSync(fp, Buffer.from(imgB64, 'base64'))
  console.log(`✅ ${fp}`)
})().catch(e => {
  console.error('未捕获错误:', e.message)
  process.exit(1)
})
