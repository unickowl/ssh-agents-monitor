require('dotenv').config()

const express = require('express')
const { WebSocketServer } = require('ws')
const http   = require('http')
const path   = require('path')
const { exec } = require('child_process')

const { state, isDemoMode }  = require('./lib/state')
const { startPolling, generateDemoUsage, POLL_INTERVAL } = require('./lib/polling')
const createAgentsRouter     = require('./routes/agents')
const createConfigRouter     = require('./routes/config')

const PORT = process.env.PORT || 13845

// ─── HTTP + WebSocket ─────────────────────────────────────────────────────────

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server })

app.use(express.static(path.join(__dirname, '../public')))
app.use(express.json())

// ─── Broadcast 給所有 WS 客戶端 ───────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data)
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
}

// ─── WebSocket：初始握手 ──────────────────────────────────────────────────────

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type:       'init',
    agents:     state.agentStates,
    lastPoll:   state.lastPollTime,
    connection: state.connectionStatus,
    configured: !isDemoMode(),
    demoMode:   isDemoMode(),
    usage:      isDemoMode() ? generateDemoUsage() : state.usageStats,
  }))
})

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api', createAgentsRouter(broadcast))
app.use('/api', createConfigRouter(broadcast))

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`
  console.log(`\n🚀 Agent Monitor running at ${url}`)

  if (isDemoMode()) {
    console.log('⚙️  尚未設定 SSH，請開啟瀏覽器完成初始設定')
  } else {
    console.log(`🔗 Monitoring SSH: ${process.env.SSH_USER}@${process.env.SSH_HOST}`)
    console.log(`📁 Remote log dir: ${process.env.REMOTE_LOG_DIR || '/tmp/claude-agents'}`)
  }
  console.log(`⏱  Polling every ${POLL_INTERVAL}ms\n`)

  startPolling(broadcast)

  if (!process.env.NO_BROWSER) {
    const cmd = process.platform === 'darwin' ? `open "${url}"`
              : process.platform === 'win32'  ? `start "" "${url}"`
              : `xdg-open "${url}"`
    setTimeout(() => exec(cmd, err => {
      if (err) console.log(`請手動開啟瀏覽器：${url}`)
    }), 800)
  }
})
