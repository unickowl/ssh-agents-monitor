<template>
  <div :class="cardClass" class="group relative rounded-lg border bg-card text-card-foreground overflow-hidden transition-all duration-300 self-start card-tech">

    <!-- Action buttons (visible on hover) -->
    <div class="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
      <button @click="startRename" title="自訂名稱"
        class="icon-btn-sm">✏</button>
      <button @click="$emit('hide', agent.id)" title="隱藏此卡片"
        class="icon-btn-sm text-muted-foreground hover:text-destructive">×</button>
    </div>

    <!-- ── Card Header ─────────────────────────────────────── -->
    <div class="flex items-start gap-3 px-4 pt-3.5 pb-3 border-b border-border">
      <!-- Status icon -->
      <div :class="iconBg" class="w-8 h-8 rounded-md flex items-center justify-center text-base shrink-0 mt-0.5">
        <span :class="{ 'animate-spin-slow': agent.status === 'running' }">{{ statusIcon }}</span>
      </div>

      <!-- Title block -->
      <div class="flex-1 min-w-0 pr-14">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-mono text-[11px] text-muted-foreground truncate">{{ agent.id }}</span>
          <span v-if="agent.isStale" class="font-mono text-[10px] text-muted-foreground border border-border rounded px-1 py-0 leading-tight">
            舊 · {{ staleTime }}
          </span>
        </div>

        <!-- Rename input or task name -->
        <div v-if="renaming">
          <input ref="renameInput" v-model="renameVal"
            class="input w-full text-sm mt-1"
            @keyup.enter="commitRename" @keyup.escape="renaming = false" @blur="commitRename" />
        </div>
        <p v-else class="text-sm font-medium text-foreground truncate mt-0.5 cursor-text" @dblclick="startRename">
          {{ displayName }}
        </p>
        <p v-if="origTask" class="text-xs text-muted-foreground truncate">{{ origTask }}</p>
      </div>

      <!-- Status pill -->
      <span :class="pillClass" class="shrink-0 font-mono text-[11px] px-2 py-0.5 rounded-full border mt-1">
        {{ statusLabel }}
      </span>
    </div>

    <!-- ── Card Body ───────────────────────────────────────── -->
    <div class="px-4 py-3 space-y-3">

      <!-- Spec chip -->
      <div v-if="agent.spec" class="inline-flex items-center gap-1 text-xs text-muted-foreground border border-border rounded px-2 py-0.5 font-mono">
        📄 {{ agent.spec }}
      </div>

      <!-- Progress (tasks-based) -->
      <div v-if="hasTasks" class="space-y-1.5">
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground truncate flex-1 mr-2">{{ currentStep }}</span>
          <span class="font-mono text-muted-foreground shrink-0">{{ taskDone }}/{{ taskTotal }} &nbsp;{{ taskPct }}%</span>
        </div>
        <div class="h-1 rounded-full bg-muted overflow-hidden">
          <div :style="{ width: taskPct + '%', background: pfColor }"
            class="h-full rounded-full transition-all duration-500" />
        </div>
      </div>

      <!-- Current step (no tasks) -->
      <p v-else-if="currentStep" class="text-xs text-muted-foreground">{{ currentStep }}</p>

      <!-- Task list -->
      <div v-if="hasTasks" class="space-y-1">
        <div class="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span class="uppercase tracking-wider">任務清單</span>
          <span class="font-mono">{{ taskDone }}/{{ taskTotal }} 完成{{ taskInProg > 0 ? ` · ${taskInProg} 進行中` : '' }}</span>
        </div>
        <div class="space-y-0.5 max-h-40 overflow-y-auto pr-1">
          <div v-for="t in sortedTasks" :key="t.content"
            :class="taskRowClass(t.status)"
            class="flex items-start gap-2 text-xs rounded px-1.5 py-1">
            <span :class="taskIconClass(t.status)" class="shrink-0 font-mono mt-0.5">{{ taskIcon(t.status) }}</span>
            <span class="text-foreground/90">{{ t.content }}</span>
          </div>
        </div>
      </div>

      <!-- Recent tools -->
      <div v-if="agent.recentTools?.length" class="space-y-1">
        <div class="flex items-center justify-between">
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground">最近工具呼叫</p>
          <button v-if="agent.recentTools.length > TOOLS_LIMIT"
            @click="showAllTools = !showAllTools"
            class="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors">
            {{ showAllTools ? '收起 ▲' : `+${agent.recentTools.length - TOOLS_LIMIT} 更多 ▼` }}
          </button>
        </div>
        <div class="space-y-0.5">
          <div v-for="t in displayedTools" :key="t.time + t.tool"
            class="flex items-center gap-2 text-xs text-muted-foreground">
            <span class="font-mono text-primary shrink-0">{{ t.tool }}</span>
            <span class="truncate flex-1">{{ t.input }}</span>
            <span class="font-mono text-[10px] shrink-0">{{ relTime(t.time) }}</span>
          </div>
        </div>
      </div>

      <!-- Attention box -->
      <div v-if="agent.needsAttention"
        :class="agent.status === 'error' ? 'border-destructive/50 bg-destructive/5' : 'border-yellow-500/40 bg-yellow-500/5'"
        class="rounded-md border px-3 py-2">
        <p class="text-xs font-semibold mb-0.5">{{ agent.urgent ? '🚨 需要介入' : '⚠ 等待確認' }}</p>
        <p class="text-xs text-foreground/80">{{ agent.attentionReason }}</p>
      </div>

      <!-- Summary (complete) -->
      <div v-if="agent.status === 'complete' && agent.summary"
        class="rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs text-green-400">
        ✓ {{ agent.summary }}
      </div>

    </div>

    <!-- ── Card Footer ─────────────────────────────────────── -->
    <div class="flex items-center justify-between px-4 py-2 border-t border-border">
      <span class="font-mono text-[10px] text-muted-foreground">⏱ {{ elapsed }}</span>
      <span class="font-mono text-[10px] text-muted-foreground">最後活動 {{ lastActive }}</span>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { useStore } from '@/composables/useStore'
