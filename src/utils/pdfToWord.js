import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWordOcr } from './wordOcr.js'
import { configurePdfJsWorker } from './pdfWorker.js'
import { createWordDocument } from './wordDocument.js'
import { abortable, checkAbort, isUsableText, mergeRecognizedRuns, ocrLinesToRuns, parsePageRange, readableText } from './wordLayout.js'

const textOperations = new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText])
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const hex = rgb => rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')
const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

function pdfTextRuns(content, viewport, page) {
  const runs = []
  let unsupported = false
  for (const item of content.items) {
    if (!item.str?.trim()) continue
    const style = content.styles[item.fontName] || {}
    const matrix = pdfjs.Util.transform(viewport.transform, item.transform)
    if (!isUsableText(item.str) || style.vertical || item.dir === 'rtl' || Math.abs(Math.atan2(matrix[1], matrix[0])) > 0.03) {
      unsupported = true
      continue
    }
    const fontSize = Math.hypot(matrix[2], matrix[3])
    const scale = Math.hypot(matrix[0], matrix[1]) / Math.max(.001, Math.hypot(item.transform[0], item.transform[1]))
    const width = item.width * scale
    if (!fontSize || width <= 0) continue
    const fontObject = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null
    const family = fontObject?.name || style.fontFamily || ''
    const ascent = Number.isFinite(style.ascent) ? style.ascent : .8
    runs.push({
      text: readableText(item.str), x: matrix[4], y: matrix[5] - fontSize * ascent,
      width, height: fontSize, fontSize,
      font: /Courier|mono/i.test(family) ? 'Courier New' : /Times|serif/i.test(family) && !/sans/i.test(family) ? 'Times New Roman' : 'Arial',
      bold: /bold|black|heavy/i.test(family), italic: /italic|oblique/i.test(family), source: 'pdf',
    })
  }
  // A broken/vertical text layer must not cause its original visible content to disappear.
  return { runs: unsupported ? [] : runs, unsupported }
}

function pixelArea(canvas, run, scale) {
  const x = clamp(Math.floor(run.x * scale) - 2, 0, canvas.width - 1)
  const y = clamp(Math.floor(run.y * scale) - 2, 0, canvas.height - 1)
  const width = clamp(Math.ceil(run.width * scale) + 4, 1, canvas.width - x)
  const height = clamp(Math.ceil(run.height * scale) + 4, 1, canvas.height - y)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return { x, y, width, height, ctx, image: ctx.getImageData(x, y, width, height) }
}

function backgroundColor(area) {
  const colors = new Map()
  const { width, height, image: { data } } = area
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x > 1 && y > 1 && x < width - 2 && y < height - 2) continue
    const i = (y * width + x) * 4
    const rgb = [data[i], data[i + 1], data[i + 2]]
    const key = rgb.map(value => Math.round(value / 16)).join(',')
    const entry = colors.get(key) || { rgb, count: 0 }
    entry.count++
    colors.set(key, entry)
  }
  return [...colors.values()].sort((a, b) => b.count - a.count)[0]?.rgb || [255, 255, 255]
}

function textColor(area, bg) {
  const colors = new Map(), { data } = area.image
  for (let i = 0; i < data.length; i += 4) {
    const rgb = [data[i], data[i + 1], data[i + 2]]
    if (distance(rgb, bg) < 120) continue
    const key = rgb.map(value => Math.round(value / 32)).join(',')
    const entry = colors.get(key) || { rgb, count: 0 }
    entry.count++
    colors.set(key, entry)
  }
  return hex([...colors.values()].sort((a, b) => b.count - a.count)[0]?.rgb || [0, 0, 0])
}

