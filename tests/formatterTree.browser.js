import { buildJsonTree, buildXmlTree, getNodeCopy, getNodePath, MAX_TREE_DEPTH, MAX_TREE_NODES } from '../src/utils/formatterTree.js'

// Import this module from the Vite development server and call testFormatterTree().
// It intentionally uses the browser's own DOMParser, without a test dependency.
export function testFormatterTree() {
  let assertions = 0
  function equal(actual, expected, label) {
    assertions++
    if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  function rejects(source, pattern) {
    assertions++
    try { buildXmlTree(source) }
    catch (error) {
      if (pattern && !pattern.test(error.message)) throw error
      return
    }
    throw new Error(`Accepted invalid XML: ${source.slice(0, 100)}`)
  }
  const source = '<?xml version="1.0"?>\n<!DOCTYPE r>\n<r xmlns="urn:r" xmlns:p="urn:p" a = "a&gt;b &amp; &#x1F600;">Hello <p:item id=\'1\'/> between <p:item id="2">&lt;ok&gt;</p:item><![CDATA[a<b & keep]]><!-- keep > --><?work continue?>\n</r>\n'
  const tree = buildXmlTree(source)
  const root = tree.root.children.find(node => node.type === 'element')
  equal(tree.root.raw, source, 'Document raw retains complete input')
  equal(tree.root.path, '/', 'Document path')
  equal(root.path, '/r[1]', 'Root element path')
  equal(tree.root.children[0].type, 'declaration', 'XML declaration retained')
  equal(tree.root.children[2].type, 'doctype', 'DOCTYPE retained')
  const attribute = root.children.find(node => node.label === '@a')
  equal(attribute.value, 'a>b & 😀', 'Attribute references decoded once')
  equal(attribute.raw, 'a = "a&gt;b &amp; &#x1F600;"', 'Attribute spelling retained')
  equal(attribute.path, '/r[1]/@a', 'Attribute path')
  const items = root.children.filter(node => node.type === 'element')
  equal(items[0].path, '/r[1]/p:item[1]', 'First repeated element path')
  equal(items[1].path, '/r[1]/p:item[2]', 'Second repeated element path')
  equal(items[0].raw, '<p:item id=\'1\'/>', 'Nested raw copy is exact')
  equal(items[0].value, '<p:item xmlns="urn:r" xmlns:p="urn:p" id=\'1\'/>', 'Value copy includes inherited namespace bindings')
  equal(buildXmlTree(items[0].value).root.children[0].label, 'p:item', 'Value copy parses independently')
  equal(items[1].children.find(node => node.type === 'text').value, '<ok>', 'Text references decoded')
  equal(root.children.find(node => node.type === 'cdata').value, 'a<b & keep', 'CDATA value unchanged')
  equal(root.children.find(node => node.type === 'cdata').raw, '<![CDATA[a<b & keep]]>', 'CDATA delimiters retained')
  equal(root.children.find(node => node.type === 'comment').raw, '<!-- keep > -->', 'Comment retained')
  equal(root.children.find(node => node.type === 'processing-instruction').value, 'continue', 'PI data retained')
  equal(root.children.filter(node => node.type === 'text').map(node => node.value).join('|'), 'Hello | between |\n', 'Mixed and whitespace text retained')
  equal(getNodeCopy(tree, items[1], 'path'), getNodePath(tree, items[1]), 'Path copy API')
  equal(tree.nodeCount, 21, 'Node count includes attributes and lexical nodes')

  const redeclared = buildXmlTree('<r xmlns:p="urn:old" xmlns="urn:old-default"><a xmlns:p="urn:new"><p:x xmlns=""/></a></r>')
  const a = redeclared.root.children[0].children.find(node => node.label === 'a')
  const x = a.children.find(node => node.label === 'p:x')
  equal(x.value, '<p:x xmlns:p="urn:new" xmlns=""/>', 'Nearest namespace binding wins; own empty default retained')
  equal(x.raw, '<p:x xmlns=""/>', 'Namespace copy never mutates raw source')
  equal(buildXmlTree('<parsererror>ordinary content</parsererror>').root.children[0].label, 'parsererror', 'Ordinary parsererror element is valid')

  const entities = buildXmlTree('<r a="line\r\nnext\t&amp;lt;">a\r\nb&#xD;&amp;lt;</r>').root.children[0]
  equal(entities.children[0].value, 'line next &lt;', 'Attribute normalization precedes entity decoding')
  equal(entities.children[1].value, 'a\nb\r&lt;', 'Text references are not recursively decoded')

  const dtd = '<!DOCTYPE r [<!-- ] > --> <!ELEMENT r EMPTY>]><r/>'
  equal(buildXmlTree(dtd).root.raw, dtd, 'DTD comment does not split token')
  for (const input of [
    '<r><x></r>', '<r a="1" a="2"/>', '<r>&unknown;</r>', '<r/><x/>', '<p:r/>',
    '<r><![CDATA[open</r>', '<r><!-- open</r>', '<r a="bad < value"/>',
    '<r/>trailing', '<!DOCTYPE><r/>', '<!DOCTYPE r [nonsense]><r/>',
    '<r/><?xml version="1.0"?>', '<!DOCTYPE r><!DOCTYPE r><r/>',
    '<!DOCTYPE r [<!ENTITY e "hi">]><r>&e;</r>',
    '<!DOCTYPE r [<!ENTITY e SYSTEM "https://example.invalid/entity">]><r/>',
    '<!DOCTYPE r [%external;]><r/>',
  ]) rejects(input)

  // Inspect what reaches DOMParser without making any network request. External
  // doctype IDs are retained by the model, but removed from validation input.
  const NativeParser = globalThis.DOMParser
  let validationInput = ''
  globalThis.DOMParser = class {
    parseFromString(input, type) { validationInput = input; return new NativeParser().parseFromString(input, type) }
  }
  try {
    const external = '<!DOCTYPE r SYSTEM "https://example.invalid/never-fetch.dtd"><r/>'
    equal(buildXmlTree(external).root.raw, external, 'External doctype raw retained')
    equal(validationInput, '<!DOCTYPE r><r/>', 'Native parser never receives external DTD URL')
    const publicDtd = '<!DOCTYPE r PUBLIC "example" "https://example.invalid/never-fetch.dtd"><r/>'
    equal(buildXmlTree(publicDtd).root.raw, publicDtd, 'PUBLIC doctype raw retained')
    equal(validationInput, '<!DOCTYPE r><r/>', 'Native parser never receives PUBLIC DTD URL')
  } finally { globalThis.DOMParser = NativeParser }

  equal(buildXmlTree('<r>'.repeat(MAX_TREE_DEPTH) + '</r>'.repeat(MAX_TREE_DEPTH)).nodeCount, MAX_TREE_DEPTH + 1, 'XML depth boundary accepted')
  rejects('<r>'.repeat(MAX_TREE_DEPTH + 1) + '</r>'.repeat(MAX_TREE_DEPTH + 1), /256/)
  rejects('<r>' + '<x/>'.repeat(MAX_TREE_NODES) + '</r>', /100,000/)
  const json = buildJsonTree('{"n":1e+999,"n":-0}')
  equal(json.root.children[0].value, '1e+999', 'JSON number spelling also works in browser')
  equal(json.root.children[1].path, '$["n"]#2', 'JSON duplicate path also works in browser')
  return `${assertions} formatter tree browser assertions passed`
}
