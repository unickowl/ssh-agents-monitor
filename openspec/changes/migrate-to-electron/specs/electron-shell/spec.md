## ADDED Requirements

### Requirement: Electron main process 啟動 Express server
應用啟動時，Electron main process SHALL 在內部啟動現有的 Express server（含 WebSocket），並在 server 就緒後建立 BrowserWindow 載入前端頁面。

#### Scenario: 正常啟動
- **WHEN** 使用者啟動 Electron 應用
- **THEN** main process 啟動 Express server 於可用的本地端口
- **THEN** 建立 BrowserWindow 載入 `http://localhost:<PORT>` 或打包後的 `index.html`
- **THEN** 前端正常顯示 agent 監控儀表板

#### Scenario: Express server 啟動失敗
- **WHEN** Express server 無法啟動（端口被佔用等）
- **THEN** 應用 SHALL 顯示錯誤對話框告知使用者
- **THEN** 應用 SHALL 允許重試或退出

### Requirement: BrowserWindow 視窗管理
應用 SHALL 建立單一 BrowserWindow，支援基本視窗操作（最小化、最大化、關閉）。關閉視窗時 SHALL 最小化到系統匣而非退出應用。

#### Scenario: 關閉視窗行為
- **WHEN** 使用者點擊視窗關閉按鈕
- **THEN** 視窗 SHALL 隱藏（而非銷毀）
- **THEN** 應用 SHALL 繼續在系統匣運行

#### Scenario: 恢復視窗
- **WHEN** 應用視窗已隱藏且使用者點擊系統匣圖示
- **THEN** 視窗 SHALL 重新顯示並聚焦

### Requirement: 安全的 Preload Script
應用 SHALL 使用 `contextIsolation: true` 並透過 `preload.js` 的 `contextBridge.exposeInMainWorld` 暴露有限的 API 給 renderer process。

#### Scenario: Renderer 無法直接存取 Node.js
- **WHEN** renderer process 嘗試存取 `require`、`process`、`fs` 等 Node.js API
- **THEN** 存取 SHALL 被拒絕（undefined）

#### Scenario: Preload 暴露的 API
- **WHEN** renderer process 存取 `window.electronAPI`
- **THEN** SHALL 可使用 `minimizeToTray()`、`checkForUpdates()`、`getAppVersion()` 等預定義方法

### Requirement: 應用生命週期管理
應用 SHALL 正確處理生命週期事件，包含啟動、關閉、以及 macOS 的 dock 行為。

#### Scenario: macOS dock 行為
- **WHEN** 在 macOS 上所有視窗關閉
- **THEN** 應用 SHALL 不退出（繼續在背景運行）
- **WHEN** 使用者點擊 dock 圖示
- **THEN** SHALL 重新顯示主視窗

#### Scenario: 完全退出
- **WHEN** 使用者從系統匣選單選擇「退出」
- **THEN** 應用 SHALL 關閉 Express server、斷開所有 SSH 連線、銷毀視窗並退出進程

### Requirement: 開發模式支援
開發模式下，Electron SHALL 載入 Vite dev server 的 URL 以支援 HMR。

#### Scenario: 開發模式啟動
- **WHEN** 應用以開發模式啟動（`NODE_ENV=development`）
- **THEN** BrowserWindow SHALL 載入 `http://localhost:5173`（Vite dev server）
- **THEN** DevTools SHALL 自動開啟

#### Scenario: 生產模式啟動
- **WHEN** 應用以生產模式啟動
- **THEN** BrowserWindow SHALL 載入打包後的靜態 HTML 檔案
