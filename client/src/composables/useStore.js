import { reactive, ref, computed } from 'vue'
import { SORT_ORDER } from '@/lib/utils'

// ── Global singleton state ──────────────────────────────────────────────────
const agents      = reactive({})          // { [id]: agentState }
const usage       = ref(null)
const connection  = ref('disconnected')   // connected | demo | error | disconnected
const pollTime    = ref(null)
const logDir      = ref('/tmp/claude-agents')

// ── UI prefs — persisted to localStorage ─────────────────────────────────────
const LS_NAMES  = 'claude-monitor:customNames'
const LS_HIDDEN = 'claude-monitor:hiddenAgents'

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

const customNames  = reactive(loadJSON(LS_NAMES, {}))
const hiddenAgents = reactive(new Set(loadJSON(LS_HIDDEN, [])))
const showStale    = ref(false)
const showHidden   = ref(false)

// ── Derived ─────────────────────────────────────────────────────────────────
const alertAgents = computed(() =>
  Object.values(agents).filter(a => a.needsAttention)
)

const visibleAgents = computed(() => {
  const all = Object.values(agents)
  return all
    .filter(a => {
      if (!showStale.value  && a.isStale)              return false
      if (!showHidden.value && hiddenAgents.has(a.id)) return false
      return true
    })
    .sort((a, b) => {
      if (a.urgent && !b.urgent) return -1
      if (!a.urgent && b.urgent) return  1
      return (SORT_ORDER[a.status] ?? 9) - (SORT_ORDER[b.status] ?? 9)
    })
})

const staleCnt  = computed(() => Object.values(agents).filter(a => a.isStale).length)
const hiddenCnt = computed(() => [...hiddenAgents].filter(id => agents[id] && !agents[id].isStale).length)

const counts = computed(() => {
  const c = { running: 0, waiting: 0, error: 0, complete: 0, total: 0 }
  Object.values(agents).forEach(a => {
    c.total++
    if (c[a.status] !== undefined) c[a.status]++
  })
  return c
})

// ── Mutations ────────────────────────────────────────────────────────────────
function applyAgents(incoming) {
  // Remove agents no longer present
  Object.keys(agents).forEach(id => { if (!incoming[id]) delete agents[id] })
  // Merge / add
  Object.entries(incoming).forEach(([id, state]) => { agents[id] = state })
}

function setConnection(status) { connection.value = status }
function setUsage(u)           { usage.value = u }
function setPollTime(t)        { pollTime.value = t }
function setLogDir(d)          { if (d) logDir.value = d }

function setCustomName(id, name) {
  if (name && name.trim()) customNames[id] = name.trim()
  else delete customNames[id]
  localStorage.setItem(LS_NAMES, JSON.stringify({ ...customNames }))
}

function toggleHide(id) {
  if (hiddenAgents.has(id)) hiddenAgents.delete(id)
  else hiddenAgents.add(id)
  localStorage.setItem(LS_HIDDEN, JSON.stringify([...hiddenAgents]))
}

export function useStore() {
  return {
    agents, usage, connection, pollTime, logDir,
    customNames, hiddenAgents, showStale, showHidden,
    alertAgents, visibleAgents, staleCnt, hiddenCnt, counts,
    applyAgents, setConnection, setUsage, setPollTime, setLogDir,
    setCustomName, toggleHide,
  }
}
