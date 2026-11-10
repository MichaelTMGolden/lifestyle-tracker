// Signals the end of a timed session wherever you are in the app (or with it in
// the background): once per session, when a running timer passes the length set
// for it in Focus. A session that ended long ago while the app was closed is
// marked done quietly rather than chiming late.
import { useEffect } from 'react'
import { useTimer } from '../../timer/useTimer'
import { chime, loadTarget, sessionDone, unlockAudio } from './alerts'

const LATE_MS = 10 * 60_000
const firedKey = (habitId: number, startedAt: number) => `pd:focus-done:${habitId}:${startedAt}`
const wasFired = (k: string) => { try { return sessionStorage.getItem(k) === '1' } catch { return false } }
const markFired = (k: string) => { try { sessionStorage.setItem(k, '1') } catch { /* private mode */ } }

export function SessionWatcher() {
  const { timers, elapsedMs } = useTimer()
  // Unlock sound on the first tap (and again after the browser suspends it), so
  // the chime can play later without one.
  useEffect(() => {
    const unlock = () => unlockAudio()
    document.addEventListener('pointerdown', unlock, { passive: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [])
  // TimerProvider re-renders every second while a timer runs, so this re-checks then.
  useEffect(() => {
    for (const t of timers) {
      const target = loadTarget(t.habitId)
      if (!target) continue
      const over = elapsedMs(t.habitId) - target.minutes * 60_000
      if (over < 0) continue
      const k = firedKey(t.habitId, t.startedAt)
      if (wasFired(k)) continue
      markFired(k)
      if (over > LATE_MS) continue
      chime(); sessionDone(t.habitName, target.minutes)
    }
  })
  return null
}
