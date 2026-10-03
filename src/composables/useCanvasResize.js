import { onBeforeUnmount, watch } from 'vue'

export function useCanvasResize(viewport, fit, isActive) {
  let observer
  let frame
  let lastWidth = 0
  let lastHeight = 0
  const scheduleFit = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const element = viewport.value
      if (!isActive() || !element?.clientWidth || !element.clientHeight) return
      const { clientWidth, clientHeight } = element
      // v-show reports zero when hidden; returning to the same size must not
      // reset a workspace's user-selected zoom or scroll position.
      if (clientWidth === lastWidth && clientHeight === lastHeight) return
      lastWidth = clientWidth
      lastHeight = clientHeight
      fit()
    })
  }
  watch(viewport, element => {
    observer?.disconnect()
    lastWidth = lastHeight = 0
    if (!element) return
    observer = new ResizeObserver(scheduleFit)
    observer.observe(element)
  }, { flush: 'post' })
  watch(isActive, active => { if (active) scheduleFit() }, { flush: 'post' })
  onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame) })
}
