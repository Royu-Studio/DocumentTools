import { createRequire } from 'node:module'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
// Install jsdom separately or pass its module path through JSDOM_MODULE.
// No browser engines are loaded: this runner tests deferred-job lifecycle behavior.
const require = createRequire(root + '/package.json')
const { JSDOM } = await import(process.env.JSDOM_MODULE || 'jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'SVGElement', 'Event', 'KeyboardEvent', 'DOMParser', 'localStorage', 'history', 'location', 'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[key] = typeof dom.window[key] === 'function' && key.includes('AnimationFrame') ? dom.window[key].bind(dom.window) : dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
window.HTMLDialogElement.prototype.showModal = function () { this.open = true }; window.HTMLDialogElement.prototype.close = function () { this.open = false }
window.matchMedia = () => ({ matches: false, addEventListener() {} })
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.Image = class { naturalWidth = 240; naturalHeight = 160; set src(value) { this.source = value; if (value) queueMicrotask(() => this.onload?.()) } get src() { return this.source } }
globalThis.createImageBitmap = async () => ({ width: 240, height: 160, close() {} })
const context = { fillRect() {}, putImageData() {}, clearRect() {}, drawImage() {}, save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, fillText() {}, measureText() { return { width: 80 } }, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, stroke() {}, getImageData() { return { data: new Uint8ClampedArray(240 * 160 * 4) } } }
window.HTMLCanvasElement.prototype.getContext = () => ({ ...context })
window.HTMLCanvasElement.prototype.toBlob = function (callback) { queueMicrotask(() => callback(new Blob(['image'], { type: 'image/png' }))) }
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA=='
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
let pendingWorker; let pdfLoads = 0; let pdfTask
const engine = { setWorkerPromise(value) { pendingWorker = value }, pdfLoads() { return pdfLoads }, setPdfTask(value) { pdfTask = value }, createWorker() { return pendingWorker }, getDocument() { pdfLoads++; if (!pdfTask) throw new Error('unexpected PDF load'); return pdfTask } }
globalThis.__lifecycleEngine = engine
const temporary = await mkdtemp(join(root, 'node_modules', '.workspace-lifecycle-'))
const output = join(temporary, 'runner.mjs')
try {
await build({
  entryPoints: [root + '/tests/workspaceLifecycle.browser.js'], outfile: output,
  bundle: true, platform: 'node', format: 'esm', external: ['vue', 'vue-router', 'pinia', '@pdfme/*'], loader: { '.css': 'empty' }, alias: { '@': root + '/src' },
  plugins: [{ name: 'vue-test', setup(builder) {
    builder.onResolve({ filter: /^(tesseract\.js|pdfjs-dist\/.*\.mjs)$/ }, ({path}) => ({ path, namespace: 'engine' }))
    builder.onLoad({ filter: /.*/, namespace: 'engine' }, ({path}) => ({ contents: path === 'tesseract.js' ? 'export const createWorker = (...args) => globalThis.__lifecycleEngine.createWorker(...args)' : 'export const GlobalWorkerOptions = {}; export const getDocument = (...args) => globalThis.__lifecycleEngine.getDocument(...args)', loader: 'js' }))
    builder.onResolve({ filter: /\?(url|worker)$/ }, ({path}) => ({ path, namespace: 'test-url' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-url' }, ({path}) => ({ contents: path.endsWith('?worker') ? 'export default class MockWorker {}' : 'export default "/mock-worker.js"', loader: 'js' }))
    builder.onLoad({ filter: /\.vue$/ }, async ({path}) => {
      const source = await readFile(path, 'utf8'); const {descriptor} = parse(source, {filename: path})
      return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'js', resolveDir: path.slice(0, path.lastIndexOf('/')) }
    })
  } }],
})
const { testWorkspaceLifecycle } = await import(output)
console.log(await testWorkspaceLifecycle(engine))

} finally {
  dom.window.close()
  await rm(temporary, { recursive: true, force: true })
}
