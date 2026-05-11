#!/usr/bin/env bash
set -u
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
pass() { printf "\033[32m✅\033[0m %s\n" "$1"; }
fail() { printf "\033[31m❌\033[0m %s\n" "$1"; FAILED=1; }
FAILED=0

# 1. node 版本
NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
[ "${NODE_VER:-0}" -ge 18 ] && pass "node $(node -v)" || fail "node 缺失或 < 18（brew install node）"

# 2. 依赖装了吗
[ -d "$SKILL_DIR/node_modules/playwright" ] && pass "node_modules 已装" || fail "缺依赖（cd $SKILL_DIR && npm install）"

# 3. 参考图在不在
[ -f "$SKILL_DIR/reference.png" ] && pass "reference.png 存在" || fail "reference.png 缺失（重装 skill 包）"

# 4. OpenAI key 设了吗
[ -n "${OPENAI_API_KEY:-}" ] && pass "OPENAI_API_KEY 已设" || fail "OPENAI_API_KEY 未设（echo 'export OPENAI_API_KEY=...' >> ~/.zshrc）"

# 5. OpenAI API 通不通 + 账号能用 gpt-5 吗
if [ -n "${OPENAI_API_KEY:-}" ]; then
  RESP=$(curl -s -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models/gpt-5 \
    -H "Authorization: Bearer $OPENAI_API_KEY")
  [ "$RESP" = "200" ] && pass "OpenAI 账号能访问 gpt-5" || fail "OpenAI 返回 HTTP $RESP（key 错 / 没开 gpt-5 / 没充值）"
fi

# 6. 视频解析服务活着吗（可通过 VIDEO_API_BASE / VIDEO_API_TOKEN 覆盖）
VIDEO_API="${VIDEO_API_BASE:-https://daily-digest-rust.vercel.app}"
AUTH_HEADER=""
[ -n "${VIDEO_API_TOKEN:-}" ] && AUTH_HEADER="-H Authorization: Bearer ${VIDEO_API_TOKEN}"
NEURA=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 $AUTH_HEADER "${VIDEO_API}/api/video-analyze" 2>/dev/null || echo "000")
case "$NEURA" in
  401|403) fail "视频解析服务返回 ${NEURA}（VIDEO_API_TOKEN 缺失或错误）" ;;
  000)     fail "视频解析服务连不上 ${VIDEO_API}（视频模式会崩，PDF 模式不受影响）" ;;
  *)       pass "视频解析服务可达 ${VIDEO_API}（HTTP ${NEURA}）" ;;
esac

echo "---"
[ "$FAILED" = "0" ] && echo "🎉 全通过，可以发给领导了" || echo "⚠️  有问题先修上面的红色项"
exit "$FAILED"
