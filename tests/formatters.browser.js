import { formatXml } from '../src/utils/formatters.js'

// Run in a browser against its native DOMParser (Chrome and Firefox use
// different parsererror namespaces). This module needs no test dependency.
export function testXmlFormatter() {
  const cases = [
    ['<r><a x="a>b">中文</a><b/></r>', '<r>\n  <a x="a>b">中文</a>\n  <b/>\n</r>'],
    ['<r>Hello <b>world</b> !</r>', '<r>Hello <b>world</b> !</r>'],
    ['<r xml:space="preserve">  <b/> \n </r>', '<r xml:space="preserve">  <b/> \n </r>'],
    ['<r><![CDATA[a<b]]><b/></r>', '<r><![CDATA[a<b]]><b/></r>'],
    ['<r><space>   </space></r>', '<r>\n  <space>   </space>\n</r>'],
    ['<!DOCTYPE r [<!ENTITY a "x>y">]><r>&a;</r>', '<!DOCTYPE r [<!ENTITY a "x>y">]>\n<r>&a;</r>'],
    ['<r xmlns:x="urn:test"><!-- keep --><x:a/></r>', '<r xmlns:x="urn:test">\n  <!-- keep -->\n  <x:a/>\n</r>'],
    ['<parsererror>ordinary element</parsererror>', '<parsererror>ordinary element</parsererror>'],
  ]
  for (const [input, expected] of cases) {
    if (formatXml(input) !== expected) throw new Error(`Unexpected format: ${input}`)
    const compact = formatXml(expected, 2, true)
    if (formatXml(compact) !== expected) throw new Error(`Round trip changed data: ${input}`)
  }
  for (const input of ['<a><b></a>', '<a x="1" x="2"/>', '<a>&undefined;</a>', '<a/><b/>']) {
    let failed = false
    try { formatXml(input) } catch { failed = true }
    if (!failed) throw new Error(`Accepted invalid XML: ${input}`)
  }
  return `${cases.length} XML round trips and 4 invalid documents passed`
}
