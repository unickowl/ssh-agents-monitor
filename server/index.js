require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const { NodeSSH } = require('node-ssh');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const notifier = require('node-notifier');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 13845;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000');
const REMOTE_LOG_DIR = process.env.REMOTE_LOG_DIR || '/tmp/claude-agents';

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// In-memory agent state
let agentStates = {};
let connectionStatus = 'disconnected';
let lastPollTime = null;
let sshClient = null;

// dismiss 持久化：{ agentId: dismissedAt (ISO string) }
// 只要 lastActivity <= dismissedAt，就繼續壓住 needsAttention
const dismissedAt = {};

// ─── Desktop Notifications ────────────────────────────────────────────────────

const NOTIFY_ENABLED = process.env.NOTIFICATIONS !== 'false';

// 哪些狀態轉換要通知
const NOTIFY_TRANSITIONS = {
  waiting:  { title: '⏳ 等待確認',  urgentTitle: '‼️ 需要確認' },
  error:    { title: '❌ 發生錯誤',   urgentTitle: '❌ 發生錯誤' },
  complete: { title: '✅ 任務完成',   urgentTitle: '✅ 任務完成' },
};

function notify(title, message, urgent = false) {
  if (!NOTIFY_ENABLED) return;
  notifier.notify({
    title,
    message,
    sound: urgent,
    timeout: 8,
  });
}

function detectAndNotify(prevStates, nextStates) {
  for (const [id, next] of Object.entries(nextStates)) {
    const prev = prevStates[id];
    const prevStatus = prev?.status;
    const nextStatus = next.status;

    // 同狀態不重複通知
    if (prevStatus === nextStatus) continue;

    const cfg = NOTIFY_TRANSITIONS[nextStatus];
    if (!cfg) continue;

    const label = next.task ? `[${next.task.slice(0, 40)}]` : `[${id}]`;
    let message = label;

    if (nextStatus === 'waiting') {
      message = `${label}\n${next.attentionReason || '等待使用者確認'}`;
    } else if (nextStatus === 'error') {
      message = `${label}\n${next.error || next.attentionReason || '未知錯誤'}`;
    } else if (nextStatus === 'complete') {
      message = `${label}\n${next.summary || '已完成'}`;
    }

    const title = next.urgent ? cfg.urgentTitle : cfg.title;
    notify(title, message, next.urgent);
    console.log(`🔔 通知：${title} — ${id}`);
  }
}

// ─── SSH Connection ───────────────────────────────────────────────────────────

async function connectSSH() {
  const ssh = new NodeSSH();
  const config = {
    host: process.env.SSH_HOST,
    port: parseInt(process.env.SSH_PORT || '22'),
    username: process.env.SSH_USER,
  };

  if (process.env.SSH_PASSWORD) {
    config.password = process.env.SSH_PASSWORD;
  }

  // 嘗試 SSH key：明確指定路徑優先，否則 fallback 常見預設路徑
  const candidates = [
    process.env.SSH_KEY_PATH ? process.env.SSH_KEY_PATH.replace(/^~/, os.homedir()) : null,
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ecdsa'),
  ].filter(Boolean);
  for (const kp of candidates) {
    if (fs.existsSync(kp)) { config.privateKeyPath = kp; break; }
  }

  await ssh.connect(config);
  return ssh;
}

async function ensureSSH() {
  if (sshClient && sshClient.isConnected()) return sshClient;
  try {
    sshClient = await connectSSH();
    connectionStatus = 'connected';
    broadcast({ type: 'connection', status: 'connected' });
    console.log('✅ SSH connected to', process.env.SSH_HOST);
  } catch (err) {
    connectionStatus = 'error';
    broadcast({ type: 'connection', status: 'error', message: err.message });
    console.error('❌ SSH error:', err.message);
    sshClient = null;
  }
  return sshClient;
}

// ─── Log Parsing ─────────────────────────────────────────────────────────────

/**
 * Expected log format (JSONL):
 * {"time":"2024-01-01T00:00:00Z","agent":"agent-1","event":"start","task":"Create API","spec":"openapi.yaml"}
 * {"time":"...","agent":"agent-1","event":"progress","step":"Parsing spec","total":10,"done":3}
 * {"time":"...","agent":"agent-1","event":"tool_use","tool":"write_file","input":"src/api.ts"}
 * {"time":"...","agent":"agent-1","event":"waiting","reason":"Need approval to delete files","urgent":true}
 * {"time":"...","agent":"agent-1","event":"error","message":"Cannot parse spec","recoverable":false}
 * {"time":"...","agent":"agent-1","event":"complete","summary":"Created 12 files"}
 */
