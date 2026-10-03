<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { safeDownloadName } from '@/utils/files.js'

const props = defineProps({ fileName: { type: String, required: true }, getFile: { type: Function, required: true }, getProtectedRegions: { type: Function, default: () => [] } })
const emit = defineEmits(['close'])
const dialog = ref(null), downloadLink = ref(null)
const layout = ref('editable'), recognition = ref('auto'), language = ref('chi_sim+eng'), dpi = ref('216'), range = ref('')
const running = ref(false), cancelling = ref(false), error = ref(''), result = ref(null), downloadUrl = ref('')
const progress = ref({ percent: 0, message: '' })
const downloadName = safeDownloadName(props.fileName, '转换', 'docx')
let controller = null, disposed = false

function clearDownload() {
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value)
  downloadUrl.value = ''
  result.value = null
}

async function start() {
  if (running.value) return
  clearDownload()
  error.value = ''
  running.value = true
  cancelling.value = false
  controller = new AbortController()
  progress.value = { percent: 0, message: '正在准备当前文件…' }
  const options = { layout: layout.value, recognition: recognition.value, language: language.value, dpi: Number(dpi.value), range: range.value, protectedRegions: props.getProtectedRegions() }
  try {
    const { abortable, checkAbort } = await import('@/utils/wordLayout.js')
    checkAbort(controller.signal)
    const file = await abortable(props.getFile(), controller.signal)
    if (!file) throw new Error('文件尚未准备好，请关闭弹窗后重试。')
    const { convertPdfToWord } = await import('@/utils/pdfToWord.js')
    checkAbort(controller.signal)
    const converted = await convertPdfToWord(file, options, { signal: controller.signal, onProgress: value => { progress.value = value } })
    if (disposed) return
    result.value = converted
    downloadUrl.value = URL.createObjectURL(converted.blob)
    await nextTick()
    downloadLink.value?.click()
  } catch (reason) {
    if (disposed) return
    if (reason.name === 'AbortError') progress.value = { percent: 0, message: '已取消转换' }
    else error.value = reason.message || '转换失败，请重试。'
  } finally {
    running.value = false
    cancelling.value = false
    controller = null
  }
}

function cancel() {
  if (running.value) {
    cancelling.value = true
    controller?.abort()
  } else emit('close')
}

onMounted(() => dialog.value.showModal())
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
  clearDownload()
  dialog.value?.close()
})
</script>

