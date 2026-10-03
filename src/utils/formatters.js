export const MAX_TEXT_LENGTH = 2 * 1024 * 1024

export function checkText(source) {
  if (!source.trim()) throw new Error('请先输入内容或导入文件')
  if (source.length > MAX_TEXT_LENGTH) throw new Error('内容超过 2 MB，请缩小后重试')
}

export function formatJson(source, indent = 2, compact = false) {
  checkText(source)
  // Validate without serializing parsed values: large integers, duplicate keys,
  // exponent notation and escape sequences must retain their original spelling.
  JSON.parse(source)
  const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[^\s"{}\[\],:]+|[{}\[\],:]/g) || []
  if (compact) return tokens.join('')
  const unit = ' '.repeat(Number(indent))
  let depth = 0
  let result = ''
  tokens.forEach((token, index) => {
    if (token === '{' || token === '[') {
      result += token
      depth++
      if (depth > 256) throw new Error('JSON 嵌套超过 256 层，请缩小后重试')
      if (!['}', ']'].includes(tokens[index + 1])) result += '\n' + unit.repeat(depth)
    } else if (token === '}' || token === ']') {
      depth--
      if (!['{', '['].includes(tokens[index - 1])) result += '\n' + unit.repeat(depth)
      result += token
    } else if (token === ',') result += ',\n' + unit.repeat(depth)
    else if (token === ':') result += ': '
    else result += token
  })
  return result
}

// Scan markup without splitting quoted '>', comments, CDATA or DTD subsets.
export function xmlTokens(source) {
  const tokens = []
  let start = 0
  while (start < source.length) {
    if (source[start] !== '<') {
      const end = source.indexOf('<', start)
      tokens.push(source.slice(start, end < 0 ? source.length : end))
      start = end < 0 ? source.length : end
      continue
    }
    const marker = source.startsWith('<!--', start) ? '-->' : source.startsWith('<![CDATA[', start) ? ']]>' : source.startsWith('<?', start) ? '?>' : null
    let end = start + 1
    if (marker) {
      end = source.indexOf(marker, end)
      if (end < 0) throw new Error('XML 标记未闭合')
      end += marker.length
    } else {
      let quote = ''
      let brackets = 0
      for (; end < source.length; end++) {
        const char = source[end]
        if (quote) { if (char === quote) quote = ''; continue }
        if (char === '"' || char === "'") quote = char
        else if (char === '[') brackets++
        else if (char === ']') brackets--
        else if (char === '>' && brackets === 0) { end++; break }
      }
    }
    tokens.push(source.slice(start, end))
    start = end
  }
  return tokens
}

export function formatXml(source, indent = 2, compact = false) {
  checkText(source)
  const parsed = new DOMParser().parseFromString(source, 'application/xml')
  const error = parsed.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror')[0]
    || [...parsed.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'parsererror')].find(node => node.textContent.startsWith('This page contains the following errors:'))
  if (error) throw new Error(error.textContent.replace(/Below is a rendering[\s\S]*/, '').trim())
  const root = { children: [] }
  const stack = [root]
  for (const token of xmlTokens(source)) {
    const parent = stack.at(-1)
    if (/^<\//.test(token)) { parent.close = token; stack.pop() }
    else if (/^<[^!?/]/.test(token)) {
      const node = { open: token, children: [], close: '', preserve: parent.preserve || /xml:space\s*=\s*['"]preserve['"]/.test(token) }
      parent.children.push(node)
      if (!/\/\s*>$/.test(token)) stack.push(node)
    } else parent.children.push(token)
    if (stack.length > 256) throw new Error('XML 嵌套超过 256 层，请缩小后重试')
  }
  const raw = node => typeof node === 'string' ? node : node.open + node.children.map(raw).join('') + node.close
  function render(node, depth) {
    if (typeof node === 'string') return node
    // Mixed content, leaf whitespace, CDATA and xml:space are data, not indentation.
    const hasText = node.children.some(child => typeof child === 'string' && (!child.startsWith('<') && child.trim() || child.startsWith('<![CDATA[')))
    const hasElement = node.children.some(child => typeof child !== 'string')
    if (node.preserve || hasText || !hasElement && node !== root) return raw(node)
    const children = node.children.filter(child => typeof child !== 'string' || child.trim())
    const separator = compact ? '' : '\n'
    const pad = level => compact ? '' : ' '.repeat(Number(indent) * level)
    if (node === root) return children.map(child => render(child, 0)).join(separator)
    return node.open + separator + children.map(child => pad(depth + 1) + render(child, depth + 1)).join(separator) + separator + pad(depth) + node.close
  }
  return render(root, 0)
}
