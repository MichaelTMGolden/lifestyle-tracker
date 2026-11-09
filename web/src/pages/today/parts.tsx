// Today page pieces: running timers, habit tiles, the today list and what's coming up.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type Alert, type DailyTodo, type Goal, type Habit, type Todo } from '../../api'
import { dailyPlanning, dateKey } from '../../dailyPlanning'
import type { AgendaRow } from './agenda'
import { DragGrip, Reorderable } from '../../components/Reorderable'
import { TaskPlanActions, type PlanningAction } from '../../components/DailyPlanning'
import { fmtElapsed, fmtHours, fmtMinutes } from '../../lib'
import { Button, CheckRow, Icon, Pill, Progress, Sheet } from '../../ui'
import { haptic } from '../../ui/feedback'
import { habitStyle } from '../../habitColor'

/* ---------- Running timers (hero) ---------- */
export function RunningTimers({ timers, goals, elapsedMs, onStop }: {
  timers: { habitId: number; habitName: string }[]
  goals: Goal[] | undefined
  elapsedMs: (id: number) => number
  onStop: (id: number) => void
}) {
  if (!timers.length) return null
  return <div className="td-timers">
    {timers.map(t => {
      const goal = goals?.filter(g => !g.archived && g.state !== 'complete' && g.sources.some(s => s.habitId === t.habitId))
        .sort((a, b) => a.sources.length - b.sources.length)[0]
      const ms = elapsedMs(t.habitId)
      // Saved minutes plus every running timer that feeds this goal, so cards sharing a goal agree.
      const liveMinutes = goal ? timers.filter(x => goal.sources.some(s => s.habitId === x.habitId)).reduce((sum, x) => sum + elapsedMs(x.habitId) / 60000, 0) : 0
      const total = goal ? goal.accumulatedMinutes + liveMinutes : 0
      return <section key={t.habitId} className="td-timer" aria-label={`${t.habitName} timer running`}>
        <div className="td-timer__top">
          <span className="td-timer__label"><span className="td-timer__dot" aria-hidden="true" />Running · {t.habitName}</span>
          {goal && <span className="td-timer__goal">{goal.name} · {fmtHours(Math.floor(total))} / {fmtHours(goal.targetMinutes)}</span>}
        </div>
        <div className="td-timer__main">
          <span className="td-timer__time" role="timer" aria-label={`${t.habitName} elapsed`}>{fmtElapsed(ms)}</span>
          <span className="td-timer__actions">
            <Link className="ui-btn ui-btn--ghost" to={`/focus/${t.habitId}`} aria-label={`Open ${t.habitName} in focus`}>Focus</Link>
            <Button variant="primary" onClick={() => onStop(t.habitId)} aria-label={`Stop ${t.habitName} timer and log the time`}>Stop &amp; log</Button>
          </span>
        </div>
        {goal && <Progress value={Math.min(100, Math.round((total / Math.max(1, goal.targetMinutes)) * 100))} max={100} label={`${goal.name} progress`} />}
      </section>
    })}
  </div>
}

