import { checkText } from './formatters.js'

export const MAX_TREE_DEPTH = 256
export const MAX_TREE_NODES = 100000
const PREVIEW_LENGTH = 120
const metaKey = Symbol('formatter tree metadata')

const previewText = value => {
  const text = String(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
  return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH) + '…' : text
}

function createTree(source, format) {
  checkText(source)
  return { source, format, root: null, nodeCount: 0 }
}

function createNode(tree, parent, type, label, start, metadata = {}) {
  if (++tree.nodeCount > MAX_TREE_NODES) throw new Error('树节点超过 100,000 个，请缩小后重试')
  const node = { id: `${tree.format}-${tree.nodeCount}`, label, type, preview: '', start, end: start, children: [] }
  Object.defineProperties(node, {
    parent: { value: parent, configurable: true },
    [metaKey]: { value: metadata, configurable: true },
    // Lazy and non-enumerable: expanding a small part of a large tree must not
    // materialize every path or copy each ancestor's entire source subtree.
    path: { get: () => getNodePath(tree, node) },
    raw: { get: () => getNodeCopy(tree, node, 'raw') },
    value: { get: () => getNodeCopy(tree, node, 'value') },
  })
  if (parent) parent.children.push(node)
  return node
}

function fail(format, position, detail = '语法无效') {
  throw new Error(`${format} ${detail}（位置 ${position + 1}）`)
}

/** A token/span parser, deliberately never JSON.parse-ing numbers or objects. */
export function buildJsonTree(source) {
  const tree = createTree(source, 'json')
  let position = 0
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const whitespace = () => {
    while (position < source.length && /[\x20\t\r\n]/.test(source[position])) position++
  }
  const readString = () => {
    const start = position++
    while (position < source.length) {
      const character = source[position++]
      if (character === '\\') position++
      else if (character === '"') {
        try { return JSON.parse(source.slice(start, position)) }
        catch { fail('JSON', start, '字符串无效') }
      }
    }
    fail('JSON', start, '字符串未闭合')
  }
  function readValue(parent, label, metadata, depth) {
    whitespace()
    const start = position
    const character = source[position]
    if (character === '{' || character === '[') {
      if (depth > MAX_TREE_DEPTH) throw new Error('JSON 嵌套超过 256 层，请缩小后重试')
      const object = character === '{'
      const node = createNode(tree, parent, object ? 'object' : 'array', label, start, { ...metadata, keyCounts: new Map() })
      const close = object ? '}' : ']'
      position++
      whitespace()
      if (source[position] !== close) {
        while (true) {
          whitespace()
          if (object) {
            if (source[position] !== '"') fail('JSON', position, '属性名称必须是字符串')
            const keyStart = position
            const key = readString()
            const keyEnd = position
            whitespace()
            if (source[position++] !== ':') fail('JSON', position - 1, '缺少冒号')
            const occurrence = (node[metaKey].keyCounts.get(key) || 0) + 1
            node[metaKey].keyCounts.set(key, occurrence)
            readValue(node, key, { key, keyStart, keyEnd, occurrence }, depth + 1)
          } else {
            const index = node.children.length
            readValue(node, `[${index}]`, { index }, depth + 1)
          }
          whitespace()
          if (source[position] === close) break
          if (source[position++] !== ',') fail('JSON', position - 1, `缺少逗号或 ${close}`)
        }
      }
      position++
      node.end = position
      node.preview = `${node.children.length} ${object ? '个属性' : '项'}`
      // A decoded key can occur more than once, even with different escapes.
      if (object) for (const child of node.children) {
        const data = child[metaKey]
        if (node[metaKey].keyCounts.get(data.key) > 1) child.label = `${data.key} [#${data.occurrence}]`
      }
      return node
    }
    let type, value
    if (character === '"') { type = 'string'; value = readString() }
    else if (source.startsWith('true', position)) { type = 'boolean'; value = true; position += 4 }
    else if (source.startsWith('false', position)) { type = 'boolean'; value = false; position += 5 }
    else if (source.startsWith('null', position)) { type = 'null'; value = null; position += 4 }
    else {
      numberPattern.lastIndex = position
      const match = numberPattern.exec(source)
      if (!match) fail('JSON', position)
      type = 'number'
      value = match[0]
      position = numberPattern.lastIndex
    }
    const node = createNode(tree, parent, type, label, start, { ...metadata, scalarValue: value })
    node.end = position
    node.preview = previewText(type === 'string' ? JSON.stringify(value) : value)
    return node
  }
  tree.root = readValue(null, '$', {}, 1)
  whitespace()
  if (position !== source.length) fail('JSON', position, '包含多余内容')
  // The document-level raw copy includes leading/trailing whitespace as well.
  tree.root.start = 0
  tree.root.end = source.length
  return tree
}

