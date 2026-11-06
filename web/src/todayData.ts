// The Today page's data: one cached request (GET /api/today/bundle) plus
// optimistic writes. A tap changes the screen at once; the server's reply then
// replaces the changed item. Nothing reloads the whole page after a tap.
import { useMemo } from 'react'
import { QueryClient, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { api, type DailyTodo, type Habit, type TodayBundle } from './api'
import { dateKey } from './dailyPlanning'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
})

// Keyed by local date, so the first render after midnight fetches the new day.
const bundleKey = (day = dateKey()): QueryKey => ['today-bundle', day]

export function useTodayBundle() {
  return useQuery({
    queryKey: bundleKey(),
    queryFn: api.todayBundle,
    // Show the cached day at once, but always check for changes made on other
    // pages (Habits, Tasks) or devices since it was fetched.
    refetchOnMount: 'always',
    // Keeps the current/next block and calendar fresh while the page is open.
    refetchInterval: 180_000,
  })
}

/* ---------- pure cache updates ---------- */

/** Mark a habit done or not done today, keeping the heatmap and daily count in step. */
export function setHabitDone(bundle: TodayBundle, habitId: number, done: boolean, day: string): TodayBundle {
  const habit = bundle.habits.find(h => h.id === habitId)
  if (!habit || habit.doneToday === done) return bundle
  return {
    ...bundle,
    habits: bundle.habits.map(h => h.id === habitId ? { ...h, doneToday: done } : h),
    heatmap: bundle.heatmap.map(row => {
      if (row.id !== habitId) return row
      const dates = row.completedDates.filter(d => d !== day)
      const days = row.days.filter(d => d.date !== day)
      return done
        ? { ...row, completedDates: [...dates, day], days: [...days, { date: day, minutes: habit.minutesToday }] }
        : { ...row, completedDates: dates, days }
    }),
    today: { ...bundle.today, habitsCompletedToday: Math.max(0, bundle.today.habitsCompletedToday + (done ? 1 : -1)) },
  }
}

/** Replace a habit with the server's fresh row (streak, minutes, done-today). */
export function applyHabitRow(bundle: TodayBundle, row: Habit, day: string): TodayBundle {
  const next = setHabitDone(bundle, row.id, row.doneToday, day)
  return {
    ...next,
    habits: next.habits.map(h => h.id === row.id ? row : h),
    heatmap: next.heatmap.map(r => r.id !== row.id || !row.doneToday ? r
      : { ...r, days: r.days.map(d => d.date === day ? { ...d, minutes: row.minutesToday } : d) }),
  }
}

export function patchDaily(bundle: TodayBundle, update: (items: DailyTodo[]) => DailyTodo[]): TodayBundle {
  return { ...bundle, dailyTodos: update(bundle.dailyTodos) }
}

/* ---------- optimistic writes ---------- */

// Per-item write counter: a reply only lands if no newer write to the same item
// has started since, so two quick taps can't flicker back and forth.
const latestWrite = new Map<string, number>()
const itemQueue = new Map<string, Promise<unknown>>()
let pendingWrites = 0
const watchedClients = new WeakSet<QueryClient>()
let resyncAfterWrites = false
let tempId = -1

export function useTodayWrites() {
  const qc = useQueryClient()
  // Stable across renders, so effects can depend on these functions.
  return useMemo(() => todayWrites(qc), [qc])
}