/* ---------- Habit tiles ---------- */
export function HabitTiles({ habits, isRunning, elapsedMs, milestone, onTap, onLogPast, compact }: {
  habits: Habit[]
  /** Small chips for habits out of this season's focus; no "Log time" tile. */
  compact?: boolean
  /** The habit whose streak just reached a milestone, briefly. */
  milestone?: number | null
  isRunning: (id: number) => boolean
  elapsedMs: (id: number) => number
  onTap: (h: Habit) => void
  onLogPast?: () => void
}) {
  // The tile just ticked pops once; the class clears when the burst ends so a later tick replays it.
  const [ticked, setTicked] = useState<number | null>(null)
  const tap = (h: Habit) => {
    haptic()
    if (!h.tracksTime && !h.doneToday) setTicked(h.id)
    onTap(h)
  }
  return <div className={compact ? 'td-tiles td-tiles--compact' : 'td-tiles'}>
    {habits.map(h => {
      const running = isRunning(h.id)
      const state = running ? 'running' : h.doneToday ? 'done' : 'open'
      const meta = running ? `Running · ${Math.floor(elapsedMs(h.id) / 60000)}m`
        : h.doneToday ? (h.tracksTime && h.minutesToday > 0 ? `${h.minutesToday} min · done` : 'Done')
        : h.currentStreak > 0 ? `${h.currentStreak}-${h.cadence === 'weekly' ? 'week' : 'day'} streak`
        : 'Not yet'
      const label = running ? `Stop ${h.name} timer and log it` : h.tracksTime ? `Start ${h.name} timer` : h.doneToday ? `${h.name} done today. Undo` : `Mark ${h.name} done`
      const pop = ticked === h.id && state === 'done'
      return <button key={h.id} type="button" style={habitStyle(h)}
        onAnimationEnd={e => { if (e.animationName === 'ui-burst') setTicked(null) }}
        className={`td-tile td-tile--${state}${pop ? ' is-ticked' : ''}${milestone === h.id ? ' td-tile--milestone' : ''}`} onClick={() => tap(h)} aria-label={label}
        aria-pressed={h.tracksTime ? undefined : h.doneToday}>
        <span className="td-tile__text"><span className="td-tile__name">{h.name}</span><span className="td-tile__meta">{meta}</span></span>
        <span className="td-tile__mark" aria-hidden="true">{state === 'done' ? <Icon name="check" size={14} /> : state === 'running' ? <span className="td-tile__pulse" /> : null}</span>
      </button>
    })}
    {onLogPast && <button type="button" className="td-tile td-tile--open" onClick={onLogPast}>
      <span className="td-tile__text"><span className="td-tile__name">Log time…</span><span className="td-tile__meta">Past session</span></span>
      <span className="td-tile__mark td-tile__mark--plus" aria-hidden="true"><Icon name="plus" size={14} /></span>
    </button>}
  </div>
}