function parseLogLine(line) {
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

const STALE_THRESHOLD_SECS = parseInt(process.env.STALE_THRESHOLD_HOURS || '2') * 3600;

function buildAgentState(agentId, lines, fileMtime) {
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
    tasks: [],          // 來自 TodoWrite 的任務清單
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
  };

  for (const line of lines) {
    const entry = parseLogLine(line);
    if (!entry) continue;

    state.lastActivity = entry.time;
    state.events.push(entry);

    switch (entry.event) {
      case 'start':
        state.status = 'running';
        state.task = entry.task || '';
        state.spec = entry.spec || '';
        state.startTime = entry.time;
        state.needsAttention = false;
        state.error = null;
        break;
      case 'progress':
        state.status = 'running';
        state.currentStep = entry.step || '';
        state.totalSteps = entry.total || state.totalSteps;
        state.doneSteps = entry.done || state.doneSteps;
        state.progress = state.totalSteps > 0
          ? Math.round((state.doneSteps / state.totalSteps) * 100)
          : 0;
        break;
      case 'tool_use':
        // 工具執行代表 waiting 已解除（使用者確認了）
        if (state.status === 'waiting') {
          state.needsAttention = false;
          state.attentionReason = '';
          state.urgent = false;
        }
        state.status = 'running';
        state.recentTools = [
          { tool: entry.tool, input: entry.input, time: entry.time },
          ...state.recentTools,
        ].slice(0, 5);
        break;
      case 'tasks':
        if (Array.isArray(entry.todos) && entry.todos.length > 0) {
          const raw = entry.todos.map(t => ({
            id:       t.id       || '',
            content:  t.content  || '',
            status:   t.status   || 'pending',
            priority: t.priority || 'medium',
          }));

          // tasks.md 來源只有 pending/completed；
          // 把第一個 pending 標為 in_progress，讓前端知道目前執行到哪
          if (entry.source === 'tasks.md') {
            let foundFirst = false;
            state.tasks = raw.map(t => {
              if (!foundFirst && t.status === 'pending') {
                foundFirst = true;
                return { ...t, status: 'in_progress' };
              }
              return t;
            });
          } else {
            state.tasks = raw;
          }

          // 用任務完成數算進度（in_progress 不計入 done）
          const done  = state.tasks.filter(t => t.status === 'completed').length;
          const total = state.tasks.length;
          if (total > 0) {
            state.totalSteps = total;
            state.doneSteps  = done;
            state.progress   = Math.round((done / total) * 100);
          }
        }
        break;
      case 'waiting':
        state.status = 'waiting';
        state.needsAttention = true;
        state.attentionReason = entry.reason || 'Waiting for input';
        state.urgent = !!entry.urgent;
        break;
      case 'prompt_submit':
        // 使用者送出新 prompt，代表 waiting 狀態已解除（取消確認或繼續對話）
        if (state.status === 'waiting') {
          state.status = 'running';
          state.needsAttention = false;
          state.attentionReason = '';
          state.urgent = false;
        }
        break;
      case 'error':
        state.status = entry.recoverable ? 'warning' : 'error';
        state.error = entry.message;
        state.needsAttention = true;
        state.attentionReason = entry.message;
        state.urgent = !entry.recoverable;
        break;
      case 'complete':
        state.status = 'complete';
        state.progress = 100;
        state.summary = entry.summary || 'Completed';
        state.needsAttention = false;
        break;
      case 'idle':
        state.status = 'idle';
        break;
      case 'closed':
        state.status = 'closed';
        state.needsAttention = false;
        break;
    }
  }

  // Cap recent events for UI
  state.events = state.events.slice(-30);

  // dismiss 持久化：如果使用者忽略過，且之後沒有新的 waiting 事件，繼續壓住 needsAttention
  if (state.needsAttention && dismissedAt[agentId]) {
    const lastWaitingTime = state.events
      .filter(e => e.event === 'waiting')
      .map(e => e.time)
      .pop();
    if (!lastWaitingTime || lastWaitingTime <= dismissedAt[agentId]) {
      state.needsAttention = false;
      state.attentionReason = '';
      state.urgent = false;
    } else {
      // 有新的 waiting 事件，dismiss 已失效
      delete dismissedAt[agentId];
    }
  }

  // 判斷是否為舊 session：complete/idle 且檔案超過門檻時間未更新
  // closed 狀態永遠 isStale（讓前端一律過濾掉）
  if (state.status === 'closed') {
    state.isStale = true;
  } else if (fileMtime) {
    const ageSeconds = (Date.now() / 1000) - fileMtime;
    state.isStale = (state.status === 'complete' || state.status === 'idle') && ageSeconds > STALE_THRESHOLD_SECS;
    state.fileAgeSeconds = Math.floor(ageSeconds);
  }

  return state;
}

