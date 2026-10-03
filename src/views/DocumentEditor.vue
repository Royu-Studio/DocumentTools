<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import FileDropZone from '@/components/FileDropZone.vue'
import ViewControls from '@/components/ViewControls.vue'
import WorkspaceLayout from '@/components/WorkspaceLayout.vue'
import { zoomAt } from '@/utils/zoomAt.js'
import { useHistory } from '@/composables/useHistory.js'
import { useCanvasResize } from '@/composables/useCanvasResize.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { formatFileSize, safeDownloadName, validateFile } from '@/utils/files.js'
import { configurePdfJsWorker } from '@/utils/pdfWorker.js'
import { pdfOverlayPlacement } from '@/utils/documentAnnotations.js'

const props = defineProps({ embedded: Boolean, active: { type: Boolean, default: true } })
const workspace = useWorkspaceStore()
const fileInput = ref(null)
const canvas = ref(null)
const viewportEl = ref(null)
const documentFile = ref(null)
const sourceImage = shallowRef(null)
const fileKind = ref('image')
const pdfDocument = shallowRef(null)
const pdfLoadingTask = shallowRef(null)
const renderTask = shallowRef(null)
const loading = ref(false)
const currentPage = ref(0)
const pageCount = ref(1)
const thumbnails = ref([])
const backgroundThumbnail = ref('')
const pageStates = new Map()
const pageHistories = new Map()
const thumbnailTasks = new Set()
let thumbnailObserver
let disposed = false
const revisionNumber = ref(0)
const stamp = ref(null)
const stampInput = ref(null)
const stampAssets = new Map()
const stampAssetId = ref(null)
let stampSequence = 0
const exportFormat = ref('png')
const downloadUrl = ref('')
const downloadName = ref('')
const sourceUrl = ref('')
const pageWidth = ref(1)
const pageHeight = ref(1)
const zoom = ref(1)
const activeTool = ref('pan')
const strokes = ref([])
const texts = ref([])
const selectedTextIndex = ref(null)
const brushColor = ref('#ffffff')
const brushSize = ref(20)
const brushOpacity = ref(1)
const colorPicker = ref(false)
const textDraft = ref('')
const textInput = ref(null)
const inputPosition = ref(null)
const composing = ref(false)
const exporting = ref(false)
const error = ref('')
const status = ref('请选择 PDF 或图片开始编辑。')
const raf = ref(0)
const interaction = ref(null)
const activePointers = new Map()
const spacePressed = ref(false)
const history = shallowRef(useHistory({ strokes: [], texts: [], stamp: null }))
const isBusy = computed(() => loading.value || exporting.value)
useCanvasResize(viewportEl, fitToWindow, () => props.active)

// 文件一经首页交接就立即进入工作台，解码期间不再闪回“重新选择文件”。
const hasFile = computed(() => Boolean(documentFile.value))
const fileSummary = computed(() => documentFile.value ? `${pageCount.value} 页 · ${formatFileSize(documentFile.value.size)}` : '')
const selectedText = computed(() => selectedTextIndex.value === null ? null : texts.value[selectedTextIndex.value] || null)
const stageStyle = computed(() => ({ width: `${pageWidth.value * zoom.value}px`, height: `${pageHeight.value * zoom.value}px` }))
const inputStyle = computed(() => inputPosition.value ? ({ left: `${Math.max(0, Math.min(inputPosition.value.x * zoom.value, pageWidth.value * zoom.value - 240))}px`, top: `${Math.max(50, inputPosition.value.y * zoom.value)}px` }) : {})
const stampStyle = computed(() => stamp.value ? ({ left: `${stamp.value.x * zoom.value}px`, top: `${stamp.value.y * zoom.value}px`, width: `${stamp.value.width * zoom.value}px`, height: `${stamp.value.height * zoom.value}px` }) : {})
const selectionStyle = computed(() => {
  const item = selectedText.value
  if (!item || !canvas.value) return {}
  const context = canvas.value.getContext('2d')
  context.font = fontString(item)
  const width = Math.max(24, context.measureText(item.text).width)
  const height = item.fontSize * 1.35
  let left = item.x
  if (item.align === 'center') left -= width / 2
  if (item.align === 'right') left -= width
  return { left: `${left * zoom.value}px`, top: `${(item.y - item.fontSize) * zoom.value}px`, width: `${width * zoom.value}px`, height: `${height * zoom.value}px`, transform: `rotate(${item.rotation}deg)` }
})

function snapshot() { return { strokes: strokes.value, texts: texts.value, stamp: stamp.value } }
function savePage() {
  pageStates.set(currentPage.value, JSON.parse(JSON.stringify({ ...snapshot(), width: pageWidth.value, height: pageHeight.value })))
}
function clearDownload() {
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value)
  downloadUrl.value = ''
}
function commit() {
  history.value.commit(snapshot())
  savePage()
  revisionNumber.value++
  clearDownload()
  updateThumbnail()
}
function applySnapshot(value) {
  if (!value) return
  strokes.value = value.strokes
  texts.value = value.texts
  stamp.value = value.stamp
  if (selectedTextIndex.value >= texts.value.length) selectedTextIndex.value = null
  renderCanvas()
  savePage()
  revisionNumber.value++
  clearDownload()
  updateThumbnail()
}
function undo() { if (!isBusy.value) { cancelText(); applySnapshot(history.value.undo()) } }
function redo() { if (!isBusy.value) { cancelText(); applySnapshot(history.value.redo()) } }

function restorePage() {
  const state = pageStates.get(currentPage.value) || { strokes: [], texts: [], stamp: null }
  const copy = JSON.parse(JSON.stringify(state))
  strokes.value = copy.strokes
  texts.value = copy.texts
  stamp.value = copy.stamp
  selectedTextIndex.value = null
  cancelText()
  if (!pageHistories.has(currentPage.value)) pageHistories.set(currentPage.value, useHistory(snapshot()))
  history.value = pageHistories.get(currentPage.value)
}