function removeRecognizedText(canvas, runs, scale) {
  for (const run of runs) {
    const area = pixelArea(canvas, run.ink || run, scale), bg = backgroundColor(area)
    run.color = textColor(area, bg)
    const { width, height, image: { data } } = area
    // Preserve rules crossing the whole word region (common in scanned tables).
    const rows = new Set(), columns = new Set()
    const ink = (x, y) => {
      const i = (y * width + x) * 4
      return distance([data[i], data[i + 1], data[i + 2]], bg) > 100
    }
    for (let y = 0; y < height; y++) {
      let count = 0
      for (let x = 0; x < width; x++) if (ink(x, y)) count++
      if (count > width * .9 && ink(0, y) && ink(width - 1, y)) rows.add(y)
    }
    for (let x = 0; x < width; x++) {
      let count = 0
      for (let y = 0; y < height; y++) if (ink(x, y)) count++
      if (count > height * .9 && ink(x, 0) && ink(x, height - 1)) columns.add(x)
    }
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      if (rows.has(y) || columns.has(x)) continue
      const i = (y * width + x) * 4
      data[i] = bg[0]; data[i + 1] = bg[1]; data[i + 2] = bg[2]; data[i + 3] = 255
    }
    area.ctx.putImageData(area.image, area.x, area.y)
  }
}

function hasVisibleContent(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height)
  // Sample at most about 250k pixels. Blank native-text pages need no OCR.
  const step = Math.max(1, Math.floor(canvas.width * canvas.height / 250000)) * 4
  let count = 0
  for (let i = 0; i < data.length; i += step) if (Math.min(data[i], data[i + 1], data[i + 2]) < 220 && ++count > 20) return true
  return false
}

async function canvasBytes(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('页面图片生成失败，请降低清晰度重试。')
  return new Uint8Array(await blob.arrayBuffer())
}