// ─── Remote Log Fetching ──────────────────────────────────────────────────────

async function fetchRemoteLogs() {
  const ssh = await ensureSSH();
  if (!ssh) return null;

  try {
    // 同時抓日誌內容與每個檔案的 mtime（Unix timestamp）
    const [tailResult, mtimeResult] = await Promise.all([
      ssh.execCommand(`tail -n 200 --verbose ${REMOTE_LOG_DIR}/*.jsonl 2>/dev/null || echo ""`),
      ssh.execCommand(`find ${REMOTE_LOG_DIR} -name "*.jsonl" -printf "%f %T@\n" 2>/dev/null || echo ""`),
    ]);

    // 建立 mtime 對照表：{ "agent-id.jsonl": unixTimestamp }
    const mtimeMap = {};
    for (const line of (mtimeResult.stdout || '').split('\n')) {
      const m = line.trim().match(/^(.+\.jsonl)\s+([\d.]+)$/);
      if (m) mtimeMap[m[1]] = parseFloat(m[2]);
    }

    if (!tailResult.stdout.trim()) return {};

    const newStates = {};
    let currentFile = null;
    let currentLines = [];

    for (const line of tailResult.stdout.split('\n')) {
      const headerMatch = line.match(/^==> (.+\.jsonl) <==$/);
      if (headerMatch) {
        // 處理上一個檔案
        if (currentFile && currentLines.length > 0) {
          const agentId = path.basename(currentFile, '.jsonl');
          const mtime = mtimeMap[path.basename(currentFile)];
          newStates[agentId] = buildAgentState(agentId, currentLines, mtime);
        }
        currentFile = headerMatch[1];
        currentLines = [];
      } else if (line.trim() && currentFile) {
        currentLines.push(line);
      }
    }
    // 處理最後一個檔案
    if (currentFile && currentLines.length > 0) {
      const agentId = path.basename(currentFile, '.jsonl');
      const mtime = mtimeMap[path.basename(currentFile)];
      newStates[agentId] = buildAgentState(agentId, currentLines, mtime);
    }

    return newStates;
  } catch (err) {
    console.error('Poll error:', err.message);
    if (!ssh.isConnected()) {
      sshClient = null;
      connectionStatus = 'disconnected';
    }
    return null;
  }
}

// ─── Demo Mode (no SSH config) ───────────────────────────────────────────────

function generateDemoStates() {
  const now = new Date();
  const agents = [
    { id: 'agent-auth-api', task: 'Implement Auth API endpoints', spec: 'auth-openapi.yaml', status: 'running', progress: 65, step: 'Writing JWT middleware' },
    { id: 'agent-user-service', task: 'Create User CRUD service', spec: 'users-openapi.yaml', status: 'waiting', progress: 40, step: 'Schema validation', attention: 'Need approval: found existing user table, should I migrate or overwrite?', urgent: true },
    { id: 'agent-payment-flow', task: 'Build payment flow handlers', spec: 'payments-openapi.yaml', status: 'running', progress: 82, step: 'Writing Stripe webhook handler' },
    { id: 'agent-notification', task: 'Setup notification service', spec: 'notifications-openapi.yaml', status: 'complete', progress: 100, summary: 'Created 8 files, 340 lines of code', staleHoursAgo: 5 },
    { id: 'agent-reporting', task: 'Generate reporting module', spec: 'reports-openapi.yaml', status: 'error', progress: 25, step: 'Parsing spec', error: 'Invalid OpenAPI 3.0 schema: missing required field "info"' },
  ];

  const states = {};
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
      startTime: new Date(now - Math.random() * 3600000).toISOString(),
      lastActivity: new Date(now - Math.random() * 60000).toISOString(),
      isStale: !!(a.staleHoursAgo),
      fileModifiedAt: a.staleHoursAgo ? new Date(now - a.staleHoursAgo * 3600000).toISOString() : new Date(now - Math.random() * 60000).toISOString(),
      recentTools: a.status === 'running' ? [
        { tool: 'write_file', input: 'src/handlers/' + a.id + '.ts', time: new Date(now - 5000).toISOString() },
        { tool: 'read_file', input: a.spec, time: new Date(now - 15000).toISOString() },
      ] : [],
      events: [],
    };
    // Simulate small progress changes
    if (a.status === 'running' && Math.random() > 0.5) {
      states[a.id].progress = Math.min(99, a.progress + Math.floor(Math.random() * 3));
    }
  }
  return states;
}

