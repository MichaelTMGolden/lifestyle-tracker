// Thin typed client over the C# API. In dev, Vite proxies "/api" to :5080.

export interface CalendarEvent {
  id: number
  title: string
  startsAt: string
  endsAt: string
  allDay: boolean
  location: string | null
}

export interface Summary {
  latestWeightKg: number | null
  latestRestingHr: number | null
  avgSleepHoursThisWeek: number | null
  stepsThisWeek: number
  workoutsThisWeek: number
  habitsCompletedToday: number
  habitsTotal: number
  openTodos: number
  upcomingEvents: CalendarEvent[]
}

export interface SleepNight {
  date: string
  deep: number
  light: number
  rem: number
  awake: number
  score: number | null
}

export interface MetricPoint {
  recordedAt: string
  value: number
  unit: string | null
}

export interface Habit {
  id: number
  name: string
  cadence: string
  tracksTime: boolean
  last30Completed: number
  doneToday: boolean
  minutesToday: number
  totalMinutes: number
  totalCompletions: number
  currentStreak: number
}

export interface Todo {
  id: number
  title: string
  notes: string | null
  priority: number
  createdAt: string
  dueAt: string | null
  completedAt: string | null
}

export interface Workout {
  id: number
  type: string
  startedAt: string
  durationMinutes: number
  distanceMeters: number | null
  calories: number | null
  averageHeartRate: number | null
}

export interface CurrentBlock {
  activity: string
  startMinutes: number
  durationMinutes: number | null
  category: string
}
export interface NextBlock {
  activity: string
  startMinutes: number
  category: string
}

export interface Today {
  stepsToday: number
  caloriesInToday: number
  restingHr: number | null
  bodyBattery: number | null
  lastSleepScore: number | null
  sleepAvg14: number | null
  sleepSpark: number[]
  rhrSpark: number[]
  stepsSpark: number[]
  readiness: number
  readinessLabel: string
  habitsCompletedToday: number
  habitsTotal: number
  todosDueToday: number
  todosOverdue: number
  nowMinutes: number
  current: CurrentBlock | null
  next: NextBlock | null
  tomorrowFirst: { activity: string; startMinutes: number } | null
}

export interface ScheduleBlock {
  id: number
  startMinutes: number
  durationMinutes: number | null
  activity: string
  notes: string | null
  category: string
  protected: boolean
  overlapped?: boolean
}

export interface ScheduleToday {
  day: string
  blocks: ScheduleBlock[]
  events: CalendarEvent[]
}

export interface ScheduleDay {
  day: string
  blocks: ScheduleBlock[]
}

export interface MetricKey {
  key: string
  unit: string | null
  count: number
}

export interface HabitHeatmap {
  id: number
  name: string
  tracksTime: boolean
  /** active days with their accumulated minutes (drives intensity shading) */
  days: { date: string; minutes: number }[]
  /** kept for backward compatibility */
  completedDates: string[]
}

export interface GoalSource {
  habitId: number
  name: string
  minutes: number
}

export interface Goal {
  id: number
  name: string
  targetMinutes: number
  colorHex: string | null
  startDate: string | null
  targetDate: string | null
  accumulatedMinutes: number
  progress: number
  remainingMinutes: number
  weeklyMinutes: number
  dailyRateMinutes: number
  lifetimeDailyRateMinutes: number
  projectedDate: string | null
  requiredDailyRateMinutes: number | null
  paceStatus: 'ahead' | 'behind' | null
  paceDeltaMinutesPerDay: number | null
  expectedFraction: number | null
  projectedVsTargetDays: number | null
  paceGapDays: number | null
  state: 'active' | 'complete' | 'overdue' | 'stalled'
  completedOn: string | null
  archived: boolean
  sources: GoalSource[]
}

export interface GoalInput {
  name: string
  targetHours: number
  colorHex?: string | null
  startDate?: string | null
  targetDate?: string | null
  sourceHabitIds: number[]
}

export interface BingoSquare {
  id: number
  position: number
  label: string
  note: string | null
  completed: boolean
  completedAt: string | null
}

export interface BingoBoard {
  year: number
  title: string | null
  squares: BingoSquare[]
  completedCount: number
  completedLines: number[]
  blackout: boolean
}

