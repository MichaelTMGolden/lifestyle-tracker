// Plan: tasks and calendar together. A week strip picks a day; the day shows its
// events, planned tasks and quick to-dos. Inbox tasks are planned with one tap, a
// swipe (right: today, left: tomorrow) or by dragging onto a day.
import { useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, type DailyTodo, type Todo, type TodoInput } from '../api'
import { Collapsible } from '../components/Collapsible'
import { CarryForwardPanel, type PlanningAction } from '../components/DailyPlanning'
import { DragGrip, Reorderable, type DragHandleProps } from '../components/Reorderable'
import { dailyPlanning, dateKey, nextDateKey } from '../dailyPlanning'
import { isCompleteOpenOrder, taskMatchesSearch } from '../taskViews'
import { Button, CheckRow, Icon, SectionHead, Skeleton } from '../ui'
import { useToast } from '../ui/hooks'
import { dayKeys, dayLabel, eventDay, eventTime, isSlipped, mergeOrder, PLAN_DAYS } from './plan/days'
import { DayStrip, Empty, TaskRow, TaskSheet, type Destination } from './plan/parts'
import '../dailyPlanning.css'
import './plan/plan.css'

const fromDateInput = (d?: string | null) => (d ? `${d}T00:00:00Z` : null)
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export default function TasksPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const today = dateKey()
  const days = dayKeys()
  const requested = params.get('day')
  const selected = requested && days.includes(requested) ? requested : today
  const query = params.get('q') ?? ''
  const [sheet, setSheet] = useState<{ task: Todo | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [quickText, setQuickText] = useState('')
  const inFlight = useRef(false)

  const todos = useQuery({ queryKey: ['todos'], queryFn: api.todos })
  const events = useQuery({ queryKey: ['calendar', PLAN_DAYS], queryFn: () => api.calendarDays(PLAN_DAYS) })
  const pending = useQuery({ queryKey: ['daily-pending'], queryFn: dailyPlanning.pending })
  const dayTodos = useQuery({ queryKey: ['daily', selected], queryFn: () => api.dailyTodos(selected) })

  const setParam = (key: string, value: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (value) next.set(key, value); else next.delete(key)
    return next
  }, { replace: true })
  const selectDay = (d: string) => setParam('day', d === today ? null : d)

  const resync = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['todos'] }),
    qc.invalidateQueries({ queryKey: ['daily'] }),
    qc.invalidateQueries({ queryKey: ['daily-pending'] }),
    qc.invalidateQueries({ queryKey: ['today-bundle'] }),
  ])
  const onAction: PlanningAction = async (operation, done) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true)
    try { await operation(); toast.show({ message: done }) }
    catch (e) { toast.show({ message: `Couldn't save: ${message(e)}`, tone: 'error' }) }
    finally { await resync(); inFlight.current = false; setBusy(false) }
  }

  const all = todos.data ?? []
  const open = all.filter(t => !t.completedAt)
  const done = all.filter(t => t.completedAt)
  const matches = (t: Todo) => taskMatchesSearch(t, query)
  const plannedOn = (d: string) => open.filter(t => t.plannedFor === d)
  const dayEvents = (events.data ?? []).filter(e => eventDay(e) === selected)
  const slipped = open.filter(t => isSlipped(t, today) && t.plannedFor !== today)
  const inbox = open.filter(t => !t.plannedFor && !isSlipped(t, today))
  const counts = Object.fromEntries(days.map(d => [d, plannedOn(d).length + (events.data ?? []).filter(e => eventDay(e) === d).length]))
  const selectedLabel = dayLabel(selected)

  const plan = (t: Todo, day: string) => onAction(() => dailyPlanning.plan(t.id, day, t.isPriority && t.plannedFor === day),
    `Planned for ${dayLabel(day).short.toLowerCase() === 'today' ? 'today' : dayLabel(day).long}.`)
  const toggle = (t: Todo) => onAction(() => api.toggleTodo(t.id), t.completedAt ? 'Task reopened.' : 'Task done.')

  async function create(input: TodoInput, destination: Destination) {
    const day = destination === 'today' ? today : destination === 'tomorrow' ? nextDateKey() : destination === 'day' ? selected : null
    await onAction(async () => {
      const task = await api.createTodo({ ...input, title: input.title.trim(), dueAt: fromDateInput(input.dueAt) })
      if (day) {
        try { await dailyPlanning.plan(task.id, day) }
        catch (e) { throw new Error(`Task saved to your inbox, but planning it failed. ${message(e)}`, { cause: e }) }
      }
      setSheet(null)
    }, day ? `Task planned for ${dayLabel(day).long}.` : 'Task added to your inbox.')
  }
  async function save(task: Todo, input: TodoInput) {
    // Weekly-review tasks carry a hidden marker in their notes; keep it.
    const marker = task.notes?.match(/\[weekly-review:[^\]]+\]/)?.[0]
    await onAction(async () => {
      await api.updateTodo(task.id, { ...input, title: input.title.trim(), notes: [marker, input.notes?.trim()].filter(Boolean).join('\n'), dueAt: fromDateInput(input.dueAt) })
      setSheet(null)
    }, 'Task updated.')
  }
  function remove(task: Todo) {
    if (!confirm(`Delete "${task.title}"? This can't be undone.`)) return
    void onAction(async () => { await api.deleteTodo(task.id); setSheet(null) }, 'Task deleted.')
  }
  async function reorderInbox(ids: number[]) {
    const full = mergeOrder(open.map(t => t.id), ids)
    if (!isCompleteOpenOrder(all, full)) { await resync(); return }
    const byId = new Map(all.map(t => [t.id, t]))
    qc.setQueryData<Todo[]>(['todos'], [...full.map(id => byId.get(id)!), ...done])
    await onAction(() => api.reorderTodos(full), 'Order saved.')
  }

  // Quick to-dos for the selected day (the old "tomorrow planner", for any day).
  const quickItems = dayTodos.data ?? []
  async function addQuick(e: FormEvent) {
    e.preventDefault()
    const title = quickText.trim()
    if (!title) return
    setQuickText('')
    await onAction(() => api.createDailyTodo(title, selected), `Added to ${selectedLabel.short.toLowerCase() === 'today' ? 'today' : selectedLabel.long}.`)
  }
  const reorderQuick = (ids: number[]) => onAction(() => api.reorderDailyTodos(ids), 'Order saved.')

  const inboxProps = {
    busy,
    onToggle: (t: Todo) => void toggle(t),
    onOpen: (t: Todo) => setSheet({ task: t }),
    onPlan: (t: Todo, day: 'today' | 'tomorrow') => void plan(t, day === 'today' ? today : nextDateKey()),
  }

  const loading = todos.isPending
  const loadError = todos.error ?? events.error

  return <div className="pl-page">
    <header className="pl-head">
      <div>
        <h1>Plan</h1>
        <p className="pl-head__sub">{open.length} open {open.length === 1 ? 'task' : 'tasks'}{inbox.length ? ` · ${inbox.length} in your inbox` : ''}</p>
      </div>
      <Button size="sm" variant="primary" icon="plus" onClick={() => setSheet({ task: null })}>New task</Button>
    </header>

    {loadError && <p className="pl-error" role="alert">Couldn't load everything. {message(loadError)} <Button size="sm" variant="quiet" onClick={() => void resync()}>Retry</Button></p>}

    <DayStrip days={days} selected={selected} counts={counts} onSelect={selectDay}
      onDropTask={(id, d) => { const t = all.find(x => x.id === id); if (t) void plan(t, d) }} />

    <section className="pl-day-view" aria-labelledby="pl-day-title">
      <SectionHead id="pl-day-title" title={selectedLabel.long} />
      {loading ? <Skeleton lines={3} /> : <>
        {dayEvents.length > 0 && <ul className="pl-events" aria-label="Calendar">
          {dayEvents.map(e => <li key={e.id}><span className="pl-events__time">{eventTime(e)}</span><span className="pl-events__title">{e.title}{e.location && <small>{e.location}</small>}</span></li>)}
        </ul>}
        <div className="pl-tasks">
          {plannedOn(selected).filter(matches).sort((a, b) => Number(b.isPriority) - Number(a.isPriority)).map(t =>
            <TaskRow key={t.id} task={t} busy={busy} onToggle={() => void toggle(t)} onOpen={() => setSheet({ task: t })} />)}
        </div>
        {quickItems.length > 0 && <div className="pl-quick">
          <h3 className="pl-sub">Quick to-dos</h3>
          <Reorderable items={quickItems.filter(d => !d.done)} getId={d => d.id}
            onReorder={ids => void reorderQuick([...ids, ...quickItems.filter(d => d.done).map(d => d.id)])}
            renderRow={(d: DailyTodo, handle) => <div className="pl-quick__row">
              {!busy && <DragGrip {...handle} />}
              <CheckRow checked={false} disabled={busy} onChange={() => void onAction(() => api.toggleDailyTodo(d.id), 'To-do done.')} label={d.title} />
              {selected !== today && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void onAction(() => dailyPlanning.carry(d.id, today), 'Moved to today.')}>Today</Button>}
              <Button size="sm" variant="quiet" className="pl-danger" icon="close" disabled={busy} aria-label={`Remove ${d.title}`} onClick={() => void onAction(() => api.deleteDailyTodo(d.id), 'To-do removed.')} />
            </div>} />
          {quickItems.filter(d => d.done).map(d => <div key={d.id} className="pl-quick__row pl-quick__row--done">
            <CheckRow checked disabled={busy} onChange={() => void onAction(() => api.toggleDailyTodo(d.id), 'To-do reopened.')} label={d.title} />
          </div>)}
        </div>}
        {!dayEvents.length && !plannedOn(selected).length && !quickItems.length && <Empty>{selected === today ? 'Nothing planned for today yet.' : 'This day is free.'}</Empty>}
        <form className="pl-add" onSubmit={addQuick}>
          <Icon name="plus" size={18} />
          <label className="ui-sr-only" htmlFor="pl-quick">Add a quick to-do for {selectedLabel.long}</label>
          <input id="pl-quick" value={quickText} onChange={e => setQuickText(e.target.value)} placeholder={`Quick to-do for ${selectedLabel.short.toLowerCase() === 'today' ? 'today' : selectedLabel.short}…`} autoComplete="off" />
          {quickText.trim() && <Button type="submit" size="sm" variant="quiet" disabled={busy}>Add</Button>}
        </form>
      </>}
    </section>

    {slipped.length > 0 && <section aria-labelledby="pl-slipped">
      <SectionHead id="pl-slipped" title="Needs a new day" aside={<span className="pl-count">{slipped.length}</span>} />
      <div className="pl-tasks">
        {slipped.filter(matches).map(t => <InboxRow key={t.id} t={t} {...inboxProps} />)}
      </div>
    </section>}

    <section aria-labelledby="pl-inbox">
      <SectionHead id="pl-inbox" title="Inbox" aside={<span className="pl-hint pl-hint--wide">Swipe right for today, left for tomorrow, or drag onto a day</span>} />
      <div className="pl-search">
        <Icon name="search" size={16} />
        <label className="ui-sr-only" htmlFor="pl-search">Search tasks</label>
        <input id="pl-search" type="search" value={query} placeholder="Search tasks" onChange={e => setParam('q', e.target.value || null)} />
      </div>
      {loading ? <Skeleton lines={4} /> : query
        ? <div className="pl-tasks">{inbox.filter(matches).map(t => <InboxRow key={t.id} t={t} {...inboxProps} />)}</div>
        : <div className="pl-tasks"><Reorderable items={inbox} getId={t => t.id} onReorder={ids => void reorderInbox(ids)}
            renderRow={(t, handle) => <InboxRow t={t} handle={handle} {...inboxProps} />} /></div>}
      {!loading && !inbox.filter(matches).length && <Empty>{query ? `No inbox tasks match "${query}".` : 'Inbox zero. Everything has a day.'}</Empty>}
    </section>

    <CarryForwardPanel items={pending.data ?? []} busy={busy} onAction={onAction} />

    <PlannedLater open={open.filter(t => t.plannedFor && t.plannedFor > days[days.length - 1]).filter(matches)} busy={busy}
      onToggle={t => void toggle(t)} onOpen={t => setSheet({ task: t })} />

    <Collapsible title={<>Completed <span className="pl-count">{done.length}</span></>} storageKey="plan.completed">
      <div className="pl-tasks">
        {done.filter(matches).map(t => <TaskRow key={t.id} task={t} busy={busy} onToggle={() => void toggle(t)} onOpen={() => setSheet({ task: t })} />)}
        {!done.length && <Empty>Finished tasks show up here.</Empty>}
      </div>
    </Collapsible>

    <TaskSheet open={sheet != null} task={sheet?.task ? all.find(t => t.id === sheet.task!.id) ?? sheet.task : null}
      selectedDay={selected} busy={busy} onClose={() => setSheet(null)}
      onCreate={create} onSave={save} onDelete={remove} onAction={onAction} />
  </div>

}

