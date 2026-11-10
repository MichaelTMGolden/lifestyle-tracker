// Levels: XP, levels, titles and badges, all worked out from what is already
// logged (nothing extra is stored, so they can't drift from your history).
// No imports: the node tests load this file directly.

export type Practice = {
  name: string
  tracksTime: boolean
  cadence: string
  totalMinutes: number
  totalCompletions: number
  /** Longest run in the past year: days, or weeks for weekly habits. */
  bestStreak: number
}

/**
 * XP for one habit. Timed: a point a minute plus 10 per practice day, so short
 * daily sessions still count. Ticked: 30 per day. Best run: 5 a day (20 a week).
 */
export function xpFor(p: Practice): number {
  const work = p.tracksTime ? p.totalMinutes + 10 * p.totalCompletions : 30 * p.totalCompletions
  const run = p.cadence === 'weekly' ? 20 * p.bestStreak : 5 * p.bestStreak
  return Math.max(0, Math.round(work + run))
}

/** XP needed to reach `level` (level 1 is free): 50 × (level − 1)². */
export const xpForLevel = (level: number) => 50 * (level - 1) ** 2

export type Level = { level: number; xp: number; floor: number; next: number; fraction: number }

export function levelOf(xp: number): Level {
  const level = 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50))
  const floor = xpForLevel(level), next = xpForLevel(level + 1)
  return { level, xp, floor, next, fraction: (xp - floor) / (next - floor) }
}

const TITLES: [number, string][] = [
  [45, 'Legend'], [36, 'Grandmaster'], [28, 'Master'], [21, 'Virtuoso'],
  [15, 'Disciple'], [10, 'Adept'], [6, 'Acolyte'], [3, 'Novice'], [1, 'Initiate'],
]
export const titleFor = (level: number) => TITLES.find(([min]) => level >= min)![1]
/** The level the next title starts at, or null at the top. */
export const nextTitleAt = (level: number) => [...TITLES].reverse().find(([min]) => min > level)?.[0] ?? null

export type Badge = { id: string; name: string; detail: string; earned: boolean; progress: string }

/** Badges across all habits, earned or not, in display order. */
export function badges(habits: Practice[]): Badge[] {
  const best = (f: (p: Practice) => number) => habits.reduce((m, p) => Math.max(m, f(p)), 0)
  const dayRun = best(p => p.cadence === 'weekly' ? 0 : p.bestStreak)
  const topHours = best(p => p.tracksTime ? p.totalMinutes / 60 : 0)
  const allHours = habits.reduce((s, p) => s + (p.tracksTime ? p.totalMinutes / 60 : 0), 0)
  const days = habits.reduce((s, p) => s + p.totalCompletions, 0)
  const broad = habits.filter(p => p.totalCompletions >= 10).length
  const b = (id: string, name: string, detail: string, have: number, need: number, unit: string): Badge =>
    ({ id, name, detail, earned: have >= need, progress: `${Math.min(Math.floor(have), need)} / ${need} ${unit}` })
  return [
    b('first-light', 'First Light', 'Log your first practice', days, 1, 'day'),
    b('seven-nights', 'Seven Nights', 'A 7-day run on any habit', dayRun, 7, 'days'),
    b('moon-cycle', 'Moon Cycle', 'A 30-day run on any habit', dayRun, 30, 'days'),
    b('centurion', 'Centurion', 'A 100-day run on any habit', dayRun, 100, 'days'),
    b('ten-hours', 'Ten Hours', '10 hours on one habit', topHours, 10, 'h'),
    b('hundred-hours', 'The Hundred', '100 hours on one habit', topHours, 100, 'h'),
    b('five-hundred', 'Five Hundred', '500 hours on one habit', topHours, 500, 'h'),
    b('thousand', 'The Thousand', '1,000 hours across everything', allHours, 1000, 'h'),
    b('polymath', 'Polymath', '10+ days on five different habits', broad, 5, 'habits'),
    b('devotion', 'Devotion', '365 practice days in all', days, 365, 'days'),
  ]
}
