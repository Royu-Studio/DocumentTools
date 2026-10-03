<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { validateFile } from '@/utils/files.js'

const props = defineProps({
  accept: { type: String, default: '.pdf,image/*' },
  allow: { type: Array, default: () => ['pdf', 'image'] },
  maxSize: { type: Number, default: undefined },
  compact: Boolean,
  title: { type: String, default: '拖拽文件到这里' },
  hint: { type: String, default: '也可以选择文件，或直接粘贴剪贴板图片' },
})
const emit = defineEmits(['file', 'error'])
const input = ref(null)
const zone = ref(null)
const dragging = ref(false)
const classes = computed(() => ({ compact: props.compact, dragging: dragging.value }))

function pick() {
  input.value?.click()
}

function acceptFile(file) {
  const result = validateFile(file, { allow: props.allow, maxSize: props.maxSize })
  if (!result.valid) {
    emit('error', result.message)
    return
  }
  emit('file', file, result.kind)
}

function onChange(event) {
  acceptFile(event.target.files?.[0])
  event.target.value = ''
}

function onDrop(event) {
  dragging.value = false
  acceptFile(event.dataTransfer?.files?.[0])
}

function onPaste(event) {
  if (!zone.value?.isConnected || !zone.value.getClientRects().length || ['INPUT', 'TEXTAREA'].includes(event.target?.tagName) || event.target?.isContentEditable) return
  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'))
  if (file && props.allow.includes('image')) acceptFile(file)
}

onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))
</script>

<template>
  <div
    ref="zone"
    class="file-drop-zone"
    :class="classes"
    role="button"
    tabindex="0"
    aria-label="选择或拖入文件"
    @click="pick"
    @keydown.enter.prevent="pick"
    @keydown.space.prevent="pick"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="input" class="visually-hidden" type="file" :accept="accept" @change="onChange" />
    <div class="drop-primary-line">
      <span class="drop-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 16V6m0 0L8 10m4-4 4 4M7 16H6a3 3 0 0 1 0-6 6 6 0 0 1 11.6-1.7A4 4 0 0 1 18 16h-1" /></svg>
      </span>
      <strong>{{ title }}</strong>
      <button class="primary-button" type="button" @click.stop="pick">选择文件</button>
    </div>
    <span>{{ hint }}</span>
    <span class="drop-privacy"><span aria-hidden="true">♢</span> 本地处理，文件不上传</span>
  </div>
</template>
