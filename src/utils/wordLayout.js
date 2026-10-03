// PDF and OCR coordinates are normalized to points (1/72 inch), top-left origin.
export function parsePageRange(value, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error('PDF 没有可转换的页面。')
  if (!String(value || '').trim()) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set()
  for (const part of String(value).replaceAll('，', ',').split(',')) {
    const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/)
    if (!match) throw new Error('页码格式不正确，例如：1-3, 5。')
    const start = Number(match[1]), end = Number(match[2] || match[1])
    if (start < 1 || end < start || end > total) throw new Error(`页码需在 1–${total} 之间，且起始页不能大于结束页。`)
    for (let page = start; page <= end; page++) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

export function readableText(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').trim()
}

export function isUsableText(value) {
  const text = readableText(value)
  if (!text) return false
  const broken = (text.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length
  return broken === 0
}

export function mergeRecognizedRuns(native, recognized) {
  return [...native, ...recognized.filter(run => !native.some(item => {
    const overlapWidth = Math.max(0, Math.min(run.x + run.width, item.x + item.width) - Math.max(run.x, item.x))
    const overlapHeight = Math.max(0, Math.min(run.y + run.height, item.y + item.height) - Math.max(run.y, item.y))
    return overlapWidth * overlapHeight / Math.max(1, run.width * run.height) > 0.5
  }))].sort((a, b) => a.y - b.y || a.x - b.x)
}

export function ocrLinesToRuns(data, scale) {
  // Tesseract's CJK word boxes can overlap and extend beyond their line. Use
  // complete line boxes so both reading order and baseline remain consistent.
  return (data.lines || []).filter(line => isUsableText(line.text) && line.confidence >= 35 && line.bbox?.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0).map(line => {
    const { x0, y0, x1, y1 } = line.bbox
    const height = (y1 - y0) / scale
    const text = readableText(line.text)
    const hasCjk = /[\u3400-\u9fff]/.test(text)
    const glyphRatio = hasCjk ? .95 : /[gjpqy]/.test(text) ? .94 : .74
    const fontSize = Math.max(5, height / glyphRatio)
    const words = line.words || []
    return {
      text, x: x0 / scale, y: y0 / scale - fontSize * .1,
      width: (x1 - x0) / scale, height, fontSize,
      font: words[0]?.is_serif ? 'Times New Roman' : 'Arial', eastAsia: '微软雅黑',
      bold: words.length > 0 && words.every(word => word.is_bold),
      italic: words.length > 0 && words.every(word => word.is_italic),
      confidence: line.confidence, source: 'ocr',
      // Erasing uses actual ink bounds, independent of the Word baseline offset.
      ink: { x: x0 / scale, y: y0 / scale, width: (x1 - x0) / scale, height },
    }
  })
}

export function abortError() { return new DOMException('转换已取消', 'AbortError') }
export function checkAbort(signal) { if (signal?.aborted) throw abortError() }

// Tesseract initialization/recognition may not reject when its worker is terminated.
export function abortable(promise, signal) {
  if (!signal) return promise
  checkAbort(signal)
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
