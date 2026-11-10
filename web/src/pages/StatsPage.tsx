// Stats: the past year across every habit. How much of what you asked for got
// done each month, the best week, streaks, each habit's numbers and goal hours.
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type Habit } from '../api'
import { habitColor, habitStyle } from '../habitColor'
import { useTimer } from '../timer/useTimer'
import { useSeasons } from './habits/useSeasons'
import { inFocusOn, liveSeasons } from '../seasons'
import { fmtHours } from '../lib'
import { Bars, Button, Heatmap, Icon, Progress, Skeleton, Stat } from '../ui'
import type { HeatCell } from '../ui/hooks'
import { MOODS } from './today/mood'
import { LevelCard } from './habits/LevelCard'
import { levelsFor } from './habits/useLevels'
import { badges, titleFor } from './habits/levels'
import { addDays } from './habits/insights'
import { bestWeek, monthlyRates, monthlyTotals, type Tracked } from './habits/insights'
import { consistency, goalPace, isWeekly, minutesByDate, streakUnit, todayKey } from './habits/stats'
import './habits/habits.css'

const YEAR_DAYS = 371
const monthName = (m: string, style: 'short' | 'long' = 'short') => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) })
const shortDate = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function StatsPage() {
  const q = useQuery({
    queryKey: ['stats', YEAR_DAYS],
    // Logs change from many places (habit pages, entries, timers): always refetch on open.
    refetchOnMount: 'always',
    queryFn: async () => { const [habits, heat, goals] = await Promise.all([api.habits(), api.habitsHeatmap(YEAR_DAYS), api.goals()]); return { habits, heat, goals } },
  })
  // A timer stopped here or on another device logs minutes: show the new totals.
  const { dataTick } = useTimer()
  const { seasons, current: season } = useSeasons()
  const notes = useQuery({ queryKey: ['day-notes', YEAR_DAYS], queryFn: () => api.dayNotes(YEAR_DAYS), refetchOnMount: 'always' })
  const refetch = q.refetch
  useEffect(() => { if (dataTick) void refetch() }, [dataTick, refetch])

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
  const live = liveSeasons(seasons, habits.map(h => h.id), today)
  const rows: (Tracked & { h: Habit })[] = habits.map(h => ({ h, habit: h, from: h.firstLoggedOn, asked: (d: string) => inFocusOn(live, h.id, d), byDate: heatById.get(h.id) ?? new Map<string, number>() }))
  const rates = monthlyRates(rows, today, 12)
  const best = bestWeek(rows, today, 53)
  // One window for everything: the first day of the month eleven months ago, to today.
  const yearStart = `${rates[0]?.month ?? today.slice(0, 7)}-01`
  const inYear = (r: { byDate: Map<string, number> | ReadonlyMap<string, number> }) => [...r.byDate].filter(([d]) => d >= yearStart && d <= today)
  const activeDays = new Set(rows.flatMap(r => inYear(r).map(([d]) => d))).size
  const yearMinutes = rows.reduce((s, r) => s + inYear(r).reduce((m, [, v]) => m + v, 0), 0)
  // Weekly streaks count weeks: compare everything in days.
  const runDays = (h: Habit) => isWeekly(h) ? h.bestStreak * 7 : h.bestStreak
  const topStreak = habits.reduce<Habit | null>((m, h) => !m || runDays(h) > runDays(m) ? h : m, null)
  const thisMonth = rates.at(-1)
  const ratedMonths = rates.filter(r => r.rate != null)
  const liveGoals = goals.filter(g => !g.archived)

  return <div className="hb-page st-page">
    <header className="hb-head">
      <div>
        <Link className="hb-back" to="/habits"><Icon name="chevron" size={16} />Habits</Link>
        <h1>Stats</h1>
        <p className="hb-head__summary">The past 12 months{season?.name ? <> · season <b>{season.name}</b></> : null}</p>
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
      <p className="hb-hint">Share of what your habits asked for. Each habit counts from its first entry and only while it was in focus; weekly habits ask for their target, not every day.</p>
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

    <LevelsSection habits={habits} />

    {notes.data && notes.data.length > 0 && <MoodSection notes={notes.data} today={today} />}

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

/** The year's check-ins: a calendar shaded by mood, and the latest lines written. */
function MoodSection({ notes, today }: { notes: { date: string; mood: number | null; note: string | null }[]; today: string }) {
  const byDate = new Map(notes.map(n => [n.date, n] as const))
  const cells: HeatCell[] = Array.from({ length: YEAR_DAYS }, (_, i) => {
    const date = addDays(today, -(YEAR_DAYS - 1 - i))
    const n = byDate.get(date)
    const level = (n?.mood ? Math.max(1, n.mood - 1) : n?.note ? 1 : 0) as HeatCell['level']
    const what = n ? [n.mood ? MOODS[n.mood - 1] : null, n.note ? `“${n.note}”` : null].filter(Boolean).join(' · ') : 'no check-in'
    return { date, level, title: `${shortDate(date)}: ${what}` }
  })
  const rated = notes.filter(n => n.mood)
  const avg = rated.length ? rated.reduce((s, n) => s + n.mood!, 0) / rated.length : null
  const recent = notes.filter(n => n.note).slice(-6).reverse()
  return <section className="hb-sheet__section" aria-labelledby="st-mood">
    <h2 id="st-mood" className="st-label">Check-ins</h2>
    <p className="hb-hint">{notes.length} {notes.length === 1 ? 'day' : 'days'} checked in{avg != null ? ` · usually ${MOODS[Math.round(avg) - 1].toLowerCase()}` : ''}. Darker is a better day.</p>
    <Heatmap cells={cells} variant="calendar" label="Mood by day over the past year" today={today} cellSize={10} />
    {recent.length > 0 && <ul className="st-notes">
      {recent.map(n => <li key={n.date}><span className="st-notes__date">{shortDate(n.date)}{n.mood ? ` · ${MOODS[n.mood - 1]}` : ''}</span>{n.note}</li>)}
    </ul>}
  </section>
}

/** Your level, each habit's, and badges: all worked out from your logs. */
function LevelsSection({ habits }: { habits: Habit[] }) {
  // Opened from a level link (/stats#levels): bring this section into view.
  useEffect(() => { if (location.hash === '#levels') document.getElementById('levels')?.scrollIntoView({ block: 'start' }) }, [])
  if (!habits.length) return null
  const { player, byHabit } = levelsFor(habits)
  const ranked = [...habits].sort((a, b) => (byHabit.get(b.id)?.xp ?? 0) - (byHabit.get(a.id)?.xp ?? 0))
  const list = badges(habits)
  const earned = list.filter(b => b.earned).length
  return <section className="hb-sheet__section" id="levels" aria-labelledby="st-levels">
    <h2 id="st-levels" className="st-label">Levels &amp; badges</h2>
    <LevelCard level={player} />
    <p className="hb-hint">XP: a point a minute on timed habits plus 10 a practice day, 30 a day on tick habits, and a bonus for your best run. Your level counts every habit.</p>
    <ul className="lv-habits">
      {ranked.map(h => { const l = byHabit.get(h.id)!; return <li key={h.id} style={habitStyle(h)}>
        <div className="lv-habits__line"><Link to={`/habits/${h.id}`} className="st-habit"><span className="st-dot" style={{ background: habitColor(h) }} aria-hidden="true" />{h.name}</Link><span>Lv {l.level} <small>{titleFor(l.level)}</small></span></div>
        <Progress value={Math.round(l.fraction * 100)} max={100} label={`${h.name}: level ${l.level}, ${Math.round(l.fraction * 100)}% to the next`} />
      </li> })}
    </ul>
    <h3 className="hb-sheet__label">Badges · {earned} of {list.length}</h3>
    <ul className="lv-badges">
      {list.map(b => <li key={b.id} className={`lv-badge${b.earned ? ' lv-badge--earned' : ''}`}>
        <b>{b.name}</b><span>{b.detail}</span><span>{b.earned ? 'Earned' : b.progress}</span>
      </li>)}
    </ul>
  </section>
}
