## Context

agent-monitor 目前是一個 Express + Vue 3 的 web 應用，使用者需要在終端機啟動 server 後透過瀏覽器存取。核心功能包括 SSH 遠端輪詢 agent 日誌、WebSocket 即時推送、JSONL 解析、以及桌面通知。前端使用 Vite 建置，後端使用 Express + node-ssh。

現有架構的限制：
- 需要使用者自行安裝 Node.js 並手動啟動
- 桌面通知依賴 `node-notifier`（各平台表現不一）
- 無法常駐系統匣、無法最小化到背景
- 無法打包成可安裝的桌面應用

## Goals / Non-Goals

**Goals:**
- 將應用封裝為獨立 Electron 桌面應用，無需使用者安裝 Node.js
- 保留所有現有功能（SSH 輪詢、WebSocket、agent 監控、Setup Wizard）
- 新增系統匣常駐、原生通知、視窗管理等桌面原生體驗
- 支援 macOS / Windows / Linux 跨平台打包分發
- 提供自動更新機制
- 支援視窗置頂（Always on Top）與 Compact UI Mode，讓使用者以最小面積常駐監控

**Non-Goals:**
- 不重寫前端 UI（繼續使用 Vue 3 + TailwindCSS）
- 不改變 SSH 輪詢與 JSONL 解析的核心邏輯
- 不支援 web 瀏覽器存取模式（純桌面應用）
- 不實作多視窗或多實例功能
- 不實作應用內終端機或 SSH shell

## Decisions

### 1. Electron 進程架構

**選擇：** Main process 內嵌 Express server，Renderer process 載入 Vue 3 SPA

**理由：** 現有 Express server 已經處理 SSH 連線、WebSocket 廣播、REST API 等邏輯。直接在 Electron main process 中啟動 Express，前端仍透過 `http://localhost:PORT` 載入，可最大程度重用現有程式碼。

**替代方案考慮：**
- 純 IPC 方案（移除 Express，全部改用 Electron IPC）：改動量太大，且 WebSocket 即時推送的邏輯已經很成熟
- 分離進程方案（Express 作為獨立 child process）：增加複雜度，且 Electron main process 已經是 Node.js 環境

### 2. 專案結構

**選擇：** 新增 `electron/` 目錄，保留既有 `server/` 和 `client/` 結構

```
agent-monitor/
├── electron/
│   ├── main.js          # Electron 主進程入口
│   ├── preload.js       # 安全的 preload script
│   ├── tray.js          # 系統匣管理
│   ├── notifications.js # 原生通知管理
│   └── updater.js       # 自動更新邏輯
├── server/              # 保持不變，被 main.js require
├── client/              # 保持不變，Vite 建置後載入
├── resources/           # 應用圖示、匣圖示等資源
└── electron-builder.yml # 打包設定
```

**理由：** 最小化對現有程式碼的改動。`electron/main.js` 作為新入口，啟動 Express server 後建立 BrowserWindow 載入前端。

### 3. 開發模式

**選擇：** 使用 `electron-vite` 或手動整合 Electron + Vite dev server

**方案：**
- 開發時：Electron 啟動 → main process 啟動 Express(含 WebSocket) → BrowserWindow 載入 Vite dev server (`http://localhost:5173`)
- 生產時：Electron 啟動 → main process 啟動 Express → BrowserWindow 載入打包後的 `client/dist/index.html`

**理由：** 開發時保留 Vite HMR，生產時載入靜態檔案，兩種模式都保留 Express server 提供 API 與 WebSocket。

### 4. 通知方案

**選擇：** 使用 Electron 的 `Notification` API 取代 `node-notifier`

**理由：** Electron 內建的 Notification API 在各平台上表現更一致，且不需要額外依賴。可以在 main process 監聽 Express/WebSocket 的 agent 狀態變化，直接發送原生通知。

### 5. 打包工具

**選擇：** electron-builder

**替代方案考慮：**
- `electron-forge`：功能完整但設定較複雜，對既有專案整合成本較高
- `electron-packager`：只打包不產生安裝程式，功能不足

**理由：** electron-builder 是最成熟的打包方案，支援 macOS (.dmg)、Windows (NSIS installer)、Linux (.AppImage/.deb)，且內建 auto-update 整合。

### 6. 自動更新

**選擇：** `electron-updater` + GitHub Releases

**理由：** 不需要自建更新伺服器，直接利用 GitHub Releases 發布更新。electron-updater 與 electron-builder 無縫整合。

### 8. 視窗置頂與 Compact UI Mode

**選擇：** Electron `BrowserWindow.setAlwaysOnTop()` + Vue 前端的 Compact Layout 元件

**架構：**
- **置頂控制**：透過 IPC 從 renderer 呼叫 main process 的 `setAlwaysOnTop()`。preload 暴露 `window.electronAPI.setAlwaysOnTop(bool)` 與 `window.electronAPI.getAlwaysOnTop()`。
- **Compact Mode**：前端新增 `CompactView.vue` 元件與 `useCompactMode` composable。切換時透過 IPC 通知 main process 調整視窗大小。
- **視窗尺寸管理**：main process 維護兩組視窗 bounds（完整模式 + compact 模式），切換時互相恢復。使用 `electron-store` 或簡單 JSON 檔持久化到 `userData`。
- **Compact Layout**：精簡為單欄列表，每個 agent 僅佔一行（狀態色點 + 名稱 + 簡短狀態文字）。點擊可展開更多資訊。視窗寬度固定約 320px，高度依 agent 數量動態調整（設上限避免超出螢幕）。

**替代方案考慮：**
- 使用獨立的 mini-window（第二個 BrowserWindow）：增加視窗管理複雜度，且需要同步狀態
- 使用 CSS media query 自動切換：無法由使用者主動控制，且無法精確調整視窗大小

**理由：** 單一視窗 + 前端元件切換是最簡潔的方案。IPC 通訊負責視窗屬性（大小、置頂），Vue 元件負責 UI 佈局，職責清晰。

### 7. 安全性

**選擇：** 啟用 `contextIsolation`、使用 `preload.js` 暴露有限 API

**理由：** 遵循 Electron 安全最佳實踐。Renderer process 不直接存取 Node.js API，透過 preload script 的 `contextBridge` 暴露必要的 IPC 通道（如通知設定、視窗控制、更新檢查）。

## Risks / Trade-offs

- **應用體積增大** → Electron 打包後約 150-200MB。可接受，因為目標是桌面應用而非輕量工具。
- **記憶體佔用增加** → Electron 的 Chromium 引擎會佔用較多記憶體。透過單一 BrowserWindow + 合理的 renderer 記憶體管理來控制。
- **失去 web 存取能力** → 使用者無法再從其他裝置的瀏覽器存取。這是有意的取捨——桌面常駐體驗更重要。
- **SSH key 存取** → Electron 應用需要存取使用者的 SSH key。沿用現有的 `SSH_KEY_PATH` 設定，不額外處理。
- **macOS 程式碼簽章** → 未簽章的應用在 macOS 上會被 Gatekeeper 攔截。初期可透過 `xattr -d` 繞過，後續考慮 Apple Developer 簽章。
- **Vite + Electron 整合複雜度** → Vite 的 dev server 與 Electron 的進程模型需要協調。使用成熟的整合模式（main process 啟動後載入 dev server URL）降低風險。
