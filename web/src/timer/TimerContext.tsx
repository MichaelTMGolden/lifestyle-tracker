import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'

// Timers live on the server (one per habit), so one started on your phone shows
// up — and can be stopped — on your desktop, and vice versa. localStorage is only
// a cache for instant paint before the first fetch; the server is authoritative.
const CACHE_KEY = 'habit-timers'
const POLL_MS = 15_000

export interface ActiveTimer { habitId: number; habitName: string; startedAt: number } // startedAt = epoch ms (server clock)

interface TimerCtx {
  timers: ActiveTimer[]
  running: boolean
  isRunning: (habitId: number) => boolean
  /** Live elapsed ms for a habit's timer (0 if it isn't running). */
  elapsedMs: (habitId: number) => number
  /** Start a timer for a habit. No-op if one is already running for it. */
  start: (habitId: number, habitName: string) => Promise<void>
  /** Stop one habit's timer (from any device), logging its minutes. */
  stop: (habitId: number) => Promise<void>
  /** Stop and log every running timer. */
  stopAll: () => Promise<void>
  /** Bumps whenever logged data changes (a timer stops here or elsewhere). */
  dataTick: number
  /** Signal that day data changed elsewhere (e.g. a quick-added to-do) so pages can refetch. */
  notifyChange: () => void
}

const Ctx = createContext<TimerCtx | null>(null)

const readCache = (): ActiveTimer[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((t) => typeof t?.habitId === 'number' && typeof t?.startedAt === 'number') : []
  } catch { return [] }
}
const writeCache = (list: ActiveTimer[]) => {
  try { list.length ? localStorage.setItem(CACHE_KEY, JSON.stringify(list)) : localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<ActiveTimer[]>(readCache)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [dataTick, setDataTick] = useState(0)
  const timersRef = useRef<ActiveTimer[]>(timers)
  useEffect(() => { timersRef.current = timers }, [timers])

  const apply = useCallback((list: ActiveTimer[]) => { setTimers(list); writeCache(list) }, [])

  // Pull the authoritative timer set from the server. If a timer vanished (stopped
  // on another device), bump dataTick so pages refetch the freshly-logged minutes.
  const refresh = useCallback(async () => {
    try {
      const list = await api.activeTimers()
      const mapped = list.map((t) => ({ habitId: t.habitId, habitName: t.habitName, startedAt: t.startedAt }))
      const prev = timersRef.current
      const removed = prev.some((p) => !mapped.find((m) => m.habitId === p.habitId))
      apply(mapped)
      if (removed) setDataTick((n) => n + 1)
    } catch { /* offline — keep the cached view */ }
  }, [apply])

  useEffect(() => { refresh() }, [refresh])

  // Poll for cross-device changes, and sync immediately when the tab regains focus.
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  // Tick once a second only while at least one timer runs.
  useEffect(() => {
    if (timers.length === 0) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timers.length])

  const notifyChange = useCallback(() => setDataTick((n) => n + 1), [])

  const start = useCallback(async (habitId: number, habitName: string) => {
    if (timersRef.current.some((t) => t.habitId === habitId)) return
    setNowTick(Date.now())
    apply([...timersRef.current, { habitId, habitName, startedAt: Date.now() }]) // optimistic
    try {
      const t = await api.startTimer(habitId)
      apply(timersRef.current.map((x) => (x.habitId === habitId ? { habitId, habitName: t.habitName, startedAt: t.startedAt } : x)))
    } catch { await refresh() }
  }, [apply, refresh])

  const stop = useCallback(async (habitId: number) => {
    apply(timersRef.current.filter((t) => t.habitId !== habitId)) // optimistic
    try {
      const r = await api.stopTimer(habitId)
      if (r.minutes > 0) setDataTick((n) => n + 1)
    } catch { await refresh() }
  }, [apply, refresh])

  const stopAll = useCallback(async () => {
    for (const t of timersRef.current) await stop(t.habitId)
  }, [stop])

  const isRunning = useCallback((habitId: number) => timers.some((t) => t.habitId === habitId), [timers])
  const elapsedMs = useCallback((habitId: number) => {
    const t = timers.find((x) => x.habitId === habitId)
    return t ? Math.max(0, nowTick - t.startedAt) : 0
  }, [timers, nowTick])

  return (
    <Ctx.Provider value={{ timers, running: timers.length > 0, isRunning, elapsedMs, start, stop, stopAll, dataTick, notifyChange }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTimer(): TimerCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTimer must be used within TimerProvider')
  return c
}
