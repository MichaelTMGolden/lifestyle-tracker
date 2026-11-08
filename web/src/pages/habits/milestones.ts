// Streak milestones: a quiet flourish when a streak reaches 7, 30, 100 or 365 days
// (4, 12, 26 or 52 weeks for weekly habits) during this visit. Streaks seen on
// load never fire, so reopening the app doesn't repeat one.
import { useEffect, useRef, useState } from 'react'
import type { Habit } from '../../api'
import { haptic } from '../../ui/feedback'
import { useToast } from '../../ui/hooks'
import { crossedMilestone } from './crossedMilestone'

/** Shows a toast for a milestone just reached and returns that habit's id while it glows. */
export function useStreakMilestones(habits: Habit[]): number | null {
  const seen = useRef<Map<number, number> | null>(null)
  const toast = useToast()
  const [glow, setGlow] = useState<number | null>(null)
  useEffect(() => {
    if (!habits.length) return
    const before = seen.current
    seen.current = new Map(habits.map(h => [h.id, h.currentStreak]))
    if (!before) return
    for (const h of habits) {
      const prev = before.get(h.id)
      if (prev == null) continue
      const weekly = h.cadence === 'weekly'
      const m = crossedMilestone(prev, h.currentStreak, weekly)
      if (m == null) continue
      toast.show({ message: `${m}-${weekly ? 'week' : 'day'} streak · ${h.name}` })
      haptic([12, 70, 12])
      setGlow(h.id)
      break
    }
  }, [habits, toast])
  useEffect(() => {
    if (glow == null) return
    const t = setTimeout(() => setGlow(null), 2400)
    return () => clearTimeout(t)
  }, [glow])
  return glow
}