async function loadFile(file) {
  const validation = validateFile(file)
  if (!validation.valid) throw new Error(validation.message)
  await cleanupDocument()
  disposed = false
  loading.value = true
  error.value = ''
  status.value = '正在读取文件…'
  documentFile.value = file
  fileKind.value = validation.kind
  exportFormat.value = validation.kind === 'pdf' ? 'pdf' : 'png'
  currentPage.value = 0
  pageCount.value = 1
  pageStates.clear()
  pageHistories.clear()
  revisionNumber.value = 0
  workspace.setCurrentFileName(file.name)
  try {
    if (validation.kind === 'pdf') {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      configurePdfJsWorker(pdfjs)
      pdfLoadingTask.value = pdfjs.getDocument({ data: await file.arrayBuffer() })
      pdfDocument.value = await pdfLoadingTask.value.promise
      pageCount.value = pdfDocument.value.numPages
      thumbnailObserver = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          void ensureThumbnail(Number(entry.target.dataset.pageIndex))
          thumbnailObserver?.unobserve(entry.target)
        }
      }, { rootMargin: '300px' })
      await renderPdfPage()
    } else {
      sourceUrl.value = URL.createObjectURL(file)
      const image = new Image()
      image.decoding = 'async'
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = sourceUrl.value })
      sourceImage.value = image
      pageWidth.value = image.naturalWidth
      pageHeight.value = image.naturalHeight
    }
    restorePage()
    await nextTick()
    setupCanvas()
    fitToWindow()
    updateThumbnail()
    status.value = '文件已就绪。文字、涂抹、取色和印章均可用于当前页面。'
  } catch (reason) {
    documentFile.value = null
    sourceImage.value = null
    workspace.setCurrentFileName('')
    await cleanupDocument()
    throw new Error(`文件无法读取，可能已损坏、受密码保护或格式不支持：${reason.message}`)
  } finally { loading.value = false }
}

async function renderPdfPage() {
  const page = await pdfDocument.value.getPage(currentPage.value + 1)
  const original = page.getViewport({ scale: 1 })
  const scale = Math.min(1.5, 8192 / Math.max(original.width, original.height), Math.sqrt(16000000 / (original.width * original.height)))
  const viewport = page.getViewport({ scale })
  const surface = document.createElement('canvas')
  surface.width = Math.ceil(viewport.width)
  surface.height = Math.ceil(viewport.height)
  renderTask.value = page.render({ canvasContext: surface.getContext('2d', { alpha: false }), viewport })
  await renderTask.value.promise
  renderTask.value = null
  if (disposed) return
  sourceImage.value = surface
  pageWidth.value = surface.width
  pageHeight.value = surface.height
}

async function selectPage(index) {
  if (index === currentPage.value || isBusy.value) return
  confirmText()
  savePage()
  const previous = currentPage.value
  loading.value = true
  error.value = ''
  currentPage.value = index
  try {
    await renderPdfPage()
    restorePage()
    await nextTick()
    setupCanvas()
    fitToWindow()
    updateThumbnail()
    viewportEl.value.scrollTop = 0
    viewportEl.value.scrollLeft = 0
  } catch (reason) {
    currentPage.value = previous
    showError(`页面读取失败：${reason.message}`)
  } finally { loading.value = false }
}

function setThumbnailRef(element, index) {
  if (!element) return
  element.dataset.pageIndex = index
  thumbnailObserver?.observe(element)
}
async function ensureThumbnail(index) {
  const pdf = pdfDocument.value
  if (!pdf || thumbnails.value[index] || thumbnailTasks.has(index)) return
  thumbnailTasks.add(index)
  try {
    const page = await pdf.getPage(index + 1)
    const viewport = page.getViewport({ scale: .18 })
    const surface = document.createElement('canvas')
    surface.width = Math.ceil(viewport.width)
    surface.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: surface.getContext('2d'), viewport }).promise
    if (pdf === pdfDocument.value && !thumbnails.value[index]) thumbnails.value[index] = surface.toDataURL('image/jpeg', .75)
  } catch { /* The page remains accessible even if its thumbnail fails. */ }
  finally { thumbnailTasks.delete(index) }
}
function updateThumbnail() {
  if (!canvas.value || !sourceImage.value) return
  renderCanvas()
  const thumb = document.createElement('canvas')
  const ratio = Math.min(160 / pageWidth.value, 120 / pageHeight.value)
  thumb.width = Math.max(1, Math.round(pageWidth.value * ratio))
  thumb.height = Math.max(1, Math.round(pageHeight.value * ratio))
  thumb.getContext('2d').drawImage(canvas.value, 0, 0, thumb.width, thumb.height)
  thumbnails.value[currentPage.value] = thumb.toDataURL('image/png')
}

async function cleanupDocument() {
  thumbnailObserver?.disconnect()
  thumbnailObserver = null
  thumbnailTasks.clear()
  renderTask.value?.cancel()
  renderTask.value = null
  try { await pdfLoadingTask.value?.destroy() } catch { /* Already destroyed. */ }
  pdfLoadingTask.value = null
  pdfDocument.value = null
  thumbnails.value = []
  revokeImageUrl()
  for (const asset of stampAssets.values()) URL.revokeObjectURL(asset.url)
  stampAssets.clear()
  stampAssetId.value = null
  clearDownload()
  sourceImage.value = null
  if (canvas.value) { canvas.value.width = 1; canvas.value.height = 1 }
}

function drawAnnotations(context, state) {
  for (const stroke of state.strokes) drawStroke(context, stroke)
  for (const item of state.texts) drawText(context, item)
  if (state.stamp) {
    const item = state.stamp
    const asset = stampAssets.get(item.assetId)
    if (asset) {
      context.save()
      context.globalAlpha = item.opacity
      context.drawImage(asset.image, item.x, item.y, item.width, item.height)
      context.restore()
    }
  }
}

function setupCanvas() {
  if (!canvas.value || !sourceImage.value) return
  canvas.value.width = pageWidth.value
  canvas.value.height = pageHeight.value
  const thumb = document.createElement('canvas')
  const ratio = Math.min(80 / pageWidth.value, 80 / pageHeight.value)
  thumb.width = Math.max(1, Math.round(pageWidth.value * ratio))
  thumb.height = Math.max(1, Math.round(pageHeight.value * ratio))
  thumb.getContext('2d').drawImage(sourceImage.value, 0, 0, thumb.width, thumb.height)
  backgroundThumbnail.value = thumb.toDataURL('image/png')
  renderCanvas()
}

