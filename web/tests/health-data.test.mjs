import test from 'node:test'
import assert from 'node:assert/strict'
import { ageDays, ago, daily, trend } from '../src/pages/health/data.ts'

const p = (recordedAt, value, extra = {}) => ({ recordedAt, value, unit: null, ...extra })

test('one value per day: real readings beat derived or sample ones, then latest wins', () => {
  const pts = [
    p('2026-11-01T06:00:00Z', 60, { sourceName: 'Garmin (sample)' }),
    p('2026-11-01T07:00:00Z', 58),
    p('2026-11-02T06:00:00Z', 55),
    p('2026-11-02T08:00:00Z', 57),
    p('2026-11-03T06:00:00Z', 70, { isDerived: true }),
  ]
  assert.deepEqual(daily(pts), [{ date: '2026-11-01', value: 58 }, { date: '2026-11-02', value: 57 }, { date: '2026-11-03', value: 70 }])
})

test('trend averages the range and compares it with the range before', () => {
  const series = Array.from({ length: 28 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`.replace('2026-11-29', '2026-11-29'), value: i < 14 ? 50 : 60 }))
  const t = trend(series, 14, '2026-11-28')
  assert.equal(t.avg, 60)
  assert.equal(t.change, 10)
  assert.equal(t.recent.length, 14)
  assert.equal(t.last.value, 60)
})

test('empty or one-sided ranges report no change', () => {
  assert.equal(trend([], 30, '2026-11-08').avg, null)
  const t = trend([{ date: '2026-11-07', value: 5 }], 30, '2026-11-08')
  assert.equal(t.avg, 5)
  assert.equal(t.change, null)
})

test('age in days', () => {
  assert.equal(ageDays('2026-11-06', '2026-11-08'), 2)
  assert.equal(ageDays('2026-11-08', '2026-11-08'), 0)
})

test('ago reads naturally, then falls back to a date', () => {
  assert.equal(ago('2026-11-08', '2026-11-08'), 'today')
  assert.equal(ago('2026-11-07', '2026-11-08'), 'yesterday')
  assert.equal(ago('2026-11-05', '2026-11-08'), '3 days ago')
  assert.match(ago('2026-06-12', '2026-11-08'), /12/)
})
