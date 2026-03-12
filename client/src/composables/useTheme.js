import { ref, watch } from 'vue'

const theme = ref(localStorage.getItem('theme') || 'dark')

watch(theme, val => {
  document.documentElement.classList.toggle('light', val === 'light')
  localStorage.setItem('theme', val)
}, { immediate: true })

export function useTheme() {
  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }
  return { theme, toggle }
}
