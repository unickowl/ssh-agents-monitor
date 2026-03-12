'use strict'

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')

// Keep a global reference to prevent garbage collection
let mainWindow = null

const isDev = process.env.NODE_ENV === 'development'

// ─── Window Bounds Persistence ──────────────────────────────────────────────

const fs = require('fs')

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'window-settings.json')
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function saveSettings(settings) {
  const current = loadSettings()
  const merged = { ...current, ...settings }
  fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2))
}

// ─── Create Window ──────────────────────────────────────────────────────────

function createWindow(serverPort) {
  const settings = loadSettings()

  const defaults = {
    width: 1200,
    height: 800,
    x: undefined,
    y: undefined,
  }

  const bounds = settings.windowBounds || defaults

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 300,
    minHeight: 400,
    title: 'Agent Monitor',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Always on top from saved state
  if (settings.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true)
  }

  // Load URL
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL(`http://localhost:${serverPort}`)
  }

  // Hide window instead of closing (minimize to tray)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // Save bounds on move/resize (debounced to avoid excessive I/O)
  let boundsTimer = null
  const saveBoundsDebounced = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isMinimized()) {
        saveSettings({ windowBounds: mainWindow.getBounds() })
      }
    }, 500)
  }
  mainWindow.on('resize', saveBoundsDebounced)
  mainWindow.on('move', saveBoundsDebounced)

  return mainWindow
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

// Keep references for cleanup
let serverInstance = null

app.on('ready', async () => {
  try {
    // Tell the server where to store .env (writable location)
    process.env.APP_DATA_DIR = app.getPath('userData')

    const { startServer } = require('../server/index')
    const result = await startServer()
    serverInstance = result
    console.log(`Express server started on port ${result.port}`)

    createWindow(result.port)

    // Initialize tray
    const { createTray } = require('./tray')
    createTray(mainWindow)

    // Initialize notifications
    const { initNotifications } = require('./notifications')
    initNotifications(mainWindow)

    // Check for updates (non-blocking)
    const { initUpdater } = require('./updater')
    initUpdater(mainWindow)
  } catch (err) {
    dialog.showErrorBox('啟動失敗', `Express server 無法啟動：\n${err.message}`)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // macOS dock click: show window
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', () => {
  app.isQuitting = true

  // Graceful cleanup
  try { require('./tray').stopTray() } catch {}
  try { require('./notifications').stopNotifications() } catch {}
  try {
    const { stopPolling } = require('../server/lib/polling')
    stopPolling()
  } catch {}
  try {
    const { state } = require('../server/lib/state')
    if (state.sshClient) { state.sshClient.dispose(); state.sshClient = null }
  } catch {}
  try {
    if (serverInstance) {
      serverInstance.wss.close()
      serverInstance.server.close()
    }
  } catch {}
})

// ─── IPC Handlers ───────────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow) mainWindow.hide()
})

ipcMain.handle('set-always-on-top', (_event, flag) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(flag)
    saveSettings({ alwaysOnTop: flag })
  }
})

ipcMain.handle('get-always-on-top', () => {
  return mainWindow ? mainWindow.isAlwaysOnTop() : false
})

ipcMain.handle('set-compact-mode', (_event, isCompact) => {
  if (!mainWindow) return
  const settings = loadSettings()

  if (isCompact) {
    // Save current (full) bounds before switching
    saveSettings({ fullBounds: mainWindow.getBounds() })
    const compactBounds = settings.compactBounds || { width: 300, height: 400 }
    mainWindow.setBounds({ ...mainWindow.getBounds(), ...compactBounds })
    // Auto pin in compact mode
    if (!mainWindow.isAlwaysOnTop()) {
      mainWindow.setAlwaysOnTop(true)
      saveSettings({ compactAutoPin: true })
    }
  } else {
    // Save compact bounds
    saveSettings({ compactBounds: mainWindow.getBounds() })
    const fullBounds = settings.fullBounds || { width: 1200, height: 800 }
    mainWindow.setBounds({ ...mainWindow.getBounds(), ...fullBounds })
    // Restore pin state
    if (settings.compactAutoPin) {
      mainWindow.setAlwaysOnTop(settings.alwaysOnTop || false)
      saveSettings({ compactAutoPin: false })
    }
  }
})

ipcMain.handle('set-window-bounds', (_event, bounds) => {
  if (mainWindow) {
    mainWindow.setBounds(bounds)
  }
})

ipcMain.handle('test-notification', () => {
  const { Notification } = require('electron')
  const statuses = ['waiting', 'error', 'complete']
  const pick = statuses[Math.floor(Math.random() * statuses.length)]
  const titles = { waiting: '⏳ 等待確認', error: '❌ 發生錯誤', complete: '✅ 任務完成' }
  const bodies = {
    waiting: '[test-agent] 是否覆蓋現有檔案？',
    error:   '[test-agent] Invalid schema: missing field',
    complete: '[test-agent] 建立了 12 個檔案',
  }

  const n = new Notification({ title: titles[pick], body: bodies[pick] })
  n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
  n.show()
  console.log(`[test-notification] ${pick}`)

  return { type: pick, title: titles[pick], body: bodies[pick] }
})

ipcMain.handle('check-for-updates', () => {
  try {
    const { checkForUpdatesManual } = require('./updater')
    checkForUpdatesManual()
  } catch {}
})

module.exports = { getMainWindow: () => mainWindow }
