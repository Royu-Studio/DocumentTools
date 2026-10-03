import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { parsePageRange, mergeRecognizedRuns, ocrLinesToRuns, abortable, isUsableText } from '../src/utils/wordLayout.js'
import { createWordDocument, DOCX_MIME } from '../src/utils/wordDocument.js'

test('page ranges validate bounds, remove duplicates and preserve original page order', () => {
  assert.deepEqual(parsePageRange('', 3), [1, 2, 3])
  assert.deepEqual(parsePageRange('5, 1-3，2', 5), [1, 2, 3, 5])
  for (const value of ['0', '6', '3-1', '1,', '-1', '1.5', '1-999999999']) assert.throws(() => parsePageRange(value, 5))
})

test('mixed page merge keeps native text and adds separate scan text without duplicate overlay', () => {
  const original = { text: 'Original', x: 10, y: 10, width: 100, height: 15 }
  const repeated = { ...original, text: '0riginal' }
  const extra = { ...original, y: 100, text: 'Scan' }
  assert.deepEqual(mergeRecognizedRuns([original], [repeated, extra]), [original, extra])
  assert.equal(isUsableText('\uFFFDgarbled'), false)
  assert.equal(isUsableText('中文 text'), true)
})

test('OCR uses stable line bounds instead of overlapping CJK word boxes', () => {
  const lines = [{ text: '中文', confidence: 91, bbox: { x0: 30, y0: 60, x1: 90, y1: 90 }, words: [{ text: '中', bbox: { x0: 30, y0: 20, x1: 90, y1: 120 } }] }, { text: '~', confidence: 12, bbox: { x0: 0, y0: 0, x1: 2, y1: 2 } }]
  const runs = ocrLinesToRuns({ lines }, 3)
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].ink, { x: 10, y: 20, width: 20, height: 10 })
  assert.equal(runs[0].text, '中文')
  assert.ok(runs[0].fontSize < 12)
})

test('DOCX has editable positioned text, page sections, image relationships and valid escaping', async () => {
  const doc = createWordDocument()
  const run = { text: '中文 & <test>', x: 40, y: 60, width: 150, height: 12, fontSize: 12, bold: true }
  doc.addPage({ width: 595, height: 842, runs: [run], image: new Uint8Array([1, 2, 3]) })
  doc.addPage({ width: 842, height: 595, runs: [run] })
  const blob = await doc.pack()
  assert.equal(blob.type, DOCX_MIME)
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const document = strFromU8(files['word/document.xml'])
  assert.match(document, /中文 &amp; &lt;test&gt;/)
  assert.equal((document.match(/<w:sectPr>/g) || []).length, 2)
  assert.match(document, /w:orient="landscape"/)
  assert.match(document, /w:x="800" w:y="1200"/)
  assert.match(document, /<w:b\/>/)
  assert.match(strFromU8(files['word/_rels/document.xml.rels']), /Target="media\/page-1.png"/)
  assert.ok(files['word/media/page-1.png'])
})

test('oversize PDF page scales text and paper together to the Word page size limit', async () => {
  const doc = createWordDocument()
  doc.addPage({ width: 3168, height: 2000, runs: [{ text: 'wide', x: 100, y: 100, width: 100, height: 12, fontSize: 12 }] })
  const files = unzipSync(new Uint8Array(await (await doc.pack()).arrayBuffer()))
  const xml = strFromU8(files['word/document.xml'])
  assert.match(xml, /w:pgSz w:w="31680" w:h="20000"/)
  assert.match(xml, /w:x="1000" w:y="1000"/)
})

test('cancel interrupts a pending worker promise and prevents packaging', async () => {
  const controller = new AbortController()
  const pending = abortable(new Promise(() => {}), controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  const doc = createWordDocument()
  await assert.rejects(doc.pack(controller.signal), { name: 'AbortError' })
})
