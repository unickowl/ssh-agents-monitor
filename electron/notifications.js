'use strict'

const { Notification } = require('electron')
const { state } = require('../server/lib/state')

let mainWindow = null

// Prevent garbage collection — keep references until closed/clicked
let activeNotifications = []

// Track sent notifications to avoid duplicates
const sentNotifications = new Map()

// Track previous states for change detection
let prevStates = {}

const STATUS_CONFIG = {
  waiting:  { title: '⏳ 等待確認' },
  error:    { title: '❌ 發生錯誤' },
  complete: { title: '✅ 任務完成' },
}

function showNotification(title, body) {
  const n = new Notification({ title, body })
  activeNotifications.push(n)

  const cleanup = () => {
    activeNotifications = activeNotifications.filter(x => x !== n)
  }
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
    cleanup()
  })
  n.on('close', cleanup)
  n.show()
}

function checkAndNotify() {
  const nextStates = state.agentStates || {}

  for (const [id, next] of Object.entries(nextStates)) {
    const prev = prevStates[id]

    if (prev?.status === next.status) continue

    const cfg = STATUS_CONFIG[next.status]
    if (!cfg) continue

    const dedupKey = `${id}||${next.status}`
    if (sentNotifications.has(dedupKey)) continue

    const label = next.task ? `[${next.task.slice(0, 40)}]` : `[${id}]`
    let body = label
    if (next.status === 'waiting') {
      body = `${label}\n${next.attentionReason || '等待使用者確認'}`
    } else if (next.status === 'error') {
      body = `${label}\n${next.error || next.attentionReason || '未知錯誤'}`
    } else if (next.status === 'complete') {
      body = `${label}\n${next.summary || '已完成'}`
    }

    showNotification(cfg.title, body)
    sentNotifications.set(dedupKey, true)
    console.log(`🔔 通知：${cfg.title} — ${id}`)
  }

  // Clean up dedup entries for agents whose status changed away
  for (const [key] of sentNotifications) {
    const [agentId, status] = key.split('||')
    const current = nextStates[agentId]
    if (!current || current.status !== status) {
      sentNotifications.delete(key)
    }
  }

  // Only store status per agent, not deep clone
  prevStates = Object.fromEntries(
    Object.entries(nextStates).map(([id, a]) => [id, { status: a.status }])
  )
}

let notifyTimer = null

function initNotifications(win) {
  mainWindow = win
  notifyTimer = setInterval(checkAndNotify, 2000)
}

function stopNotifications() {
  if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null }
  activeNotifications = []
}

module.exports = { initNotifications, stopNotifications }
