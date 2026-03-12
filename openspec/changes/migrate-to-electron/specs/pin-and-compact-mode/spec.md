## ADDED Requirements

### Requirement: 視窗置頂（Always on Top）
應用 SHALL 提供視窗置頂功能，讓使用者可以將監控視窗固定在所有其他視窗之上。

#### Scenario: 開啟置頂
- **WHEN** 使用者點擊標題列的置頂按鈕（📌 圖釘圖示）
- **THEN** 視窗 SHALL 設定為 always-on-top
- **THEN** 置頂按鈕 SHALL 切換為啟用狀態（高亮/填滿）
- **THEN** 視窗 SHALL 保持在所有其他應用視窗之上

#### Scenario: 關閉置頂
- **WHEN** 使用者再次點擊置頂按鈕
- **THEN** 視窗 SHALL 取消 always-on-top
- **THEN** 置頂按鈕 SHALL 恢復為未啟用狀態

#### Scenario: 置頂狀態持久化
- **WHEN** 使用者設定置頂後關閉視窗再重新開啟
- **THEN** 視窗 SHALL 恢復上次的置頂狀態

#### Scenario: 從系統匣切換置頂
- **WHEN** 使用者從系統匣右鍵選單點擊「視窗置頂」
- **THEN** 置頂狀態 SHALL 切換（開↔關）
- **THEN** 選單項目 SHALL 顯示勾選標記表示當前狀態

### Requirement: Compact UI Mode 切換
應用 SHALL 提供 Compact UI Mode，讓使用者在一個精簡的迷你面板中監控所有 agent 狀態，不遮擋其他工作畫面。

#### Scenario: 切換至 Compact Mode
- **WHEN** 使用者點擊標題列的 compact mode 按鈕或使用鍵盤快捷鍵
- **THEN** 視窗 SHALL 縮小至 compact 尺寸（約 320px 寬、依 agent 數量動態調整高度）
- **THEN** 介面 SHALL 切換為精簡佈局
- **THEN** 視窗 SHALL 自動啟用 always-on-top（若尚未啟用）

#### Scenario: 切換回完整模式
- **WHEN** 使用者在 compact mode 中點擊展開按鈕或使用鍵盤快捷鍵
- **THEN** 視窗 SHALL 恢復至完整尺寸與位置
- **THEN** 介面 SHALL 切換回完整佈局
- **THEN** always-on-top 狀態 SHALL 恢復為切換前的設定

### Requirement: Compact Mode 精簡佈局
Compact mode SHALL 以最小面積顯示關鍵監控資訊。

#### Scenario: Compact 卡片內容
- **WHEN** 應用處於 compact mode
- **THEN** 每個 agent SHALL 顯示為一列精簡行，包含：狀態圖示（色點）、agent 名稱（截斷）、當前步驟或狀態文字
- **THEN** 隱藏以下元素：進度條百分比、工具呼叫列表、任務清單、spec 檔案標籤、時間資訊

#### Scenario: Compact 標題列
- **WHEN** 應用處於 compact mode
- **THEN** 標題列 SHALL 精簡為單行：顯示 agent 數量摘要（如 "3 running · 1 waiting"）與展開/關閉按鈕
- **THEN** 隱藏完整的 AppHeader（連線狀態、詳細統計、設定按鈕等）

#### Scenario: Compact 警示高亮
- **WHEN** 應用處於 compact mode 且有 agent 處於 waiting 或 error 狀態
- **THEN** 該 agent 行 SHALL 以明顯的顏色標記（amber 表示 waiting、red 表示 error）
- **THEN** 視窗邊框 SHALL 顯示對應的警示色光暈

### Requirement: Compact Mode 互動
Compact mode SHALL 支援快速操作以便使用者在不展開視窗的情況下處理關鍵事務。

#### Scenario: 點擊 agent 行展開詳情
- **WHEN** 使用者在 compact mode 中點擊某個 agent 行
- **THEN** 該行 SHALL 在原位展開顯示更多資訊：當前步驟、等待原因（若有）、最近一次工具呼叫
- **THEN** 再次點擊 SHALL 收回

#### Scenario: 雙擊跳轉完整模式
- **WHEN** 使用者在 compact mode 中雙擊某個 agent 行
- **THEN** 視窗 SHALL 切換回完整模式
- **THEN** 該 agent 的卡片 SHALL 在畫面中滾動到可見位置

### Requirement: 視窗尺寸與位置記憶
應用 SHALL 分別記住完整模式與 compact mode 的視窗尺寸和位置。

#### Scenario: 切換模式時恢復位置
- **WHEN** 使用者從完整模式切換到 compact mode
- **THEN** 視窗 SHALL 移動到上次 compact mode 的位置與大小（若有記憶）
- **WHEN** 使用者從 compact mode 切換回完整模式
- **THEN** 視窗 SHALL 恢復到上次完整模式的位置與大小

#### Scenario: 位置持久化
- **WHEN** 使用者關閉應用後重新開啟
- **THEN** 視窗 SHALL 恢復為上次關閉時的模式（完整/compact）與對應的位置大小
