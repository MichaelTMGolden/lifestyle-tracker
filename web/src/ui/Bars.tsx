// A small single-series bar chart. Tapping or hovering a bar shows its value in
// the readout line under the chart (titles alone don't show on phones).
import { useState, type CSSProperties } from 'react'

export type Bar = { key: string; label: string; value: number; readout: string }

/** `max` fixes the scale (e.g. 1 for rates); otherwise the largest bar fills the height. */
export function Bars({ bars, label, max, height = 96, color, initial }: {
  bars: Bar[]; label: string; max?: number; height?: number; color?: string
  /** Bar shown in the readout before any is picked; defaults to the last. */
  initial?: string
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const top = max ?? Math.max(1, ...bars.map(b => b.value))
  const shown = bars.find(b => b.key === (picked ?? initial)) ?? bars.at(-1)
  return <figure className="ui-bars" style={{ '--bars-h': `${height}px`, ...(color ? { '--bars-c': color } : {}) } as CSSProperties}>
    <div className="ui-bars__plot" role="group" aria-label={label}>
      {bars.map(b => <button key={b.key} type="button" className="ui-bars__bar" aria-pressed={shown?.key === b.key}
        aria-label={b.readout} onClick={() => setPicked(b.key)} onMouseEnter={() => setPicked(b.key)} onFocus={() => setPicked(b.key)}>
        <span className="ui-bars__fill" style={{ height: `${Math.max(0, Math.min(1, b.value / top)) * 100}%` }} data-zero={b.value <= 0 ? '' : undefined} />
        <span className="ui-bars__label" aria-hidden="true">{b.label}</span>
      </button>)}
    </div>
    {shown && <figcaption className="ui-bars__readout" aria-live="polite">{shown.readout}</figcaption>}
  </figure>
}
