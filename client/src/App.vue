<template>
  <div class="min-h-screen bg-background text-foreground font-sans">

    <!-- Setup Wizard -->
    <SetupWizard v-if="showSetup" :can-close="configuredOnce" @close="closeSetup" @done="onSetupDone" />

    <!-- Dashboard -->
    <template v-else>
      <AppHeader @open-settings="openSettings" />
      <UsagePanel />
      <AgentsGrid />
    </template>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useWebSocket }      from '@/composables/useWebSocket'
import { useNotifications }  from '@/composables/useNotifications'
import SetupWizard from '@/components/SetupWizard.vue'
import AppHeader   from '@/components/AppHeader.vue'
import UsagePanel  from '@/components/UsagePanel.vue'
import AgentsGrid  from '@/components/AgentsGrid.vue'

const showSetup      = ref(false)
const configuredOnce = ref(false)

const { connect }           = useWebSocket()
const { requestPermission } = useNotifications()

function openSettings() { showSetup.value = true }
function closeSetup()   { showSetup.value = false }
function onSetupDone()  {
  configuredOnce.value = true
  showSetup.value = false
  connect()
}

onMounted(async () => {
  requestPermission()
  try {
    const cfg = await fetch('/api/config').then(r => r.json())
    if (cfg.configured) { configuredOnce.value = true; connect() }
    else                { showSetup.value = true }
  } catch {
    showSetup.value = true
  }
})
</script>
