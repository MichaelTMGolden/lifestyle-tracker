// Seasons: a few habits in focus for a while; the rest are tracked but not expected.
// No season covering a day means every habit was in focus that day.
// No imports: the node tests load this file directly.

export type SeasonRow = { id: number; name: string | null; startsOn: string; endsOn: string | null; habitIds: number[] }

/** The season covering `day` (YYYY-MM-DD), if any. Seasons never overlap. */
export const seasonOn = (seasons: readonly SeasonRow[], day: string): SeasonRow | null =>
  seasons.find(s => s.startsOn <= day && (s.endsOn == null || s.endsOn >= day)) ?? null

/**
 * Seasons as they count from here on: one still running (or not started) whose
 * habits were all deleted counts as no season, as on Today and Habits. Past
 * seasons keep their history whatever was deleted since.
 */
export const liveSeasons = (seasons: readonly SeasonRow[], habitIds: readonly number[], today: string): SeasonRow[] =>
  seasons.filter(s => (s.endsOn != null && s.endsOn < today) || s.habitIds.some(id => habitIds.includes(id)))

/** Last day (inclusive) of a season lasting `months` from `today`, clamped for short months. */
export function seasonEnd(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  target.setUTCDate(target.getUTCDate() - 1)
  return target.toISOString().slice(0, 10)
}

/** Whether a habit was expected on `day`. Pass `liveSeasons(...)` so emptied seasons don't count. */
export function inFocusOn(seasons: readonly SeasonRow[], habitId: number, day: string): boolean {
  const s = seasonOn(seasons, day)
  return !s || s.habitIds.includes(habitId)
}

/**
 * Focus habits first, then the rest, for the season covering today. A season
 * whose habits were all deleted counts as none, so nothing is hidden by accident.
 */
export function splitByFocus<T extends { id: number }>(habits: readonly T[], season: SeasonRow | null): { focus: T[]; others: T[] } {
  if (!season || !habits.some(h => season.habitIds.includes(h.id))) return { focus: [...habits], others: [] }
  return { focus: habits.filter(h => season.habitIds.includes(h.id)), others: habits.filter(h => !season.habitIds.includes(h.id)) }
}
