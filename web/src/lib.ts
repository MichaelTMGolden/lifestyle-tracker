// Shared helpers + display metadata used across pages.

/** Minutes-from-midnight → "7:05". */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

/** ISO date → "Jun 7". */
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Grams → "31 g" (rounded). */
export const fmtMacro = (g: number) => `${Math.round(g)} g`
/** kcal → "1,718" (rounded, thousands-separated). */
export const fmtKcal = (k: number) => Math.round(k).toLocaleString()

/** Food-source key → human label for the source badge. */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'OpenFoodFacts': return 'Open Food Facts'
    case 'Usda': return 'USDA'
    case 'Manual': return 'Manual'
    default: return source
  }
}

/** Elapsed milliseconds → "m:ss" or "h:mm:ss" for a running timer. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  const mm = String(m).padStart(2, '0'), sss = String(ss).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${sss}` : `${mm}:${sss}`
}

/** Minutes → hours for display, e.g. 750 → "12.5h", 60000 → "1,000h". */
export function fmtHours(minutes: number): string {
  const h = minutes / 60
  const rounded = h >= 100 ? Math.round(h) : Math.round(h * 10) / 10
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`
}

/**
 * Map a day's practice minutes to a GitHub-style intensity level (0–4) for
 * heatmap shading. Level 0 means "no practice"; binary skills just use 1.
 */
export function intensityLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0
  if (minutes < 20) return 1
  if (minutes < 40) return 2
  if (minutes < 60) return 3
  return 4
}

/** Local minutes-from-midnight right now. */
export const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

/** Insert a 'now' sentinel into a time-ordered block list at the current time. */
export function withNowLine<T extends { startMinutes: number }>(blocks: T[], now: number): (T | 'now')[] {
  const out: (T | 'now')[] = []
  let inserted = false
  for (const b of blocks) {
    if (!inserted && b.startMinutes > now) { out.push('now'); inserted = true }
    out.push(b)
  }
  if (!inserted) out.push('now')
  return out
}

export interface MetricMeta {
  label: string
  /** transform raw stored value for display */
  unit: string
  chart: 'line' | 'bar'
  color: string
}

const META: Record<string, MetricMeta> = {
  steps: { label: 'Steps', unit: 'steps', chart: 'bar', color: '#34d399' },
  resting_hr: { label: 'Resting HR', unit: 'bpm', chart: 'line', color: '#ef4444' },
  avg_hr: { label: 'Average HR', unit: 'bpm', chart: 'line', color: '#f97316' },
  max_hr: { label: 'Max HR', unit: 'bpm', chart: 'line', color: '#dc2626' },
  min_hr: { label: 'Min HR', unit: 'bpm', chart: 'line', color: '#fb923c' },
  active_calories: { label: 'Active calories', unit: 'kcal', chart: 'bar', color: '#fbbf24' },
  calories_in: { label: 'Calories in', unit: 'kcal', chart: 'bar', color: '#f59e0b' },
  distance_km: { label: 'Distance', unit: 'km', chart: 'bar', color: '#22d3ee' },
  floors: { label: 'Floors climbed', unit: 'floors', chart: 'bar', color: '#2dd4bf' },
  stress_avg: { label: 'Average stress', unit: 'level', chart: 'line', color: '#a855f7' },
  stress_high_min: { label: 'High stress', unit: 'min', chart: 'bar', color: '#c084fc' },
  sleep_total_min: { label: 'Sleep stages', unit: 'min', chart: 'line', color: '#6366f1' },
  sleep_deep_min: { label: 'Deep sleep', unit: 'min', chart: 'bar', color: '#1e3a8a' },
  sleep_light_min: { label: 'Light sleep', unit: 'min', chart: 'bar', color: '#60a5fa' },
  sleep_rem_min: { label: 'REM sleep', unit: 'min', chart: 'bar', color: '#a78bfa' },
  sleep_awake_min: { label: 'Awake', unit: 'min', chart: 'bar', color: '#f87171' },
  sleep_score: { label: 'Sleep score', unit: 'score', chart: 'line', color: '#818cf8' },
  weight_kg: { label: 'Weight', unit: 'kg', chart: 'line', color: '#10b981' },
}

export function metricMeta(key: string): MetricMeta {
  return META[key] ?? { label: key, unit: '', chart: 'line', color: '#6366f1' }
}

/** Distinct colour per tracked habit (falls back by index for unknown names). */
const HABIT_COLORS = ['#2fe6d6', '#ff3d8b', '#9d6bff', '#ffcf6b', '#34d399', '#38bdf8', '#fb7185']
const HABIT_COLOR_BY_NAME: Record<string, string> = {
  Singing: '#ff3d8b',
  Guitar: '#2fe6d6',
  Writing: '#9d6bff',
  Reading: '#ffcf6b',
  Mobility: '#34d399',
}
export function habitColor(name: string, index = 0): string {
  return HABIT_COLOR_BY_NAME[name] ?? HABIT_COLORS[index % HABIT_COLORS.length]
}

/** Schedule category → color (kept in sync with ScheduleCategory on the API). */
export const categoryColor: Record<string, string> = {
  Training: '#34d399',
  Music: '#a78bfa',
  Work: '#60a5fa',
  Meal: '#fbbf24',
  Personal: '#f472b6',
  Sleep: '#818cf8',
  Routine: '#94a3b8',
  Other: '#cbd5e1',
}
