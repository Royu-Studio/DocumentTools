import { createApp, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import FormatterView from '../src/views/FormatterView.vue'

// Run against the real Vue view/native XML parser in a browser with Vite running:
// await (await import('/tests/formatterInspector.browser.js')).testFormatterInspector()
// Uses an isolated mount and restores the original clipboard descriptor afterward.
export async function testFormatterInspector() {
  const host = document.createElement('div')
  document.body.append(host)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  const app = createApp(FormatterView, { kind: 'json' }).use(router)
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let copied = '', rejectCopy = false, count = 0
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { if (rejectCopy) throw new Error('denied'); copied = text } } })
  const assert = (value, label) => { if (!value) throw new Error(label); count++ }
  const tick = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
  const button = text => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  const click = async text => { const node = button(text); assert(!!node, `Missing button ${text}`); node.click(); await tick() }
  const enter = async value => { const input = host.querySelector('.source-editor textarea'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await tick() }
  const row = label => [...host.querySelectorAll('[role="treeitem"]')].find(node => node.querySelector('.inspector-label')?.textContent === label)
  try {
    await router.push('/'); await router.isReady(); app.mount(host); await tick()
    await enter('{"id":90071992547409931234,"items":[{"name":"中文"},null],"empty":"","html":"<img src=x onerror=alert(1)>"}')
    await click('格式化')
    assert(!!host.querySelector('[role="tree"]'), 'tree exists after format')
    assert(row('id')?.textContent.includes('90071992547409931234'), 'large integer exact in preview')
    row('id').click(); await tick(); await click('复制值'); assert(copied === '90071992547409931234', 'large integer copy exact')
    await click('复制路径'); assert(copied.includes('id'), 'path copy')
    await click('全部展开'); assert(host.querySelectorAll('[role="treeitem"]').length > 6, 'expand descendants')
    assert(host.querySelectorAll('img').length === 0, 'values remain escaped text')
    await click('全部折叠'); assert(host.querySelectorAll('[role="treeitem"]').length === 1, 'collapse all')
    const root = host.querySelector('[role="treeitem"]'); root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await tick()
    assert(host.querySelectorAll('[role="treeitem"]').length > 1, 'keyboard expand')
    row('empty').click(); await tick(); rejectCopy = true; await click('复制值')
    assert(host.querySelector('.inspector-fallback')?.value === '', 'empty copy failure exposes manual fallback')
    assert(host.querySelector('.inspector-status').textContent.includes('无法访问剪贴板'), 'honest failure status')
    rejectCopy = false
    await enter('{invalid'); assert(!host.querySelector('[role="tree"]'), 'edits immediately remove stale tree')
    await click('格式化'); assert(!!host.querySelector('[role="alert"]'), 'invalid input error')
    assert(button('复制').disabled, 'invalid input blocks whole copy')
    await enter('[1,2]'); await click('格式化'); assert(!!host.querySelector('[role="tree"]'), 'valid format recovers')
    await click('文本'); assert(!host.querySelector('.result-editor textarea').hidden, 'text mode remains available')
    await click('树视图'); await click('清空'); assert(!host.querySelector('[role="tree"]'), 'clear resets tree')
    await enter('['.repeat(257) + '0' + ']'.repeat(257)); await click('格式化'); assert(!!host.querySelector('[role="alert"]'), 'deep input rejected')
    await enter('[' + Array.from({ length: 1000 }, (_, i) => i).join(',') + ']'); await click('格式化')
    assert(host.querySelectorAll('[role="treeitem"]').length <= 300, 'DOM rendering bounded')
    await click('下一页'); assert(host.querySelectorAll('[role="treeitem"]').length <= 300, 'pagination bounded')
    return `${count} formatter inspector browser assertions passed`
  } finally {
    app.unmount(); host.remove()
    if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard
  }
}

export async function testXmlInspector() {
  const host = document.createElement('div'); document.body.append(host)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  const app = createApp(FormatterView, { kind: 'xml' }).use(router)
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let copied = '', count = 0
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { copied = text } } })
  const assert = (value, label) => { if (!value) throw new Error(label); count++ }
  const tick = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
  const click = async text => { const node = [...host.querySelectorAll('button')].find(node => node.textContent.trim() === text); assert(!!node, `Missing ${text}`); node.click(); await tick() }
  const enter = async value => { const input = host.querySelector('.source-editor textarea'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await tick() }
  const findRow = label => [...host.querySelectorAll('[role="treeitem"]')].filter(node => node.querySelector('.inspector-label')?.textContent === label)
  try {
    await router.push('/'); await router.isReady(); app.mount(host); await tick()
    await enter('<?xml version="1.0"?><r xmlns:p="urn:test" xml:space="preserve"><p:item id="1">Hello <b>world</b> !</p:item><p:item id="2"><![CDATA[a<b]]></p:item><!--keep--></r>')
    await click('格式化'); await click('全部展开')
    assert(findRow('p:item').length === 2, 'repeated XML siblings retained')
    const attr = findRow('@id')[1]; attr.click(); await tick(); await click('复制值'); assert(copied === '2', 'attribute copy')
    await click('复制路径'); assert(copied === '/r[1]/p:item[2]/@id', 'attribute path distinguishes siblings')
    findRow('#cdata')[0].click(); await tick(); await click('复制值'); assert(copied === 'a<b', 'CDATA decoded value')
    await click('复制子树'); assert(copied === '<![CDATA[a<b]]>', 'CDATA raw copy')
    findRow('p:item')[0].click(); await tick(); await click('复制值')
    assert(copied.includes('xmlns:p="urn:test"') && copied.includes('Hello <b>world</b> !'), 'namespace usable copy with mixed text')
    await click('文本'); await click('树视图'); assert(findRow('p:item').length === 2, 'view switching retains expanded nodes')
    assert(host.querySelector('[aria-selected="true"] .inspector-label').textContent === 'p:item', 'view switching retains selection')
    await enter('<r><broken></r>'); await click('格式化'); assert(!host.querySelector('[role="tree"]') && !!host.querySelector('[role="alert"]'), 'invalid XML removes tree')
    await enter('<!DOCTYPE r SYSTEM "https://example.invalid/no-fetch"><r/>'); await click('格式化')
    assert(host.querySelector('[role="alert"]')?.textContent.includes('外部'), 'external DTD rejected before parse')
    await enter('<!DOCTYPE r [<!ENTITY a "literal">]><r>&a;</r>'); await click('格式化')
    assert(host.querySelector('.formatter-error')?.textContent.includes('树视图不可用'), 'custom entities have explicit tree fallback')
    assert(!host.querySelector('.result-editor header button').disabled, 'safe literal entity text still copyable')
    await click('清空'); assert(!host.querySelector('[role="tree"]'), 'XML clear resets tree')
    return `${count} XML inspector browser assertions passed`
  } finally {
    app.unmount(); host.remove()
    if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard
  }
}
