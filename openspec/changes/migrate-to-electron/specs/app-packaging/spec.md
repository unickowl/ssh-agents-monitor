## ADDED Requirements

### Requirement: 跨平台打包
應用 SHALL 可以透過 electron-builder 打包為 macOS、Windows、Linux 的安裝檔。

#### Scenario: macOS 打包
- **WHEN** 執行 macOS 打包指令
- **THEN** SHALL 產生 `.dmg` 安裝映像檔
- **THEN** 安裝檔 SHALL 包含完整的 Electron runtime、server 程式碼、前端靜態檔案

#### Scenario: Windows 打包
- **WHEN** 執行 Windows 打包指令
- **THEN** SHALL 產生 NSIS 安裝程式（`.exe`）

#### Scenario: Linux 打包
- **WHEN** 執行 Linux 打包指令
- **THEN** SHALL 產生 `.AppImage` 檔案

### Requirement: 應用圖示
打包後的應用 SHALL 包含自訂應用圖示，支援各平台的圖示格式。

#### Scenario: 各平台圖示格式
- **WHEN** 應用被打包
- **THEN** macOS SHALL 使用 `.icns` 格式圖示
- **THEN** Windows SHALL 使用 `.ico` 格式圖示
- **THEN** Linux SHALL 使用 `.png` 格式圖示

### Requirement: 打包排除不必要檔案
打包 SHALL 排除開發用檔案，以控制安裝檔體積。

#### Scenario: 排除檔案
- **WHEN** 應用被打包
- **THEN** SHALL 排除 `node_modules` 中的開發依賴
- **THEN** SHALL 排除 `.env`、`.git`、`openspec/`、hook shell scripts 等非必要檔案
- **THEN** SHALL 包含 `server/`、`client/dist/`（或 `public/`）、`electron/`、production dependencies

### Requirement: 建置腳本
package.json SHALL 提供便捷的打包指令。

#### Scenario: 打包指令
- **WHEN** 開發者執行打包指令
- **THEN** `pnpm run build:electron` SHALL 先建置 Vue 前端，再執行 electron-builder 打包
- **THEN** 產出檔案 SHALL 存放在 `dist-electron/` 目錄
