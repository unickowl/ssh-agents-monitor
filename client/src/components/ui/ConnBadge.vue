<template>
  <span :class="[baseClass, variantClass]" class="font-mono text-[11px] px-2 py-1 rounded border">
    {{ icon }}<span class="conn-label">{{ ' ' + label }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ status: { type: String, default: 'disconnected' } })

const baseClass = 'inline-flex items-center gap-1 whitespace-nowrap'

const MAP = {
  connected:    { icon: '●', label: 'SSH 已連接', cls: 'bg-green-500/10 text-green-400 border-green-500/40' },
  demo:         { icon: '◈', label: 'DEMO 模式',  cls: 'bg-primary/10 text-primary border-primary/40' },
  error:        { icon: '✕', label: '連接錯誤',   cls: 'bg-destructive/10 text-destructive border-destructive/40' },
  disconnected: { icon: '○', label: '未連接',      cls: 'bg-muted text-muted-foreground border-border' },
}

const variantClass = computed(() => MAP[props.status]?.cls ?? MAP.disconnected.cls)
const icon         = computed(() => MAP[props.status]?.icon ?? '○')
const label        = computed(() => MAP[props.status]?.label ?? props.status)
</script>
