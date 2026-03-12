## ADDED Requirements

### Requirement: 使用 Electron 原生通知
應用 SHALL 使用 Electron 內建的 `Notification` API 發送桌面通知，取代現有的 `node-notifier` 套件。

#### Scenario: Agent 進入等待狀態
- **WHEN** 任何 agent 狀態從非 `waiting` 變為 `waiting`
- **THEN** 應用 SHALL 發送桌面通知，標題包含 agent 名稱，內容包含等待原因

#### Scenario: Agent 完成任務
- **WHEN** 任何 agent 狀態變為 `complete`
- **THEN** 應用 SHALL 發送桌面通知，告知該 agent 已完成任務

#### Scenario: Agent 發生錯誤
- **WHEN** 任何 agent 狀態變為 `error`
- **THEN** 應用 SHALL 發送桌面通知，告知該 agent 發生錯誤

### Requirement: 通知點擊跳轉
使用者 SHALL 可以點擊通知來聚焦應用視窗。

#### Scenario: 點擊通知
- **WHEN** 使用者點擊桌面通知
- **THEN** 應用主視窗 SHALL 顯示並聚焦
- **THEN** 相關的 agent 卡片 SHALL 在畫面中高亮或滾動到可見位置

### Requirement: 通知不重複發送
應用 SHALL 避免對同一個 agent 的同一個狀態重複發送通知。

#### Scenario: 避免重複通知
- **WHEN** agent 已經處於 `waiting` 狀態且已發送過通知
- **THEN** 應用 SHALL 不再為同一 agent 的同一 `waiting` 事件發送通知
- **WHEN** agent 離開 `waiting` 後再次進入 `waiting`
- **THEN** 應用 SHALL 發送新的通知
