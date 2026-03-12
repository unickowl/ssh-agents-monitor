import { ref, watch, computed } from 'vue'

const STORAGE_KEY = 'theme'
// 'light' | 'dark' | 'auto'
const theme = ref(localStorage.getItem(STORAGE_KEY) || 'auto')

const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  systemDark.value = e.matches
})

const resolved = computed(() => {
  if (theme.value === 'auto') return systemDark.value ? 'dark' : 'light'
  return theme.value
})

watch(resolved, val => {
  document.documentElement.classList.toggle('light', val === 'light')
}, { immediate: true })

watch(theme, val => {
  localStorage.setItem(STORAGE_KEY, val)
})

export function useTheme() {
  function toggle() {
    // auto → light → dark → auto
    const order = ['auto', 'light', 'dark']
    const idx = order.indexOf(theme.value)
    theme.value = order[(idx + 1) % order.length]
  }
  return { theme, resolved, toggle }
}
