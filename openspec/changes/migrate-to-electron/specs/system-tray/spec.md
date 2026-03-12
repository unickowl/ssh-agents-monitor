## ADDED Requirements

### Requirement: 系統匣圖示
應用 SHALL 在系統匣（macOS menu bar / Windows system tray / Linux 系統匣）顯示常駐圖示。

#### Scenario: 啟動時建立匣圖示
- **WHEN** 應用啟動完成
- **THEN** 系統匣 SHALL 顯示應用圖示
- **THEN** 圖示 SHALL 根據 agent 狀態變化（正常：預設圖示、有 agent 等待注意：警示圖示）

#### Scenario: 狀態指示
- **WHEN** 有任何 agent 處於 `waiting` 狀態
- **THEN** 匣圖示 SHALL 切換為警示樣式（不同顏色或帶標記的圖示）
- **WHEN** 所有 agent 離開 `waiting` 狀態
- **THEN** 匣圖示 SHALL 恢復為正常樣式

### Requirement: 系統匣右鍵選單
系統匣圖示 SHALL 提供右鍵選單，包含常用操作。

#### Scenario: 右鍵選單內容
- **WHEN** 使用者右鍵點擊系統匣圖示
- **THEN** SHALL 顯示選單包含：「顯示視窗」、「agent 狀態摘要」（顯示目前 running/waiting/complete 數量）、分隔線、「檢查更新」、「退出」

#### Scenario: 顯示視窗
- **WHEN** 使用者點擊選單中的「顯示視窗」
- **THEN** 主視窗 SHALL 顯示並聚焦

### Requirement: 最小化到匣
使用者 SHALL 可以將應用最小化到系統匣，從桌面工作列隱藏。

#### Scenario: 最小化操作
- **WHEN** 使用者關閉視窗或選擇最小化到匣
- **THEN** 視窗 SHALL 隱藏
- **THEN** 系統匣圖示 SHALL 保持顯示
- **THEN** 應用 SHALL 繼續在背景輪詢 agent 狀態

### Requirement: 點擊匣圖示恢復視窗
使用者 SHALL 可以透過點擊系統匣圖示來恢復主視窗。

#### Scenario: 單擊恢復（Windows/Linux）
- **WHEN** 使用者在 Windows 或 Linux 上單擊系統匣圖示
- **THEN** 主視窗 SHALL 顯示並聚焦

#### Scenario: 單擊恢復（macOS）
- **WHEN** 使用者在 macOS 上點擊 menu bar 圖示
- **THEN** 主視窗 SHALL 顯示並聚焦