/* ---------- Log a past session ---------- */
export function LogTimeSheet({ open, habits, onClose, onLog }: {
  open: boolean; habits: Habit[]; onClose: () => void; onLog: (h: Habit, minutes: number) => Promise<void>
}) {
  const timed = habits.filter(h => h.tracksTime)
  const [habitId, setHabitId] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  // The API adds each request's minutes to the day, so a second submit would double-count.
  const [saving, setSaving] = useState(false)
  const chosen = timed.find(h => h.id === habitId) ?? timed[0]
  async function log(mins: number) {
    if (saving || !chosen || !(mins > 0)) return
    setSaving(true)
    try { await onLog(chosen, mins); setCustom(''); onClose() }
    finally { setSaving(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void log(parseInt(custom, 10)) }
  return <Sheet open={open} onClose={onClose} title="Log time" labelledBy="td-log-title">
    {timed.length === 0 ? <p className="td-hint">None of your habits track time yet. Turn on time tracking in a habit's settings.</p>
      : <div className="td-log">
        <div className="td-log__habits" role="radiogroup" aria-label="Habit">
          {timed.map(h => <button key={h.id} type="button" role="radio" aria-checked={chosen?.id === h.id}
            className={`td-chip${chosen?.id === h.id ? ' td-chip--on' : ''}`} onClick={() => setHabitId(h.id)}>{h.name}</button>)}
        </div>
        <div className="td-log__row">{[15, 30, 45, 60].map(m => <Button key={m} size="sm" disabled={saving} onClick={() => void log(m)}>+{m} min</Button>)}</div>
        <form className="td-log__row" onSubmit={submit}>
          <label className="ui-sr-only" htmlFor="td-log-mins">Minutes</label>
          <input id="td-log-mins" className="td-input" type="number" inputMode="numeric" min={1} placeholder="Minutes" value={custom} onChange={e => setCustom(e.target.value)} />
          <Button type="submit" size="sm" variant="primary" disabled={saving || !(parseInt(custom, 10) > 0)}>{saving ? 'Saving…' : 'Log'}</Button>
        </form>
        <p className="td-hint">Logged to today. Edit past days from the habit's sheet on the Habits page.</p>
      </div>}
  </Sheet>
}

/* ---------- Today list: planned tasks, then small to-dos ---------- */
export function TodayList({ planned, daily, busy, onAction, onCompleteTask, onToggleDaily, onRemoveDaily, onLaterDaily, onReorderDaily, onAdd }: {
  planned: Todo[]
  daily: DailyTodo[]
  busy: boolean
  onAction: PlanningAction
  onCompleteTask: (t: Todo) => void
  onToggleDaily: (d: DailyTodo) => void
  onRemoveDaily: (d: DailyTodo) => void
  onLaterDaily: (d: DailyTodo) => void
  onReorderDaily: (ids: number[]) => void
  onAdd: (title: string) => void
}) {
  const [text, setText] = useState('')
  const openTasks = planned.filter(t => !t.completedAt).sort((a, b) => Number(b.isPriority) - Number(a.isPriority))
  const doneTasks = planned.filter(t => t.completedAt)
  const openDaily = daily.filter(d => !d.done)
  const doneDaily = daily.filter(d => d.done)
  const add = (e: FormEvent) => { e.preventDefault(); const t = text.trim(); if (!t) return; setText(''); onAdd(t) }
  const empty = !openTasks.length && !openDaily.length

  return <div className="td-list">
    {openTasks.map(t => <div key={`t${t.id}`} className="td-row">
      <CheckRow checked={false} disabled={busy} onChange={() => onCompleteTask(t)} label={t.title}
        meta={t.isPriority ? <Pill tone="accent">Priority</Pill> : 'Task'} />
      <details className="td-row__more">
        <summary aria-label={`More for ${t.title}`}><Icon name="more" size={18} /></summary>
        <TaskPlanActions task={t} busy={busy} onAction={onAction} />
      </details>
    </div>)}
    <Reorderable items={openDaily} getId={d => d.id} onReorder={ids => onReorderDaily([...ids, ...doneDaily.map(d => d.id)])}
      renderRow={(d, handle) => <div className="td-row">
        {d.id > 0 && !busy && <DragGrip {...handle} />}
        <CheckRow checked={false} disabled={d.id < 0} onChange={() => onToggleDaily(d)} label={d.title} />
        <Button size="sm" variant="quiet" disabled={busy || d.id < 0} onClick={() => onLaterDaily(d)} aria-label={`Move ${d.title} to tomorrow`}>Tomorrow</Button>
        <Button size="sm" variant="quiet" className="td-danger" icon="close" disabled={d.id < 0} onClick={() => onRemoveDaily(d)} aria-label={`Remove ${d.title}`} />
      </div>} />
    {empty && <p className="td-hint td-empty">{doneTasks.length || doneDaily.length ? 'Everything for today is done.' : 'Nothing planned yet. Add a small thing below, or pull a task in from Coming up.'}</p>}
    <form className="td-add" onSubmit={add}>
      <Icon name="plus" size={18} />
      <label className="ui-sr-only" htmlFor="td-add">Add to today</label>
      <input id="td-add" value={text} onChange={e => setText(e.target.value)} placeholder="Add to today…" autoComplete="off" enterKeyHint="done" />
      {text.trim() && <Button type="submit" size="sm" variant="quiet">Add</Button>}
    </form>
    {(doneTasks.length > 0 || doneDaily.length > 0) && <details className="td-done">
      <summary>Done today <span>{doneTasks.length + doneDaily.length}</span></summary>
      {doneTasks.map(t => <div key={`t${t.id}`} className="td-row td-row--done">
        <CheckRow checked onChange={() => onCompleteTask(t)} label={t.title} meta="Task" />
      </div>)}
      {doneDaily.map(d => <div key={d.id} className="td-row td-row--done">
        <CheckRow checked onChange={() => onToggleDaily(d)} label={d.title} />
        <Button size="sm" variant="quiet" className="td-danger" icon="close" onClick={() => onRemoveDaily(d)} aria-label={`Remove ${d.title}`} />
      </div>)}
    </details>}
  </div>
}

/* ---------- Alerts ---------- */
export function Alerts({ alerts, onDismiss }: { alerts: Alert[]; onDismiss: (id: number) => void }) {
  if (!alerts.length) return null
  return <section className="td-alerts" aria-label="Needs attention">
    {alerts.slice(0, 3).map(a => <div key={a.id} className={`td-alert td-alert--${a.severity.toLowerCase()}`}>
      <Link to={a.subjectType === 'Metric' ? '/health' : '/habits'} className="td-alert__text"><b>{a.title}</b><span>{a.detail}</span></Link>
      <Button size="sm" variant="quiet" icon="close" aria-label={`Dismiss ${a.title}`} onClick={() => onDismiss(a.id)} />
    </div>)}
  </section>
}

/* ---------- Coming up: rest of today's schedule and tasks to pull in ---------- */
const SHOW_TASKS = 5
const fmtShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export function ComingUp({ agenda, tasks, busy, onAction }: { agenda: AgendaRow[]; tasks: Todo[]; busy: boolean; onAction: PlanningAction }) {
  const today = dateKey()
  const [all, setAll] = useState(false)
  const shown = all ? tasks : tasks.slice(0, SHOW_TASKS)
  // One line per task: tick to complete, a one-tap "Today", and the rest behind ⋯.
  const due = (t: Todo) => {
    if (!t.dueAt) return 'No due date'
    const d = t.dueAt.slice(0, 10)
    return d < today ? `Overdue · ${fmtShort(d)}` : d === today ? 'Due today' : `Due ${fmtShort(d)}`
  }
  return <div className="td-coming">
    {agenda.length > 0 && <ul className="td-agenda" aria-label="Rest of today">
      {agenda.map(r => <li key={r.key} className={r.current ? 'td-agenda--now' : undefined}>
        <span className="td-agenda__time">{r.current ? 'Now' : fmtMinutes(r.start)}</span>
        <span className="td-agenda__text"><span>{r.title}</span>{r.meta && <small>{r.meta}</small>}</span>
      </li>)}
    </ul>}
    {tasks.length > 0 && <div className="td-tasks">
      <h3 className="td-sub">Tasks you could do today</h3>
      <div className="td-list">
        {shown.map(t => <div key={t.id} className={`td-row td-row--task${t.dueAt && t.dueAt.slice(0, 10) < today ? ' td-row--overdue' : ''}`}>
          <CheckRow checked={false} disabled={busy} label={t.title} meta={due(t)}
            onChange={() => onAction(() => api.toggleTodo(t.id), 'Task done.')} />
          <Button size="sm" variant="quiet" disabled={busy} aria-label={`Do ${t.title} today`}
            onClick={() => onAction(() => dailyPlanning.plan(t.id, today, t.isPriority ?? false), 'Added to today.')}>Today</Button>
          <details className="td-row__more">
            <summary aria-label={`More for ${t.title}`}><Icon name="more" size={18} /></summary>
            <TaskPlanActions task={t} busy={busy} onAction={onAction} />
          </details>
        </div>)}
      </div>
      {tasks.length > SHOW_TASKS && <Button size="sm" variant="quiet" onClick={() => setAll(a => !a)} aria-expanded={all}>{all ? 'Show fewer' : `Show all ${tasks.length}`}</Button>}
    </div>}
    {!agenda.length && !tasks.length && <p className="td-hint">Nothing else today.</p>}
    <Link className="td-link" to="/tasks">All tasks →</Link>
  </div>
}
