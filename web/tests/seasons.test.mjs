import test from 'node:test'
import assert from 'node:assert/strict'
import { inFocusOn, seasonOn, splitByFocus } from '../src/seasons.ts'
import { monthlyRates, weekdayRates } from '../src/pages/habits/insights.ts'

// Newest first, as the API returns them.
const seasons = [
  { id: 2, name: 'Winter', startsOn: '2026-11-05', endsOn: null, habitIds: [1] },
  { id: 1, name: 'Autumn', startsOn: '2026-10-01', endsOn: '2026-11-04', habitIds: [1, 2] },
]

test('the season covering a day decides focus; no season means everything', () => {
  assert.equal(seasonOn(seasons, '2026-11-09').name, 'Winter')
  assert.equal(seasonOn(seasons, '2026-11-04').name, 'Autumn')
  assert.equal(seasonOn(seasons, '2026-09-30'), null)
  assert.equal(inFocusOn(seasons, 2, '2026-11-04'), true)
  assert.equal(inFocusOn(seasons, 2, '2026-11-05'), false)
  assert.equal(inFocusOn(seasons, 3, '2026-09-01'), true)
})

test('splitting keeps order and never hides everything', () => {
  const habits = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(splitByFocus(habits, seasons[0]), { focus: [{ id: 1 }], others: [{ id: 2 }, { id: 3 }] })
  assert.deepEqual(splitByFocus(habits, null).others, [])
  assert.deepEqual(splitByFocus(habits, { ...seasons[0], habitIds: [99] }).focus.length, 3)
})

test('days out of focus are not counted as missed', () => {
  const byDate = new Map([['2026-11-02', 0]])
  const asked = d => inFocusOn(seasons, 2, d)
  // Habit 2 is out of focus from 5 Nov: only 2–4 Nov are asked in November.
  const r = monthlyRates([{ habit: { cadence: 'daily', targetPerPeriod: 1 }, byDate, asked }], '2026-11-09', 1)
  assert.equal(r[0].rate, 1 / 3)
  const w = weekdayRates(byDate, '2026-11-09', 2, '2026-11-02', asked)
  assert.deepEqual(w[3], { done: 0, total: 0 }) // Thursday 5 Nov is out of focus
  assert.deepEqual(w[1], { done: 0, total: 1 }) // Tuesday 3 Nov was in focus
  assert.deepEqual(w[0], { done: 1, total: 1 }) // Monday 9 Nov (today, not done) skipped
})

test('a season whose habits were all deleted counts as none', async () => {
  const { liveSeasons } = await import('../src/seasons.ts')
  const emptied = [{ id: 3, name: null, startsOn: '2026-11-01', endsOn: null, habitIds: [9] }]
  const live = liveSeasons(emptied, [1, 2])
  assert.deepEqual(live, [])
  assert.equal(inFocusOn(live, 1, '2026-11-05'), true)
})
