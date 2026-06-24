import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// Props to spread onto whatever element should act as the drag grip. Dragging
// only starts from the handle, so checkboxes / buttons in the row keep working.
export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void
  style: CSSProperties
  className: string
  'aria-label': string
}

/**
 * A small dependency-free sortable list driven by Pointer Events, so it works
 * with both mouse and touch (native HTML5 drag does not fire on touch). While a
 * drag is in progress we reorder a local working copy live; on release we hand
 * the parent the new id order to persist. `touch-action: none` on the handle
 * stops the page scrolling mid-drag.
 */
export function Reorderable<T>({ items, getId, onReorder, renderRow }: {
  items: T[]
  getId: (t: T) => number
  onReorder: (orderedIds: number[]) => void
  renderRow: (item: T, handle: DragHandleProps, dragging: boolean) => ReactNode
}) {
  // `work` is non-null only during a drag — otherwise we render straight from props.
  const [work, setWork] = useState<T[] | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const rows = useRef(new Map<number, HTMLElement>())
  const workRef = useRef<T[]>(items)

  const display = work ?? items

  function startDrag(id: number, e: React.PointerEvent) {
    e.preventDefault()
    workRef.current = [...items]
    setWork(workRef.current)
    setDragId(id)

    const move = (ev: PointerEvent) => {
      const cur = workRef.current
      const dragged = cur.find((t) => getId(t) === id)
      if (!dragged) return
      const others = cur.filter((t) => getId(t) !== id)
      let to = others.length
      for (let i = 0; i < others.length; i++) {
        const el = rows.current.get(getId(others[i]))
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) { to = i; break }
      }
      const next = [...others]
      next.splice(to, 0, dragged)
      if (next.some((t, i) => getId(t) !== getId(cur[i]))) {
        workRef.current = next
        setWork(next)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const ordered = workRef.current.map(getId)
      setWork(null)
      setDragId(null)
      // Only persist if the order actually changed.
      if (ordered.some((x, i) => x !== getId(items[i]))) onReorder(ordered)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Safety net: drop listeners if unmounted mid-drag.
  useEffect(() => () => { setWork(null); setDragId(null) }, [])

  return (
    <>
      {display.map((item) => {
        const id = getId(item)
        const handle: DragHandleProps = {
          onPointerDown: (e) => startDrag(id, e),
          style: { touchAction: 'none', cursor: 'grab' },
          className: 'drag-handle',
          'aria-label': 'Drag to reorder',
        }
        return (
          <div
            key={id}
            ref={(el) => { if (el) rows.current.set(id, el); else rows.current.delete(id) }}
            className={dragId === id ? 'reorder-row dragging' : 'reorder-row'}
          >
            {renderRow(item, handle, dragId === id)}
          </div>
        )
      })}
    </>
  )
}

/** The default grip glyph — spread the handle props onto it. */
export function DragGrip(props: DragHandleProps) {
  return <span {...props}>⠿</span>
}
