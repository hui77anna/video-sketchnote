# video-sketchnote 快捷命令 vsn
# 用法:
#   1. 从小红书/抖音/YouTube 等 app 复制视频链接（可以是包含标题/emoji 的整段文本）
#   2. 终端打 vsn 回车
# 自动从剪贴板抽 URL、调脚本、出图、Preview 弹出
#
# 把此文件 source 到 ~/.video-sketchnote-env.sh 或 ~/.zshrc 即可
# （如果你的 ~/.video-sketchnote-env.sh 已经 source 了，重启终端就有 vsn 命令）

vsn() {
  local input="${1:-$(pbpaste)}"
  local script_paths=(
    "$HOME/.openclaw/skills/video-sketchnote/scripts/generate.js"
    "$HOME/.claude/skills/video-sketchnote/scripts/generate.js"
  )
  local script=""
  for p in "${script_paths[@]}"; do
    [ -f "$p" ] && script="$p" && break
  done
  if [ -z "$script" ]; then
    echo "❌ 找不到 generate.js，请确认 skill 已安装到 ~/.openclaw/skills/ 或 ~/.claude/skills/"
    return 1
  fi
  if [ -z "$input" ]; then
    echo "❌ 剪贴板是空的。先 Cmd+C 复制视频链接，再跑 vsn"
    return 1
  fi
  node "$script" "$input"
}
