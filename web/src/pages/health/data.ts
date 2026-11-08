// Health page helpers: one value per day from raw metric samples, and simple trends.
import type { MetricPoint } from '../../api'

/** Garmin day summaries carry their calendar date in UTC. */
const day = (p: MetricPoint) => p.recordedAt.slice(0, 10)
/** A genuine reading: not derived, not sample data. */
export const observed = (p: MetricPoint) => !p.isDerived && !p.sourceName?.toLowerCase().includes('(sample)')

/** One point per day: a real reading beats a derived or sample one; otherwise the latest wins. */
export function daily(points: MetricPoint[]): { date: string; value: number }[] {
  const byDay = new Map<string, MetricPoint>()
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    const prev = byDay.get(day(p))
    if (!prev || (observed(p) && !observed(prev)) || (observed(p) === observed(prev) && p.recordedAt >= prev.recordedAt)) byDay.set(day(p), p)
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, p]) => ({ date, value: p.value }))
}

/**
 * A reading fit to stand in for a missing one. Mirrors the server's
 * DailyMetricAggregation.IsValidObserved, so the page never shows a value the
 * Today summary rejected (sample or derived data, or an out-of-range number).
 */
export function validReading(key: string, p: MetricPoint): boolean {
  if (!observed(p) || !Number.isFinite(p.value) || p.value < 0) return false
  const source = p.sourceName?.toLowerCase() ?? ''
  if (key === 'sleep_score' || key === 'resting_hr' || key === 'stress_avg') {
    if (source.includes('(imported)')) return false
    return key === 'resting_hr' ? p.value >= 20 && p.value <= 250 : p.value <= 100
  }
  return key !== 'body_battery' || p.value <= 100
}

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

/** Latest value, the average over the last `days`, and the change against the `days` before that. */
export function trend(series: { date: string; value: number }[], days: number, today: string) {
  const end = new Date(`${today}T12:00:00Z`)
  const cut = (n: number) => { const d = new Date(end); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
  const recent = series.filter(p => p.date > cut(days) && p.date <= today)
  const before = series.filter(p => p.date > cut(days * 2) && p.date <= cut(days))
  const avg = mean(recent.map(p => p.value))
  const prev = mean(before.map(p => p.value))
  const last = series.at(-1) ?? null
  return { recent, avg, change: avg != null && prev != null ? avg - prev : null, last }
}

/** Days between a YYYY-MM-DD date and today. */
export const ageDays = (date: string, today: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000)

/** "today", "yesterday", "3 days ago", or a date once it is over a fortnight old. */
export function ago(date: string, today: string) {
  const n = ageDays(date, today)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 15) return `${n} days ago`
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
