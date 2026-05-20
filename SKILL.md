---
name: video-sketchnote
description: 把视频 URL / PDF 生成手绘图。默认只出"总结手账图"单图（opt-in 模式）。用户说"核查/查证/事实核查/靠谱吗"才追加"事实核查结论图"；用户说"详细补充/手册/深一点"才追加 2 张"操作手册图"（训练篇 + 饮食习惯篇）。视频走 NeuraRead API（YouTube/B站/抖音/小红书/播客/微信视频号），PDF 走 LlamaParse v2，统一用 GPT-5 + gpt-image-2 出图。触发：用户给链接/路径 + 说"生成手绘总结"、"画成手绘笔记"、"video sketchnote"、"复刻 ChatGPT 生图"，或直接 /video-sketchnote <url-or-pdf>。
---

# 视频/PDF 手绘总结生成 Skill

> **安装路径说明（给 AI 看）**：本 skill 同时兼容 Claude Code 和 OpenClaw。下方所有 `~/.claude/skills/video-sketchnote/` 是 Claude Code 的默认路径，OpenClaw 用户请自动替换为 `~/.openclaw/skills/video-sketchnote/`。脚本内部用 `__dirname` 动态定位，无论装在哪都能跑通。

## 用途（默认单图，opt-in 模式）
两种输入模式：
- **视频/播客 URL** → 调 NeuraRead 拿章节 → 出 **图 1：视频内容总结手账图**
- **本地 PDF 文件路径** → 调 LlamaParse v2 拿 markdown → GPT-5 提章节 → 出 **图 1：内容总结手账图**

**默认行为 = 单图（仅总结图）**。

**用户明确提到下列任一关键词时**，才追加跑 claim-check 流程出 **图 2：事实核查结论手账图**：
- "核查"、"查证"、"核查一下"、"事实核查"、"fact check"
- "查查靠谱吗"、"有依据吗"、"是真的吗"、"靠谱吗"
- "标题党吗"、"夸大了吗"、"是不是骗人的"

如果用户只说"生成手绘总结 / 画成手账图"等不带核查意图的指令，**只出单图**，不要主动跑核查流程。

输出统一保存到 `~/Downloads/`：
- 总结图：`sketchnote-<ts>.png` / `sketchnote-pdf-<basename>-<ts>.png`
- 核查图：`sketchnote-audit-<ts>.png`

## 必需环境
- `OPENAI_API_KEY` 在 shell env（账号需开通 gpt-5 / gpt-image-2）
- `VIDEO_API_TOKEN` 在 shell env（**视频模式必需** — NeuraRead API 鉴权 token）
  - 默认后端：`https://daily-digest-rust.vercel.app`（skill 作者部署）
  - Token 拿法：向 skill 作者索取，然后 `export VIDEO_API_TOKEN="收到的 token"` 写进 `~/.zshrc` 或 `~/.bashrc`
  - 自部署替代：设 `VIDEO_API_BASE=https://your-domain.com` 即可指向你自己的实例（接口规范见 README）
- `LLAMA_CLOUD_API_KEY` 在 shell env（**仅 PDF 模式需要**，去 https://cloud.llamaindex.ai 申请，免费 1000 页/月）
- `node` >= 18 已安装

## 参考样图（已内嵌，不要改）

`~/.claude/skills/video-sketchnote/reference.png` 是 skill 内嵌的统一风格参考图，**不要替换**——分发版本用这张图保证所有用户出图风格一致。

脚本自动读取它，转 base64 data URI 喂给 GPT-5，GPT-5 模仿其颜色、布局、卡通度、字体感。

如果参考图被误删，出图会跑偏（英文标题、少彩色、信息密度低）。重新装一遍 skill 包即可恢复。

## 三种工作模式

### A. 视频 → 工作流模式（推荐 — 用 ChatGPT 网页生图，效果最好）

适合：想要 ChatGPT 网页那种最佳效果，不介意点几下鼠标完成最后一步。

```bash
node ~/.claude/skills/video-sketchnote/scripts/prepare.js "<URL>"
```

脚本会：
1. 调 NeuraRead API 解析视频章节
2. 把 prompt 复制到系统剪贴板
3. 打开 ChatGPT 网页（chatgpt.com，gpt-5）
4. 在 Finder 高亮 reference.png 方便拖拽

然后用户在 ChatGPT 里：拖参考图 + Cmd+V 粘贴 + 回车 + 保存图。

