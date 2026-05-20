# video-sketchnote

> 一句话：给一个视频/PDF/原理话题，自动生成 1–5 张手绘风格总结图，默认产出"内容总结 + 事实核查"双图。

**支持输入**：视频 URL（YouTube · 抖音 · 小红书 · B 站 · 小宇宙播客 · 微信视频号）· 本地 PDF · 公认原理话题

**5 种图（按需触发）**：
1. 📓 内容总结图（默认）
2. 🔍 事实核查结论图（默认）
3. ⚖️ 原理行动图（横版，用户说"原理图"时触发）
4. 💪 操作手册-训练篇（用户说"详细补充"时触发）
5. 🍴 操作手册-饮食习惯篇（同上）

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

### 3. LlamaParse API（可选 — 仅 PDF 模式需要）

如果你要把 PDF 转手账图，去 https://cloud.llamaindex.ai 申请，免费 1000 页/月：

```bash
export LLAMA_CLOUD_API_KEY="llx-..."
```

只用视频模式可跳过。

### 4. 参考图（已内嵌，不要替换）

仓库自带 `reference.png` 作为统一风格参考图。脚本自动读取它喂给 GPT-5，所有用户出图风格一致。

**不要替换它**——替换后出图会跑偏（英文标题、少彩色、信息密度低）。如果误删，`git checkout reference.png` 恢复。

### 5. 安装依赖

```bash
npm install
```

只需要 playwright，且仅在 `automate.js` 浏览器自动化模式下用到。`generate.js` / `prepare.js` 用纯 Node.js fetch 没有任何额外依赖。

---

## 用法 A — 命令行直调（5 种脚本）

### A1. 视频 → 总结图

```bash
node scripts/generate.js "https://www.xiaohongshu.com/discovery/item/..."
```

→ `~/Downloads/sketchnote-<ts>.png`（竖版 1024×1536）

### A2. PDF → 总结图

```bash
node scripts/pdf-generate.js "/绝对路径/paper.pdf"
```

→ `~/Downloads/sketchnote-pdf-<basename>-<ts>.png`
仅支持有文本层的 PDF。扫描件先 OCR。

### A3. 事实核查结论图

跑完 A1 之后，把核查结论文本（结构见 `SKILL.md`）喂给：

```bash
echo "<核查文本>" | node scripts/audit-generate.js
# 或
node scripts/audit-generate.js -f /tmp/audit-content.txt
```

→ `~/Downloads/sketchnote-audit-<ts>.png`，含 ✅⚠️❓✗ 标记

### A4. 原理 + 行动横版图

```bash
node scripts/principle-action-generate.js -f /tmp/principle-content.txt
```

→ `~/Downloads/sketchnote-principle-<ts>.png`（横版 1536×1024）
左半画原理 metaphor（洋葱/冰山/漏斗），右半画具体行动 1:1 对应。

### A5. 操作手册图（训练篇 + 饮食篇）

```bash
node scripts/action-manual-generate.js -f /tmp/manual-training.txt --suffix training
node scripts/action-manual-generate.js -f /tmp/manual-diet.txt --suffix diet
```

→ `~/Downloads/sketchnote-manual-training-<ts>.png` + `sketchnote-manual-diet-<ts>.png`
每个行动卡片带具体数字/频率/食物源/动作名。

---

## 用法 B — Claude Code / OpenClaw skill（推荐）

**Claude Code 用户**：

```bash
git clone https://github.com/hui77anna/video-sketchnote.git ~/.claude/skills/video-sketchnote
cd ~/.claude/skills/video-sketchnote && npm install
```

**OpenClaw 用户**（🦞 lobster way，373k+ stars 的开源 Agent 平台）：

```bash
git clone https://github.com/hui77anna/video-sketchnote.git ~/.openclaw/skills/video-sketchnote
cd ~/.openclaw/skills/video-sketchnote && npm install
```

两个工具的 skill 格式完全相同（YAML frontmatter + markdown），脚本用 `__dirname` 动态定位，install 路径不影响功能。

环境变量写进 `~/.zshrc`：

```bash
export OPENAI_API_KEY="sk-..."
export VIDEO_API_TOKEN="<向作者索取>"
export LLAMA_CLOUD_API_KEY="llx-..."   # 可选，PDF 模式才需要
```

然后在 Claude Code 里直接说：

> 「帮我用 video-sketchnote 生成手绘总结：https://...」
>
> 或：「这个视频核查一下出张原理图：https://...」（→ 自动出 3 张图）
>
> 或：「再详细补充操作手册」（→ 追加 2 张手册图）

Claude Code 自动识别意图，跑对应脚本组合，用 Read 工具打开图片描述给你看。完整触发词矩阵见 [SKILL.md](./SKILL.md)。

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
├── README.md                            ← 你正在看
├── SKILL.md                             ← Claude Code skill 入口（触发词 + 完整流程）
├── package.json
├── reference.png                        ← 风格参考图（已内嵌，勿替换）
└── scripts/
    ├── generate.js                      ← 视频 → 总结图
    ├── pdf-generate.js                  ← PDF → 总结图
    ├── audit-generate.js                ← 核查结论图
    ├── principle-action-generate.js     ← 原理行动横版图
    ├── action-manual-generate.js        ← 操作手册图（训练/饮食）
    ├── prepare.js                       ← 半自动 ChatGPT 网页模式
    ├── automate.js                      ← Playwright 全自动模式
    └── check.sh                         ← 环境自检脚本
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
