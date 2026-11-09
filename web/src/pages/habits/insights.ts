// Pure maths for the habit page and Stats: weekday rhythm, weekly and monthly totals.
// Works on YYYY-MM-DD keys at UTC noon, so daylight saving never shifts a day.
// No imports: the node tests load this file directly.

const parse = (k: string) => new Date(`${k}T12:00:00Z`)
const keyOf = (d: Date) => d.toISOString().slice(0, 10)

export function addDays(k: string, n: number): string {
  const d = parse(k); d.setUTCDate(d.getUTCDate() + n); return keyOf(d)
}
/** Monday of the week holding `k`. */
export const mondayOf = (k: string) => addDays(k, -((parse(k).getUTCDay() + 6) % 7))
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (k: string) => (parse(k).getUTCDay() + 6) % 7

export type HabitRhythm = { cadence: string; targetPerPeriod: number }
/** Days a habit asks for out of `days` days. */
export const expectedDays = (h: HabitRhythm, days: number) => h.cadence === 'weekly' ? (h.targetPerPeriod * days) / 7 : days

/** The earliest logged day, or null when there are none. */
export const firstDay = (byDate: ReadonlyMap<string, number>) =>
  [...byDate.keys()].reduce<string | null>((m, d) => m == null || d < m ? d : m, null)

export type Slot = { done: number; total: number }

/**
 * For each weekday (Monday first): how many of the last `weeks` weeks it was done,
 * out of how many such days there were. Days before `from` (the habit's first
 * log) and after `today` are left out, so a new habit isn't marked as missing;
 * today counts only once it is done.
 */
export function weekdayRates(byDate: ReadonlyMap<string, number>, today: string, weeks = 12, from?: string | null): Slot[] {
  const slots: Slot[] = Array.from({ length: 7 }, () => ({ done: 0, total: 0 }))
  const start = addDays(mondayOf(today), -7 * (weeks - 1))
  for (let d = start; d <= today; d = addDays(d, 1)) {
    if (from && d < from) continue
    if (d === today && !byDate.has(d)) continue // today isn't missed yet
    const s = slots[weekdayOf(d)]
    s.total++
    if (byDate.has(d)) s.done++
  }
  return slots
}

export type Week = { start: string; days: number; minutes: number }

/** The last `weeks` weeks (Monday start), oldest first, with practice days and minutes. */
export function weeklyTotals(byDate: ReadonlyMap<string, number>, today: string, weeks = 12): Week[] {
  const first = addDays(mondayOf(today), -7 * (weeks - 1))
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(first, i * 7)
    let days = 0, minutes = 0
    for (let j = 0; j < 7; j++) {
      const m = byDate.get(addDays(start, j))
      if (m !== undefined) { days++; minutes += m }
    }
    return { start, days, minutes }
  })
}

export type Month = { month: string; days: number; minutes: number; elapsed: number }

/** The last `months` calendar months, oldest first; `elapsed` counts days up to today. */
export function monthlyTotals(byDate: ReadonlyMap<string, number>, today: string, months = 12): Month[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (months - 1 - i), 1, 12))
    const month = keyOf(d).slice(0, 7)
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate()
    let days = 0, minutes = 0, elapsed = 0
    for (let day = 1; day <= lastDay; day++) {
      const k = `${month}-${String(day).padStart(2, '0')}`
      if (k > today) break
      elapsed++
      const v = byDate.get(k)
      if (v !== undefined) { days++; minutes += v }
    }
    return { month, days, minutes, elapsed }
  })
}

export type Tracked = {
  habit: HabitRhythm; byDate: ReadonlyMap<string, number>
  /** The habit's first ever entry; `byDate` may only hold a recent window. */
  from?: string | null
}

/**
 * Share of what all habits asked for that was done, per month (0–1, or null for a
 * month before any habit started). Each habit counts only from its first log,
 * and weekly habits ask for their target, not every day.
 */
export function monthlyRates(rows: Tracked[], today: string, months = 12): { month: string; rate: number | null }[] {
  const per = rows.map(r => ({ r, from: r.from ?? firstDay(r.byDate), months: monthlyTotals(r.byDate, today, months) }))
  return Array.from({ length: months }, (_, i) => {
    let done = 0, asked = 0
    for (const { r, from, months: ms } of per) {
      const mo = ms[i]
      if (!from || mo.elapsed === 0) continue
      // Days of this month on or after the habit's first log.
      const startDay = from.slice(0, 7) === mo.month ? Number(from.slice(8)) : from.slice(0, 7) < mo.month ? 1 : null
      if (startDay == null) continue
      const span = mo.elapsed - startDay + 1
      if (span <= 0) continue
      const want = expectedDays(r.habit, span)
      asked += want
      // Extra days on one habit don't make up for misses on another.
      done += Math.min(mo.days, want)
    }
    return { month: per[0]?.months[i]?.month ?? '', rate: asked > 0 ? Math.min(1, done / asked) : null }
  })
}

/** The week with the most practice days across all habits (ties: the latest). */
export function bestWeek(rows: Tracked[], today: string, weeks = 53): { start: string; days: number; minutes: number } | null {
  const totals = rows.map(r => weeklyTotals(r.byDate, today, weeks))
  let best: { start: string; days: number; minutes: number } | null = null
  for (let i = 0; i < weeks; i++) {
    const days = totals.reduce((s, t) => s + t[i].days, 0)
    const minutes = totals.reduce((s, t) => s + t[i].minutes, 0)
    if (days > 0 && (!best || days >= best.days)) best = { start: totals[0][i].start, days, minutes }
  }
  return best
}
