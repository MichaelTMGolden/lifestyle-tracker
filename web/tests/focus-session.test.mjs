import test from 'node:test'
import assert from 'node:assert/strict'
import { countdown, DICE_FACES, isWork, rollMinutes, rollOne } from '../src/pages/focus/session.ts'

test('the dice only lands on its faces, edges included', () => {
  assert.equal(rollMinutes(() => 0), DICE_FACES[0])
  assert.equal(rollMinutes(() => 0.9999999), DICE_FACES.at(-1))
  for (let i = 0; i < 200; i++) assert.ok(DICE_FACES.includes(rollMinutes()))
})

test('rolling a habit picks from the list, or nothing from an empty one', () => {
  assert.equal(rollOne(['a', 'b', 'c'], () => 0.5), 'b')
  assert.equal(rollOne([], () => 0.5), null)
})

test('countdown shows time left, then time over', () => {
  assert.deepEqual(countdown(25, 0), { text: '25:00', over: false, fraction: 0 })
  assert.deepEqual(countdown(25, 12.5 * 60_000), { text: '12:30', over: false, fraction: 0.5 })
  assert.equal(countdown(25, 25 * 60_000).text, '0:00')
  assert.deepEqual(countdown(1, 3 * 60_000 + 10_000), { text: '+2:10', over: true, fraction: 1 })
  assert.equal(countdown(90, 0).text, '1:30:00')
})

test('work is recognised by name', () => {
  assert.ok(isWork(' work '))
  assert.ok(!isWork('Workout'))
})
