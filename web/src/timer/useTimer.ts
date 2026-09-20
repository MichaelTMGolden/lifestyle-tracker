import { createContext, useContext } from 'react'

export interface ActiveTimer { habitId: number; habitName: string; startedAt: number }

export interface TimerContextValue {
  timers: ActiveTimer[]
  running: boolean
  isRunning: (habitId: number) => boolean
  elapsedMs: (habitId: number) => number
  /** Resolves only after confirmation; rejects on failure after restoring local state. */
  start: (habitId: number, habitName: string) => Promise<void>
  /** Ordered behind any pending start for the same habit; rejects on save failure. */
  stop: (habitId: number) => Promise<void>
  stopAll: () => Promise<void>
  dataTick: number
  notifyChange: () => void
}

export const TimerContext = createContext<TimerContextValue | null>(null)

export function useTimer(): TimerContextValue {
  const context = useContext(TimerContext)
  if (!context) throw new Error('useTimer must be used within TimerProvider')
  return context
}
