<template>
  <header class="sticky top-0 z-40 flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3
                 border-b border-border bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75
                 header-tech">

    <!-- Logo + version -->
    <span class="font-mono text-xs font-semibold tracking-widest uppercase shrink-0 select-none">
      <span class="text-muted-foreground">▸</span>
      <span class="text-primary">claude</span><span class="text-muted-foreground opacity-60">/</span><span class="text-foreground">agents</span>
      <span class="text-[9px] font-normal text-muted-foreground/50 ml-1">v{{ appVersion }}</span>
    </span>

    <!-- Connection badge -->
    <ConnBadge :status="connection" class="shrink-0" />

    <!-- Spacer -->
    <div class="flex-1 min-w-0" />

    <!-- Stats row -->
    <div class="flex flex-wrap items-center gap-1.5 text-xs font-mono">
      <StatBadge v-for="s in statItems" :key="s.key" :dot="s.dot" :label="s.label" :value="s.value" />

      <button v-if="staleCnt > 0" @click="showStale = !showStale"
        class="btn-ghost-xs" :class="{ 'text-primary': showStale }">
        {{ showStale ? '▼' : '▷' }} ({{ staleCnt }})<span class="stat-label"> 舊 session</span>
      </button>
      <button v-if="hiddenCnt > 0" @click="showHidden = !showHidden"
        class="btn-ghost-xs" :class="{ 'text-primary': showHidden }">
        {{ showHidden ? '▼' : '▷' }} ({{ hiddenCnt }})<span class="stat-label"> 已隱藏</span>
      </button>
    </div>

    <!-- Poll time -->
    <span v-if="pollTime" class="hidden xl:block font-mono text-[10px] text-muted-foreground shrink-0">
      {{ pollTime }}
    </span>

    <!-- Bell (alerts floating panel) -->
    <AlertsPanel class="ml-1" />

    <!-- Test notification - dev only -->
    <button v-if="isDev && isElectron" @click="testNotify"
      title="測試通知"
      class="icon-btn text-muted-foreground hover:text-amber-400">
      <BellRingIcon :size="15" />
    </button>

    <!-- Pin (Always on Top) - Electron only -->
    <button v-if="isElectron" @click="togglePin"
      :title="isPinned ? '取消置頂' : '視窗置頂'"
      class="icon-btn" :class="{ 'text-primary': isPinned }">
      <PinIcon :size="15" />
    </button>

    <!-- Compact mode toggle - Electron only -->
    <button v-if="isElectron" @click="toggleCompact"
      title="精簡模式"
      class="icon-btn">
      <MinimizeIcon :size="15" />
    </button>

    <!-- Settings -->
    <button @click="$emit('open-settings')" title="SSH 設定" class="icon-btn">
      <SettingsIcon :size="15" />
    </button>

    <!-- Theme toggle (auto → light → dark) -->
    <button @click="toggle" :title="themeTitle" class="icon-btn">
      <MonitorIcon v-if="theme === 'auto'" :size="15" />
      <SunIcon v-else-if="theme === 'light'" :size="15" />
      <MoonIcon v-else :size="15" />
    </button>

  </header>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { SettingsIcon, SunIcon, MoonIcon, MonitorIcon, PinIcon, MinimizeIcon, BellRingIcon } from 'lucide-vue-next'
import { useStore }    from '@/composables/useStore'
import { useTheme }    from '@/composables/useTheme'
import { useCompactMode } from '@/composables/useCompactMode'
import ConnBadge   from './ui/ConnBadge.vue'
import StatBadge   from './ui/StatBadge.vue'
import AlertsPanel from './AlertsPanel.vue'

defineEmits(['open-settings'])

const { connection, pollTime, counts, staleCnt, hiddenCnt, showStale, showHidden } = useStore()
const { theme, toggle } = useTheme()

const themeTitle = computed(() => {
  if (theme.value === 'auto')  return '主題：自動（跟隨系統）'
  if (theme.value === 'light') return '主題：亮色'
  return '主題：暗色'
})
const { isElectron, toggleCompact } = useCompactMode()

const isDev = import.meta.env.DEV
const isPinned = ref(false)
const appVersion = ref(__APP_VERSION__)

onMounted(async () => {
  if (isElectron) {
    isPinned.value = await window.electronAPI.getAlwaysOnTop()
  }
})

async function togglePin() {
  isPinned.value = !isPinned.value
  await window.electronAPI.setAlwaysOnTop(isPinned.value)
}

async function testNotify() {
  await window.electronAPI.testNotification()
}

const statItems = computed(() => [
  { key: 'running',  dot: 'running',  label: '執行中', value: counts.value.running  },
  { key: 'waiting',  dot: 'waiting',  label: '等待中', value: counts.value.waiting  },
  { key: 'error',    dot: 'error',    label: '錯誤',   value: counts.value.error    },
  { key: 'complete', dot: 'complete', label: '完成',   value: counts.value.complete },
  { key: 'total',    dot: 'idle',     label: '總計',   value: counts.value.total    },
])
</script>
