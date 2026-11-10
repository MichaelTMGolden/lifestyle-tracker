// Your level and each habit's, plus level-ups noticed while the app is open or
// since the last visit on this device (never on a first visit, so nothing old
// is celebrated as new).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Habit } from '../../api'
import type { SkillGoal } from '../../skillGoals'
import { useToast } from '../../ui/hooks'
import { useSkillGoals } from './useSkillGoals'
import { goalXp, levelOf, titleFor, xpFor, type Level } from './levels'

const KEY = 'pd:levels-seen'
type Seen = { player: number; habits: Record<string, number> }
const read = (): Seen | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }
const write = (s: Seen) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }

export type Levels = { player: Level; byHabit: Map<number, Level> }

/** Each habit's level (its logs plus its skill goals) and yours (all of them). */
export function levelsFor(habits: Habit[], goals: SkillGoal[] = []): Levels {
  const byHabit = new Map(habits.map(h => [h.id, levelOf(xpFor(h) + goalXp(goals.filter(g => g.habitId === h.id)))] as const))
  const total = [...byHabit.values()].reduce((s, l) => s + l.xp, 0)
  return { player: levelOf(total), byHabit }
}

/** Levels for these habits; a toast for each habit level-up and the player level to celebrate, if any. */
export function useLevels(habits: Habit[], habitsReady: boolean) {
  const toast = useToast()
  // Until goals load, levels would read low: hold the baseline until they do.
  const goals = useSkillGoals()
  const ready = habitsReady && goals.loaded
  const levels = useMemo(() => levelsFor(habits, goals.all), [habits, goals.all])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [celebrate, setCelebrate] = useState<{ level: number; title: string; newTitle: boolean } | null>(null)

  useEffect(() => {
    if (!ready || habits.length === 0) return
    const now: Seen = { player: levels.player.level, habits: Object.fromEntries([...levels.byHabit].map(([id, l]) => [String(id), l.level])) }
    const seen = read()
    // Highest level ever seen, for you and each habit: an older cached copy
    // (Today repaints from one before refetching) must never lower the baseline,
    // or the same level-up would be announced again.
    const habitsSeen: Record<string, number> = { ...seen?.habits }
    for (const [id, level] of Object.entries(now.habits)) habitsSeen[id] = Math.max(level, habitsSeen[id] ?? 0)
    write({ player: Math.max(now.player, seen?.player ?? 0), habits: habitsSeen })
    if (!seen) return
    for (const h of habits) {
      const before = seen.habits[String(h.id)], after = now.habits[String(h.id)]
      if (before != null && after > before) toast.show({ message: `${h.name} reached level ${after}` })
    }
    if (now.player <= seen.player) return
    const up = { level: now.player, title: titleFor(now.player), newTitle: titleFor(now.player) !== titleFor(seen.player) }
    // Next tick, once the page has rendered. Not cancelled by a re-run: the new
    // level is already recorded as seen, so it would never be shown otherwise.
    setTimeout(() => { if (mounted.current) setCelebrate(up) }, 0)
  }, [levels, habits, ready, toast])

  // Stable, so pages re-rendering every second (a running timer) don't restart
  // the celebration's auto-close.
  const dismiss = useCallback(() => setCelebrate(null), [])
  return { levels, celebrate, dismiss }
}
