<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ToolboxView from './views/ToolboxView.vue'
import AppIcon from './components/AppIcon.vue'
import { toolRegistry, toolForPath } from './workspaces/registry.js'
import { createWorkspaceModel, MAX_WORKSPACES } from './workspaces/model.js'
import './assets/workspaces.css'

const route = useRoute(), router = useRouter()
const model = reactive(createWorkspaceModel())
const components = Object.fromEntries(toolRegistry.map(tool => [tool.id, defineAsyncComponent(() => tool.load().then(module => module.default))]))
const instances = new Map()
const activeId = ref(null), chooser = ref(false), message = ref(''), navigating = ref(false)
const strip = ref(null), chooserButton = ref(null), chooserPanel = ref(null), renameDialog = ref(null), renameInput = ref(null)
const renameId = ref(null), renameValue = ref('')
const activeTab = computed(() => model.tabs.find(tab => tab.id === activeId.value))
const isActive = tab => route.path !== '/' && activeId.value === tab.id
const definition = tab => toolRegistry.find(tool => tool.id === tab.toolId)
const location = tab => ({ path: definition(tab).path, query: { workspace: tab.id, ...(tab.initialMode === 'ocr' ? { tool: 'ocr' } : {}) } })
function hasContent(tab) { return instances.get(tab.id)?.hasContent?.() ?? true }
function canLeave() {
  if (activeTab.value && instances.get(activeTab.value.id)?.canDeactivate?.() === false) {
    message.value = '请先关闭当前导出窗口，再切换工作区。'
    return false
  }
  return true
}
const removeGuard = router.beforeEach(() => canLeave())
watch(() => route.fullPath, async () => {
  chooser.value = false
  const tool = toolForPath(route.path)
  if (!tool) { activeId.value = null; return }
  const requested = typeof route.query.workspace === 'string' ? route.query.workspace : null
  let tab = model.tabs.find(tab => tab.id === requested && tab.toolId === tool.id)
  if (!tab && requested && model.closed.has(requested)) {
    message.value = '此工作区已关闭，内容无法恢复。'
    activeId.value = null
    await router.replace('/')
    return
  }
  if (!tab && !requested) tab = [...model.tabs].reverse().find(tab => tab.toolId === tool.id && tab.initialMode === (route.query.tool === 'ocr' ? 'ocr' : 'edit'))
  if (!tab) tab = model.open(tool, route.query.tool === 'ocr' ? 'ocr' : 'edit')
  if (!tab) { message.value = `最多打开 ${MAX_WORKSPACES} 个工作区，请先保存并关闭暂时不用的标签。`; await router.replace(activeTab.value ? location(activeTab.value) : '/'); return }
  activeId.value = tab.id
  if (requested !== tab.id) await router.replace(location(tab))
  await nextTick()
  strip.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}, { immediate: true })