function renderCanvas() {
  if (!canvas.value || !sourceImage.value) return
  const context = canvas.value.getContext('2d')
  context.clearRect(0, 0, pageWidth.value, pageHeight.value)
  context.drawImage(sourceImage.value, 0, 0, pageWidth.value, pageHeight.value)
  drawAnnotations(context, snapshot())
}

function drawStroke(context, stroke) {
  if (!stroke.points?.length) return
  context.save()
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = stroke.opacity
  context.strokeStyle = stroke.color
  context.lineWidth = stroke.size
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(stroke.points[0].x, stroke.points[0].y)
  if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y)
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1]
    const point = stroke.points[index]
    const middleX = (previous.x + point.x) / 2
    const middleY = (previous.y + point.y) / 2
    context.quadraticCurveTo(previous.x, previous.y, middleX, middleY)
  }
  context.stroke()
  context.restore()
}

function fontString(item) {
  return `${item.italic ? 'italic ' : ''}${item.bold ? '700 ' : '400 '}${item.fontSize}px ${item.fontFamily}`
}

function drawText(context, item) {
  context.save()
  context.translate(item.x, item.y)
  context.rotate(item.rotation * Math.PI / 180)
  context.globalAlpha = item.opacity
  context.font = fontString(item)
  context.fillStyle = item.color
  context.textAlign = item.align
  context.textBaseline = 'alphabetic'
  context.fillText(item.text, 0, 0)
  if (item.underline) {
    const width = context.measureText(item.text).width
    const offset = item.align === 'center' ? -width / 2 : item.align === 'right' ? -width : 0
    context.beginPath()
    context.moveTo(offset, 4)
    context.lineTo(offset + width, 4)
    context.lineWidth = Math.max(1, item.fontSize / 18)
    context.strokeStyle = item.color
    context.stroke()
  }
  context.restore()
}

function getPoint(event) {
  const bounds = canvas.value.getBoundingClientRect()
  return { x: (event.clientX - bounds.left) * pageWidth.value / bounds.width, y: (event.clientY - bounds.top) * pageHeight.value / bounds.height }
}

