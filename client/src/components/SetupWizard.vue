<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
    <!-- Card -->
    <div class="relative w-full max-w-md mx-4 rounded-lg border border-border bg-card text-card-foreground shadow-2xl">

      <!-- Close button (only when already configured) -->
      <button v-if="canClose" @click="$emit('close')"
        class="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors">
        <XIcon :size="18" />
      </button>

      <!-- ── Step 1: SSH Config ──────────────────────────────── -->
      <div v-if="step === 1" class="p-6 space-y-5">
        <div>
          <div class="font-mono text-xs font-semibold text-primary tracking-widest uppercase mb-1">⬡ Claude/Agents</div>
          <h2 class="text-lg font-semibold text-foreground">SSH 連線設定</h2>
          <p class="text-xs text-muted-foreground mt-0.5">步驟 1 / 2 — 填入遠端機器資訊</p>
        </div>

        <div class="space-y-3">
          <Field label="遠端主機 IP 或 Hostname">
            <input v-model="form.host" type="text" placeholder="192.168.1.100 或 myserver.example.com"
              class="input w-full" autocomplete="off" @keyup.enter="saveAndNext" />
          </Field>
          <Field label="SSH 使用者名稱">
            <input v-model="form.user" type="text" placeholder="ubuntu"
              class="input w-full" autocomplete="off" @keyup.enter="saveAndNext" />
          </Field>
        </div>

        <!-- Advanced toggle -->
        <button @click="showAdvanced = !showAdvanced"
          class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRightIcon :size="13" :class="{ 'rotate-90': showAdvanced }" class="transition-transform" />
          進階設定
        </button>

        <div v-if="showAdvanced" class="grid grid-cols-2 gap-3">
          <Field label="SSH Port">
            <input v-model="form.port" type="text" placeholder="22" class="input w-full" />
          </Field>
          <Field label="SSH Key 路徑（選填）">
            <input v-model="form.keyPath" type="text" placeholder="~/.ssh/id_rsa" class="input w-full" />
          </Field>
        </div>

        <!-- Status -->
        <p v-if="status.msg" :class="status.ok ? 'text-green-400' : 'text-destructive'" class="text-xs">
          {{ status.msg }}
        </p>

        <!-- Actions -->
        <div class="flex items-center gap-2 pt-1">
          <button @click="testConnection" :disabled="loading" class="btn btn-outline">
            {{ loading ? '連線中…' : '測試連線' }}
          </button>
          <button @click="saveAndNext" :disabled="loading || !form.host || !form.user" class="btn btn-primary">
            儲存並繼續 →
          </button>
        </div>
      </div>

      <!-- ── Step 2: Deploy Hooks ───────────────────────────── -->
      <div v-else-if="step === 2" class="p-6 space-y-4">
        <div>
          <div class="font-mono text-xs font-semibold text-primary tracking-widest uppercase mb-1">⬡ Claude/Agents</div>
          <h2 class="text-lg font-semibold text-foreground">安裝監控腳本</h2>
          <p class="text-xs text-muted-foreground mt-0.5">步驟 2 / 2 — 遠端腳本安裝（建議）</p>
        </div>

        <p class="text-sm text-foreground">
          這個步驟會在遠端機器 <code class="text-primary">~/.claude/</code> 安裝 5 個輕量監控腳本。
        </p>

        <ul class="space-y-1.5 text-sm">
          <li v-for="item in safetyItems" :key="item" class="flex items-start gap-2 text-foreground">
            <span class="text-green-400 mt-0.5 shrink-0">✓</span>
            <span v-html="item" />
          </li>
        </ul>

        <!-- Deploy log -->
        <div v-if="deployLog.length" class="rounded-md border border-border bg-muted p-3 font-mono text-xs max-h-36 overflow-y-auto space-y-0.5">
          <p v-for="(line, i) in deployLog" :key="i" :class="line.ok ? 'text-green-400' : 'text-destructive'">
            {{ line.ok ? '✓' : '✗' }} {{ line.msg }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 pt-1">
          <button @click="runDeploy" :disabled="deploying" class="btn btn-primary">
            {{ deploying ? '安裝中…' : '安裝到遠端' }}
          </button>
          <button @click="skipDeploy" class="btn btn-ghost text-xs">稍後手動安裝</button>
        </div>
      </div>

      <!-- ── Step 3: Done ───────────────────────────────────── -->
      <div v-else class="p-8 text-center space-y-3">
        <div class="text-5xl">🎉</div>
        <h2 class="text-xl font-bold text-foreground">設定完成</h2>
        <p class="text-sm text-muted-foreground">正在進入監控介面…</p>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { XIcon, ChevronRightIcon } from 'lucide-vue-next'
import Field from './ui/Field.vue'

const props = defineProps({ canClose: Boolean })
const emit  = defineEmits(['close', 'done'])

const step         = ref(1)
const loading      = ref(false)
const deploying    = ref(false)
const showAdvanced = ref(false)
const deployLog    = ref([])

const form = reactive({ host: '', user: '', port: '22', keyPath: '' })
const status = reactive({ msg: '', ok: false })

const safetyItems = [
  '只寫入 log，不讀取或修改任何 Claude 檔案',
  '永遠回傳 <code class="text-primary">exit 0</code>，絕不阻擋 Claude 執行',
  '自動備份現有 <code class="text-primary">settings.json</code>',
  '只「新增」hooks，不覆蓋或刪除現有設定',
  '可在 <code class="text-primary">settings.json</code> 隨時手動移除',
]

function setStatus(msg, ok) {
  status.msg = msg
  status.ok  = ok
}

async function testConnection() {
  if (!form.host || !form.user) { setStatus('請填寫 Host 與 User', false); return }
  loading.value = true
  setStatus('⏳ 連線中…', true)
  try {
    const r = await fetch('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(r => r.json())

    if (r.ok) {
      if (r.keyUsed && !form.keyPath) {
        form.keyPath = r.keyUsed
        showAdvanced.value = true
      }
      setStatus(`✓ 連線成功 (${r.info})`, true)
    } else {
      setStatus(`✗ ${r.error}`, false)
    }
  } catch {
    setStatus('✗ 無法連線到 server', false)
  } finally {
    loading.value = false
  }
}

async function saveAndNext() {
  if (!form.host || !form.user) { setStatus('請填寫 Host 與 User', false); return }
  loading.value = true
  try {
    const r = await fetch('/api/config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(r => r.json())
    if (r.ok) { step.value = 2 }
    else { setStatus(`✗ ${r.error}`, false) }
  } catch {
    setStatus('✗ 儲存失敗', false)
  } finally {
    loading.value = false
  }
}

async function runDeploy() {
  deploying.value = true
  deployLog.value = []
  try {
    const r = await fetch('/api/config/deploy', { method: 'POST' }).then(r => r.json())
    deployLog.value = r.log || []
    if (r.ok) {
      setTimeout(() => {
        step.value = 3
        setTimeout(() => emit('done'), 1200)
      }, 600)
    }
  } catch {
    deployLog.value.push({ msg: '部署請求失敗', ok: false })
  } finally {
    deploying.value = false
  }
}

function skipDeploy() {
  step.value = 3
  setTimeout(() => emit('done'), 800)
}

// Pre-fill if reopening settings
onMounted(async () => {
  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    if (cfg.host)    form.host    = cfg.host
    if (cfg.user)    form.user    = cfg.user
    if (cfg.port && cfg.port !== '22') form.port = cfg.port
    if (cfg.keyPath) { form.keyPath = cfg.keyPath; showAdvanced.value = true }
  } catch {}
})
</script>
