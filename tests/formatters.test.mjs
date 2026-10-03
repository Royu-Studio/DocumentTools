import test from 'node:test'
import assert from 'node:assert/strict'
import { formatJson, xmlTokens } from '../src/utils/formatters.js'

test('JSON formatting preserves numeric spelling, duplicate keys and string escapes', () => {
  const source = '{"id":90071992547409931234,"n":1e+99,"n":-0,"s":"a  b\\n\\\"[]{}","empty":[]}'
  const formatted = formatJson(source, 4)
  assert.match(formatted, /    "id": 90071992547409931234/)
  assert.equal(formatJson(formatted, 2, true), source)
})
test('JSON rejects invalid syntax, blank text and oversized content', () => {
  for (const source of ['{"a":}', '[1,]', ' ', '0'.repeat(2097153)]) assert.throws(() => formatJson(source))
  for (const source of ['null', 'true', '" a "', '[]', '{}']) assert.equal(formatJson(source), source)
})
test('XML scanner keeps quoted brackets, DTD, CDATA and comments intact', () => {
  const source = '<!DOCTYPE r [<!ENTITY a "x>y">]><r attr="a>b"><![CDATA[a<b]]><!-- > --><x/>text</r>'
  assert.deepEqual(xmlTokens(source), ['<!DOCTYPE r [<!ENTITY a "x>y">]>', '<r attr="a>b">', '<![CDATA[a<b]]>', '<!-- > -->', '<x/>', 'text', '</r>'])
})
