export const MAX_WORKSPACES = 12
export function createWorkspaceModel(makeId = () => globalThis.crypto.randomUUID()) {
  const tabs = []
  const closed = new Set()
  let sequence = 0
  return {
    tabs, closed,
    open(tool, initialMode = 'edit') {
      if (this.tabs.length >= MAX_WORKSPACES) return null
      const tab = { id: makeId(), toolId: tool.id, name: `${tool.name} ${++sequence}`, initialMode }
      this.tabs.push(tab)
      return tab
    },
    close(id) {
      const index = this.tabs.findIndex(tab => tab.id === id)
      if (index < 0) return null
      this.tabs.splice(index, 1); this.closed.add(id)
      return this.tabs[Math.min(index, this.tabs.length - 1)] || null
    },
    rename(id, name) {
      const tab = this.tabs.find(tab => tab.id === id)
      const trimmed = String(name).trim().slice(0, 60)
      if (!tab || !trimmed) return false
      tab.name = trimmed
      return true
    },
  }
}
