import { useEffect, useState } from 'react'
import { api, type Todo, type TodoInput, type DailyTodo } from '../api'
import { Reorderable, DragGrip, type DragHandleProps } from '../components/Reorderable'

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const tomorrow = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d })()
const tomorrowKey = keyOf(tomorrow)
const tomorrowLabel = tomorrow.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'short' })

const PRIORITIES = [
  { v: 1, label: 'High' },
  { v: 2, label: 'Medium' },
  { v: 3, label: 'Low' },
]

const emptyForm: TodoInput = { title: '', notes: '', priority: 2, dueAt: '' }
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
const fromDateInput = (d?: string | null) => (d ? `${d}T00:00:00Z` : null)
const isOverdue = (iso?: string | null) =>
  !!iso && new Date(iso) < new Date(new Date().toDateString())

export default function TasksPage() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [tomorrowTodos, setTomorrowTodos] = useState<DailyTodo[]>([])
  const [newTomorrow, setNewTomorrow] = useState('')
  const [form, setForm] = useState<TodoInput>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState<TodoInput>(emptyForm)
  const [error, setError] = useState<string | null>(null)

  const load = () => Promise.all([api.todos(), api.dailyTodos(tomorrowKey)])
    .then(([t, dt]) => { setTodos(t); setTomorrowTodos(dt) })
    .catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  async function addTomorrow(e: React.FormEvent) {
    e.preventDefault()
    if (!newTomorrow.trim()) return
    await api.createDailyTodo(newTomorrow.trim(), tomorrowKey)
    setNewTomorrow('')
    load()
  }
  async function toggleTomorrow(id: number) { await api.toggleDailyTodo(id); load() }
  async function removeTomorrow(id: number) { await api.deleteDailyTodo(id); load() }
  // Optimistically apply the new order, then persist (reload to reconcile on error).
  async function reorderTomorrow(ids: number[]) {
    const byId = new Map(tomorrowTodos.map((t) => [t.id, t]))
    setTomorrowTodos(ids.map((id) => byId.get(id)!).filter(Boolean))
    try { await api.reorderDailyTodos(ids) } catch { load() }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    await api.createTodo({ ...form, dueAt: fromDateInput(form.dueAt) })
    setForm(emptyForm)
    load()
  }

  function startEdit(t: Todo) {
    setEditingId(t.id)
    setEdit({ title: t.title, notes: t.notes ?? '', priority: t.priority, dueAt: toDateInput(t.dueAt) })
  }

  async function saveEdit(id: number) {
    await api.updateTodo(id, { ...edit, dueAt: fromDateInput(edit.dueAt) })
    setEditingId(null)
    load()
  }

  async function toggle(id: number) { await api.toggleTodo(id); load() }
  async function remove(id: number) { await api.deleteTodo(id); load() }

  // The API already returns open tasks in manual (SortOrder) order; keep it.
  const open = todos.filter((t) => !t.completedAt)
  const done = todos.filter((t) => t.completedAt)

  async function reorderTasks(ids: number[]) {
    const byId = new Map(todos.map((t) => [t.id, t]))
    const reordered = ids.map((id) => byId.get(id)!).filter(Boolean)
    setTodos([...reordered, ...done]) // open (new order) first, then completed
    try { await api.reorderTodos(ids) } catch { load() }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p className="subtitle">Long-term · {open.length} open · {done.length} done</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="card tomorrow-plan">
        <h2>Plan tomorrow <span className="muted" style={{ fontWeight: 400 }}>· {tomorrowLabel}</span></h2>
        <form className="daily-add" onSubmit={addTomorrow}>
          <input value={newTomorrow} placeholder="Plan a to-do for tomorrow…" onChange={(e) => setNewTomorrow(e.target.value)} />
          <button className="btn" type="submit">Add</button>
        </form>
        {tomorrowTodos.length === 0 ? (
          <p className="muted">Nothing planned yet — add the first thing for tomorrow.</p>
        ) : (
          <div className="list">
            <Reorderable items={tomorrowTodos} getId={(d) => d.id} onReorder={reorderTomorrow}
              renderRow={(d, handle) => (
                <div className="todo daily-row">
                  <DragGrip {...handle} />
                  <label className="daily-check">
                    <input type="checkbox" checked={d.done} onChange={() => toggleTomorrow(d.id)} />
                    <span className={d.done ? 'done' : ''}>{d.title}</span>
                  </label>
                  <button className="icon-btn danger" onClick={() => removeTomorrow(d.id)} title="Remove">✕</button>
                </div>
              )} />
          </div>
        )}
      </section>

      <div className="section-title">Tasks</div>
      <form className="todo-form" onSubmit={add}>
        <div className="field">
          <label>Task</label>
          <input value={form.title} placeholder="What needs doing?"
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="field">
          <label>Due date</label>
          <input type="date" value={form.dueAt ?? ''}
            onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
        </div>
        <div className="field">
          <label>Priority</label>
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </div>
        <button className="btn" type="submit">Add</button>
      </form>

      <div className="todo-list">
        {open.length === 0 ? <p className="muted">Nothing open. Add something above.</p> : (
          <Reorderable items={open} getId={(t) => t.id} onReorder={reorderTasks}
            renderRow={(t, handle) => (
              <TodoRow t={t} handle={handle}
                editing={editingId === t.id} edit={edit} setEdit={setEdit}
                onStartEdit={() => startEdit(t)} onSave={() => saveEdit(t.id)} onCancel={() => setEditingId(null)}
                onToggle={() => toggle(t.id)} onDelete={() => remove(t.id)} />
            )} />
        )}
      </div>

      {done.length > 0 && (
        <>
          <div className="section-title">Completed</div>
          <div className="todo-list">
            {done.map((t) => (
              <TodoRow key={t.id} t={t}
                editing={false} edit={edit} setEdit={setEdit}
                onStartEdit={() => startEdit(t)} onSave={() => saveEdit(t.id)} onCancel={() => setEditingId(null)}
                onToggle={() => toggle(t.id)} onDelete={() => remove(t.id)} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function TodoRow({ t, editing, edit, setEdit, onStartEdit, onSave, onCancel, onToggle, onDelete, handle }: {
  t: Todo
  editing: boolean
  edit: TodoInput
  setEdit: (v: TodoInput) => void
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
  onToggle: () => void
  onDelete: () => void
  handle?: DragHandleProps
}) {
  const overdue = !t.completedAt && isOverdue(t.dueAt)
  const cls = `todo-item${t.completedAt ? ' done-row' : ''}${overdue ? ' overdue' : ''}`

  if (editing) {
    return (
      <div className="todo-item">
        <input style={{ flex: 1 }} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
        <input type="date" value={edit.dueAt ?? ''} onChange={(e) => setEdit({ ...edit, dueAt: e.target.value })} />
        <select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })}>
          {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
        <div className="ti-actions">
          <button className="icon-btn" onClick={onSave} title="Save">✓</button>
          <button className="icon-btn" onClick={onCancel} title="Cancel">✕</button>
        </div>
      </div>
    )
  }

  return (
    <div className={cls}>
      {handle && <DragGrip {...handle} />}
      <input className="ti-check" type="checkbox" checked={!!t.completedAt} onChange={onToggle} />
      <div className="ti-main">
        <div className="ti-title" style={t.completedAt ? { textDecoration: 'line-through', color: 'var(--text-dim)' } : undefined}>
          {t.title}
        </div>
        {t.notes && <div className="ti-notes">{t.notes}</div>}
      </div>
      <span className={`pri pri-${t.priority}`}>{PRIORITIES.find((p) => p.v === t.priority)?.label}</span>
      {t.dueAt && <span className={overdue ? 'ti-due overdue' : 'ti-due'}>{new Date(t.dueAt).toLocaleDateString('en-IE')}</span>}
      <div className="ti-actions">
        <button className="icon-btn" onClick={onStartEdit} title="Edit">✎</button>
        <button className="icon-btn danger" onClick={onDelete} title="Delete">🗑</button>
      </div>
    </div>
  )
}
