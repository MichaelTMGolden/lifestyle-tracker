import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { skillGoalsApi, type SkillGoal } from '../../skillGoals'

const NONE: SkillGoal[] = []
export const SKILL_GOALS_KEY = ['skill-goals'] as const

/** Every skill goal. `loaded` is also true after a failed load (offline), so levels don't wait forever. */
export function useSkillGoals() {
  const q = useQuery({ queryKey: SKILL_GOALS_KEY, queryFn: skillGoalsApi.list, staleTime: 60_000 })
  return { all: q.data ?? NONE, loaded: q.isSuccess || q.isError, error: q.error, refetch: q.refetch }
}

/** Puts a goal the server just returned into the shared list (or drops it, when deleted). */
export function useStoreGoal() {
  const qc = useQueryClient()
  return useCallback((goal: SkillGoal | { id: number; deleted: true }) => {
    qc.setQueryData<SkillGoal[]>(SKILL_GOALS_KEY, list => {
      const rest = (list ?? []).filter(g => g.id !== goal.id)
      return 'deleted' in goal ? rest : [...rest, goal]
    })
  }, [qc])
}
