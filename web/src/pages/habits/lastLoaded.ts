// The habit data the Habits page last loaded, kept in memory so a habit's page
// opens at once, and still works offline, before its own fetch returns.
import type { Goal, Habit, HabitHeatmap } from '../../api'

export type Loaded = { habits: Habit[]; heat: HabitHeatmap[]; goals: Goal[]; heatDays: number }
let last: Loaded | null = null

export const rememberHabits = (data: Loaded) => { last = data }
export const lastHabits = () => last
