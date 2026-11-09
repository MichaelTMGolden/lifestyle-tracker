// Focus: one timed habit full screen. A big clock, today's time and goal progress
// counting up live, the screen kept awake while it runs, and one Stop button.
// /focus alone opens the running timer, or lists timed habits to start one.
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, type Habit } from '../api'
import { habitStyle } from '../habitColor'
import { fmtElapsed, fmtHours } from '../lib'
import { useTimer } from '../timer/useTimer'
import { Button, Progress } from '../ui'
import { haptic } from '../ui/feedback'
import { ToastHostContext } from '../ui/toastContext'
import { goalForHabit } from './habits/stats'
import './focus.css'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

/** Keeps the screen on while `on`, re-acquiring the lock when the page comes back. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let live = true
    const take = () => {
      if (document.visibilityState !== 'visible' || lock) return
      navigator.wakeLock.request('screen').then(l => {
        if (!live) { void l.release(); return }
        lock = l; l.addEventListener('release', () => { if (lock === l) lock = null })
      }, () => { /* Not allowed (battery saver); the timer still runs. */ })
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => { live = false; document.removeEventListener('visibilitychange', take); void lock?.release() }
  }, [on])
}

/**
 * The screen is rendered into <body>: the route wrapper's entrance animation
 * would otherwise contain it. While open, the app behind it is inert (no focus
 * or taps reach it), focus moves into the screen and returns on close, and
 * toasts show inside it.
 */
function Screen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const toastHost = useContext(ToastHostContext)
  useEffect(() => {
    const root = document.getElementById('root')
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.setAttribute('inert', '')
    ref.current?.focus({ preventScroll: true })
    const unhost = ref.current && toastHost ? toastHost.register(ref.current) : undefined
    return () => { unhost?.(); root?.removeAttribute('inert'); before?.focus({ preventScroll: true }) }
  }, [toastHost])
  return createPortal(<div ref={ref} tabIndex={-1} className="fx-host">{children}</div>, document.body)
}

export default function FocusPage() {
  return <Screen><Focus /></Screen>
}

function Focus() {
  const param = useParams().id
  const id = param ? Number(param) : null
  const { timers, isRunning, elapsedMs, start, stop, dataTick } = useTimer()
  const qc = useQueryClient()
  const habits = useQuery({ queryKey: ['habits'], queryFn: api.habits })
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals })
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // A stop elsewhere logs minutes: refetch today's time and goal totals.
  useEffect(() => { if (dataTick) { void qc.invalidateQueries({ queryKey: ['habits'] }); void qc.invalidateQueries({ queryKey: ['goals'] }) } }, [dataTick, qc])

  const habit = id != null ? habits.data?.find(h => h.id === id) : undefined
  const running = id != null && isRunning(id)
  useWakeLock(running)
  useEffect(() => { if (habit) document.title = `${running ? fmtElapsed(elapsedMs(habit.id)) : 'Focus'} · ${habit.name}` })

  // Swallow a stray second tap while a start or stop is saving.
  const working = useRef(false)
  async function act(fn: () => Promise<void>, done?: string) {
    if (working.current) return
    working.current = true; setBusy(true); setError(''); setNote('')
    try { await fn(); if (done) setNote(done); await Promise.all([habits.refetch(), goals.refetch()]) }
    catch (e) { setError(message(e)) }
    finally { working.current = false; setBusy(false) }
  }

  const close = () => { if (window.history.length > 1) navigate(-1); else navigate('/') }
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  // Escape closes, unless a sheet or menu is open on top.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeRef.current() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  if (id == null) {
    const live = timers[0]
    if (live) return <Navigate to={`/focus/${live.habitId}`} replace />
    return <div className="fx" role="dialog" aria-modal="true" aria-labelledby="fx-pick">
      <div className="fx__top"><span /><Button variant="quiet" icon="close" aria-label="Close focus" onClick={close} /></div>
      <div className="fx__pick">
        <h1 id="fx-pick">Focus on…</h1>
        {habits.error && <p className="fx__error" role="alert">Couldn't load habits. {message(habits.error)}</p>}
        {habits.data && habits.data.filter(h => h.tracksTime).length === 0 && <p className="fx__muted">No habits track time yet. Turn on “Track time” in a habit's settings.</p>}
        <ul>
          {habits.data?.filter(h => h.tracksTime).map(h => <li key={h.id} style={habitStyle(h)}>
            <Link to={`/focus/${h.id}`} className="fx__choice"><span className="fx__dot" aria-hidden="true" />{h.name}<small>{h.minutesToday ? `${h.minutesToday} min today` : ''}</small></Link>
          </li>)}
        </ul>
      </div>
    </div>
  }

  if (!habit) return <div className="fx" role="dialog" aria-modal="true" aria-label="Focus">
    <div className="fx__top"><span /><Button variant="quiet" icon="close" aria-label="Close focus" onClick={close} /></div>
    <div className="fx__center">
      {habits.isPending ? <p className="fx__muted" role="status">Loading…</p>
        : habits.error ? <p className="fx__error" role="alert">Couldn't load this habit. {message(habits.error)} <Button size="sm" variant="quiet" onClick={() => void habits.refetch()}>Retry</Button></p>
        : <p className="fx__muted">This habit no longer exists. <Link to="/focus">Pick another</Link></p>}
    </div>
  </div>

  return <FocusView habit={habit} running={running} ms={running ? elapsedMs(habit.id) : 0} goals={goals.data} busy={busy} note={note} error={error} onClose={close}
    onStart={() => { haptic(); void act(() => start(habit.id, habit.name)) }}
    onStop={() => { haptic(); const mins = Math.round(elapsedMs(habit.id) / 60000); void act(() => stop(habit.id), mins > 0 ? `${mins} min logged` : 'Stopped. Under a minute isn’t logged.') }} />
}

