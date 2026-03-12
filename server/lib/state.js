'use strict'

// ─── 共用可變狀態 ─────────────────────────────────────────────────────────────
// 所有模組共享同一個物件參考，直接修改屬性即可反映給其他模組

const state = {
  agentStates:    {},
  connectionStatus: 'disconnected',
  lastPollTime:   null,
  sshClient:      null,
  dismissedAt:    {},   // { agentId: ISO string }
  usageStats:     null,
  usageLastFetch: 0,
}

function isDemoMode() {
  return !process.env.SSH_HOST
}

module.exports = { state, isDemoMode }