// ─── Usage Stats ──────────────────────────────────────────────────────────────

let usageStats = null;   // 快取，60 秒更新一次
let usageLastFetch = 0;
const USAGE_INTERVAL_MS = 60_000;

// 在遠端執行 Python，解析 ~/.claude/projects 的 usage
const USAGE_PYTHON = `
import json, os, time
from pathlib import Path

home = Path.home()
proj = home / '.claude' / 'projects'
cutoff = time.time() - 86400  # 最近 24h

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
`.trim();

async function fetchUsageStats() {
  if (isDemoMode()) return null;
  const now = Date.now();
  if (now - usageLastFetch < USAGE_INTERVAL_MS) return usageStats;

  const ssh = await ensureSSH();
  if (!ssh) return usageStats;

  try {
    // Python 腳本含單引號，用 base64 傳遞避免 shell 引號問題
    const b64 = Buffer.from(USAGE_PYTHON).toString('base64');
    const { stdout } = await ssh.execCommand(
      `echo '${b64}' | base64 -d | python3 2>/dev/null || echo "{}"`
    );
    const raw = JSON.parse(stdout.trim() || '{}');
    usageStats = {
      inputTokens:      raw.input       || 0,
      outputTokens:     raw.output      || 0,
      cacheWriteTokens: raw.cache_write || 0,
      cacheReadTokens:  raw.cache_read  || 0,
      totalTokens:      (raw.input || 0) + (raw.output || 0),
      sessions:         raw.sessions    || 0,
      messages:         raw.messages    || 0,
      fetchedAt:        new Date().toISOString(),
    };
    usageLastFetch = now;
    console.log(`📊 Usage: in=${raw.input} out=${raw.output} sessions=${raw.sessions}`);
  } catch (err) {
    console.error('Usage fetch error:', err.message);
  }

  return usageStats;
}

// ─── Polling Loop ─────────────────────────────────────────────────────────────

function isDemoMode() { return !process.env.SSH_HOST; }

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
  };
}

async function poll() {
  let newStates;

  if (isDemoMode()) {
    newStates = generateDemoStates();
    connectionStatus = 'demo';
  } else {
    newStates = await fetchRemoteLogs();
  }

  if (newStates) {
    detectAndNotify(agentStates, newStates);
    agentStates = newStates;
    lastPollTime = new Date().toISOString();
    const usage = isDemoMode() ? generateDemoUsage() : await fetchUsageStats();
    broadcast({ type: 'update', agents: agentStates, lastPoll: lastPollTime, connection: connectionStatus, usage });
  }
}

setInterval(poll, POLL_INTERVAL);
poll(); // initial

// ─── WebSocket ────────────────────────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    agents: agentStates,
    lastPoll: lastPollTime,
    connection: connectionStatus,
    configured: !isDemoMode(),
    demoMode: isDemoMode(),
    usage: isDemoMode() ? generateDemoUsage() : usageStats,
  }));
});

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/agents', (req, res) => {
  res.json({ agents: agentStates, lastPoll: lastPollTime, connection: connectionStatus });
});

// ─── Setup / Config API ───────────────────────────────────────────────────────

// 讀取目前設定
app.get('/api/config', (req, res) => {
  res.json({
    configured: !isDemoMode(),
    host: process.env.SSH_HOST || '',
    user: process.env.SSH_USER || '',
    port: process.env.SSH_PORT || '22',
    keyPath: process.env.SSH_KEY_PATH || '',
  });
});

