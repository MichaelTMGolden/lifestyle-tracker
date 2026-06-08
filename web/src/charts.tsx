import { useState, type MouseEvent } from 'react'
import { fmtDay } from './lib'

// ---- shared stats ----
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
export const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) }
export const round = (v: number, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p }
export function pearson(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 3) return 0
  const mx = mean(xs), my = mean(ys)
  let nu = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; nu += a * b; dx += a * a; dy += b * b }
  const d = Math.sqrt(dx * dy); return d ? nu / d : 0
}
export const movingAvg = (a: number[], w: number) =>
  a.map((_, i) => mean(a.slice(Math.max(0, i - w + 1), i + 1)))

export const STATUS = { good: '#7faf93', watch: '#d8a24f', off: '#c45a68' } as const
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ---- Ring (readiness) ----
export function Ring({ value, size = 132, color }: { value: number; size?: number; color: string }) {
  const r = (size - 14) / 2, c = 2 * Math.PI * r, off = c * (1 - value / 100)
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth="9" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

// ---- Sparkline with optional goal/baseline ----
export function Spark({ data, color, goal, baseline, h = 42, fill = true }: {
  data: (number | null)[]; color: string; goal?: number; baseline?: number; h?: number; fill?: boolean
}) {
  const w = 150
  const vals = data.filter((v): v is number => v != null)
  if (!vals.length) return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }} />
  let lo = Math.min(...vals, goal ?? Infinity, baseline ?? Infinity)
  let hi = Math.max(...vals, goal ?? -Infinity, baseline ?? -Infinity)
  if (lo === hi) { lo -= 1; hi += 1 }
  const n = data.length, pad = 3
  const X = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad)
  const Y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad)
  let dpath = '', started = false
  data.forEach((v, i) => { if (v == null) { started = false; return } dpath += `${started ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)} `; started = true })
  const first = data.findIndex((v) => v != null)
  const area = fill && first >= 0
    ? `M${X(first)},${h - pad} ` + data.map((v, i) => v == null ? '' : `L${X(i).toFixed(1)},${Y(v).toFixed(1)} `).join('') + `L${X(n - 1)},${h - pad} Z`
    : ''
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }} preserveAspectRatio="none">
      {fill && <path d={area} fill={color} opacity=".10" />}
      {goal != null && <line x1={pad} x2={w - pad} y1={Y(goal)} y2={Y(goal)} stroke={STATUS.good} strokeWidth="1" strokeDasharray="3 3" opacity=".7" />}
      {baseline != null && <line x1={pad} x2={w - pad} y1={Y(baseline)} y2={Y(baseline)} stroke={color} strokeWidth="1" strokeDasharray="2 3" opacity=".5" />}
      <path d={dpath} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

interface Anno { label: string }

// Placeholder shown when a series has no data (e.g. before Garmin is imported),
// so empty arrays never crash the axis/tooltip code that indexes by position.
export function EmptyChart({ height = 200 }: { height?: number }) {
  return (
    <div className="muted" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      No data yet
    </div>
  )
}