// Scan spans rather than copying token strings. Quoted '>', CDATA, PIs and
// comments inside DTD subsets must not terminate the surrounding markup.
function xmlTokenEnd(source, start) {
  if (source[start] !== '<') {
    const next = source.indexOf('<', start)
    return next < 0 ? source.length : next
  }
  const marker = source.startsWith('<!--', start) ? '-->'
    : source.startsWith('<![CDATA[', start) ? ']]>'
      : source.startsWith('<?', start) ? '?>' : null
  if (marker) {
    const end = source.indexOf(marker, start + (marker === '-->' ? 4 : marker === ']]>' ? 9 : 2))
    if (end < 0) fail('XML', start, '标记未闭合')
    return end + marker.length
  }
  let quote = '', brackets = 0
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]
    if (quote) { if (char === quote) quote = ''; continue }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      if (end < 0) fail('XML', i, '注释未闭合')
      i = end + 2
    } else if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2)
      if (end < 0) fail('XML', i, '处理指令未闭合')
      i = end + 1
    } else if (char === '"' || char === "'") quote = char
    else if (char === '[') brackets++
    else if (char === ']') brackets--
    else if (char === '>' && brackets === 0) return i + 1
  }
  fail('XML', start, '标记未闭合')
}

function decodeXml(value, attribute = false) {
  const normalized = attribute ? value.replace(/\r\n|[\r\n\t]/g, ' ') : value.replace(/\r\n?/g, '\n')
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return normalized.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, name) => {
    if (name[0] !== '#') return entities[name]
    const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    // Native DOMParser reports invalid XML code points. Do not allow a native
    // RangeError here to obscure that validation result.
    return code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD'
  })
}

function checkDoctypeSubset(token, position) {
  // Some DOMParser implementations are permissive about arbitrary DTD text.
  // Require an actual sequence of declarations/comments/PIs before validation.
  let quote = '', subset = -1
  for (let i = 9; i < token.length; i++) {
    const char = token[i]
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '[') { subset = i + 1; break }
  }
  if (subset < 0) return
  const close = token.lastIndexOf(']')
  let cursor = subset
  while (cursor < close) {
    if (/\s/.test(token[cursor])) { cursor++; continue }
    const comment = token.startsWith('<!--', cursor)
    const instruction = token.startsWith('<?', cursor)
    const declaration = /^<!(?:ELEMENT|ATTLIST|NOTATION)\s/.test(token.slice(cursor, cursor + 12))
    if (!comment && !instruction && !declaration) fail('XML', position + cursor, 'DOCTYPE 内部声明无效或不受支持')
    const end = xmlTokenEnd(token, cursor)
    if (end > close) fail('XML', position + cursor, 'DOCTYPE 内部声明未闭合')
    cursor = end
  }
}

