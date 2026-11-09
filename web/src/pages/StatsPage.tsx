// Stats: the past year across every habit. How much of what you asked for got
// done each month, the best week, streaks, each habit's numbers and goal hours.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type Habit } from '../api'
import { habitColor } from '../habitColor'
import { fmtHours } from '../lib'
import { Bars, Button, Icon, Progress, Skeleton, Stat } from '../ui'
import { bestWeek, monthlyRates, monthlyTotals, type Tracked } from './habits/insights'
import { consistency, goalPace, isWeekly, minutesByDate, streakUnit, todayKey } from './habits/stats'
import './habits/habits.css'

const YEAR_DAYS = 371
const monthName = (m: string, style: 'short' | 'long' = 'short') => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) })
const shortDate = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function StatsPage() {
  const q = useQuery({
    queryKey: ['stats', YEAR_DAYS],
    queryFn: async () => { const [habits, heat, goals] = await Promise.all([api.habits(), api.habitsHeatmap(YEAR_DAYS), api.goals()]); return { habits, heat, goals } },
  })

  if (!q.data) return <div className="hb-page" aria-busy={!q.error}>
    <header className="hb-head"><h1>Stats</h1></header>
    {q.error
      ? <p className="hb-error" role="alert">Couldn't load stats ({q.error instanceof Error ? q.error.message : String(q.error)}). <Button size="sm" variant="quiet" onClick={() => void q.refetch()}>Retry</Button></p>
      : <><p className="ui-sr-only" role="status">Loading stats…</p>
        <div className="hb-sheet__stats">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={48} />)}</div>
        <Skeleton height={130} radius={12} /><Skeleton lines={5} height={40} /></>}
  </div>

  const { habits, heat, goals } = q.data
  const today = todayKey()
  const heatById = new Map(heat.map(r => [r.id, minutesByDate(r)] as const))
  const rows: (Tracked & { h: Habit })[] = habits.map(h => ({ h, habit: h, byDate: heatById.get(h.id) ?? new Map<string, number>() }))
  const rates = monthlyRates(rows, today, 12)
  const best = bestWeek(rows, today, 53)
  const yearStart = today.replace(/^(\d{4})/, y => String(Number(y) - 1))
  const inYear = (r: { byDate: Map<string, number> | ReadonlyMap<string, number> }) => [...r.byDate].filter(([d]) => d > yearStart)
  const activeDays = new Set(rows.flatMap(r => inYear(r).map(([d]) => d))).size
  const yearMinutes = rows.reduce((s, r) => s + inYear(r).reduce((m, [, v]) => m + v, 0), 0)
  const topStreak = habits.reduce<Habit | null>((m, h) => !m || h.bestStreak > m.bestStreak ? h : m, null)
  const thisMonth = rates.at(-1)
  const ratedMonths = rates.filter(r => r.rate != null)
  const liveGoals = goals.filter(g => !g.archived)

  return <div className="hb-page st-page">
    <header className="hb-head">
      <div>
        <Link className="hb-back" to="/habits"><Icon name="chevron" size={16} />Habits</Link>
        <h1>Stats</h1>
        <p className="hb-head__summary">The past 12 months</p>
      </div>
    </header>

    <div className="hb-sheet__stats">
      <Stat label="Days practised" value={activeDays} sub="any habit" />
      <Stat label="Time logged" value={fmtHours(yearMinutes)} />
      <Stat label="Best week" value={best ? best.days : '–'} sub={best ? `habit-days · week of ${shortDate(best.start)}` : undefined} />
      <Stat label="Longest run" value={topStreak?.bestStreak ?? 0} unit={topStreak ? streakUnit(topStreak, topStreak.bestStreak) : undefined} sub={topStreak?.name} tone="accent" />
    </div>

    {ratedMonths.length > 0 && <section className="hb-sheet__section" aria-labelledby="st-months">
      <h2 id="st-months" className="st-label">Done each month</h2>
      <p className="hb-hint">Share of what your habits asked for. Each habit counts from its first entry; weekly habits ask for their target, not every day.</p>
      <Bars label="Share done each month" max={1}
        bars={rates.map(r => ({
          key: r.month, label: monthName(r.month).slice(0, 3), value: r.rate ?? 0,
          readout: r.rate == null ? `${monthName(r.month, 'long')}: no habits yet` : `${monthName(r.month, 'long')}: ${Math.round(r.rate * 100)}%${r.month === thisMonth?.month ? ' so far' : ''}`,
        }))} />
    </section>}

    <section className="hb-sheet__section" aria-labelledby="st-habits">
      <h2 id="st-habits" className="st-label">Each habit</h2>
      <div className="st-table-wrap">
        <table className="st-table">
          <thead><tr><th scope="col">Habit</th><th scope="col">Last 30 days</th><th scope="col">Best run</th><th scope="col">12 months</th></tr></thead>
          <tbody>
            {rows.map(({ h, byDate }) => {
              const months = monthlyTotals(byDate, today, 12)
              const days = months.reduce((s, m) => s + m.days, 0), minutes = months.reduce((s, m) => s + m.minutes, 0)
              return <tr key={h.id}>
                <th scope="row"><Link to={`/habits/${h.id}`} className="st-habit"><span className="st-dot" style={{ background: habitColor(h) }} aria-hidden="true" />{h.name}</Link></th>
                <td>{consistency(h)}%{isWeekly(h) && <small> of {h.targetPerPeriod}×/wk</small>}</td>
                <td>{h.bestStreak} <small>{streakUnit(h, h.bestStreak)}</small></td>
                <td>{h.tracksTime ? fmtHours(minutes) : <>{days} <small>days</small></>}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {habits.length === 0 && <p className="hb-hint">No habits yet.</p>}
    </section>

    {liveGoals.length > 0 && <section className="hb-sheet__section" aria-labelledby="st-goals">
      <h2 id="st-goals" className="st-label">Goals</h2>
      <ul className="st-goals">
        {liveGoals.map(g => {
          const pace = goalPace(g)
          return <li key={g.id}>
            <div className="hb-card__goal-line">
              <span><b>{g.name}</b> · {fmtHours(g.accumulatedMinutes)} of {fmtHours(g.targetMinutes)}</span>
              {pace && <span className={pace.tone ? `hb-tone--${pace.tone}` : undefined}>{pace.text}</span>}
            </div>
            <Progress value={Math.round(g.progress * 100)} max={100} label={`${g.name}: ${Math.round(g.progress * 100)}%`} />
          </li>
        })}
      </ul>
    </section>}
  </div>
}
