import { abortError } from './wordLayout.js'

export function createWordOcr(onProgress) {
  const worker = new Worker(new URL('../workers/wordOcr.worker.js', import.meta.url), { type: 'module' })
  let sequence = 0, pending = null, stopped = false
  function terminate(reason = abortError()) {
    if (stopped) return
    stopped = true
    worker.terminate()
    if (pending) { clearTimeout(pending.timer); pending.reject(reason); pending = null }
  }
  worker.onmessage = ({ data }) => {
    if (data.progress) { onProgress(data.progress); return }
    if (!pending || data.id !== pending.id) return
    if (data.error) { terminate(new Error(`文字识别失败：${data.error}`)); return }
    clearTimeout(pending.timer)
    pending.resolve(data.data)
    pending = null
  }
  worker.onerror = event => {
    event.preventDefault()
    terminate(new Error('文字识别组件加载失败，请刷新后重试，并确认 OCR 资源可用。'))
  }
  function request(action, payload, transfer = []) {
    if (stopped) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const id = ++sequence
      pending = { id, resolve, reject, timer: setTimeout(() => terminate(new Error('文字识别超时，请降低清晰度或缩小页码范围后重试。')), action === 'init' ? 120000 : 300000) }
      worker.postMessage({ id, action, payload }, transfer)
    })
  }
  return {
    init: (language, base) => request('init', { language, base }),
    recognize: (image, dpi) => request('recognize', { image, dpi }, [image.buffer]),
    terminate: () => { terminate(); return Promise.resolve() },
  }
}
