// One box for quick capture: "guitar 30" logs time, "reading" ticks a habit,
// "guitar" starts its timer, anything else becomes a to-do. The line under the
// box always says what Enter will do.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Habit, type TodayBundle } from '../api'
import { dateKey } from '../dailyPlanning'
import { addMinutes, QUEUED, setDone } from '../offline/habitSync'
import { describe, parseQuickLog, resolveChoice, type Intent } from '../quickLog'
import { useTimer } from '../timer/useTimer'
import { Button, Icon, Sheet } from '../ui'
import { useToast } from '../ui/hooks'
import './QuickLog.css'

const OFFLINE = 'saved on this device · syncs when you are back online'
const HABITS_KEY = 'pd:quick-log-habits'
function cachedHabits(): Habit[] { try { return JSON.parse(localStorage.getItem(HABITS_KEY) || '[]') as Habit[] } catch { return [] } }
function saveHabits(h: Habit[]) { try { localStorage.setItem(HABITS_KEY, JSON.stringify(h)) } catch { /* optional */ } }

export function QuickLogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { timers, start, notifyChange } = useTimer()
  const qc = useQueryClient()
  // Start from habits already on hand (Today's cached bundle, or the last list this
  // sheet saw), so matching works offline before a fresh list arrives.
  const [habits, setHabits] = useState<Habit[]>(() => qc.getQueryData<TodayBundle>(['today-bundle', dateKey()])?.habits ?? cachedHabits())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // Fresh habit list each time the sheet opens (names, timed or not, done today).
  useEffect(() => {
    if (!open) return
    let live = true
    api.habits().then(h => { if (live) { setHabits(h); setError(null); saveHabits(h) } }, () => {
      if (!live) return
      const known = qc.getQueryData<TodayBundle>(['today-bundle', dateKey()])?.habits ?? cachedHabits()
      if (known.length) setHabits(known)
      else setError("Couldn't load your habits. You can still add a to-do.")
    })
    const focus = setTimeout(() => input.current?.focus(), 50)
    return () => { live = false; clearTimeout(focus) }
  }, [open, qc])

  const intent = useMemo(() => parseQuickLog(text, habits), [text, habits])
  const close = () => { setText(''); setError(null); onClose() }

  async function run(action: Intent<Habit>) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const day = dateKey()
      switch (action.kind) {
        case 'minutes': {
          const r = await addMinutes(action.habit, day, action.minutes)
          toast.show({ message: r === QUEUED ? `${action.habit.name} · ${action.minutes} min: ${OFFLINE}` : `${action.habit.name} · ${action.minutes} min logged` })
          break
        }
        case 'done': {
          const r = await setDone(action.habit, day, true)
          toast.show({ message: r === QUEUED ? `${action.habit.name}: ${OFFLINE}` : `${action.habit.name} done` })
          break
        }
        case 'timer':
          await start(action.habit.id, action.habit.name)
          toast.show({ message: `${action.habit.name} timer started` })
          break
        case 'todo':
          await api.createDailyTodo(action.title)
          toast.show({ message: 'Added to today' })
          break
        case 'choose':
          return
      }
      notifyChange() // Today and Habits refresh on this
      // Plan, Today and goal views read these through React Query.
      void qc.invalidateQueries({ queryKey: ['daily'] })
      void qc.invalidateQueries({ queryKey: ['today-bundle'] })
      void qc.invalidateQueries({ queryKey: ['goals'] })
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); if (intent && intent.kind !== 'choose') void run(intent) }
  const asTodo = intent && intent.kind !== 'todo' && text.trim() ? { kind: 'todo' as const, title: text.trim() } : null
  const timerShortcuts = habits.filter(h => h.tracksTime && h.showInQuickActions && !timers.some(t => t.habitId === h.id))

  return <Sheet open={open} onClose={close} title="Quick log" labelledBy="quick-log-title">
    <form className="ql" onSubmit={submit}>
      <div className="ql-box">
        <Icon name="plus" size={18} />
        <label className="ui-sr-only" htmlFor="ql-input">Log a habit or add a to-do</label>
        <input id="ql-input" ref={input} value={text} onChange={e => setText(e.target.value)} placeholder="guitar 30 · reading · buy strings" autoComplete="off" autoCapitalize="off" enterKeyHint="done" />
      </div>
      {(!intent || intent.kind === 'choose') && <p className="ql-hint">{intent ? describe(intent) : 'Type a habit and minutes (guitar 30), a habit to tick (reading), or a to-do.'}</p>}
      {error && <p className="ql-error" role="alert">{error}</p>}
      {intent?.kind === 'choose' && <div className="ql-choices">
        {intent.habits.map(h => <Button key={h.id} size="sm" disabled={busy} onClick={() => void run(resolveChoice(intent, h))}>{h.name}</Button>)}
      </div>}
      {intent && intent.kind !== 'choose' && <Button type="submit" variant="primary" block disabled={busy}>{busy ? 'Saving…' : describe(intent)}</Button>}
      {asTodo && <Button variant="quiet" block disabled={busy} onClick={() => void run(asTodo)}>Add as a to-do instead</Button>}
    </form>
    {timerShortcuts.length > 0 && <section className="ql-timers" aria-labelledby="ql-timers-title">
      <h3 id="ql-timers-title" className="ql-label">Start a timer</h3>
      <div className="ql-choices">
        {timerShortcuts.map(h => <Button key={h.id} size="sm" icon="play" disabled={busy} onClick={() => void run({ kind: 'timer', habit: h })}>{h.name}</Button>)}
      </div>
    </section>}
  </Sheet>
}
