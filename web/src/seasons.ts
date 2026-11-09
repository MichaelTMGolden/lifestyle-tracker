// Seasons: a few habits in focus for a while; the rest are tracked but not expected.
// No season covering a day means every habit was in focus that day.
// No imports: the node tests load this file directly.

export type SeasonRow = { id: number; name: string | null; startsOn: string; endsOn: string | null; habitIds: number[] }

/** The season covering `day` (YYYY-MM-DD), if any. Seasons never overlap. */
export const seasonOn = (seasons: readonly SeasonRow[], day: string): SeasonRow | null =>
  seasons.find(s => s.startsOn <= day && (s.endsOn == null || s.endsOn >= day)) ?? null

/**
 * Seasons that still have a habit in them. A season whose habits were all
 * deleted counts as no season (every habit in focus), as on Today and Habits.
 */
export const liveSeasons = (seasons: readonly SeasonRow[], habitIds: readonly number[]): SeasonRow[] =>
  seasons.filter(s => s.habitIds.some(id => habitIds.includes(id)))

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
