import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type DailyTodo, type Todo } from '../api'
import { dailyPlanning, dateKey, nextDateKey } from '../dailyPlanning'
import { usePersistentToggle } from '../hooks'
import '../dailyPlanning.css'

export type PlanningAction = (operation: () => Promise<unknown>, message: string) => Promise<void>

export function CarryForwardPanel({ items, busy, onAction }: { items: DailyTodo[]; busy: boolean; onAction: PlanningAction }) {
  const [open, toggle] = usePersistentToggle('planning.carry-forward.expanded', false)
  const bodyId = useId()
  if (!items.length) return null
  return <section className="card planning-carry">
    <button type="button" className="planning-carry-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
      <span className="planning-carry-count">{items.length}</span><span className="planning-carry-heading"><strong>Unfinished from earlier</strong><small>{open ? 'Choose what to keep, move or let go.' : 'Saved for you. Review when you’re ready.'}</small></span><span className="planning-carry-chevron" aria-hidden>{open ? '−' : '+'}</span>
    </button>
    {!open && <p className="planning-carry-preview">{items.slice(0, 2).map(item => item.title).join(' · ')}{items.length > 2 ? ` · +${items.length - 2} more` : ''}</p>}
    {open && <div id={bodyId} className="planning-carry-body">{items.map(item => <div className="planning-item" key={item.id}>
      <div className="planning-copy">{item.title}<small>From {new Date(`${item.date}T12:00:00`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}</small></div>
      <div className="planning-actions">
        <button className="btn btn-sm" disabled={busy} aria-label={`Keep ${item.title} for today`} onClick={() => onAction(() => dailyPlanning.carry(item.id, dateKey()), 'Added to today.')}>Today</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Keep ${item.title} for tomorrow`} onClick={() => onAction(() => dailyPlanning.carry(item.id, nextDateKey()), 'Added to tomorrow.')}>Tomorrow</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Move ${item.title} to Tasks`} onClick={() => onAction(() => dailyPlanning.promote(item.id), 'Moved to Tasks.')}>Move to Tasks</button>
        <button className="btn btn-ghost btn-sm planning-discard" disabled={busy} aria-label={`Discard ${item.title}`} onClick={() => onAction(() => api.deleteDailyTodo(item.id), 'To-do discarded.')}>Discard</button>
      </div>
    </div>)}</div>}
  </section>
}

export function TaskPlanActions({ task, busy, onAction, showComplete = false }: { task: Todo; busy: boolean; onAction: PlanningAction; showComplete?: boolean }) {
  const [rescheduling, setRescheduling] = useState(false)
  const [date, setDate] = useState(task.plannedFor ?? dateKey())
  const inputId = useId()
  const today = dateKey()
  return <div className="planning-actions">
    {showComplete && <button className="btn btn-sm" disabled={busy} onClick={() => onAction(() => api.toggleTodo(task.id), 'Task completed.')}>Complete</button>}
    {task.plannedFor !== today && <button className="btn btn-sm" disabled={busy} onClick={() => onAction(() => dailyPlanning.plan(task.id, today, task.isPriority ?? false), 'Added to today’s plan.')}>Do today</button>}
    <button className={`btn btn-ghost btn-sm${task.isPriority && task.plannedFor === today ? ' planning-priority' : ''}`} disabled={busy} aria-pressed={!!task.isPriority && task.plannedFor === today}
      onClick={() => onAction(() => dailyPlanning.plan(task.id, today, !(task.isPriority && task.plannedFor === today)), task.isPriority && task.plannedFor === today ? 'Priority unpinned.' : 'Pinned to today’s priorities.')}>
      <span aria-hidden>{task.isPriority && task.plannedFor === today ? '★' : '☆'}</span> {task.isPriority && task.plannedFor === today ? 'Unpin' : 'Pin priority'}
    </button>
    <button className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={rescheduling} aria-controls={`${inputId}-form`} onClick={() => { setDate(task.plannedFor && task.plannedFor >= today ? task.plannedFor : today); setRescheduling(!rescheduling) }}>Reschedule</button>
    {rescheduling && <form id={`${inputId}-form`} className="planning-date" onSubmit={async e => { e.preventDefault(); if (date) await onAction(() => dailyPlanning.plan(task.id, date, task.isPriority ?? false), 'Task rescheduled.') }}>
      <label htmlFor={inputId}>Plan for</label>
      <input id={inputId} type="date" min={today} required value={date} onChange={e => setDate(e.target.value)} />
      <button className="btn btn-sm" disabled={busy}>Save date</button>
      {task.plannedFor && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onAction(() => dailyPlanning.plan(task.id, null), 'Removed from daily plan.')}>Unplan</button>}
    </form>}
  </div>
}

