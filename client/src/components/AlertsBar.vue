<template>
  <div v-if="alertAgents.length" class="px-4 sm:px-6 pt-3 space-y-2">
    <TransitionGroup name="slide" tag="div" class="space-y-2">
      <div v-for="a in alertAgents" :key="a.id"
        :class="a.urgent ? 'border-destructive/60 bg-destructive/5' : 'border-yellow-500/50 bg-yellow-500/5'"
        class="flex items-start gap-3 rounded-md border-l-4 border border-border px-3 py-2.5 animate-slide-down">

        <span class="text-base mt-0.5 shrink-0">{{ a.urgent ? '🚨' : '⚠️' }}</span>

        <div class="flex-1 min-w-0">
          <p class="font-mono text-[11px] text-muted-foreground truncate">
            {{ customNames[a.id] || a.task || a.id }}
          </p>
          <p class="text-sm text-foreground mt-0.5">{{ a.attentionReason }}</p>
        </div>

        <button @click="dismiss(a.id)"
          class="shrink-0 text-xs text-muted-foreground border border-border rounded px-2 py-1
                 hover:border-muted-foreground hover:text-foreground transition-colors font-mono">
          忽略
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useStore } from '@/composables/useStore'

const { alertAgents, customNames } = useStore()

async function dismiss(agentId) {
  await fetch(`/api/agents/${agentId}/dismiss`, { method: 'POST' })
}
</script>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: all 0.25s ease; }
.slide-enter-from { opacity: 0; transform: translateY(-4px); }
.slide-leave-to   { opacity: 0; transform: translateY(-4px); }
</style>
