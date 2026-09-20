import { get, send, type DailyTodo, type Todo, type WeeklyDigest, type ReviewRecommendation } from './api'

export const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const nextDateKey = () => { const date = new Date(); date.setDate(date.getDate() + 1); return dateKey(date) }

export const dailyPlanning = {
  pending: () => get<DailyTodo[]>('/api/daily-todos/pending'),
  carry: (id: number, date: string) => send<DailyTodo>('POST', `/api/daily-todos/${id}/carry`, { date }),
  promote: (id: number) => send<Todo>('POST', `/api/daily-todos/${id}/promote`),
  plan: (id: number, date: string | null, isPriority = false) => send<Todo>('PUT', `/api/todos/${id}/plan`, { date, isPriority }),
  digest: () => get<WeeklyDigest>('/api/reviews/digest'),
}

// Stable across sorting and reloads; include text so a regenerated recommendation
// with a different action does not inherit an older action's completion state.
export function recommendationTag(week: string, rec: ReviewRecommendation) {
  const text = `${rec.text.trim()}|${[...(rec.relatedFactIds ?? [])].sort().join('|')}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `[weekly-review:${week}:${(hash >>> 0).toString(16)}]`
}
