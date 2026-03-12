import { ref, onUnmounted } from 'vue'
import { useStore } from './useStore'
import { useNotifications } from './useNotifications'

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]

export function useWebSocket() {
  const { applyAgents, setConnection, setUsage, setPollTime, setLogDir, agents } = useStore()
  const { detectAndNotify } = useNotifications()

  const ws = ref(null)
  const reconnectAttempt = ref(0)
  let reconnectTimer = null

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${location.host}/ws`)
    ws.value = socket

    socket.onopen = () => {
      reconnectAttempt.value = 0
    }

    socket.onmessage = ({ data }) => {
      let msg
      try { msg = JSON.parse(data) } catch { return }

      if (msg.type === 'connection') {
        setConnection(msg.status)
        return
      }

      if (msg.type === 'init' || msg.type === 'update') {
        const prev = { ...agents }           // snapshot before applying
        if (msg.agents)     applyAgents(msg.agents)
        if (msg.usage)      setUsage(msg.usage)
        if (msg.lastPoll)   setPollTime(msg.lastPoll)   // server sends lastPoll, not time
        if (msg.logDir)     setLogDir(msg.logDir)
        if (msg.connection) setConnection(msg.connection) // init 帶的連線狀態
        detectAndNotify(prev, { ...agents })
      }
    }

    socket.onclose = () => {
      setConnection('disconnected')
      ws.value = null
      scheduleReconnect()
    }

    socket.onerror = () => {
      setConnection('error')
    }
  }

  function scheduleReconnect() {
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.value, RECONNECT_DELAYS.length - 1)]
    reconnectAttempt.value++
    reconnectTimer = setTimeout(connect, delay)
  }

  function send(payload) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(payload))
    }
  }

  function disconnect() {
    clearTimeout(reconnectTimer)
    ws.value?.close()
    ws.value = null
  }

  onUnmounted(disconnect)

  return { connect, disconnect, send }
}
