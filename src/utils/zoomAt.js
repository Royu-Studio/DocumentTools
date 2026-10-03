import { nextTick } from 'vue'

// Keep the content under the gesture's midpoint in place as its size changes.
export function zoomAt(viewport, content, zoom, value, center, previousCenter = center) {
  if (!viewport || !content) { zoom.value = value; return }
  const bounds = content.getBoundingClientRect()
  const anchor = { x: (previousCenter.x - bounds.left) / bounds.width, y: (previousCenter.y - bounds.top) / bounds.height }
  zoom.value = value
  nextTick(() => {
    const next = content.getBoundingClientRect()
    viewport.scrollLeft += next.left + anchor.x * next.width - center.x
    viewport.scrollTop += next.top + anchor.y * next.height - center.y
  })
}
