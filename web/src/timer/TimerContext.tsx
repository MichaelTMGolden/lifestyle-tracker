import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'

// Same localStorage key/format the Habits page used, so an in-progress timer
// survives a reload. `habitName` is new (older payloads fall back to "Practice").
const TIMER_KEY = 'habit-timer'

export interface ActiveTimer { habitId: number; habitName: string; startedAt: number }

interface TimerCtx {
  timer: ActiveTimer | null
  running: boolean
  elapsedMs: number
  /** Start a timer. Enforces one at a time: an in-progress timer is logged first (lossless). */
  start: (habitId: number, habitName: string) => Promise<void>
  /** Stop the running timer, rounding elapsed → minutes and POSTing via log-time. */
  stop: () => Promise<void>
  /** Bumps whenever logged data changes (timer stop, or an explicit notifyChange). */
  dataTick: number
  /** Signal that day data changed elsewhere (e.g. a quick-added to-do) so pages can refetch. */
  notifyChange: () => void
}

const Ctx = createContext<TimerCtx | null>(null)

function readStored(): ActiveTimer | null {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Partial<ActiveTimer>
    if (typeof t?.habitId === 'number' && typeof t?.startedAt === 'number')
      return { habitId: t.habitId, habitName: t.habitName ?? 'Practice', startedAt: t.startedAt }
    return null
  } catch { return null }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timer, setTimer] = useState<ActiveTimer | null>(readStored)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [dataTick, setDataTick] = useState(0)

  const persist = useCallback((t: ActiveTimer | null) => {
    setTimer(t)
    try { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY) } catch { /* ignore */ }
  }, [])

  // Tick once a second only while a timer runs.
  useEffect(() => {
    if (!timer) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer])

  const notifyChange = useCallback(() => setDataTick((n) => n + 1), [])

  const logAndClear = useCallback(async (t: ActiveTimer) => {
    const mins = Math.round((Date.now() - t.startedAt) / 60000)
    persist(null)
    if (mins > 0) { await api.logHabitTime(t.habitId, mins); setDataTick((n) => n + 1) }
  }, [persist])

  const stop = useCallback(async () => { if (timer) await logAndClear(timer) }, [timer, logAndClear])

  const start = useCallback(async (habitId: number, habitName: string) => {
    if (timer) {
      if (timer.habitId === habitId) return // already running this one
      await logAndClear(timer)               // one at a time — bank the previous, lossless
    }
    setNowTick(Date.now())
    persist({ habitId, habitName, startedAt: Date.now() })
  }, [timer, logAndClear, persist])

  const elapsedMs = timer ? nowTick - timer.startedAt : 0

  return (
    <Ctx.Provider value={{ timer, running: !!timer, elapsedMs, start, stop, dataTick, notifyChange }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTimer(): TimerCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTimer must be used within TimerProvider')
  return c
}
