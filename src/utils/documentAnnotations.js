// Map the displayed (possibly rotated and cropped) PDF page back to PDF space.
// The annotation bitmap uses the same viewport as the editor, while the source
// PDF is retained so untouched pages and native text remain intact.
export function pdfOverlayPlacement(viewport) {
  const [x, y] = viewport.convertToPdfPoint(0, viewport.height)
  const right = viewport.convertToPdfPoint(viewport.width, viewport.height)
  const top = viewport.convertToPdfPoint(0, 0)
  return {
    x, y,
    width: Math.hypot(right[0] - x, right[1] - y),
    height: Math.hypot(top[0] - x, top[1] - y),
    angle: Math.atan2(right[1] - y, right[0] - x) * 180 / Math.PI,
  }
}
