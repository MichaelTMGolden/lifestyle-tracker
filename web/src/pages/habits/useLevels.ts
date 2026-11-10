// Your level and each habit's, plus level-ups noticed while the app is open or
// since the last visit on this device (never on a first visit, so nothing old
// is celebrated as new).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Habit } from '../../api'
import { useToast } from '../../ui/hooks'
import { levelOf, titleFor, xpFor, type Level } from './levels'

const KEY = 'pd:levels-seen'
type Seen = { player: number; habits: Record<string, number> }
const read = (): Seen | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }
const write = (s: Seen) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ } }

export type Levels = { player: Level; byHabit: Map<number, Level> }

export function levelsFor(habits: Habit[]): Levels {
  const byHabit = new Map(habits.map(h => [h.id, levelOf(xpFor(h))] as const))
  const total = [...byHabit.values()].reduce((s, l) => s + l.xp, 0)
  return { player: levelOf(total), byHabit }
}

/** Levels for these habits; a toast for each habit level-up and the player level to celebrate, if any. */
export function useLevels(habits: Habit[], ready: boolean) {
  const toast = useToast()
  const levels = useMemo(() => levelsFor(habits), [habits])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [celebrate, setCelebrate] = useState<{ level: number; title: string; newTitle: boolean } | null>(null)

  useEffect(() => {
    if (!ready || habits.length === 0) return
    const now: Seen = { player: levels.player.level, habits: Object.fromEntries([...levels.byHabit].map(([id, l]) => [String(id), l.level])) }
    const seen = read()
    write({ player: Math.max(now.player, seen?.player ?? 0), habits: { ...seen?.habits, ...now.habits } })
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

  return { levels, celebrate, dismiss: () => setCelebrate(null) }
}