import { formatElapsed, formatRelative, STATUS_LABEL, DEFAULT_STEP } from '@/lib/utils'

const props  = defineProps({ agent: { type: Object, required: true } })
const emit   = defineEmits(['hide'])
const { customNames, setCustomName } = useStore()

// ── Tool calls truncation ────────────────────────────────────────────────────
const TOOLS_LIMIT   = 3
const showAllTools  = ref(false)
const displayedTools = computed(() =>
  showAllTools.value
    ? props.agent.recentTools
    : props.agent.recentTools?.slice(0, TOOLS_LIMIT)
)

// ── Rename ───────────────────────────────────────────────────────────────────
const renaming    = ref(false)
const renameVal   = ref('')
const renameInput = ref(null)

function startRename() {
  renameVal.value = customNames[props.agent.id] || props.agent.task || ''
  renaming.value  = true
  nextTick(() => renameInput.value?.select())
}
function commitRename() {
  setCustomName(props.agent.id, renameVal.value)
  renaming.value = false
}

// ── Display values ───────────────────────────────────────────────────────────
const displayName = computed(() => customNames[props.agent.id] || props.agent.task || '未知任務')
const origTask    = computed(() => {
  const cn = customNames[props.agent.id]
  return cn && props.agent.task && props.agent.task !== cn ? props.agent.task : ''
})

const statusLabel = computed(() => STATUS_LABEL[props.agent.status] ?? props.agent.status)
const currentStep = computed(() => props.agent.currentStep || DEFAULT_STEP[props.agent.status] || '')
const elapsed     = computed(() => props.agent.startTime    ? formatElapsed(props.agent.startTime)    : '—')
const lastActive  = computed(() => props.agent.lastActivity ? formatRelative(props.agent.lastActivity) : '—')
const staleTime   = computed(() => props.agent.fileModifiedAt ? formatRelative(props.agent.fileModifiedAt) : '')

function relTime(t) { return t ? formatRelative(t) : '' }

// ── Tasks ────────────────────────────────────────────────────────────────────
const hasTasks  = computed(() => props.agent.tasks?.length > 0)
const taskDone  = computed(() => props.agent.tasks?.filter(t => t.status === 'completed').length ?? 0)
const taskInProg = computed(() => props.agent.tasks?.filter(t => t.status === 'in_progress').length ?? 0)
const taskTotal = computed(() => props.agent.tasks?.length ?? 0)
const taskPct   = computed(() => taskTotal.value ? Math.round(taskDone.value / taskTotal.value * 100) : 0)

const sortedTasks = computed(() => {
  if (!props.agent.tasks) return []
  return [
    ...props.agent.tasks.filter(t => t.status === 'in_progress'),
    ...props.agent.tasks.filter(t => t.status === 'pending'),
    ...props.agent.tasks.filter(t => t.status === 'completed'),
  ]
})

function taskIcon(s)      { return { completed: '✓', in_progress: '▶', pending: '○' }[s] ?? '○' }
function taskIconClass(s) { return { completed: 'text-green-400', in_progress: 'text-primary', pending: 'text-muted-foreground' }[s] ?? '' }
function taskRowClass(s)  { return { completed: 'opacity-50', in_progress: 'bg-primary/8', pending: '' }[s] ?? '' }

// ── Status colors (inline — avoids Tailwind JIT purge of dynamic class names) ─
const STATUS_COLOR = {
  running:  'hsl(var(--s-running))',
  waiting:  'hsl(var(--s-waiting))',
  error:    'hsl(var(--s-error))',
  complete: 'hsl(var(--s-complete))',
  idle:     'hsl(var(--s-idle))',
}
const pfColor = computed(() => STATUS_COLOR[props.agent.status] ?? STATUS_COLOR.idle)

// ── Status styling ───────────────────────────────────────────────────────────
const STATUS_ICON = { running: '⚙', waiting: '⏸', error: '✕', complete: '✓', idle: '—', warning: '⚠', unknown: '?' }
const statusIcon  = computed(() => STATUS_ICON[props.agent.status] ?? '?')

const iconBg = computed(() => ({
  running:  'bg-running-dim  text-running',
  waiting:  'bg-waiting-dim  text-waiting',
  error:    'bg-error-dim    text-error',
  complete: 'bg-complete-dim text-complete',
  idle:     'bg-muted        text-muted-foreground',
}[props.agent.status] ?? 'bg-muted text-muted-foreground'))

const pillClass = computed(() => ({
  running:  'bg-running-dim  text-running  border-running/30',
  waiting:  'bg-waiting-dim  text-waiting  border-waiting/30',
  error:    'bg-error-dim    text-error    border-error/30',
  complete: 'bg-complete-dim text-complete border-complete/30',
  idle:     'bg-muted        text-muted-foreground border-border',
}[props.agent.status] ?? 'bg-muted text-muted-foreground border-border'))

const cardClass = computed(() => {
  if (props.agent.urgent)         return 'border-destructive animate-urgent-glow shadow-[0_0_20px_rgba(239,68,68,0.14)]'
  if (props.agent.needsAttention) return 'border-yellow-500/60 shadow-[0_0_18px_rgba(245,158,11,0.10)]'
  if (props.agent.status === 'running') return 'border-primary/40 shadow-running'
  return 'border-border'
})
</script>
