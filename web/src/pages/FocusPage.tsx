// Focus: one timed habit full screen. A big clock, today's time and goal progress
// counting up live, the screen kept awake while it runs, and one Stop button.
// /focus alone opens the running timer, or offers Work, a dice roll (random
// habit and length) and every timed habit. A session can have a length: the
// clock counts down, then chimes, vibrates and (in the background) notifies.
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, type Goal, type Habit } from '../api'
import { habitStyle } from '../habitColor'
import { fmtElapsed, fmtHours } from '../lib'
import { useTimer } from '../timer/useTimer'
import { Button, Progress } from '../ui'
import { haptic } from '../ui/feedback'
import { ToastHostContext } from '../ui/toastContext'
import { goalForHabit } from './habits/stats'
import { useSeasons } from './habits/useSeasons'
import { splitByFocus } from '../seasons'
import { skillProgressApi } from '../skillProgressApi'
import { loadTarget, saveTarget, type Target } from './focus/alerts'
import { countdown, isWork, PRESETS, rollMinutes, rollOne, WORK } from './focus/session'
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
  const location = useLocation()
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


  // Arrived from a dice roll: start the timer once the habit is known.
  const autostart = (location.state as { autostart?: boolean } | null)?.autostart === true
  const autostarted = useRef(false)
  useEffect(() => {
    if (!autostart || autostarted.current || !habit || running) return
    autostarted.current = true
    navigate(location.pathname, { replace: true, state: null })
    void act(() => start(habit.id, habit.name))
  })

  if (id == null) {
    const live = timers[0]
    if (live) return <Navigate to={`/focus/${live.habitId}`} replace />
    return <Picker habits={habits.data} error={habits.error} onClose={close} />
  }

  if (!habit) return <div className="fx" role="dialog" aria-modal="true" aria-label="Focus">
    <div className="fx__top"><span /><Button variant="quiet" icon="close" aria-label="Close focus" onClick={close} /></div>
    <div className="fx__center">
      {habits.isPending ? <p className="fx__muted" role="status">Loading…</p>
        : habits.error ? <p className="fx__error" role="alert">Couldn't load this habit. {message(habits.error)} <Button size="sm" variant="quiet" onClick={() => void habits.refetch()}>Retry</Button></p>
        : <p className="fx__muted">This habit no longer exists. <Link to="/focus">Pick another</Link></p>}
    </div>
  </div>

  // A goal fed by several habits counts every running feeder, as Today's timer card does.
  const goal = goals.data ? goalForHabit(goals.data, habit.id) : undefined
  const goalLiveMs = goal ? timers.filter(t => goal.sources.some(s => s.habitId === t.habitId)).reduce((sum, t) => sum + elapsedMs(t.habitId), 0) : 0
  return <FocusView key={habit.id} habit={habit} running={running} ms={running ? elapsedMs(habit.id) : 0} goal={goal} goalLiveMs={goalLiveMs} busy={busy} note={note} error={error} onClose={close}
    onStart={() => { haptic(); void act(() => start(habit.id, habit.name)) }}
    onStop={() => { haptic(); const mins = Math.round(elapsedMs(habit.id) / 60000); void act(() => stop(habit.id), mins > 0 ? `${mins} min logged` : 'Stopped. Under a minute isn’t logged.') }} />
}

