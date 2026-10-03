import { createApp, h, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import DocumentEditor from '../src/views/DocumentEditor.vue'
import OCRTool from '../src/views/OCRTool.vue'
import FileDropZone from '../src/components/FileDropZone.vue'
import WorkspaceLayout from '../src/components/WorkspaceLayout.vue'
import { useCanvasResize } from '../src/composables/useCanvasResize.js'

// Run with Vite in a browser: testWorkspaceLifecycle(). The optional engine
// harness additionally checks worker/PDF races using deferred test doubles.
export async function testWorkspaceLifecycle(engine) {
  let assertions = 0
  const cleanups = []
  const assert = (value, label) => { if (!value) throw new Error(label); assertions++ }
  const tick = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
  const settle = async () => { for (let n = 0; n < 6; n++) { await tick(); await new Promise(resolve => setTimeout(resolve, 0)) } }
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  const mount = async render => {
    const host = document.createElement('div'); document.body.append(host)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    const app = createApp({ render }).use(createPinia()).use(router)
    await router.push('/'); await router.isReady(); app.mount(host); await tick()
    let mounted = true
    const close = () => { if (mounted) { mounted = false; app.unmount(); host.remove() } }
    cleanups.push(close)
    return { host, close }
  }
  const button = (scope, text) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  const oldImage = globalThis.Image
  const oldBitmap = globalThis.createImageBitmap
  const oldResize = globalThis.ResizeObserver
  const oldCreateUrl = URL.createObjectURL
  const oldRevokeUrl = URL.revokeObjectURL
  const created = [], revoked = []
  URL.createObjectURL = blob => { const url = oldCreateUrl.call(URL, blob); created.push(url); return url }
  URL.revokeObjectURL = url => { revoked.push(url); oldRevokeUrl.call(URL, url) }
  const fixture = document.createElement('canvas'); fixture.width = 240; fixture.height = 160
  fixture.getContext('2d').fillRect(0, 0, 240, 160)
  const png = await new Promise(resolve => fixture.toBlob(resolve, 'image/png'))
  const imageFile = name => new File([png], name, { type: 'image/png' })
  try {
    const dropActive = ref(false); let accepted = 0
    const drop = await mount(() => h(FileDropZone, { active: dropActive.value, onFile: () => accepted++ }))
    drop.host.firstElementChild.getClientRects = () => [{ width: 100, height: 100 }]
    const paste = () => { const event = new Event('paste'); Object.defineProperty(event, 'clipboardData', { value: { files: [imageFile('paste.png')] } }); window.dispatchEvent(event) }
    paste(); assert(accepted === 0, 'inactive drop zone ignores global paste even with a visible rectangle')
    dropActive.value = true; await tick(); paste(); assert(accepted === 1, 'active drop zone handles one paste')
    drop.close(); paste(); assert(accepted === 1, 'drop zone removes global listener on close')

    const layoutActive = ref(true)
    const layout = await mount(() => h(WorkspaceLayout, { title: 'Test', active: layoutActive.value, hasFile: true }))
    button(layout.host, '属性').click(); await tick()
    assert(layout.host.querySelector('dialog')?.open, 'mobile property sheet opens')
    layoutActive.value = false; await tick()
    assert(!layout.host.querySelector('dialog'), 'inactive workspace removes open modal from top layer')
    layoutActive.value = true; await tick(); button(layout.host, '属性').click(); layoutActive.value = false; await tick()
    assert(!layout.host.querySelector('dialog'), 'deactivation during nextTick cannot reopen a modal')
    layout.close()

    const resizeCallbacks = []; globalThis.ResizeObserver = class { constructor(callback) { resizeCallbacks.push(callback) } observe() {} disconnect() {} }
    const resizeActive = ref(true); const viewport = ref(null); let fits = 0; let width = 800
    const resizeApp = await mount(() => h({ setup() { useCanvasResize(viewport, () => fits++, () => resizeActive.value); return () => h('div', { ref: viewport }) } }))
    Object.defineProperties(viewport.value, { clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, get: () => width ? 600 : 0 } })
    const frame = async () => { await tick(); await new Promise(resolve => requestAnimationFrame(resolve)); await tick() }
    resizeCallbacks.at(-1)(); await frame(); assert(fits === 1, 'initial visible size fits once')
    resizeActive.value = false; width = 0; resizeCallbacks.at(-1)(); await frame()
    resizeActive.value = true; width = 800; resizeCallbacks.at(-1)(); await frame()
    assert(fits === 1, 'hide and show at the same size preserve zoom')
    width = 900; resizeCallbacks.at(-1)(); await frame(); assert(fits === 2, 'real viewport resize still fits')
    resizeApp.close(); globalThis.ResizeObserver = oldResize

    const aActive = ref(true), bActive = ref(false), a = ref(null), b = ref(null)
    const editors = await mount(() => h('div', [h(DocumentEditor, { ref: a, embedded: true, active: aActive.value }), h(DocumentEditor, { ref: b, embedded: true, active: bActive.value })]))
    await Promise.all([a.value.load(imageFile('alpha.png')), b.value.load(imageFile('beta.png'))]); await tick()
    const [first, second] = editors.host.querySelectorAll('.workspace-page')
    assert(first.querySelector('h1').textContent === 'alpha.png' && second.querySelector('h1').textContent === 'beta.png', 'editors keep different source files')
    const addText = async (scope, text) => {
      button(scope, '文字').click(); await tick()
      const canvas = scope.querySelector('canvas'); canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 160 })
      const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
      Object.assign(pointer, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 }); canvas.dispatchEvent(pointer); await tick()
      const input = scope.querySelector('.floating-text-input input'); assert(input, 'text tool is interactive')
      input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); button(scope, '添加').click(); await tick()
    }
    await addText(first, 'ALPHA'); aActive.value = false; bActive.value = true; await tick(); await addText(second, 'BETA')
    const layers = scope => [...scope.querySelectorAll('.layer-item strong')].map(node => node.textContent)
    assert(layers(first).includes('ALPHA') && !layers(first).includes('BETA'), 'annotation lists are isolated')
    const beforeA = a.value.revision()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })); await tick()
    assert(a.value.revision() === beforeA && layers(first).includes('ALPHA'), 'inactive editor ignores undo shortcut')
    assert(!layers(second).includes('BETA'), 'active editor alone handles undo')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true })); await tick()
    assert(layers(second).includes('BETA'), 'active editor redo retains its own history')
    second.querySelector('[aria-label="放大"]').click(); await tick(); const savedZoom = second.querySelector('.zoom-select').textContent
    aActive.value = true; bActive.value = false; await tick(); aActive.value = false; bActive.value = true; await tick()
    assert(second.querySelector('.zoom-select').textContent === savedZoom, 'editor zoom survives activation changes')
    const secondCanvas = second.querySelector('canvas'); const encode = deferred(); const originalToBlob = secondCanvas.toBlob
    secondCanvas.toBlob = callback => { encode.promise.then(() => callback(png)) }
    const snapshot = b.value.snapshot().then(() => null, error => error)
    button(second, '导出文件').click(); await tick()
    const sourceUrls = [...created]; editors.close(); encode.resolve(); const snapshotError = await snapshot
    await settle()
    secondCanvas.toBlob = originalToBlob
    assert(snapshotError?.name === 'AbortError', 'closing during snapshot rejects stale image encoding')
    assert(sourceUrls.every(url => revoked.includes(url)), 'closing editors revokes all source URLs')
    assert(created.length === sourceUrls.length, 'late export does not recreate a download URL')

    const pendingImages = []
    globalThis.Image = class { constructor() { pendingImages.push(this) } set src(value) { this.source = value } get src() { return this.source } }
    const pendingEditor = ref(null)
    const pending = await mount(() => h(DocumentEditor, { ref: pendingEditor, embedded: true }))
    const load = pendingEditor.value.load(imageFile('pending.png')).then(() => null, error => error)
    await tick(); const pendingUrl = created.at(-1); pending.close(); const loadError = await load
    assert(loadError?.name === 'AbortError', 'closing during image decode cancels load')
    assert(revoked.includes(pendingUrl) && pendingImages.at(-1).src === '' && !pendingImages.at(-1).onload, 'pending decode handlers and source URL are released')
    globalThis.Image = oldImage

    const bitmapReady = deferred(); let bitmapClosed = 0
    globalThis.createImageBitmap = () => bitmapReady.promise
    const reader = ref(null)
    const ocr = await mount(() => h(OCRTool, { ref: reader, embedded: true }))
    const ocrLoad = reader.value.load(imageFile('late-bitmap.png')).then(() => null, error => error)
    ocr.close(); bitmapReady.resolve({ close: () => bitmapClosed++ }); const ocrError = await ocrLoad
    assert(ocrError?.name === 'AbortError' && bitmapClosed === 1, 'late OCR bitmap is closed without creating preview resources')
    globalThis.createImageBitmap = oldBitmap

    if (engine) {
      const workerReady = deferred(); const state = { terminated: 0, parameters: 0, recognized: 0 }
      engine.setWorkerPromise(workerReady.promise)
      const instance = ref(null); const job = await mount(() => h(OCRTool, { ref: instance, embedded: true }))
      await instance.value.load(imageFile('ocr.png')); await tick(); button(job.host, '整页识别').click(); await tick(); job.close()
      workerReady.resolve({ terminate: async () => { state.terminated++ }, setParameters: async () => { state.parameters++ }, recognize: async () => { state.recognized++; return { data: { text: 'late' } } } })
      await settle()
      assert(state.terminated === 1 && state.parameters === 0 && state.recognized === 0, 'late-created OCR worker terminates without starting recognition')
      const parametersReady = deferred(); let terminated = 0, recognized = 0
      engine.setWorkerPromise(Promise.resolve({ terminate: async () => { terminated++ }, setParameters: () => parametersReady.promise, recognize: async () => { recognized++; return { data: {} } } }))
      const configuring = ref(null); const configureJob = await mount(() => h(OCRTool, { ref: configuring, embedded: true }))
      await configuring.value.load(imageFile('configuring.png')); await tick(); button(configureJob.host, '整页识别').click(); await tick(); configureJob.close(); parametersReady.resolve(); await settle()
      assert(terminated === 1 && recognized === 0, 'close during OCR configuration terminates the worker exactly once')
      let recognizingCanvas, recognitionTerminations = 0
      engine.setWorkerPromise(Promise.resolve({ terminate: async () => { recognitionTerminations++ }, setParameters: async () => {}, recognize: canvas => { recognizingCanvas = canvas; return new Promise(() => {}) } }))
      const recognizingReader = ref(null); const recognitionJob = await mount(() => h(OCRTool, { ref: recognizingReader, embedded: true }))
      await recognizingReader.value.load(imageFile('recognizing.png')); await tick(); button(recognitionJob.host, '整页识别').click(); await settle()
      assert(recognizingCanvas?.width === 240, 'OCR recognition started with its own preview canvas')
      recognitionJob.close(); await settle()
      assert(recognitionTerminations === 1 && recognizingCanvas.width === 1 && recognizingCanvas.height === 1, 'close releases preprocessing buffers even when terminated OCR promises never settle')
      const pdfBuffer = deferred(); const pdfReader = ref(null)
      const pdfJob = await mount(() => h(OCRTool, { ref: pdfReader, embedded: true }))
      const before = engine.pdfLoads()
      const pdfLoad = pdfReader.value.load({ name: 'late.pdf', type: 'application/pdf', size: 20, arrayBuffer: () => pdfBuffer.promise }).then(() => null, error => error)
      pdfJob.close(); pdfBuffer.resolve(new ArrayBuffer(10)); const pdfError = await pdfLoad
      assert(pdfError?.name === 'AbortError' && engine.pdfLoads() === before, 'closed OCR does not create a PDF worker after a pending file read')
      if (engine.setPdfTask) {
        for (const Component of [OCRTool, DocumentEditor]) {
          const renderReady = deferred(); let cancelled = 0, destroyed = 0, rendered = 0
          const render = { promise: renderReady.promise, cancel() { cancelled++ } }
          const task = { promise: Promise.resolve({ numPages: 1, async getPage() { return { getViewport() { return { width: 240, height: 160 } }, render() { rendered++; return render } } } }), async destroy() { destroyed++ } }
          engine.setPdfTask(task)
          const pdfInstance = ref(null); const renderJob = await mount(() => h(Component, { ref: pdfInstance, embedded: true }))
          const renderLoad = pdfInstance.value.load({ name: 'rendering.pdf', type: 'application/pdf', size: 20, arrayBuffer: async () => new ArrayBuffer(10) }).then(() => null, error => error)
          await settle(); assert(rendered === 1, 'PDF preview render began')
          renderJob.close(); renderReady.resolve(); const renderError = await renderLoad; await settle()
          assert(renderError?.name === 'AbortError' && cancelled === 1 && destroyed === 1, 'close cancels pending PDF rendering and destroys the loading task once')
        }
      }
    }
    return `${assertions} workspace lifecycle assertions passed${engine ? ' (deferred PDF/OCR engines included)' : ''}`
  } finally {
    for (const close of cleanups.reverse()) close()
    globalThis.Image = oldImage; globalThis.createImageBitmap = oldBitmap; globalThis.ResizeObserver = oldResize
    URL.createObjectURL = oldCreateUrl; URL.revokeObjectURL = oldRevokeUrl
  }
}
