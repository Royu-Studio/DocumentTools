<script setup>
import { computed, markRaw, nextTick, onActivated, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import FileDropZone from '@/components/FileDropZone.vue'
import AppIcon from '@/components/AppIcon.vue'
import PdfWordDialog from '@/components/PdfWordDialog.vue'
import ToolHeader from '@/components/ToolHeader.vue'
import { validateFile } from '@/utils/files.js'
import '@/assets/studio.css'

const route = useRoute()
const isVisible = computed(() => route.path === '/pdf')
const documents = shallowReactive([])
const activeId = ref(null)
const mode = ref(useRoute().query.tool === 'ocr' ? 'ocr' : 'edit')
const input = ref(null)
const error = ref('')
const busy = ref(false)
const wordDialogOpen = ref(false)
const editors = new Map()
const readers = new Map()
const ocrLoaded = new Map()
const ocrComponent = shallowRef(null)
const active = computed(() => documents.find(doc => doc.id === activeId.value))
let sequence = 0

async function openFile(file) {
  if (!file || busy.value || wordDialogOpen.value || (readers.get(activeId.value)?.isBusy || editors.get(activeId.value)?.isBusy)) return
  const validation = validateFile(file)
  if (!validation.valid) { error.value = validation.message; return }
  busy.value = true
  error.value = ''
  const previousId = activeId.value
  const doc = { id: ++sequence, file, kind: validation.kind }
  const desiredMode = mode.value
  try {
    doc.component = markRaw((await import('./DocumentEditor.vue')).default)
    documents.push(doc)
    activeId.value = doc.id
    mode.value = 'edit'
    await nextTick()
    await editors.get(doc.id).load(file)
    if (desiredMode === 'ocr') await showOcr()
  } catch (reason) {
    const index = documents.indexOf(doc)
    if (index !== -1) documents.splice(index, 1)
    activeId.value = previousId
    mode.value = 'edit'
    error.value = `文件打开失败：${reason.message}`
  }
  finally { busy.value = false }
}

async function showOcr() {
  if (!active.value) { mode.value = 'ocr'; return }
  const doc = active.value
  const editor = editors.get(doc.id)
  const revision = editor.revision()
  if (ocrLoaded.get(doc.id) !== revision) {
    const file = await editor.snapshot()
    if (!file) throw new Error('文件还未准备好，请稍后重试')
    if (!ocrComponent.value) ocrComponent.value = markRaw((await import('./OCRTool.vue')).default)
    mode.value = 'ocr'
    await nextTick()
    await readers.get(doc.id).load(file)
    ocrLoaded.set(doc.id, editor.revision())
  } else mode.value = 'ocr'
}

async function selectMode(next) {
  if (busy.value || wordDialogOpen.value || (readers.get(activeId.value)?.isBusy || editors.get(activeId.value)?.isBusy)) return
  error.value = ''
  busy.value = true
  try {
    if (next === 'ocr') await showOcr()
    else { mode.value = 'edit'; await nextTick(); editors.get(activeId.value)?.fit() }
  } catch (reason) { error.value = `无法切换工具：${reason.message}` }
  finally { busy.value = false }
}

async function selectDocument(id) {
  if (busy.value || wordDialogOpen.value || (readers.get(activeId.value)?.isBusy || editors.get(activeId.value)?.isBusy)) return
  activeId.value = id
  await selectMode(mode.value)
}
async function closeDocument(doc) {
  if (busy.value || wordDialogOpen.value || (readers.get(activeId.value)?.isBusy || editors.get(activeId.value)?.isBusy)) return
  if (!window.confirm(`关闭“${doc.file.name}”？请先下载需要保留的编辑结果。`)) return
  const index = documents.indexOf(doc)
  documents.splice(index, 1)
  ocrLoaded.delete(doc.id)
  if (activeId.value === doc.id) {
    activeId.value = documents[Math.min(index, documents.length - 1)]?.id ?? null
    if (activeId.value) await selectMode(mode.value)
  }
}
function beforeUnload(event) { if (documents.length) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onActivated(() => nextTick(() => editors.get(activeId.value)?.fit()))
onBeforeRouteLeave(() => {
  if (busy.value || wordDialogOpen.value || (readers.get(activeId.value)?.isBusy || editors.get(activeId.value)?.isBusy)) {
    error.value = '请等待当前处理完成，或关闭导出窗口后返回工具箱。'
    return false
  }
})
</script>

<template>
  <div class="studio-shell" :class="{ 'has-document': active }">
    <ToolHeader title="PDF 工具">
      <button class="primary-button studio-open" :disabled="busy || wordDialogOpen || (readers.get(activeId)?.isBusy || editors.get(activeId)?.isBusy)" @click="input.click()"><AppIcon name="plus" :size="18" /><span>打开文件</span></button>
      <input ref="input" class="visually-hidden" type="file" accept=".pdf,image/*" @change="openFile($event.target.files?.[0]); $event.target.value = ''" />
    </ToolHeader>
    <div class="studio-body">
      <nav class="studio-rail" aria-label="工作台工具">
        <span class="rail-label">工作台</span>
        <button :class="{ selected: mode === 'edit' }" :aria-pressed="mode === 'edit'" :disabled="busy || (readers.get(activeId)?.isBusy || editors.get(activeId)?.isBusy)" @click="selectMode('edit')"><span class="rail-icon"><AppIcon name="edit" :size="23" /></span><span>编辑文件</span></button>
        <button :class="{ selected: mode === 'ocr' }" :aria-pressed="mode === 'ocr'" :disabled="busy || (readers.get(activeId)?.isBusy || editors.get(activeId)?.isBusy)" @click="selectMode('ocr')"><span class="rail-icon"><AppIcon name="scan" :size="23" /></span><span>文字识别</span></button>
        <button v-if="active" :disabled="busy || (readers.get(activeId)?.isBusy || editors.get(activeId)?.isBusy)" @click="wordDialogOpen = true"><span class="rail-icon"><AppIcon name="file" :size="23" /></span><span>导出 Word</span></button>
      </nav>
      <div class="studio-main">
        <div class="studio-documentbar">
          <div class="document-tabs" aria-label="已打开的文件"><span v-if="!documents.length" class="document-tab selected">未打开文件</span><div v-for="doc in documents" :key="doc.id" class="document-tab" :class="{ selected: activeId === doc.id }"><button class="document-select" :aria-pressed="activeId === doc.id" :title="doc.file.name" :disabled="busy || (readers.get(activeId)?.isBusy || editors.get(activeId)?.isBusy)" @click="selectDocument(doc.id)"><AppIcon :name="doc.kind === 'pdf' ? 'file' : 'image'" :size="16" /><span>{{ doc.file.name }}</span></button><button class="document-close" :aria-label="`关闭 ${doc.file.name}`" :disabled="busy || (readers.get(activeId)?.isBusy || editors.get(activeId)?.isBusy)" @click="closeDocument(doc)">×</button></div></div>
          <span v-if="active" class="documentbar-note">{{ mode === 'ocr' ? '识别内容包含当前编辑' : '关闭或刷新前，请下载保存' }}</span>
        </div>
        <div v-if="error" class="studio-alert" role="alert">{{ error }}<button class="text-button" @click="error = ''">关闭</button></div>
        <div v-if="busy" class="studio-progress" role="status">正在准备文件，请稍候…</div>
        <main v-if="!active" class="studio-welcome">
          <div class="welcome-copy"><h1>PDF 与图片处理</h1></div>
          <div class="welcome-upload"><FileDropZone title="拖入 PDF 或图片" hint="也可直接粘贴图片 · PDF ≤ 200 MB，图片 ≤ 100 MB" @file="openFile" @error="error = $event" /><div class="supported-types"><span>PDF</span><span>PNG</span><span>JPG</span><span>WEBP</span></div></div>
          <div class="welcome-capabilities">
            <div><span class="capability-icon"><AppIcon name="edit" :size="23" /></span><strong>页面编辑</strong><p>PDF 和图片均可添加文字、涂抹、取色</p></div>
            <div><span class="capability-icon"><AppIcon name="stamp" :size="23" /></span><strong>添加印章</strong><p>两类文件共用印章及位置、大小调整</p></div>
            <div><span class="capability-icon"><AppIcon name="scan" :size="23" /></span><strong>文字识别</strong><p>整页或框选识别，导出文字</p></div>
          </div>
        </main>
        <template v-for="doc in documents" :key="doc.id">
          <div v-show="activeId === doc.id && mode === 'edit'" class="studio-editor"><component :is="doc.component" :ref="el => el ? editors.set(doc.id, el) : editors.delete(doc.id)" embedded :active="isVisible && activeId === doc.id && mode === 'edit' && !busy && !wordDialogOpen" /></div>
          <div v-if="ocrComponent" v-show="activeId === doc.id && mode === 'ocr'" class="studio-reader"><component :is="ocrComponent" :ref="el => el ? readers.set(doc.id, el) : readers.delete(doc.id)" embedded :active="isVisible && activeId === doc.id && mode === 'ocr'" /></div>
        </template>
      </div>
    </div>
    <PdfWordDialog v-if="wordDialogOpen && active" :file-name="active.file.name" :get-file="() => editors.get(activeId)?.pdfSnapshot()" :get-protected-regions="() => editors.get(activeId)?.wordProtectedRegions() || []" @close="wordDialogOpen = false" />
  </div>
</template>
