'use strict'

const notifier = require('node-notifier')

const NOTIFY_ENABLED = process.env.NOTIFICATIONS !== 'false'

const NOTIFY_TRANSITIONS = {
  waiting:  { title: '⏳ 等待確認', urgentTitle: '‼️ 需要確認' },
  error:    { title: '❌ 發生錯誤',  urgentTitle: '❌ 發生錯誤' },
  complete: { title: '✅ 任務完成',  urgentTitle: '✅ 任務完成' },
}

function notify(title, message, urgent = false) {
  if (!NOTIFY_ENABLED) return
  notifier.notify({ title, message, sound: urgent, timeout: 8 })
}

function detectAndNotify(prevStates, nextStates) {
  for (const [id, next] of Object.entries(nextStates)) {
    const prev = prevStates[id]
    if (prev?.status === next.status) continue

    const cfg = NOTIFY_TRANSITIONS[next.status]
    if (!cfg) continue

    const label = next.task ? `[${next.task.slice(0, 40)}]` : `[${id}]`
    let message = label

    if (next.status === 'waiting') {
      message = `${label}\n${next.attentionReason || '等待使用者確認'}`
    } else if (next.status === 'error') {
      message = `${label}\n${next.error || next.attentionReason || '未知錯誤'}`
    } else if (next.status === 'complete') {
      message = `${label}\n${next.summary || '已完成'}`
    }

    const title = next.urgent ? cfg.urgentTitle : cfg.title
    notify(title, message, next.urgent)
    console.log(`🔔 通知：${title} — ${id}`)
  }
}

module.exports = { notify, detectAndNotify }
