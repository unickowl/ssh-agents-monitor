## ADDED Requirements

### Requirement: 啟動時自動檢查更新
應用 SHALL 在啟動後自動檢查 GitHub Releases 是否有新版本。

#### Scenario: 有新版本可用
- **WHEN** 應用啟動且 GitHub Releases 有更新的版本
- **THEN** 應用 SHALL 顯示通知告知使用者有新版本
- **THEN** 通知 SHALL 包含版本號與「立即更新」選項

#### Scenario: 已是最新版本
- **WHEN** 應用啟動且已是最新版本
- **THEN** 應用 SHALL 不顯示任何更新通知

#### Scenario: 無法連線檢查
- **WHEN** 應用無法連線到 GitHub Releases
- **THEN** 應用 SHALL 靜默忽略（不影響正常使用）

### Requirement: 手動檢查更新
使用者 SHALL 可以手動觸發更新檢查。

#### Scenario: 從系統匣觸發
- **WHEN** 使用者從系統匣選單點擊「檢查更新」
- **THEN** 應用 SHALL 檢查 GitHub Releases
- **THEN** SHALL 顯示結果（有更新 / 已是最新 / 檢查失敗）

### Requirement: 下載並安裝更新
應用 SHALL 支援下載更新並在使用者確認後安裝。

#### Scenario: 使用者確認更新
- **WHEN** 使用者點擊「立即更新」
- **THEN** 應用 SHALL 在背景下載更新檔案
- **THEN** 下載完成後 SHALL 提示使用者重新啟動以套用更新

#### Scenario: 使用者拒絕更新
- **WHEN** 使用者關閉更新通知或選擇「稍後」
- **THEN** 應用 SHALL 繼續正常運行
- **THEN** 下次啟動時 SHALL 再次提示