function startPointer(event) {
  if (!props.active || !sourceImage.value || isBusy.value || (event.pointerType === 'mouse' && event.button > 1)) return
  if (event.pointerType === 'touch') {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (activePointers.size === 2) {
      if (interaction.value?.type === 'brush') strokes.value.pop()
      if (interaction.value?.type === 'text-drag' && selectedText.value) Object.assign(selectedText.value, interaction.value.original)
      if (interaction.value?.type?.startsWith('stamp-')) stamp.value = { ...interaction.value.original }
      inputPosition.value = null
      scheduleRender()
      interaction.value = { type: 'pinch', distance: pointerDistance(), center: pointerCenter() }
      return
    }
  }
  if (activePointers.size > 1) return
  const point = getPoint(event)
  if (event.button === 1 || spacePressed.value || activeTool.value === 'pan' || event.target !== canvas.value) {
    interaction.value = { type: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: viewportEl.value.scrollLeft, scrollTop: viewportEl.value.scrollTop }
  } else if (activeTool.value === 'brush') {
    if (colorPicker.value) {
      const pixel = canvas.value.getContext('2d').getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data
      brushColor.value = rgbToHex(pixel[0], pixel[1], pixel[2])
      colorPicker.value = false
      status.value = `已取色 ${brushColor.value}`
      return
    }
    strokes.value.push({ color: brushColor.value, size: brushSize.value, opacity: brushOpacity.value, points: [point] })
    interaction.value = { type: 'brush', pointerId: event.pointerId }
    scheduleRender()
  } else if (activeTool.value === 'stamp') {
    const item = stamp.value
    if (item && point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height) {
      interaction.value = { type: 'stamp-drag', pointerId: event.pointerId, point, original: { ...item } }
    } else if (stampAssetId.value) placeStamp(point)
    else stampInput.value?.click()
  } else {
    const hit = hitText(point)
    if (hit !== null) {
      selectedTextIndex.value = hit
      const item = texts.value[hit]
      interaction.value = { type: 'text-drag', pointerId: event.pointerId, offsetX: point.x - item.x, offsetY: point.y - item.y, original: { x: item.x, y: item.y } }
      inputPosition.value = null
    } else {
      selectedTextIndex.value = null
      textDraft.value = ''
      inputPosition.value = { ...point, fontSize: 24 }
      nextTick(() => textInput.value?.focus())
    }
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function movePointer(event) {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (activePointers.size === 2 && interaction.value?.type === 'pinch') {
    event.preventDefault()
    const distance = pointerDistance()
    const center = pointerCenter()
    zoomAt(viewportEl.value, canvas.value, zoom, clamp(zoom.value * distance / Math.max(1, interaction.value.distance), 0.1, 4), center, interaction.value.center)
    interaction.value = { type: 'pinch', distance, center }
    return
  }
  const state = interaction.value
  if (!state || state.pointerId !== event.pointerId) return
  event.preventDefault()
  if (state.type === 'pan') {
    viewportEl.value.scrollLeft = state.scrollLeft - (event.clientX - state.x)
    viewportEl.value.scrollTop = state.scrollTop - (event.clientY - state.y)
  } else if (state.type === 'brush') {
    strokes.value[strokes.value.length - 1].points.push(getPoint(event))
    scheduleRender()
  } else if (state.type === 'text-drag' && selectedText.value) {
    const point = getPoint(event)
    selectedText.value.x = clamp(point.x - state.offsetX, 0, pageWidth.value)
    selectedText.value.y = clamp(point.y - state.offsetY, 0, pageHeight.value)
    scheduleRender()
  } else if (state.type === 'stamp-drag' && stamp.value) {
    const point = getPoint(event)
    stamp.value.x = clamp(state.original.x + point.x - state.point.x, 0, pageWidth.value - stamp.value.width)
    stamp.value.y = clamp(state.original.y + point.y - state.point.y, 0, pageHeight.value - stamp.value.height)
    scheduleRender()
  } else if (state.type === 'stamp-resize' && stamp.value) {
    const point = getPoint(event)
    const original = state.original
    const aspect = original.width / original.height
    const dx = point.x - state.point.x
    const dy = point.y - state.point.y
    const maxWidth = Math.min(pageWidth.value - original.x, (pageHeight.value - original.y) * aspect)
    stamp.value.width = clamp(original.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy * aspect), Math.min(20, maxWidth), maxWidth)
    stamp.value.height = stamp.value.width / aspect
    scheduleRender()
  }
}

function endPointer(event) {
  activePointers.delete(event.pointerId)
  const state = interaction.value
  if (state?.pointerId === event.pointerId && ['brush', 'text-drag', 'stamp-drag', 'stamp-resize'].includes(state.type)) {
    if (event.type === 'pointercancel') {
      if (state.type === 'brush') strokes.value.pop()
      else if (state.type === 'text-drag' && selectedText.value) Object.assign(selectedText.value, state.original)
      else if (state.type.startsWith('stamp-')) stamp.value = state.original
      renderCanvas()
    } else commit()
  }
  if (activePointers.size < 2) {
    const remaining = [...activePointers.entries()][0]
    interaction.value = remaining ? { type: 'pan', pointerId: remaining[0], ...remaining[1], scrollLeft: viewportEl.value.scrollLeft, scrollTop: viewportEl.value.scrollTop } : null
  }
}

function selectTool(tool) {
  if (!props.active || isBusy.value) return
  confirmText()
  colorPicker.value = false
  activeTool.value = tool
  if (tool !== 'text') selectedTextIndex.value = null
}

async function acceptStamp(file) {
  if (!file || isBusy.value) return
  const validation = validateFile(file, { allow: ['image'] })
  if (!validation.valid) return showError(validation.message)
  if (!['image/png', 'image/jpeg'].includes(file.type)) return showError('印章支持 PNG 或 JPG 图片。')
  loading.value = true
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
    const id = ++stampSequence
    stampAssets.set(id, { image, url })
    stampAssetId.value = id
    activeTool.value = 'stamp'
    colorPicker.value = false
    confirmText()
    selectedTextIndex.value = null
    placeStamp()
    error.value = ''
  } catch { URL.revokeObjectURL(url); showError('印章图片无法读取，请重新选择。') }
  finally { loading.value = false }
}
function placeStamp(point = { x: pageWidth.value / 2, y: pageHeight.value / 2 }) {
  const asset = stampAssets.get(stampAssetId.value)
  if (!asset) return
  const aspect = asset.image.naturalWidth / asset.image.naturalHeight
  const width = Math.min(pageWidth.value * .18, pageHeight.value * .8 * aspect)
  const height = width / aspect
  stamp.value = { assetId: stampAssetId.value, x: clamp(point.x - width / 2, 0, pageWidth.value - width), y: clamp(point.y - height / 2, 0, pageHeight.value - height), width, height, opacity: .8 }
  renderCanvas()
  commit()
}
function startStampResize(event) {
  if (!stamp.value || isBusy.value) return
  if (event.pointerType === 'touch') activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  interaction.value = { type: 'stamp-resize', pointerId: event.pointerId, point: getPoint(event), original: { ...stamp.value } }
}
function updateStamp(key, value, save = false) {
  const item = stamp.value
  if (!item) return
  if (key === 'width') {
    const aspect = item.width / item.height
    item.width = clamp(Number(value) * pageWidth.value, 1, Math.min(pageWidth.value, pageHeight.value * aspect))
    item.height = item.width / aspect
    item.x = clamp(item.x, 0, pageWidth.value - item.width)
    item.y = clamp(item.y, 0, pageHeight.value - item.height)
  } else if (key === 'x') item.x = clamp(Number(value) * pageWidth.value, 0, pageWidth.value - item.width)
  else if (key === 'y') item.y = clamp(Number(value) * pageHeight.value, 0, pageHeight.value - item.height)
  else item.opacity = clamp(Number(value), .1, 1)
  renderCanvas()
  if (save) commit()
}
function nudgeStamp(dx, dy) {
  if (!stamp.value) return
  updateStamp('x', stamp.value.x / pageWidth.value + dx)
  updateStamp('y', stamp.value.y / pageHeight.value + dy, true)
}
function removeStamp() { stamp.value = null; renderCanvas(); commit() }

