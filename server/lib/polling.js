'use strict'

const path = require('path')
const os   = require('os')
const { state, isDemoMode } = require('./state')
const { ensureSSH }         = require('./ssh')
const { buildAgentState }   = require('./parser')
const { detectAndNotify }   = require('./notify')

const POLL_INTERVAL  = parseInt(process.env.POLL_INTERVAL || '3000')

// Sanitize shell path to prevent command injection
function safePath(p) {
  const clean = (p || '').replace(/[^a-zA-Z0-9/_.\-~]/g, '')
  if (!clean) throw new Error('Invalid path')
  return clean
}

function getRemoteLogDir() {
  return safePath(process.env.REMOTE_LOG_DIR || '/tmp/claude-agents')
}

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
  const plan  = getPlan()
  const limit = getTokenLimit()
  const inputTokens      = 28_400
  const outputTokens     = 5_200
  const cacheWriteTokens = 6_900
  const cacheReadTokens  = 24_800
  const totalTokens      = inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens
  const pct              = Math.min(100, Math.round(totalTokens / limit * 100))
  // Simulate oldest message 3 hours ago → resets in ~2h
  const resetAt             = new Date(Date.now() + 2 * 3600_000).toISOString()
  const burnRate            = 2233
  const costRate            = 0.0028
  const costUsd             = 44.49
  const projectedRunoutAt   = new Date(Date.now() + 4.2 * 3600_000).toISOString()
  const models              = { sonnet: 97, opus: 3 }
  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens,
    limit,
    plan,
    pct,
    sessions:  3,
    messages:  47,
    windowHrs: 5,
    resetAt,
    costUsd,
    burnRate,
    costRate,
    projectedRunoutAt,
    models,
    limitSrc:  'p90',
    fetchedAt: new Date().toISOString(),
    demo:      true,
  }
}

// ─── Usage stats (via SSH + Python) ──────────────────────────────────────────

const USAGE_INTERVAL_MS = 60_000

// 各方案 5 小時視窗的 token 上限（來源：Claude-Code-Usage-Monitor plans.py）
const PLAN_LIMITS = {
  pro:   19_000,
  max5:  88_000,
  max20: 220_000,
}

// 從 env 讀取方案 / 自訂上限
// CLAUDE_TOKEN_LIMIT=850000  → 直接指定上限（優先）
// CLAUDE_PLAN=max5           → 用方案名稱
function getPlan() {
  const p = (process.env.CLAUDE_PLAN || 'pro').toLowerCase()
  return PLAN_LIMITS[p] ? p : 'pro'
}

// p90 = dynamically calculated from usage history (passed from Python)
function getTokenLimit(p90 = null) {
  const custom = parseInt(process.env.CLAUDE_TOKEN_LIMIT || '', 10)
  if (!isNaN(custom) && custom > 0) return custom
  if (p90 && p90 > 0) return p90
  return PLAN_LIMITS[getPlan()]
}

