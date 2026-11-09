// The habit data the Habits page last loaded. Kept in memory so a habit's page
// opens at once (and still works offline) before its own fetch returns, and
// saved on this device so the next visit today paints at once, then refreshes.
import type { Goal, Habit, HabitHeatmap } from '../../api'

export type Loaded = { habits: Habit[]; heat: HabitHeatmap[]; goals: Goal[]; heatDays: number }

const KEY = 'pd:habits-last'
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Only today's copy: "done today" and streaks are wrong after midnight.
function read(): Loaded | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) as { day: string; data: Loaded } : null
    return v && v.day === today() && Array.isArray(v.data?.habits) ? v.data : null
  } catch { return null }
}
let last: Loaded | null = read()
let lastDay = today()

let pending: ReturnType<typeof setTimeout> | undefined
function save() {
  clearTimeout(pending)
  pending = setTimeout(() => {
    try { if (last) localStorage.setItem(KEY, JSON.stringify({ day: today(), data: last })) } catch { /* full or private */ }
  }, 400)
}

export const rememberHabits = (data: Loaded) => { last = data; lastDay = today(); save() }
export const lastHabits = () => {
  if (last && lastDay !== today()) { last = null } // the app stayed open past midnight
  return last
}
/** Keep a change made elsewhere (e.g. a habit page, perhaps offline) for the list's next visit. */
export const rememberHabit = (habit: Habit, heat?: HabitHeatmap | null) => {
  if (last) {
    last = {
      ...last,
      habits: last.habits.map(h => h.id === habit.id ? habit : h),
      heat: heat ? last.heat.map(r => r.id === heat.id ? heat : r) : last.heat,
    }
    save()
  }
}
