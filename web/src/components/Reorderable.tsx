import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  style: CSSProperties
  className: string
  'aria-label': string
  title: string
}

/** Pointer dragging and arrow-key reordering share the same persistence callback. */
export function Reorderable<T>({ items, getId, onReorder, renderRow }: {
  items: T[]
  getId: (t: T) => number
  onReorder: (orderedIds: number[]) => void
  renderRow: (item: T, handle: DragHandleProps, dragging: boolean) => ReactNode
}) {
  const [work, setWork] = useState<T[] | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rows = useRef(new Map<number, HTMLElement>())
  const latestItems = useRef(items)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => { latestItems.current = items }, [items])
  useEffect(() => () => { cleanup.current?.() }, [])
  const display = work ?? items

  function keyboardMove(id: number, event: React.KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || dragId !== null) return
    event.preventDefault()
    const from = items.findIndex(item => getId(item) === id)
    if (from < 0) return
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)))
    if (from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onReorder(next.map(getId))
    setAnnouncement(`Moved item to position ${to + 1} of ${items.length}.`)
  }

  function startDrag(id: number, event: React.PointerEvent) {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    cleanup.current?.()
    const initial = [...items]
    const pointerId = event.pointerId
    let working = initial
    setWork(initial)
    setDragId(id)
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const current = working
      const dragged = current.find(item => getId(item) === id)
      if (!dragged) return
      const others = current.filter(item => getId(item) !== id)
      let destination = others.length
      for (let index = 0; index < others.length; index++) {
        const element = rows.current.get(getId(others[index]))
        if (!element) continue
        const rect = element.getBoundingClientRect()
        if (ev.clientY < rect.top + rect.height / 2) { destination = index; break }
      }
      const next = [...others]
      next.splice(destination, 0, dragged)
      if (next.some((item, index) => getId(item) !== getId(current[index]))) {
        working = next
        setWork(next)
      }
    }
    const removeListeners = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape)
      cleanup.current = null
    }
    const cancel = () => { removeListeners(); setWork(null); setDragId(null); setAnnouncement('Reordering cancelled.') }
    const pointerCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) cancel() }
    const escape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); cancel() } }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      removeListeners()
      const currentIds = latestItems.current.map(getId)
      const currentSet = new Set(currentIds)
      const ordered = working.map(getId).filter(itemId => currentSet.has(itemId))
      // A background refresh may add or remove rows while a pointer is held.
      const orderedSet = new Set(ordered)
      ordered.push(...currentIds.filter(itemId => !orderedSet.has(itemId)))
      setWork(null); setDragId(null)
      if (ordered.some((itemId, index) => itemId !== currentIds[index])) {
        onReorder(ordered)
        setAnnouncement(`Moved item to position ${ordered.indexOf(id) + 1} of ${ordered.length}.`)
      }
    }
    cleanup.current = removeListeners
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape)
  }

  return <>
    <span className="ux-sr-only" role="status" aria-live="polite">{announcement}</span>
    {display.map((item, index) => <ReorderableRow key={getId(item)} id={getId(item)} item={item} index={index} count={display.length} dragging={dragId === getId(item)}
      onStart={startDrag} onKeyMove={keyboardMove} renderRow={renderRow}
      register={(id, element) => { if (element) rows.current.set(id, element); else rows.current.delete(id) }} />)}
  </>
}

function ReorderableRow<T>({ id, item, index, count, dragging, onStart, onKeyMove, renderRow, register }: {
  id: number; item: T; index: number; count: number; dragging: boolean
  onStart: (id: number, event: React.PointerEvent) => void
  onKeyMove: (id: number, event: React.KeyboardEvent) => void
  register: (id: number, element: HTMLDivElement | null) => void
  renderRow: (item: T, handle: DragHandleProps, dragging: boolean) => ReactNode
}) {
  const handle: DragHandleProps = {
    onPointerDown: event => onStart(id, event),
    onKeyDown: event => onKeyMove(id, event),
    style: { touchAction: 'none', cursor: 'grab' },
    className: 'drag-handle',
    'aria-label': `Reorder item ${index + 1} of ${count}. Use up and down arrow keys, or drag.`,
    title: 'Drag or use arrow keys to reorder',
  }
  return <div ref={element => register(id, element)} className={dragging ? 'reorder-row dragging' : 'reorder-row'}>{renderRow(item, handle, dragging)}</div>
}

export function DragGrip(props: DragHandleProps) {
  return <button type="button" {...props}>⠿</button>
}
