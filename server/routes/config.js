'use strict'

const { Router }  = require('express')
const { NodeSSH } = require('node-ssh')
const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { state, isDemoMode }       = require('../lib/state')
const { ensureSSH, resolveKeyPath } = require('../lib/ssh')

const PORT = process.env.PORT || 13845

// Sanitize value for .env file — strip newlines, carriage returns, null bytes
function sanitizeEnvValue(v) {
  return (v || '').replace(/[\r\n\0]/g, '').trim()
}

// Validate path for shell safety
function isValidPath(p) {
  return /^[a-zA-Z0-9/_.\-~]+$/.test(p)
}

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

    const envPath  = process.env.APP_DATA_DIR
      ? path.join(process.env.APP_DATA_DIR, '.env')
      : path.join(__dirname, '../../.env')
    const existing = {}
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
        if (m) existing[m[1]] = m[2]
      }
    }

    existing.SSH_HOST = sanitizeEnvValue(host)
    existing.SSH_USER = sanitizeEnvValue(user)
    existing.SSH_PORT = String(parseInt(port) || 22)
    existing.PORT     = String(PORT)
    if (keyPath?.trim()) existing.SSH_KEY_PATH = sanitizeEnvValue(keyPath)

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
      if (!isValidPath(homeDir)) throw new Error(`不安全的 HOME 路徑: ${homeDir}`)
      const claudeDir = `${homeDir}/.claude`
      const logDir    = process.env.REMOTE_LOG_DIR || '/tmp/claude-agents'
      if (!isValidPath(logDir)) throw new Error(`不安全的 log 目錄路徑: ${logDir}`)

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

  // ── 移除遠端 hooks ────────────────────────────────────────────────────────
  router.post('/config/undeploy', async (req, res) => {
    const log  = []
    const step = (msg, ok = true) => {
      log.push({ msg, ok })
      console.log(`${ok ? '✓' : '✗'} Undeploy: ${msg}`)
    }

    try {
      const ssh = await ensureSSH(broadcast)
      if (!ssh) throw new Error('SSH 連線失敗，請先確認連線正常')

      const { stdout: homeRaw } = await ssh.execCommand('echo $HOME')
      const homeDir   = homeRaw.trim()
      if (!isValidPath(homeDir)) throw new Error(`不安全的 HOME 路徑: ${homeDir}`)
      const claudeDir = `${homeDir}/.claude`

      const scripts = [
        { file: 'agent-log-hook.sh',         event: 'PostToolUse'       },
        { file: 'agent-stop-hook.sh',        event: 'Stop'              },
        { file: 'agent-permission-hook.sh',  event: 'PermissionRequest' },
        { file: 'agent-session-end-hook.sh', event: 'SessionEnd'        },
        { file: 'agent-prompt-hook.sh',      event: 'UserPromptSubmit'  },
      ]

      // 1. 刪除腳本檔案
      for (const s of scripts) {
        const remotePath = `${claudeDir}/${s.file}`
        const { stdout: exists } = await ssh.execCommand(`[ -f "${remotePath}" ] && echo yes || echo no`)
        if (exists.trim() === 'yes') {
          await ssh.execCommand(`rm "${remotePath}"`)
          step(`已刪除 ${s.file}`)
        } else {
          step(`${s.file} 不存在，略過`)
        }
      }

      // 2. 從 settings.json 移除對應的 hook 設定
      const { stdout: hasSettings } = await ssh.execCommand(
        `[ -f "${claudeDir}/settings.json" ] && echo yes || echo no`
      )
      if (hasSettings.trim() === 'yes') {
        // 備份
        await ssh.execCommand(`cp "${claudeDir}/settings.json" "${claudeDir}/settings.json.bak"`)
        step('備份 settings.json → settings.json.bak')

        const { stdout: rawJson } = await ssh.execCommand(`cat "${claudeDir}/settings.json"`)
        let settings = {}
        try { settings = JSON.parse(rawJson.trim()) } catch { settings = {} }

        if (settings.hooks) {
          let removed = 0
          for (const s of scripts) {
            const cmd = `${claudeDir}/${s.file}`
            const event = s.event
            if (settings.hooks[event]) {
              const before = settings.hooks[event].length
              settings.hooks[event] = settings.hooks[event].filter(h => {
                const cmds = (h.hooks || []).map(hh => hh.command)
                return !cmds.includes(cmd)
              })
              if (settings.hooks[event].length === 0) {
                delete settings.hooks[event]
              }
              removed += before - (settings.hooks[event]?.length || 0)
            }
          }
          // 如果 hooks 物件空了就移除
          if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks
          }

          // 寫回
          const tmpFile = path.join(os.tmpdir(), `claude-settings-${Date.now()}.json`)
          fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), 'utf8')
          await ssh.putFile(tmpFile, `${claudeDir}/settings.json`)
          fs.unlinkSync(tmpFile)

          step(`settings.json 已更新（移除 ${removed} 個 hooks）`)
        } else {
          step('settings.json 中無 hooks 設定')
        }
      } else {
        step('settings.json 不存在，略過')
      }

      step('🗑️ 移除完成！')
      res.json({ ok: true, log })
    } catch (err) {
      step(err.message, false)
      res.status(500).json({ ok: false, error: err.message, log })
    }
  })

  return router
}

module.exports = createRouter
