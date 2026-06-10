// Shared helpers + display metadata used across pages.

/** Minutes-from-midnight → "7:05". */
export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

/** Locale used app-wide: Ireland → day/month/year ordering. */
export const LOCALE = 'en-IE'

/** ISO date → "7/6" (day/month, Irish order). */
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'numeric' })

/** ISO date → "07/06/2026" (full Irish d/m/y). */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' })

/** The 12 bingo lines as position sets — mirrors the server geometry (line id = index). */
export const BINGO_LINES: number[][] = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
]
export const BINGO_LINE_LABELS = [
  'top row', 'second row', 'middle row', 'fourth row', 'bottom row',
  'first column', 'second column', 'middle column', 'fourth column', 'last column',
  'diagonal', 'diagonal',
]

/** Alert severity → display treatment. Urgent is the only loud one. */
export function alertSeverity(sev: string): { color: string; loud: boolean } {
  switch (sev) {
    case 'Urgent': return { color: 'var(--bad)', loud: true }
    case 'Watch': return { color: 'var(--watch)', loud: false }
    default: return { color: 'var(--text-dim)', loud: false }
  }
}

/** ISO date → "Mar 2027" (for goal ETA / projected completion). */
export const fmtMonthYear = (iso: string) =>
  new Date(iso).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' })

/** Whole days between two ISO dates (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/** A day count → human span: "8 days" / "2 weeks" / "3 months". */
export function fmtDaySpan(days: number): string {
  const d = Math.abs(Math.round(days))
  if (d < 14) return `${d} day${d === 1 ? '' : 's'}`
  if (d < 60) return `${Math.round(d / 7)} weeks`
  return `${Math.round(d / 30)} months`
}

/** Grams → "31 g" (rounded). */
export const fmtMacro = (g: number) => `${Math.round(g)} g`
/** kcal → "1,718" (rounded, thousands-separated). */
export const fmtKcal = (k: number) => Math.round(k).toLocaleString()

/** Compact macro summary for chips/rows: "320 kcal · 12P / 52C / 7F". */
export const macroSummary = (m: { calories: number; proteinG: number; carbsG: number; fatG: number }) =>
  `${Math.round(m.calories)} kcal · ${Math.round(m.proteinG)}P / ${Math.round(m.carbsG)}C / ${Math.round(m.fatG)}F`

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
