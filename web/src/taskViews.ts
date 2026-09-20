import type { Todo } from './api'

export type TaskView = 'all' | 'today' | 'tomorrow' | 'backlog' | 'later' | 'overdue'
export const TASK_VIEWS: { id: TaskView; label: string; description: string; empty: string }[] = [
  { id: 'today', label: 'Today', description: 'Tasks you have chosen to work on today.', empty: 'Nothing planned for today. Pick a task from your backlog, or add one above.' },
  { id: 'tomorrow', label: 'Tomorrow', description: 'A head start on tomorrow, without changing any due dates.', empty: 'Tomorrow is open. Choose a task to give yourself a head start.' },
  { id: 'backlog', label: 'Backlog', description: 'Unplanned tasks and unfinished plans from earlier days.', empty: 'Your open tasks all have a current or future plan.' },
  { id: 'later', label: 'Later', description: 'Tasks planned beyond tomorrow.', empty: 'Nothing planned further ahead.' },
  { id: 'overdue', label: 'Overdue', description: 'Open tasks whose due date has passed, wherever they are planned.', empty: 'No overdue tasks. Your deadlines are up to date.' },
  { id: 'all', label: 'All', description: 'Every open task, in your chosen order.', empty: 'No open tasks. Add the next thing you want to get done.' },
]

export const taskNotes = (notes: string | null | undefined) => (notes ?? '').replace(/\[weekly-review:[^\]]+\]\s*/g, '').trim()

/** Due dates are calendar dates; a midnight UTC value must not slip a day when travelling. */
export const taskIsOverdue = (task: Todo, today: string) => !task.completedAt && !!task.dueAt && task.dueAt.slice(0, 10) < today

export function taskMatchesView(task: Todo, view: TaskView, today: string, tomorrow: string): boolean {
  if (task.completedAt) return false
  switch (view) {
    case 'today': return task.plannedFor === today
    case 'tomorrow': return task.plannedFor === tomorrow
    case 'backlog': return !task.plannedFor || task.plannedFor < today
    case 'later': return !!task.plannedFor && task.plannedFor > tomorrow
    case 'overdue': return taskIsOverdue(task, today)
    case 'all': return true
  }
}

export function taskMatchesSearch(task: Todo, query: string): boolean {
  const text = `${task.title} ${taskNotes(task.notes)}`.toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word))
}

export function filterTasks(tasks: Todo[], view: TaskView, query: string, today: string, tomorrow: string): Todo[] {
  return tasks.filter(task => taskMatchesView(task, view, today, tomorrow) && taskMatchesSearch(task, query))
}

/** Reject a stale or filtered order instead of dropping tasks that were not shown. */
export function isCompleteOpenOrder(tasks: Todo[], ids: number[]): boolean {
  const openIds = new Set(tasks.filter(task => !task.completedAt).map(task => task.id))
  return ids.length === openIds.size && new Set(ids).size === ids.length && ids.every(id => openIds.has(id))
}
