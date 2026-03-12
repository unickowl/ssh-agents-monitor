'use strict'

const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')
const { state } = require('../server/lib/state')

let tray = null
let mainWindow = null

const ICONS = {
  normal: path.join(__dirname, '../resources/trayIcon.png'),
  alert:  path.join(__dirname, '../resources/trayIconAlert.png'),
}

let currentIcon = 'normal'

function getAgentCounts() {
  const agents = Object.values(state.agentStates || {})
  return {
    running:  agents.filter(a => a.status === 'running').length,
    waiting:  agents.filter(a => a.status === 'waiting').length,
    complete: agents.filter(a => a.status === 'complete').length,
    error:    agents.filter(a => a.status === 'error').length,
    total:    agents.length,
  }
}

function buildContextMenu() {
  const counts = getAgentCounts()
  const settings = loadAlwaysOnTop()

  return Menu.buildFromTemplate([
    {
      label: '顯示視窗',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: `Agent 狀態：${counts.running} 執行中 · ${counts.waiting} 等待中 · ${counts.complete} 完成`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '視窗置頂',
      type: 'checkbox',
      checked: mainWindow ? mainWindow.isAlwaysOnTop() : false,
      click: (menuItem) => {
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(menuItem.checked)
          // Persist the setting
          const fs = require('fs')
          const settingsPath = path.join(app.getPath('userData'), 'window-settings.json')
          try {
            const current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
            current.alwaysOnTop = menuItem.checked
            fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2))
          } catch {
            fs.writeFileSync(settingsPath, JSON.stringify({ alwaysOnTop: menuItem.checked }, null, 2))
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: '檢查更新',
      click: () => {
        try {
          const { checkForUpdatesManual } = require('./updater')
          checkForUpdatesManual()
        } catch {}
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])
}

function loadAlwaysOnTop() {
  const fs = require('fs')
  const settingsPath = path.join(app.getPath('userData'), 'window-settings.json')
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).alwaysOnTop || false
  } catch {
    return false
  }
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

let prevCounts = null

function updateTrayIcon() {
  if (!tray) return

  const counts = getAgentCounts()
  const hasAlert = counts.waiting > 0 || counts.error > 0
  const newIcon = hasAlert ? 'alert' : 'normal'

  if (newIcon !== currentIcon) {
    currentIcon = newIcon
    const img = nativeImage.createFromPath(ICONS[newIcon])
    tray.setImage(img.resize({ width: 18, height: 18 }))
  }

  // Only rebuild menu when counts actually change
  const countsKey = `${counts.running}:${counts.waiting}:${counts.complete}:${counts.error}`
  const prevKey = prevCounts ? `${prevCounts.running}:${prevCounts.waiting}:${prevCounts.complete}:${prevCounts.error}` : null
  if (countsKey !== prevKey) {
    prevCounts = counts
    const tooltip = `Agent Monitor — ${counts.running} 執行中 · ${counts.waiting} 等待中`
    tray.setToolTip(tooltip)
    tray.setContextMenu(buildContextMenu())
  }
}

function createTray(win) {
  mainWindow = win

  const img = nativeImage.createFromPath(ICONS.normal)
  tray = new Tray(img.resize({ width: 18, height: 18 }))

  tray.setToolTip('Agent Monitor')
  tray.setContextMenu(buildContextMenu())

  // Click to show/focus window
  tray.on('click', () => showWindow())

  // Periodically update tray icon and menu
  trayTimer = setInterval(updateTrayIcon, 3000)

  return tray
}

let trayTimer = null

function stopTray() {
  if (trayTimer) { clearInterval(trayTimer); trayTimer = null }
  if (tray) { tray.destroy(); tray = null }
}

module.exports = { createTray, updateTrayIcon, stopTray }