function pointerDistance() {
  const [a, b] = [...activePointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function pointerCenter() {
  const [a, b] = [...activePointers.values()]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function hitText(point) {
  if (!canvas.value) return null
  const context = canvas.value.getContext('2d')
  for (let index = texts.value.length - 1; index >= 0; index -= 1) {
    const item = texts.value[index]
    context.font = fontString(item)
    const width = context.measureText(item.text).width
    const angle = -item.rotation * Math.PI / 180
    const dx = point.x - item.x, dy = point.y - item.y
    const x = dx * Math.cos(angle) - dy * Math.sin(angle)
    const y = dx * Math.sin(angle) + dy * Math.cos(angle)
    const left = item.align === 'center' ? -width / 2 : item.align === 'right' ? -width : 0
    if (x >= left - 8 && x <= left + width + 8 && y >= -item.fontSize * 1.2 && y <= 10) return index
  }
  return null
}

function confirmText() {
  if (composing.value) return
  const text = textDraft.value.trim()
  if (!text || !inputPosition.value) return cancelText()
  texts.value.push({
    text, x: inputPosition.value.x, y: inputPosition.value.y, fontFamily: "'Microsoft YaHei', sans-serif", fontSize: 24,
    color: '#000000', bold: false, italic: false, underline: false, rotation: 0, opacity: 1, align: 'left',
  })
  selectedTextIndex.value = texts.value.length - 1
  inputPosition.value = null
  textDraft.value = ''
  renderCanvas()
  commit()
}
function cancelText() { inputPosition.value = null; textDraft.value = '' }

function updateSelected(key, value, save = false) {
  if (!selectedText.value) return
  selectedText.value[key] = ['fontSize', 'rotation', 'opacity'].includes(key) ? Number(value) : value
  renderCanvas()
  if (save) commit()
}
function toggleSelected(key) { updateSelected(key, !selectedText.value[key], true) }
function deleteSelected() {
  if (selectedTextIndex.value === null) return
  texts.value.splice(selectedTextIndex.value, 1)
  selectedTextIndex.value = null
  renderCanvas()
  commit()
}
function clearBrush() { strokes.value = []; renderCanvas(); commit() }
function resetEditor() {
  strokes.value = []
  texts.value = []
  stamp.value = null
  selectedTextIndex.value = null
  zoom.value = 1
  if (viewportEl.value) { viewportEl.value.scrollLeft = 0; viewportEl.value.scrollTop = 0 }
  cancelText()
  renderCanvas()
  commit()
}

function scheduleRender() {
  if (raf.value) return
  raf.value = requestAnimationFrame(() => { raf.value = 0; renderCanvas() })
}
function setZoom(value) { zoom.value = clamp(value, 0.1, 4) }
function fitToWindow() {
  if (!viewportEl.value || !hasFile.value) return
  const { clientWidth, clientHeight } = viewportEl.value
  setZoom(Math.min((clientWidth - 48) / pageWidth.value, (clientHeight - 48) / pageHeight.value, 1.5))
}
function handleWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  zoomAt(viewportEl.value, canvas.value, zoom, clamp(zoom.value * (event.deltaY > 0 ? 0.9 : 1.1), 0.1, 4), { x: event.clientX, y: event.clientY })
}

async function exportDocument() {
  if (!canvas.value || isBusy.value) return
  exporting.value = true
  error.value = ''
  try {
    const format = exportFormat.value
    const blob = format === 'pdf' ? await getPdfSnapshot() : await getImageSnapshot()
    clearDownload()
    downloadUrl.value = URL.createObjectURL(blob)
    downloadName.value = safeDownloadName(documentFile.value.name, format === 'png' && pageCount.value > 1 ? `第${currentPage.value + 1}页` : '已编辑', format)
    const link = document.createElement('a')
    link.href = downloadUrl.value
    link.download = downloadName.value
    link.target = '_blank'
    link.rel = 'noopener'
    link.click()
    status.value = `${format === 'pdf' ? `PDF 已生成，共 ${pageCount.value} 页` : '当前页 PNG 已生成'}。如未自动下载，请点击“保存文件”。`
  } catch (reason) {
    showError(`导出失败：${reason.message}`)
  } finally { exporting.value = false }
}

function handleDrop(event) {
  if (props.embedded) { showError('请使用顶部“打开文件”，新图片会保留为独立标签。'); return }
  const file = event.dataTransfer?.files?.[0]
  if (file) loadFile(file).catch(reason => showError(reason.message))
}
function showError(message) { error.value = message; status.value = message }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function rgbToHex(red, green, blue) { return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}` }
function isTypingTarget(target) { return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable }
function onKeydown(event) {
  if (!props.active || isBusy.value) return
  if (isTypingTarget(event.target)) return
  if (event.code === 'Space') { spacePressed.value = true; event.preventDefault() }
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
  else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
  else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedText.value) { event.preventDefault(); deleteSelected() }
  else if ((event.key === 'Delete' || event.key === 'Backspace') && activeTool.value === 'stamp' && stamp.value) { event.preventDefault(); removeStamp() }
  else if (event.key === 'Escape') { cancelText(); selectedTextIndex.value = null; interaction.value = null }
}
function onKeyup(event) { if (event.code === 'Space') spacePressed.value = false }
function revokeImageUrl() { if (sourceUrl.value) { URL.revokeObjectURL(sourceUrl.value); sourceUrl.value = '' } }

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  const staged = workspace.takeFile('image') || workspace.takeFile('pdf')
  if (staged) try { await loadFile(staged) } catch (reason) { showError(reason.message) }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  if (raf.value) cancelAnimationFrame(raf.value)
  disposed = true
  void cleanupDocument()
})
watch(() => props.active, active => {
  if (!active) { activePointers.clear(); interaction.value = null; spacePressed.value = false }
})
async function getImageSnapshot() {
  if (!canvas.value || !sourceImage.value) return null
  if (inputPosition.value) confirmText()
  renderCanvas()
  const blob = await new Promise((resolve, reject) => canvas.value.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), 'image/png'))
  return new File([blob], documentFile.value.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' })
}
async function getPdfSnapshot() {
  if (!sourceImage.value) return null
  confirmText()
  savePage()
  const { PDFDocument, degrees } = await import('@pdfme/pdf-lib')
  if (fileKind.value !== 'pdf') {
    const imageFile = await getImageSnapshot()
    const output = await PDFDocument.create()
    const image = await output.embedPng(await imageFile.arrayBuffer())
    const scale = Math.min(.75, 14400 / Math.max(pageWidth.value, pageHeight.value))
    const page = output.addPage([pageWidth.value * scale, pageHeight.value * scale])
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    return new File([await output.save()], documentFile.value.name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' })
  }
  const edits = [...pageStates.entries()].filter(([, state]) => state.texts.length || state.strokes.length || state.stamp)
  if (!edits.length) return documentFile.value
  const output = await PDFDocument.load(await documentFile.value.arrayBuffer())
  for (const [index, state] of edits) {
    const surface = document.createElement('canvas')
    // Render added text/stamps above preview resolution without rasterizing the
    // original PDF. Bound the temporary bitmap for unusually large pages.
    const scale = Math.min(2, 8192 / Math.max(state.width, state.height), Math.sqrt(16000000 / (state.width * state.height)))
    surface.width = Math.max(1, Math.round(state.width * scale))
    surface.height = Math.max(1, Math.round(state.height * scale))
    const context = surface.getContext('2d')
    context.scale(surface.width / state.width, surface.height / state.height)
    drawAnnotations(context, state)
    const overlay = await new Promise((resolve, reject) => surface.toBlob(blob => blob ? resolve(blob) : reject(new Error('页面编码失败')), 'image/png'))
    const image = await output.embedPng(await overlay.arrayBuffer())
    const source = await pdfDocument.value.getPage(index + 1)
    const { angle, ...placement } = pdfOverlayPlacement(source.getViewport({ scale: 1 }))
    output.getPage(index).drawImage(image, { ...placement, rotate: degrees(angle) })
    surface.width = 1
    surface.height = 1
  }
  return new File([await output.save()], documentFile.value.name, { type: 'application/pdf' })
}
function wordProtectedRegions() {
  savePage()
  return [...pageStates].filter(([, state]) => state.stamp).map(([index, state]) => ({ page: index + 1, x: state.stamp.x / state.width, y: state.stamp.y / state.height, width: state.stamp.width / state.width, height: state.stamp.height / state.height }))
}
defineExpose({ isBusy, load: loadFile, snapshot: () => fileKind.value === 'pdf' ? getPdfSnapshot() : getImageSnapshot(), pdfSnapshot: getPdfSnapshot, revision: () => JSON.stringify([revisionNumber.value, textDraft.value]), fit: fitToWindow, wordProtectedRegions })
</script>

<template>
  <WorkspaceLayout :embedded="embedded" :title="documentFile?.name || '文档编辑工作台'" :subtitle="fileSummary" :has-file="hasFile" left-label="页面 / 图层">
    <template #history><button class="text-button" :disabled="!active || isBusy || !history.canUndo.value" @click="undo">撤销</button><button class="text-button" :disabled="!active || isBusy || !history.canRedo.value" @click="redo">重做</button></template>
    <template #actions>
      <button v-if="hasFile" class="tonal-button secondary-action" :disabled="!active || isBusy || !history.canUndo.value" @click="undo">撤销</button>
      <button v-if="hasFile" class="tonal-button secondary-action" :disabled="!active || isBusy || !history.canRedo.value" @click="redo">重做</button>
      <select v-if="hasFile" v-model="exportFormat" class="export-format" aria-label="导出格式" :disabled="!active || isBusy"><option value="pdf">PDF（全部页）</option><option value="png">PNG（当前页）</option></select>
      <button v-if="hasFile" class="primary-button" :disabled="!active || isBusy" @click="exportDocument">{{ exporting ? '生成中…' : '导出文件' }}</button>
      <a v-if="downloadUrl" class="text-button" :href="downloadUrl" :download="downloadName" target="_blank" rel="noopener">保存文件</a>
    </template>

    <template #left>
      <h2 class="panel-title">页面 <span>{{ currentPage + 1 }} / {{ pageCount }}</span></h2>
      <div class="page-list">
        <button v-for="index in pageCount" :key="index" :ref="el => setThumbnailRef(el, index - 1)" class="page-thumb" :class="{ active: currentPage === index - 1 }" :disabled="!active || isBusy" @click="selectPage(index - 1)">
          <img v-if="thumbnails[index - 1]" :src="thumbnails[index - 1]" :alt="`第 ${index} 页缩略图`" />
          <span v-else class="thumb-loading">{{ index }}</span><small>第 {{ index }} 页</small>
        </button>
      </div>
      <h2 class="panel-title layers-heading">当前页图层 <span>{{ texts.length + strokes.length + (stamp ? 1 : 0) + 1 }}</span></h2>
      <div class="layer-list">
        <button v-if="stamp" class="layer-item" :disabled="!active || isBusy" :class="{ active: activeTool === 'stamp' }" @click="selectTool('stamp')"><span class="layer-eye">◉</span><span class="layer-thumb"><img :src="stampAssets.get(stamp.assetId)?.url" alt="" /></span><strong>印章</strong></button>
        <button v-for="(item, index) in [...texts].reverse()" :key="`text-${texts.length - index - 1}`" class="layer-item" :disabled="!active || isBusy" :class="{ active: selectedTextIndex === texts.length - index - 1 }" @click="selectTool('text'); selectedTextIndex = texts.length - index - 1">
          <span class="layer-eye">◉</span><span class="layer-symbol">T</span><strong>{{ item.text || '标注文字' }}</strong>
        </button>
        <button v-for="(stroke, index) in [...strokes].reverse()" :key="`stroke-${index}`" class="layer-item" :disabled="!active || isBusy" @click="selectTool('brush')">
          <span class="layer-eye">◉</span><span class="layer-stroke" :style="{ background: stroke.color }"></span><strong>涂抹标记 {{ strokes.length - index }}</strong>
        </button>
        <div class="layer-item background-layer"><span class="layer-eye">◉</span><span class="layer-thumb"><img v-if="backgroundThumbnail" :src="backgroundThumbnail" alt="" /></span><strong>原始页面</strong></div>
      </div>
      <div class="layer-footer"><button class="text-button" :disabled="!active || isBusy || (!texts.length && !strokes.length && !stamp)" @click="resetEditor">清除当前页编辑</button></div>
    </template>

    <template #toolbar>
      <button class="tool-button" :disabled="!active || isBusy" :class="{ active: activeTool === 'text' }" @click="selectTool('text')">文字</button>
      <button class="tool-button" :disabled="!active || isBusy" :class="{ active: activeTool === 'brush' && !colorPicker }" @click="selectTool('brush')">涂抹</button>
      <button class="tool-button" :disabled="!active || isBusy" :class="{ active: colorPicker }" @click="selectTool('brush'); colorPicker = true">取色</button>
      <button class="tool-button" :disabled="!active || isBusy" :class="{ active: activeTool === 'stamp' }" @click="selectTool('stamp')">印章</button>
      <button class="tool-button" :disabled="!active || isBusy" :class="{ active: activeTool === 'pan' }" @click="selectTool('pan')">移动</button>
      <ViewControls :zoom="zoom" @zoom-in="setZoom(zoom + .1)" @zoom-out="setZoom(zoom - .1)" @fit="fitToWindow" @actual="setZoom(1)" />
    </template>

    <template #right>
      <fieldset class="editor-properties" :disabled="!active || isBusy">
        <template v-if="activeTool === 'text'">
          <h2 class="panel-title">文字属性</h2>
          <div v-if="selectedText" class="property-stack">
            <label class="field"><span>文字内容</span><textarea :value="selectedText.text" rows="3" @input="updateSelected('text', $event.target.value)" @change="commit" /></label>
            <label class="field"><span>字体</span><select :value="selectedText.fontFamily" @change="updateSelected('fontFamily', $event.target.value, true)"><option value="Arial, sans-serif">Arial</option><option value="'Microsoft YaHei', sans-serif">微软雅黑</option><option value="'SimHei', sans-serif">黑体</option><option value="'SimSun', serif">宋体</option><option value="'KaiTi', serif">楷体</option></select></label>
            <label class="field"><span>字号 {{ selectedText.fontSize }}</span><input type="range" min="12" max="200" :value="selectedText.fontSize" @input="updateSelected('fontSize', $event.target.value)" @change="commit" /></label>
            <label class="field"><span>颜色</span><input type="color" :value="selectedText.color" @input="updateSelected('color', $event.target.value)" @change="commit" /></label>
            <label class="field"><span>对齐</span><select :value="selectedText.align" @change="updateSelected('align', $event.target.value, true)"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
            <label class="field"><span>旋转 {{ selectedText.rotation }}°</span><input type="range" min="-180" max="180" :value="selectedText.rotation" @input="updateSelected('rotation', $event.target.value)" @change="commit" /></label>
            <label class="field"><span>透明度 {{ Math.round(selectedText.opacity * 100) }}%</span><input type="range" min="10" max="100" :value="selectedText.opacity * 100" @input="updateSelected('opacity', $event.target.value / 100)" @change="commit" /></label>
            <div class="style-buttons"><button class="tonal-button" :class="{ selected: selectedText.bold }" @click="toggleSelected('bold')">粗体</button><button class="tonal-button" :class="{ selected: selectedText.italic }" @click="toggleSelected('italic')">斜体</button><button class="tonal-button" :class="{ selected: selectedText.underline }" @click="toggleSelected('underline')">下划线</button></div>
            <button class="danger-button" @click="deleteSelected">删除文字</button>
          </div>
          <p v-else class="status-message">在页面上点击位置并输入文字；点击已有文字可拖动和编辑。</p>
        </template>
        <template v-else-if="activeTool === 'brush'">
          <h2 class="panel-title">{{ colorPicker ? '取色' : '涂抹属性' }}</h2>
          <div class="property-stack">
            <label class="field"><span>颜色</span><input v-model="brushColor" type="color" /></label>
            <label class="field"><span>粗细 {{ brushSize }}</span><input v-model.number="brushSize" type="range" min="5" max="50" /></label>
            <label class="field"><span>透明度 {{ Math.round(brushOpacity * 100) }}%</span><input v-model.number="brushOpacity" type="range" min="0.05" max="1" step="0.05" /></label>
            <button class="tonal-button" :class="{ selected: colorPicker }" @click="colorPicker = !colorPicker">{{ colorPicker ? '点击页面取色' : '取色器' }}</button>
            <button class="danger-button" :disabled="!strokes.length" @click="clearBrush">清除当前页涂抹</button>
          </div>
        </template>
        <template v-else-if="activeTool === 'stamp'">
          <h2 class="panel-title">印章属性</h2>
          <div class="property-stack">
            <button class="tonal-button" @click="stampInput.click()">{{ stampAssetId ? '更换印章图片' : '选择印章图片' }}</button>
            <button v-if="stampAssetId && !stamp" class="tonal-button" @click="placeStamp()">放到当前页</button>
            <template v-if="stamp">
              <div class="nudge-grid"><button class="tonal-button" @click="nudgeStamp(0, -.01)">上移</button><button class="tonal-button" @click="nudgeStamp(0, .01)">下移</button><button class="tonal-button" @click="nudgeStamp(-.01, 0)">左移</button><button class="tonal-button" @click="nudgeStamp(.01, 0)">右移</button></div>
              <label class="field"><span>印章大小 {{ Math.round(stamp.width / pageWidth * 100) }}%</span><input type="range" min="4" max="80" :value="stamp.width / pageWidth * 100" @input="updateStamp('width', $event.target.value / 100)" @change="commit" /></label>
              <label class="field"><span>印章透明度 {{ Math.round(stamp.opacity * 100) }}%</span><input type="range" min="10" max="100" :value="stamp.opacity * 100" @input="updateStamp('opacity', $event.target.value / 100)" @change="commit" /></label>
              <label class="field"><span>横向位置（%）</span><input type="number" min="0" max="100" :value="Math.round(stamp.x / pageWidth * 100)" @change="updateStamp('x', $event.target.value / 100, true)" /></label>
              <label class="field"><span>纵向位置（%）</span><input type="number" min="0" max="100" :value="Math.round(stamp.y / pageHeight * 100)" @change="updateStamp('y', $event.target.value / 100, true)" /></label>
              <button class="danger-button" @click="removeStamp">删除印章</button>
            </template>
            <p class="status-message">选择 PNG/JPG 印章后，可拖动位置或拖动右下角调整大小。</p>
          </div>
        </template>
        <template v-else><h2 class="panel-title">移动画布</h2><p class="status-message">拖动可平移，双指可缩放。桌面端也可按住空格拖动，或 Ctrl/⌘＋滚轮缩放。</p></template>
      </fieldset>
    </template>

    <div v-if="!hasFile" class="empty-workspace"><FileDropZone compact title="选择 PDF 或图片" @file="loadFile($event).catch(reason => showError(reason.message))" @error="showError" /></div>
    <div v-else ref="viewportEl" class="document-viewport" @wheel="handleWheel" @dragover.prevent @drop.prevent="handleDrop" @pointerdown="startPointer" @pointermove="movePointer" @pointerup="endPointer" @pointercancel="endPointer">
      <div class="document-stage" :class="`tool-${activeTool}`" :style="stageStyle">
        <canvas ref="canvas" aria-label="文档编辑画布"></canvas>
        <div v-if="selectedText && activeTool === 'text'" class="text-selection" :style="selectionStyle" aria-hidden="true"></div>
        <div v-if="stamp && activeTool === 'stamp'" class="stamp-selection" :style="stampStyle"><span class="resize-handle" title="调整印章大小" @pointerdown.stop="startStampResize"></span></div>
        <div v-if="inputPosition" class="floating-text-input" :style="inputStyle" @pointerdown.stop>
          <input ref="textInput" v-model="textDraft" maxlength="200" placeholder="输入文字" @compositionstart="composing = true" @compositionend="composing = false" @keydown.enter.prevent="confirmText" @keydown.esc.prevent="cancelText" />
          <button class="primary-button" @click="confirmText">添加</button>
        </div>
      </div>
    </div>
    <div v-if="loading" class="canvas-loading" role="status">正在读取页面…</div>
    <p v-if="error" class="editor-notice error" role="alert">{{ error }}</p>
    <p v-else-if="downloadUrl" class="editor-notice" role="status">{{ status }}</p>
    <input ref="fileInput" class="visually-hidden" type="file" accept=".pdf,image/*" @change="loadFile($event.target.files?.[0]).catch(reason => showError(reason.message)); $event.target.value = ''" />
    <input ref="stampInput" class="visually-hidden" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" @change="acceptStamp($event.target.files?.[0]); $event.target.value = ''" />
  </WorkspaceLayout>
</template>
<style scoped>
.empty-workspace { width: min(720px, calc(100% - 32px)); margin: 7vh auto; display: grid; gap: 12px; }
.editor-properties { min-width: 0; border: 0; padding: 0; margin: 0; }
.export-format { min-height: 42px; max-width: 138px; padding: 0 8px; border: 1px solid var(--md-outline-variant); border-radius: 12px; background: var(--md-surface); color: var(--md-on-surface); font-size: 12px; }
.page-list { display: grid; gap: 8px; max-height: 290px; overflow: auto; overscroll-behavior: contain; }
.page-thumb { min-height: 110px; padding: 8px; border: 2px solid transparent; border-radius: 10px; display: grid; place-items: center; gap: 4px; background: var(--md-surface-container-high); cursor: pointer; }
.page-thumb.active { border-color: var(--md-primary); }
.page-thumb img { max-width: 100%; max-height: 100px; }
.page-thumb small { color: var(--md-on-surface-variant); }
.layers-heading { margin-top: 22px; }
.thumb-loading { min-height: 80px; display: grid; place-items: center; }
.nudge-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stamp-selection { position: absolute; border: 2px solid var(--md-primary); pointer-events: none; }
.resize-handle { position: absolute; right: -14px; bottom: -14px; width: 28px; height: 28px; border: 3px solid var(--md-on-primary); border-radius: 50%; background: var(--md-primary); cursor: nwse-resize; touch-action: none; pointer-events: auto; }
.editor-notice { position: absolute; left: 12px; right: 12px; bottom: 12px; max-height: 100px; overflow: auto; padding: 10px 14px; margin: 0; border: 1px solid var(--md-outline-variant); border-radius: 12px; background: var(--md-surface); font-size: 12px; }
.editor-notice.error { color: var(--md-error); }
.panel-title span { float: right; color: var(--md-on-surface-variant); font-size: 12px; font-weight: 500; }
.layer-list { display: grid; gap: 8px; }
.layer-item { width: 100%; min-height: 48px; padding: 7px 8px; display: grid; grid-template-columns: 18px 32px minmax(0,1fr); align-items: center; gap: 7px; border: 1px solid var(--md-outline-variant); border-radius: 7px; background: var(--md-surface); text-align: left; cursor: pointer; }
.layer-item.active { border-color: var(--md-primary); background: var(--md-primary-container); }
.layer-item strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; font-weight: 550; }
.layer-eye { color: var(--md-outline); font-size: 11px; }
.layer-symbol { display: grid; place-items: center; height: 28px; border-radius: 4px; background: var(--md-surface-container-high); font-family: serif; }
.layer-stroke { width: 29px; height: 3px; border-radius: 99px; transform: rotate(-35deg); }
.layer-thumb { width: 30px; height: 30px; overflow: hidden; border-radius: 3px; background: #eef1f5; }
.layer-thumb img { width: 100%; height: 100%; object-fit: cover; }
.layer-footer { position: sticky; bottom: -15px; margin: 16px -15px -15px; padding: 8px 12px; display: flex; gap: 4px; border-top: 1px solid var(--md-outline-variant); background: var(--md-surface); }
.tool-button { min-width: 58px; min-height: 38px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; font-weight: 650; }
.tool-button.active { color: var(--md-primary); box-shadow: inset 0 -2px var(--md-primary); }
.document-viewport { position: absolute; inset: 0; padding: 24px; overflow: auto; display: grid; place-items: start center; overscroll-behavior: contain; touch-action: none; }
.document-stage { position: relative; flex: none; background-image: linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%); background-size: 20px 20px; background-position: 0 0,0 10px,10px -10px,-10px 0; box-shadow: 0 4px 24px rgba(0,0,0,.22); }
.document-stage canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
.document-stage.tool-pan canvas { cursor: grab; }
.document-stage.tool-text canvas { cursor: text; }
.text-selection { position: absolute; border: 2px solid var(--md-primary); transform-origin: center; pointer-events: none; }
.floating-text-input { position: absolute; z-index: 5; display: flex; gap: 6px; transform: translateY(-100%); }
.floating-text-input input { min-width: 180px; min-height: 44px; padding: 8px 10px; border: 2px solid var(--md-primary); border-radius: var(--radius-sm); color: #111; background: rgba(255,255,255,.94); }
.style-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.style-buttons .tonal-button { padding-inline: 12px; }
.selected { box-shadow: inset 0 0 0 2px var(--md-primary); }
.property-tabs { margin: -15px -15px 16px; display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--md-outline-variant); }
.property-tabs span { padding: 13px; text-align: center; color: var(--md-on-surface-variant); font-size: 13px; }
.property-tabs .active { color: var(--md-primary); box-shadow: inset 0 -2px var(--md-primary); }
.canvas-loading { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 12px 16px; border-radius: 99px; background: var(--md-surface); box-shadow: var(--md-shadow); }
@media (max-width: 720px) {
  .document-viewport { padding: 16px; }
  .floating-text-input { max-width: calc(100vw - 32px); }
  .floating-text-input input { min-width: 130px; }
  .export-format { max-width: 122px; }
  :deep(.workspace-actions > .text-button) { white-space: nowrap; flex-shrink: 0; padding-inline: 8px; font-size: 12px; }
}
</style>