### B. 视频 → 全自动模式（默认单图 + 可选核查图）

#### Step 1：出总结图（默认必做）

```bash
node ~/.claude/skills/video-sketchnote/scripts/generate.js "<URL>"
```

调 OpenAI Responses API（gpt-5 + gpt-image-2）直接生图，存到 ~/Downloads/sketchnote-*.png。

**如果用户没明确说核查/查证类关键词，到这里就结束，直接把图给用户。** 不要主动追加核查图。

#### Step 2：跑事实核查 → 出审核结论图（**仅在用户明确要求时执行**）

**触发条件**：用户原话包含"核查/查证/核查一下/事实核查/fact check/有依据吗/是真的吗/靠谱吗/标题党吗/查查靠谱吗"等任一关键词。

满足触发条件时，在 Step 1 出完总结图后**自动接着做**：

1. **复用 NeuraRead 已经拿到的 transcript + chapters** 当原文（**不要重新抓**，省一次 API 调用）
2. 按 `~/.claude/skills/claim-check/SKILL.md` 流程拆 factual claims、做双向取证（Pass A + Pass B）
3. 把核查结论组织成下面这个**固定结构的中文文本**：

   ```
   主标题：<视频核心论点>——核查后的真相
   整体摘要：<一句话定性，例如"研究方向可信但 X 数字/X 样本细节不准确，建议参考但不要盲信">
   章节大纲：
     第 1 章 · 研究本身：是真的，但有局限
       - ✅ <已 supported 的事实>
       - ⚠️ <partial 项，说明问题>
       - ⚠️ <observational/局限性提醒>
     第 2 章 · 那个 <核心数字>
       - ❓ <数字找不到一手出处>
       - ✅ <但方向是对的>
       - ⚠️ <被中文转载二次加工>
     第 3 章 · 机制
       - ✅ <已验证机制>
       - ⚠️ <假说性机制，未证实>
     第 4 章 · 反向证据（视频没告诉你）
       - <RCT / meta-analysis 反例>
       - <剂量/人群差异>
       - <"数据其实是分歧的">
     第 5 章 · 那到底该怎么做
       - <分人群/分形式的实操建议>
   关键亮点：
     - <最值得提醒的 2-3 条>
   底部金句：<一句话平衡判断>
   ```

4. 把这段文本喂给 audit-generate.js：

   ```bash
   echo "<上面的核查文本>" | node ~/.claude/skills/video-sketchnote/scripts/audit-generate.js
   ```

   或先写到 /tmp/audit-content.txt 再 `-f` 喂入。

   audit-generate.js 用同一张参考图 + 专用 system prompt（强调 ✅⚠️❓✗ 标记），出 `sketchnote-audit-<ts>.png`。

#### Step 3：用 Read 工具打开两张图给用户看 → 输出对比说明

最终回复用户时给：
- **两个文件路径**
- **核心修正点列表**（哪些数字 / 样本 / 机制被标红了）
- 一句话总结"原视频可信度等级"

### C. PDF → 全自动模式（默认单图 + 可选核查图）

#### Step 1：出总结图（默认必做）

```bash
node ~/.claude/skills/video-sketchnote/scripts/pdf-generate.js "<PDF 文件绝对路径>"
```

流水线：
1. 上传 PDF 到 LlamaParse v2，轮询直到 `SUCCESS`，取 markdown
2. GPT-5 把 markdown 转成 `{title, summary, chapters[{title, summary, bullets}]}` JSON 结构
3. GPT-5 + 参考图 → 详细英文 sketchnote prompt
4. gpt-image-2 渲染 → 保存到 `~/Downloads/sketchnote-pdf-<basename>-<ts>.png`

**如果用户没明确说核查类关键词，到这里就结束。**

#### Step 2：核查 → 出审核结论图（**仅在用户明确要求时执行**）

**触发条件**：用户原话包含"核查/查证/事实核查"等关键词。

满足触发条件时，复用 Step 1 已经从 LlamaParse 拿到的 markdown 当原文，对其中**可证伪的事实声明**（数字、引用研究、机构、产品、市场份额、临床结论等）做 claim-check 双向取证；纯方法论 / 综述类 PDF 没什么可核查的就报告"内容主要是综述/方法论，无强可核查事实点，跳过审核图"。