function validateXml(source, doctypes) {
  if (typeof DOMParser === 'undefined') throw new Error('XML 树视图需要浏览器的 DOMParser')
  // Never pass an external subset identifier or entity declarations to DOMParser.
  // Retain an inert DOCTYPE/internal subset so malformed DTD syntax is still
  // checked natively; the original spelling remains in the model for raw copy.
  let offset = 0
  const parts = []
  for (const node of doctypes) {
    const original = source.slice(node.start, node.end)
    const safe = original.replace(/^(<!DOCTYPE\s+[^\s\[>]+)\s+(?:SYSTEM\s+(?:"[^"]*"|'[^']*')|PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*'))/, '$1')
    parts.push(source.slice(offset, node.start), safe)
    offset = node.end
  }
  parts.push(source.slice(offset))
  const parsed = new DOMParser().parseFromString(parts.join(''), 'application/xml')
  const error = parsed.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror')[0]
    || [...parsed.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'parsererror')]
      .find(node => node.textContent.startsWith('This page contains the following errors:'))
  if (error) throw new Error(error.textContent.replace(/Below is a rendering[\s\S]*/, '').trim())
  if (!parsed.documentElement) throw new Error('XML 缺少根元素')
}

/** Build a lexical XML document tree, validating only after resource bounds. */
export function buildXmlTree(source) {
  const tree = createTree(source, 'xml')
  const root = createNode(tree, null, 'document', 'XML 文档', 0, { childCounts: new Map() })
  tree.root = root
  root.end = source.length
  const stack = [root]
  const doctypes = []
  let position = 0, rootElements = 0

  const addChild = (parent, type, label, start, metadata = {}) => {
    const counterKey = type === 'element' ? `element:${metadata.name}` : type
    const occurrence = (parent[metaKey].childCounts.get(counterKey) || 0) + 1
    parent[metaKey].childCounts.set(counterKey, occurrence)
    return createNode(tree, parent, type, label, start, { ...metadata, occurrence })
  }

  while (position < source.length) {
    const start = position
    const end = xmlTokenEnd(source, start)
    const parent = stack.at(-1)
    let node
    if (source.startsWith('</', start)) {
      const name = source.slice(start + 2, end - 1).trim()
      if (parent === root || name !== parent[metaKey].name) fail('XML', start, '结束标签不匹配')
      parent.end = end
      stack.pop()
    } else if (source.startsWith('<!--', start)) {
      node = addChild(parent, 'comment', '#comment', start, { valueStart: start + 4, valueEnd: end - 3 })
    } else if (source.startsWith('<![CDATA[', start)) {
      if (parent === root) fail('XML', start, 'CDATA 必须位于根元素内')
      node = addChild(parent, 'cdata', '#cdata', start, { valueStart: start + 9, valueEnd: end - 3 })
    } else if (source.startsWith('<?', start)) {
      const match = /^<\?([^\s?]+)/.exec(source.slice(start, end))
      if (!match) fail('XML', start)
      const declaration = match[1] === 'xml'
      node = addChild(parent, declaration ? 'declaration' : 'processing-instruction', `<?${match[1]}?>`, start, {
        name: match[1], valueStart: start + match[0].length, valueEnd: end - 2,
      })
    } else if (source.startsWith('<!DOCTYPE', start)) {
      if (parent !== root || doctypes.length || rootElements) fail('XML', start, 'DOCTYPE 的位置无效')
      const token = source.slice(start, end)
      if (/<!ENTITY\b/i.test(token) || /%\s*[\w:.-]+\s*;/.test(token)) {
        throw new Error('为避免实体展开或外部资源访问，XML 树视图不支持 DTD 实体声明或参数实体')
      }
      // Check outer syntax before removing an external DTD identifier.
      // Internal subsets remain for native validation.
      if (!/^<!DOCTYPE\s+[^\s\[>]+(?:\s+(?:SYSTEM\s+(?:"[^"]*"|'[^']*')|PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')))?\s*(?:\[[\s\S]*\]\s*)?>$/.test(token)) {
        fail('XML', start, 'DOCTYPE 语法无效')
      }
      checkDoctypeSubset(token, start)
      node = addChild(parent, 'doctype', '<!DOCTYPE>', start)
      doctypes.push(node)
    } else if (source[start] === '<') {
      if (source[start + 1] === '!') fail('XML', start, '不支持或无效的标记')
      if (stack.length > MAX_TREE_DEPTH) throw new Error('XML 嵌套超过 256 层，请缩小后重试')
      let cursor = start + 1
      while (cursor < end && !/[\s/>]/.test(source[cursor])) cursor++
      const name = source.slice(start + 1, cursor)
      if (!name) fail('XML', start, '缺少元素名称')
      node = addChild(parent, 'element', name, start, { name, childCounts: new Map(), namespaces: new Map(), openEnd: end })
      if (parent === root && ++rootElements > 1) fail('XML', start, '只能有一个根元素')
      while (cursor < end) {
        const beforeWhitespace = cursor
        while (/\s/.test(source[cursor] || '') && cursor < end) cursor++
        if (source[cursor] === '>' || source[cursor] === '/') break
        if (cursor === beforeWhitespace) fail('XML', cursor, '属性之间缺少空白')
        const attributeStart = cursor
        while (cursor < end && !/[\s=/>]/.test(source[cursor])) cursor++
        const attributeName = source.slice(attributeStart, cursor)
        while (cursor < end && /\s/.test(source[cursor])) cursor++
        if (!attributeName || source[cursor++] !== '=') fail('XML', cursor, '属性语法无效')
        while (cursor < end && /\s/.test(source[cursor])) cursor++
        const quote = source[cursor++]
        if (quote !== '"' && quote !== "'") fail('XML', cursor - 1, '属性值必须使用引号')
        const valueStart = cursor
        const valueEnd = source.indexOf(quote, cursor)
        if (valueEnd < 0 || valueEnd >= end) fail('XML', cursor, '属性值未闭合')
        cursor = valueEnd + 1
        const attribute = createNode(tree, node, 'attribute', `@${attributeName}`, attributeStart, { name: attributeName, valueStart, valueEnd })
        attribute.end = cursor
        attribute.preview = previewText(decodeXml(source.slice(valueStart, valueEnd), true))
        if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) node[metaKey].namespaces.set(attributeName, attribute)
      }
      if (!/\/\s*>$/.test(source.slice(Math.max(start, end - 16), end))) stack.push(node)
    } else {
      node = addChild(parent, 'text', '#text', start, { valueStart: start, valueEnd: end })
    }
    if (node) node.end = end
    position = end
  }
  if (stack.length !== 1) fail('XML', source.length - 1, '元素未闭合')
  if (rootElements !== 1) throw new Error('XML 缺少根元素')
  validateXml(source, doctypes)

  // Preview work is linear in the input size. Container previews never serialize
  // descendants, and empty/whitespace text nodes are retained for lossless copy.
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()
    if (node.type === 'element' || node.type === 'document') {
      const attributes = node.children.filter(child => child.type === 'attribute').length
      node.preview = `${node.children.length - attributes} 个节点${attributes ? ` · ${attributes} 个属性` : ''}`
      for (const child of node.children) pending.push(child)
    } else if (node.type !== 'attribute') node.preview = previewText(getNodeCopy(tree, node, 'value'))
  }
  return tree
}

/** JSONPath-like paths use #N only for duplicate decoded object keys. XML paths
 * identify lexical nodes, with cdata()/doctype()/xml-declaration() extensions. */
export function getNodePath(tree, node) {
  const segments = []
  let current = node
  while (current.parent) {
    const data = current[metaKey]
    if (tree.format === 'json') {
      if (current.parent.type === 'array') segments.push(`[${data.index}]`)
      else {
        const duplicate = current.parent[metaKey].keyCounts.get(data.key) > 1
        segments.push(`[${JSON.stringify(data.key)}]${duplicate ? `#${data.occurrence}` : ''}`)
      }
    } else if (current.type === 'element') segments.push(`${data.name}[${data.occurrence}]`)
    else if (current.type === 'attribute') segments.push(`@${data.name}`)
    else if (current.type === 'declaration') segments.push(`xml-declaration()[${data.occurrence}]`)
    else if (current.type === 'processing-instruction') segments.push(`processing-instruction()[${data.occurrence}]`)
    else segments.push(`${current.type}()[${data.occurrence}]`)
    current = current.parent
  }
  return tree.format === 'json' ? '$' + segments.reverse().join('') : '/' + segments.reverse().join('/')
}

function xmlElementValue(tree, node) {
  // A copied nested element must remain parseable when its namespace bindings
  // were declared on ancestors. Raw copy always remains the exact source span.
  const known = new Set(node[metaKey].namespaces.keys())
  const inherited = []
  let parent = node.parent
  while (parent && parent.type === 'element') {
    for (const [name, attribute] of parent[metaKey].namespaces) {
      if (!known.has(name)) {
        known.add(name)
        inherited.push(tree.source.slice(attribute.start, attribute.end))
      }
    }
    parent = parent.parent
  }
  if (!inherited.length) return tree.source.slice(node.start, node.end)
  const insertion = node.start + 1 + node[metaKey].name.length
  return tree.source.slice(node.start, insertion) + ' ' + inherited.join(' ') + tree.source.slice(insertion, node.end)
}

/** All copy modes return strings. value decodes scalar strings/attributes and
 * adds inherited XML namespace bindings to element copies. raw is always exact. */
export function getNodeCopy(tree, node, mode = 'value') {
  if (mode === 'path') return getNodePath(tree, node)
  if (mode === 'raw') return tree.source.slice(node.start, node.end)
  if (mode !== 'value') throw new Error(`未知复制模式：${mode}`)
  const data = node[metaKey]
  if (tree.format === 'json') {
    if (node.type === 'object' || node.type === 'array') return tree.source.slice(node.start, node.end)
    return data.scalarValue === null ? 'null' : String(data.scalarValue)
  }
  if (node.type === 'element') return xmlElementValue(tree, node)
  if (node.type === 'attribute' || node.type === 'text') return decodeXml(tree.source.slice(data.valueStart, data.valueEnd), node.type === 'attribute')
  if (node.type === 'comment' || node.type === 'cdata') return tree.source.slice(data.valueStart, data.valueEnd).replace(/\r\n?/g, '\n')
  if (node.type === 'processing-instruction') return tree.source.slice(data.valueStart, data.valueEnd).replace(/^\s+/, '').replace(/\r\n?/g, '\n')
  return tree.source.slice(node.start, node.end)
}
