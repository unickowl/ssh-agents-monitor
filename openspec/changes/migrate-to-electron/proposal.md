## Why

目前 agent-monitor 以 Express + Vue 3 SPA 的方式運行，使用者必須透過瀏覽器開啟 `localhost:13845` 才能監控 agent 狀態。這帶來幾個問題：需要手動啟動 server、無法使用原生桌面通知（只能用瀏覽器通知）、無法常駐在系統匣（tray）、且缺乏跨平台打包分發能力。將專案遷移到 Electron 可以將它變成一個獨立的桌面應用程式，提供更好的使用者體驗、原生系統整合、以及一鍵安裝的分發方式。

## What Changes

- **BREAKING** 移除獨立的 Express server 啟動方式，改由 Electron main process 內嵌 Express server
- 新增 Electron main process（主進程），負責建立 BrowserWindow、管理系統匣圖示、原生通知
- 將現有 Vue 3 前端作為 Electron renderer process 載入
- 新增系統匣（System Tray）常駐功能，支援最小化到匣、右鍵選單
- 以 Electron 原生通知取代 `node-notifier`，提供更穩定的跨平台桌面通知
- 新增 electron-builder 打包設定，支援 macOS (.dmg)、Windows (.exe)、Linux (.AppImage) 分發
- 新增自動更新機制（electron-updater），支援 GitHub Releases 更新
- 新增視窗置頂（Pin / Always on Top）功能，讓監控視窗常駐在最上層
- 新增 Compact UI Mode：精簡介面模式，縮小視窗為迷你監控面板，僅顯示 agent 狀態摘要與關鍵警示
- 保留原有的 SSH 輪詢、WebSocket、JSONL 解析等核心邏輯不變
- 調整 Vite 建置設定以相容 Electron 的 renderer 環境

## Capabilities

### New Capabilities

- `electron-shell`: Electron 主進程架構，包含 BrowserWindow 管理、應用生命週期、進程間通訊（IPC）
- `system-tray`: 系統匣常駐功能，包含匣圖示、右鍵選單、最小化到匣、agent 狀態指示
- `native-notifications`: 使用 Electron 原生通知 API 取代 node-notifier，提供更穩定的桌面通知體驗
- `app-packaging`: 跨平台打包與分發，包含 electron-builder 設定、應用圖示、安裝程式產生
- `auto-update`: 自動更新機制，透過 electron-updater 連接 GitHub Releases 檢查並安裝更新
- `pin-and-compact-mode`: 視窗置頂（Always on Top）與精簡 UI 模式，讓使用者以最小面積監控 agent 狀態，不遮擋其他工作視窗

### Modified Capabilities

## Impact

- **依賴變更**：新增 `electron`、`electron-builder`、`electron-updater` 等核心依賴；移除 `node-notifier`（改用 Electron 內建）；`concurrently` 不再需要
- **啟動方式**：從 `node server/index.js` 改為 `electron .`，開發模式改為 `electron` + Vite dev server
- **建置流程**：新增 electron-builder 打包步驟，產出平台特定安裝檔
- **程式碼結構**：新增 `electron/` 目錄放置 main process 程式碼；`server/` 邏輯大致保留但改為被 main process 引用
- **API 變更**：前端 WebSocket/REST 連線方式不變（仍連 localhost），但由 Electron 內部啟動的 Express 提供服務
- **Node.js 相容性**：Electron 自帶 Node.js，不再依賴系統安裝的 Node.js 版本