function PlannedLater({ open, busy, onToggle, onOpen }: { open: Todo[]; busy: boolean; onToggle: (t: Todo) => void; onOpen: (t: Todo) => void }) {
  if (!open.length) return null
  return <Collapsible title={<>Planned later <span className="pl-count">{open.length}</span></>} storageKey="plan.later">
    <div className="pl-tasks">{open.sort((a, b) => a.plannedFor!.localeCompare(b.plannedFor!)).map(t =>
      <TaskRow key={t.id} task={t} busy={busy} onToggle={() => onToggle(t)} onOpen={() => onOpen(t)} />)}</div>
  </Collapsible>
}

function InboxRow({ t, handle, busy, onToggle, onOpen, onPlan }: {
  t: Todo; handle?: DragHandleProps; busy: boolean
  onToggle: (t: Todo) => void; onOpen: (t: Todo) => void; onPlan: (t: Todo, day: 'today' | 'tomorrow') => void
}) {
  return <div className="pl-inbox-row">
    <TaskRow task={t} busy={busy} handle={handle} draggable onToggle={() => onToggle(t)} onOpen={() => onOpen(t)} onSwipe={d => onPlan(t, d)} />
    <div className="pl-inbox-row__plan">
      <Button size="sm" variant="quiet" disabled={busy} onClick={() => onPlan(t, 'today')} aria-label={`Plan ${t.title} for today`}>Today</Button>
      <Button size="sm" variant="quiet" disabled={busy} onClick={() => onPlan(t, 'tomorrow')} aria-label={`Plan ${t.title} for tomorrow`}>Tomorrow</Button>
    </div>
  </div>
}
