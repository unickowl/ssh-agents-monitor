<template>
  <div v-if="usage" class="px-4 sm:px-6 pt-3">
    <div class="rounded-md border border-border bg-card px-4 py-3 flex flex-col gap-2">

      <!-- ── Header: title / badge / burn rate / time ── -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">5h 用量</span>
          <span
            :title="limitBadgeTip"
            class="font-mono text-[9px] px-1.5 py-0.5 rounded border cursor-default"
            :class="limitBadgeClass"
          >{{ limitBadgeLabel }}</span>
        </div>
        <div class="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span v-if="usage.burnRate" class="tabular-nums">
            🔥 {{ fmtK(usage.burnRate) }}&thinsp;tok/min
          </span>
          <span v-if="usage.costRate > 0" class="tabular-nums opacity-50">
            ${{ usage.costRate.toFixed(4) }}/min
          </span>
          <span class="opacity-30">{{ fetchTime }}{{ usage.demo ? ' · demo' : '' }}</span>
        </div>
      </div>

      <!--
        ── Metric grid ──
        4 columns, all 3 rows share the same column widths:
          [label 3rem] [bar 1fr] [primary 5rem] [detail auto]
      -->
      <div
        class="grid items-center gap-x-3 gap-y-2"
        style="grid-template-columns: 3rem 1fr 5rem auto"
      >
        <!-- Token row -->
        <span class="font-mono text-[10px] text-muted-foreground">Token</span>
        <div class="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-700"
            :style="{ width: pctClamped + '%', background: tokenBarColor }"
          />
        </div>
        <span
          class="font-mono text-[10px] font-semibold tabular-nums text-right"
          :style="{ color: tokenBarColor }"
        >{{ pctClamped }}%</span>
        <span class="font-mono text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
          {{ fmt(usage.totalTokens) }}&thinsp;/&thinsp;{{ fmt(usage.limit) }}<span class="opacity-40 ml-1">[{{ planLabel }}]</span>
        </span>

        <!-- Reset row -->
        <span class="font-mono text-[10px] text-muted-foreground">Reset</span>
        <div class="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-700 bg-muted-foreground/25"
            :style="{ width: windowUsedPct + '%' }"
          />
        </div>
        <span class="font-mono text-[10px] text-muted-foreground tabular-nums text-right">
          {{ resetCountdown }}
        </span>
        <span class="font-mono text-[10px] text-muted-foreground/40 tabular-nums whitespace-nowrap">
          at {{ resetClockTime }}
        </span>

        <!-- Model row -->
        <span class="font-mono text-[10px] text-muted-foreground">Model</span>
        <div class="flex h-1.5 rounded-full overflow-hidden">
          <div
            v-for="m in modelBars" :key="m.name"
            class="h-full transition-all duration-700"
            :style="{ width: m.pct + '%', background: m.color }"
          />
        </div>
        <span class="font-mono text-[10px] text-muted-foreground tabular-nums text-right whitespace-nowrap">
          {{ modelPrimary }}
        </span>
        <span class="font-mono text-[10px] text-muted-foreground/50 tabular-nums whitespace-nowrap">
          {{ modelSecondary }}
        </span>
      </div>

      <!-- ── Footer: cost estimate + runout prediction ── -->
      <div
        v-if="usage.costUsd || runoutTime"
        class="flex items-center justify-between pt-1.5 border-t border-border/30"
      >
        <span class="font-mono text-[10px] text-muted-foreground">
          <span class="opacity-40">cost est.&nbsp;</span>
          <span class="text-green-400/70">~${{ usage.costUsd?.toFixed(2) ?? '0.00' }}</span>
        </span>
        <span v-if="runoutTime" class="font-mono text-[10px]">
          <span class="text-muted-foreground opacity-40">預測超量&nbsp;</span>
          <span class="text-yellow-400">{{ runoutTime }}</span>
        </span>
      </div>

    </div>
  </div>
</template>

