<template>
  <span class="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-1
               rounded border border-border bg-muted text-foreground">
    <span :style="dotStyle" class="w-1.5 h-1.5 rounded-full animate-status-pulse shrink-0" />
    {{ value }}<span class="stat-label"> {{ label }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ dot: String, label: String, value: Number })

const DOT_COLOR = {
  running:  'hsl(var(--s-running))',
  waiting:  'hsl(var(--s-waiting))',
  error:    'hsl(var(--s-error))',
  complete: 'hsl(var(--s-complete))',
  idle:     'hsl(var(--s-idle))',
}

const dotStyle = computed(() => {
  const color = DOT_COLOR[props.dot] ?? DOT_COLOR.idle
  const glow  = props.dot && props.dot !== 'idle' ? `0 0 5px ${color}` : 'none'
  return { background: color, boxShadow: glow }
})
</script>
