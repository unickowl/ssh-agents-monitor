# Claude Agent Monitor

![example](/public/images/example.png)

> 在公司內部透過 SSH 即時監控遠端機器上多個 Claude Code Agent 的執行狀態。

---

## 背景

同時開著多個 Claude Code session 並行處理任務時，很容易遇到一個問題：某個 agent 卡住等待確認，但那個終端機視窗被其他東西蓋住，根本不知道它在等你。等你發現的時候可能已經擺著空轉好幾分鐘。

這個工具受到 [Spectra](https://github.com/kaochenlong/spectra-app) 的啟發。Spectra 的介面設計很漂亮，也能顯示 agent 的執行狀態，但它假設 monitor 和 agent 跑在同一台機器上。在公司環境中，Claude Code 通常跑在遠端的開發機或 CI 伺服器，本機只是觀察端，所以決定自己做一份加上 SSH 遠端連線能力的版本。

只要有 agent 需要介入，不管它的視窗被蓋在哪裡，桌面和瀏覽器通知都會立刻跳出來。

---

## 功能

- **即時狀態看板** — 每個 agent 一張卡片，顯示目前任務、執行進度、工具呼叫、token 用量
- **SSH 輪詢** — 透過 SSH 連接遠端機器，讀取 `/tmp/claude-agents/` 下的 JSONL log
- **Alerts bar** — 需要人工介入的 agent 會在頂部彙整顯示，可點「忽略」暫時消除
- **桌面 + 瀏覽器通知** — 狀態變化（等待確認、錯誤、完成）自動推送通知
- **24h token 用量** — 從遠端 `~/.claude/projects/` 彙整當日 input/output/cache token 數
- **Setup wizard** — 初次啟動自動跳出 SSH 設定介面，測試連線後一鍵安裝 hooks
- **Demo 模式** — 不設定 `.env` 時自動跑 mock 資料，可直接預覽介面
- **亮 / 暗主題切換**、**RWD 支援**

---

## 架構

```
agent-monitor/
├── server/
│   └── index.js          # Express + WebSocket server，SSH 輪詢、usage stats
├── public/
│   └── index.html        # 單頁前端，WebSocket 接收推播
├── agent-log-hook.sh     # PostToolUse hook — 記錄工具呼叫
├── agent-stop-hook.sh    # Stop hook — 記錄完成 / 錯誤
├── agent-permission-hook.sh  # PermissionRequest hook — 記錄等待確認
├── agent-session-end-hook.sh # SessionEnd hook — 記錄 session 關閉
├── agent-prompt-hook.sh  # UserPromptSubmit hook — 清除等待狀態
├── agent-logger.sh       # 手動日誌工具（選用）
├── deploy-hooks.sh       # 一鍵安裝腳本（從 setup wizard 呼叫）
└── .env.example
```

---

## 快速開始

### 1. Clone & 安裝依賴

```bash
git clone <this-repo>
cd agent-monitor
pnpm install
```

### 2. 啟動

```bash
pnpm start
```

瀏覽器會自動開啟 `http://localhost:13845`。

首次啟動會顯示 **Setup Wizard**，引導你填入 SSH 連線資訊並安裝遠端 hooks。

---

## Setup Wizard

啟動後若偵測到未設定，會自動跳出三步驟：

**Step 1 — SSH 設定**

填入遠端主機 IP / hostname、SSH 使用者名稱，可選填 port 和 key 路徑。點「測試連線」確認可以連上，server 會自動偵測並帶入 SSH key 路徑，然後儲存到 `.env`。

**Step 2 — 安裝監控腳本**

點「安裝到遠端」，server 會透過 SSH 上傳 5 個 hook 腳本到遠端機器的 `~/.claude/`，並安全地合併到 `settings.json`（自動備份現有設定，只新增不覆蓋）。

設定完成後可隨時從右上角 ⚙ 重新開啟。

---

## 遠端 Hook 說明

安裝後，Claude Code 每次執行時會自動觸發這 5 個 hook：

| Hook 檔案 | 觸發時機 | 寫入事件 |
|---|---|---|
| `agent-log-hook.sh` | 每次工具呼叫後 | `tool_use`, `progress`, `start` |
| `agent-stop-hook.sh` | Session 停止時 | `complete`, `error` |
| `agent-permission-hook.sh` | 權限確認前（等待使用者） | `waiting` |
| `agent-prompt-hook.sh` | 使用者送出訊息時 | `prompt_submit`（清除等待狀態） |
| `agent-session-end-hook.sh` | Session 結束時 | `closed`（從看板移除卡片） |

所有事件以 JSONL 格式寫入遠端 `/tmp/claude-agents/<project-name>.jsonl`，monitor 每 3 秒透過 SSH 拉取。

> **安全說明：** hooks 只寫入 log，不讀取或修改任何 Claude 設定或對話內容。全部 `exit 0`，絕不阻擋 Claude 正常執行。

---

## 環境變數

複製 `.env.example` 為 `.env`（或透過 Setup Wizard 自動產生）：

```env
SSH_HOST=your-server.com
SSH_USER=ubuntu
SSH_PORT=22
SSH_KEY_PATH=~/.ssh/id_rsa   # 不填會自動尋找 id_ed25519 / id_rsa / id_ecdsa

REMOTE_LOG_DIR=/tmp/claude-agents
POLL_INTERVAL=3000            # 毫秒
PORT=13845
```

---

## 事件格式（JSONL）

每個 agent 在遠端對應一個 `/tmp/claude-agents/<id>.jsonl`，每行一個 JSON：

```jsonl
{"time":"2025-01-01T12:00:00Z","agent":"my-project","event":"start","task":"Implement Auth","spec":"api.yaml"}
{"time":"...","agent":"my-project","event":"tool_use","tool":"write_file","input":"src/auth.ts"}
{"time":"...","agent":"my-project","event":"progress","step":"Writing handlers","total":10,"done":4}
{"time":"...","agent":"my-project","event":"waiting","reason":"是否覆蓋現有檔案？","urgent":true}
{"time":"...","agent":"my-project","event":"complete","summary":"建立 12 個檔案"}
```

---

## 手動日誌（選用）

若不透過 hooks，也可以在自己的 agent wrapper 腳本中 `source agent-logger.sh` 手動寫入：

```bash
source ./agent-logger.sh "my-project" "Implement Auth API" "api.yaml"

log_start
log_progress "Parsing spec" 10 1
log_tool "write_file" "src/auth.ts"
log_waiting "是否覆蓋現有檔案？" true
log_complete "建立了 12 個檔案"
```

---

## License

MIT