const MAX_MINUTES = 600

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Pick what to focus on: Work, a roll of the dice, or any timed habit. */
function Picker({ habits, error, onClose }: { habits: Habit[] | undefined; error: unknown; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { current: season } = useSeasons()
  const [roll, setRoll] = useState<{ habit: Habit; minutes: number } | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [workState, setWorkState] = useState<'idle' | 'saving' | string>('idle')
  const spin = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  useEffect(() => () => clearInterval(spin.current), [])

  const timed = (habits ?? []).filter(h => h.tracksTime)
  const work = (habits ?? []).find(h => isWork(h.name))
  const practice = timed.filter(h => !isWork(h.name))
  // The dice favours this season's focus habits; with none, any timed habit.
  const inSeason = splitByFocus(practice, season).focus
  const pool = inSeason.length ? inSeason : practice

  function rollDice() {
    if (!pool.length || spinning) return
    haptic()
    const land = () => ({ habit: rollOne(pool)!, minutes: rollMinutes() })
    if (reducedMotion()) { setRoll(land()); return }
    setSpinning(true)
    let ticks = 0
    clearInterval(spin.current)
    spin.current = setInterval(() => {
      setRoll(land())
      if (++ticks >= 12) { clearInterval(spin.current); setSpinning(false); haptic() }
    }, 70)
  }
  function go(r: { habit: Habit; minutes: number }) {
    saveTarget(r.habit.id, { minutes: r.minutes, rolled: true })
    navigate(`/focus/${r.habit.id}`, { replace: true, state: { autostart: true } })
  }
  // Work is a timed habit like any other, made on first use (5 days a week, so
  // weekends don't count as missed).
  async function openWork() {
    if (workState === 'saving') return
    try {
      setWorkState('saving')
      // Decide from the server's list, not a possibly stale or unloaded copy.
      let w = (await api.habits()).find(h => isWork(h.name))
      if (w && !w.tracksTime) await api.toggleHabitTracksTime(w.id)
      if (!w) {
        w = await api.createHabit(WORK, true)
        await skillProgressApi.cadence(w.id, 'weekly', 5).catch(() => { /* daily is fine too */ })
      }
      // Refresh either way: a stale copy could toggle tracking back off next time.
      await qc.invalidateQueries({ queryKey: ['habits'] })
      navigate(`/focus/${w.id}`, { replace: true })
    } catch (e) { setWorkState(message(e)) }
  }

  return <div className="fx" role="dialog" aria-modal="true" aria-labelledby="fx-pick">
    <div className="fx__top"><span /><Button variant="quiet" icon="close" aria-label="Close focus" onClick={onClose} /></div>
    <div className="fx__pick">
      <h1 id="fx-pick">Focus on…</h1>
      {error != null && <p className="fx__error" role="alert">Couldn't load habits. {message(error)}</p>}

      <section className="fx__dice" aria-labelledby="fx-dice-title">
        <div className="fx__dice-head">
          <h2 id="fx-dice-title">Roll the dice</h2>
          <span className="fx__muted">{season && inSeason.length ? 'From this season’s focus' : 'From your timed habits'}</span>
        </div>
        <div className={`fx__dice-face${spinning ? ' is-spinning' : ''}`} aria-live="polite" style={roll ? habitStyle(roll.habit) : undefined}>
          {roll ? <><b>{roll.habit.name}</b><span>{roll.minutes} min</span></> : <span className="fx__muted">A random habit and a random length</span>}
        </div>
        <div className="fx__row">
          <Button disabled={!pool.length || spinning} onClick={rollDice}>{roll ? 'Roll again' : '🎲 Roll'}</Button>
          {roll && !spinning && <Button variant="primary" icon="play" onClick={() => go(roll)}>Start {roll.minutes} min</Button>}
        </div>
      </section>

      <ul>
        <li>
          <button type="button" className="fx__choice fx__choice--work" onClick={() => void openWork()} disabled={!habits || workState === 'saving'}>
            <span className="fx__dot" aria-hidden="true" />Work<small>{work?.minutesToday ? `${work.minutesToday} min today` : 'Deep work sessions'}</small>
          </button>
          {!['idle', 'saving'].includes(workState) && <p className="fx__error" role="alert">{workState}</p>}
        </li>
        {practice.map(h => <li key={h.id} style={habitStyle(h)}>
          <Link replace to={`/focus/${h.id}`} className="fx__choice"><span className="fx__dot" aria-hidden="true" />{h.name}<small>{h.minutesToday ? `${h.minutesToday} min today` : ''}</small></Link>
        </li>)}
      </ul>
      {habits && practice.length === 0 && <p className="fx__muted">No other habits track time yet. Turn on “Track time” in a habit's settings.</p>}
    </div>
  </div>
}

function FocusView({ habit: h, running, ms, goal, goalLiveMs, busy, note, error, onClose, onStart, onStop }: {
  habit: Habit; running: boolean; ms: number; goal: Goal | undefined; goalLiveMs: number
  busy: boolean; note: string; error: string; onClose: () => void; onStart: () => void; onStop: () => void
}) {
  const live = ms / 60000
  const goalNow = goal ? goal.accumulatedMinutes + goalLiveMs / 60000 : 0
  const today = h.minutesToday + live
  // Optional session length: the clock counts down, then signals once.
  const [target, setTargetState] = useState<Target | null>(() => loadTarget(h.id))
  const setTarget = (t: Target | null) => { setTargetState(t); saveTarget(h.id, t) }
  const cd = target ? countdown(target.minutes, ms) : null
  // A typed length: any whole number of minutes, 1 to 10 hours.
  const custom = !!target && !target.rolled && !(PRESETS as readonly number[]).includes(target.minutes)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const draftMinutes = Number(draft)
  const validDraft = Number.isInteger(draftMinutes) && draftMinutes >= 1 && draftMinutes <= MAX_MINUTES
  const applyDraft = () => { if (!validDraft) return; setTarget({ minutes: draftMinutes, rolled: false }); setEditing(false) }
  // The chime and notification come from SessionWatcher (app-wide), so they
  // still fire with Focus closed.
  const done = running && !!cd?.over

  return <div className={`fx${running ? ' fx--running' : ''}${done ? ' fx--done' : ''}`} role="dialog" aria-modal="true" aria-labelledby="fx-name" style={habitStyle(h)}>
    <div className="fx__top">
      <Link to={`/habits/${h.id}`} className="fx__link">{h.name} page</Link>
      <Button variant="quiet" icon="close" aria-label="Close focus" onClick={onClose} />
    </div>

    <div className="fx__center">
      <h1 id="fx-name" className="fx__name">{h.name}</h1>
      <div className="fx__clock" role="timer" aria-label={running ? (cd ? `${h.name}: ${cd.over ? 'over target by' : 'left'} ${cd.text}` : `${h.name} elapsed`) : `${h.name} timer not running`}>
        {cd ? (running ? cd.text : `${target!.minutes}:00`) : fmtElapsed(ms)}
      </div>
      {cd && running && <div className="fx__track"><Progress value={Math.round(cd.fraction * 100)} max={100} label={`${Math.round(cd.fraction * 100)}% of ${target!.minutes} min`} /></div>}
      <p className="fx__muted">
        {done ? <b className="fx__done">{target!.minutes} min done · stop &amp; log, or keep going</b>
          : running ? (cd ? `${fmtElapsed(ms)} of ${target!.minutes} min · the screen stays on` : 'Running · the screen stays on')
          : 'Ready when you are'}
      </p>

      <div className="fx__lengths" role="radiogroup" aria-label="Session length">
        <button type="button" role="radio" aria-checked={!target} onClick={() => { setEditing(false); setTarget(null) }}>Open</button>
        {PRESETS.map(m => <button key={m} type="button" role="radio" aria-checked={target?.minutes === m && !target.rolled} onClick={() => { setEditing(false); setTarget({ minutes: m, rolled: false }) }}>{m}</button>)}
        <button type="button" role="radio" aria-checked={custom} aria-label={custom ? `Custom: ${target!.minutes} minutes; change` : 'Custom length'}
          onClick={() => { setDraft(custom ? String(target!.minutes) : ''); setEditing(true) }}>{custom ? `${target!.minutes}` : 'Custom'}</button>
        <button type="button" role="radio" aria-checked={!!target?.rolled} aria-label={target?.rolled ? `Rolled ${target.minutes} minutes; roll again` : 'Roll a random length'}
          onClick={() => { haptic(); setEditing(false); setTarget({ minutes: rollMinutes(), rolled: true }) }}>🎲{target?.rolled ? ` ${target.minutes}` : ''}</button>
      </div>
      {editing && <form className="fx__custom" onSubmit={e => { e.preventDefault(); applyDraft() }}>
        <label htmlFor="fx-custom-min">Minutes</label>
        <input id="fx-custom-min" type="number" inputMode="numeric" min={1} max={MAX_MINUTES} step={1} autoFocus value={draft}
          onChange={e => setDraft(e.target.value)} placeholder="e.g. 35" />
        <Button type="submit" size="sm" variant="primary" disabled={!validDraft}>Set</Button>
        <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>
      </form>}

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
        : <Button variant="primary" block icon="play" disabled={busy} onClick={onStart}>{target ? `Start ${target.minutes} min` : 'Start'}</Button>}
    </div>
  </div>
}
