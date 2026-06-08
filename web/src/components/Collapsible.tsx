import { type ReactNode } from 'react'
import { usePersistentToggle } from '../hooks'

/**
 * A card whose body collapses behind a real <button> (aria-expanded). State is
 * persisted per `storageKey` in localStorage. Collapsed by default unless
 * `defaultOpen`. Expand/collapse animation respects prefers-reduced-motion (CSS).
 */
export function Collapsible({ title, storageKey, defaultOpen = false, children }: {
  title: ReactNode
  storageKey: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, toggle] = usePersistentToggle(storageKey, defaultOpen)
  return (
    <section className="card collapsible">
      <button type="button" className="collapse-head" aria-expanded={open} onClick={toggle}>
        <span className="collapse-title">{title}</span>
        <span className="collapse-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </section>
  )
}
