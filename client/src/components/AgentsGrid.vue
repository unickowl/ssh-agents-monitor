<template>
  <main class="px-4 sm:px-6 py-4">

    <!-- Empty state: no agents at all -->
    <div v-if="!hasAny" class="flex flex-col items-center justify-center py-24 text-center">
      <span class="text-5xl mb-4">📭</span>
      <h2 class="text-lg font-semibold text-foreground mb-1">尚無 Agent 資料</h2>
      <p class="text-sm text-muted-foreground max-w-sm">
        確認遠端 <code class="text-primary">{{ logDir }}</code> 目錄中有 <code class="text-primary">.jsonl</code> 日誌檔，
        或檢查 SSH 連線設定。
      </p>
    </div>

    <!-- Empty state: agents exist but all hidden -->
    <div v-else-if="visibleAgents.length === 0" class="flex flex-col items-center justify-center py-24 text-center">
      <span class="text-5xl mb-4">✅</span>
      <h2 class="text-lg font-semibold text-foreground mb-1">目前沒有活躍的 Agent</h2>
      <p class="text-sm text-muted-foreground mb-4">{{ hiddenMsg }}</p>
      <div class="flex gap-2 flex-wrap justify-center">
        <button v-if="staleCnt > 0" @click="showStale = true"
          class="btn btn-outline text-xs">顯示舊 session</button>
        <button v-if="hiddenCnt > 0" @click="showHidden = true"
          class="btn btn-outline text-xs">顯示已隱藏</button>
      </div>
    </div>

    <!-- Agent grid -->
    <TransitionGroup v-else name="card" tag="div"
      class="grid gap-3 items-start grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(360px,1fr))]">
      <AgentCard
        v-for="a in visibleAgents" :key="a.id"
        :agent="a"
        @hide="toggleHide" />
    </TransitionGroup>

  </main>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from '@/composables/useStore'
import AgentCard from './AgentCard.vue'

const { agents, visibleAgents, staleCnt, hiddenCnt, showStale, showHidden, logDir, toggleHide } = useStore()

const hasAny = computed(() => Object.keys(agents).length > 0)
const hiddenMsg = computed(() => {
  const parts = []
  if (staleCnt.value > 0)  parts.push(`${staleCnt.value} 個舊 session`)
  if (hiddenCnt.value > 0) parts.push(`${hiddenCnt.value} 個已手動隱藏`)
  return parts.join('、') + (parts.length ? ' 已隱藏。' : '')
})
</script>

<style scoped>
.card-enter-active, .card-leave-active { transition: all 0.3s ease; }
.card-enter-from { opacity: 0; transform: scale(0.97) translateY(4px); }
.card-leave-to   { opacity: 0; transform: scale(0.97); }
.card-move       { transition: transform 0.3s ease; }
</style>
