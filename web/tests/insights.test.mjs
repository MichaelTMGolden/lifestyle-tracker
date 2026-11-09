import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, bestWeek, mondayOf, monthlyRates, monthlyTotals, weekdayRates, weeklyTotals } from '../src/pages/habits/insights.ts'

const map = (...days) => new Map(days.map(d => typeof d === 'string' ? [d, 0] : d))

test('date helpers cross months and find Mondays', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2026-03-29', 1), '2026-03-30') // around a DST change
  assert.equal(mondayOf('2026-11-09'), '2026-11-09') // a Monday
  assert.equal(mondayOf('2026-11-15'), '2026-11-09') // Sunday
})

test('weekday rates skip days before the first log and after today', () => {
  // Today is Wednesday 2026-11-11; first log Monday 2026-11-02.
  const s = weekdayRates(map('2026-11-02', '2026-11-09', '2026-11-11'), '2026-11-11', 12, '2026-11-02')
  assert.deepEqual(s[0], { done: 2, total: 2 }) // Mondays
  assert.deepEqual(s[1], { done: 0, total: 2 }) // Tuesdays
  assert.deepEqual(s[2], { done: 1, total: 2 }) // Wednesdays
  assert.deepEqual(s[3], { done: 0, total: 1 }) // Thursday: only last week's
  // Today (Wednesday) not done yet: not counted as missed.
  assert.deepEqual(weekdayRates(map('2026-11-02'), '2026-11-11', 12, '2026-11-02')[2], { done: 0, total: 1 })
})

test('weekly totals sum days and minutes, oldest first', () => {
  const w = weeklyTotals(map(['2026-11-03', 30], ['2026-11-05', 15], ['2026-11-10', 60]), '2026-11-11', 2)
  assert.deepEqual(w, [{ start: '2026-11-02', days: 2, minutes: 45 }, { start: '2026-11-09', days: 1, minutes: 60 }])
})

test('monthly totals count elapsed days up to today', () => {
  const m = monthlyTotals(map(['2026-10-31', 20], ['2026-11-01', 10]), '2026-11-09', 2)
  assert.deepEqual(m, [{ month: '2026-10', days: 1, minutes: 20, elapsed: 31 }, { month: '2026-11', days: 1, minutes: 10, elapsed: 9 }])
})

test('monthly rates start each habit at its first log and honour weekly targets', () => {
  const daily = { habit: { cadence: 'daily', targetPerPeriod: 1 }, byDate: map('2026-11-05', '2026-11-06') } // asked 5 (5th–9th)
  const weekly = { habit: { cadence: 'weekly', targetPerPeriod: 7 }, byDate: map('2026-11-01') } // asked 9
  const r = monthlyRates([daily, weekly], '2026-11-09', 2)
  assert.equal(r[0].rate, null)
  assert.equal(r[1].rate, 3 / 14)
})

test('best week is the one with the most practice days', () => {
  const a = { habit: { cadence: 'daily', targetPerPeriod: 1 }, byDate: map('2026-11-02', '2026-11-03', '2026-11-09') }
  const b = { habit: { cadence: 'daily', targetPerPeriod: 1 }, byDate: map('2026-11-04') }
  assert.deepEqual(bestWeek([a, b], '2026-11-11', 2), { start: '2026-11-02', days: 3, minutes: 0 })
  assert.equal(bestWeek([], '2026-11-11', 2), null)
})

test('extra days on one habit never cover another habit, and the true first entry counts', () => {
  const daily = { habit: { cadence: 'daily', targetPerPeriod: 1 }, byDate: map('2026-02-01') } // 1 of 28
  const weekly = { habit: { cadence: 'weekly', targetPerPeriod: 1 }, byDate: map(...Array.from({ length: 28 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`)) } // 28 done, 4 asked
  assert.ok(Math.abs(monthlyRates([daily, weekly], '2026-02-28', 1)[0].rate - 5 / 32) < 1e-9)
  // Logged long before the window: the gap months count as missed, not as "no habits".
  const old = { habit: { cadence: 'daily', targetPerPeriod: 1 }, byDate: map('2026-02-10'), from: '2025-10-01' }
  assert.equal(monthlyRates([old], '2026-02-28', 2)[0].rate, 0)
})
