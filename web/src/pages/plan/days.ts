// Date helpers for the Plan page. Keys are local YYYY-MM-DD strings.
import type { CalendarEvent, Todo } from '../../api'
import { dateKey } from '../../dailyPlanning'

export const PLAN_DAYS = 7
export const PRIORITIES = [{ v: 1, label: 'High' }, { v: 2, label: 'Medium' }, { v: 3, label: 'Low' }] as const
/** Drag-and-drop payload type for a task dragged onto a day. */
export const TASK_DRAG_TYPE = 'application/x-plan-task'

/** Today and the next six days. */
export function dayKeys(count = PLAN_DAYS): string[] {
  return Array.from({ length: count }, (_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return dateKey(d) })
}

export function dayLabel(key: string, today = dateKey()): { short: string; long: string } {
  const d = new Date(`${key}T12:00:00`)
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000)
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (diff === 0) return { short: 'Today', long: `Today · ${date}` }
  if (diff === 1) return { short: 'Tomorrow', long: `Tomorrow · ${date}` }
  return { short: d.toLocaleDateString(undefined, { weekday: 'short' }), long: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) }
}

export const dayNumber = (key: string) => Number(key.slice(8, 10))

/**
 * Day key an event belongs to. All-day events are stored as UTC midnight of
 * their calendar date, so use that date as-is; converting it to local time
 * would move it to the previous day west of UTC.
 */
export const eventDay = (e: CalendarEvent) => e.allDay ? e.startsAt.slice(0, 10) : dateKey(new Date(e.startsAt))

export const eventTime = (e: CalendarEvent) => e.allDay ? 'All day'
  : `${new Date(e.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}–${new Date(e.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`

export const readableDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** Open tasks that need a decision: planned for a past day, or past their due date. */
export const isSlipped = (t: Todo, today: string) =>
  !t.completedAt && ((!!t.plannedFor && t.plannedFor < today) || (!!t.dueAt && t.dueAt.slice(0, 10) < today))

/**
 * Inbox reorder keeps every other open task where it is: the inbox's new order
 * fills the positions inbox tasks held in the full open list, so the API
 * (which needs the complete open order) receives one.
 */
export function mergeOrder(openIds: number[], inboxOrder: number[]): number[] {
  const inbox = new Set(inboxOrder)
  let next = 0
  return openIds.map(id => inbox.has(id) ? inboxOrder[next++] : id)
}