export function TodayPriorities({ tasks, busy, onAction }: { tasks: Todo[]; busy: boolean; onAction: PlanningAction }) {
  const [chosenTask, setChosenTask] = useState('')
  const pickerId = useId()
  const planned = tasks.filter(t => !t.completedAt && t.plannedFor === dateKey()).sort((a, b) => Number(!!b.isPriority) - Number(!!a.isPriority))
  const priorities = planned.filter(t => t.isPriority)
  const otherPlanned = planned.filter(t => !t.isPriority)
  const available = tasks.filter(task => !task.completedAt && !(task.plannedFor === dateKey() && task.isPriority))
  const remaining = 3 - priorities.length
  const renderPriority = (task: Todo, index: number) => <div className="focus-task" key={task.id}>
    <div className="focus-task-main"><button type="button" className="focus-complete" disabled={busy} aria-label={`Complete ${task.title}`} onClick={() => onAction(() => api.toggleTodo(task.id), 'Task completed.')}><span aria-hidden>✓</span></button><span className="focus-task-title">{task.title}</span><span className="focus-rank" aria-label={`Priority ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span></div>
    <TaskPlanActions task={task} busy={busy} onAction={onAction} />
  </div>
  return <section className="card planning-focus">
    <div className="focus-heading"><div><h2>Today’s focus</h2><p className="planning-note">A little room for what matters most.</p></div><span className="focus-capacity">{priorities.length}<small>/ 3</small></span></div>
    {priorities.length ? <div className="focus-priority-list">{priorities.map(renderPriority)}</div> : <p className="focus-empty">Choose your first priority. One is enough to start.</p>}
    {remaining > 0 && available.length > 0 && <form className="focus-picker" onSubmit={event => { event.preventDefault(); if (chosenTask && available.some(task => task.id === Number(chosenTask))) void onAction(async () => { await dailyPlanning.plan(Number(chosenTask), dateKey(), true); setChosenTask('') }, 'Pinned to today’s priorities.') }}>
      <label htmlFor={pickerId}>{priorities.length ? `Add a priority · ${remaining} ${remaining === 1 ? 'space' : 'spaces'} left` : 'Choose an existing task'}</label><div><select id={pickerId} value={available.some(task => task.id === Number(chosenTask)) ? chosenTask : ''} onChange={event => setChosenTask(event.target.value)} disabled={busy}><option value="">Select a task…</option>{available.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select><button className="btn" disabled={busy || !available.some(task => task.id === Number(chosenTask))}>Pin task</button></div>
    </form>}
    {!available.length && !priorities.length && <Link className="btn btn-ghost" to="/tasks">Add your first task</Link>}
    {remaining === 0 && <p className="focus-full">Your three priorities are set. Finish or unpin one to make space.</p>}
    {otherPlanned.length > 0 && <details className="focus-other" open={otherPlanned.length <= 2}><summary>Also planned today <span>{otherPlanned.length}</span></summary><div>{otherPlanned.map(task => <div className="focus-other-task" key={task.id}><span>{task.title}</span><TaskPlanActions task={task} busy={busy} onAction={onAction} showComplete /></div>)}</div></details>}
    <Link className="focus-all-link" to="/tasks?view=today">Manage today’s plan <span aria-hidden>→</span></Link>
  </section>
}
