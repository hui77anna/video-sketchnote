---
name: video-sketchnote
description: 把视频 URL 或本地 PDF 文件自动生成手绘总结图片。视频走 NeuraRead API（YouTube/B站/抖音/小红书/播客/微信视频号），PDF 走 LlamaParse v2，统一用 GPT-5 + gpt-image-2 出图。触发：用户给视频链接或 PDF 路径 + 说"生成手绘总结"、"画成手绘笔记"、"video sketchnote"、"复刻 ChatGPT 生图"，或直接 /video-sketchnote <url-or-pdf>。
---

# 视频/PDF 手绘总结生成 Skill

## 用途
两种输入模式：
- **视频/播客 URL** → 调 NeuraRead 拿章节 → 出手绘总结图
- **本地 PDF 文件路径** → 调 LlamaParse v2 拿 markdown → GPT-5 提章节 → 出手绘总结图

输出统一保存到 `~/Downloads/`。

## 必需环境
- `OPENAI_API_KEY` 在 shell env（账号需开通 gpt-5 / gpt-image-2）
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

### B. 视频 → 全自动模式（API 直调）

```bash
node ~/.claude/skills/video-sketchnote/scripts/generate.js "<URL>"
```

调 OpenAI Responses API（gpt-5 + gpt-image-2）直接生图，存到 ~/Downloads/。

### C. PDF → 全自动模式（LlamaParse + GPT-5 + gpt-image-2）

```bash
node ~/.claude/skills/video-sketchnote/scripts/pdf-generate.js "<PDF 文件绝对路径>"
```

流水线：
1. 上传 PDF 到 LlamaParse v2，轮询直到 `SUCCESS`，取 markdown
2. GPT-5 把 markdown 转成 `{title, summary, chapters[{title, summary, bullets}]}` JSON 结构
3. GPT-5 + 参考图 → 详细英文 sketchnote prompt
4. gpt-image-2 渲染 → 保存到 `~/Downloads/sketchnote-pdf-<basename>-<ts>.png`

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

- 视频解析失败（HTTP 4xx/5xx）：提示"视频可能是私密的、链接失效，或 NeuraRead API 暂时不可用"
- OpenAI 401：`OPENAI_API_KEY` 未设置或无效
- OpenAI 403/404 含 "model" 字样：账号没开通 gpt-5，可以让脚本降级到 `gpt-4.1` 或 `gpt-4o`（脚本里已有 fallback 链）
- 视频没章节：提示用户"视频内容太短或解析未完成，建议先在 https://daily-digest-rust.vercel.app/video 解析过再来"

## 示例对话

> 用户：帮我把这个视频生成手绘总结 https://v.douyin.com/abc/
>
> 助手：开始解析视频章节...
> [跑脚本]
> ✅ 已生成：~/Downloads/sketchnote-1730000000.png
> 图片内容：抗性淀粉 3 行水彩手账，绿/橙/蓝三个章节标号，含食物插图和关键数字。