async function navigate(target) {
  if (navigating.value || !canLeave()) return
  navigating.value = true
  try { await router.push(target) } finally { navigating.value = false }
}
async function add(tool) {
  if (navigating.value || !canLeave()) return
  const tab = model.open(tool)
  if (!tab) { message.value = `最多打开 ${MAX_WORKSPACES} 个工作区，请先保存并关闭暂时不用的标签。`; return }
  chooser.value = false
  await navigate(location(tab))
  await focusTab(tab.id)
}
async function focusTab(id) {
  await nextTick()
  const target = id ? document.getElementById(`workspace-tab-${id}`) : document.querySelector('.toolbox-home .tool-card')
  target?.focus()
}
async function close(tab) {
  if (navigating.value || !model.tabs.includes(tab)) return
  if (instances.get(tab.id)?.canDeactivate?.() === false) { message.value = '请先关闭该工作区的导出窗口。'; return }
  if (hasContent(tab) && !window.confirm(`关闭“${tab.name}”？其中的文件、文本和编辑记录将从本次会话移除。请先下载需要保留的结果。`)) return
  const wasActive = activeId.value === tab.id
  const next = model.close(tab.id)
  if (wasActive) { activeId.value = null; await navigate(next ? location(next) : '/') }
  await focusTab(wasActive ? next?.id : activeId.value)
}
async function rename(tab) {
  renameId.value = tab.id; renameValue.value = tab.name
  await nextTick(); renameDialog.value.showModal(); renameInput.value?.focus(); renameInput.value?.select()
}
function endRename(save) {
  if (save && !model.rename(renameId.value, renameValue.value)) return
  const id = renameId.value
  renameDialog.value?.close(); renameId.value = null; focusTab(id)
}
async function toggleChooser() {
  chooser.value = !chooser.value
  await nextTick()
  if (chooser.value) chooserPanel.value?.querySelector('button')?.focus()
  else chooserButton.value?.focus()
}
async function tabKey(event, tab) {
  const index = model.tabs.indexOf(tab)
  let next
  if (event.key === 'ArrowRight') next = model.tabs[(index + 1) % model.tabs.length]
  else if (event.key === 'ArrowLeft') next = model.tabs[(index - 1 + model.tabs.length) % model.tabs.length]
  else if (event.key === 'Home') next = model.tabs[0]
  else if (event.key === 'End') next = model.tabs.at(-1)
  else if (event.key === 'Delete') { event.preventDefault(); await close(tab); return }
  else if (event.key === 'F2') { event.preventDefault(); await rename(tab); return }
  if (next) { event.preventDefault(); await navigate(location(next)); await focusTab(next.id) }
}
function beforeUnload(event) { if (model.tabs.some(hasContent)) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => { removeGuard(); window.removeEventListener('beforeunload', beforeUnload) })
</script>
<template>
  <div class="workspace-app" :class="{ 'has-workspace-tabs': model.tabs.length }">
    <div v-if="model.tabs.length" class="workspace-tabbar">
      <button class="workspace-home" aria-label="返回工具箱" @click="navigate('/')"><AppIcon name="arrow-left" :size="18" /></button>
      <div ref="strip" class="workspace-tabs" role="tablist" aria-label="工具工作区">
        <div v-for="tab in model.tabs" :key="tab.id" class="workspace-tab" :class="{ selected: isActive(tab) }">
          <button :id="`workspace-tab-${tab.id}`" role="tab" :aria-selected="isActive(tab)" :aria-controls="`workspace-panel-${tab.id}`" :tabindex="isActive(tab) || !activeId && tab === model.tabs[0] ? 0 : -1" :title="`${tab.name} · ${definition(tab).name}（F2 重命名）`" @click="navigate(location(tab))" @dblclick="rename(tab)" @keydown="tabKey($event, tab)"><AppIcon :name="definition(tab).icon" :size="16" /><span>{{ tab.name }}</span></button>
          <button class="workspace-tab-action" :aria-label="`重命名 ${tab.name}`" title="重命名" @click="rename(tab)">✎</button>
          <button class="workspace-tab-action" :aria-label="`关闭 ${tab.name}`" title="关闭工作区" @click="close(tab)">×</button>
        </div>
      </div>
      <button ref="chooserButton" class="workspace-add" :aria-expanded="chooser" aria-controls="workspace-chooser" @click="toggleChooser">＋ <span>新建</span></button>
      <div v-if="chooser" id="workspace-chooser" ref="chooserPanel" class="workspace-chooser" @keydown.esc.stop.prevent="toggleChooser">
        <strong>新建独立工作区</strong>
        <button v-for="tool in toolRegistry" :key="tool.id" @click="add(tool)"><AppIcon :name="tool.icon" :size="18" />{{ tool.name }}</button>
        <small>仅在本次会话保留 · {{ model.tabs.length }}/{{ MAX_WORKSPACES }}</small>
        <button class="text-button" @click="toggleChooser">取消</button>
      </div>
    </div>
    <div v-if="message" class="workspace-notice" role="status">{{ message }}<button @click="message = ''" aria-label="关闭提示">×</button></div>
    <ToolboxView v-show="route.path === '/'" @open-tool="add" />
    <section v-for="tab in model.tabs" v-show="isActive(tab)" :id="`workspace-panel-${tab.id}`" :key="tab.id" role="tabpanel" :aria-labelledby="`workspace-tab-${tab.id}`" :inert="!isActive(tab)" class="workspace-instance">
      <component :is="components[tab.toolId]" :ref="el => el ? instances.set(tab.id, el) : instances.delete(tab.id)" v-bind="definition(tab).props || {}" :workspace-id="tab.id" :active="isActive(tab)" :initial-mode="tab.initialMode" />
    </section>
    <dialog v-if="renameId" ref="renameDialog" class="workspace-rename" aria-labelledby="workspace-rename-title" @cancel.prevent="endRename(false)">
      <form @submit.prevent="endRename(true)"><h2 id="workspace-rename-title">重命名工作区</h2><label>名称<input ref="renameInput" v-model="renameValue" maxlength="60" required /></label><div><button type="button" class="text-button" @click="endRename(false)">取消</button><button class="primary-button" :disabled="!renameValue.trim()">保存</button></div></form>
    </dialog>
  </div>
</template>
