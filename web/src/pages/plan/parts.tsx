// Plan page pieces: the day strip, task rows (swipe or drag to plan), the task sheet.
import { useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Todo, TodoInput } from '../../api'
import { DragGrip, type DragHandleProps } from '../../components/Reorderable'
import { TaskPlanActions, type PlanningAction } from '../../components/DailyPlanning'
import { dateKey } from '../../dailyPlanning'
import { taskNotes } from '../../taskViews'
import { Button, CheckRow, Icon, Sheet } from '../../ui'
import { haptic } from '../../ui/feedback'
import { dayLabel, dayNumber, PRIORITIES, readableDate, TASK_DRAG_TYPE } from './days'


/* ---------- Day strip: pick a day, or drop a dragged task on one ---------- */
export function DayStrip({ days, selected, counts, onSelect, onDropTask }: {
  days: string[]; selected: string; counts: Record<string, number>
  onSelect: (day: string) => void; onDropTask: (taskId: number, day: string) => void
}) {
  const [over, setOver] = useState<string | null>(null)
  return <div className="pl-days" role="tablist" aria-label="Days">
    {days.map(d => {
      const label = dayLabel(d)
      return <button key={d} type="button" role="tab" aria-selected={d === selected} aria-label={`${label.long}, ${counts[d] ?? 0} items`}
        className={`pl-day${d === selected ? ' pl-day--on' : ''}${over === d ? ' pl-day--drop' : ''}`} onClick={() => onSelect(d)}
        onDragOver={e => { if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) { e.preventDefault(); setOver(d) } }}
        onDragLeave={() => setOver(o => o === d ? null : o)}
        onDrop={e => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData(TASK_DRAG_TYPE)); if (id) onDropTask(id, d) }}>
        <span className="pl-day__name">{label.short}</span>
        <span className="pl-day__num">{dayNumber(d)}</span>
        <span className="pl-day__count" aria-hidden="true">{counts[d] ? counts[d] : ''}</span>
      </button>
    })}
  </div>
}

/* ---------- Task row ---------- */
/** What a swipe does each way: a short label shown under the row, and the action. */
export type Swipe = { right: { label: string; run: () => void }; left: { label: string; run: () => void } }

export function TaskRow({ task, busy, onToggle, onOpen, swipe, handle, draggable }: {
  task: Todo; busy: boolean; onToggle: () => void; onOpen: () => void
  /** Touch only: drag the row past the threshold to act (e.g. right = done, left = tomorrow). */
  swipe?: Swipe
  handle?: DragHandleProps
  draggable?: boolean
}) {
  const today = dateKey()
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const [dx, setDx] = useState(0)
  const overdue = !task.completedAt && !!task.dueAt && task.dueAt.slice(0, 10) < today
  const slipped = !task.completedAt && !!task.plannedFor && task.plannedFor < today
  const meta = [
    task.isPriority && !task.completedAt ? 'Priority' : null,
    task.priority === 1 ? 'High' : task.priority === 3 ? 'Low' : null,
    task.dueAt ? `${overdue ? 'Overdue' : 'Due'} ${readableDate(task.dueAt)}` : null,
    slipped ? `Was planned ${readableDate(task.plannedFor!)}` : null,
  ].filter(Boolean).join(' · ')

  // Horizontal swipe only; vertical movement scrolls the page as usual.
  const down = (e: ReactPointerEvent) => { if (swipe && !busy && e.pointerType !== 'mouse') start.current = { x: e.clientX, y: e.clientY, id: e.pointerId } }
  const move = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const x = e.clientX - s.x, y = e.clientY - s.y
    if (Math.abs(y) > Math.abs(x) && Math.abs(x) < 12) { start.current = null; setDx(0); return }
    const next = Math.max(-120, Math.min(120, x))
    if ((Math.abs(next) >= 80) !== (Math.abs(dx) >= 80)) haptic(8) // crossing the threshold, either way
    setDx(next)
  }
  const up = () => {
    if (start.current && Math.abs(dx) >= 80) (dx > 0 ? swipe?.right : swipe?.left)?.run()
    start.current = null; setDx(0)
  }

  return <div className={`pl-task${task.completedAt ? ' pl-task--done' : ''}${overdue ? ' pl-task--overdue' : ''}`}
    data-swipe={dx > 40 ? 'right' : dx < -40 ? 'left' : undefined} data-armed={Math.abs(dx) >= 80 ? '' : undefined}>
    {swipe && <span className="pl-task__hint" aria-hidden="true">{dx > 0 ? swipe.right.label : swipe.left.label}</span>}
    <div className="pl-task__body" style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      draggable={draggable && !busy} onDragStart={e => { e.dataTransfer.setData(TASK_DRAG_TYPE, String(task.id)); e.dataTransfer.effectAllowed = 'move' }}>
      {handle && !busy && <DragGrip {...handle} />}
      <CheckRow checked={!!task.completedAt} disabled={busy} onChange={onToggle} label={task.title} meta={meta || undefined} />
      <Button size="sm" variant="quiet" icon="chevron" aria-label={`Open ${task.title}`} onClick={onOpen} />
    </div>
  </div>
}

