// The habit data the Habits page last loaded, kept in memory so a habit's page
// opens at once, and still works offline, before its own fetch returns.
import type { Goal, Habit, HabitHeatmap } from '../../api'

export type Loaded = { habits: Habit[]; heat: HabitHeatmap[]; goals: Goal[]; heatDays: number }
let last: Loaded | null = null

export const rememberHabits = (data: Loaded) => { last = data }
export const lastHabits = () => last
/** Keep a change made elsewhere (e.g. a habit page, perhaps offline) for the list's next visit. */
export const rememberHabit = (habit: Habit, heat?: HabitHeatmap | null) => {
  if (last) last = {
    ...last,
    habits: last.habits.map(h => h.id === habit.id ? habit : h),
    heat: heat ? last.heat.map(r => r.id === heat.id ? heat : r) : last.heat,
  }
}
