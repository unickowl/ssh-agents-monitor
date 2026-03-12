'use strict'

const path = require('path')
const os   = require('os')
const { state, isDemoMode } = require('./state')
const { ensureSSH }         = require('./ssh')
const { buildAgentState }   = require('./parser')
const { detectAndNotify }   = require('./notify')

const POLL_INTERVAL  = parseInt(process.env.POLL_INTERVAL || '3000')
const REMOTE_LOG_DIR = process.env.REMOTE_LOG_DIR || '/tmp/claude-agents'

// ─── Demo mode ────────────────────────────────────────────────────────────────

function generateDemoStates() {
  const now = new Date()
  const agents = [
    { id: 'agent-auth-api',       task: 'Implement Auth API endpoints',    spec: 'auth-openapi.yaml',          status: 'running',  progress: 65,  step: 'Writing JWT middleware' },
    { id: 'agent-user-service',   task: 'Create User CRUD service',        spec: 'users-openapi.yaml',         status: 'waiting',  progress: 40,  step: 'Schema validation', attention: 'Need approval: found existing user table, should I migrate or overwrite?', urgent: true },
    { id: 'agent-payment-flow',   task: 'Build payment flow handlers',     spec: 'payments-openapi.yaml',      status: 'running',  progress: 82,  step: 'Writing Stripe webhook handler' },
    { id: 'agent-notification',   task: 'Setup notification service',      spec: 'notifications-openapi.yaml', status: 'complete', progress: 100, summary: 'Created 8 files, 340 lines of code', staleHoursAgo: 5 },
    { id: 'agent-reporting',      task: 'Generate reporting module',       spec: 'reports-openapi.yaml',       status: 'error',    progress: 25,  step: 'Parsing spec', error: 'Invalid OpenAPI 3.0 schema: missing required field "info"' },
  ]

  const states = {}
  for (const a of agents) {
    states[a.id] = {
      id: a.id,
      task: a.task,
      spec: a.spec,
      status: a.status,
      progress: a.progress,
      currentStep: a.step || '',
      needsAttention: a.status === 'waiting' || a.status === 'error',
      attentionReason: a.attention || a.error || '',
      urgent: !!a.urgent,
      error: a.error || null,
      summary: a.summary || '',
      startTime: new Date(now - Math.random() * 3_600_000).toISOString(),
      lastActivity: new Date(now - Math.random() * 60_000).toISOString(),
      isStale: !!a.staleHoursAgo,
      fileModifiedAt: a.staleHoursAgo
        ? new Date(now - a.staleHoursAgo * 3_600_000).toISOString()
        : new Date(now - Math.random() * 60_000).toISOString(),
      recentTools: a.status === 'running' ? [
        { tool: 'write_file', input: `src/handlers/${a.id}.ts`, time: new Date(now - 5_000).toISOString() },
        { tool: 'read_file',  input: a.spec,                    time: new Date(now - 15_000).toISOString() },
      ] : [],
      events: [],
    }
    if (a.status === 'running' && Math.random() > 0.5) {
      states[a.id].progress = Math.min(99, a.progress + Math.floor(Math.random() * 3))
    }
  }
  return states
}

function generateDemoUsage() {
  return {
    inputTokens:      1_284_300,
    outputTokens:     247_800,
    cacheWriteTokens: 312_400,
    cacheReadTokens:  1_108_900,
    totalTokens:      1_532_100,
    sessions:         7,
    messages:         143,
    fetchedAt:        new Date().toISOString(),
    demo:             true,
  }
}

// ─── Usage stats (via SSH + Python) ──────────────────────────────────────────

const USAGE_INTERVAL_MS = 60_000

const USAGE_PYTHON = `
import json, os, time
from pathlib import Path

home = Path.home()
proj = home / '.claude' / 'projects'
cutoff = time.time() - 86400

totals = dict(input=0, output=0, cache_write=0, cache_read=0, sessions=set(), messages=0)

if proj.exists():
  for f in proj.rglob('*.jsonl'):
    try:
      if f.stat().st_mtime < cutoff: continue
      with open(f, errors='replace') as fh:
        for line in fh:
          try:
            o = json.loads(line)
            if o.get('type') == 'assistant':
              u = (o.get('message') or {}).get('usage') or {}
              if u:
                totals['input']       += u.get('input_tokens', 0)
                totals['output']      += u.get('output_tokens', 0)
                totals['cache_write'] += u.get('cache_creation_input_tokens', 0)
                totals['cache_read']  += u.get('cache_read_input_tokens', 0)
                totals['messages']    += 1
                sid = o.get('sessionId','')
                if sid: totals['sessions'].add(sid)
          except: pass
    except: pass

totals['sessions'] = len(totals['sessions'])
print(json.dumps(totals))
`.trim()

