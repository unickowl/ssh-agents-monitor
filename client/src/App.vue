<template>
  <div class="min-h-screen bg-background text-foreground font-sans">

    <!-- Setup Wizard -->
    <SetupWizard v-if="showSetup" :can-close="configuredOnce" @close="closeSetup" @done="onSetupDone" />

    <!-- Compact Mode -->
    <CompactView v-else-if="isCompact"
      @expand="setCompact(false)"
      @jump-to-agent="jumpToAgent" />

    <!-- Dashboard (Full Mode) -->
    <template v-else>
      <AppHeader @open-settings="openSettings" />
      <UsagePanel />
      <AgentsGrid ref="agentsGridRef" />
    </template>

  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useWebSocket }      from '@/composables/useWebSocket'
import { useNotifications }  from '@/composables/useNotifications'
import { useCompactMode }    from '@/composables/useCompactMode'
import SetupWizard from '@/components/SetupWizard.vue'
import AppHeader   from '@/components/AppHeader.vue'
import UsagePanel  from '@/components/UsagePanel.vue'
import AgentsGrid  from '@/components/AgentsGrid.vue'
import CompactView from '@/components/CompactView.vue'

const showSetup      = ref(false)
const configuredOnce = ref(false)
const agentsGridRef  = ref(null)

const { connect }           = useWebSocket()
const { requestPermission } = useNotifications()
const { isCompact, setCompact } = useCompactMode()

function openSettings() { showSetup.value = true }
function closeSetup()   { showSetup.value = false }
function onSetupDone()  {
  configuredOnce.value = true
  showSetup.value = false
  connect()
}

async function jumpToAgent(agentId) {
  await setCompact(false)
  await nextTick()
  const el = document.getElementById(`agent-${agentId}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(async () => {
  requestPermission()

  // Listen for notifications from Electron main process
  if (window.electronAPI?.onShowNotification) {
    window.electronAPI.onShowNotification(({ title, body }) => {
      new Notification(title, { body })
    })
  }

  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    if (cfg.configured) { configuredOnce.value = true; connect() }
    else                { showSetup.value = true }
  } catch {
    showSetup.value = true
  }
})
</script>
