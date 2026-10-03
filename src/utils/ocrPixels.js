// Keep the threshold in the same intensity space as the pixels. Including the
// boundary preserves pure black text when Otsu selects a threshold of zero.
export function binarizePixels(pixels, threshold, invert = false) {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    const gray = Math.round((pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114) * alpha + 255 * (1 - alpha))
    const ink = invert ? gray > threshold : gray <= threshold
    pixels[i] = pixels[i + 1] = pixels[i + 2] = ink ? 0 : 255
    pixels[i + 3] = 255
  }
  return pixels
}
