import { useEffect, useState } from 'react'

/** True when the viewport is at/under `breakpoint` px. Reacts to resize/rotate. */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint}px)`
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    onChange()
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Boolean toggle persisted in localStorage under `key`. */
export function usePersistentToggle(key: string, defaultOpen = false): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => setOpen((o) => {
    const next = !o
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* ignore */ }
    return next
  })
  return [open, toggle]
}
