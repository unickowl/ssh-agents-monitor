import { ref } from 'vue'

const isCompact = ref(false)
const isElectron = typeof window !== 'undefined' && !!window.electronAPI

export function useCompactMode() {
  async function toggleCompact() {
    isCompact.value = !isCompact.value
    if (isElectron) {
      await window.electronAPI.setCompactMode(isCompact.value)
    }
  }

  async function setCompact(value) {
    isCompact.value = value
    if (isElectron) {
      await window.electronAPI.setCompactMode(value)
    }
  }

  return { isCompact, isElectron, toggleCompact, setCompact }
}