// 測試 SSH 連線（用前端送來的參數，尚未儲存）
app.post('/api/config/test', async (req, res) => {
  const { host, user, port, keyPath } = req.body;
  try {
    const cfg = {
      host: (host || '').trim(),
      port: parseInt(port || 22),
      username: (user || '').trim(),
    };
    // 嘗試找 key：指定路徑 → 預設路徑
    const candidates = [
      keyPath ? (keyPath.trim().replace(/^~/, os.homedir())) : null,
      path.join(os.homedir(), '.ssh', 'id_ed25519'),
      path.join(os.homedir(), '.ssh', 'id_rsa'),
      path.join(os.homedir(), '.ssh', 'id_ecdsa'),
    ].filter(Boolean);
    for (const kp of candidates) {
      if (fs.existsSync(kp)) { cfg.privateKeyPath = kp; break; }
    }
    const ssh = new NodeSSH();
    await ssh.connect(cfg);
    const { stdout } = await ssh.execCommand('uname -s && echo $USER');
    ssh.dispose();
    // 回傳用了哪把 key（讓前端可自動填入），路徑還原成 ~ 縮寫
    const keyUsed = cfg.privateKeyPath
      ? cfg.privateKeyPath.replace(os.homedir(), '~')
      : null;
    res.json({ ok: true, info: stdout.trim().replace('\n', ' · '), keyUsed });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 儲存設定到 .env 並立即套用
app.post('/api/config/save', (req, res) => {
  const { host, user, port, keyPath } = req.body;
  if (!host || !user) return res.status(400).json({ error: 'host 和 user 為必填' });

  // 讀取現有 .env（若存在），保留其他設定
  const envPath = path.join(__dirname, '../.env');
  const existing = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) existing[m[1]] = m[2];
    }
  }
  existing.SSH_HOST = host.trim();
  existing.SSH_USER = user.trim();
  existing.SSH_PORT = String(port || 22);
  existing.PORT     = String(PORT);
  if (keyPath && keyPath.trim()) existing.SSH_KEY_PATH = keyPath.trim();

  fs.writeFileSync(envPath,
    Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  );

  // 立即套用到 process.env
  process.env.SSH_HOST = existing.SSH_HOST;
  process.env.SSH_USER = existing.SSH_USER;
  process.env.SSH_PORT = existing.SSH_PORT;
  if (existing.SSH_KEY_PATH) process.env.SSH_KEY_PATH = existing.SSH_KEY_PATH;

  // 重設 SSH client 以便下次 poll 用新設定重連
  if (sshClient) { try { sshClient.dispose(); } catch {} sshClient = null; }

  res.json({ ok: true });
});

