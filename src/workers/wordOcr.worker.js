import { createWorker } from 'tesseract.js'

let ocr = null
self.onmessage = async ({ data: { id, action, payload } }) => {
  const fail = reason => self.postMessage({ id, error: reason?.message || String(reason) })
  try {
    if (action === 'init') {
      // Own Tesseract inside this worker so cancel/error can also terminate a
      // nested worker whose language initialization has not resolved yet.
      ocr = await createWorker(payload.language, 1, {
        workerPath: `${payload.base}/worker.min.js`, corePath: `${payload.base}/core`, langPath: `${payload.base}/lang-data`, gzip: true,
        errorHandler: fail,
        logger: message => self.postMessage({ progress: message }),
      })
      self.postMessage({ id, data: true })
    } else if (action === 'recognize') {
      await ocr.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3', user_defined_dpi: String(payload.dpi) })
      const { data } = await ocr.recognize(payload.image)
      self.postMessage({ id, data: { lines: (data.lines || []).map(line => ({
        text: line.text, confidence: line.confidence, bbox: line.bbox,
        words: line.words.map(word => ({ is_serif: word.is_serif, is_bold: word.is_bold, is_italic: word.is_italic })),
      })) } })
    }
  } catch (reason) { fail(reason) }
}