export async function convertPdfToWord(file, options = {}, { signal, onProgress = () => {} } = {}) {
  checkAbort(signal)
  configurePdfJsWorker(pdfjs)
  const appearance = options.layout === 'appearance'
  const language = ['chi_sim+eng', 'chi_sim', 'eng'].includes(options.language) ? options.language : 'chi_sim+eng'
  const dpi = [144, 216, 300].includes(Number(options.dpi)) ? Number(options.dpi) : 216
  let task, worker, renderTask, canvas, currentIndex = 0, count = 1, lastProgress = 0, currentLabel = ''
  const warnings = new Set(), stats = { pages: 0, textPages: 0, ocrPages: 0, imageOnlyPages: 0 }
  const report = (value, message) => {
    lastProgress = Math.max(lastProgress, Math.min(100, Math.round(value)))
    onProgress({ percent: lastProgress, message })
  }
  const progress = (fraction, message) => report(4 + (currentIndex + fraction) / count * 88, message)
  const cancel = () => {
    renderTask?.cancel()
    if (worker) void worker.terminate().catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    report(1, '正在读取 PDF…')
    task = pdfjs.getDocument({ data: await abortable(file.arrayBuffer(), signal) })
    task.onPassword = () => task.destroy()
    const pdf = await abortable(task.promise, signal)
    const pages = parsePageRange(options.range, pdf.numPages)
    count = pages.length
    const output = createWordDocument()
    for (currentIndex = 0; currentIndex < count; currentIndex++) {
      checkAbort(signal)
      const pageNumber = pages[currentIndex], label = `第 ${pageNumber} 页（${currentIndex + 1}/${count}）`
      currentLabel = label
      progress(0, `正在分析${label}…`)
      const page = await abortable(pdf.getPage(pageNumber), signal)
      const viewport = page.getViewport({ scale: 1 })
      const scale = Math.min(dpi / 72, Math.sqrt(8000000 / (viewport.width * viewport.height)), 12000 / Math.max(viewport.width, viewport.height))
      canvas = document.createElement('canvas')
      const rasterViewport = page.getViewport({ scale })
      canvas.width = Math.ceil(rasterViewport.width); canvas.height = Math.ceil(rasterViewport.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const render = async operationsFilter => {
        renderTask = page.render({ canvasContext: ctx, viewport: rasterViewport, background: '#ffffff', operationsFilter })
        await abortable(renderTask.promise, signal)
        renderTask = null
      }
      await render()
      progress(.18, `正在处理${label}…`)
      let native = [], recognized = []
      if (!appearance) {
        const content = await abortable(page.getTextContent(), signal)
        if (options.recognition !== 'ocr') {
          const extracted = pdfTextRuns(content, viewport, page)
          native = extracted.runs
          if (extracted.unsupported) warnings.add('部分文字编码、方向或字体无法直接提取，已改用 OCR；未识别的内容保留为图像。')
          const originalTextPixels = native.map(run => {
            const area = pixelArea(canvas, run, scale)
            run.color = textColor(area, backgroundColor(area))
            return area
          })
          if (native.length) {
            const operators = await abortable(page.getOperatorList(), signal)
            await render(index => !textOperations.has(operators.fnArray[index]))
            // Searchable scans often contain an invisible text layer. Do not
            // overlay it on the scanned glyphs; OCR the visible scan instead.
            native = native.filter((run, index) => {
              const before = originalTextPixels[index]
              const after = ctx.getImageData(before.x, before.y, before.width, before.height).data
              let changed = 0
              for (let i = 0; i < after.length; i += 4) {
                if (Math.abs(after[i] - before.image.data[i]) + Math.abs(after[i + 1] - before.image.data[i + 1]) + Math.abs(after[i + 2] - before.image.data[i + 2]) > 45 && ++changed >= 3) return true
              }
              return false
            })
            if (native.length) stats.textPages++
          }
        }
        // OCR the remaining graphics, including outlined text or scanned inserts on
        // a page that also has native text. Native text wins overlapping detections.
        if (hasVisibleContent(canvas)) {
          progress(.25, `正在准备识别${label}…`)
          if (!worker) {
            worker = createWordOcr(message => {
              if (message.status === 'recognizing text' && !signal?.aborted) progress(.3 + message.progress * .45, `正在识别${currentLabel}…`)
            })
            const base = new URL(`${import.meta.env.BASE_URL}ocr-assets`, window.location.href).href
            await abortable(worker.init(language, base), signal)
          }
          progress(.3, `正在识别${label}…`)
          const data = await abortable(worker.recognize(await canvasBytes(canvas), Math.round(scale * 72)), signal)
          const stampRegions = (options.protectedRegions || []).filter(region => region.page === pageNumber)
          recognized = mergeRecognizedRuns(native, ocrLinesToRuns(data, scale)).filter(run => run.source === 'ocr' && !stampRegions.some(region => {
            const box = run.ink
            return box.x < (region.x + region.width) * viewport.width && box.x + box.width > region.x * viewport.width && box.y < (region.y + region.height) * viewport.height && box.y + box.height > region.y * viewport.height
          }))
          if (recognized.length) {
            stats.ocrPages++
            if (recognized.some(run => run.confidence < 70)) warnings.add('部分文字的识别置信度较低，请对照原 PDF 校对。')
            removeRecognizedText(canvas, recognized, scale)
          }
        }
      }
      checkAbort(signal)
      const runs = mergeRecognizedRuns(native, recognized)
      if (!runs.length) {
        stats.imageOnlyPages++
        if (!appearance) warnings.add(`第 ${pageNumber} 页未提取到可编辑文字，已保留原页图像。`)
      }
      progress(.83, `正在整理${label}的排版…`)
      output.addPage({ width: viewport.width, height: viewport.height, runs, image: await abortable(canvasBytes(canvas), signal) })
      stats.pages++
      canvas.width = canvas.height = 1; canvas = null
      page.cleanup()
      progress(1, `已处理${label}`)
      await abortable(new Promise(resolve => setTimeout(resolve, 0)), signal)
    }
    report(94, '正在生成 Word 文件…')
    const blob = await output.pack(signal)
    checkAbort(signal)
    report(100, 'Word 文件已生成')
    return { blob, stats, warnings: [...warnings] }
  } catch (reason) {
    checkAbort(signal)
    throw new Error(reason?.message || '转换失败，请检查 PDF 文件后重试。')
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (canvas) canvas.width = canvas.height = 1
    if (worker) { try { await worker.terminate() } catch {} }
    if (task) { try { await task.destroy() } catch {} }
  }
}
