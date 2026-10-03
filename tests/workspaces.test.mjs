import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive, effect } from 'vue'
import { createWorkspaceModel, MAX_WORKSPACES } from '../src/workspaces/model.js'
const tool = { id: 'json', name: 'JSON' }
const model = () => { let id = 0; return reactive(createWorkspaceModel(() => `w${++id}`)) }
test('same tools have distinct stable identities; bounded count without eviction', () => {
  const state = model()
  for (let n = 0; n < MAX_WORKSPACES; n++) state.open(tool)
  assert.equal(new Set(state.tabs.map(tab => tab.id)).size, MAX_WORKSPACES)
  assert.equal(state.open(tool), null)
  assert.equal(state.tabs[0].id, 'w1')
})
test('rename, close and add remain reactive with no recycled identities', () => {
  const state = model(); let snapshot
  effect(() => { snapshot = state.tabs.map(tab => tab.name).join(',') })
  const first = state.open(tool), second = state.open(tool)
  assert.equal(snapshot, 'JSON 1,JSON 2')
  assert.equal(state.rename(first.id, '  dataset A  '), true)
  assert.equal(snapshot, 'dataset A,JSON 2')
  assert.equal(state.rename(first.id, ' '), false)
  assert.equal(state.close(first.id).id, second.id)
  assert.equal(snapshot, 'JSON 2')
  assert.equal(state.close(first.id), null)
  assert.equal(state.close(second.id), null)
  assert.equal(state.tabs.length, 0)
  assert.equal(state.closed.has(first.id), true)
  assert.notEqual(state.open(tool).id, first.id)
})
test('workspace metadata is independent and name is bounded', () => {
  const state = model(); const a = state.open(tool, 'ocr'); const b = state.open(tool)
  state.rename(a.id, 'a'.repeat(200))
  assert.equal(state.tabs[0].name.length, 60)
  assert.equal(b.initialMode, 'edit')
  assert.equal(a.initialMode, 'ocr')
})