// ---- Line chart with baseline / band / annotations + tooltip ----
export function AnnotatedLine({ dates, data, color, band, baseline, annotations = {}, height = 210, unit = '' }: {
  dates: Date[]; data: (number | null)[]; color: string; band?: [number, number]; baseline?: number
  annotations?: Record<number, Anno>; height?: number; unit?: string
}) {
  const [tip, setTip] = useState<{ i: number; px: number; py: number } | null>(null)
  if (data.length === 0 || dates.length === 0) return <EmptyChart height={height} />
  const W = 720, H = height, P = { l: 34, r: 14, t: 14, b: 24 }
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null)
  const vals = pts.map((p) => p.v)
  let lo = Math.min(...vals, band ? band[0] : Infinity, baseline ?? Infinity)
  let hi = Math.max(...vals, band ? band[1] : -Infinity, baseline ?? -Infinity)
  const pv = (hi - lo) * 0.1 || 1; lo -= pv; hi += pv
  const X = (i: number) => P.l + (i / (data.length - 1)) * (W - P.l - P.r)
  const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')
  const ticks = 4
  function move(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const rx = (e.clientX - r.left) / r.width * W
    let i = Math.round((rx - P.l) / (W - P.l - P.r) * (data.length - 1))
    i = clampN(i, 0, data.length - 1); if (data[i] == null) return
    setTip({ i, px: e.clientX - r.left, py: e.clientY - r.top })
  }
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={move}>
        {[...Array(ticks + 1)].map((_, k) => { const v = lo + (hi - lo) * k / ticks; const y = Y(v); return <g key={k}><line className="gridline" x1={P.l} x2={W - P.r} y1={y} y2={y} /><text className="axis" x={P.l - 6} y={y + 3} textAnchor="end">{Math.round(v)}</text></g> })}
        {band && <rect x={P.l} y={Y(band[1])} width={W - P.l - P.r} height={Y(band[0]) - Y(band[1])} fill={color} opacity=".09" />}
        {baseline != null && <line x1={P.l} x2={W - P.r} y1={Y(baseline)} y2={Y(baseline)} stroke={color} strokeDasharray="4 4" opacity=".55" />}
        {baseline != null && <text className="axis" x={W - P.r} y={Y(baseline) - 4} textAnchor="end" fill={color} opacity=".8">baseline</text>}
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
        {Object.keys(annotations).map((k) => { const i = +k; if (data[i] == null) return null; return <g key={k}><line x1={X(i)} x2={X(i)} y1={P.t} y2={H - P.b} stroke="var(--watch,#d8a24f)" strokeDasharray="2 3" opacity=".5" /><circle cx={X(i)} cy={Y(data[i] as number)} r="3.5" fill="var(--watch,#d8a24f)" /></g> })}
        {tip && <g><line x1={X(tip.i)} x2={X(tip.i)} y1={P.t} y2={H - P.b} stroke="var(--line-strong)" /><circle cx={X(tip.i)} cy={Y(data[tip.i] as number)} r="4" fill={color} /></g>}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => <text key={i} className="axis" x={X(i)} y={H - 8} textAnchor="middle">{fmtDay(dates[i].toISOString())}</text>)}
      </svg>
      {tip && <div className="tip" style={{ left: tip.px, top: tip.py }}>
        <div className="t-date">{fmtDay(dates[tip.i].toISOString())}</div>
        <div className="t-row"><b>{round(data[tip.i] as number, 1)}{unit}</b></div>
        {annotations[tip.i] && <div className="t-anno">⚑ {annotations[tip.i].label}</div>}
      </div>}
    </div>
  )
}

// ---- Stacked bars (sleep stages / stress zones) ----
export function StackedBars({ dates, data, keys, colors, height = 200, unit = 'm', maxBars = 60 }: {
  dates: Date[]; data: Record<string, number>[]; keys: string[]; colors: string[]; height?: number; unit?: string; maxBars?: number
}) {
  const [tip, setTip] = useState<{ i: number; px: number; py: number } | null>(null)
  if (data.length === 0 || dates.length === 0) return <EmptyChart height={height} />
  const slice = data.length > maxBars ? data.slice(-maxBars) : data
  const dslice = dates.length > maxBars ? dates.slice(-maxBars) : dates
  const W = 720, H = height, P = { l: 34, r: 10, t: 12, b: 22 }
  const totals = slice.map((d) => keys.reduce((s, k) => s + d[k], 0))
  const hi = Math.max(...totals) * 1.05 || 1
  const bw = (W - P.l - P.r) / slice.length
  const Y = (v: number) => P.t + (1 - v / hi) * (H - P.t - P.b)
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[0, .25, .5, .75, 1].map((f, k) => { const y = P.t + f * (H - P.t - P.b); return <g key={k}><line className="gridline" x1={P.l} x2={W - P.r} y1={y} y2={y} /><text className="axis" x={P.l - 6} y={y + 3} textAnchor="end">{Math.round(hi * (1 - f))}</text></g> })}
        {slice.map((d, i) => { let acc = 0; const x = P.l + i * bw; return <g key={i} onMouseEnter={(e) => { const r = (e.currentTarget.closest('svg') as SVGSVGElement).getBoundingClientRect(); setTip({ i, px: (x + bw / 2) / W * r.width, py: Y(totals[i]) / H * r.height }) }}>
          {keys.map((k, ki) => { const hh = (d[k] / hi) * (H - P.t - P.b); const y = Y(acc + d[k]); acc += d[k]; return <rect key={k} x={x + 0.6} y={y} width={Math.max(0.6, bw - 1.2)} height={hh} fill={colors[ki]} opacity=".88" /> })}
        </g> })}
        {[0, Math.floor(slice.length / 2), slice.length - 1].map((i) => <text key={i} className="axis" x={P.l + i * bw + bw / 2} y={H - 7} textAnchor="middle">{fmtDay(dslice[i].toISOString())}</text>)}
      </svg>
      {tip && <div className="tip" style={{ left: tip.px, top: tip.py }}>
        <div className="t-date">{fmtDay(dslice[tip.i].toISOString())}</div>
        {keys.map((k, ki) => <div className="t-row" key={k}><span style={{ width: 9, height: 9, borderRadius: 2, background: colors[ki], display: 'inline-block' }} />{k}: <b>{Math.round(slice[tip.i][k])}{unit}</b></div>)}
      </div>}
    </div>
  )
}

