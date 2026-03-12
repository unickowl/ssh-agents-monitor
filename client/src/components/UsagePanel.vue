<template>
  <div v-if="usage" class="px-4 sm:px-6 pt-3">
    <div class="rounded-md border border-border bg-card px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
      <span class="font-mono text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">24h 用量</span>

      <div class="flex flex-wrap gap-x-5 gap-y-1.5 flex-1">
        <div v-for="s in stats" :key="s.label" class="flex flex-col">
          <span :class="s.color" class="font-mono text-sm font-medium leading-tight">{{ s.value }}</span>
          <span class="font-mono text-[10px] text-muted-foreground">{{ s.label }}</span>
        </div>
      </div>

      <span class="font-mono text-[10px] text-muted-foreground ml-auto shrink-0">
        {{ fetchTime }}{{ usage.demo ? ' · 範例資料' : '' }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from '@/composables/useStore'
import { formatRelative } from '@/lib/utils'

const { usage } = useStore()

function fmt(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'k'
  return String(n)
}

const stats = computed(() => usage.value ? [
  { label: 'Input',        value: fmt(usage.value.inputTokens),       color: 'text-primary' },
  { label: 'Output',       value: fmt(usage.value.outputTokens),      color: 'text-green-400' },
  { label: 'Cache write',  value: fmt(usage.value.cacheWriteTokens),  color: 'text-yellow-400' },
  { label: 'Cache read',   value: fmt(usage.value.cacheReadTokens),   color: 'text-muted-foreground' },
] : [])

const fetchTime = computed(() =>
  usage.value?.fetchedAt ? formatRelative(usage.value.fetchedAt) : ''
)
</script>
