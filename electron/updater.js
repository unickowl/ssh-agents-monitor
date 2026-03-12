'use strict'

const { autoUpdater } = require('electron-updater')
const { dialog, Notification } = require('electron')

let mainWindow = null

function initUpdater(win) {
  mainWindow = win

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const notification = new Notification({
      title: '有新版本可用',
      body: `Agent Monitor v${info.version} 已發布，點擊下載更新`,
    })
    notification.on('click', () => {
      autoUpdater.downloadUpdate()
    })
    notification.show()

    if (mainWindow) {
      mainWindow.webContents.send('update-available', info)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info)
    }

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已下載',
      message: `Agent Monitor v${info.version} 已下載完成，是否立即重新啟動以套用更新？`,
      buttons: ['立即重啟', '稍後'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
  })

  // Check for updates silently on startup
  autoUpdater.checkForUpdates().catch(() => {
    // Silently ignore - network might be unavailable
  })
}

function checkForUpdatesManual() {
  const { app } = require('electron')
  autoUpdater.checkForUpdates().then((result) => {
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      new Notification({
        title: '已是最新版本',
        body: `Agent Monitor v${app.getVersion()} 已是最新版本`,
      }).show()
    }
    // If there IS an update, the 'update-available' event handler will show it
  }).catch((err) => {
    new Notification({
      title: '檢查更新失敗',
      body: err.message || '無法連線到更新伺服器',
    }).show()
  })
}

module.exports = { initUpdater, checkForUpdatesManual }
