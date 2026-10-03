<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { getNodeCopy } from '@/utils/formatterTree.js'
const props = defineProps({ tree: { type: Object, required: true } })
const PAGE_SIZE = 300
const expanded = ref(new Set())
const selected = shallowRef(null)
const page = ref(0)
const feedback = ref('')
const fallback = ref(null)
const fallbackText = ref('')
const fallbackVisible = ref(false)
const list = ref(null)
let copyVersion = 0
watch(() => props.tree, tree => {
  expanded.value = new Set([tree.root.id])
  selected.value = tree.root
  page.value = 0
  feedback.value = ''; fallbackText.value = ''; fallbackVisible.value = false; copyVersion++
}, { immediate: true })
const visible = computed(() => {
  const result = [], stack = [{ node: props.tree.root, depth: 0, position: 1, siblingCount: 1 }]
  while (stack.length) {
    const item = stack.pop()
    result.push(item)
    if (expanded.value.has(item.node.id)) {
      for (let i = item.node.children.length - 1; i >= 0; i--) stack.push({ node: item.node.children[i], depth: item.depth + 1, position: i + 1, siblingCount: item.node.children.length })
    }
  }
  return result
})
const pages = computed(() => Math.max(1, Math.ceil(visible.value.length / PAGE_SIZE)))
const rows = computed(() => visible.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))
const selectionPath = computed(() => selected.value?.path || '')
const selectionValue = computed(() => selected.value ? getNodeCopy(props.tree, selected.value, 'value') : '')
watch(pages, count => { page.value = Math.min(page.value, count - 1) })
function select(node) { selected.value = node; feedback.value = ''; fallbackText.value = ''; fallbackVisible.value = false; copyVersion++ }
function toggle(node) {
  select(node)
  const set = new Set(expanded.value)
  if (set.has(node.id)) set.delete(node.id); else set.add(node.id)
  expanded.value = set
}
function expandAll() {
  const set = new Set(), stack = [props.tree.root]
  while (stack.length) {
    const node = stack.pop()
    if (node.children.length) { set.add(node.id); for (const child of node.children) stack.push(child) }
  }
  expanded.value = set; page.value = 0
}
function collapseAll() { expanded.value = new Set(); page.value = 0; select(props.tree.root) }
async function copy(mode) {
  const version = ++copyVersion
  const text = getNodeCopy(props.tree, selected.value, mode)
  const label = { value: '值', raw: '子树', path: '路径' }[mode]
  try {
    await navigator.clipboard.writeText(text)
    if (version === copyVersion) { feedback.value = `已复制${label}`; fallbackText.value = ''; fallbackVisible.value = false }
  } catch {
    if (version !== copyVersion) return
    fallbackText.value = text; fallbackVisible.value = true; feedback.value = `无法访问剪贴板，已选中${label}，请手动复制`
    await nextTick(); fallback.value?.focus(); fallback.value?.select()
  }
}
async function changePage(value) { page.value = value; await nextTick(); if (list.value) list.value.scrollTop = 0 }
async function focusNode(index) {
  const item = visible.value[index]
  if (!item) return
  select(item.node); page.value = Math.floor(index / PAGE_SIZE)
  await nextTick()
  list.value?.querySelector(`[data-node-id="${item.node.id}"]`)?.focus()
}
function keydown(event, item) {
  const index = visible.value.findIndex(row => row.node.id === item.node.id)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusNode(index + (event.key === 'ArrowDown' ? 1 : -1)) }
  else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focusNode(event.key === 'Home' ? 0 : visible.value.length - 1) }
  else if (event.key === 'ArrowRight' && item.node.children.length) { event.preventDefault(); if (!expanded.value.has(item.node.id)) toggle(item.node); else focusNode(index + 1) }
  else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (expanded.value.has(item.node.id)) toggle(item.node)
    else { for (let i = index - 1; i >= 0; i--) if (visible.value[i].depth < item.depth) { focusNode(i); break } }
  }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.node.children.length ? toggle(item.node) : select(item.node) }
}
</script>
<template>
  <div class="inspector">
    <div class="inspector-toolbar"><span>对象检查器 <small>{{ tree.nodeCount.toLocaleString() }} 节点</small></span><div><button class="text-button" @click="expandAll">全部展开</button><button class="text-button" @click="collapseAll">全部折叠</button></div></div>
    <p class="inspector-hint">点击节点查看值，点击箭头展开 · 支持方向键</p>
    <div ref="list" class="inspector-list" role="tree" aria-label="结构树">
      <div v-for="item in rows" :key="item.node.id" class="inspector-row" role="treeitem" :data-node-id="item.node.id" :aria-level="item.depth + 1" :aria-posinset="item.position" :aria-setsize="item.siblingCount" :aria-selected="selected?.id === item.node.id" :aria-expanded="item.node.children.length ? expanded.has(item.node.id) : undefined" :tabindex="selected?.id === item.node.id || !rows.some(row => row.node.id === selected?.id) && item === rows[0] ? 0 : -1" :style="{ '--node-depth': Math.min(item.depth, 12) }" @click="select(item.node)" @keydown="keydown($event, item)">
        <button v-if="item.node.children.length" class="inspector-toggle" tabindex="-1" :aria-label="`${expanded.has(item.node.id) ? '折叠' : '展开'} ${item.node.label}`" @click.stop="toggle(item.node)">{{ expanded.has(item.node.id) ? '▾' : '▸' }}</button><span v-else class="inspector-leaf">·</span>
        <span class="inspector-label" :title="item.node.label">{{ item.node.label }}</span><span class="inspector-type">{{ item.node.type }}</span><span class="inspector-preview">{{ item.node.preview }}</span>
      </div>
    </div>
    <div v-if="pages > 1" class="inspector-pagination"><button class="text-button" :disabled="page === 0" @click="changePage(page - 1)">上一页</button><span>{{ page + 1 }} / {{ pages }} 页 · {{ visible.length.toLocaleString() }} 个可见节点</span><button class="text-button" :disabled="page >= pages - 1" @click="changePage(page + 1)">下一页</button></div>
    <div v-if="selected" class="inspector-details">
      <div class="inspector-copy-actions"><strong>选中节点</strong><button class="text-button" @click="copy('value')">复制值</button><button class="text-button" @click="copy('raw')">复制子树</button><button class="text-button" @click="copy('path')">复制路径</button></div>
      <div class="inspector-path" :title="selectionPath">{{ selectionPath }}</div>
      <textarea class="inspector-value" :value="selectionValue" aria-label="选中节点的值" readonly spellcheck="false" />
      <div class="inspector-status" role="status">{{ feedback || (tree.format === 'xml' ? '子树保留原文；元素值补齐继承的命名空间。路径仅用于定位。' : '子树保留原始文本；字符串值不含引号。路径仅用于定位。') }}</div>
      <textarea v-if="fallbackVisible" ref="fallback" class="inspector-fallback" :value="fallbackText" aria-label="手动复制内容" readonly />
    </div>
  </div>
