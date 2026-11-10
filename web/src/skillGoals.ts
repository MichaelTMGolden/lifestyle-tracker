// Skill goals: something to work toward on a habit with no deadline ("learn the
// solo", "finish the song"), with optional steps.
import { get, send } from './api'

export type SkillGoalStep = { id: number; title: string; doneOn: string | null }
export type SkillGoal = {
  id: number; habitId: number; title: string; note: string | null
  createdOn: string; doneOn: string | null; steps: SkillGoalStep[]
}

export const skillGoalsApi = {
  list: () => get<SkillGoal[]>('/api/skill-goals'),
  create: (body: { habitId: number; title: string; note: string | null; steps: string[] }) => send<SkillGoal>('POST', '/api/skill-goals', body),
  edit: (id: number, body: { title: string; note: string | null }) => send<SkillGoal>('PUT', `/api/skill-goals/${id}`, body),
  setDone: (id: number, done: boolean) => send<SkillGoal>('PUT', `/api/skill-goals/${id}/done`, { done }),
  remove: (id: number) => send<void>('DELETE', `/api/skill-goals/${id}`),
  addStep: (id: number, title: string) => send<SkillGoal>('POST', `/api/skill-goals/${id}/steps`, { title }),
  editStep: (id: number, stepId: number, body: { title?: string; done?: boolean }) => send<SkillGoal>('PUT', `/api/skill-goals/${id}/steps/${stepId}`, body),
  removeStep: (id: number, stepId: number) => send<SkillGoal>('DELETE', `/api/skill-goals/${id}/steps/${stepId}`),
}

export const MAX_TITLE = 120
export const MAX_NOTE = 500
export const MAX_STEPS = 30

/** Steps done and in all. */
export const stepCount = (g: SkillGoal) => ({ done: g.steps.filter(s => s.doneOn).length, total: g.steps.length })

/** Open goals oldest first (the one set first leads), then reached ones newest first. */
export function sortGoals(goals: SkillGoal[]) {
  const open = goals.filter(g => !g.doneOn).sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.id - b.id)
  const reached = goals.filter(g => g.doneOn).sort((a, b) => b.doneOn!.localeCompare(a.doneOn!) || b.id - a.id)
  return { open, reached }
}