<template>
  <dialog ref="dialog" class="word-dialog" aria-labelledby="word-dialog-title" @cancel.prevent="cancel">
    <form @submit.prevent="start">
      <header class="word-heading"><div><h2 id="word-dialog-title">导出 Word</h2><p :title="fileName">{{ fileName }}</p></div><button class="icon-button" type="button" aria-label="关闭" :disabled="running" @click="emit('close')">×</button></header>
      <fieldset v-if="!result" :disabled="running" class="word-settings">
        <label class="field"><span>转换方式</span><select v-model="layout" autofocus><option value="editable">可编辑优先</option><option value="appearance">外观优先（整页图片）</option></select></label>
        <p class="word-help">{{ layout === 'editable' ? '文字按原页位置排版，可在 Word 中编辑；图片和表格线保留为背景。复杂表格不会自动变成 Word 表格，扫描件与转曲文字需校对。' : '每页作为图片放入 Word，保留页面外观，文字不可直接编辑。' }}</p>
        <div v-if="layout === 'editable'" class="word-options-row">
          <label class="field"><span>文字来源</span><select v-model="recognition"><option value="auto">自动提取并补充识别</option><option value="ocr">全部使用 OCR（原文乱码时）</option></select></label>
          <label class="field"><span>识别语言</span><select v-model="language"><option value="chi_sim+eng">简体中文和英文</option><option value="chi_sim">简体中文</option><option value="eng">英文</option></select></label>
        </div>
        <div class="word-options-row">
          <label class="field"><span>页码范围</span><input v-model="range" type="text" placeholder="全部页面，例如 1-3, 5" maxlength="500" /></label>
          <label class="field"><span>清晰度</span><select v-model="dpi"><option value="144">标准 · 144 DPI</option><option value="216">清晰 · 216 DPI</option><option value="300">高清 · 300 DPI</option></select></label>
        </div>
        <p class="word-help">导出包含当前已添加的印章。转换在本地完成，页数较多或需要识别时会更慢。</p>
      </fieldset>
      <div v-if="running" class="word-progress" aria-live="polite">
        <div><span>{{ cancelling ? '正在取消…' : progress.message }}</span><strong>{{ progress.percent }}%</strong></div>
        <progress :value="progress.percent" max="100" aria-label="PDF 转 Word 进度"></progress>
      </div>
      <p v-else-if="!result && !error && progress.message" class="word-help" role="status">{{ progress.message }}</p>
      <p v-if="error" class="word-error" role="alert">{{ error }}</p>
      <div v-if="result" class="word-result" role="status">
        <p><strong>Word 已生成，共 {{ result.stats.pages }} 页。</strong></p>
        <p v-if="layout === 'editable'">{{ result.stats.textPages }} 页提取原文，{{ result.stats.ocrPages }} 页使用 OCR<span v-if="result.stats.imageOnlyPages">，{{ result.stats.imageOnlyPages }} 页仅保留图像</span>。同一页可能同时提取原文和识别图片文字。</p>
        <p v-else>页面以图片保存，文字不可直接编辑。</p>
        <ul v-if="result.warnings.length"><li v-for="warning in result.warnings" :key="warning">{{ warning }}</li></ul>
        <p class="word-help">如未自动下载，请点击“下载 Word”。刷新或关闭页面前请保存。</p>
      </div>
      <footer class="word-actions">
        <template v-if="result"><button class="text-button" type="button" @click="clearDownload">重新设置</button><button class="tonal-button" type="button" @click="emit('close')">关闭</button><a ref="downloadLink" class="primary-button" :href="downloadUrl" :download="downloadName">下载 Word</a></template>
        <template v-else><button class="tonal-button" type="button" :disabled="cancelling" @click="cancel">{{ running ? '取消转换' : '取消' }}</button><button class="primary-button" type="submit" :disabled="running">{{ running ? '转换中…' : '转换并下载' }}</button></template>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.word-dialog { width: min(600px, calc(100vw - 28px)); max-height: calc(100dvh - 32px); overflow: auto; margin: auto; padding: 24px; border: 1px solid var(--md-outline-variant); border-radius: 18px; color: var(--md-on-surface); background: var(--md-surface); box-shadow: 0 20px 70px #0003; }
.word-dialog::backdrop { background: var(--md-scrim); }
.word-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.word-heading > div { min-width: 0; }
.word-heading h2 { margin: 0 0 6px; font-size: 20px; }
.word-heading p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--md-on-surface-variant); }
.word-settings { border: 0; padding: 0; margin: 0; min-width: 0; }
.word-settings .field { margin: 0; min-width: 0; }
.word-settings select, .word-settings input { width: 100%; min-width: 0; min-height: 42px; border: 1px solid var(--md-outline-variant); border-radius: 8px; padding: 8px; color: var(--md-on-surface); background: var(--md-surface-container); }
.word-options-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
.word-help { color: var(--md-on-surface-variant); font-size: 12px; line-height: 1.7; margin: 10px 0; }
.word-progress { margin-top: 20px; }
.word-progress > div { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.word-progress progress { width: 100%; height: 10px; margin-top: 8px; accent-color: var(--md-primary); }
.word-error { font-size: 13px; color: var(--md-error); }
.word-result { font-size: 13px; line-height: 1.8; }
.word-result ul { padding-left: 20px; max-height: 160px; overflow: auto; }
.word-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 24px; }
@media (max-width: 520px) { .word-dialog { padding: 18px; } .word-options-row { grid-template-columns: 1fr; gap: 12px; } }
</style>
