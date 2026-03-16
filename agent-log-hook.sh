#!/usr/bin/env bash
# ~/.claude/agent-log-hook.sh
#
# 由 Claude Code PostToolUse hook 自動觸發。
# 修正：flock 並發鎖定、python3 fallback、永不 exit 非 0、log rotation、session 重置

# ── 安全：任何錯誤都靜默處理，絕不影響 agent ─────────────────────────────
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

# ── JSON 解析：優先用 python3，fallback 用 grep/sed ─────────────────────
parse_tool_name() {
  local json="$1"
  if command -v python3 &>/dev/null; then
    echo "$json" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); print(d.get('tool_name','unknown'))
except: print('unknown')
" 2>/dev/null
  else
    echo "$json" | grep -o '"tool_name":"[^"]*"' | head -1 | sed 's/"tool_name":"\(.*\)"/\1/'
  fi
}

parse_tool_input() {
  local json="$1"
  if command -v python3 &>/dev/null; then
    echo "$json" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    inp=d.get('tool_input',{})
    for k in ['path','file_path','command','query','url']:
        if k in inp:
            v=str(inp[k]); print(v[:120]+('...' if len(v)>120 else '')); sys.exit()
    if inp:
        v=str(list(inp.values())[0]); print(v[:120]+('...' if len(v)>120 else ''))
except: pass
" 2>/dev/null
  else
    echo "$json" | grep -o '"path":"[^"]*"' | head -1 | sed 's/"path":"\(.*\)"/\1/' | cut -c1-120
  fi
}

TOOL=$(parse_tool_name "$INPUT")
TOOL="${TOOL:-unknown}"
TOOL_INPUT=$(parse_tool_input "$INPUT")

# ── 跳脫特殊字元，確保 JSON 合法 ─────────────────────────────────────────
escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'
}

TOOL_ESC=$(escape_json "$TOOL")
INPUT_ESC=$(escape_json "$TOOL_INPUT")

# ── flock：同目錄多個 agent 並發時避免寫入衝突 ──────────────────────────
(
  flock -w 2 200 2>/dev/null || true  # 最多等 2 秒，拿不到鎖也不阻塞 agent

  # ── 優先使用環境變數，fallback 到目錄名稱（不含 session suffix）──────────
  AGENT_TASK_ESC=$(escape_json "${CLAUDE_AGENT_TASK:-$DIR_NAME}")
  AGENT_SPEC_ESC=$(escape_json "${CLAUDE_AGENT_SPEC:-}")

  if [ ! -f "$LOG_FILE" ]; then
    # 首次寫入此 session → 自動建立 start 事件
    # AGENT_ID 已內含 session suffix，每個 context 各自獨立
    echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"start\",\"task\":\"$AGENT_TASK_ESC\",\"spec\":\"$AGENT_SPEC_ESC\"}" >> "$LOG_FILE"
  fi

  # ── 寫入 tool_use ─────────────────────────────────────────────────────
  echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"tool_use\",\"tool\":\"$TOOL_ESC\",\"input\":\"$INPUT_ESC\"}" >> "$LOG_FILE"

  # ── 攔截 TodoWrite：把 todos 陣列寫成 tasks 事件（Claude 內建 todo）──
  if [ "$TOOL" = "TodoWrite" ] && command -v python3 &>/dev/null; then
    TODOS_JSON=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    todos = d.get('tool_input', {}).get('todos', [])
    if todos:
        print(json.dumps(todos, ensure_ascii=False))
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null)
    if [ -n "$TODOS_JSON" ]; then
      echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"tasks\",\"todos\":$TODOS_JSON}" >> "$LOG_FILE"
    fi
  fi

  # ── 攔截 tasks.md 寫入：解析 markdown checkbox（OpenSpec / SDD）────────
  # 當 Write 或 Edit 的目標是 tasks.md 時，讀取最新內容並解析進度
  if { [ "$TOOL" = "Write" ] || [ "$TOOL" = "Edit" ]; } && command -v python3 &>/dev/null; then
    # 取 tool_input.file_path 或 path（Claude Code 的 Edit/Write 工具用 file_path）
    TOOL_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    inp = d.get('tool_input', {})
    # Edit & Write tools use 'file_path'; fallback to 'path' for compatibility
    p = inp.get('file_path', '') or inp.get('path', '')
    print(p)
except Exception:
    print('')
" 2>/dev/null)

    case "$TOOL_PATH" in
      *tasks.md)
        # 轉成絕對路徑
        case "$TOOL_PATH" in
          /*) ABS_PATH="$TOOL_PATH" ;;
          *)  ABS_PATH="$PWD/$TOOL_PATH" ;;
        esac

        if [ -f "$ABS_PATH" ]; then
          TASKS_JSON=$(OPENSPEC_FILE="$ABS_PATH" python3 - <<'PYEOF'
import sys, json, re, os

path = os.environ.get('OPENSPEC_FILE', '')
try:
    with open(path, 'r', errors='replace') as f:
        content = f.read()
    tasks = []
    for line in content.splitlines():
        # 支援 "- [ ] task" 和 "- [x] task"（大小寫皆可）
        m = re.match(r'^[-*]\s+\[([ xX])\]\s+(.+)', line.strip())
        if m:
            checked = m.group(1).lower() == 'x'
            text = m.group(2).strip()
            tasks.append({
                'id': str(len(tasks) + 1),
                'content': text,
                'status': 'completed' if checked else 'pending',
                'priority': 'medium',
            })
    if tasks:
        print(json.dumps(tasks, ensure_ascii=False))
    else:
        print('')
except Exception:
    print('')
PYEOF
)
          if [ -n "$TASKS_JSON" ]; then
            echo "{\"time\":\"$TS\",\"agent\":\"$AGENT_ID\",\"event\":\"tasks\",\"source\":\"tasks.md\",\"todos\":$TASKS_JSON}" >> "$LOG_FILE"
          fi
        fi
        ;;
    esac
  fi

  # ── 防止單檔無限增長：超過 1000 行截斷至 800 行 ──────────────────────
  LINE_COUNT=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$LINE_COUNT" -gt 1000 ]; then
    TEMP="$LOG_FILE.tmp"
    tail -n 800 "$LOG_FILE" > "$TEMP" && mv "$TEMP" "$LOG_FILE" || true
  fi

  # ── 清理同專案超過 7 天的舊 session log ──────────────────────────────
  find "$LOG_DIR" -name "${DIR_NAME}-*.jsonl" -mtime +7 -delete 2>/dev/null || true

) 200>"$LOCK_FILE"

exit 0
