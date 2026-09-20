import { get, send } from './api'

export interface DashboardSettings {
  caloriesTarget: number
  proteinGTarget: number
  carbsGTarget: number
  fatGTarget: number
  stepsTarget: number
  sleepMinutesTarget: number
  sleepScoreTarget: number
  restingHrBaseline: number
  restingCaloriesEstimate: number
  artistMonthlyListenersTarget: number
  artistFollowersTarget: number
  artistTotalStreamsTarget: number
}

export const settingsApi = {
  get: () => get<DashboardSettings>('/api/settings'),
  save: (value: DashboardSettings) => send<DashboardSettings>('PUT', '/api/settings', value),
}
