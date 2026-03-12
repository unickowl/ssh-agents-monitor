'use strict'

const STALE_THRESHOLD_SECS = parseInt(process.env.STALE_THRESHOLD_HOURS || '2') * 3600

// ─── 單行 JSON 解析 ────────────────────────────────────────────────────────────

function parseLogLine(line) {
  try {
    return JSON.parse(line.trim())
  } catch {
    return null
  }
}

// ─── 從 JSONL 行陣列重建 agent 狀態 ──────────────────────────────────────────
//
// @param agentId    string
// @param lines      string[]   raw log lines
// @param fileMtime  number|null  Unix timestamp (seconds)
// @param dismissedAt object    { [agentId]: ISO string }  來自 state，純讀

function buildAgentState(agentId, lines, fileMtime, dismissedAt = {}) {
  const state = {
    id: agentId,
    status: 'unknown',
    task: '',
    spec: '',
    progress: 0,
    totalSteps: 0,
    doneSteps: 0,
    currentStep: '',
    recentTools: [],
    tasks: [],
    needsAttention: false,
    attentionReason: '',
    urgent: false,
    error: null,
    summary: '',
    startTime: null,
    lastActivity: null,
    fileModifiedAt: fileMtime ? new Date(fileMtime * 1000).toISOString() : null,
    isStale: false,
    events: [],
  }

  for (const line of lines) {
    const entry = parseLogLine(line)
    if (!entry) continue

    state.lastActivity = entry.time
    state.events.push(entry)

    switch (entry.event) {
      case 'start':
        state.status = 'running'
        state.task = entry.task || ''
        state.spec = entry.spec || ''
        state.startTime = entry.time
        state.needsAttention = false
        state.error = null
        break

      case 'progress':
        state.status = 'running'
        state.currentStep = entry.step || ''
        state.totalSteps = entry.total || state.totalSteps
        state.doneSteps = entry.done || state.doneSteps
        state.progress = state.totalSteps > 0
          ? Math.round((state.doneSteps / state.totalSteps) * 100)
          : 0
        break

      case 'tool_use':
        if (state.status === 'waiting') {
          state.needsAttention = false
          state.attentionReason = ''
          state.urgent = false
        }
        state.status = 'running'
        state.recentTools = [
          { tool: entry.tool, input: entry.input, time: entry.time },
          ...state.recentTools,
        ].slice(0, 5)
        break

      case 'tasks':
        if (Array.isArray(entry.todos) && entry.todos.length > 0) {
          const raw = entry.todos.map(t => ({
            id:       t.id       || '',
            content:  t.content  || '',
            status:   t.status   || 'pending',
            priority: t.priority || 'medium',
          }))

          // tasks.md 來源只有 pending/completed；推算第一個 pending 為 in_progress
          if (entry.source === 'tasks.md') {
            let foundFirst = false
            state.tasks = raw.map(t => {
              if (!foundFirst && t.status === 'pending') {
                foundFirst = true
                return { ...t, status: 'in_progress' }
              }
              return t
            })
          } else {
            state.tasks = raw
          }

          const done  = state.tasks.filter(t => t.status === 'completed').length
          const total = state.tasks.length
          if (total > 0) {
            state.totalSteps = total
            state.doneSteps  = done
            state.progress   = Math.round((done / total) * 100)
          }
        }
        break

      case 'waiting':
        state.status = 'waiting'
        state.needsAttention = true
        state.attentionReason = entry.reason || 'Waiting for input'
        state.urgent = !!entry.urgent
        break

      case 'prompt_submit':
        if (state.status === 'waiting') {
          state.status = 'running'
          state.needsAttention = false
          state.attentionReason = ''
          state.urgent = false
        }
        break

      case 'error':
        state.status = entry.recoverable ? 'warning' : 'error'
        state.error = entry.message
        state.needsAttention = true
        state.attentionReason = entry.message
        state.urgent = !entry.recoverable
        break

      case 'complete':
        state.status = 'complete'
        state.progress = 100
        state.summary = entry.summary || 'Completed'
        state.needsAttention = false
        break

      case 'idle':
        state.status = 'idle'
        break

      case 'closed':
        state.status = 'closed'
        state.needsAttention = false
        break
    }
  }

  // 只保留最近 30 筆事件
  state.events = state.events.slice(-30)

  // dismiss 持久化：有新的 waiting 事件才重新顯示 attention
  if (state.needsAttention && dismissedAt[agentId]) {
    const lastWaitingTime = state.events
      .filter(e => e.event === 'waiting')
      .map(e => e.time)
      .pop()
    if (!lastWaitingTime || lastWaitingTime <= dismissedAt[agentId]) {
      state.needsAttention = false
      state.attentionReason = ''
      state.urgent = false
    } else {
      delete dismissedAt[agentId]
    }
  }

  // stale 判斷
  if (state.status === 'closed') {
    state.isStale = true
  } else if (fileMtime) {
    const ageSeconds = (Date.now() / 1000) - fileMtime
    state.isStale = (state.status === 'complete' || state.status === 'idle')
      && ageSeconds > STALE_THRESHOLD_SECS
    state.fileAgeSeconds = Math.floor(ageSeconds)
  }

  return state
}

module.exports = { parseLogLine, buildAgentState }
