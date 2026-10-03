<script setup>
import { computed, ref, watch } from 'vue'
import ToolHeader from '@/components/ToolHeader.vue'
import { formatJson, formatXml, MAX_TEXT_LENGTH } from '@/utils/formatters.js'
const props = defineProps({ kind: { type: String, required: true } })
const source = ref('')
const output = ref('')
const error = ref('')
const status = ref('')
const indent = ref(2)
const pane = ref('input')
const input = ref(null)
const outputArea = ref(null)
const fileName = ref('')
const importing = ref(false)
const title = computed(() => `${props.kind.toUpperCase()} 格式化`)
const stale = ref(false)
watch(source, () => { error.value = ''; status.value = ''; if (output.value) stale.value = true })
function run(compact = false) {
  error.value = ''; status.value = ''
  try {
    output.value = (props.kind === 'json' ? formatJson : formatXml)(source.value, indent.value, compact)
    stale.value = false
    pane.value = 'output'
    status.value = compact ? '校验通过，已压缩' : '校验通过，已格式化'
  } catch (reason) { error.value = reason.message; stale.value = true; pane.value = 'input' }
}
async function importFile(file) {
  if (!file || importing.value) return
  if (file.size > MAX_TEXT_LENGTH) { error.value = '文件超过 2 MB，请缩小后重试'; return }
  importing.value = true
  try { source.value = (await file.text()).replace(/^\uFEFF/, ''); fileName.value = file.name; pane.value = 'input' }
  catch (reason) { error.value = `读取失败：${reason.message}` }
  finally { importing.value = false }
}
async function copy() {
  try { await navigator.clipboard.writeText(output.value); status.value = '已复制结果' }
  catch { outputArea.value?.focus(); outputArea.value?.select(); status.value = '无法访问剪贴板，已选中结果，请手动复制' }
}
function download() {
  const text = props.kind === 'xml' ? output.value.replace(/^(<\?xml\s[^?]*encoding\s*=\s*['"])[^'"]+(['"])/i, '$1UTF-8$2') : output.value
  const blob = new Blob([text], { type: props.kind === 'json' ? 'application/json;charset=utf-8' : 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = (fileName.value.replace(/\.[^.]+$/, '') || 'formatted') + '.' + props.kind
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  status.value = '已开始下载'
}
function example() {
  source.value = props.kind === 'json' ? '{"name":"文档工具箱","local":true,"tools":["PDF","JSON","XML"]}' : '<?xml version="1.0" encoding="UTF-8"?>\n<toolbox><name>文档工具箱</name><tools><tool>PDF</tool><tool>XML</tool></tools></toolbox>'
  fileName.value = ''; pane.value = 'input'
}
</script>
<template>
  <div class="formatter-page">
    <ToolHeader :title="title" />
    <main class="formatter-main" @keydown.ctrl.enter.prevent="run()" @keydown.meta.enter.prevent="run()">
      <div class="formatter-heading"><div><span class="eyebrow">{{ kind.toUpperCase() }} / FORMATTER</span><h1>{{ title }}</h1></div><p>粘贴内容或导入文件，结果可复制与下载。</p></div>
      <div class="formatter-actions">
        <button class="primary-button" :disabled="importing" @click="run()">格式化</button>
        <button class="tonal-button" :disabled="importing" @click="run(true)">压缩</button>
        <label class="indent-select">缩进 <select v-model.number="indent" aria-label="缩进空格数"><option :value="2">2 空格</option><option :value="4">4 空格</option></select></label>
        <button class="text-button import-action" :disabled="importing" @click="input.click()">{{ importing ? '读取中…' : '导入文件' }}</button>
        <button v-if="!source" class="text-button" @click="example">填入示例</button>
        <input ref="input" class="visually-hidden" type="file" :accept="`.${kind},.txt`" @change="importFile($event.target.files?.[0]); $event.target.value = ''" />
      </div>
      <div v-if="error" class="formatter-error" role="alert">{{ error }}</div>
      <div class="formatter-feedback" role="status">{{ stale && output ? '输入已更改或校验失败，请重新格式化后复制或下载。' : status || '支持 Ctrl / ⌘ + Enter · 最大 2 MB' }}</div>
      <nav class="formatter-pane-switch" aria-label="切换编辑面板"><button :aria-pressed="pane === 'input'" @click="pane = 'input'">输入</button><button :aria-pressed="pane === 'output'" @click="pane = 'output'">结果</button></nav>
      <div class="formatter-editors" :data-pane="pane">
        <section class="formatter-editor source-editor" @dragover.prevent @drop.prevent="importFile($event.dataTransfer.files?.[0])"><header><label :id="`${kind}-source-label`">输入 <small>{{ source.length.toLocaleString() }} 字符</small></label><span class="editor-file" :title="fileName">{{ fileName }}</span></header><textarea v-model="source" :aria-labelledby="`${kind}-source-label`" :placeholder="`在这里粘贴 ${kind.toUpperCase()}…`" :disabled="importing" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea></section>
        <section class="formatter-editor result-editor"><header><label :id="`${kind}-result-label`">结果 <small>{{ output.length.toLocaleString() }} 字符</small></label><div><button class="text-button" :disabled="!output || stale" @click="copy">复制</button><button class="text-button" :disabled="!output || stale" @click="download">下载</button></div></header><textarea ref="outputArea" :value="output" :aria-labelledby="`${kind}-result-label`" readonly placeholder="格式化结果将显示在这里" spellcheck="false" wrap="off"></textarea></section>
      </div>
      <p class="formatter-note">{{ kind === 'json' ? '保留原始数字精度、键顺序与转义内容。' : '保留混合文本、CDATA 与 xml:space 内容；压缩仅移除结构间的排版空白。' }} 离开工具后内容暂存，刷新页面将清空。</p>
    </main>
  </div>
</template>
