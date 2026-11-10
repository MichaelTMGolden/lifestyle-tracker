// Focus sessions: optional target lengths, the dice roll, and countdown text.
// No imports: the node tests load this file directly.

/** Session lengths the dice can land on, in minutes. Mid lengths come up most. */
export const DICE_FACES = [10, 15, 20, 20, 25, 25, 30, 30, 40, 45, 60] as const
/** Fixed choices shown as chips. */
export const PRESETS = [15, 25, 45, 60] as const

/** A random practice length; `rand` returns [0, 1). */
export const rollMinutes = (rand: () => number = Math.random) => DICE_FACES[Math.floor(rand() * DICE_FACES.length) % DICE_FACES.length]

/** A random item, or null for an empty list. */
export function rollOne<T>(items: readonly T[], rand: () => number = Math.random): T | null {
  return items.length ? items[Math.floor(rand() * items.length) % items.length] : null
}

/** "12:05" left, or "+3:10" past the target. */
export function countdown(targetMinutes: number, elapsedMs: number): { text: string; over: boolean; fraction: number } {
  const left = targetMinutes * 60_000 - elapsedMs
  const over = left <= 0
  const secs = Math.floor(Math.abs(left) / 1000)
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  return { text: over && secs > 0 ? `+${body}` : body, over, fraction: Math.min(1, Math.max(0, elapsedMs / (targetMinutes * 60_000))) }
}

/** The name the Focus picker uses for work sessions. */
export const WORK = 'Work'
export const isWork = (name: string) => name.trim().toLowerCase() === 'work'
