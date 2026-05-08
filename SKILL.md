---
name: video-sketchnote
description: 给视频 URL（YouTube/B站/抖音/小红书/播客/微信视频号）自动生成手绘总结图片。复刻 ChatGPT 网页生图体验 — 调 NeuraRead API 拿章节内容，再用 OpenAI Responses API（GPT-5 + image_generation tool，底层 gpt-image-1）出图。触发：用户给视频链接 + 说"生成手绘总结"、"画成手绘笔记"、"video sketchnote"、"复刻 ChatGPT 生图"，或直接 /video-sketchnote <url>。
---

# 视频手绘总结生成 Skill

## 用途
用户提供一个视频/播客 URL → 自动产出一张手绘风格的总结图片（小红书手账、ChatGPT 视觉总结风），保存到 ~/Downloads/。

## 必需环境
- `OPENAI_API_KEY` 在 shell env（账号需开通 gpt-5 / image_generation tool）
- `node` 已安装

## 关键：放一张参考样图
**ChatGPT 网页生图效果好，是因为对话历史里有参考样图。** 想复刻那个效果，就把一张你喜欢的样图（小红书手账、ChatGPT 之前出的好图等）保存到：

```
~/.claude/skills/video-sketchnote/reference.png
```

（也可以用 .jpg / .jpeg / .webp）

脚本会自动读取这个文件，转 base64 data URI，跟视频内容一起喂给 GPT-5。GPT-5 看到示范图后会模仿其整体风格 — 颜色、布局、卡通度、字体感。

如果不放参考图，纯文字 prompt 出来的效果会跑偏（比如英文标题、少彩色、信息密度低）。

## 两种工作模式

### A. 工作流模式（推荐 — 直接用 ChatGPT 网页生图，效果最好）

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

### B. 全自动模式（API 直调，效果略弱但完全自动）

```bash
node ~/.claude/skills/video-sketchnote/scripts/generate.js "<URL>"
```

调 OpenAI Responses API（gpt-5 + image_generation tool）直接生图，存到 ~/Downloads/。

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
