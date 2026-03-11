#!/usr/bin/env bash
# ~/.claude/agent-session-end-hook.sh
#
# 由 Claude Code SessionEnd hook 自動觸發。
# 當 session 正常關閉時，寫入 closed 事件到 JSONL log。

set +e
trap 'exit 0' ERR

LOG_DIR="${CLAUDE_AGENT_LOG_DIR:-/tmp/claude-agents}"

INPUT=$(cat 2>/dev/null || echo '{}')

DIR_NAME=$(basename "$PWD")
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 取 session_id
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

# log 不存在就不寫
[ -f "$LOG_FILE" ] || exit 0

(
  flock -w 2 200 2>/dev/null || true
  echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"closed\"}" >> "$LOG_FILE"
) 200>"$LOCK_FILE"

exit 0
