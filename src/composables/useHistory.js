import { computed, ref } from 'vue'

export function useHistory(initialValue, limit = 60) {
  // Editor snapshots only contain serializable coordinates and style values.
  // JSON cloning also unwraps Vue reactive proxies that structuredClone rejects.
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const entries = ref([clone(initialValue)])
  const index = ref(0)
  const canUndo = computed(() => index.value > 0)
  const canRedo = computed(() => index.value < entries.value.length - 1)

  function commit(value) {
    const snapshot = clone(value)
    entries.value = entries.value.slice(0, index.value + 1)
    entries.value.push(snapshot)
    if (entries.value.length > limit) entries.value.shift()
    index.value = entries.value.length - 1
  }

  function undo() {
    if (!canUndo.value) return null
    index.value -= 1
    return clone(entries.value[index.value])
  }

  function redo() {
    if (!canRedo.value) return null
    index.value += 1
    return clone(entries.value[index.value])
  }

  function reset(value) {
    entries.value = [clone(value)]
    index.value = 0
  }

  return { canUndo, canRedo, commit, undo, redo, reset }
}
