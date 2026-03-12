<template>
  <!-- Bell button (lives in header, via slot/include) -->
  <div class="relative" ref="rootEl">
    <button @click="toggle" :title="open ? '關閉通知' : '查看需要介入的 Agent'"
      class="icon-btn relative">
      <BellIcon :size="15" :class="{ 'animate-status-pulse': alertAgents.length > 0 && !open }" />
      <!-- Badge -->
      <Transition name="badge">
        <span v-if="alertAgents.length > 0"
          :class="hasUrgent ? 'bg-destructive' : 'bg-yellow-500'"
          class="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5
                 text-white text-[9px] font-bold rounded-full
                 flex items-center justify-center pointer-events-none">
          {{ alertAgents.length }}
        </span>
      </Transition>
    </button>

    <!-- Floating panel — position:fixed, never in flow -->
    <Teleport to="body">
      <Transition name="panel">
        <div v-if="open"
          class="fixed top-[52px] right-3 z-50 w-80 sm:w-96
                 rounded-lg border border-border bg-card shadow-2xl
                 overflow-hidden">

          <!-- Panel header -->
          <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span class="text-xs font-semibold text-foreground tracking-wide">
              需要介入 <span class="text-muted-foreground font-normal">({{ alertAgents.length }})</span>
            </span>
            <button @click="open = false" class="text-muted-foreground hover:text-foreground transition-colors">
              <XIcon :size="14" />
            </button>
          </div>

          <!-- Alert items -->
          <div class="max-h-[60vh] overflow-y-auto divide-y divide-border">
            <TransitionGroup name="item">
              <div v-for="a in alertAgents" :key="a.id"
                :class="a.urgent
                  ? 'border-l-2 border-l-destructive bg-destructive/4'
                  : 'border-l-2 border-l-yellow-500 bg-yellow-500/4'"
                class="flex items-start gap-3 px-4 py-3">

                <span class="text-sm mt-0.5 shrink-0">{{ a.urgent ? '🚨' : '⚠️' }}</span>

                <div class="flex-1 min-w-0 space-y-0.5">
                  <p class="font-mono text-[11px] text-muted-foreground truncate">
                    {{ customNames[a.id] || a.task || a.id }}
                  </p>
                  <p class="text-sm text-foreground leading-snug">{{ a.attentionReason }}</p>
                </div>

                <button @click="dismiss(a.id)"
                  class="shrink-0 self-center text-xs text-muted-foreground
                         border border-border rounded px-2 py-1 font-mono
                         hover:border-muted-foreground hover:text-foreground transition-colors">
                  忽略
                </button>
              </div>
            </TransitionGroup>
          </div>

          <!-- Empty -->
          <div v-if="alertAgents.length === 0" class="px-4 py-6 text-center text-sm text-muted-foreground">
            目前沒有需要介入的 Agent
          </div>

        </div>
      </Transition>

      <!-- Click-outside backdrop (invisible) -->
      <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { BellIcon, XIcon } from 'lucide-vue-next'
import { useStore } from '@/composables/useStore'

const { alertAgents, customNames } = useStore()
const open     = ref(false)
const rootEl   = ref(null)
const hasUrgent = computed(() => alertAgents.value.some(a => a.urgent))

function toggle() { open.value = !open.value }

async function dismiss(agentId) {
  await fetch(`/api/agents/${agentId}/dismiss`, { method: 'POST' })
}
</script>

<style scoped>
/* Badge pop */
.badge-enter-active { transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s; }
.badge-leave-active { transition: transform 0.15s ease, opacity 0.15s; }
.badge-enter-from, .badge-leave-to { transform: scale(0); opacity: 0; }

/* Panel slide-down */
.panel-enter-active { transition: all 0.2s cubic-bezier(0.16,1,0.3,1); }
.panel-leave-active { transition: all 0.15s ease; }
.panel-enter-from { opacity: 0; transform: translateY(-8px) scale(0.97); }
.panel-leave-to   { opacity: 0; transform: translateY(-4px) scale(0.98); }

/* Alert item slide */
.item-enter-active { transition: all 0.2s ease; }
.item-leave-active { transition: all 0.15s ease; }
.item-enter-from   { opacity: 0; transform: translateX(8px); }
.item-leave-to     { opacity: 0; transform: translateX(8px); }
</style>
