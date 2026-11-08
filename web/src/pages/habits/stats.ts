// Pure helpers for the Habits page: heatmap cells, weekly progress and labels.
import type { Goal, Habit, HabitHeatmap } from '../../api'
import { fmtDaySpan, intensityLevel } from '../../lib'
import type { HeatCell } from '../../ui/hooks'

export const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const todayKey = () => keyOf(new Date())

/** Local date `n` days before today, as YYYY-MM-DD. */
export function daysAgo(n: number): string {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n)
  return keyOf(d)
}

/** Monday of this week, as YYYY-MM-DD. */
export const weekStartKey = () => daysAgo((new Date().getDay() + 6) % 7)

/** Minutes per active day for one habit (only completed days are present). */
export const minutesByDate = (row: HabitHeatmap | undefined) =>
  new Map((row?.days ?? []).map(d => [d.date, d.minutes] as const))

/** The last `days` days, oldest first, shaded by minutes (timed) or presence (simple). */
export function cellsFor(habit: Habit, byDate: Map<string, number>, days: number): HeatCell[] {
  return Array.from({ length: days }, (_, i) => {
    const date = daysAgo(days - 1 - i)
    const mins = byDate.get(date)
    const done = mins !== undefined
    const level: HeatCell['level'] = !done ? 0 : habit.tracksTime ? Math.max(1, intensityLevel(mins)) as HeatCell['level'] : 3
    const what = !done ? 'nothing logged' : habit.tracksTime ? `${mins} min` : 'done'
    return { date, level, title: `${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${what}` }
  })
}

/** Practice days so far this week (Monday onward). */
export function daysThisWeek(byDate: Map<string, number>): number {
  const start = weekStartKey(), today = todayKey()
  return [...byDate.keys()].filter(d => d >= start && d <= today).length
}

/** Practice days the habit asks for in a full week. */
export const weeklyTarget = (h: Habit) => h.cadence === 'weekly' ? h.targetPerPeriod : 7

export const isWeekly = (h: Habit) => h.cadence === 'weekly'
export const streakUnit = (h: Habit, n: number) => isWeekly(h) ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days')

/** Short cadence line for a habit card. */
export function cadenceLabel(h: Habit, doneThisWeek: number): string {
  if (!isWeekly(h)) return 'Daily'
  const left = Math.max(0, h.targetPerPeriod - doneThisWeek)
  return left === 0 ? `${h.targetPerPeriod}× a week · met` : `${doneThisWeek} of ${h.targetPerPeriod} this week`
}

/** Share of the last 30 days' target that was met, 0–100. */
export function consistency(h: Habit): number {
  const expected = isWeekly(h) ? (h.targetPerPeriod * 30) / 7 : 30
  return Math.round(Math.min(1, h.last30Completed / Math.max(1, expected)) * 100)
}

export type Pace = { text: string; tone: 'good' | 'warn' | undefined }

/** Ahead/behind wording for a goal; schedule-relative so new goals read "On pace". */
export function goalPace(g: Goal): Pace | null {
  if (g.state === 'complete') return { text: 'Complete', tone: 'good' }
  if (g.state === 'stalled') return { text: 'Stalled', tone: 'warn' }
  if (!g.targetDate) return null
  const gap = g.paceGapDays
  if (gap == null) return g.paceStatus === 'ahead' ? { text: 'On pace', tone: 'good' } : { text: 'Behind', tone: 'warn' }
  if (Math.abs(gap) <= 3) return { text: 'On pace', tone: 'good' }
  return gap < 0 ? { text: `${fmtDaySpan(gap)} ahead`, tone: 'good' } : { text: `${fmtDaySpan(gap)} behind`, tone: 'warn' }
}
