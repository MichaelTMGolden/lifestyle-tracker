// One habit on its own page: stats, the year view, which weekdays slip, weekly
// totals, its goal, logging, rhythm, colour, reminder, entries and settings.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Goal, type Habit, type HabitHeatmap } from '../api'
import { habitColor, habitStyle } from '../habitColor'
import { fmtHours } from '../lib'
import { addMinutes, QUEUED, setDone } from '../offline/habitSync'
import { useTimer } from '../timer/useTimer'
import { Bars, Button, Icon, Progress, Skeleton } from '../ui'
import type { HeatCell } from '../ui/hooks'
import { useToast } from '../ui/hooks'
import { HabitDetail } from './habits/HabitDetail'
import { MOODS } from './today/mood'
import { useQuery } from '@tanstack/react-query'
import { lastHabits, rememberHabit, rememberHabits } from './habits/lastLoaded'
import { useSeasons } from './habits/useSeasons'
import { inFocusOn, liveSeasons, type SeasonRow } from '../seasons'
import { useQueryClient } from '@tanstack/react-query'
import { firstDay, weekdayRates, weeklyTotals } from './habits/insights'
import { cellsFor, goalForHabit, goalPace, heatWithToday, minutesByDate, todayKey } from './habits/stats'
import './habits/habits.css'

const YEAR_DAYS = 371
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const OFFLINE_NOTE = 'saved on this device · syncs when you are back online'
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const shortDate = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

// Keyed by id so moving between habits starts each page fresh.
export default function HabitPage() {
  const id = Number(useParams().id)
  return <HabitView key={id} id={id} />
}