</template>
<style scoped>
.inspector { min-width: 0; }
.inspector-toolbar,.inspector-copy-actions,.inspector-pagination { display: flex; align-items: center; justify-content: space-between; gap: 4px; flex-wrap: wrap; padding: 8px 12px; }
.inspector-toolbar { border-bottom: 1px solid var(--md-outline-variant); font-size: 13px; }
.inspector-toolbar .text-button,.inspector-copy-actions .text-button,.inspector-pagination .text-button { min-height: 44px; padding: 0 9px; font-size: 12px; }
.inspector-hint { margin: 8px 16px; font-size: 11px; color: var(--md-on-surface-variant); }
.inspector-list { height: clamp(240px,40dvh,480px); overflow: auto; padding: 4px 0; }
.inspector-row { display: flex; align-items: center; min-height: 38px; gap: 7px; padding: 0 12px 0 8px; padding-inline-start: calc(8px + var(--node-depth) * 16px); cursor: pointer; font: 12px/1.5 Consolas,'SFMono-Regular',monospace; border-inline-start: 3px solid transparent; }
.inspector-row:hover { background: var(--md-surface-container); }
.inspector-row[aria-selected='true'] { border-inline-start-color: var(--md-primary); background: var(--md-primary-container); color: var(--md-on-primary-container); }
.inspector-row:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
.inspector-toggle,.inspector-leaf { flex: 0 0 28px; width: 28px; min-height: 38px; display: grid; place-items: center; border: 0; color: inherit; background: transparent; font-size: 17px; }
.inspector-toggle { cursor: pointer; }
.inspector-label { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
.inspector-type { color: var(--md-primary); font-size: 10px; flex-shrink: 0; }
.inspector-preview { color: var(--md-on-surface-variant); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inspector-details { border-top: 1px solid var(--md-outline-variant); }
.inspector-copy-actions strong { font-size: 12px; margin-right: auto; }
.inspector-path { padding: 0 16px 8px; font: 11px/1.6 Consolas,monospace; overflow-wrap: anywhere; max-height: 90px; overflow: auto; color: var(--md-on-surface-variant); }
.formatter-editor textarea.inspector-value,.formatter-editor textarea.inspector-fallback { height: 100px; min-height: 80px; font-size: 12px; padding: 10px 16px; background: var(--md-surface-container); white-space: pre; }
.inspector-status { min-height: 32px; padding: 8px 16px; font-size: 11px; color: var(--md-on-surface-variant); }
.inspector-pagination { font-size: 11px; border-top: 1px solid var(--md-outline-variant); }
@media(max-width:720px) { .inspector-row { min-height: 44px; gap: 5px; padding-inline-start: calc(8px + min(var(--node-depth), 6) * 12px); }.inspector-toggle,.inspector-leaf { min-height: 44px; flex-basis: 32px; }.inspector-list { height: 330px; }.inspector-label { max-width: 40%; }.inspector-type { font-size: 9px; } }
</style>
