import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

export const useWorkspaceStore = defineStore('workspace', () => {
  // File/Blob 属于浏览器原生对象，不应被 Vue 深层代理，否则部分解析库会读取失败。
  const pendingFile = shallowRef(null)
  const pendingMode = ref(null)
  const currentFileName = ref('')

  function stageFile(file, mode) {
    pendingFile.value = file
    pendingMode.value = mode
    currentFileName.value = file?.name || ''
  }

  function takeFile(mode) {
    if (!pendingFile.value || pendingMode.value !== mode) return null
    const file = pendingFile.value
    pendingFile.value = null
    pendingMode.value = null
    return file
  }

  function setCurrentFileName(name = '') {
    currentFileName.value = name
  }

  return { pendingFile, pendingMode, currentFileName, stageFile, takeFile, setCurrentFileName }
})
