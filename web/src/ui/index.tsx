// Rite component kit. Small, unopinionated building blocks; pages compose them.
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './icons'
import type { IconName } from './iconPaths'
import './ui.css'

export { Icon } from './icons'
export { ToastProvider } from './toast'

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

/* ---------- Card ---------- */
export function Card({ title, aside, tone, flush, as: Tag = 'section', className, children, ...rest }: {
  title?: ReactNode; aside?: ReactNode; tone?: 'accent'; flush?: boolean; as?: 'section' | 'article' | 'div'
  className?: string; children?: ReactNode; 'aria-label'?: string
}) {
  return <Tag className={cx('ui-card', tone === 'accent' && 'ui-card--accent', flush && 'ui-card--flush', className)} {...rest}>
    {(title || aside) && <div className="ui-card__head">
      {title && <h2 className="ui-card__title">{title}</h2>}
      {aside && <span className="ui-card__aside">{aside}</span>}
    </div>}
    {children}
  </Tag>
}

/** A display-font section heading with an optional link or note on the right. */
export function SectionHead({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return <div className="ui-section-head"><h2 id={id}>{title}</h2>{aside && <span className="ui-section-head__aside">{aside}</span>}</div>
}

/* ---------- Stat ---------- */
export function Stat({ label, value, unit, sub, tone }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'accent'
}) {
  return <div className={cx('ui-stat', tone && `ui-stat--${tone}`)}>
    <span className="ui-stat__label">{label}</span>
    <span className="ui-stat__value">{value}{unit && <small>{unit}</small>}</span>
    {sub && <span className="ui-stat__sub">{sub}</span>}
  </div>
}

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet'; size?: 'sm'; icon?: IconName; block?: boolean
}
/** Pass `aria-label` and no children for an icon-only button. */
export function Button({ variant = 'ghost', size, icon, block, className, children, type = 'button', ...rest }: ButtonProps) {
  const iconOnly = icon && children == null
  return <button type={type} className={cx('ui-btn', `ui-btn--${variant}`, size && `ui-btn--${size}`, iconOnly && 'ui-btn--icon', block && 'ui-btn--block', className)} {...rest}>
    {icon && <Icon name={icon} />}{children}
  </button>
}

/* ---------- Pill ---------- */
export function Pill({ tone, live, icon, children }: { tone?: 'accent' | 'good' | 'warn'; live?: boolean; icon?: IconName; children: ReactNode }) {
  return <span className={cx('ui-pill', tone && `ui-pill--${tone}`, live && 'ui-pill--live')}>{icon && <Icon name={icon} filled={icon === 'flame'} />}{children}</span>
}

/* ---------- Check row ---------- */
export function CheckRow({ checked, onChange, label, meta, disabled }: {
  checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; meta?: ReactNode; disabled?: boolean
}) {
  return <label className="ui-check-row">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    <span className="ui-check-row__text"><span>{label}</span>{meta && <span className="ui-check-row__meta">{meta}</span>}</span>
  </label>
}

/* ---------- Heatmap ---------- */
export type HeatCell = { date: string; level: 0 | 1 | 2 | 3 | 4; title?: string }

/**
 * `strip`: one row, oldest on the left (the habit cards' last-N-days view).
 * `calendar`: GitHub-style weeks as columns, Monday at the top.
 */
