#!/usr/bin/env bash
# ~/.claude/agent-stop-hook.sh
#
# 由 Claude Code Stop hook 觸發，在 agent 完成任務時記錄。
# 修正：永不 exit 非 0、python3 fallback、flock

set +e
trap 'exit 0' ERR

LOG_DIR="${CLAUDE_AGENT_LOG_DIR:-/tmp/claude-agents}"
mkdir -p "$LOG_DIR" 2>/dev/null || true

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

# 解析 stop_reason
if command -v python3 &>/dev/null; then
  STOP_REASON=$(echo "$INPUT" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); print(d.get('stop_reason','end_turn'))
except: print('end_turn')
" 2>/dev/null)
else
  STOP_REASON=$(echo "$INPUT" | grep -o '"stop_reason":"[^"]*"' | sed 's/"stop_reason":"\(.*\)"/\1/')
  STOP_REASON="${STOP_REASON:-end_turn}"
fi

(
  flock -w 2 200 2>/dev/null || true

  TOOL_COUNT=$(grep -c '"event":"tool_use"' "$LOG_FILE" 2>/dev/null || echo 0)

  case "$STOP_REASON" in
    end_turn)
      # 正常完成
      echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"complete\",\"summary\":\"完成（共 ${TOOL_COUNT} 次工具呼叫）\",\"stop_reason\":\"$STOP_REASON\"}" >> "$LOG_FILE"
      ;;
    max_tokens)
      # 超過 token 上限，視為可恢復錯誤（warning）
      echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"error\",\"message\":\"已達 token 上限（${TOOL_COUNT} 次工具呼叫）\",\"recoverable\":true,\"stop_reason\":\"$STOP_REASON\"}" >> "$LOG_FILE"
      ;;
    stop_sequence)
      # 觸發 stop sequence，通常是正常結束
      echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"complete\",\"summary\":\"stop_sequence 結束（共 ${TOOL_COUNT} 次工具呼叫）\",\"stop_reason\":\"$STOP_REASON\"}" >> "$LOG_FILE"
      ;;
    tool_use)
      # 中途被中斷（tool_use 尚未完成）
      echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"error\",\"message\":\"執行中途中斷（${TOOL_COUNT} 次工具呼叫）\",\"recoverable\":false,\"stop_reason\":\"$STOP_REASON\"}" >> "$LOG_FILE"
      ;;
    *)
      # 未預期的停止原因（崩潰、被 kill 等）
      REASON_MSG="${STOP_REASON:-unknown}"
      echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"error\",\"message\":\"非預期停止：${REASON_MSG}（${TOOL_COUNT} 次工具呼叫）\",\"recoverable\":false,\"stop_reason\":\"$STOP_REASON\"}" >> "$LOG_FILE"
      ;;
  esac

  # 清除舊版 .session 檔（相容性清理）
  rm -f "$LOG_DIR/${DIR_NAME}.session" 2>/dev/null || true

) 200>"$LOCK_FILE"

exit 0
