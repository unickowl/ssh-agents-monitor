'use strict'

const { Router }    = require('express')
const { state, isDemoMode } = require('../lib/state')
const { ensureSSH } = require('../lib/ssh')

function getLogDir() {
  const raw   = process.env.REMOTE_LOG_DIR || '/tmp/claude-agents'
  const clean = raw.replace(/[^a-zA-Z0-9/_.\-~]/g, '')
  if (!clean) throw new Error('REMOTE_LOG_DIR 設定無效')
  return clean
}

// ─── Demo 假資料 ───────────────────────────────────────────────────────────────

function demoStats() {
  const now = Date.now()
  const files = [
    { name: 'agent-auth-api.jsonl',     agentId: 'agent-auth-api',     sizeBytes: 13200, modifiedAt: new Date(now - 1_800_000).toISOString() },
    { name: 'agent-user-service.jsonl', agentId: 'agent-user-service', sizeBytes: 8740,  modifiedAt: new Date(now - 7_200_000).toISOString() },
    { name: 'agent-payment-flow.jsonl', agentId: 'agent-payment-flow', sizeBytes: 21500, modifiedAt: new Date(now - 900_000).toISOString()  },
    { name: 'agent-notification.jsonl', agentId: 'agent-notification', sizeBytes: 5880,  modifiedAt: new Date(now - 86_400_000 * 3).toISOString() },
    { name: 'agent-reporting.jsonl',    agentId: 'agent-reporting',    sizeBytes: 3200,  modifiedAt: new Date(now - 86_400_000 * 5).toISOString() },
  ]
  return {
    demo:       true,
    totalFiles: files.length,
    totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    files,
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

function createRouter(broadcast) {
  const router = Router()

  // ── GET /api/logs/stats ──────────────────────────────────────────────────────
  router.get('/logs/stats', async (req, res) => {
    if (isDemoMode()) return res.json(demoStats())

    try {
      const logDir = getLogDir()
      const ssh    = await ensureSSH(broadcast)
      if (!ssh) return res.status(503).json({ error: 'SSH 未連線' })

      // 一次取得每個 .jsonl 的檔名、bytes、mtime
      const { stdout } = await ssh.execCommand(
        `find "${logDir}" -maxdepth 1 -name "*.jsonl" -printf "%f\\t%s\\t%T@\\n" 2>/dev/null || echo ""`
      )

      const files      = []
      let   totalBytes = 0

      for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue
        const [name, sizeStr, mtimeStr] = line.split('\t')
        if (!name) continue
        const sizeBytes = parseInt(sizeStr) || 0
        const mtime     = parseFloat(mtimeStr)
        totalBytes += sizeBytes
        files.push({
          name,
          agentId:    name.replace(/\.jsonl$/, ''),
          sizeBytes,
          modifiedAt: mtime ? new Date(mtime * 1000).toISOString() : null,
        })
      }

      files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
      res.json({ totalFiles: files.length, totalBytes, files })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── POST /api/logs/clear ─────────────────────────────────────────────────────
  // body: { mode: 'stale' | 'all', olderThanDays?: number }
  router.post('/logs/clear', async (req, res) => {
    if (isDemoMode()) return res.json({ ok: true, deleted: 0, demo: true })

    const mode         = req.body.mode         || 'stale'
    const olderThanDays = Math.max(0, parseInt(req.body.olderThanDays) || 1)

    if (!['stale', 'all'].includes(mode)) {
      return res.status(400).json({ error: '不支援的清除模式' })
    }

    try {
      const logDir = getLogDir()
      const ssh    = await ensureSSH(broadcast)
      if (!ssh) return res.status(503).json({ error: 'SSH 未連線' })

      let deleted = 0

      if (mode === 'all') {
        const { stdout } = await ssh.execCommand(
          `find "${logDir}" -maxdepth 1 -name "*.jsonl" | wc -l`
        )
        deleted = parseInt(stdout.trim()) || 0
        await ssh.execCommand(`find "${logDir}" -maxdepth 1 -name "*.jsonl" -delete`)

        // 清空記憶體中的 agent 狀態並廣播
        Object.keys(state.agentStates).forEach(id => delete state.agentStates[id])
      } else {
        // stale：刪除超過 N 天未更新的 log
        // 用 -mmin 而非 -mtime：-mtime +1 實際上是「>48h」，-mmin +1440 才是精確的「>24h」
        const olderThanMins = Math.round(olderThanDays * 24 * 60)
        const { stdout: listOut } = await ssh.execCommand(
          `find "${logDir}" -maxdepth 1 -name "*.jsonl" -mmin +${olderThanMins} -printf "%f\\n" 2>/dev/null || echo ""`
        )
        const toDelete = listOut.trim().split('\n').filter(Boolean)
        deleted = toDelete.length

        if (deleted > 0) {
          await ssh.execCommand(
            `find "${logDir}" -maxdepth 1 -name "*.jsonl" -mmin +${olderThanMins} -delete`
          )
          // 從記憶體移除對應的 agents
          for (const filename of toDelete) {
            const agentId = filename.replace(/\.jsonl$/, '')
            delete state.agentStates[agentId]
          }
        }
      }

      broadcast({
        type:       'update',
        agents:     state.agentStates,
        lastPoll:   state.lastPollTime,
        connection: state.connectionStatus,
        usage:      state.usageStats,
      })

      res.json({ ok: true, deleted })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}

module.exports = createRouter
