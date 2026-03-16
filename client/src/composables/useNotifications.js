const TRANSITIONS = {
  waiting:  { title: '⏳ 等待確認',  urgentTitle: '‼️ 需要確認' },
  error:    { title: '❌ 發生錯誤',   urgentTitle: '❌ 發生錯誤' },
  complete: { title: '✅ 任務完成',   urgentTitle: '✅ 任務完成' },
}

let permissionAsked = false

export function useNotifications() {
  async function requestPermission() {
    if (permissionAsked) return
    permissionAsked = true
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  function send(title, body) {
    // In Electron, notifications are handled by the main process — skip to avoid duplicates
    if ('electronAPI' in window) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    new Notification(title, { body, icon: '/favicon.ico' })
  }

  function detectAndNotify(prev, next) {
    for (const [id, nextAgent] of Object.entries(next)) {
      const prevStatus = prev[id]?.status
      const nextStatus = nextAgent.status
      if (prevStatus === nextStatus) continue
      const cfg = TRANSITIONS[nextStatus]
      if (!cfg) continue

      const label = nextAgent.task ? `[${nextAgent.task.slice(0, 40)}]` : `[${id}]`
      let body = label
      if (nextStatus === 'waiting')  body += `\n${nextAgent.attentionReason || '等待使用者確認'}`
      if (nextStatus === 'error')    body += `\n${nextAgent.error || nextAgent.attentionReason || '未知錯誤'}`
      if (nextStatus === 'complete') body += `\n${nextAgent.summary || '已完成'}`

      const title = nextAgent.urgent ? cfg.urgentTitle : cfg.title
      send(title, body)
    }
  }

  return { requestPermission, send, detectAndNotify }
}
