'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Window management
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  setCompactMode: (isCompact) => ipcRenderer.invoke('set-compact-mode', isCompact),
  setWindowBounds: (bounds) => ipcRenderer.invoke('set-window-bounds', bounds),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Dev tools
  testNotification: () => ipcRenderer.invoke('test-notification'),

  // Listen for events from main process (removeAllListeners first to prevent leak on HMR)
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.on('update-available', (_event, info) => callback(info))
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded')
    ipcRenderer.on('update-downloaded', (_event, info) => callback(info))
  },
  onShowNotification: (callback) => {
    ipcRenderer.removeAllListeners('show-notification')
    ipcRenderer.on('show-notification', (_event, data) => callback(data))
  },
})
