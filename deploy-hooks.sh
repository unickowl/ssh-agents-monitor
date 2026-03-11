#!/usr/bin/env bash
# deploy-hooks.sh
#
# 在遠端機器上執行這個腳本，一次完成所有設定。
# 用法：bash deploy-hooks.sh

set -e

CLAUDE_DIR="$HOME/.claude"
LOG_DIR="${CLAUDE_AGENT_LOG_DIR:-/tmp/claude-agents}"
SETTINGS="$CLAUDE_DIR/settings.json"

echo "🔧 Claude Code Agent Monitor — Hook 安裝程式"
echo "────────────────────────────────────────────"

# ── 1. 建立目錄 ────────────────────────────────────────────────────────────
mkdir -p "$CLAUDE_DIR"
mkdir -p "$LOG_DIR"
echo "✓ 目錄建立完成：$CLAUDE_DIR"

# ── 2. 複製 hook scripts ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cp "$SCRIPT_DIR/agent-log-hook.sh"         "$CLAUDE_DIR/agent-log-hook.sh"
cp "$SCRIPT_DIR/agent-stop-hook.sh"        "$CLAUDE_DIR/agent-stop-hook.sh"
cp "$SCRIPT_DIR/agent-permission-hook.sh"  "$CLAUDE_DIR/agent-permission-hook.sh"
cp "$SCRIPT_DIR/agent-session-end-hook.sh" "$CLAUDE_DIR/agent-session-end-hook.sh"
cp "$SCRIPT_DIR/agent-prompt-hook.sh"      "$CLAUDE_DIR/agent-prompt-hook.sh"
chmod +x "$CLAUDE_DIR/agent-log-hook.sh"
chmod +x "$CLAUDE_DIR/agent-stop-hook.sh"
chmod +x "$CLAUDE_DIR/agent-permission-hook.sh"
chmod +x "$CLAUDE_DIR/agent-session-end-hook.sh"
chmod +x "$CLAUDE_DIR/agent-prompt-hook.sh"
echo "✓ Hook scripts 安裝完成"

# ── 3. 寫入 settings.json ─────────────────────────────────────────────────
# 如果已有設定檔，嘗試合併；否則新建
if [ -f "$SETTINGS" ]; then
    echo "⚠ 已存在 $SETTINGS，正在備份為 settings.json.bak"
    cp "$SETTINGS" "$SETTINGS.bak"

    # 用 python3 合併 hooks 設定
    python3 - "$SETTINGS" "$CLAUDE_DIR" <<'PYEOF'
import sys, json

settings_path = sys.argv[1]
claude_dir = sys.argv[2]

with open(settings_path) as f:
    settings = json.load(f)

new_hooks = {
    "PostToolUse": [
        {
            "matcher": "",
            "hooks": [
                {
                    "type": "command",
                    "command": f"{claude_dir}/agent-log-hook.sh"
                }
            ]
        }
    ],
    "Stop": [
        {
            "matcher": "",
            "hooks": [
                {
                    "type": "command",
                    "command": f"{claude_dir}/agent-stop-hook.sh"
                }
            ]
        }
    ],
    "PermissionRequest": [
        {
            "matcher": "",
            "hooks": [
                {
                    "type": "command",
                    "command": f"{claude_dir}/agent-permission-hook.sh"
                }
            ]
        }
    ],
    "SessionEnd": [
        {
            "matcher": "",
            "hooks": [
                {
                    "type": "command",
                    "command": f"{claude_dir}/agent-session-end-hook.sh"
                }
            ]
        }
    ],
    "UserPromptSubmit": [
        {
            "matcher": "",
            "hooks": [
                {
                    "type": "command",
                    "command": f"{claude_dir}/agent-prompt-hook.sh"
                }
            ]
        }
    ]
}

# 合併：保留原有 hooks，加入新的
existing = settings.get("hooks", {})
for event, hook_list in new_hooks.items():
    if event not in existing:
        existing[event] = hook_list
    else:
        # 避免重複新增
        existing_cmds = [h["hooks"][0]["command"] for h in existing[event] if h.get("hooks")]
        for item in hook_list:
            cmd = item["hooks"][0]["command"]
            if cmd not in existing_cmds:
                existing[event].append(item)

settings["hooks"] = existing

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

print("✓ settings.json 合併完成")
PYEOF

else
    # 全新安裝
    python3 - "$SETTINGS" "$CLAUDE_DIR" <<'PYEOF'
import sys, json

settings_path = sys.argv[1]
claude_dir = sys.argv[2]

settings = {
    "hooks": {
        "PostToolUse": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"{claude_dir}/agent-log-hook.sh"
                    }
                ]
            }
        ],
        "Stop": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"{claude_dir}/agent-stop-hook.sh"
                    }
                ]
            }
        ],
        "PermissionRequest": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"{claude_dir}/agent-permission-hook.sh"
                    }
                ]
            }
        ],
        "SessionEnd": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"{claude_dir}/agent-session-end-hook.sh"
                    }
                ]
            }
        ],
        "UserPromptSubmit": [
            {
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": f"{claude_dir}/agent-prompt-hook.sh"
                    }
                ]
            }
        ]
    }
}

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

print("✓ settings.json 建立完成")
PYEOF
fi

# ── 4. 清除舊 log（可選） ──────────────────────────────────────────────────
read -p "是否清除舊的 agent log？($LOG_DIR) [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f "$LOG_DIR"/*.jsonl
    echo "✓ 舊 log 已清除"
fi

# ── 5. 完成 ───────────────────────────────────────────────────────────────
echo ""
echo "✅ 安裝完成！"
echo ""
echo "接下來："
echo "  • 直接用 claude 指令啟動 agent，不需要任何修改"
echo "  • Log 會自動寫入 $LOG_DIR/<目錄名>.jsonl"
echo "  • 在本機執行監控 server：npm start"
echo ""
echo "測試方式（可選）："
echo "  cd ~/your-project && claude --print 'list files'"
echo "  cat $LOG_DIR/your-project.jsonl"
