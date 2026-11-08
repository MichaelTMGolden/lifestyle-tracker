// Create or edit an hour goal: a target fed by one or more habits' logged minutes.
import { useState, type FormEvent } from 'react'
import type { Goal, GoalInput, Habit } from '../../api'
import { Button, Tabs } from '../../ui'

const counts = [{ value: 'since', label: 'From the start date' }, { value: 'all', label: 'All time' }] as const

export function GoalForm({ habits, goal, busy, onSubmit }: {
  habits: Habit[]; goal?: Goal; busy?: boolean; onSubmit: (input: GoalInput) => void
}) {
  const [name, setName] = useState(goal?.name ?? '')
  const [hours, setHours] = useState(goal ? String(Math.round(goal.targetMinutes / 60)) : '100')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [feeders, setFeeders] = useState<number[]>(goal ? goal.sources.map(s => s.habitId) : [])
  const [count, setCount] = useState<'since' | 'all'>(goal?.countAllTime ? 'all' : 'since')
  const toggle = (id: number) => setFeeders(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id])
  const targetHours = parseInt(hours, 10) || 0
  const valid = !!name.trim() && feeders.length > 0 && targetHours > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onSubmit({
      name: name.trim(), targetHours, colorHex: goal?.colorHex ?? '#b23a5b', sourceHabitIds: feeders,
      targetDate: targetDate || null,
      startDate: goal?.startDate ?? null, // keep the original start on edit
      countAllTime: count === 'all',
    })
  }

  return <form className="gl-form" onSubmit={submit}>
    <label className="gl-field"><span>Goal</span>
      <input className="gl-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 100h Guitar" required maxLength={120} />
    </label>
    <div className="gl-two">
      <label className="gl-field"><span>Target hours</span>
        <input className="gl-input" type="number" inputMode="numeric" min={1} value={hours} onChange={e => setHours(e.target.value)} />
      </label>
      <label className="gl-field"><span>By (optional)</span>
        <input className="gl-input" type="date" value={targetDate ?? ''} onChange={e => setTargetDate(e.target.value)} />
      </label>
    </div>
    <fieldset className="gl-field gl-fieldset">
      <legend>Counts time from</legend>
      <div className="gl-chips">
        {habits.map(h => <button key={h.id} type="button" className={`gl-chip${feeders.includes(h.id) ? ' gl-chip--on' : ''}`} aria-pressed={feeders.includes(h.id)} onClick={() => toggle(h.id)}>{h.name}</button>)}
      </div>
    </fieldset>
    <div className="gl-field">
      <span>Which time counts</span>
      <Tabs options={counts} value={count} onChange={setCount} label="Which time counts" />
      <small>{count === 'all' ? 'Everything ever logged for these habits.' : 'Only time logged from the goal’s start date.'}</small>
    </div>
    <Button type="submit" variant="primary" block disabled={busy || !valid}>{goal ? 'Save goal' : 'Create goal'}</Button>
  </form>
}
