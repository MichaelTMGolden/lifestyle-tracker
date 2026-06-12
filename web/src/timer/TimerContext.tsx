import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'

// Multiple timers can run at once — one per habit. Persisted as an array so any
// in-progress timers survive a reload. Older single-timer payloads are migrated.
const TIMERS_KEY = 'habit-timers'
const LEGACY_KEY = 'habit-timer'

export interface ActiveTimer { habitId: number; habitName: string; startedAt: number }

interface TimerCtx {
  timers: ActiveTimer[]
  /** Any timer running at all. */
  running: boolean
  isRunning: (habitId: number) => boolean
  /** Live elapsed ms for a habit's timer (0 if it isn't running). */
  elapsedMs: (habitId: number) => number
  /** Start a timer for a habit. No-op if one is already running for it. */
  start: (habitId: number, habitName: string) => Promise<void>
  /** Stop one habit's timer, rounding elapsed → minutes and POSTing via log-time. */
  stop: (habitId: number) => Promise<void>
  /** Stop and log every running timer. */
  stopAll: () => Promise<void>
  /** Bumps whenever logged data changes (timer stop, or an explicit notifyChange). */
  dataTick: number
  /** Signal that day data changed elsewhere (e.g. a quick-added to-do) so pages can refetch. */
  notifyChange: () => void
}

const Ctx = createContext<TimerCtx | null>(null)

const isValid = (t: Partial<ActiveTimer> | null): t is ActiveTimer =>
  !!t && typeof t.habitId === 'number' && typeof t.startedAt === 'number'
const norm = (t: ActiveTimer): ActiveTimer => ({ habitId: t.habitId, habitName: t.habitName ?? 'Practice', startedAt: t.startedAt })

function readStored(): ActiveTimer[] {
  try {
    const raw = localStorage.getItem(TIMERS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(isValid).map(norm)
    }
    // Migrate a legacy single timer into the array form.
    const old = localStorage.getItem(LEGACY_KEY)
    if (old) {
      const t = JSON.parse(old) as Partial<ActiveTimer>
      localStorage.removeItem(LEGACY_KEY)
      if (isValid(t)) return [norm(t)]
    }
    return []
  } catch { return [] }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<ActiveTimer[]>(readStored)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [dataTick, setDataTick] = useState(0)

  // Apply an update to the timer list and mirror it to localStorage in one step.
  const persist = useCallback((update: (cur: ActiveTimer[]) => ActiveTimer[]) => {
    setTimers((cur) => {
      const next = update(cur)
      try { next.length ? localStorage.setItem(TIMERS_KEY, JSON.stringify(next)) : localStorage.removeItem(TIMERS_KEY) } catch { /* ignore */ }
      return next
    })
  }, [])

  // Tick once a second only while at least one timer runs.
  useEffect(() => {
    if (timers.length === 0) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timers.length])

  const notifyChange = useCallback(() => setDataTick((n) => n + 1), [])

  const start = useCallback(async (habitId: number, habitName: string) => {
    setNowTick(Date.now())
    persist((cur) => (cur.some((t) => t.habitId === habitId) ? cur : [...cur, { habitId, habitName, startedAt: Date.now() }]))
  }, [persist])

  const stop = useCallback(async (habitId: number) => {
    const t = timers.find((x) => x.habitId === habitId)
    persist((cur) => cur.filter((x) => x.habitId !== habitId))
    if (t) {
      const mins = Math.round((Date.now() - t.startedAt) / 60000)
      if (mins > 0) { await api.logHabitTime(t.habitId, mins); setDataTick((n) => n + 1) }
    }
  }, [timers, persist])

  const stopAll = useCallback(async () => {
    const cur = timers
    persist(() => [])
    let logged = false
    for (const t of cur) {
      const mins = Math.round((Date.now() - t.startedAt) / 60000)
      if (mins > 0) { await api.logHabitTime(t.habitId, mins); logged = true }
    }
    if (logged) setDataTick((n) => n + 1)
  }, [timers, persist])

  const isRunning = useCallback((habitId: number) => timers.some((t) => t.habitId === habitId), [timers])
  const elapsedMs = useCallback((habitId: number) => {
    const t = timers.find((x) => x.habitId === habitId)
    return t ? nowTick - t.startedAt : 0
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
