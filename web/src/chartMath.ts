export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
export const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) }
export const round = (v: number, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p }
export function pearson(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 3 || ys.length !== n) return 0
  const mx = mean(xs), my = mean(ys)
  let numerator = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; numerator += a * b; dx += a * a; dy += b * b }
  const denominator = Math.sqrt(dx * dy)
  return denominator ? numerator / denominator : 0
}
export const movingAvg = (a: number[], window: number) => a.map((_, i) => mean(a.slice(Math.max(0, i - window + 1), i + 1)))
export const STATUS = { good: '#7faf93', watch: '#d8a24f', off: '#c45a68' } as const

/** Centre a single observation instead of dividing by zero. */
export const sampleX = (index: number, count: number, left: number, width: number) => left + (count <= 1 ? .5 : index / (count - 1)) * width

/** Missing values break a line; their neighbours must not imply a measured trend. */
export function seriesSegments(data: (number | null)[]) {
  const segments: { i: number; v: number }[][] = []
  let current: { i: number; v: number }[] = []
  data.forEach((value, i) => {
    if (value == null || !Number.isFinite(value)) { current = []; return }
    if (!current.length) segments.push(current)
    current.push({ i, v: value })
  })
  return segments
}
