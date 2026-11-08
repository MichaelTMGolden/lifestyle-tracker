// Streak milestone thresholds; pure, so tests can import it directly.
const DAILY = [7, 30, 100, 365]
const WEEKLY = [4, 12, 26, 52]

/** The highest milestone passed going from `prev` to `next`, or null. */
export function crossedMilestone(prev: number, next: number, weekly: boolean): number | null {
  const hit = (weekly ? WEEKLY : DAILY).filter(m => prev < m && m <= next)
  return hit.length ? hit[hit.length - 1] : null
}
