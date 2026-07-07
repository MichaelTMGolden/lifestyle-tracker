import { useEffect, useRef, useState } from 'react'
import { nowMinutes } from './lib'

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

/**
 * Local minutes-from-midnight that re-renders every `intervalMs` (and the moment
 * the tab regains focus), so time-based UI — the schedule "now" line, the current
 * block highlight — advances on its own without a manual refresh.
 */
export function useNowMinutes(intervalMs = 30_000): number {
  const [mins, setMins] = useState(() => nowMinutes())
  useEffect(() => {
    const tick = () => setMins(nowMinutes())
    const id = setInterval(tick, intervalMs)
    const onVis = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [intervalMs])
  return mins
}

/**
 * Calls `fn` on an interval while the tab is visible, and once immediately when
 * the tab regains focus — a lightweight poll so server-derived data (which block
 * is current, calendar events, a schedule revert) stays fresh without a refresh.
 */
export function usePoll(fn: () => void, intervalMs = 120_000): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) ref.current() }, intervalMs)
    const onVis = () => { if (!document.hidden) ref.current() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [intervalMs])
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