function HabitView({ id }: { id: number }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { isRunning, elapsedMs, start, stop, dataTick } = useTimer()
  // Start from what the Habits page already loaded (instant, and usable offline).
  const [cached] = useState(() => { const l = lastHabits(); return l && l.heatDays >= YEAR_DAYS ? l : null })
  const [habit, setHabit] = useState<Habit | null>(() => cached?.habits.find(x => x.id === id) ?? null)
  const [heat, setHeat] = useState<HabitHeatmap | null>(() => cached?.heat.find(r => r.id === id) ?? null)
  const [goals, setGoals] = useState<Goal[]>(() => cached?.goals ?? [])
  // Every habit's id: a season whose habits were all deleted counts as none.
  const [allIds, setAllIds] = useState<number[]>(() => cached?.habits.map(x => x.id) ?? [])
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | string>('loading')

  const notes = useQuery({ queryKey: ['day-notes', YEAR_DAYS], queryFn: () => api.dayNotes(YEAR_DAYS) })
  const notesByDate = new Map((notes.data ?? []).map(n => [n.date, n] as const))
  const load = useCallback(() =>
    Promise.all([api.habits(), api.habitsHeatmap(YEAR_DAYS), api.goals()])
      .then(([hs, hm, g]) => {
        const h = hs.find(x => x.id === id) ?? null
        setHabit(h); setHeat(hm.find(r => r.id === id) ?? null); setGoals(g); setAllIds(hs.map(x => x.id))
        // Fresh from the server: the next page opened from the cache starts from this.
        rememberHabits({ habits: hs, heat: hm, goals: g, heatDays: YEAR_DAYS })
        setState(h ? 'ready' : 'missing')
      })
      .catch(e => setState(message(e))), [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (dataTick) void load() }, [dataTick, load])
  useEffect(() => { const on = () => void load(); window.addEventListener('pd:habits-synced', on); return () => window.removeEventListener('pd:habits-synced', on) }, [load])
  useEffect(() => { if (habit) document.title = `${habit.name} · Personal Dashboard` }, [habit])

  const failed = (e: unknown) => { toast.show({ message: `Couldn't save: ${message(e)}`, tone: 'error' }); void load() }

  if (!habit) {
    if (state === 'loading') return <div className="hb-page" aria-busy="true">
      <p className="ui-sr-only" role="status">Loading habit…</p>
      <Skeleton height={14} width={70} /><Skeleton height={38} width={180} />
      <div className="hb-sheet__stats">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={48} />)}</div>
      <Skeleton height={110} radius={12} />
    </div>
    return <div className="hb-page">
      <Link className="hb-back" to="/habits"><Icon name="chevron" size={16} />Habits</Link>
      <p className={state === 'missing' ? 'hb-hint' : 'hb-error'} role="alert">
        {state === 'missing' ? 'This habit no longer exists.' : <>Couldn't load this habit ({state}). <Button size="sm" variant="quiet" onClick={() => void load()}>Retry</Button></>}
      </p>
    </div>
  }

  const h = habit
  const byDate = minutesByDate(heat ?? undefined)
  const today = todayKey()
  const goal = goalForHabit(goals, h.id)
  // A day's check-in shows in its heatmap cell's tooltip.
  const withNotes = (cells: HeatCell[]) => cells.map(c => {
    const n = notesByDate.get(c.date)
    return n ? { ...c, title: `${c.title} · ${[n.mood ? MOODS[n.mood - 1] : null, n.note ? `“${n.note}”` : null].filter(Boolean).join(' · ')}` } : c
  })

  // Show a change at once on the row and today's heatmap cell, and keep it for the list.
  function show(row: Habit) {
    const cell = heat ? heatWithToday(heat, row, today) : null
    setHabit(row); if (cell) setHeat(cell); rememberHabit(row, cell)
  }
  // Both show the change at once and keep it when the write is queued offline
  // (a reload would fail then); a saved write reloads the server's numbers.
  async function toggle() {
    const next = !h.doneToday
    const shown = { ...h, doneToday: next }
    show(shown)
    try {
      const reply = await setDone(h, today, next)
      if (reply === QUEUED) { toast.show({ message: `${h.name}: ${OFFLINE_NOTE}` }); return }
      toast.show({ message: next ? `${h.name} done` : `${h.name} unmarked for today` })
      await load()
    } catch (e) { failed(e) }
  }
  async function logTime(mins: number) {
    const shown = { ...h, doneToday: true, minutesToday: h.minutesToday + mins, totalMinutes: h.totalMinutes + mins }
    show(shown)
    try {
      const reply = await addMinutes(h, today, mins)
      if (reply === QUEUED) { toast.show({ message: `${h.name} · ${mins} min: ${OFFLINE_NOTE}` }); return }
      toast.show({ message: `${h.name} · ${mins} min logged` })
      await load()
    } catch (e) { failed(e) }
  }
  async function remove() {
    if (!confirm(`Delete "${h.name}" and all its logs? This can't be undone.`)) return
    try { await api.deleteHabit(h.id); navigate('/habits', { replace: true }) } catch (e) { failed(e) }
  }

  return <div className="hb-page hb-detail" style={habitStyle(h)}>
    <header className="hb-detail__head">
      <Link className="hb-back" to="/habits"><Icon name="chevron" size={16} />Habits</Link>
      <h1>{h.name}</h1>
    </header>

    <HabitDetail habit={h} yearCells={withNotes(cellsFor(h, byDate, YEAR_DAYS))}
      insights={<Insights habit={h} byDate={byDate} today={today} goal={goal} allIds={allIds} />}
      running={isRunning(h.id)} elapsedMs={elapsedMs(h.id)}
      onLog={logTime} onToggle={() => void toggle()}
      onStart={() => { void start(h.id, h.name).catch(e => toast.show({ message: message(e), tone: 'error' })) }}
      onStop={() => { void stop(h.id).catch(e => toast.show({ message: message(e), tone: 'error' })) }}
      onChanged={load} onDelete={() => void remove()} />
  </div>
}

