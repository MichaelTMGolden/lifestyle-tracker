import assert from 'node:assert/strict'
import test from 'node:test'
import { alignPairs, correlation, dailyPoints, matchedCalories, rangePoints } from '../src/healthData.ts'
import type { MetricPoint } from '../src/api.ts'

const point = (date: string, value: number, extra: Partial<MetricPoint> = {}): MetricPoint =>
  ({ recordedAt: `${date}T12:00:00Z`, value, unit: null, ...extra })

test('calorie comparisons join by date, never array index or substituted activity', () => {
  const intake = [point('2026-09-15', 2200), point('2026-09-17', 1800), point('2026-09-19', 2000)]
  const active = [point('2026-09-17', 400), point('2026-09-18', 800), point('2026-09-19', 0)]
  assert.deepEqual(matchedCalories(intake, active, 1700), [
    { date: '2026-09-17', intake: 1800, output: 2100, net: -300 },
    { date: '2026-09-19', intake: 2000, output: 1700, net: 300 },
  ])
  assert.deepEqual(matchedCalories([], active, 1700), [])
})

test('a date range means calendar days, not the last N sparse samples', () => {
  assert.deepEqual(rangePoints([point('2026-01-01', 1), point('2026-09-05', 2), point('2026-09-06', 3), point('2026-09-20', 4)], 14, '2026-09-19').map(p => p.value), [3])
})

test('duplicate day samples contribute only the last recorded daily value', () => {
  const early = point('2026-09-19', 1000, { recordedAt: '2026-09-19T08:00:00Z' })
  const late = point('2026-09-19', 3000)
  assert.deepEqual(dailyPoints([late, early]), [late])
  assert.deepEqual(alignPairs([early, late], [point('2026-09-19', 42)]), { xs: [3000], ys: [42] })
})

test('synthetic data cannot support a claimed relationship', () => {
  const derived = point('2026-09-18', 90, { isDerived: true })
  const sample = point('2026-09-19', 20, { sourceName: 'Garmin (sample)' })
  assert.deepEqual(alignPairs([derived, sample], [point('2026-09-18', 30), point('2026-09-19', 50)]), { xs: [], ys: [] })
})

test('newer synthetic records do not shadow observed records on the same date', () => {
  const observed = point('2026-09-19', 80, { recordedAt: '2026-09-19T08:00:00Z' })
  const derived = point('2026-09-19', 95, { isDerived: true })
  assert.deepEqual(rangePoints([observed, derived], 14, '2026-09-19'), [observed])
  assert.deepEqual(alignPairs([observed, derived], [point('2026-09-19', 40)]), { xs: [80], ys: [40] })
  assert.deepEqual(matchedCalories([point('2026-09-19', 2000)], [point('2026-09-19', 300), point('2026-09-19', 900, { sourceName: 'Garmin (sample)' })], 1700), [
    { date: '2026-09-19', intake: 2000, output: 2000, net: 0 },
  ])
})

test('correlations distinguish unavailable evidence from no relationship', () => {
  assert.equal(correlation([1, 2, 3], [2, 4, 6]), null)
  assert.equal(correlation([1, 1, 1, 1], [2, 3, 4, 5]), null)
  assert.equal(correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1)
  assert.equal(correlation([1, 2, 3, 4], [8, 6, 4, 2]), -1)
})
