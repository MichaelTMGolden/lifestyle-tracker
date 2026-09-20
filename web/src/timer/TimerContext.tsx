import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { TimerContext, type ActiveTimer } from './useTimer'
import { TimerOperationGate } from './TimerOperationGate'

// Timers live on the server (one per habit), so one started on your phone shows
// up — and can be stopped — on your desktop, and vice versa. localStorage is only
// a cache for instant paint before the first fetch; the server is authoritative.
const CACHE_KEY = 'habit-timers'
const POLL_MS = 15_000

const readCache = (): ActiveTimer[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((t) => typeof t?.habitId === 'number' && typeof t?.startedAt === 'number') : []
  } catch { return [] }
}
const writeCache = (list: ActiveTimer[]) => {
  try {
    if (list.length) localStorage.setItem(CACHE_KEY, JSON.stringify(list))
    else localStorage.removeItem(CACHE_KEY)
  } catch { /* Cache is optional. */ }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<ActiveTimer[]>(readCache)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [dataTick, setDataTick] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const timersRef = useRef<ActiveTimer[]>(timers)
  const gate = useRef(new TimerOperationGate())

  const apply = useCallback((list: ActiveTimer[]) => { timersRef.current = list; setTimers(list); writeCache(list) }, [])

  // Pull the authoritative timer set from the server. If a timer vanished (stopped
  // on another device), bump dataTick so pages refetch the freshly-logged minutes.
  const refresh = useCallback(async () => {
    const token = gate.current.beginRead()
    if (!token) return
    try {
      const list = await api.activeTimers()
      if (!gate.current.canApplyRead(token)) return
      const mapped = list.map((t) => ({ habitId: t.habitId, habitName: t.habitName, startedAt: t.startedAt }))
      const prev = timersRef.current
      const removed = prev.some((p) => !mapped.find((m) => m.habitId === p.habitId))
      apply(mapped)
      if (removed) setDataTick((n) => n + 1)
    } catch { /* offline — keep the cached view */ }
  }, [apply])

  // Poll for cross-device changes, and sync immediately when the tab regains focus.
  useEffect(() => {
    // Schedule the initial external synchronization alongside polling/focus events.
    const initial = setTimeout(() => { void refresh() }, 0)
    const id = setInterval(() => { if (!document.hidden) refresh() }, POLL_MS)
    const onFocus = () => refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(initial); clearInterval(id); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  // Tick once a second only while at least one timer runs.
  useEffect(() => {
    if (timers.length === 0) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timers.length])

  const notifyChange = useCallback(() => setDataTick((n) => n + 1), [])

  const start = useCallback((habitId: number, habitName: string) => gate.current.run(habitId, async () => {
    if (timersRef.current.some((t) => t.habitId === habitId)) return
    setSaveError(null)
    setNowTick(Date.now())
    apply([...timersRef.current, { habitId, habitName, startedAt: Date.now() }]) // optimistic
    try {
      const t = await api.startTimer(habitId)
      apply([...timersRef.current.filter(x => x.habitId !== habitId), { habitId, habitName: t.habitName, startedAt: t.startedAt }])
    } catch {
      apply(timersRef.current.filter(t => t.habitId !== habitId))
      const message = `Could not confirm the ${habitName} timer started. Check your connection and try again.`
      setSaveError(message)
      throw new Error(message)
    }
  }).finally(() => { void refresh() }), [apply, refresh])

  const stop = useCallback((habitId: number) => gate.current.run(habitId, async () => {
    setSaveError(null)
    const previous = timersRef.current.find(t => t.habitId === habitId)
    apply(timersRef.current.filter((t) => t.habitId !== habitId)) // optimistic
    try {
      const r = await api.stopTimer(habitId)
      if (r.minutes > 0) setDataTick((n) => n + 1)
    } catch {
      if (previous && !timersRef.current.some(t => t.habitId === habitId)) apply([...timersRef.current, previous])
      const message = 'Could not confirm your practice was saved. Your timer will reconcile when the connection returns.'
      setSaveError(message)
      throw new Error(message)
    }
  }).finally(() => { void refresh() }), [apply, refresh])

  const stopAll = useCallback(async () => {
    const results = await Promise.allSettled(timersRef.current.map(t => stop(t.habitId)))
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }, [stop])

  const isRunning = useCallback((habitId: number) => timers.some((t) => t.habitId === habitId), [timers])
  const elapsedMs = useCallback((habitId: number) => {
    const t = timers.find((x) => x.habitId === habitId)
    return t ? Math.max(0, nowTick - t.startedAt) : 0
  }, [timers, nowTick])

  return (
    <TimerContext.Provider value={{ timers, running: timers.length > 0, isRunning, elapsedMs, start, stop, stopAll, dataTick, notifyChange }}>
      {children}
      {saveError && <div className="timer-save-error" role="alert"><span>{saveError}</span><button className="btn btn-ghost" onClick={() => setSaveError(null)}>Dismiss</button></div>}
    </TimerContext.Provider>
  )
}
