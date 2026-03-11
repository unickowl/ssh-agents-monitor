#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# agent-logger.sh — Claude Code Agent 日誌輔助工具
#
# 用法：
#   source ./agent-logger.sh "agent-auth-api" "Implement Auth API" "auth-openapi.yaml"
#
# 接著在你的 agent wrapper 中呼叫：
#   log_start
#   log_progress "Parsing spec" 10 1
#   log_tool "write_file" "src/auth/handler.ts"
#   log_waiting "需要確認：是否覆蓋已存在的 users table？"
#   log_error "無法解析 spec：缺少必填欄位 info" false
#   log_complete "建立了 12 個檔案，340 行程式碼"
# ─────────────────────────────────────────────────────────────────────────────

AGENT_ID="${1:-agent-$(hostname)-$$}"
AGENT_TASK="${2:-Unknown task}"
AGENT_SPEC="${3:-}"
LOG_DIR="${CLAUDE_AGENT_LOG_DIR:-/tmp/claude-agents}"
LOG_FILE="$LOG_DIR/${AGENT_ID}.jsonl"

mkdir -p "$LOG_DIR"

_log() {
  local event="$1"
  shift
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local entry="{\"time\":\"$ts\",\"agent\":\"$AGENT_ID\""
  entry="$entry,\"event\":\"$event\""
  # append extra key=value pairs
  while [[ $# -ge 2 ]]; do
    local key="$1" val="$2"
    shift 2
    # quote non-numeric values
    if [[ "$val" =~ ^[0-9]+$ ]]; then
      entry="$entry,\"$key\":$val"
    elif [[ "$val" == "true" || "$val" == "false" ]]; then
      entry="$entry,\"$key\":$val"
    else
      # escape double quotes in val
      val="${val//\"/\\\"}"
      entry="$entry,\"$key\":\"$val\""
    fi
  done
  entry="$entry}"
  echo "$entry" >> "$LOG_FILE"
  echo "[$(date +%H:%M:%S)] [$AGENT_ID] $event" >&2
}

log_start() {
  _log "start" "task" "$AGENT_TASK" "spec" "$AGENT_SPEC"
}

log_progress() {
  # log_progress "Step description" <total_steps> <done_steps>
  local step="${1:-Processing}"
  local total="${2:-0}"
  local done="${3:-0}"
  _log "progress" "step" "$step" "total" "$total" "done" "$done"
}

log_tool() {
  # log_tool "tool_name" "input description"
  local tool="${1:-unknown}"
  local input="${2:-}"
  _log "tool_use" "tool" "$tool" "input" "$input"
}

log_waiting() {
  # log_waiting "Reason" [urgent=true/false]
  local reason="${1:-Waiting for input}"
  local urgent="${2:-false}"
  _log "waiting" "reason" "$reason" "urgent" "$urgent"
}

log_error() {
  # log_error "Error message" [recoverable=true/false]
  local message="${1:-Unknown error}"
  local recoverable="${2:-true}"
  _log "error" "message" "$message" "recoverable" "$recoverable"
}

log_complete() {
  # log_complete "Summary of what was done"
  local summary="${1:-Completed}"
  _log "complete" "summary" "$summary"
}

log_idle() {
  _log "idle"
}

echo "[agent-logger] 初始化 Agent: $AGENT_ID" >&2
echo "[agent-logger] 日誌路徑: $LOG_FILE" >&2