function FocusView({ habit: h, running, ms, goals, busy, note, error, onClose, onStart, onStop }: {
  habit: Habit; running: boolean; ms: number; goals: Parameters<typeof goalForHabit>[0] | undefined
  busy: boolean; note: string; error: string; onClose: () => void; onStart: () => void; onStop: () => void
}) {
  const live = ms / 60000
  const goal = goals ? goalForHabit(goals, h.id) : undefined
  const goalNow = goal ? goal.accumulatedMinutes + live : 0
  const today = h.minutesToday + live
  return <div className={`fx${running ? ' fx--running' : ''}`} role="dialog" aria-modal="true" aria-labelledby="fx-name" style={habitStyle(h)}>
    <div className="fx__top">
      <Link to={`/habits/${h.id}`} className="fx__link">{h.name} page</Link>
      <Button variant="quiet" icon="close" aria-label="Close focus" onClick={onClose} />
    </div>

    <div className="fx__center">
      <h1 id="fx-name" className="fx__name">{h.name}</h1>
      <div className="fx__clock" role="timer" aria-label={running ? `${h.name} elapsed` : `${h.name} timer not running`}>{fmtElapsed(ms)}</div>
      <p className="fx__muted">{running ? 'Running · the screen stays on' : 'Ready when you are'}</p>

      <dl className="fx__facts">
        <div><dt>Today</dt><dd>{fmtHours(Math.floor(today))}</dd></div>
        <div><dt>All time</dt><dd>{fmtHours(Math.floor(h.totalMinutes + live))}</dd></div>
        <div><dt>Streak</dt><dd>{h.currentStreak}</dd></div>
      </dl>

      {goal && <div className="fx__goal">
        <div className="fx__goal-line"><span>{goal.name}</span><span>{fmtHours(Math.floor(goalNow))} of {fmtHours(goal.targetMinutes)}</span></div>
        <Progress value={Math.min(100, Math.round((goalNow / Math.max(1, goal.targetMinutes)) * 100))} max={100} label={`${goal.name} progress`} />
      </div>}
    </div>

    <div className="fx__bottom">
      {note && <p className="fx__muted" role="status">{note}</p>}
      {error && <p className="fx__error" role="alert">{error}</p>}
      {running
        ? <Button variant="primary" block icon="stop" disabled={busy} onClick={onStop}>Stop &amp; log</Button>
        : <Button variant="primary" block icon="play" disabled={busy} onClick={onStart}>Start</Button>}
    </div>
  </div>
}
