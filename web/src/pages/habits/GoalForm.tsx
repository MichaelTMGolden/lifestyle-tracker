// Goal create/edit form and the one-time completion celebration (carried over from v1).
import { useEffect, useState, type FormEvent } from 'react'
import type { Goal, GoalInput, Habit } from '../../api'
import { daysBetween, fmtDaySpan, fmtHours } from '../../lib'

/* ---------- Goal create/edit form ---------- */
export function GoalForm({ habits, goal, onSubmit, onCancel }: {
  habits: Habit[]
  goal?: Goal
  onSubmit: (input: GoalInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(goal?.name ?? '')
  const [hours, setHours] = useState(goal ? String(Math.round(goal.targetMinutes / 60)) : '100')
  const [color, setColor] = useState(goal?.colorHex ?? '#b23a5b')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [feeders, setFeeders] = useState<number[]>(goal ? goal.sources.map((s) => s.habitId) : [])
  const [countAllTime, setCountAllTime] = useState(goal?.countAllTime ?? false)

  const toggleFeeder = (id: number) =>
    setFeeders((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const targetHours = parseInt(hours, 10) || 0
    if (!name.trim() || feeders.length === 0 || targetHours <= 0) return
    onSubmit({
      name: name.trim(), targetHours, colorHex: color, sourceHabitIds: feeders,
      targetDate: targetDate || null,
      startDate: goal?.startDate ?? null, // preserve existing start on edit
      countAllTime,
    })
  }

  return (
    <form className="goal-form card" onSubmit={submit}>
      <div className="gf-row">
        <label className="gf-field gf-grow">
          <span>Goal name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 100h Guitar" autoFocus />
        </label>
        <label className="gf-field gf-narrow">
          <span>Target hours</span>
          <input type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className="gf-field gf-color">
          <span>Color</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="gf-row">
        <label className="gf-field gf-grow">
          <span>Target date (optional)</span>
          <input type="date" value={targetDate ?? ''} onChange={(e) => setTargetDate(e.target.value)} />
        </label>
        {targetDate && <button type="button" className="btn btn-ghost btn-sm gf-clear" onClick={() => setTargetDate('')}>Clear date</button>}
      </div>
      <div className="gf-feeders">
        <span className="gf-label">Count</span>
        <div className="seg sm gf-count">
          <button type="button" className={countAllTime ? '' : 'on'} onClick={() => setCountAllTime(false)}>Additional</button>
          <button type="button" className={countAllTime ? 'on' : ''} onClick={() => setCountAllTime(true)}>Total</button>
        </div>
        <span className="gf-hint muted">{countAllTime
          ? 'Counts all time you’ve ever logged for the feeder skills.'
          : 'Counts only time logged from the goal’s start date onward.'}</span>
      </div>
      <div className="gf-feeders">
        <span className="gf-label">Feeder skills</span>
        <div className="gf-checks">
          {habits.map((h) => (
            <label key={h.id} className={`gf-check${feeders.includes(h.id) ? ' on' : ''}`}>
              <input type="checkbox" checked={feeders.includes(h.id)} onChange={() => toggleFeeder(h.id)} />
              {h.name}
            </label>
          ))}
        </div>
      </div>
      <div className="gf-actions">
        <button type="submit" className="btn">{goal ? 'Save' : 'Create goal'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/* ---------- Goal completion celebration ---------- */
const SHARD_COLORS = ['var(--crimson)', 'var(--watch)', '#e8dcc8']
export function GoalCelebration({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  // Auto-dismiss after a beat; click anywhere also dismisses.
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const took = goal.completedOn && goal.startDate
    ? `Achieved in ${fmtDaySpan(Math.max(1, daysBetween(goal.startDate, goal.completedOn)))}`
    : 'Target reached'

  return (
    <div className="celebrate-overlay" onClick={onDone} role="dialog" aria-label={`${goal.name} complete`}>
      {!reduced && (
        <div className="celebrate-confetti" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => (
            <span
              key={i}
              className="shard"
              style={{
                left: `${(i * 97 % 100)}%`,
                background: SHARD_COLORS[i % SHARD_COLORS.length],
                animationDelay: `${(i % 12) * 0.13}s`,
                animationDuration: `${2.4 + (i % 5) * 0.35}s`,
              }}
            />
          ))}
        </div>
      )}
      <div className="celebrate-card" style={{ ['--goal' as string]: goal.colorHex || 'var(--crimson)' }} onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-eyebrow">Goal complete</div>
        <h2 className="celebrate-name">{goal.name}</h2>
        <div className="celebrate-hours">{fmtHours(goal.targetMinutes)}</div>
        <p className="celebrate-sub">{took}</p>
        <button className="btn" onClick={onDone}>Mark it done</button>
      </div>
    </div>
  )
}