然后跑：
```bash
node ~/.claude/skills/video-sketchnote/scripts/audit-generate.js -f /tmp/audit-content.txt
```

注意：
- 只支持有文本层的 PDF。扫描件（纯图片）会被 LlamaParse 退回（markdown 太短直接报错）。如果是扫描件，先 OCR 再来。
- 默认 `language=ch_sim`，中英文 PDF 都能处理；输出渲染统一中文（GPT-5 会翻译）。
- 长 PDF 会截断到前 80K 字喂 GPT-5（论文够用，整本书不够）。

---

不传参考图路径时，脚本自动查找 `~/.claude/skills/video-sketchnote/reference.png` 作为默认参考。

   脚本内部：
   - POST `https://daily-digest-rust.vercel.app/api/video-analyze` 拿视频章节（含时间戳 + summary + bullets）
   - 把章节拼成中文 prompt：`帮我根据视频内容，生成手绘总结仿照图片：\n\n[章节列表]`
   - POST `https://api.openai.com/v1/responses`（model: `gpt-5`，tools: `[{type: 'image_generation'}]`）
   - 解码 base64 → 写入 `~/Downloads/sketchnote-<timestamp>.png`
   - stdout 输出文件路径

2. **用 Read 工具打开生成的 PNG**（Claude 多模态能看图），用 1-2 句话描述图片实际内容给用户看（验证不是空图 / 跑偏）。

3. **告诉用户**：
   - 文件路径（用户可以 `open <path>` 在 Finder 预览）
   - 简短的图片内容描述

## 错误处理

- 视频解析 HTTP 401 `unauthorized — set VIDEO_API_TOKEN`：去 `/Users/huihanqi/ai个人知识库project/daily-digest/.vercel/.env.production.local` 取 `VIDEO_API_TOKEN`，`export` 后重跑（见上方"必需环境"）
- 视频解析失败（HTTP 4xx/5xx）：提示"视频可能是私密的、链接失效，或 NeuraRead API 暂时不可用"
- OpenAI 401：`OPENAI_API_KEY` 未设置或无效
- OpenAI 403/404 含 "model" 字样：账号没开通 gpt-5，可以让脚本降级到 `gpt-4.1` 或 `gpt-4o`（脚本里已有 fallback 链）
- 视频没章节 / 内容 < 1000 字门槛：先去 https://daily-digest-rust.vercel.app/video 完整解析（让 NeuraRead 跑完 transcript），再重新调脚本即可（NeuraRead 第二次直接命中缓存）
- 审核图阶段 factual claims 全是 `no_evidence` 或全是 `personal_experience` / `opinion`：不强行出审核图，告诉用户"内容主要是个人感受/观点，无可核查事实点，跳过审核图"

## 触发审核图的条件（opt-in 模式）

**默认不出审核图。** 只有用户原话**明确包含**下列任一关键词时才触发 Step 2：
- "核查"、"查证"、"核查一下"、"事实核查"、"fact check"
- "查查靠谱吗"、"有依据吗"、"是真的吗"、"靠谱吗"、"可信吗"
- "标题党吗"、"夸大了吗"、"是不是骗人的"

满足触发条件后，**额外检查**这两种情况，命中则跳过（告诉用户"无可核查事实点"）：
- 内容是纯个人经历 / 纯观点 / 纯方法论综述
- claim-check 结果所有 claims 都是 `no_evidence` 或 `personal_experience` / `opinion`

不要"觉得视频有事实点就自作主张追加核查图"——必须等用户开口要。

### 几种图怎么触发（opt-in 模式）

| 用户意图 | 产出 |
|---|---|
| 给链接说"生成手绘总结 / 画成手账图" | **仅总结图（1 张，竖版）** |
| 链接 + "核查 / 查证 / 事实核查 / 靠谱吗" | 总结 + 审核（2 张，竖版） |
| 链接 + "详细补充 / 手册 / 深一点 / 操作手册" | 总结 + 操作手册 2 张（训练篇 + 饮食习惯篇），见下一节 |

## 可选第二+三图：操作手册（训练篇 + 饮食习惯篇）

**默认不出**，只在用户说"详细补充 / 手册 / 深一点 / 操作手册 / 可执行清单"时追加。

适合：总结图的 bullet 短句信息密度不够，用户想要每条要点展开成 "工具 / 数字 / 食物源 / 频率 / 动作名 / 参考范围 / 误区" 的可执行清单。