// ---- Scatter with fitted trend line + tooltip ----
export function Scatter({ xs, ys, xLabel, yLabel, xColor, yColor, height = 300 }: {
  xs: (number | null)[]; ys: (number | null)[]; xLabel: string; yLabel: string; xColor: string; yColor: string; height?: number
}) {
  const [tip, setTip] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const pairs: { x: number; y: number }[] = []
  for (let i = 0; i < xs.length; i++) { const a = xs[i], b = ys[i]; if (a != null && b != null) pairs.push({ x: a, y: b }) }
  const W = 560, H = height, P = { l: 46, r: 16, t: 14, b: 38 }
  if (pairs.length < 3) return <div className="muted">Not enough overlapping data.</div>
  const xv = pairs.map((p) => p.x), yv = pairs.map((p) => p.y)
  let xlo = Math.min(...xv), xhi = Math.max(...xv), ylo = Math.min(...yv), yhi = Math.max(...yv)
  const xp = (xhi - xlo) * 0.08 || 1, yp = (yhi - ylo) * 0.08 || 1; xlo -= xp; xhi += xp; ylo -= yp; yhi += yp
  const X = (v: number) => P.l + (v - xlo) / (xhi - xlo) * (W - P.l - P.r)
  const Y = (v: number) => P.t + (1 - (v - ylo) / (yhi - ylo)) * (H - P.t - P.b)
  const mx = mean(xv), my = mean(yv)
  let num = 0, den = 0; for (const p of pairs) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  const slope = den ? num / den : 0, inter = my - slope * mx
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        {[0, .25, .5, .75, 1].map((f, k) => { const y = P.t + f * (H - P.t - P.b); return <line key={k} className="gridline" x1={P.l} x2={W - P.r} y1={y} y2={y} /> })}
        <line x1={X(xlo)} y1={Y(slope * xlo + inter)} x2={X(xhi)} y2={Y(slope * xhi + inter)} stroke="var(--text)" strokeWidth="1.6" strokeDasharray="5 4" opacity=".8" />
        {pairs.map((p, k) => <circle key={k} cx={X(p.x)} cy={Y(p.y)} r="3.4" fill={xColor} opacity=".6"
          onMouseEnter={(e) => { const rr = (e.currentTarget.closest('svg') as SVGSVGElement).getBoundingClientRect(); setTip({ x: p.x, y: p.y, px: X(p.x) / W * rr.width, py: Y(p.y) / H * rr.height }) }} />)}
        <text className="axis" x={(P.l + W - P.r) / 2} y={H - 6} textAnchor="middle" fill={xColor}>{xLabel}</text>
        <text className="axis" x={-(H) / 2} y={13} textAnchor="middle" transform="rotate(-90)" fill={yColor}>{yLabel}</text>
      </svg>
      {tip && <div className="tip" style={{ left: tip.px, top: tip.py }}><div className="t-row">{xLabel}: <b>{round(tip.x, 1)}</b></div><div className="t-row">{yLabel}: <b>{round(tip.y, 1)}</b></div></div>}
    </div>
  )
}
