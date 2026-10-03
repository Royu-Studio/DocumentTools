import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from '../src/App.vue'
import { createToolRoutes, configureToolRouter } from '../src/router/routes.js'

export async function testWorkspaces() {
  const host = document.createElement('div'); document.body.append(host)
  const router = configureToolRouter(createRouter({ history: createMemoryHistory(), routes: createToolRoutes() }))
  const app = createApp(App).use(router).use(createPinia())
  const oldConfirm = window.confirm
  let allowClose = false, confirmations = 0, assertions = 0
  window.confirm = () => { confirmations++; return allowClose }
  const assert = (value, label) => { if (!value) throw new Error(label); assertions++ }
  const tick = async () => { for (let n = 0; n < 8; n++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() } }
  const tabs = () => [...host.querySelectorAll('[role=tab]')]
  const panel = () => [...host.querySelectorAll('[role=tabpanel]')].find(node => node.style.display !== 'none')
  const clickText = async (scope, text) => { const node = [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text); assert(node, `missing button ${text}`); node.click(); await tick() }
  const enter = async text => { const node = panel().querySelector('.source-editor textarea'); node.value = text; node.dispatchEvent(new Event('input', { bubbles: true })); await tick() }
  const add = async kind => { host.querySelector('.workspace-add').click(); await tick(); await clickText(host.querySelector('.workspace-chooser'), kind) }
  try {
    await router.push('/json'); await router.isReady(); app.mount(host); await tick()
    assert(tabs().length === 1 && !!router.currentRoute.value.query.workspace, 'deep link opens canonical workspace')
    const firstId = router.currentRoute.value.query.workspace
    await enter('{"a":{"deep":90071992547409931234}}'); await clickText(panel(), '格式化'); await clickText(panel(), '全部展开')
    const deep = [...panel().querySelectorAll('[role=treeitem]')].find(node => node.querySelector('.inspector-label')?.textContent === 'deep'); deep.click(); await tick()
    await add('JSON 格式化')
    assert(tabs().length === 2, 'same tool opens independent workspace')
    assert(panel().querySelector('.source-editor textarea').value === '', 'second starts empty')
    const secondId = router.currentRoute.value.query.workspace
    await enter('{"b":2}'); await clickText(panel(), '格式化')
    tabs()[0].click(); await tick()
    assert(panel().querySelector('.source-editor textarea').value.includes('deep'), 'first dataset preserved')
    assert(panel().querySelector('[aria-selected=true] .inspector-label')?.textContent === 'deep', 'tree selection preserved')
    assert(panel().querySelectorAll('[role=treeitem]').length === 3, 'expanded tree preserved')
    assert(new Set([...host.querySelectorAll('[id]')].map(node => node.id)).size === host.querySelectorAll('[id]').length, 'no duplicate label or panel IDs')
    router.back(); await tick(); assert(router.currentRoute.value.query.workspace === secondId, 'Back selects existing second dataset')
    router.forward(); await tick(); assert(router.currentRoute.value.query.workspace === firstId, 'Forward selects first dataset')
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); await tick()
    const rename = host.querySelector('.workspace-rename input'); rename.value = 'Dataset A'; rename.dispatchEvent(new Event('input', { bubbles: true })); await clickText(host.querySelector('.workspace-rename'), '保存')
    assert(tabs()[0].textContent.includes('Dataset A'), 'rename applied')
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); await tick(); await clickText(host.querySelector('.workspace-rename'), '取消')
    assert(tabs()[0].textContent.includes('Dataset A'), 'rename cancel retains name')
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await tick()
    assert(router.currentRoute.value.query.workspace === secondId, 'keyboard selects adjacent workspace')
    host.querySelectorAll('.workspace-tab-action')[3].click(); await tick()
    assert(tabs().length === 2 && confirmations === 1, 'close cancel retains content')
    allowClose = true
    host.querySelectorAll('.workspace-tab-action')[3].click(); await tick()
    assert(tabs().length === 1 && panel().querySelector('.source-editor textarea').value.includes('deep'), 'close active selects surviving dataset')
    await router.push(`/json?workspace=${secondId}`); await tick()
    assert(router.currentRoute.value.path === '/' && tabs().length === 1, 'closed history cannot resurrect tab')
    tabs()[0].click(); await tick(); host.querySelectorAll('.workspace-tab-action')[1].click(); await tick()
    assert(tabs().length === 0 && router.currentRoute.value.path === '/', 'last close returns toolbox')
    assert(document.activeElement?.classList.contains('tool-card'), 'last close restores keyboard focus to toolbox')
    host.querySelector('a[href="/xml"]').click(); await tick()
    assert(tabs().length === 1, 'toolbox opens after last close')
    const count = confirmations; host.querySelectorAll('.workspace-tab-action')[1].click(); await tick()
    assert(tabs().length === 0 && confirmations === count, 'empty formatter closes without warning')
    host.querySelector('a[href="/pdf"]').click(); await tick(); await add('PDF / 图片')
    assert(host.querySelectorAll('.studio-shell').length === 2, 'document studios are separate mounted instances')
    assert(panel().querySelector('.studio-welcome'), 'new document workspace is empty')
    await add('XML 格式化'); await enter('<r><item>first</item></r>'); await clickText(panel(), '格式化')
    await add('XML 格式化'); await enter('<r><item>second</item></r>'); await clickText(panel(), '格式化')
    tabs()[2].click(); await tick(); assert(panel().querySelector('.source-editor textarea').value.includes('first'), 'XML datasets independent')
    await router.push('/'); await tick(); tabs()[2].click(); await tick(); assert(panel().querySelector('.source-editor textarea').value.includes('first'), 'home retains content')
    await router.push('/image_tool'); await tick(); assert(router.currentRoute.value.path === '/pdf', 'legacy image route remains valid')
    await router.push('/ocr'); await tick(); assert(router.currentRoute.value.query.tool === 'ocr' && panel().querySelector('.studio-rail button.selected').textContent.includes('文字识别'), 'legacy OCR route activates OCR workspace')
    await router.push('/missing-tool'); await tick(); assert(router.currentRoute.value.path === '/', 'unknown route returns toolbox')
    await router.push('/?tool=ocr'); await tick(); assert(router.currentRoute.value.path === '/pdf' && router.currentRoute.value.query.tool === 'ocr', 'legacy home OCR query remains valid')
    tabs()[2].click(); await tick()
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload)
    assert(unload.defaultPrevented, 'unsaved content warns before refresh')
    await add('JSON 格式化')
    const importingId = router.currentRoute.value.query.workspace
    let resolveRead
    const fileInput = panel().querySelector('input[type=file]')
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ name: 'late.json', size: 20, text: () => new Promise(resolve => { resolveRead = resolve }) }] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true })); await tick()
    assert(panel().querySelector('.source-editor textarea').disabled, 'pending import belongs to its own workspace')
    const activeIndex = tabs().findIndex(tab => tab.getAttribute('aria-selected') === 'true')
    host.querySelectorAll('.workspace-tab-action')[activeIndex * 2 + 1].click(); await tick()
    tabs()[2].click(); await tick()
    resolveRead('{"late":true}'); await tick()
    assert(!host.querySelector(`#workspace-panel-${importingId}`), 'closing import unmounts its own instance')
    assert(!panel().querySelector('.source-editor textarea').value.includes('late'), 'late import cannot overwrite survivor')
    host.querySelector('.workspace-add').click(); await tick()
    const newJson = [...host.querySelector('.workspace-chooser').querySelectorAll('button')].find(node => node.textContent.trim() === 'JSON 格式化')
    const beforeRepeated = tabs().length; newJson.click(); newJson.click(); await tick()
    assert(tabs().length === beforeRepeated + 1, 'repeated new clicks are coalesced during navigation')
    while (tabs().length < 12) await add('JSON 格式化')
    await add('JSON 格式化'); assert(tabs().length === 12 && host.querySelector('.workspace-notice').textContent.includes('最多'), 'cap prevents eviction')
    return `${assertions} real App workspace assertions passed`
  } finally { app.unmount(); host.remove(); window.confirm = oldConfirm }
}
