import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { seasonOn } from '../../seasons'
import { todayKey } from './stats'

/** Every season, newest first, and the one covering today. */
export function useSeasons() {
  const q = useQuery({ queryKey: ['seasons'], queryFn: api.seasons, staleTime: 60_000 })
  const all = q.data ?? []
  return { seasons: all, current: seasonOn(all, todayKey()), loaded: q.isSuccess }
}
