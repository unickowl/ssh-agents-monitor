#!/usr/bin/env bash
# ~/.claude/agent-permission-hook.sh
#
# 由 Claude Code PermissionRequest hook 自動觸發。
# 當 agent 需要使用者確認某個工具時，寫入 waiting 事件到 JSONL log。
# 注意：此 hook 永遠 exit 0（非阻塞），不拒絕任何操作。

# ── 安全：任何錯誤都靜默處理，絕不影響 agent ─────────────────────────────
set +e
trap 'exit 0' ERR

LOG_DIR="${CLAUDE_AGENT_LOG_DIR:-/tmp/claude-agents}"

# ── 先讀 stdin，session_id 可能在 JSON payload 裡 ────────────────────────
INPUT=$(cat 2>/dev/null || echo '{}')

DIR_NAME=$(basename "$PWD")
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── 取 session_id：優先從 JSON payload，fallback 到環境變數 ──────────────
if command -v python3 &>/dev/null; then
  SESSION_ID=$(echo "$INPUT" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); print(d.get('session_id',''))
except: print('')
" 2>/dev/null)
else
  SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | sed 's/"session_id":"\(.*\)"/\1/')
fi
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-}}"

if [ -n "$SESSION_ID" ]; then
  SESSION_SHORT=$(printf '%s' "$SESSION_ID" | head -c 8)
  AGENT_ID="${DIR_NAME}-${SESSION_SHORT}"
else
  AGENT_ID="$DIR_NAME"
fi
LOG_FILE="$LOG_DIR/${AGENT_ID}.jsonl"
LOCK_FILE="$LOG_DIR/${AGENT_ID}.lock"

# ── 若 log 檔不存在，跳過（避免產生孤立事件）────────────────────────────
[ -f "$LOG_FILE" ] || exit 0

# ── JSON 解析：取得 tool_name ─────────────────────────────────────────────
if command -v python3 &>/dev/null; then
  TOOL=$(echo "$INPUT" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); print(d.get('tool_name','unknown'))
except: print('unknown')
" 2>/dev/null)
else
  TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | sed 's/"tool_name":"\(.*\)"/\1/')
fi
TOOL="${TOOL:-unknown}"

# ── 跳脫特殊字元，確保 JSON 合法 ─────────────────────────────────────────
escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'
}

TOOL_ESC=$(escape_json "$TOOL")
REASON_ESC=$(escape_json "等待確認：$TOOL")

# ── flock：避免並發寫入衝突 ────────────────────────────────────────────────
(
  flock -w 2 200 2>/dev/null || true

  echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"waiting\",\"reason\":\"$REASON_ESC\",\"urgent\":false}" >> "$LOG_FILE"

) 200>"$LOCK_FILE"

exit 0
