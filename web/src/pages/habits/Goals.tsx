// Hour goals: progress fed by habits' logged minutes. Completed goals retire to a list.
import { useState } from 'react'
import { api, type Goal, type GoalInput, type Habit } from '../../api'
import { Collapsible } from '../../components/Collapsible'
import { daysBetween, fmtDate, fmtDaySpan, fmtHours, fmtMonthYear } from '../../lib'
import { Button, Card, Pill, Progress, SectionHead, Sheet } from '../../ui'
import { GoalForm } from './GoalForm'
import { goalPace } from './stats'

export function GoalsSection({ goals, habits, onChanged }: { goals: Goal[]; habits: Habit[]; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const active = goals.filter(g => !g.archived)
  const retired = goals.filter(g => g.archived)

  async function run(work: Promise<unknown>) { await work; setEditing(null); await onChanged() }
  const create = (input: GoalInput) => run(api.createGoal(input))
  const save = (id: number, input: GoalInput) => run(api.updateGoal(id, input))
  const remove = (id: number) => { if (confirm('Delete this goal? The habits and their logs are untouched.')) void run(api.deleteGoal(id)) }

  return <section className="hb-goals" aria-labelledby="hb-goals-title">
    <SectionHead id="hb-goals-title" title="Goals"
      aside={<Button size="sm" variant="quiet" icon="plus" onClick={() => setEditing('new')}>New goal</Button>} />
    <div className="hb-goals__grid">
      {active.map(g => <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g.id)} onDelete={() => remove(g.id)}
        onRetire={() => void run(api.archiveGoal(g.id))} />)}
      {active.length === 0 && <p className="hb-hint">No goals yet. A goal rolls practice minutes from one or more habits into an hour target.</p>}
    </div>
    <Sheet open={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New goal' : 'Edit goal'} labelledBy="hb-goal-sheet">
      {editing != null && <GoalForm key={String(editing)} habits={habits} goal={editing === 'new' ? undefined : goals.find(g => g.id === editing)}
        onSubmit={input => void (editing === 'new' ? create(input) : save(editing, input))} />}
    </Sheet>
    {retired.length > 0 && <Collapsible title={`Completed (${retired.length})`} storageKey="pd:goals-completed">
      <ul className="hb-retired">
        {retired.map(g => <li key={g.id}>
          <span className="hb-retired__name">{g.name}</span>
          <span className="hb-hint">{fmtHours(g.targetMinutes)}{g.completedOn ? ` · ${fmtDate(g.completedOn)}` : ''}</span>
          <Button size="sm" variant="quiet" onClick={() => void run(api.unarchiveGoal(g.id))}>Restore</Button>
          <Button size="sm" variant="quiet" className="hb-danger" icon="close" aria-label={`Delete ${g.name}`} onClick={() => remove(g.id)} />
        </li>)}
      </ul>
    </Collapsible>}
  </section>
}

function GoalCard({ goal: g, onEdit, onDelete, onRetire }: { goal: Goal; onEdit: () => void; onDelete: () => void; onRetire: () => void }) {
  const pace = goalPace(g)
  const done = g.state === 'complete'
  const pct = done ? 100 : Math.round(g.progress * 100)
  const eta = done
    ? g.completedOn ? `Completed ${fmtDate(g.completedOn)}${g.startDate ? ` in ${fmtDaySpan(Math.max(1, daysBetween(g.startDate, g.completedOn)))}` : ''}` : 'Complete'
    : g.state === 'stalled' ? 'No recent practice'
    : g.projectedDate ? `About ${fmtMonthYear(g.projectedDate)} at your 4-week pace`
    : 'No recent pace to project from'

  return <Card title={g.name} tone={done ? 'accent' : undefined}
    aside={pace && <Pill tone={pace.tone}>{pace.text}</Pill>}>
    <div className="hb-goal__figures">
      <span className="hb-goal__value">{fmtHours(done ? g.targetMinutes : g.accumulatedMinutes)}</span>
      <span className="hb-hint">of {fmtHours(g.targetMinutes)} · {pct}%</span>
    </div>
    <Progress value={pct} max={100} label={`${g.name}: ${pct}%`} />
    <p className="hb-hint">
      {!done && `${fmtHours(g.remainingMinutes)} to go · `}{eta}
      {g.targetDate && !done && ` · target ${fmtDate(g.targetDate)}`}
    </p>
    {g.sources.length > 0 && <div className="hb-goal__feeders">
      {g.sources.map(s => <Pill key={s.habitId}>{s.name} · {fmtHours(s.minutes)}</Pill>)}
    </div>}
    <div className="hb-goal__actions">
      {done && <Button size="sm" onClick={onRetire}>Move to Completed</Button>}
      <Button size="sm" variant="quiet" onClick={onEdit}>Edit</Button>
      <Button size="sm" variant="quiet" className="hb-danger" onClick={onDelete}>Delete</Button>
    </div>
  </Card>
}