### 用法

```bash
node ~/.claude/skills/video-sketchnote/scripts/action-manual-generate.js \
  -f /tmp/manual-training.txt --suffix training

node ~/.claude/skills/video-sketchnote/scripts/action-manual-generate.js \
  -f /tmp/manual-diet.txt --suffix diet
```

两张图并行跑（用 `run_in_background: true` 双开 Bash），各自约 2-4 分钟。

### 拆分策略

把总结图里提到的 N 条要点按主题分到 2 张手册图：

- **训练篇**：跟运动/消耗相关（力量训练、有氧、动作名、组数次数、NEAT、肌肉、复合动作）
- **饮食习惯篇**：跟摄入/测量/习惯相关（热量计算、食物源、测量工具、睡眠、复盘、心理弹性）

不必硬凑 1:1 拆，按"训练大块"+"饮食大块"分组更自然（例如 9 条按 4 / 5 拆，或 3 / 6 拆）。

### 输入文本结构

```
主标题：xxx 操作手册 · 训练消耗篇 / 饮食习惯篇
副标题：xxx

4-5 个行动卡片（每个 = 一类具体行动），从上到下编号：

【第 ⑥ 节 · 行动标题】（颜色主题）
左栏主视觉：<手绘动作/食物/工具大图>
右栏要点：
- ⏱ 频率：xxx
- 📊 数字/参考：xxx
- 🍴 食物源：xxx（带具体克数/品牌）
- ✦ 工具/动作名：xxx
- ⚠️ 误区/注意：xxx
- 🎯 目标/比较：xxx

【第 ⑤ 节 · ...】
...

底部金句：一句话总结这一篇的执行总纲
```

每个卡片 4-6 条具体 bullet，每条 ≤ 25 字。关键数字（"1.6-2.2 g/kg"、"3 次/周"、"23 g/100g"）要明确写出来让图里能加粗强调。

### 内容设计要点
- **每条 bullet 必须可立刻执行**：不能写"多吃蛋白质"（太抽象），要写"鸡胸肉 23g/100g + 鸡蛋 6g/枚 + 每餐 30-40g"
- **数字优先**：每个行动里至少包含 2-3 个具体数字（频率/克数/百分比/时长）
- **食物源带克数 + 品牌**（如果有）
- **动作名带组数次数**（"深蹲 6-12 次/组 × 3-4 组"，不只是"深蹲"）
- **误区写常见错误**（"别只看 Apple Watch 运动环，NEAT 才是大头"）

### 输出文件名
- 训练篇：`~/Downloads/sketchnote-manual-training-<ts>.png`
- 饮食篇：`~/Downloads/sketchnote-manual-diet-<ts>.png`
- 竖版 1024×1536

### 触发关键词
用户说以下任一时追加生成手册图：
- "详细补充" / "补充更多" / "更具体"
- "操作手册" / "手册" / "可执行清单"
- "深一点" / "再展开" / "再详细一点"
- "右边信息密度不够" / "右边再丰富一点"

## 示例对话

### 示例 1：默认单图（无核查关键词）

> 用户：帮我把这个视频生成手绘总结 https://v.douyin.com/abc/
>
> 助手：开始解析视频章节...
> [Step 1: 跑 generate.js]
> ✅ 总结图：~/Downloads/sketchnote-1730000000.png
> 内容：抗性淀粉 3 行水彩手账，绿/橙/蓝三个章节标号，含食物插图和关键数字。
>
> （用户没说核查 → 到此结束，不主动追加审核图）

### 示例 2：双图（用户明确要核查）

> 用户：帮我把这个视频生成手绘总结**并核查一下** https://v.douyin.com/abc/
>
> 助手：开始解析视频章节...
> [Step 1: 跑 generate.js]
> ✅ 总结图：~/Downloads/sketchnote-1730000000.png
>
> 检测到"核查"关键词，接下来跑事实核查...
> [Step 2: 拆 factual claims、双向取证、跑 audit-generate.js]
> ✅ 审核图：~/Downloads/sketchnote-audit-1730000099.png
> 核心修正点：
> - "X 研究 N 人" → 实际是 ADNI 数据库 819 人
> - "Y% 数字" → 国际一手报道无此数字，标 ❓
> - 补充 RCT 反向证据：VITAL trial 显示无效
> 原视频可信度：🟡 半真型（方向对、细节夸）
