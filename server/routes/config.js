'use strict'

const { Router }  = require('express')
const { NodeSSH } = require('node-ssh')
const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { state, isDemoMode }       = require('../lib/state')
const { ensureSSH, resolveKeyPath } = require('../lib/ssh')

const PORT = process.env.PORT || 13845

function createRouter(broadcast) {
  const router = Router()

  // ── 讀取目前 SSH 設定 ──────────────────────────────────────────────────────
  router.get('/config', (req, res) => {
    res.json({
      configured: !isDemoMode(),
      host:    process.env.SSH_HOST    || '',
      user:    process.env.SSH_USER    || '',
      port:    process.env.SSH_PORT    || '22',
      keyPath: process.env.SSH_KEY_PATH || '',
    })
  })

  // ── 測試連線（用前端送的參數，尚未儲存）────────────────────────────────────
  router.post('/config/test', async (req, res) => {
    const { host, user, port, keyPath } = req.body
    try {
      const cfg = {
        host:     (host || '').trim(),
        port:     parseInt(port || 22),
        username: (user || '').trim(),
      }
      const resolved = resolveKeyPath(keyPath?.trim())
      if (resolved) cfg.privateKeyPath = resolved

      const ssh = new NodeSSH()
      await ssh.connect(cfg)
      const { stdout } = await ssh.execCommand('uname -s && echo $USER')
      ssh.dispose()

      const keyUsed = cfg.privateKeyPath
        ? cfg.privateKeyPath.replace(os.homedir(), '~')
        : null
      res.json({ ok: true, info: stdout.trim().replace('\n', ' · '), keyUsed })
    } catch (err) {
      res.json({ ok: false, error: err.message })
    }
  })

  // ── 儲存設定到 .env 並立即套用 ────────────────────────────────────────────
  router.post('/config/save', (req, res) => {
    const { host, user, port, keyPath } = req.body
    if (!host || !user) return res.status(400).json({ error: 'host 和 user 為必填' })

    const envPath  = path.join(__dirname, '../../.env')
    const existing = {}
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
        if (m) existing[m[1]] = m[2]
      }
    }

    existing.SSH_HOST = host.trim()
    existing.SSH_USER = user.trim()
    existing.SSH_PORT = String(port || 22)
    existing.PORT     = String(PORT)
    if (keyPath?.trim()) existing.SSH_KEY_PATH = keyPath.trim()

    fs.writeFileSync(
      envPath,
      Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    )

    // 立即套用到目前 process
    process.env.SSH_HOST = existing.SSH_HOST
    process.env.SSH_USER = existing.SSH_USER
    process.env.SSH_PORT = existing.SSH_PORT
    if (existing.SSH_KEY_PATH) process.env.SSH_KEY_PATH = existing.SSH_KEY_PATH

    // 重設 SSH client，下次 poll 用新設定重連
    if (state.sshClient) {
      try { state.sshClient.dispose() } catch {}
      state.sshClient = null
    }

    res.json({ ok: true })
  })

  // ── 部署 hooks 到遠端 ──────────────────────────────────────────────────────
  router.post('/config/deploy', async (req, res) => {
    const log  = []
    const step = (msg, ok = true) => {
      log.push({ msg, ok })
      console.log(`${ok ? '✓' : '✗'} Deploy: ${msg}`)
    }

    try {
      const ssh = await ensureSSH(broadcast)
      if (!ssh) throw new Error('SSH 連線失敗，請先儲存設定並確認連線正常')

      const { stdout: homeRaw } = await ssh.execCommand('echo $HOME')
      const homeDir   = homeRaw.trim()
      const claudeDir = `${homeDir}/.claude`
      const logDir    = process.env.REMOTE_LOG_DIR || '/tmp/claude-agents'

      await ssh.execCommand(`mkdir -p "${claudeDir}" "${logDir}"`)
      step('目錄建立完成')

      const projectRoot = path.join(__dirname, '../..')
      const scripts = [
        { file: 'agent-log-hook.sh',         event: 'PostToolUse'       },
        { file: 'agent-stop-hook.sh',        event: 'Stop'              },
        { file: 'agent-permission-hook.sh',  event: 'PermissionRequest' },
        { file: 'agent-session-end-hook.sh', event: 'SessionEnd'        },
        { file: 'agent-prompt-hook.sh',      event: 'UserPromptSubmit'  },
      ]

      for (const s of scripts) {
        const localPath = path.join(projectRoot, s.file)
        if (!fs.existsSync(localPath)) { step(`找不到 ${s.file}，跳過`, false); continue }
        await ssh.putFile(localPath, `${claudeDir}/${s.file}`)
        await ssh.execCommand(`chmod +x "${claudeDir}/${s.file}"`)
        step(`上傳 ${s.file}`)
      }

      // 備份現有 settings.json
      const { stdout: hasSettings } = await ssh.execCommand(
        `[ -f "${claudeDir}/settings.json" ] && echo yes || echo no`
      )
      if (hasSettings.trim() === 'yes') {
        await ssh.execCommand(`cp "${claudeDir}/settings.json" "${claudeDir}/settings.json.bak"`)
        step('備份 settings.json → settings.json.bak')
      }

      // 讀取或初始化 settings
      const { stdout: rawJson } = await ssh.execCommand(
        `cat "${claudeDir}/settings.json" 2>/dev/null || echo "{}"`
      )
      let settings = {}
      try { settings = JSON.parse(rawJson.trim()) } catch { settings = {} }
      if (!settings.hooks) settings.hooks = {}

      // 合併 hooks（只新增，不覆蓋已有的）
      let added = 0
      for (const s of scripts) {
        const cmd   = `${claudeDir}/${s.file}`
        const event = s.event
        if (!settings.hooks[event]) {
          settings.hooks[event] = [{ matcher: '', hooks: [{ type: 'command', command: cmd }] }]
          added++
        } else {
          const existingCmds = settings.hooks[event].flatMap(h => (h.hooks || []).map(hh => hh.command))
          if (!existingCmds.includes(cmd)) {
            settings.hooks[event].push({ matcher: '', hooks: [{ type: 'command', command: cmd }] })
            added++
          } else {
            step(`${event} hook 已存在，略過`)
          }
        }
      }

      // 寫入：用 temp file + putFile 避免 shell 引號問題
      const tmpFile = path.join(os.tmpdir(), `claude-settings-${Date.now()}.json`)
      fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), 'utf8')
      await ssh.putFile(tmpFile, `${claudeDir}/settings.json`)
      fs.unlinkSync(tmpFile)

      // 驗證 JSON 合法
      const { stdout: verify } = await ssh.execCommand(
        `python3 -c "import json; json.load(open('${claudeDir}/settings.json')); print('ok')" 2>&1 || echo "fail"`
      )
      if (verify.trim() !== 'ok') {
        if (hasSettings.trim() === 'yes') {
          await ssh.execCommand(`cp "${claudeDir}/settings.json.bak" "${claudeDir}/settings.json"`)
        }
        throw new Error('settings.json 驗證失敗，已自動還原備份')
      }

      step(`settings.json 更新完成（新增 ${added} 個 hooks）`)
      step('🎉 安裝完成！')
      res.json({ ok: true, log })
    } catch (err) {
      step(err.message, false)
      res.status(500).json({ ok: false, error: err.message, log })
    }
  })

  return router
}

module.exports = createRouter