// Python 腳本：
//   1. 掃 5h 視窗內的 token 用量（current usage）
//   2. 掃所有歷史紀錄算 P90 動態上限（自動偵測，不需要知道方案）
const USAGE_PYTHON = `
import json, time
from pathlib import Path
from datetime import datetime

home      = Path.home()
proj      = home / '.claude' / 'projects'
now_ts    = time.time()
window    = 5 * 3600
cutoff_ts = now_ts - window
burn_win  = 20 * 60
burn_cut  = now_ts - burn_win

# P90 config（同 Claude-Code-Usage-Monitor）
KNOWN_LIMITS   = [19_000, 88_000, 220_000, 880_000]
HIT_THRESHOLD  = 0.95
BLOCK_GAP_SEC  = 5 * 3600   # > 5h gap → new block
HISTORY_DAYS   = 30          # scan last 30 days for P90

PRICING = {
    'opus':   (15.0,  75.0,  18.75, 1.50),
    'sonnet': ( 3.0,  15.0,   3.75, 0.30),
    'haiku':  ( 0.25,  1.25,  0.30, 0.03),
}
DEFAULT_P = PRICING['sonnet']

def model_key(m):
    s = (m or '').lower()
    if 'opus'  in s: return 'opus'
    if 'haiku' in s: return 'haiku'
    return 'sonnet'

def parse_ts(s):
    try: return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except: return None

def extract_tokens(u):
    return (u.get('input_tokens', 0), u.get('output_tokens', 0),
            u.get('cache_creation_input_tokens', 0), u.get('cache_read_input_tokens', 0))

# ── Pass 1: current 5h window ──────────────────────────────────────────────
totals = dict(input=0, output=0, cache_write=0, cache_read=0,
              sessions=set(), messages=0, oldest_ts=None,
              cost=0.0, burn_tokens=0, burn_cost=0.0, burn_oldest=None, models={})

if proj.exists():
  for f in proj.rglob('*.jsonl'):
    try:
      if f.stat().st_mtime < cutoff_ts: continue
      with open(f, errors='replace') as fh:
        for line in fh:
          try:
            o = json.loads(line)
            if o.get('type') != 'assistant': continue
            ts = parse_ts(o.get('timestamp', ''))
            if ts is not None and ts < cutoff_ts: continue
            u = (o.get('message') or {}).get('usage') or {}
            if not u: continue
            it, ot, cwt, crt = extract_tokens(u)
            toks = it + ot + cwt + crt
            totals['input']       += it
            totals['output']      += ot
            totals['cache_write'] += cwt
            totals['cache_read']  += crt
            totals['messages']    += 1
            sid = o.get('sessionId', '')
            if sid: totals['sessions'].add(sid)
            if ts is not None:
              if totals['oldest_ts'] is None or ts < totals['oldest_ts']:
                totals['oldest_ts'] = ts
            mk = model_key(o.get('model','') or (o.get('message') or {}).get('model',''))
            p  = PRICING.get(mk, DEFAULT_P)
            msg_cost = (it*p[0] + ot*p[1] + cwt*p[2] + crt*p[3]) / 1_000_000
            totals['cost'] += msg_cost
            totals['models'][mk] = totals['models'].get(mk, 0) + toks
            if ts is not None and ts >= burn_cut:
              totals['burn_tokens'] += toks
              totals['burn_cost']   += msg_cost
              if totals['burn_oldest'] is None or ts < totals['burn_oldest']:
                totals['burn_oldest'] = ts
          except Exception: pass
    except Exception: pass

totals['sessions']  = len(totals['sessions'])
totals['cost']      = round(totals['cost'], 4)
totals['burn_cost'] = round(totals['burn_cost'], 6)
burn_oldest = totals.pop('burn_oldest')
totals['burn_elapsed_min'] = round((now_ts - burn_oldest) / 60, 2) if burn_oldest else 0

# ── Pass 2: P90 dynamic limit from historical blocks ──────────────────────
p90_limit   = None
hist_cutoff = now_ts - HISTORY_DAYS * 86400
all_msgs    = []  # (timestamp, tokens)

if proj.exists():
  for f in proj.rglob('*.jsonl'):
    try:
      if f.stat().st_mtime < hist_cutoff: continue
      with open(f, errors='replace') as fh:
        for line in fh:
          try:
            o = json.loads(line)
            if o.get('type') != 'assistant': continue
            ts = parse_ts(o.get('timestamp', ''))
            if ts is None or ts < hist_cutoff: continue
            u = (o.get('message') or {}).get('usage') or {}
            if not u: continue
            it, ot, cwt, crt = extract_tokens(u)
            toks = it + ot + cwt + crt
            if toks > 0: all_msgs.append((ts, toks))
          except Exception: pass
    except Exception: pass

if all_msgs:
  all_msgs.sort()
  blocks = []
  b_toks, prev_ts = 0, all_msgs[0][0]
  for ts, toks in all_msgs:
    if ts - prev_ts > BLOCK_GAP_SEC:
      if b_toks > 0: blocks.append(b_toks)
      b_toks = 0
    b_toks  += toks
    prev_ts  = ts
  if b_toks > 0: blocks.append(b_toks)  # last block (active – exclude from P90)

  # Only use completed blocks (exclude current active window)
  completed = blocks[:-1] if len(blocks) > 1 else blocks
  if completed:
    hits = [b for b in completed if any(b >= L * HIT_THRESHOLD for L in KNOWN_LIMITS)]
    sample = sorted(hits if hits else completed)
    if len(sample) >= 2:
      idx = min(int(len(sample) * 0.9), len(sample) - 1)
      p90_limit = max(sample[idx], KNOWN_LIMITS[0])
    elif sample:
      p90_limit = max(sample[0], KNOWN_LIMITS[0])

totals['p90_limit'] = p90_limit
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
    const raw  = JSON.parse(stdout.trim() || '{}')
    const plan  = getPlan()
    // Priority: CLAUDE_TOKEN_LIMIT env > P90 from history > plan default
    const limit = getTokenLimit(raw.p90_limit || null)

    const inputTokens      = raw.input       || 0
    const outputTokens     = raw.output      || 0
    const cacheWriteTokens = raw.cache_write || 0
    const cacheReadTokens  = raw.cache_read  || 0
    const totalTokens      = inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens
    const pct              = Math.min(100, Math.round(totalTokens / limit * 100))

    // resetAt = oldest message timestamp + 5h
    const resetAt = raw.oldest_ts
      ? new Date((raw.oldest_ts + 5 * 3600) * 1000).toISOString()
      : null

    // Burn rate (tokens/min and $/min) from the 20-min window
    const burnElapsed = raw.burn_elapsed_min || 0
    const burnRate  = burnElapsed > 0.5 ? Math.round(raw.burn_tokens / burnElapsed) : 0
    const costRate  = burnElapsed > 0.5 ? raw.burn_cost / burnElapsed : 0

    // Predicted runout (only if actively burning and < 12h away)
    let projectedRunoutAt = null
    if (burnRate > 50 && totalTokens < limit) {
      const minutesLeft = (limit - totalTokens) / burnRate
      if (minutesLeft < 12 * 60) {
        projectedRunoutAt = new Date(Date.now() + minutesLeft * 60_000).toISOString()
      }
    }

    // Model distribution as percentages  { sonnet: 96, opus: 4 }
    const rawModels = raw.models || {}
    const modelTotal = Object.values(rawModels).reduce((a, b) => a + b, 0)
    const models = {}
    for (const [k, v] of Object.entries(rawModels)) {
      models[k] = modelTotal > 0 ? Math.round(v / modelTotal * 100) : 0
    }

    state.usageStats = {
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      totalTokens,
      limit,
      plan,
      pct,
      sessions:  raw.sessions || 0,
      messages:  raw.messages || 0,
      windowHrs: 5,
      resetAt,
      costUsd:   raw.cost || 0,
      burnRate,
      costRate,
      projectedRunoutAt,
      models,
      fetchedAt: new Date().toISOString(),
    }
    state.usageLastFetch = now
    const limitSrc = parseInt(process.env.CLAUDE_TOKEN_LIMIT || '', 10) > 0 ? 'env'
      : raw.p90_limit ? 'p90' : 'plan'
    state.usageStats.limitSrc = limitSrc
    console.log(`📊 Usage [${plan}/${limitSrc}]: ${totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens (${pct}%) burn=${burnRate}/min cost=$${(raw.cost||0).toFixed(2)}`)
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
    const logDir = getRemoteLogDir()
    const [tailResult, mtimeResult] = await Promise.all([
      ssh.execCommand(`tail -n 200 --verbose ${logDir}/*.jsonl 2>/dev/null || echo ""`),
      ssh.execCommand(`find ${logDir} -name "*.jsonl" -printf "%f %T@\n" 2>/dev/null || echo ""`),
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

let pollTimer = null

async function pollLoop(broadcast) {
  await poll(broadcast)
  pollTimer = setTimeout(() => pollLoop(broadcast), POLL_INTERVAL)
}

function startPolling(broadcast) {
  pollLoop(broadcast)
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

module.exports = {
  startPolling,
  stopPolling,
  poll,
  fetchRemoteLogs,
  fetchUsageStats,
  generateDemoStates,
  generateDemoUsage,
  POLL_INTERVAL,
}
