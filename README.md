# video-sketchnote

> 一句话：给一个视频/播客链接，自动生成一张手绘风格的总结图片，复刻 ChatGPT 网页生图体验。

支持平台：YouTube · 抖音 · 小红书 · B 站 · 小宇宙播客 · 微信视频号

![demo](reference.png)

## 三种用法

| 用法 | 适合谁 | 命令 |
|---|---|---|
| **A. Claude Code skill** | 用 Claude Code 的开发者 | 自然语言：「video-sketchnote [URL]」 |
| **B. 直接命令行** | Node.js 用户 | `node scripts/generate.js "URL"` |
| **C. 半自动 + ChatGPT 网页** | 想要最高画质，愿意点 3 下鼠标 | `node scripts/prepare.js "URL"` |

## 为什么效果接近 ChatGPT 网页

ChatGPT 网页生图的"秘诀"不是模型，是**多步流程**：
1. GPT-5 看你的输入 + 参考图，**自动改写成超详细英文 prompt**
2. 改写后的 prompt 喂给 `gpt-image-2`（带原生推理层）
3. 模型按详细 prompt 渲染

本 skill **复刻这个流程**：
- 调你部署的视频解析 API 拿章节 + 完整 transcript
- 用 sketchnote 专用 system prompt 让 GPT-5 转写为详细英文 prompt
- 把参考图通过 multi-modal input 一起喂给 GPT-5
- gpt-image-2 渲染，size `1024x1536` 竖版，quality `high`
- 失败 fallback：chatgpt-image-latest → gpt-image-1.5 → gpt-image-1

