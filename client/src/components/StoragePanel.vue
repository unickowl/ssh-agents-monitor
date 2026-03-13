<template>
  <!-- Trigger button -->
  <div class="relative">
    <button @click="toggle" title="Log 儲存空間" class="icon-btn relative">
      <DatabaseIcon :size="15" />
      <!-- Dot indicator if there are many files -->
      <span v-if="stats && stats.totalFiles > 10"
        class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-500" />
    </button>

    <!-- Floating panel -->
    <Teleport to="body">
      <template v-if="open">
        <!-- Backdrop -->
        <div class="fixed inset-0 z-40" @click="open = false" />

        <!-- Panel -->
        <div class="fixed z-50 w-80 rounded-lg border border-border bg-card shadow-xl"
          :style="panelStyle">

          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span class="font-mono text-xs font-semibold text-foreground tracking-wider uppercase">
              Log 儲存空間
            </span>
            <button @click="open = false"
              class="text-muted-foreground hover:text-foreground transition-colors text-xs">✕</button>
          </div>

          <!-- Summary bar -->
          <div class="px-4 py-3 border-b border-border bg-muted/30">
            <div v-if="loading && !stats" class="text-xs text-muted-foreground">載入中…</div>
            <div v-else-if="stats" class="flex items-center justify-between">
              <span class="font-mono text-xs text-muted-foreground">
                <span class="text-foreground font-semibold">{{ stats.totalFiles }}</span> 個檔案
              </span>
              <span class="font-mono text-xs">
                <span class="text-primary font-semibold">{{ formatBytes(stats.totalBytes) }}</span>
              </span>
            </div>
            <div v-else class="space-y-1">
              <div class="text-xs text-destructive">無法取得資訊</div>
              <div v-if="fetchError" class="font-mono text-[10px] text-muted-foreground break-all">
                {{ fetchError }}
              </div>
            </div>
          </div>

          <!-- File list -->
          <div class="max-h-52 overflow-y-auto">
            <div v-if="stats && stats.files.length > 0">
              <div v-for="f in stats.files" :key="f.name"
                class="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 last:border-0
                       hover:bg-accent/40 transition-colors">

                <!-- Status dot -->
                <span :style="fileDotStyle(f.agentId)"
                  class="w-1.5 h-1.5 rounded-full shrink-0" />

                <!-- Filename -->
                <span class="font-mono text-[11px] text-foreground truncate flex-1 min-w-0">
                  {{ f.agentId }}
                </span>

                <!-- Age chip -->
                <span class="font-mono text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                  {{ fileAge(f.modifiedAt) }}
                </span>

                <!-- Size -->
                <span class="font-mono text-[10px] text-muted-foreground shrink-0 w-12 text-right">
                  {{ formatBytes(f.sizeBytes) }}
                </span>
              </div>
            </div>
            <div v-else-if="stats" class="px-4 py-6 text-center text-xs text-muted-foreground">
              無 log 檔案
            </div>
          </div>

          <!-- Actions -->
          <div class="px-4 py-3 border-t border-border flex items-center gap-2">
            <!-- Stale days input -->
            <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono mr-auto">
              <span>>{{' '}}</span>
              <input v-model.number="olderThanDays" type="number" min="0" max="365"
                class="input w-12 h-6 text-center px-1 text-[11px] py-0" />
              <span> 天</span>
            </label>

            <button @click="clearStale"
              :disabled="clearing"
              class="btn-ghost-xs">
              {{ clearing === 'stale' ? '清除中…' : '清舊檔' }}
            </button>

            <button @click="confirmClearAll"
              :disabled="!!clearing"
              class="btn-ghost-xs text-destructive hover:text-destructive hover:border-destructive/50">
              {{ clearing === 'all' ? '清除中…' : '全部清除' }}
            </button>
          </div>

          <!-- Result message -->
          <div v-if="lastResult" class="px-4 pb-3 font-mono text-[11px]"
            :class="lastResult.ok ? 'text-complete' : 'text-destructive'">
            {{ lastResult.msg }}
          </div>

        </div>
      </template>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { DatabaseIcon } from 'lucide-vue-next'
import { useStore } from '@/composables/useStore'
import { formatRelative } from '@/lib/utils'

const { agents } = useStore()

const open          = ref(false)
const stats         = ref(null)
const fetchError    = ref(null)    // 顯示具體錯誤原因
const loading       = ref(false)
const clearing      = ref(null)   // null | 'stale' | 'all'
const lastResult    = ref(null)
const olderThanDays = ref(1)

// ── Position panel below the trigger button ──────────────────────────────────

const panelStyle = computed(() => ({
  top:   '52px',
  right: '12px',
}))

// ── Status dot colour for each file based on agent state ─────────────────────

const STATUS_COLOR = {
  running:  'hsl(var(--s-running))',
  waiting:  'hsl(var(--s-waiting))',
  error:    'hsl(var(--s-error))',
  complete: 'hsl(var(--s-complete))',
}
function fileDotStyle(agentId) {
  const status = agents[agentId]?.status
  const color  = STATUS_COLOR[status] ?? 'hsl(var(--s-idle))'
  return { background: color }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024)         return `${bytes} B`
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fileAge(iso) {
  if (!iso) return '—'
  return formatRelative(iso)
}

// ── Fetch stats ───────────────────────────────────────────────────────────────

async function fetchStats() {
  loading.value = true
  fetchError.value = null
  try {
    const res  = await fetch('/api/logs/stats')
    const data = await res.json().catch(() => null)
    if (!data) {
      fetchError.value = `HTTP ${res.status}：回應非 JSON（請重啟 server）`
      stats.value = null
    } else if (data.error) {
      fetchError.value = data.error
      stats.value = null
    } else {
      stats.value = data
    }
  } catch (err) {
    fetchError.value = err.message || '網路錯誤'
    stats.value = null
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
}

// Fetch when panel opens
watch(open, val => {
  if (val) {
    lastResult.value = null
    fetchError.value = null
    fetchStats()
  }
})

// ── Clear actions ─────────────────────────────────────────────────────────────

async function clearStale() {
  clearing.value  = 'stale'
  lastResult.value = null
  try {
    const res  = await fetch('/api/logs/clear', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'stale', olderThanDays: olderThanDays.value }),
    })
    const data = await res.json()
    lastResult.value = data.ok
      ? { ok: true,  msg: `已刪除 ${data.deleted} 個檔案` }
      : { ok: false, msg: data.error || '清除失敗' }
    if (data.ok) fetchStats()
  } catch {
    lastResult.value = { ok: false, msg: '請求失敗' }
  } finally {
    clearing.value = null
  }
}

async function confirmClearAll() {
  if (!window.confirm('確定要刪除所有 log 檔案嗎？此操作無法復原。')) return
  clearing.value   = 'all'
  lastResult.value = null
  try {
    const res  = await fetch('/api/logs/clear', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'all' }),
    })
    const data = await res.json()
    lastResult.value = data.ok
      ? { ok: true,  msg: `已刪除全部 ${data.deleted} 個檔案` }
      : { ok: false, msg: data.error || '清除失敗' }
    if (data.ok) fetchStats()
  } catch {
    lastResult.value = { ok: false, msg: '請求失敗' }
  } finally {
    clearing.value = null
  }
}
</script>
