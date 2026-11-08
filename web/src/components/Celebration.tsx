// A one-time "you did it" moment for a finished goal or challenge. Dismisses
// itself after a few seconds; respects reduced motion. It opens as a modal
// dialog so it stacks above any sheet already open instead of hiding behind it.
import { useEffect, useRef } from 'react'
import { Button } from '../ui'
import './Celebration.css'

export function Celebration({ eyebrow, title, figure, note, onDone }: {
  eyebrow: string; title: string; figure: string; note: string; onDone: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal() }, [])
  useEffect(() => { const t = setTimeout(onDone, 4500); return () => clearTimeout(t) }, [onDone])
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return <dialog ref={ref} className="cel" onClick={onDone} onCancel={e => { e.preventDefault(); onDone() }} aria-label={`${title}: ${eyebrow}`}>
    {!reduced && <div className="cel__sparks" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => <span key={i} style={{ left: `${(i * 97) % 100}%`, animationDelay: `${(i % 12) * 0.12}s`, animationDuration: `${2.2 + (i % 5) * 0.35}s` }} />)}
    </div>}
    <div className="cel__card" onClick={e => e.stopPropagation()}>
      <span className="cel__eyebrow">{eyebrow}</span>
      <h2 className="cel__title">{title}</h2>
      <span className="cel__figure">{figure}</span>
      <p className="cel__note">{note}</p>
      <Button variant="primary" onClick={onDone}>Done</Button>
    </div>
  </dialog>
}