/* ---------- New task / edit task sheet ---------- */
export type Destination = 'inbox' | 'today' | 'tomorrow' | 'day'
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')

export function TaskSheet({ open, task, selectedDay, busy, onClose, onCreate, onSave, onDelete, onAction }: {
  open: boolean
  task: Todo | null
  selectedDay: string
  busy: boolean
  onClose: () => void
  onCreate: (input: TodoInput, destination: Destination) => Promise<void>
  onSave: (task: Todo, input: TodoInput) => Promise<void>
  onDelete: (task: Todo) => void
  onAction: PlanningAction
}) {
  return <Sheet open={open} onClose={onClose} title={task ? 'Task' : 'New task'} labelledBy="pl-task-title">
    {open && <TaskForm key={task?.id ?? 'new'} task={task} selectedDay={selectedDay} busy={busy}
      onCreate={onCreate} onSave={onSave} onDelete={onDelete} onAction={onAction} />}
  </Sheet>
}

function TaskForm({ task, selectedDay, busy, onCreate, onSave, onDelete, onAction }: {
  task: Todo | null; selectedDay: string; busy: boolean
  onCreate: (input: TodoInput, destination: Destination) => Promise<void>
  onSave: (task: Todo, input: TodoInput) => Promise<void>
  onDelete: (task: Todo) => void
  onAction: PlanningAction
}) {
  const [form, setForm] = useState<TodoInput>(task
    ? { title: task.title, notes: taskNotes(task.notes), priority: task.priority, dueAt: toDateInput(task.dueAt) }
    : { title: '', notes: '', priority: 2, dueAt: '' })
  const today = dateKey()
  const [destination, setDestination] = useState<Destination>(selectedDay === today ? 'today' : 'day')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    void (task ? onSave(task, form) : onCreate(form, destination))
  }
  const dayName = dayLabel(selectedDay).long

  return <div className="pl-sheet-body">
  <form className="pl-form" onSubmit={submit}>
    <label className="pl-field"><span>What needs doing?</span>
      <input className="pl-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="A clear next action…" required maxLength={300} />
    </label>
    {!task && <fieldset className="pl-field pl-plan">
      <legend>Plan for</legend>
      <div className="pl-chips">
        {(['inbox', 'today', 'tomorrow', ...(selectedDay > dateKey() && dayLabel(selectedDay).short !== 'Tomorrow' ? ['day'] as const : [])] as Destination[]).map(d =>
          <button key={d} type="button" className={`pl-chip${destination === d ? ' pl-chip--on' : ''}`} aria-pressed={destination === d} onClick={() => setDestination(d)}>
            {d === 'inbox' ? 'Inbox' : d === 'today' ? 'Today' : d === 'tomorrow' ? 'Tomorrow' : dayName}
          </button>)}
      </div>
    </fieldset>}
    <div className="pl-row2">
      <label className="pl-field"><span>Due date</span>
        <input className="pl-input" type="date" value={form.dueAt ?? ''} onChange={e => setForm({ ...form, dueAt: e.target.value })} />
      </label>
      <label className="pl-field"><span>Priority</span>
        <select className="pl-input" value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })}>
          {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </label>
    </div>
    <label className="pl-field"><span>Notes</span>
      <textarea className="pl-input pl-textarea" rows={3} value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
    </label>
    <Button type="submit" variant="primary" block disabled={busy || !form.title.trim()}>{task ? 'Save changes' : 'Add task'}</Button>
  </form>
  {/* Outside the edit form: the plan actions have their own buttons and date form. */}
  {task && !task.completedAt && <div className="pl-sheet-plan">
    <span className="pl-sub">{task.plannedFor ? `Planned for ${dayLabel(task.plannedFor).long}` : 'In your inbox'}</span>
    <TaskPlanActions task={task} busy={busy} onAction={onAction} showComplete />
  </div>}
  {task && <Button variant="quiet" className="pl-danger" icon="close" disabled={busy} onClick={() => onDelete(task)}>Delete task</Button>}
  </div>
}

/* ---------- Empty and section helpers ---------- */
export function Empty({ children }: { children: string }) {
  return <p className="pl-empty"><Icon name="check" size={16} />{children}</p>
}
