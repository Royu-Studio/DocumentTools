import test from 'node:test'
import assert from 'node:assert/strict'
import { binarizePixels } from '../src/utils/ocrPixels.js'

test('pure black text survives a zero Otsu threshold', () => {
  const data = new Uint8ClampedArray([0,0,0,255, 255,255,255,255])
  assert.deepEqual([...binarizePixels(data,0)], [0,0,0,255, 255,255,255,255])
})
test('transparent background becomes white, not black', () => {
  assert.deepEqual([...binarizePixels(new Uint8ClampedArray([0,0,0,0]),127)], [255,255,255,255])
})
test('inversion converts light text on dark background', () => {
  assert.deepEqual([...binarizePixels(new Uint8ClampedArray([240,240,240,255, 15,15,15,255]),127,true)], [0,0,0,255, 255,255,255,255])
})
