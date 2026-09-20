import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleX, seriesSegments } from '../src/chartMath.ts'

test('a single observation has a finite centred coordinate', () => {
  assert.equal(sampleX(0, 1, 3, 144), 75)
  assert.equal(sampleX(0, 1, 34, 672), 370)
  assert.equal(sampleX(0, 2, 3, 144), 3)
  assert.equal(sampleX(1, 2, 3, 144), 147)
})

test('missing and non-finite observations leave gaps without dropping zero values', () => {
  assert.deepEqual(seriesSegments([0, 2, null, 4, Number.NaN, 6, Infinity]), [
    [{ i: 0, v: 0 }, { i: 1, v: 2 }], [{ i: 3, v: 4 }], [{ i: 5, v: 6 }],
  ])
  assert.deepEqual(seriesSegments([null, null]), [])
  assert.deepEqual(seriesSegments([5]), [[{ i: 0, v: 5 }]])
})