async function fetchUsageStats(broadcast) {
  const now = Date.now()
  if (now - state.usageLastFetch < USAGE_INTERVAL_MS) return state.usageStats

  const ssh = await ensureSSH(broadcast)
  if (!ssh) return state.usageStats

  try {
    const b64 = Buffer.from(USAGE_PYTHON).toString('base64')
    const { stdout } = await ssh.execCommand(
      `echo '${b64}' | base64 -d | python3 2>/dev/null || echo "{}"`
    )
    const raw = JSON.parse(stdout.trim() || '{}')
    state.usageStats = {
      inputTokens:      raw.input       || 0,
      outputTokens:     raw.output      || 0,
      cacheWriteTokens: raw.cache_write || 0,
      cacheReadTokens:  raw.cache_read  || 0,
      totalTokens:      (raw.input || 0) + (raw.output || 0),
      sessions:         raw.sessions    || 0,
      messages:         raw.messages    || 0,
      fetchedAt:        new Date().toISOString(),
    }
    state.usageLastFetch = now
    console.log(`📊 Usage: in=${raw.input} out=${raw.output} sessions=${raw.sessions}`)
  } catch (err) {
    console.error('Usage fetch error:', err.message)
  }

  return state.usageStats
}

// ─── Remote log fetching ──────────────────────────────────────────────────────

async function fetchRemoteLogs(broadcast) {
  const ssh = await ensureSSH(broadcast)
  if (!ssh) return null

  try {
    const [tailResult, mtimeResult] = await Promise.all([
      ssh.execCommand(`tail -n 200 --verbose ${REMOTE_LOG_DIR}/*.jsonl 2>/dev/null || echo ""`),
      ssh.execCommand(`find ${REMOTE_LOG_DIR} -name "*.jsonl" -printf "%f %T@\n" 2>/dev/null || echo ""`),
    ])

    // mtime 對照表：{ "agent-id.jsonl": unixTimestamp }
    const mtimeMap = {}
    for (const line of (mtimeResult.stdout || '').split('\n')) {
      const m = line.trim().match(/^(.+\.jsonl)\s+([\d.]+)$/)
      if (m) mtimeMap[m[1]] = parseFloat(m[2])
    }

    if (!tailResult.stdout.trim()) return {}

    const newStates = {}
    let currentFile  = null
    let currentLines = []

    for (const line of tailResult.stdout.split('\n')) {
      const headerMatch = line.match(/^==> (.+\.jsonl) <==/)
      if (headerMatch) {
        if (currentFile && currentLines.length > 0) {
          const agentId = path.basename(currentFile, '.jsonl')
          const mtime   = mtimeMap[path.basename(currentFile)]
          newStates[agentId] = buildAgentState(agentId, currentLines, mtime, state.dismissedAt)
        }
        currentFile  = headerMatch[1]
        currentLines = []
      } else if (line.trim() && currentFile) {
        currentLines.push(line)
      }
    }
    // 最後一個檔案
    if (currentFile && currentLines.length > 0) {
      const agentId = path.basename(currentFile, '.jsonl')
      const mtime   = mtimeMap[path.basename(currentFile)]
      newStates[agentId] = buildAgentState(agentId, currentLines, mtime, state.dismissedAt)
    }

    return newStates
  } catch (err) {
    console.error('Poll error:', err.message)
    if (!ssh.isConnected()) {
      state.sshClient = null
      state.connectionStatus = 'disconnected'
    }
    return null
  }
}

// ─── Polling loop ─────────────────────────────────────────────────────────────

async function poll(broadcast) {
  let newStates

  if (isDemoMode()) {
    newStates = generateDemoStates()
    state.connectionStatus = 'demo'
  } else {
    newStates = await fetchRemoteLogs(broadcast)
  }

  if (newStates) {
    detectAndNotify(state.agentStates, newStates)
    state.agentStates = newStates
    state.lastPollTime = new Date().toISOString()
    const usage = isDemoMode()
      ? generateDemoUsage()
      : await fetchUsageStats(broadcast)
    broadcast({
      type: 'update',
      agents: state.agentStates,
      lastPoll: state.lastPollTime,
      connection: state.connectionStatus,
      usage,
    })
  }
}

function startPolling(broadcast) {
  poll(broadcast)
  setInterval(() => poll(broadcast), POLL_INTERVAL)
}

module.exports = {
  startPolling,
  poll,
  fetchRemoteLogs,
  fetchUsageStats,
  generateDemoStates,
  generateDemoUsage,
  POLL_INTERVAL,
}