export interface Alert {
  id: number
  kind: string
  severity: 'Info' | 'Watch' | 'Urgent'
  subjectType: 'Metric' | 'Goal' | 'Habit'
  subjectKey: string
  title: string
  detail: string
  value: number | null
  expectedLow: number | null
  expectedHigh: number | null
  forDate: string
  detectedAt: string
  status: string
}

export interface Connection {
  kind: string
  name: string
  mode: string
  configured: boolean
  status: string
  lastSyncedAt: string | null
  records: number
}
export interface SyncResult { ok: boolean; records: number; message: string }

export interface DailyTodo {
  id: number
  date: string
  title: string
  done: boolean
  createdAt: string
}

export interface MacroSet { kcal: number; protein: number; carbs: number; fat: number }
export interface MicroSet {
  fiberG: number; sugarG: number; satFatG: number
  sodiumMg: number; potassiumMg: number; calciumMg: number; ironMg: number
}

export interface FoodSearchResult {
  name: string
  brand: string | null
  source: string // SourceKind name: "OpenFoodFacts" | "Usda"
  externalRef: string | null
  servingDescription: string | null
  per100g: MacroSet
  perServing: MacroSet | null
  microsPer100g: MicroSet
  microsPerServing: MicroSet | null
}

export interface FoodEntry {
  id: number
  dataSourceId: number
  date: string
  loggedAt: string
  name: string
  brand: string | null
  externalRef: string | null
  servingDescription: string | null
  quantity: number
  grams: number | null
  meal: string // MealType name
  source: string // SourceKind name of the originating food DB
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  sugarG: number
  satFatG: number
  sodiumMg: number
  potassiumMg: number
  calciumMg: number
  ironMg: number
}

export interface NutritionTotals {
  calories: number; proteinG: number; carbsG: number; fatG: number
  fiberG: number; sugarG: number; satFatG: number
  sodiumMg: number; potassiumMg: number; calciumMg: number; ironMg: number
}

export interface SavedFood {
  id: number
  name: string
  brand: string | null
  dataSourceId: number | null
  externalRef: string | null
  servingDescription: string | null
  defaultQuantity: number
  grams: number | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  favorite: boolean
  useCount: number
  lastUsedAt: string | null
}

export interface QuickMealItem {
  id?: number
  name: string
  brand?: string | null
  dataSourceId?: number | null
  externalRef?: string | null
  servingDescription?: string | null
  quantity: number
  grams?: number | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface QuickMeal {
  id: number
  name: string
  defaultMeal: string | null
  useCount: number
  lastUsedAt: string | null
  itemCount: number
  totalCalories: number
  totalProteinG: number
  totalCarbsG: number
  totalFatG: number
}

export interface QuickMealDetail {
  id: number
  name: string
  defaultMeal: string | null
  items: QuickMealItem[]
}

export interface NutritionDay {
  date: string
  entries: FoodEntry[]
  totals: NutritionTotals
  targets: { proteinG: number; calories: number }
}

export interface FoodEntryInput {
  date?: string
  meal?: string
  name: string
  brand?: string | null
  source: string
  externalRef?: string | null
  servingDescription?: string | null
  quantity: number
  grams?: number | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  sugarG?: number
  satFatG?: number
  sodiumMg?: number
  potassiumMg?: number
  calciumMg?: number
  ironMg?: number
}

// Send the device's current UTC offset so the API resolves "today/now" in the
// user's local timezone — correct even while travelling.
const tzHeaders = () => ({ 'X-Tz-Offset': String(new Date().getTimezoneOffset()) })

async function errorFrom(res: Response, url: string): Promise<Error> {
  try { const j = await res.json(); if (j?.error || j?.message) return new Error(j.error || j.message) } catch { /* not json */ }
  return new Error(`${url} -> ${res.status}`)
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: tzHeaders(), credentials: 'include' })
  if (!res.ok) throw await errorFrom(res, url)
  return res.json() as Promise<T>
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tzHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw await errorFrom(res, url)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
const post = <T>(url: string, body?: unknown) => send<T>('POST', url, body)

// Auth (shared-password gate). login returns false on a wrong password rather than throwing.
export interface AuthState { required: boolean; authed: boolean }
async function login(password: string): Promise<boolean> {
  const res = await fetch('/api/auth/login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tzHeaders() },
    body: JSON.stringify({ password }),
  })
  return res.ok
}

export interface TodoInput {
  title: string
  notes?: string | null
  priority: number
  dueAt?: string | null
}