export function Heatmap({ cells, variant = 'strip', label, today, cellSize }: {
  cells: HeatCell[]; variant?: 'strip' | 'calendar'; label: string; today?: string; cellSize?: number
}) {
  // Monday-first weekday of the first cell, so calendar rows line up.
  const pad = variant === 'calendar' && cells.length > 0 ? (new Date(`${cells[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  const style = cellSize ? { '--ui-cell': `${cellSize}px` } as CSSProperties : undefined
  // A calendar wider than its box opens on the most recent weeks. Inside a
  // dialog that is not shown yet it has no width, so wait until it is laid out.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (variant !== 'calendar' || !el) return
    const toEnd = () => { el.scrollLeft = el.scrollWidth }
    if (el.clientWidth > 0) { toEnd(); return }
    const observer = new ResizeObserver(() => { if (el.clientWidth > 0) { toEnd(); observer.disconnect() } })
    observer.observe(el)
    return () => observer.disconnect()
  }, [variant, cells.length])
  return <div ref={ref} className={cx('ui-heatmap', `ui-heatmap--${variant}`)} role="img" aria-label={label} style={style}>
    {Array.from({ length: pad }, (_, i) => <span key={`pad${i}`} className="ui-heatmap__cell" data-pad="" />)}
    {cells.map(c => <span key={c.date} className="ui-heatmap__cell" data-level={c.level || undefined} data-today={c.date === today ? '' : undefined} title={c.title} />)}
  </div>
}

/* ---------- Ring and progress ---------- */
export function Ring({ value, max, size = 56, stroke = 4, label, children }: {
  value: number; max: number; size?: number; stroke?: number; label: string; children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return <div className="ui-ring" role="img" aria-label={label} style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ui-ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
      {frac > 0 && <circle className="ui-ring__fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${frac * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
    </svg>
    <span className="ui-ring__label" aria-hidden="true">{children ?? `${value}/${max}`}</span>
  </div>
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return <div className="ui-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}><span style={{ width: `${pct}%` }} /></div>
}

/* ---------- Sheet ---------- */
/** Bottom sheet on phones, centred panel on wider screens. Escape and a tap outside close it. */
export function Sheet({ open, onClose, title, children, labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; labelledBy?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = labelledBy ?? 'ui-sheet-title'
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])
  return <dialog ref={ref} className="ui-sheet" aria-labelledby={titleId} onClose={onClose}
    onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="ui-sheet__grip" aria-hidden="true" />
    <div className="ui-sheet__head">
      <h2 className="ui-sheet__title" id={titleId}>{title}</h2>
      <Button variant="quiet" icon="close" aria-label="Close" onClick={onClose} />
    </div>
    <div className="ui-sheet__body">{children}</div>
  </dialog>
}

/* ---------- Tabs (segmented control) ---------- */
export function Tabs<T extends string>({ options, value, onChange, label }: {
  options: readonly { value: T; label: ReactNode }[]; value: T; onChange: (value: T) => void; label: string
}) {
  return <div className="ui-tabs" role="group" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>
}

/* ---------- List row ---------- */
type ListRowProps = { title: ReactNode; meta?: ReactNode; icon?: IconName; trailing?: ReactNode; current?: boolean }
export function ListRow({ title, meta, icon, trailing, current, to, onClick }: ListRowProps & { to?: string; onClick?: () => void }) {
  const inner = <>
    {icon && <span className="ui-list-row__lead"><Icon name={icon} /></span>}
    <span className="ui-list-row__text"><span className="ui-list-row__title">{title}</span>{meta && <span className="ui-list-row__meta">{meta}</span>}</span>
    {trailing !== undefined ? <span className="ui-list-row__trail">{trailing}</span> : (to || onClick) && <span className="ui-list-row__trail"><Icon name="chevron" size={18} /></span>}
  </>
  if (to) return <Link className="ui-list-row" to={to} onClick={onClick} aria-current={current ? 'page' : undefined}>{inner}</Link>
  if (onClick) return <button type="button" className="ui-list-row" onClick={onClick}>{inner}</button>
  return <div className="ui-list-row">{inner}</div>
}

/* ---------- Skeleton ---------- */
export function Skeleton({ width = '100%', height = 16, radius, lines }: { width?: number | string; height?: number; radius?: number; lines?: number }) {
  const one = (w: number | string, key?: number) => <span key={key} className="ui-skeleton" style={{ width: w, height, borderRadius: radius }} aria-hidden="true" />
  if (!lines || lines < 2) return one(width)
  return <span className="ui-skeleton-stack" aria-hidden="true">{Array.from({ length: lines }, (_, i) => one(i === lines - 1 ? '60%' : width, i))}</span>
}
