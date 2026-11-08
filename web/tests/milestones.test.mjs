import test from 'node:test'
import assert from 'node:assert/strict'
import { crossedMilestone } from '../src/pages/habits/crossedMilestone.ts'

test('crossing a milestone returns it; staying put or falling does not', () => {
  assert.equal(crossedMilestone(6, 7, false), 7)
  assert.equal(crossedMilestone(7, 8, false), null)
  assert.equal(crossedMilestone(29, 31, false), 30)
  assert.equal(crossedMilestone(8, 0, false), null)
  assert.equal(crossedMilestone(3, 4, true), 4)
  assert.equal(crossedMilestone(6, 7, true), null)
})
