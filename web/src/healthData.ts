import type { MetricPoint } from './api'

// Garmin day summaries and materialized food totals carry their calendar date in UTC.
export const metricDate = (point: MetricPoint) => point.recordedAt.slice(0, 10)
export function dailyPoints(points: MetricPoint[]): MetricPoint[] {
  const days = new Map<string, MetricPoint>()
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue
    const key = metricDate(point)
    const existing = days.get(key)
    if (!existing || (isObserved(point) && !isObserved(existing)) ||
      (isObserved(point) === isObserved(existing) && point.recordedAt >= existing.recordedAt)) days.set(key, point)
  }
  return [...days.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

export function rangePoints(points: MetricPoint[], days: number, today: string): MetricPoint[] {
  const start = new Date(`${today}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const first = start.toISOString().slice(0, 10)
  return dailyPoints(points).filter(point => metricDate(point) >= first && metricDate(point) <= today)
}

export const isObserved = (point: MetricPoint) => !point.isDerived && !point.sourceName?.toLowerCase().includes('(sample)')

export function alignPairs(a: MetricPoint[], b: MetricPoint[]) {
  const right = new Map(dailyPoints(b.filter(isObserved)).map(point => [metricDate(point), point.value]))
  const xs: number[] = [], ys: number[] = []
  for (const point of dailyPoints(a.filter(isObserved))) {
    const value = right.get(metricDate(point))
    if (value !== undefined) { xs.push(point.value); ys.push(value) }
  }
  return { xs, ys }
}

export function matchedCalories(intake: MetricPoint[], active: MetricPoint[], restingEstimate: number) {
  const valid = (point: MetricPoint) => isObserved(point) && point.value >= 0
  const activity = new Map(dailyPoints(active.filter(valid)).map(point => [metricDate(point), point.value]))
  return dailyPoints(intake.filter(valid)).flatMap(point => {
    const value = activity.get(metricDate(point))
    return value === undefined ? [] : [{ date: metricDate(point), intake: point.value, output: restingEstimate + value, net: point.value - restingEstimate - value }]
  })
}

export function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length < 4 || xs.length !== ys.length) return null
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length
  const dx = xs.map(x => x - meanX), dy = ys.map(y => y - meanY)
  const denominator = Math.sqrt(dx.reduce((s, x) => s + x * x, 0) * dy.reduce((s, y) => s + y * y, 0))
  return denominator > 0 ? dx.reduce((sum, x, i) => sum + x * dy[i], 0) / denominator : null
}
