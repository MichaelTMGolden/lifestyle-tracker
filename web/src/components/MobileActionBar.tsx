import { useEffect, useState, type FormEvent } from 'react'
import { api, type Habit } from '../api'
import { useTimer } from '../timer/TimerContext'
import { useIsMobile } from '../hooks'
import { fmtElapsed, habitColor } from '../lib'

/**
 * Mobile-only sticky utility bar: a quick-add (to-do or start-a-timer via a
 * bottom sheet) and a pinned running-timer pill (glance + stop from anywhere).
 * Quiet and on-brand — not a loud FAB.
 */
export function MobileActionBar() {
  const isMobile = useIsMobile()
  const { timer, elapsedMs, start, stop, notifyChange } = useTimer()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [habits, setHabits] = useState<Habit[]>([])

  // Lazy-load the skill list the first time the sheet opens.
  useEffect(() => {
    if (open && habits.length === 0) api.habits().then(setHabits).catch(() => { /* ignore */ })
  }, [open, habits.length])

  if (!isMobile) return null

  async function addTodo(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await api.createDailyTodo(text.trim())
    setText(''); setOpen(false)
    notifyChange() // let the Today page refetch its list
  }
  async function startTimer(h: Habit) { await start(h.id, h.name); setOpen(false) }

  const timed = habits.filter((h) => h.tracksTime)
  const pickable = timed.length ? timed : habits

  return (
    <>
      {open && <div className="sheet-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className="sheet" role="dialog" aria-label="Quick add">
          <div className="sheet-grip" aria-hidden />
          <div className="sheet-sec">
            <div className="sheet-label">Add to-do</div>
            <form className="daily-add" onSubmit={addTodo}>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input value={text} placeholder="Something to do today…" onChange={(e) => setText(e.target.value)} autoFocus />
              <button className="btn" type="submit">Add</button>
            </form>
          </div>
          <div className="sheet-sec">
            <div className="sheet-label">Start a timer</div>
            <div className="sheet-skills">
              {pickable.map((h, i) => (
                <button key={h.id} className="sheet-skill" style={{ ['--skill' as string]: habitColor(h.name, i) }} onClick={() => startTimer(h)}>
                  {h.name}
                </button>
              ))}
              {pickable.length === 0 && <span className="muted">No skills yet.</span>}
            </div>
          </div>
        </div>
      )}

      <div className="action-bar">
        <button className="ab-add" onClick={() => setOpen(true)} aria-label="Quick add">
          <span className="ab-plus" aria-hidden>＋</span> Quick add
        </button>
        {timer && (
          <div className="ab-pill">
            <span className="ab-dot" aria-hidden />
            <span className="ab-pill-name">{timer.habitName}</span>
            <span className="ab-pill-time">{fmtElapsed(elapsedMs)}</span>
            <button className="ab-stop" onClick={() => stop()}>Stop</button>
          </div>
        )}
      </div>
    </>
  )
}
