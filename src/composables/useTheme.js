import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'document-tools-theme'
let savedTheme = 'dark'
try { savedTheme = localStorage.getItem(STORAGE_KEY) || 'dark' } catch { /* Storage may be disabled. */ }
const themeMode = ref(['light', 'dark', 'system'].includes(savedTheme) ? savedTheme : 'dark')
const systemDark = ref(false)
let mediaQuery

function syncSystemTheme(event) {
  systemDark.value = event.matches
}

if (typeof window !== 'undefined') {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mediaQuery.matches
  mediaQuery.addEventListener?.('change', syncSystemTheme)
}

const resolvedTheme = computed(() => themeMode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themeMode.value)

watch([themeMode, resolvedTheme], () => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolvedTheme.value
  document.documentElement.style.colorScheme = resolvedTheme.value
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.content = resolvedTheme.value === 'dark' ? '#070c17' : '#eef2f8'
  try { localStorage.setItem(STORAGE_KEY, themeMode.value) } catch { /* Keep the in-memory preference. */ }
}, { immediate: true })

export function useTheme() {
  return { themeMode, resolvedTheme }
}
