## 1. 專案初始設定

- [ ] 1.1 安裝 Electron 相關依賴：`electron`、`electron-builder`、`electron-updater`
- [ ] 1.2 建立 `electron/` 目錄結構：`main.js`、`preload.js`
- [ ] 1.3 建立 `resources/` 目錄，放置應用圖示（macOS .icns、Windows .ico、Linux .png、tray 圖示）
- [ ] 1.4 更新 `package.json`：設定 `main` 為 `electron/main.js`，新增 Electron 相關 scripts（`dev:electron`、`build:electron`）
- [ ] 1.5 建立 `electron-builder.yml` 打包設定檔

## 2. Electron Main Process 核心

- [ ] 2.1 實作 `electron/main.js`：app 生命週期管理（ready、window-all-closed、activate）
- [ ] 2.2 在 main process 中啟動 Express server（引用現有 `server/index.js`），等待 server 就緒後建立 BrowserWindow
- [ ] 2.3 調整 `server/index.js`：匯出啟動函式（而非直接執行），回傳 server 實例與實際 port
- [ ] 2.4 實作 BrowserWindow 建立：設定 `contextIsolation: true`、`preload.js`、適當的視窗大小與位置記憶
- [ ] 2.5 實作視窗關閉行為：點擊關閉按鈕時隱藏視窗而非退出，macOS dock 行為處理
- [ ] 2.6 實作 `electron/preload.js`：透過 `contextBridge` 暴露 `window.electronAPI`（minimizeToTray、checkForUpdates、getAppVersion）

## 3. 系統匣（System Tray）

- [ ] 3.1 實作 `electron/tray.js`：建立系統匣圖示，設定右鍵選單（顯示視窗、agent 狀態摘要、檢查更新、退出）
- [ ] 3.2 實作匣圖示狀態切換：正常圖示 vs 警示圖示（當有 agent 處於 waiting 狀態時）
- [ ] 3.3 實作點擊匣圖示恢復視窗（單擊顯示/聚焦主視窗）
- [ ] 3.4 實作 agent 狀態摘要：從共享 state 讀取 running/waiting/complete 數量顯示在選單中

## 4. 原生通知

- [ ] 4.1 實作 `electron/notifications.js`：使用 Electron Notification API 發送通知
- [ ] 4.2 整合 agent 狀態變化偵測：監聽 Express server 的狀態更新，在 waiting/complete/error 時發送通知
- [ ] 4.3 實作通知去重邏輯：記錄已發送通知的 agent+狀態組合，避免重複
- [ ] 4.4 實作通知點擊回調：點擊通知時顯示並聚焦主視窗
- [ ] 4.5 移除 `node-notifier` 依賴與相關程式碼（`server/lib/notify.js`）

## 5. 視窗置頂與 Compact UI Mode

- [ ] 5.1 在 `electron/preload.js` 新增 IPC API：`setAlwaysOnTop(bool)`、`getAlwaysOnTop()`、`setCompactMode(bool)`、`setWindowBounds(bounds)`
- [ ] 5.2 在 `electron/main.js` 實作 IPC handler：處理置頂切換、視窗大小切換、bounds 持久化（存入 userData JSON）
- [ ] 5.3 新增 `client/src/composables/useCompactMode.js`：管理 compact mode 狀態、呼叫 electronAPI 切換視窗
- [ ] 5.4 在 AppHeader 新增置頂按鈕（📌 圖釘圖示）與 compact mode 切換按鈕，綁定 IPC 呼叫
- [ ] 5.5 新增 `client/src/components/CompactView.vue`：精簡列表佈局，每個 agent 一行（狀態色點 + 名稱 + 狀態文字）
- [ ] 5.6 實作 CompactView 行展開/收回：點擊展開顯示當前步驟、等待原因、最近工具呼叫
- [ ] 5.7 實作 CompactView 雙擊跳轉：雙擊 agent 行切換回完整模式並滾動到對應卡片
- [ ] 5.8 實作 Compact 標題列：單行顯示 agent 摘要統計（"3 running · 1 waiting"）+ 展開按鈕
- [ ] 5.9 實作 compact mode 時視窗自動置頂、切回完整模式時恢復原置頂狀態
- [ ] 5.10 實作兩組視窗 bounds 記憶（完整/compact），切換模式時恢復對應位置與大小
- [ ] 5.11 在系統匣右鍵選單新增「視窗置頂」切換項（含勾選標記）
- [ ] 5.12 compact mode 下有 waiting/error agent 時，視窗邊框顯示對應警示色光暈

## 6. Vite + Electron 開發模式整合

- [ ] 6.1 調整 `client/vite.config.js`：確保建置輸出路徑正確（用於 Electron 生產模式載入）
- [ ] 6.2 實作開發模式判斷邏輯：`NODE_ENV=development` 時載入 Vite dev server URL，否則載入打包靜態檔
- [ ] 6.3 更新 `package.json` 的 `dev` script：啟動 Vite dev server + Electron（取代 concurrently 方案）
- [ ] 6.4 開發模式下自動開啟 DevTools

## 7. 自動更新

- [ ] 7.1 實作 `electron/updater.js`：使用 `electron-updater` 連接 GitHub Releases 檢查更新
- [ ] 7.2 實作啟動時自動檢查更新：有新版本時發送通知（含版本號），無法連線時靜默忽略
- [ ] 7.3 實作手動檢查更新：從系統匣選單觸發，顯示結果（有更新/已最新/失敗）
- [ ] 7.4 實作更新下載與安裝提示：背景下載完成後提示重啟

## 8. 打包與分發

- [ ] 8.1 設定 electron-builder 打包規則：包含 `server/`、`electron/`、`client/dist/`，排除開發檔案（`.env`、`.git`、`openspec/`、hook scripts）
- [ ] 8.2 設定各平台輸出格式：macOS (.dmg)、Windows (NSIS .exe)、Linux (.AppImage)
- [ ] 8.3 實作 `build:electron` script：先執行 `client build`，再執行 `electron-builder`
- [ ] 8.4 移除不再需要的依賴：`node-notifier`、`concurrently`（如有）

## 9. 整合測試與清理

- [ ] 9.1 測試完整啟動流程：Electron 啟動 → Express server 就緒 → BrowserWindow 顯示儀表板
- [ ] 9.2 測試系統匣功能：圖示顯示、右鍵選單、狀態切換、最小化/恢復
- [ ] 9.3 測試通知功能：agent 狀態變化觸發通知、點擊通知跳轉、不重複發送
- [ ] 9.4 測試置頂與 Compact Mode：置頂切換、compact 佈局顯示、視窗大小切換、bounds 記憶、展開/收回互動
- [ ] 9.5 測試 Demo 模式：無 SSH 設定時 mock agent 正常運作
- [ ] 9.6 測試打包產出：macOS .dmg 可正常安裝與執行
- [ ] 9.7 更新 README.md：說明新的安裝方式、開發指令、打包指令、置頂與 compact mode 使用方式
