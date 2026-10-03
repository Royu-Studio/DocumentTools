import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJsonTree, buildXmlTree, getNodeCopy, getNodePath, MAX_TREE_DEPTH, MAX_TREE_NODES } from '../src/utils/formatterTree.js'

test('JSON tree preserves numeric spelling, duplicate decoded keys, escapes and subtree whitespace', () => {
  const source = ' \n{"id":90071992547409931234, "n":1e+099,"n":-0,"\\u006e":0.1000,"s":"a\\n\\u0062\\/", "nested": [ 1, {"x":false} ]}\t'
  const tree = buildJsonTree(source)
  const [id, first, second, third, string, nested] = tree.root.children
  assert.equal(tree.format, 'json')
  assert.equal(tree.nodeCount, 10)
  assert.equal(getNodeCopy(tree, tree.root, 'raw'), source)
  assert.equal(getNodeCopy(tree, id), '90071992547409931234')
  assert.equal(first.value, '1e+099')
  assert.equal(second.value, '-0')
  assert.equal(third.value, '0.1000')
  assert.equal(string.value, 'a\nb/')
  assert.equal(string.raw, '"a\\n\\u0062\\/"')
  assert.deepEqual([first.path, second.path, third.path], ['$["n"]#1', '$["n"]#2', '$["n"]#3'])
  assert.equal(nested.value, '[ 1, {"x":false} ]')
  assert.equal(nested.children[1].children[0].value, 'false')
  assert.equal(getNodePath(tree, nested.children[1].children[0]), '$["nested"][1]["x"]')
  assert.equal(getNodeCopy(tree, third, 'path'), third.path)
})

test('JSON primitive roots and empty containers have useful types, paths and copy values', () => {
  for (const [source, type, value] of [['  true ', 'boolean', 'true'], ['null', 'null', 'null'], ['"hi"', 'string', 'hi'], ['-0', 'number', '-0'], ['{}', 'object', '{}'], ['[]', 'array', '[]']]) {
    const tree = buildJsonTree(source)
    assert.equal(tree.root.type, type)
    assert.equal(tree.root.path, '$')
    assert.equal(tree.root.value, value)
    assert.equal(tree.root.raw, source)
  }
})

test('JSON object keys cannot corrupt metadata and copied paths escape special characters', () => {
  const tree = buildJsonTree('{"__proto__":1,"constructor":2,"toString":3,"a\\\"[\\n":4,"":5}')
  assert.deepEqual(tree.root.children.map(node => node.value), ['1', '2', '3', '4', '5'])
  assert.equal(tree.root.children[3].path, '$["a\\\"[\\n"]')
  assert.equal(tree.root.children[4].path, '$[""]')
})

test('JSON syntax validation rejects malformed numbers, strings, separators and trailing input', () => {
  const invalid = [' ', 'undefined', 'NaN', 'Infinity', '01', '+1', '.1', '1.', '1e', '[1,]', '[,1]', '[1 2]', '{"a":}', '{"a":1,}', '{a:1}', '{"a" 1}', '{"a":1 "b":2}', 'true false', '"bad\\q"', '"line\nbreak"', '"end\\', '\ufeff{}', 'true\u00a0']
  for (const source of invalid) assert.throws(() => buildJsonTree(source), undefined, source)
})

test('JSON enforces source, nesting and node limits before expensive rendering', () => {
  assert.throws(() => buildJsonTree(' '.repeat(2097152) + '0'), /2 MB/)
  assert.equal(buildJsonTree('['.repeat(MAX_TREE_DEPTH) + '0' + ']'.repeat(MAX_TREE_DEPTH)).nodeCount, MAX_TREE_DEPTH + 1)
  assert.throws(() => buildJsonTree('['.repeat(MAX_TREE_DEPTH + 1) + '0' + ']'.repeat(MAX_TREE_DEPTH + 1)), /256/)
  assert.equal(buildJsonTree('[' + '0,'.repeat(MAX_TREE_NODES - 2) + '0]').nodeCount, MAX_TREE_NODES)
  assert.throws(() => buildJsonTree('[' + '0,'.repeat(MAX_TREE_NODES - 1) + '0]'), /100,000/)
})

test('Paths, raw subtrees and parent links remain non-enumerable and lazy', () => {
  const tree = buildJsonTree('{"nested":[{"n":100000000000000000001}]}')
  assert.equal(Object.getOwnPropertyDescriptor(tree.root, 'raw').enumerable, false)
  assert.equal(Object.getOwnPropertyDescriptor(tree.root, 'path').enumerable, false)
  assert.equal(Object.getOwnPropertyDescriptor(tree.root, 'parent').enumerable, false)
  assert.doesNotThrow(() => JSON.stringify(tree))
  assert.throws(() => getNodeCopy(tree, tree.root, 'unknown'), /复制模式/)
})

test('XML rejects unsafe DTD entities and resource limits before invoking DOMParser', () => {
  for (const source of ['<!DOCTYPE r [<!ENTITY a "x">]><r>&a;</r>', '<!DOCTYPE r [<!ENTITY a SYSTEM "https://example.com/x">]><r/>', '<!DOCTYPE r [%remote;]><r/>']) {
    assert.throws(() => buildXmlTree(source), /实体/)
  }
  assert.throws(() => buildXmlTree('<r>'.repeat(MAX_TREE_DEPTH + 1) + '</r>'.repeat(MAX_TREE_DEPTH + 1)), /256/)
  assert.throws(() => buildXmlTree('<r>' + '<x/>'.repeat(MAX_TREE_NODES) + '</r>'), /100,000/)
  assert.throws(() => buildXmlTree('<r/>'), /DOMParser/)
})
