import { onBeforeUnmount, watch } from 'vue'

export function useCanvasResize(viewport, fit, isActive) {
  let observer
  let frame
  watch(viewport, element => {
    observer?.disconnect()
    if (!element) return
    observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (isActive() && element.clientWidth && element.clientHeight) fit()
      })
    })
    observer.observe(element)
  }, { flush: 'post' })
  onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame) })
}
