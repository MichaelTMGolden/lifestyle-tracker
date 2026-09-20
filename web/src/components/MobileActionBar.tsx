import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type Habit } from '../api'
import { useTimer } from '../timer/useTimer'
import { useIsMobile } from '../hooks'
import { fmtElapsed, habitColor } from '../lib'
import '../dailyPlanning.css'

/**
 * Mobile-only sticky utility bar: a quick-add (to-do or start-a-timer via a
 * bottom sheet) and a pinned running-timer pill (glance + stop from anywhere).
 * Quiet and on-brand — not a loud FAB.
 */
export function MobileActionBar() {
  const isMobile = useIsMobile()
  const { timers, elapsedMs, start, stop, notifyChange } = useTimer()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [habits, setHabits] = useState<Habit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  // Lazy-load the skill list the first time the sheet opens.
  useEffect(() => {
    if (open && habits.length === 0) api.habits().then(setHabits).catch(() => setError('Could not load your practice shortcuts. Close and reopen to retry.'))
  }, [open, habits.length])

  useEffect(() => {
    if (open && isMobile) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open, isMobile])

  if (!isMobile) return null

  async function addTodo(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true); setError(null)
    try {
      await api.createDailyTodo(text.trim())
      setText(''); setOpen(false)
      notifyChange()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add your to-do. Try again.') }
    finally { setBusy(false) }
  }
  async function startTimer(h: Habit) {
    if (busy) return
    setBusy(true); setError(null)
    try { await start(h.id, h.name); setOpen(false) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start practice. Try again.') }
    finally { setBusy(false) }
  }
  async function stopTimer(id: number) {
    try { await stop(id); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not stop practice. Try again.'); setOpen(true) }
  }

  const quick = habits.filter((h) => h.showInQuickActions)
  const timed = quick.filter((h) => h.tracksTime)
  const pickable = timed.filter(h => !timers.some(timer => timer.habitId === h.id))

  return (
    <>
        <dialog ref={dialog} className="sheet quick-add-dialog" aria-label="Quick add" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false) }}>
          <div className="sheet-grip" aria-hidden />
          <button className="btn btn-sm sheet-close" type="button" onClick={() => setOpen(false)}>Close</button>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sheet-sec">
            <div className="sheet-label">Add to-do</div>
            <form className="daily-add" onSubmit={addTodo}>
              <input aria-label="New to-do for today" value={text} placeholder="Something to do today…" onChange={(e) => setText(e.target.value)} autoFocus />
              <button className="btn" type="submit" disabled={busy || !text.trim()}>Add</button>
            </form>
          </div>
          <div className="sheet-sec">
            <div className="sheet-label">Start a timer</div>
            <div className="sheet-skills">
              {pickable.map((h, i) => (
                <button key={h.id} className="sheet-skill" disabled={busy} style={{ ['--skill' as string]: habitColor(h.name, i) }} onClick={() => startTimer(h)}>
                  {h.name}
                </button>
              ))}
              {pickable.length === 0 && <span className="muted">No available timer shortcuts. Pin a timed habit on the Habits page.</span>}
            </div>
          </div>
        </dialog>

      <div className="action-bar">
        <button className="ab-add" onClick={() => { setError(null); setOpen(true) }} aria-label="Quick add" aria-haspopup="dialog">
          <span className="ab-plus" aria-hidden>＋</span> Quick add
        </button>
        {timers.length > 0 && (
          <div className="ab-pills">
            {timers.map((t) => (
              <div key={t.habitId} className="ab-pill">
                <span className="ab-dot" aria-hidden />
                <span className="ab-pill-name">{t.habitName}</span>
                <span className="ab-pill-time">{fmtElapsed(elapsedMs(t.habitId))}</span>
                <button className="ab-stop" onClick={() => stopTimer(t.habitId)} aria-label={`Stop and log ${t.habitName}`}>Stop</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