function todayWrites(qc: QueryClient) {
  const update = (fn: (b: TodayBundle) => TodayBundle) => {
    const key = bundleKey()
    qc.setQueryData<TodayBundle>(key, b => (b ? fn(b) : b))
  }

  // A bundle fetch that lands while writes are pending was read before they were
  // saved and may have overwritten their on-screen changes. Note it, and re-sync
  // once the last pending write is saved.
  if (!watchedClients.has(qc)) {
    watchedClients.add(qc)
    qc.getQueryCache().subscribe(event => {
      if (pendingWrites > 0 && event.type === 'updated' && event.query.queryKey[0] === 'today-bundle'
        && event.action.type === 'success' && !event.action.manual) resyncAfterWrites = true
    })
  }
  const settled = () => {
    if (--pendingWrites > 0 || !resyncAfterWrites) return
    resyncAfterWrites = false
    void qc.invalidateQueries({ queryKey: ['today-bundle'] })
  }

  /** Runs an optimistic write. On failure it undoes this write, re-syncs, and rethrows. */
  async function write<T>(item: string, optimistic: () => void, request: () => Promise<T>, onReply: (reply: T) => void, undo: () => void): Promise<void> {
    const seq = (latestWrite.get(item) ?? 0) + 1
    latestWrite.set(item, seq)
    pendingWrites++
    // A refetch already in flight would overwrite the optimistic change, so it
    // is cancelled, and run again once the writes are saved.
    if (qc.isFetching({ queryKey: ['today-bundle'] }) > 0) resyncAfterWrites = true
    await qc.cancelQueries({ queryKey: ['today-bundle'] })
    optimistic()
    // Writes to the same item go to the server one at a time, in tap order.
    // Toggles flip the stored value, so out-of-order requests would leave the
    // screen showing the opposite of what was saved.
    const previous = itemQueue.get(item) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(request)
    itemQueue.set(item, run)
    try {
      const reply = await run
      if (latestWrite.get(item) === seq) onReply(reply)
    } catch (e) {
      if (latestWrite.get(item) === seq) undo()
      resyncAfterWrites = true
      throw e
    } finally {
      if (itemQueue.get(item) === run) itemQueue.delete(item)
      settled()
    }
  }

  return {
    toggleHabit: (habit: Habit) => {
      const day = dateKey()
      const done = !habit.doneToday
      return write(`habit:${habit.id}`,
        () => update(b => setHabitDone(b, habit.id, done, day)),
        () => api.toggleHabit(habit.id),
        reply => { if (reply.habit) update(b => applyHabitRow(b, reply.habit!, day)) },
        () => update(b => setHabitDone(b, habit.id, !done, day)))
    },

    toggleDaily: (item: DailyTodo) => write(`daily:${item.id}`,
      () => update(b => patchDaily(b, list => list.map(d => d.id === item.id ? { ...d, done: !item.done } : d))),
      () => api.toggleDailyTodo(item.id),
      saved => update(b => patchDaily(b, list => list.map(d => d.id === saved.id ? saved : d))),
      () => update(b => patchDaily(b, list => list.map(d => d.id === item.id ? { ...d, done: item.done } : d)))),

    addDaily: (title: string) => {
      const temp: DailyTodo = { id: tempId--, date: dateKey(), title, done: false, createdAt: new Date().toISOString(), sortOrder: Number.MAX_SAFE_INTEGER }
      return write(`daily:${temp.id}`,
        () => update(b => patchDaily(b, list => [...list, temp])),
        () => api.createDailyTodo(title),
        // A refresh may have dropped the temporary row meanwhile: insert the saved one.
        saved => update(b => patchDaily(b, list => list.some(d => d.id === temp.id)
          ? list.map(d => d.id === temp.id ? saved : d)
          : list.some(d => d.id === saved.id) ? list : [...list, saved])),
        () => update(b => patchDaily(b, list => list.filter(d => d.id !== temp.id))))
    },

    removeDaily: (item: DailyTodo) => {
      let index = -1
      return write(`daily:${item.id}`,
        () => update(b => patchDaily(b, list => { index = list.findIndex(d => d.id === item.id); return list.filter(d => d.id !== item.id) })),
        () => api.deleteDailyTodo(item.id),
        () => undefined,
        () => update(b => patchDaily(b, list => {
          if (list.some(d => d.id === item.id)) return list
          const copy = [...list]; copy.splice(index < 0 ? copy.length : index, 0, item); return copy
        })))
    },

    reorderDaily: (ids: number[]) => {
      let previous: number[] = []
      const order = (list: DailyTodo[], wanted: number[]) => {
        const byId = new Map(list.map(d => [d.id, d]))
        const placed = wanted.map(id => byId.get(id)).filter((d): d is DailyTodo => !!d)
        return [...placed, ...list.filter(d => !wanted.includes(d.id))]
      }
      return write('daily:order',
        () => update(b => { previous = b.dailyTodos.map(d => d.id); return patchDaily(b, list => order(list, ids)) }),
        () => api.reorderDailyTodos(ids),
        () => undefined,
        () => update(b => patchDaily(b, list => order(list, previous))))
    },

    dismissAlert: (id: number) => {
      let index = -1
      let removed: TodayBundle['alerts'][number] | undefined
      return write(`alert:${id}`,
        () => update(b => { index = b.alerts.findIndex(a => a.id === id); removed = b.alerts[index]; return { ...b, alerts: b.alerts.filter(a => a.id !== id) } }),
        () => api.dismissAlert(id),
        () => undefined,
        () => update(b => {
          if (!removed || b.alerts.some(a => a.id === id)) return b
          const alerts = [...b.alerts]; alerts.splice(index < 0 ? alerts.length : index, 0, removed); return { ...b, alerts }
        }))
    },

    /** Re-sync after a write that changes several sections at once. */
    refresh: () => qc.invalidateQueries({ queryKey: ['today-bundle'] }),
  }
}
