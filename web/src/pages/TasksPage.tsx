import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type Todo, type TodoInput, type DailyTodo } from '../api'
import { Reorderable, DragGrip, type DragHandleProps } from '../components/Reorderable'
import { CarryForwardPanel, TaskPlanActions, type PlanningAction } from '../components/DailyPlanning'
import { dailyPlanning, dateKey, nextDateKey } from '../dailyPlanning'
import { filterTasks, isCompleteOpenOrder, TASK_VIEWS, taskIsOverdue, taskMatchesSearch, taskMatchesView, taskNotes, type TaskView } from '../taskViews'
import '../dailyPlanning.css'

const PRIORITIES = [
  { v: 1, label: 'High' },
  { v: 2, label: 'Medium' },
  { v: 3, label: 'Low' },
]

const emptyForm: TodoInput = { title: '', notes: '', priority: 2, dueAt: '' }
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
const fromDateInput = (d?: string | null) => (d ? `${d}T00:00:00Z` : null)
const readableDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })

export default function TasksPage() {
  const todayKey = dateKey()
  const [params, setParams] = useSearchParams()
  const view: TaskView = TASK_VIEWS.find(option => option.id === params.get('view'))?.id ?? 'all'
  const query = params.get('q') ?? ''
  const selectedView = TASK_VIEWS.find(option => option.id === view)!
  const [loaded, setLoaded] = useState(false)
  const [planChoice, setPlanChoice] = useState<'backlog' | 'today' | 'tomorrow'>('backlog')
  const [completedOpen, setCompletedOpen] = useState(false)
  const [tomorrowOpen, setTomorrowOpen] = useState(false)
  const actionInFlight = useRef(false)
  const loadVersion = useRef(0)
  const tomorrowKey = nextDateKey()
  const tomorrowLabel = new Date(`${tomorrowKey}T12:00:00`).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'short' })
  const [pending, setPending] = useState<DailyTodo[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [todos, setTodos] = useState<Todo[]>([])
  const [tomorrowTodos, setTomorrowTodos] = useState<DailyTodo[]>([])
  const [newTomorrow, setNewTomorrow] = useState('')
  const [form, setForm] = useState<TodoInput>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState<TodoInput>(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    const version = ++loadVersion.current
    return Promise.all([api.todos(), api.dailyTodos(tomorrowKey), dailyPlanning.pending()])
      .then(([t, dt, carry]) => { if (version !== loadVersion.current) return; setTodos(t); setTomorrowTodos(dt); setPending(carry); setError(null); setLoaded(true) })
      .catch(e => { if (version === loadVersion.current) setError(String(e)) })
  }, [tomorrowKey])
  useEffect(() => { void load() }, [load])
  const onAction: PlanningAction = async (operation, message) => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setBusy(true); setActionError(null); setNotice(null)
    try { await operation(); setNotice(message); await load() }
    catch (e) { setActionError(e instanceof Error ? e.message : String(e)); await load() }
    finally { actionInFlight.current = false; setBusy(false) }
  }
  function selectView(next: TaskView) {
    setParams(previous => { const updated = new URLSearchParams(previous); updated.set('view', next); return updated })
    if (next === 'today' || next === 'tomorrow' || next === 'backlog') setPlanChoice(next)
  }
  function setQuery(value: string) {
    setParams(previous => { const updated = new URLSearchParams(previous); if (value) updated.set('q', value); else updated.delete('q'); return updated }, { replace: true })
  }

  async function addTomorrow(e: React.FormEvent) {
    e.preventDefault()
    if (!newTomorrow.trim()) return
    await onAction(async () => { await api.createDailyTodo(newTomorrow.trim(), tomorrowKey); setNewTomorrow('') }, 'Added to tomorrow.')
  }
  async function toggleTomorrow(id: number) { await onAction(() => api.toggleDailyTodo(id), 'To-do updated.') }
  async function removeTomorrow(id: number) { await onAction(() => api.deleteDailyTodo(id), 'To-do removed.') }
  // Optimistically apply the new order, then persist (reload to reconcile on error).
  async function reorderTomorrow(ids: number[]) {
    if (actionInFlight.current) return
    const byId = new Map(tomorrowTodos.map((t) => [t.id, t]))
    setTomorrowTodos(ids.map((id) => byId.get(id)!).filter(Boolean))
    await onAction(() => api.reorderDailyTodos(ids), 'Order saved.')
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    const destination = planChoice
    await onAction(async () => {
      const task = await api.createTodo({ ...form, title: form.title.trim(), dueAt: fromDateInput(form.dueAt) })
      setForm(emptyForm)
      if (destination !== 'backlog') {
        try { await dailyPlanning.plan(task.id, destination === 'today' ? todayKey : tomorrowKey) }
        catch (e) { throw new Error(`Task saved to your backlog, but its plan could not be saved. ${e instanceof Error ? e.message : String(e)}`, { cause: e }) }
      }
      setParams({ view: destination })
    }, destination === 'backlog' ? 'Task added to your backlog.' : `Task planned for ${destination}.`)
  }

  function startEdit(t: Todo) {
    setEditingId(t.id)
    setEdit({ title: t.title, notes: taskNotes(t.notes), priority: t.priority, dueAt: toDateInput(t.dueAt) })
  }

  async function saveEdit(id: number) {
    if (!edit.title.trim()) return
    const marker = todos.find(task => task.id === id)?.notes?.match(/\[weekly-review:[^\]]+\]/)?.[0]
    await onAction(async () => { await api.updateTodo(id, { ...edit, title: edit.title.trim(), notes: [marker, edit.notes?.trim()].filter(Boolean).join('\n'), dueAt: fromDateInput(edit.dueAt) }); setEditingId(null) }, 'Task updated.')
  }

  async function toggle(id: number) { await onAction(() => api.toggleTodo(id), 'Task updated.') }
  async function remove(id: number) { await onAction(() => api.deleteTodo(id), 'Task removed.') }

  // The API already returns open tasks in manual (SortOrder) order; keep it.
  const open = todos.filter((t) => !t.completedAt)
  const done = todos.filter((t) => t.completedAt)

  const visible = filterTasks(todos, view, query, todayKey, tomorrowKey)
  const completedMatches = done.filter(task => taskMatchesSearch(task, query))
  const counts = Object.fromEntries(TASK_VIEWS.map(option => [option.id, todos.filter(task => taskMatchesView(task, option.id, todayKey, tomorrowKey)).length])) as Record<TaskView, number>
  const canReorder = view === 'all' && !query.trim()

  async function reorderTasks(ids: number[]) {
    if (!canReorder || actionInFlight.current) return
    if (!isCompleteOpenOrder(todos, ids)) { await load(); setActionError('The task list changed. Try reordering again.'); return }
    const byId = new Map(todos.map((t) => [t.id, t]))
    const reordered = ids.map((id) => byId.get(id)!).filter(Boolean)
    setTodos([...reordered, ...done]) // open (new order) first, then completed
    await onAction(() => api.reorderTodos(ids), 'Order saved.')
  }

  const renderTask = (task: Todo, handle?: DragHandleProps) => <TodoRow key={task.id} t={task} handle={busy ? undefined : handle} busy={busy} onAction={onAction}
    editing={editingId === task.id} edit={edit} setEdit={setEdit} onStartEdit={() => startEdit(task)} onSave={() => saveEdit(task.id)} onCancel={() => setEditingId(null)}
    onToggle={() => toggle(task.id)} onDelete={() => remove(task.id)} />

  return <div className="tasks-workspace">
    <div className="page-head tasks-page-head"><div><h1>Tasks</h1><p className="subtitle">Give your tasks a place and your day a little room.</p></div><div className="tasks-head-count"><strong>{open.length}</strong><span>open tasks</span></div></div>
    {error && <div className="planning-feedback error" role="alert"><span>Could not refresh your tasks. {loaded && 'Your last loaded tasks are still shown. '}{error}</span><button className="btn" onClick={load}>Retry</button></div>}
    {actionError && <div className="planning-feedback error" role="alert"><span>{actionError}</span><button className="btn btn-ghost" onClick={() => setActionError(null)}>Dismiss</button></div>}
    {notice && <p className="planning-feedback" role="status">{notice}</p>}

    <section className="card task-capture" aria-labelledby="task-capture-heading">
      <div className="task-section-head"><h2 id="task-capture-heading">Add a task</h2><span className="planning-note">A plan is separate from a deadline.</span></div>
      <form onSubmit={add}>
        <div className="task-capture-main">
          <div className="field"><label htmlFor="task-title">What needs doing?</label><input id="task-title" value={form.title} placeholder="A clear next action…" required onChange={event => setForm({ ...form, title: event.target.value })} /></div>
          <div className="field"><label htmlFor="task-plan">Plan for</label><select id="task-plan" value={planChoice} onChange={event => setPlanChoice(event.target.value as typeof planChoice)}><option value="backlog">Backlog · choose later</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option></select></div>
          <button className="btn task-add-button" type="submit" disabled={busy || !form.title.trim()}><span aria-hidden>＋</span> Add task</button>
        </div>
        <details className="task-extra-fields"><summary>Due date, priority &amp; notes</summary><div className="task-form-details">
          <div className="field"><label htmlFor="task-due">Due date <span className="muted">optional</span></label><input id="task-due" type="date" value={form.dueAt ?? ''} onChange={event => setForm({ ...form, dueAt: event.target.value })} /></div>
          <div className="field"><label htmlFor="task-priority">Priority</label><select id="task-priority" value={form.priority} onChange={event => setForm({ ...form, priority: Number(event.target.value) })}>{PRIORITIES.map(priority => <option key={priority.v} value={priority.v}>{priority.label}</option>)}</select></div>
          <div className="field task-notes-field"><label htmlFor="task-notes">Notes <span className="muted">optional</span></label><textarea id="task-notes" value={form.notes ?? ''} rows={2} onChange={event => setForm({ ...form, notes: event.target.value })} /></div>
        </div></details>
      </form>
    </section>
    <CarryForwardPanel items={pending} busy={busy} onAction={onAction} />

    <section className="task-collection" aria-labelledby="task-list-heading">
      <div className="task-view-tabs" aria-label="Task views">{TASK_VIEWS.map(option => <button key={option.id} type="button" aria-pressed={view === option.id} className={`task-view-tab${view === option.id ? ' selected' : ''}${option.id === 'overdue' && counts.overdue ? ' has-overdue' : ''}`} onClick={() => selectView(option.id)}><span>{option.label}</span><span className="task-view-count">{counts[option.id]}</span></button>)}</div>
      <div className="task-list-toolbar"><div><h2 id="task-list-heading">{view === 'all' ? 'All tasks' : selectedView.label}<span className="task-result-count">{visible.length}</span></h2><p className="planning-note">{selectedView.description}</p></div>
        <div className="task-search"><label htmlFor="task-search">Search this view</label><div><input id="task-search" type="search" value={query} placeholder="Search task names or notes" onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="btn btn-ghost" onClick={() => setQuery('')} aria-label="Clear task search">Clear</button>}</div></div>
      </div>
      {!loaded && !error ? <p className="muted" role="status">Loading your tasks…</p> : visible.length ? <>
        <p className="task-reorder-hint">{canReorder ? 'Drag the grip or use its arrow keys to change your order.' : 'Your order is preserved. Reorder in All with the search cleared.'}</p>
        <div className="task-rows">{canReorder ? <Reorderable items={visible} getId={task => task.id} onReorder={reorderTasks} renderRow={(task, handle) => renderTask(task, handle)} /> : visible.map(task => renderTask(task))}</div>
      </> : loaded && <div className="task-empty"><span className="task-empty-mark" aria-hidden>{view === 'overdue' && !query ? '✓' : '○'}</span><h3>{query ? 'No matching tasks' : view === 'overdue' ? 'No overdue tasks' : `Nothing in ${view === 'all' ? 'your task list' : selectedView.label.toLowerCase()} yet`}</h3><p>{query ? `No tasks match “${query}” in ${selectedView.label.toLowerCase()}. Try another word or search all tasks.` : selectedView.empty}</p><div className="planning-actions">{query && <button className="btn btn-ghost" onClick={() => setQuery('')}>Clear search</button>}{view !== 'all' && <button className="btn btn-ghost" onClick={() => selectView('all')}>View all tasks</button>}</div></div>}
    </section>

    <section className="card task-daily-tomorrow">
      <button className="task-disclosure" type="button" aria-expanded={tomorrowOpen} aria-controls="tomorrow-quick-todos" onClick={() => setTomorrowOpen(!tomorrowOpen)}><span><strong>Tomorrow’s quick to-dos</strong><small>{tomorrowTodos.filter(item => !item.done).length} remaining · {tomorrowLabel}</small></span><span aria-hidden>{tomorrowOpen ? '−' : '+'}</span></button>
      {tomorrowOpen && <div id="tomorrow-quick-todos" className="task-disclosure-body"><p className="planning-note">Small things for tomorrow. Unfinished items stay available to carry forward.</p>
        <form className="daily-add" onSubmit={addTomorrow}><label className="ux-sr-only" htmlFor="new-tomorrow-todo">New quick to-do for tomorrow</label><input id="new-tomorrow-todo" value={newTomorrow} placeholder="Add a quick to-do for tomorrow…" onChange={event => setNewTomorrow(event.target.value)} /><button className="btn" disabled={busy || !newTomorrow.trim()}>Add</button></form>
        {tomorrowTodos.length ? <div className="list"><Reorderable items={tomorrowTodos} getId={item => item.id} onReorder={reorderTomorrow} renderRow={(item, handle) => <div className="todo daily-row task-tomorrow-row">{!busy && <DragGrip {...handle} />}<label className="daily-check"><input type="checkbox" disabled={busy} checked={item.done} onChange={() => toggleTomorrow(item.id)} /><span className={item.done ? 'done' : ''}>{item.title}</span></label><div className="planning-actions">{!item.done && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAction(() => dailyPlanning.carry(item.id, todayKey), 'Moved to today.')}>Do today</button>}<button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remove ${item.title}`} onClick={() => removeTomorrow(item.id)}>Remove</button></div></div>} /></div> : <p className="muted">Nothing here yet. Add a small task to make tomorrow easier.</p>}
      </div>}
    </section>

    <section className="task-completed"><button className="task-disclosure" type="button" aria-expanded={completedOpen} aria-controls="completed-tasks" onClick={() => setCompletedOpen(!completedOpen)}><span><strong>Completed</strong><small>{query ? `${completedMatches.length} match your search · ${done.length} total` : `${done.length} tasks finished`}</small></span><span aria-hidden>{completedOpen ? '−' : '+'}</span></button>{completedOpen && <div id="completed-tasks" className="task-rows">{completedMatches.length ? completedMatches.map(task => renderTask(task)) : <p className="planning-note">{query ? 'No completed tasks match your search.' : 'Completed tasks will appear here.'}</p>}</div>}</section>
  </div>
}

function TodoRow({ t, editing, edit, setEdit, onStartEdit, onSave, onCancel, onToggle, onDelete, handle, busy, onAction }: {
  t: Todo; editing: boolean; edit: TodoInput; setEdit: (value: TodoInput) => void; onStartEdit: () => void; onSave: () => void; onCancel: () => void; onToggle: () => void; onDelete: () => void; handle?: DragHandleProps; busy: boolean; onAction: PlanningAction
}) {
  const today = dateKey()
  const overdue = taskIsOverdue(t, today)
  const notes = taskNotes(t.notes)
  if (editing) return <form className="task-row task-edit-row" onSubmit={event => { event.preventDefault(); onSave() }}>
    <div className="task-form-details"><div className="field task-notes-field"><label htmlFor={`edit-task-${t.id}`}>Task</label><input id={`edit-task-${t.id}`} required value={edit.title} onChange={event => setEdit({ ...edit, title: event.target.value })} /></div>
      <div className="field"><label htmlFor={`edit-due-${t.id}`}>Due date</label><input id={`edit-due-${t.id}`} type="date" value={edit.dueAt ?? ''} onChange={event => setEdit({ ...edit, dueAt: event.target.value })} /></div>
      <div className="field"><label htmlFor={`edit-priority-${t.id}`}>Priority</label><select id={`edit-priority-${t.id}`} value={edit.priority} onChange={event => setEdit({ ...edit, priority: Number(event.target.value) })}>{PRIORITIES.map(priority => <option key={priority.v} value={priority.v}>{priority.label}</option>)}</select></div>
      <div className="field task-notes-field"><label htmlFor={`edit-notes-${t.id}`}>Notes</label><textarea id={`edit-notes-${t.id}`} rows={2} value={edit.notes ?? ''} onChange={event => setEdit({ ...edit, notes: event.target.value })} /></div>
    </div><div className="planning-actions"><button className="btn" disabled={busy || !edit.title.trim()}>Save changes</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>
  const planned = t.plannedFor ? t.plannedFor === today ? 'Today' : t.plannedFor < today ? `Unfinished plan · ${readableDate(t.plannedFor)}` : `Planned ${readableDate(t.plannedFor)}` : 'Unplanned'
  return <article className={`task-row${t.completedAt ? ' is-complete' : ''}${overdue ? ' is-overdue' : ''}`}>
    <div className="task-row-main">{handle && <DragGrip {...handle} />}<input className="task-complete-check" type="checkbox" disabled={busy} checked={!!t.completedAt} aria-label={`Mark ${t.title} ${t.completedAt ? 'incomplete' : 'complete'}`} onChange={onToggle} />
      <div className="task-row-copy"><h3>{t.title}</h3><div className="task-row-meta">{t.isPriority && !t.completedAt && <span className="planning-priority">★ Priority</span>}<span className={`task-priority-label priority-${t.priority}`}>{PRIORITIES.find(priority => priority.v === t.priority)?.label ?? 'Medium'}</span>{!t.completedAt && <span>{planned}</span>}{t.dueAt && <span className={overdue ? 'task-overdue-label' : undefined}>{overdue ? 'Overdue · ' : 'Due '}{readableDate(t.dueAt)}</span>}</div>{notes && <p className="task-row-notes">{notes}</p>}</div>
      <div className="task-row-tools"><button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Edit ${t.title}`} onClick={onStartEdit}>Edit</button><button className="btn btn-ghost btn-sm task-delete" disabled={busy} aria-label={`Delete ${t.title}`} onClick={onDelete}>Delete</button></div>
    </div>{!t.completedAt && <div className="task-row-plan"><TaskPlanActions task={t} busy={busy} onAction={onAction} /></div>}
  </article>
}