/** Whether this habit is in this season's focus, with a one-tap change. */
function SeasonLine({ habit: h, current }: { habit: Habit; current: SeasonRow | null }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!current) return null
  const inFocus = current.habitIds.includes(h.id)
  async function change() {
    const ids = inFocus ? current!.habitIds.filter(x => x !== h.id) : [...current!.habitIds, h.id]
    if (ids.length === 0) { toast.show({ message: 'A season needs at least one habit. End the season on Habits instead.' }); return }
    setBusy(true)
    try {
      await api.setSeason({ name: current!.name, habitIds: ids, endsOn: current!.endsOn })
      await Promise.all([qc.invalidateQueries({ queryKey: ['seasons'] }), qc.invalidateQueries({ queryKey: ['stats'] })])
      toast.show({ message: inFocus ? `${h.name} is tracked, not in focus` : `${h.name} is in focus` })
    } catch (e) { toast.show({ message: `Couldn't save: ${message(e)}`, tone: 'error' }) }
    finally { setBusy(false) }
  }
  return <p className="hb-focus-note">
    <span>{inFocus ? `In focus${current.name ? ` · ${current.name}` : ' this season'}` : 'Not in focus this season · still tracked'}</span>
    <Button size="sm" variant="quiet" disabled={busy} onClick={() => void change()}>{inFocus ? 'Take out of focus' : 'Bring into focus'}</Button>
  </p>
}

function Insights({ habit: h, byDate, today, goal, allIds }: { habit: Habit; byDate: Map<string, number>; today: string; goal?: Goal; allIds: number[] }) {
  const { seasons: all, current } = useSeasons()
  const seasons = liveSeasons(all, allIds.length ? allIds : [h.id], today)
  const color = habitColor(h)
  // Days it was out of focus aren't counted as missed.
  const rates = weekdayRates(byDate, today, 12, h.firstLoggedOn ?? firstDay(byDate), d => inFocusOn(seasons, h.id, d))
  const counted = rates.filter(r => r.total > 0)
  const share = (r: { done: number; total: number }) => r.total ? r.done / r.total : 0
  // Only name a weak day when there is enough history and a real gap.
  const weakest = counted.length === 7 && counted.every(r => r.total >= 3)
    ? rates.map((r, i) => ({ i, s: share(r) })).sort((a, b) => a.s - b.s)[0] : null
  const strongest = Math.max(...rates.map(share))
  const weeks = weeklyTotals(byDate, today, 12)
  const timed = h.tracksTime
  const pace = goal ? goalPace(goal) : null

  return <>
    <SeasonLine habit={h} current={current && seasons.includes(current) ? current : null} />
    {goal && <section className="hb-sheet__section" aria-labelledby="hb-goal">
      <h3 id="hb-goal" className="hb-sheet__label">Goal · {goal.name}</h3>
      <div className="hb-card__goal-line">
        <span>{fmtHours(goal.accumulatedMinutes)} of {fmtHours(goal.targetMinutes)}</span>
        {pace && <span className={pace.tone ? `hb-tone--${pace.tone}` : undefined}>{pace.text}</span>}
      </div>
      <Progress value={Math.round(goal.progress * 100)} max={100} label={`${goal.name}: ${Math.round(goal.progress * 100)}%`} />
    </section>}

    <section className="hb-sheet__section" aria-labelledby="hb-weekdays">
      <h3 id="hb-weekdays" className="hb-sheet__label">By weekday · last 12 weeks</h3>
      <Bars label={`${h.name} by weekday`} max={1} color={color} height={72}
        initial={weakest && share(rates[weakest.i]) < strongest - 0.15 ? String(weakest.i) : undefined}
        bars={rates.map((r, i) => ({
          key: String(i), label: WEEKDAYS[i], value: share(r),
          readout: r.total ? `${WEEKDAY_NAMES[i]}: ${r.done} of ${r.total}${weakest?.i === i && share(r) < strongest - 0.15 ? ' · most often missed' : ''}` : `${WEEKDAY_NAMES[i]}: nothing yet`,
        }))} />
    </section>

    <section className="hb-sheet__section" aria-labelledby="hb-weeks">
      <h3 id="hb-weeks" className="hb-sheet__label">{timed ? 'Time per week' : 'Days per week'} · last 12 weeks</h3>
      <Bars label={`${h.name} per week`} color={color} max={timed ? undefined : 7}
        bars={weeks.map(w => ({
          key: w.start, label: String(Number(w.start.slice(8))), value: timed ? w.minutes : w.days,
          readout: `Week of ${shortDate(w.start)} · ${w.days} ${w.days === 1 ? 'day' : 'days'}${timed ? ` · ${fmtHours(w.minutes)}` : ''}`,
        }))} />
    </section>
  </>
}
