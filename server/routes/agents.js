'use strict'

const { Router } = require('express')
const { state }  = require('../lib/state')

// broadcast 在 index.js 建立後透過 createRouter(broadcast) 注入

function createRouter(broadcast) {
  const router = Router()

  // 目前所有 agent 狀態快照
  router.get('/agents', (req, res) => {
    res.json({
      agents: state.agentStates,
      lastPoll: state.lastPollTime,
      connection: state.connectionStatus,
    })
  })

  // 壓下某個 agent 的 attention 標記
  router.post('/agents/:id/dismiss', (req, res) => {
    const agent = state.agentStates[req.params.id]
    if (!agent) return res.status(404).json({ error: 'Agent not found' })

    agent.needsAttention  = false
    agent.attentionReason = ''
    agent.urgent          = false
    state.dismissedAt[req.params.id] = new Date().toISOString()

    broadcast({
      type: 'update',
      agents: state.agentStates,
      lastPoll: state.lastPollTime,
      connection: state.connectionStatus,
    })
    res.json({ ok: true })
  })

  return router
}

module.exports = createRouter
