'use strict'

const { NodeSSH } = require('node-ssh')
const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { state } = require('./state')

// ─── 嘗試常見 SSH key 路徑，回傳第一個存在的 ────────────────────────────────

function resolveKeyPath(keyPath) {
  const candidates = [
    keyPath ? keyPath.replace(/^~/, os.homedir()) : null,
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ecdsa'),
  ].filter(Boolean)

  return candidates.find(kp => fs.existsSync(kp)) ?? null
}

// ─── 建立新的 SSH 連線（不寫入 state）────────────────────────────────────────

async function connectSSH(overrides = {}) {
  const ssh = new NodeSSH()
  const cfg = {
    host:     overrides.host     ?? process.env.SSH_HOST,
    port:     overrides.port     ?? parseInt(process.env.SSH_PORT || '22'),
    username: overrides.username ?? process.env.SSH_USER,
  }

  if (overrides.password ?? process.env.SSH_PASSWORD) {
    cfg.password = overrides.password ?? process.env.SSH_PASSWORD
  }

  const keyPath = resolveKeyPath(overrides.keyPath ?? process.env.SSH_KEY_PATH)
  if (keyPath) cfg.privateKeyPath = keyPath

  await ssh.connect(cfg)
  return ssh
}

// ─── 確保 state.sshClient 已連線，否則嘗試重連 ───────────────────────────────
// broadcast 由 index.js 注入，避免循環依賴

async function ensureSSH(broadcast) {
  if (state.sshClient && state.sshClient.isConnected()) return state.sshClient

  try {
    state.sshClient = await connectSSH()
    state.connectionStatus = 'connected'
    broadcast({ type: 'connection', status: 'connected' })
    console.log('✅ SSH connected to', process.env.SSH_HOST)
  } catch (err) {
    state.connectionStatus = 'error'
    broadcast({ type: 'connection', status: 'error', message: err.message })
    console.error('❌ SSH error:', err.message)
    state.sshClient = null
  }

  return state.sshClient
}

module.exports = { connectSSH, ensureSSH, resolveKeyPath }
