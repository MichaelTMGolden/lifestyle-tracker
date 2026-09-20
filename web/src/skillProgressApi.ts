import { get, send } from './api'

export interface SkillAssessment { id: number; assessedOn: string; score: number; evidenceUrl: string | null; notes: string | null }
export interface SkillBenchmark { id: number; habitId: number; habitName: string; name: string; rubric: string; archived: boolean; assessments: SkillAssessment[] }
export type AssessmentInput = Omit<SkillAssessment, 'id'>

export const skillProgressApi = {
  benchmarks: () => get<SkillBenchmark[]>('/api/skill-benchmarks'),
  create: (body: { habitId: number; name: string; rubric: string }) => send<{ id: number }>('POST', '/api/skill-benchmarks', body),
  archive: (id: number, archived: boolean) => send<void>('PUT', `/api/skill-benchmarks/${id}/archived`, { archived }),
  assess: (id: number, body: AssessmentInput) => send<{ id: number }>('PUT', `/api/skill-benchmarks/${id}/assessments`, body),
  removeAssessment: (id: number) => send<void>('DELETE', `/api/skill-assessments/${id}`),
  cadence: (id: number, cadence: string, targetPerPeriod: number) => send<void>('PUT', `/api/habits/${id}/cadence`, { cadence, targetPerPeriod }),
}