// 將監控 hooks 部署到遠端機器
app.post('/api/config/deploy', async (req, res) => {
  const log = [];
  const step = (msg, ok = true) => { log.push({ msg, ok }); console.log(`${ok ? '✓' : '✗'} Deploy: ${msg}`); };

  try {
    const ssh = await ensureSSH();
    if (!ssh) throw new Error('SSH 連線失敗，請先儲存設定並確認連線正常');

    // 取得遠端 home dir
    const { stdout: homeRaw } = await ssh.execCommand('echo $HOME');
    const homeDir = homeRaw.trim();
    const claudeDir = `${homeDir}/.claude`;
    const logDir = process.env.REMOTE_LOG_DIR || '/tmp/claude-agents';

    // 建立目錄
    await ssh.execCommand(`mkdir -p "${claudeDir}" "${logDir}"`);
    step('目錄建立完成');

    // 上傳 5 個 hook scripts
    const projectRoot = path.join(__dirname, '..');
    const scripts = [
      { file: 'agent-log-hook.sh',         event: 'PostToolUse'       },
      { file: 'agent-stop-hook.sh',        event: 'Stop'              },
      { file: 'agent-permission-hook.sh',  event: 'PermissionRequest' },
      { file: 'agent-session-end-hook.sh', event: 'SessionEnd'        },
      { file: 'agent-prompt-hook.sh',      event: 'UserPromptSubmit'  },
    ];

    for (const s of scripts) {
      const localPath = path.join(projectRoot, s.file);
      if (!fs.existsSync(localPath)) { step(`找不到 ${s.file}，跳過`, false); continue; }
      await ssh.putFile(localPath, `${claudeDir}/${s.file}`);
      await ssh.execCommand(`chmod +x "${claudeDir}/${s.file}"`);
      step(`上傳 ${s.file}`);
    }

    // 備份現有 settings.json
    const { stdout: hasSettings } = await ssh.execCommand(`[ -f "${claudeDir}/settings.json" ] && echo yes || echo no`);
    if (hasSettings.trim() === 'yes') {
      await ssh.execCommand(`cp "${claudeDir}/settings.json" "${claudeDir}/settings.json.bak"`);
      step('備份 settings.json → settings.json.bak');
    }

    // 讀取現有 settings（或空物件）
    const { stdout: rawJson } = await ssh.execCommand(`cat "${claudeDir}/settings.json" 2>/dev/null || echo "{}"`);
    let settings = {};
    try { settings = JSON.parse(rawJson.trim()); } catch { settings = {}; }
    if (!settings.hooks) settings.hooks = {};

    // 合併 hooks（只新增，不覆蓋已有的）
    let added = 0;
    for (const s of scripts) {
      const cmd = `${claudeDir}/${s.file}`;
      const event = s.event;
      if (!settings.hooks[event]) {
        settings.hooks[event] = [{ matcher: '', hooks: [{ type: 'command', command: cmd }] }];
        added++;
      } else {
        const existingCmds = settings.hooks[event].flatMap(h => (h.hooks || []).map(hh => hh.command));
        if (!existingCmds.includes(cmd)) {
          settings.hooks[event].push({ matcher: '', hooks: [{ type: 'command', command: cmd }] });
          added++;
        } else {
          step(`${event} hook 已存在，略過`);
        }
      }
    }

    // 寫入 settings.json：用 temp file + putFile，避免 shell 特殊字元問題
    const tmpFile = path.join(os.tmpdir(), `claude-settings-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), 'utf8');
    await ssh.putFile(tmpFile, `${claudeDir}/settings.json`);
    fs.unlinkSync(tmpFile);

    // 驗證 JSON 合法
    const { stdout: verify } = await ssh.execCommand(
      `python3 -c "import json; json.load(open('${claudeDir}/settings.json')); print('ok')" 2>&1 || echo "fail"`
    );
    if (verify.trim() !== 'ok') {
      if (hasSettings.trim() === 'yes') {
        await ssh.execCommand(`cp "${claudeDir}/settings.json.bak" "${claudeDir}/settings.json"`);
      }
      throw new Error('settings.json 驗證失敗，已自動還原備份');
    }

    step(`settings.json 更新完成（新增 ${added} 個 hooks）`);
    step('🎉 安裝完成！');
    res.json({ ok: true, log });
  } catch (err) {
    step(err.message, false);
    res.status(500).json({ ok: false, error: err.message, log });
  }
});

// ─── Agents API ───────────────────────────────────────────────────────────────

// Dismiss attention flag for an agent
app.post('/api/agents/:id/dismiss', (req, res) => {
  const agent = agentStates[req.params.id];
  if (agent) {
    agent.needsAttention = false;
    agent.attentionReason = '';
    agent.urgent = false;
    // 記錄 dismiss 時間，讓下次 poll 重建 state 時也能持續壓住
    dismissedAt[req.params.id] = new Date().toISOString();
    broadcast({ type: 'update', agents: agentStates, lastPoll: lastPollTime, connection: connectionStatus });
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🚀 Agent Monitor running at ${url}`);
  if (isDemoMode()) {
    console.log('⚙️  尚未設定 SSH，請開啟瀏覽器完成初始設定');
  } else {
    console.log(`🔗 Monitoring SSH: ${process.env.SSH_USER}@${process.env.SSH_HOST}`);
    console.log(`📁 Remote log dir: ${REMOTE_LOG_DIR}`);
  }
  console.log(`⏱  Polling every ${POLL_INTERVAL}ms\n`);

  // 自動開啟瀏覽器（可用 NO_BROWSER=true 停用）
  if (!process.env.NO_BROWSER) {
    const cmd = process.platform === 'darwin' ? `open "${url}"`
              : process.platform === 'win32'  ? `start "" "${url}"`
              : `xdg-open "${url}"`;
    setTimeout(() => exec(cmd, err => {
      if (err) console.log(`請手動開啟瀏覽器：${url}`);
    }), 800);
  }
});