<script setup>
import { computed, ref, onUnmounted } from 'vue'
import { useStore } from '@/composables/useStore'
import { formatRelative } from '@/lib/utils'

const { usage } = useStore()

// ── clock tick for countdowns ────────────────────────────────────────────
const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 30_000)
onUnmounted(() => clearInterval(timer))

// ── formatters ────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
function fmtK(n) {
  if (!n) return '0'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
function fmtCountdown(ms) {
  if (ms <= 0) return '已重置'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
function fmtClock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ── token bar ─────────────────────────────────────────────────────────────
const pctClamped   = computed(() => Math.min(100, usage.value?.pct ?? 0))
const tokenBarColor = computed(() => {
  const p = pctClamped.value
  if (p >= 90) return 'hsl(var(--s-error))'
  if (p >= 70) return 'hsl(var(--s-waiting))'
  return 'hsl(var(--primary))'
})

// ── plan / limit badge ────────────────────────────────────────────────────
const PLAN_DISPLAY = { pro: 'Pro', max5: 'Max5', max20: 'Max20' }
const planLabel = computed(() => PLAN_DISPLAY[usage.value?.plan] ?? usage.value?.plan ?? '—')

const limitBadgeLabel = computed(() => {
  const src = usage.value?.limitSrc
  if (src === 'p90')  return 'dynamic · P90'
  if (src === 'env')  return 'custom'
  if (src === 'plan') return `fixed · ${planLabel.value}`
  return 'est.'
})
const limitBadgeClass = computed(() => {
  const src = usage.value?.limitSrc
  if (src === 'p90')  return 'border-primary/40 text-primary/70'
  if (src === 'env')  return 'border-green-500/40 text-green-400/70'
  return 'border-border text-muted-foreground/50'
})
const limitBadgeTip = computed(() => {
  const src = usage.value?.limitSrc
  if (src === 'p90')  return '根據歷史撞限紀錄自動計算（P90），非官方數字'
  if (src === 'env')  return '來自 CLAUDE_TOKEN_LIMIT 環境變數'
  return '固定方案上限，非官方確認數字'
})

// ── reset bar ─────────────────────────────────────────────────────────────
const windowUsedPct = computed(() => {
  const r = usage.value?.resetAt
  if (!r) return 0
  const resetMs  = new Date(r).getTime()
  const windowMs = 5 * 3600_000
  const elapsed  = now.value - (resetMs - windowMs)
  return Math.min(100, Math.max(0, Math.round(elapsed / windowMs * 100)))
})
const resetCountdown  = computed(() => {
  const r = usage.value?.resetAt
  if (!r) return '—'
  return fmtCountdown(new Date(r).getTime() - now.value)
})
const resetClockTime = computed(() => fmtClock(usage.value?.resetAt))

// ── model distribution ────────────────────────────────────────────────────
const MODEL_COLORS = {
  sonnet: 'hsl(var(--primary))',
  opus:   'hsl(271 80% 65%)',
  haiku:  'hsl(142 70% 55%)',
}
const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : ''

const modelBars = computed(() => {
  const m = usage.value?.models
  if (!m) return []
  return Object.entries(m)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => ({ name: k, pct: v, color: MODEL_COLORS[k] ?? '#888' }))
})

// primary column: dominant model name + %
const modelPrimary = computed(() => {
  const top = modelBars.value[0]
  return top ? `${capitalize(top.name)} ${top.pct}%` : '—'
})
// secondary column: remaining models
const modelSecondary = computed(() =>
  modelBars.value.slice(1).map(m => `${m.pct}% ${capitalize(m.name)}`).join(' · ')
)

// ── runout prediction ──────────────────────────────────────────────────────
const runoutTime = computed(() => fmtClock(usage.value?.projectedRunoutAt))

// ── fetch time ────────────────────────────────────────────────────────────
const fetchTime = computed(() =>
  usage.value?.fetchedAt ? formatRelative(usage.value.fetchedAt) : ''
)
</script>
