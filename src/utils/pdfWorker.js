import PdfJsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'

let workerPort = null

/**
 * Reuse one real module worker for PDF.js. Vite emits this worker as a normal
 * `.js` asset, avoiding hosts that serve `.mjs` as application/octet-stream.
 */
export function configurePdfJsWorker(pdfjsLib) {
  if (!workerPort) workerPort = new PdfJsWorker()
  pdfjsLib.GlobalWorkerOptions.workerPort = workerPort
  return workerPort
}
