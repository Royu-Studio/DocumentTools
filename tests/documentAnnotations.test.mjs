import test from 'node:test'
import assert from 'node:assert/strict'
import { pdfOverlayPlacement } from '../src/utils/documentAnnotations.js'

test('PDF overlays follow all quarter-turn rotations and an offset crop box', () => {
  const cases = [
    { width: 440, height: 570, convertToPdfPoint: (x, y) => [30 + x, 610 - y], expected: [30, 40, 440, 570, 0] },
    { width: 570, height: 440, convertToPdfPoint: (x, y) => [30 + y, 40 + x], expected: [470, 40, 570, 440, 90] },
    { width: 440, height: 570, convertToPdfPoint: (x, y) => [470 - x, 40 + y], expected: [470, 610, 440, 570, 180] },
    { width: 570, height: 440, convertToPdfPoint: (x, y) => [470 - y, 610 - x], expected: [30, 610, 570, 440, -90] },
  ]
  for (const viewport of cases) {
    const { x, y, width, height, angle } = pdfOverlayPlacement(viewport)
    assert.deepEqual([x, y, width, height, angle], viewport.expected)
  }
})

test('PDF overlay placement is independent of preview resolution', () => {
  const placement = pdfOverlayPlacement({ width: 1320, height: 1710, convertToPdfPoint: (x, y) => [30 + x / 3, 610 - y / 3] })
  assert.deepEqual(placement, { x: 30, y: 40, width: 440, height: 570, angle: 0 })
})
