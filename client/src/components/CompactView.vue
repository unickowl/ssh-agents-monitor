<template>
  <div class="compact-view min-h-screen bg-background text-foreground"
    :class="{ 'compact-alert-glow': hasAlertAgents }">

    <!-- Compact Header -->
    <header class="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/90 backdrop-blur select-none cursor-move" style="-webkit-app-region: drag">
      <span class="text-[11px] font-mono text-muted-foreground flex-1 min-w-0 truncate"
        style="-webkit-app-region: no-drag">
        {{ summaryText }}
      </span>
      <button @click="$emit('expand')"
        title="展開完整模式"
        class="icon-btn shrink-0"
        style="-webkit-app-region: no-drag">
        <MaximizeIcon :size="13" />
      </button>
    </header>

    <!-- Agent List -->
    <ul class="divide-y divide-border/50 p-2">
      <li v-for="agent in visibleAgents" :key="agent.id"
        class="compact-row px-3 py-1.5 cursor-pointer bg-card hover:bg-muted/40 transition-colors border rounded"
        :class="{
          'bg-amber-500/10': agent.status === 'waiting',
          'bg-red-500/10': agent.status === 'error',
        }"
        @click="toggleExpand(agent.id)"
        @dblclick="$emit('jump-to-agent', agent.id)">

        <!-- Main row -->
        <div class="flex items-center gap-2 min-w-0">
          <span class="status-dot shrink-0" :class="'dot-' + agent.status" />
          <span class="text-xs font-medium truncate flex-1 min-w-0">
            {{ customNames[agent.id] || agent.id }}
          </span>
          <span class="text-[10px] text-muted-foreground shrink-0 max-w-[120px] truncate">
            {{ statusText(agent) }}
          </span>
        </div>

        <!-- Expanded details -->
        <div v-if="expandedId === agent.id" class="mt-1.5 pl-4 text-[10px] text-muted-foreground space-y-0.5">
          <div v-if="agent.currentStep">
            <span class="text-foreground/70">步驟：</span>{{ agent.currentStep }}
          </div>
          <div v-if="agent.attentionReason">
            <span class="text-amber-400">原因：</span>{{ agent.attentionReason }}
          </div>
          <div v-if="agent.recentTools && agent.recentTools.length > 0">
            <span class="text-foreground/70">工具：</span>{{ agent.recentTools[0].tool }}({{ agent.recentTools[0].input }})
          </div>
        </div>
      </li>
    </ul>

    <!-- Empty state -->
    <div v-if="visibleAgents.length === 0" class="px-3 py-4 text-center text-xs text-muted-foreground">
      沒有活動中的 agent
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { MaximizeIcon } from 'lucide-vue-next'
import { useStore } from '@/composables/useStore'

defineEmits(['expand', 'jump-to-agent'])

const { visibleAgents, counts, customNames } = useStore()

const expandedId = ref(null)

const summaryText = computed(() => {
  const c = counts.value
  const parts = []
  if (c.running)  parts.push(`${c.running} running`)
  if (c.waiting)  parts.push(`${c.waiting} waiting`)
  if (c.error)    parts.push(`${c.error} error`)
  if (c.complete) parts.push(`${c.complete} done`)
  return parts.join(' · ') || 'No agents'
})

const hasAlertAgents = computed(() => {
  return counts.value.waiting > 0 || counts.value.error > 0
})

function statusText(agent) {
  if (agent.status === 'waiting') return agent.attentionReason || '等待中'
  if (agent.status === 'error')   return agent.error || '錯誤'
  if (agent.status === 'complete') return '完成'
  return agent.currentStep || '執行中'
}

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<style scoped>
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.dot-running  { background: #22c55e; box-shadow: 0 0 4px #22c55e80; }
.dot-waiting  { background: #f59e0b; box-shadow: 0 0 4px #f59e0b80; }
.dot-error    { background: #ef4444; box-shadow: 0 0 4px #ef444480; }
.dot-complete { background: #6b7280; }
.dot-idle     { background: #4b5563; }

.compact-alert-glow {
  box-shadow: inset 0 0 20px rgba(245, 158, 11, 0.15), inset 0 0 40px rgba(239, 68, 68, 0.1);
}
</style>