[→ 详见技术原理](#技术原理)

---

## 准备工作

### 1. OpenAI API（必需）

去 https://platform.openai.com 充值（最少 $5），然后：

```bash
export OPENAI_API_KEY="sk-..."
```

要解锁最强模型 `gpt-image-2` / `chatgpt-image-latest`，账号需要做 [Organization Verification](https://platform.openai.com/settings/organization/general)（KYC 身份验证 + 绑信用卡）。Visa 拒绝率高的可以试 [Wildcard 虚拟卡](https://bewildcard.com)。

不验证只能用 `gpt-image-1` / `gpt-image-1.5`，效果次一档。

### 2. 视频解析 API（必需）

本工具不自己解析视频字幕，要调一个外部 API。**默认指向作者部署的 NeuraRead**（`https://daily-digest-rust.vercel.app/api/video-analyze`）——为防止滥用，作者部署默认开启 API key 鉴权。如果你拿到 key，配上去即可使用：

```bash
export VIDEO_API_TOKEN="作者发给你的 token"
```

或者用自己部署的实例（自部署可以不开鉴权，留空 `VIDEO_API_TOKEN` 即可）：

```bash
export VIDEO_API_BASE="https://your-domain.com"
export VIDEO_API_TOKEN=""    # 可选
```

API 接口规范：

```bash
POST {VIDEO_API_BASE}/api/video-analyze
Headers: Authorization: Bearer {VIDEO_API_TOKEN}  # 可选
Body: { "url": "<video_url>" }

Response: {
  "video": { "title": "...", ... },
  "summary": "整体摘要",
  "chapters": [{ "startTime": "00:15", "title": "...", "summary": "...", "bullets": [...] }],
  "highlights": [{ "timestamp": "00:15", "desc": "..." }],
  "transcript": "[00:00] 完整逐字稿..."
}
```

如果你有自己的视频解析方案，包成这个接口格式即可。

### 3. 参考图（强烈推荐）

把一张你喜欢的手账风样图（小红书手账、ChatGPT 出过的好图等）放到：

```
./reference.png
```

也支持 .jpg / .jpeg / .webp。不放也能跑，但视觉风格会跑偏。

### 4. 安装依赖

```bash
npm install
```

只需要 playwright，且仅在 `automate.js` 浏览器自动化模式下用到。`generate.js` / `prepare.js` 用纯 Node.js fetch 没有任何额外依赖。

---

## 用法 A — 命令行直调

```bash
node scripts/generate.js "https://www.xiaohongshu.com/discovery/item/..."
```

脚本会：
1. 调视频解析 API 拿章节
2. GPT-5 转写为详细英文 prompt
3. gpt-image-2 渲染
4. 保存到 `~/Downloads/sketchnote-<时间戳>.png`

---

## 用法 B — Claude Code skill

把整个目录 clone 到 `~/.claude/skills/video-sketchnote/`：

```bash
git clone <your-repo-url> ~/.claude/skills/video-sketchnote
cd ~/.claude/skills/video-sketchnote
npm install
```

然后在 Claude Code 里直接说：

> 「帮我用 video-sketchnote 生成手绘总结：https://...」

Claude Code 会自动识别 skill，跑脚本，用 Read 工具打开图片描述给你看。

---

## 用法 C — 半自动工作流（最高画质）

```bash
node scripts/prepare.js "<URL>"
```

脚本会：
1. 解析视频章节
2. 把 prompt 复制到系统剪贴板
3. 自动打开 chatgpt.com（gpt-5）
4. 在 Finder 高亮 reference.png 方便拖拽

然后你在 ChatGPT 里：
- 把 Finder 里的 reference.png 拖进对话框
- Cmd+V 粘贴 prompt
- 回车 → 等出图
- 右键保存到 `~/Downloads/`

这个模式画质最高（用 ChatGPT 自己的内部 system prompt），代价是手动 3 步。

---

## 用法 D — Playwright 全自动（实验性，需要 ChatGPT Plus）

```bash
node scripts/automate.js "<URL>"
```

用 Playwright 操控你的 Chrome 自动操作 chatgpt.com（首次需要手动登录一次）。完全无人值守。但 ChatGPT UI 改了脚本就坏，需要 maintain。

需要的：
- ChatGPT Plus 订阅（$20/月）
- 第一次跑会弹出 Chrome 让你登录 ChatGPT，cookie 持久化在 `chrome-profile/`

---

## 技术原理

### 流程图

```
视频 URL
   ↓
视频解析 API → { 标题 / 摘要 / 章节 / highlights / transcript }
   ↓
拼成 ~2000 字中文 prompt
   ↓
GPT-5 (Responses API)
   - System prompt: sketchnote 专用提示词（指定布局/颜色/嵌套结构）
   - User: 中文 prompt + 参考图 (multi-modal input)
   ↓
GPT-5 输出 ~3500-4000 字符英文详细 prompt
（含每个章节的颜色 hex、字号、位置、文字内容）
   ↓
gpt-image-2 (Images API)
   - quality: high
   - size: 1024x1536 (竖版 A4)
   ↓
PNG → 保存
```

### 模型 fallback 链

为了兼顾"账号是否验证 / OpenAI 模型上线节奏"，脚本按优先级降级：

```js
gpt-image-2          ← 当前最强，需要组织验证
chatgpt-image-latest ← ChatGPT 网页同款，需要组织验证
gpt-image-1.5        ← 中间档，无需验证
gpt-image-1          ← 旧版兜底
```

### 文件结构

```
video-sketchnote/
├── README.md             ← 你正在看
├── SKILL.md              ← Claude Code skill 入口（声明触发词 + 流程）
├── package.json
├── reference.png         ← 风格参考图（用户可替换）
└── scripts/
    ├── generate.js       ← 用法 A：命令行直调
    ├── prepare.js        ← 用法 C：半自动
    └── automate.js       ← 用法 D：Playwright 全自动
```

---

## 已知限制

1. **gpt-image-2 中文渲染偶有错字**——OpenAI 模型对中文笔画准确度不如英文。
2. **模型代差填不平**——API 永远比 ChatGPT 网页差 5-15%（OpenAI 内部 thinking 深度调度权限不公开）。
3. **视频解析依赖外部 API**——TikHub 抓不到 / xsec_token 过期 / BibiGPT 转录失败时整个流程跑不起来。
4. **Playwright 模式脆弱**——ChatGPT UI 一改 selectors 就坏。

---

## License

MIT

---

## 致谢

- 视频解析灵感来自 [BibiGPT](https://bibigpt.co)
- 参考图风格借鉴自小红书"手账"创作者社区