export const api = {
  authStatus: () => get<AuthState>('/api/auth/status'),
  login,
  logout: () => post('/api/auth/logout'),

  summary: () => get<Summary>('/api/summary'),
  metric: (key: string, days = 90) => get<MetricPoint[]>(`/api/metrics/${key}?days=${days}`),
  metricKeys: () => get<MetricKey[]>('/api/metrics'),
  sleep: (days = 30) => get<SleepNight[]>(`/api/sleep?days=${days}`),
  today: () => get<Today>('/api/today'),
  scheduleToday: () => get<ScheduleToday>('/api/schedule/today'),
  scheduleWeek: () => get<ScheduleDay[]>('/api/schedule/week'),
  workouts: () => get<Workout[]>('/api/workouts'),
  habits: () => get<Habit[]>('/api/habits'),
  habitsHeatmap: (days = 182) => get<HabitHeatmap[]>(`/api/habits/heatmap?days=${days}`),
  toggleHabit: (id: number) => post(`/api/habits/${id}/toggle`),
  createHabit: (name: string, tracksTime: boolean) => post<Habit>('/api/habits', { name, tracksTime }),
  deleteHabit: (id: number) => send<void>('DELETE', `/api/habits/${id}`),
  logHabitTime: (id: number, minutes: number) => post(`/api/habits/${id}/log-time`, { minutes }),

  // Server-side running timers (sync across devices). startedAt is epoch ms (server clock).
  activeTimers: () => get<{ habitId: number; habitName: string; startedAt: number }[]>('/api/timers'),
  startTimer: (habitId: number) => post<{ habitId: number; habitName: string; startedAt: number }>(`/api/timers/${habitId}`),
  stopTimer: (habitId: number) => send<{ habitId: number; minutes: number }>('DELETE', `/api/timers/${habitId}`),
  setHabitToday: (id: number, minutes: number) => send('PUT', `/api/habits/${id}/today`, { minutes }),
  toggleHabitTracksTime: (id: number) => post<{ id: number; tracksTime: boolean }>(`/api/habits/${id}/tracks-time`),

  goals: () => get<Goal[]>('/api/goals'),
  createGoal: (input: GoalInput) => post<{ id: number }>('/api/goals', input),
  updateGoal: (id: number, input: GoalInput) => send<{ id: number }>('PUT', `/api/goals/${id}`, input),
  deleteGoal: (id: number) => send<void>('DELETE', `/api/goals/${id}`),
  archiveGoal: (id: number) => send<{ id: number; archived: boolean }>('PUT', `/api/goals/${id}/archive`),
  unarchiveGoal: (id: number) => send<{ id: number; archived: boolean }>('PUT', `/api/goals/${id}/unarchive`),
  todos: () => get<Todo[]>('/api/todos'),
  toggleTodo: (id: number) => post<Todo>(`/api/todos/${id}/toggle`),
  createTodo: (input: TodoInput) => post<Todo>('/api/todos', input),
  updateTodo: (id: number, input: TodoInput) => send<Todo>('PUT', `/api/todos/${id}`, input),
  deleteTodo: (id: number) => send<void>('DELETE', `/api/todos/${id}`),

  addWeight: (value: number) => post<{ ok: boolean; value: number }>('/api/weight', { value }),

  connections: () => get<Connection[]>('/api/connections'),
  syncConnection: (kind: string) => post<SyncResult>(`/api/connections/${kind}/sync`),

  // Garmin live connection (credentials stored server-side; sync runs via the sidecar)
  garminStatus: () => get<{ configured: boolean; email: string | null; lastSyncedAt: string | null; sampleCount: number }>('/api/connections/garmin'),
  garminConnect: (email: string, password: string) => post<{ configured: boolean }>('/api/connections/garmin/credentials', { email, password }),
  garminSync: (days?: number) => post<{ written: number; days: number }>('/api/connections/garmin/sync', { days }),
  garminDisconnect: () => send<{ configured: boolean }>('DELETE', '/api/connections/garmin/credentials'),
  garminClearSamples: () => post<{ deleted: number }>('/api/connections/garmin/clear-samples'),

  // Google Calendar (read-only; one or more calendars via their secret iCal URLs)
  googleStatus: () => get<{ configured: boolean; calendars: { id: string; label: string }[]; lastSyncedAt: string | null; eventCount: number }>('/api/connections/google'),
  googleAddCalendar: (icsUrl: string, label?: string) => post<{ id: string; label: string }>('/api/connections/google/calendars', { icsUrl, label }),
  googleRemoveCalendar: (id: string) => send<{ calendars: number }>('DELETE', `/api/connections/google/calendars/${id}`),
  googleSync: () => post<{ events: number; calendars: number; failures: string[] }>('/api/connections/google/sync'),
  googleDisconnect: () => send<{ configured: boolean }>('DELETE', '/api/connections/google/credentials'),
  importGarmin: async (files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    const res = await fetch('/api/connections/garmin/import', { method: 'POST', headers: tzHeaders(), body: fd })
    if (!res.ok) throw new Error(`import -> ${res.status}`)
    return res.json() as Promise<{ ok: boolean; filesSaved: number; records: number; message: string }>
  },

  foodSearch: (q: string, country = 'ie') =>
    get<FoodSearchResult[]>(`/api/food/search?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}`),
  nutritionDay: (date?: string) => get<NutritionDay>(`/api/nutrition/day${date ? `?date=${date}` : ''}`),

  rememberedFoods: (tab?: string, q?: string) => {
    const p = new URLSearchParams()
    if (tab) p.set('tab', tab)
    if (q) p.set('q', q)
    const qs = p.toString()
    return get<SavedFood[]>(`/api/foods/remembered${qs ? `?${qs}` : ''}`)
  },
  logSavedFood: (id: number, body: { date?: string; meal?: string; quantity?: number }) => post<FoodEntry>(`/api/foods/${id}/log`, body),
  favoriteSavedFood: (id: number) => post<{ id: number; favorite: boolean }>(`/api/foods/${id}/favorite`),
  deleteSavedFood: (id: number) => send<void>('DELETE', `/api/foods/${id}`),

  quickMeals: () => get<QuickMeal[]>('/api/quick-meals'),
  quickMeal: (id: number) => get<QuickMealDetail>(`/api/quick-meals/${id}`),
  createQuickMeal: (body: { name: string; defaultMeal?: string | null; items: QuickMealItem[] }) => post<{ id: number }>('/api/quick-meals', body),
  quickMealFromLog: (body: { name: string; date: string; meal: string }) => post<{ id: number }>('/api/quick-meals/from-log', body),
  updateQuickMeal: (id: number, body: { name: string; defaultMeal?: string | null; items?: QuickMealItem[] }) => send<{ id: number }>('PUT', `/api/quick-meals/${id}`, body),
  deleteQuickMeal: (id: number) => send<void>('DELETE', `/api/quick-meals/${id}`),
  logQuickMeal: (id: number, body: { date?: string; meal?: string }) => post<{ logged: number; date: string }>(`/api/quick-meals/${id}/log`, body),
  createFoodEntry: (input: FoodEntryInput) => post<FoodEntry>('/api/nutrition/entries', input),
  updateFoodEntry: (id: number, input: FoodEntryInput) => send<FoodEntry>('PUT', `/api/nutrition/entries/${id}`, input),
  deleteFoodEntry: (id: number) => send<void>('DELETE', `/api/nutrition/entries/${id}`),

  bingo: (year?: number) => get<BingoBoard>(`/api/bingo${year ? `?year=${year}` : ''}`),
  bingoYears: () => get<number[]>('/api/bingo/years'),
  editBingoSquare: (id: number, input: { label?: string; note?: string }) => send<BingoBoard>('PUT', `/api/bingo/squares/${id}`, input),
  toggleBingoSquare: (id: number) => post<BingoBoard>(`/api/bingo/squares/${id}/toggle`),
  renameBingoBoard: (year: number, title: string) => send<BingoBoard>('PUT', `/api/bingo/board/${year}`, { title }),

  alerts: (status?: string) => get<Alert[]>(`/api/alerts${status ? `?status=${status}` : ''}`),
  refreshAlerts: () => post<Alert[]>('/api/alerts/refresh'),
  dismissAlert: (id: number) => post<void>(`/api/alerts/${id}/dismiss`),

  dailyTodos: () => get<DailyTodo[]>('/api/daily-todos'),
  createDailyTodo: (title: string) => post<DailyTodo>('/api/daily-todos', { title }),
  toggleDailyTodo: (id: number) => post<DailyTodo>(`/api/daily-todos/${id}/toggle`),
  deleteDailyTodo: (id: number) => send<void>('DELETE', `/api/daily-todos/${id}`),
}
