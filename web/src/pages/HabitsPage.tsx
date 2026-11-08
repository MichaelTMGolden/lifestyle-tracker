// Habits: one card per habit (streak, cadence, one-tap action, heatmap), a detail
// sheet for logging and settings, then goals and challenges.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Goal, type Habit, type HabitHeatmap } from '../api'
import { ChallengesSection } from '../components/Challenges'
import { useTimer } from '../timer/useTimer'
import { Button, Sheet, Skeleton, Tabs } from '../ui'
import { useToast } from '../ui/hooks'
import { GoalCelebration } from './habits/GoalForm'
import { GoalsSection } from './habits/Goals'
import { HabitCard, type Range } from './habits/HabitCard'
import { HabitSheet } from './habits/HabitSheet'
import { cellsFor, daysThisWeek, isWeekly, minutesByDate, todayKey, weeklyTarget } from './habits/stats'
import './habits/habits.css'

const YEAR_DAYS = 371 // 53 weeks, so the calendar view always fills its first column
const RANGE_DAYS: Record<Range, number> = { '4w': 28, '6m': 182, y: YEAR_DAYS }
const ranges = [{ value: '4w', label: '4 weeks' }, { value: '6m', label: '6 months' }, { value: 'y', label: 'Year' }] as const

// Goal ids whose completion was already celebrated, so the confetti shows once.
const CELEB_KEY = 'pd:goals-celebrated'
const loadCelebrated = (): number[] => { try { return JSON.parse(localStorage.getItem(CELEB_KEY) || '[]') } catch { return [] } }
const RANGE_KEY = 'pd:habits-range'
const loadRange = (): Range => { try { const v = localStorage.getItem(RANGE_KEY); return v === '6m' || v === 'y' ? v : '4w' } catch { return '4w' } }

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [heat, setHeat] = useState<HabitHeatmap[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRangeState] = useState<Range>(loadRange)
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [celebrated, setCelebrated] = useState(loadCelebrated)
  const { isRunning, elapsedMs, start, stop, dataTick } = useTimer()
  const toast = useToast()

  const setRange = (r: Range) => { setRangeState(r); try { localStorage.setItem(RANGE_KEY, r) } catch { /* private mode */ } }

  const load = useCallback(() =>
    Promise.all([api.habits(), api.habitsHeatmap(YEAR_DAYS), api.goals()])
      .then(([h, hm, g]) => { setHabits(h); setHeat(hm); setGoals(g); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false)), [])
  useEffect(() => { void load() }, [load])
  // A timer stopped here, in the action bar or on another device logs minutes: refetch.
  useEffect(() => { if (dataTick) void load() }, [dataTick, load])

  // Show a change at once: the habit row and today's heatmap cell.
  function showHabit(row: Habit) {
    const today = todayKey()
    setHabits(list => list.map(h => h.id === row.id ? row : h))
    setHeat(list => list.map(r => {
      if (r.id !== row.id) return r
      const days = r.days.filter(d => d.date !== today)
      const dates = r.completedDates.filter(d => d !== today)
      return row.doneToday
        ? { ...r, days: [...days, { date: today, minutes: row.minutesToday }], completedDates: [...dates, today] }
        : { ...r, days, completedDates: dates }
    }))
  }
  // A failed write reloads so the page shows what was actually saved.
  const failed = (e: unknown) => {
    toast.show({ message: `Couldn't save: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' })
    void load()
  }

  async function toggle(h: Habit, undo = false) {
    showHabit({ ...h, doneToday: !h.doneToday })
    try {
      const reply = await api.toggleHabit(h.id)
      if (reply.habit) showHabit(reply.habit)
      if (!undo) toast.show({
        message: h.doneToday ? `${h.name} unmarked for today` : `${h.name} done`,
        action: { label: 'Undo', onClick: () => { const now = reply.habit ?? { ...h, doneToday: !h.doneToday }; void toggle(now, true) } },
      })
    } catch (e) { failed(e) }
  }

  async function logTime(h: Habit, mins: number) {
    showHabit({ ...h, doneToday: true, minutesToday: h.minutesToday + mins, totalMinutes: h.totalMinutes + mins })
    try {
      const reply = await api.logHabitTime(h.id, mins)
      if (reply.habit) showHabit(reply.habit)
      toast.show({ message: `${h.name} · ${mins} min logged` })
      setGoals(await api.goals()) // minutes feed goal progress
    } catch (e) { failed(e) }
  }

  // TimerProvider shows a lasting error banner, but it sits behind an open sheet,
  // so while one is open the failure also shows as a toast inside it.
  const timerFailed = (e: unknown) => {
    if (openId != null) toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'error' })
  }
  const startTimer = (h: Habit) => { void start(h.id, h.name).catch(timerFailed) }
  const stopTimer = (h: Habit) => { void stop(h.id).catch(timerFailed) }

  async function removeHabit(h: Habit) {
    if (!confirm(`Delete "${h.name}" and all its logs? This can't be undone.`)) return
    try { await api.deleteHabit(h.id); setOpenId(null); await load() } catch (e) { failed(e) }
  }

  const celebrating = goals.find(g => g.state === 'complete' && !g.archived && !celebrated.includes(g.id)) ?? null
  const dismissCelebration = useCallback(() => {
    if (!celebrating) return
    const ids = [...new Set([...loadCelebrated(), celebrating.id])]
    try { localStorage.setItem(CELEB_KEY, JSON.stringify(ids)) } catch { /* private mode */ }
    setCelebrated(ids)
  }, [celebrating])

  const heatById = new Map(heat.map(r => [r.id, minutesByDate(r)] as const))
  const week = habits.map(h => ({ h, done: daysThisWeek(heatById.get(h.id) ?? new Map()) }))
  const weekDone = week.reduce((s, { h, done }) => s + Math.min(done, weeklyTarget(h)), 0)
  const weekTarget = week.reduce((s, { h }) => s + weeklyTarget(h), 0)
  const longest = habits.filter(h => !isWeekly(h)).reduce((m, h) => Math.max(m, h.currentStreak), 0)
  // The goal most specific to a habit: fewest feeder habits wins (100h Guitar over a shared goal).
  const goalFor = (id: number) => goals
    .filter(g => !g.archived && g.state !== 'complete' && g.sources.some(s => s.habitId === id))
    .sort((a, b) => a.sources.length - b.sources.length)[0]
  const open = habits.find(h => h.id === openId) ?? null

  return <div className="hb-page">
    <header className="hb-head">
      <div>
        <h1>Habits</h1>
        {habits.length > 0 && <p className="hb-head__summary">
          This week <b>{weekDone} of {weekTarget}</b>{longest > 0 && <> · longest run <b>{longest} {longest === 1 ? 'day' : 'days'}</b></>}
        </p>}
      </div>
      <Button size="sm" variant="quiet" icon="plus" onClick={() => setAdding(true)}>New habit</Button>
    </header>

    <Tabs options={ranges} value={range} onChange={setRange} label="Heatmap range" />

    {error && <p className="hb-error" role="alert">Couldn't load habits ({error}). <Button size="sm" variant="quiet" onClick={() => void load()}>Retry</Button></p>}

    <div className={`hb-list hb-list--${range}`}>
      {loading && habits.length === 0 && Array.from({ length: 4 }, (_, i) => <div key={i} className="hb-card" aria-hidden="true"><Skeleton height={22} width="40%" /><Skeleton height={14} /></div>)}
      {loading && <p className="ui-sr-only" role="status">Loading habits…</p>}
      {week.map(({ h, done }) => {
        const byDate = heatById.get(h.id) ?? new Map<string, number>()
        return <HabitCard key={h.id} habit={h} range={range} cells={cellsFor(h, byDate, RANGE_DAYS[range])} doneThisWeek={done}
          goal={goalFor(h.id)} running={isRunning(h.id)} elapsedMs={elapsedMs(h.id)}
          onOpen={() => setOpenId(h.id)} onToggle={() => void toggle(h)} onStart={() => startTimer(h)} onStop={() => stopTimer(h)} />
      })}
      {!loading && !error && habits.length === 0 && <p className="hb-hint">No habits yet. Add one to start a streak.</p>}
    </div>

    <GoalsSection goals={goals} habits={habits} onChanged={load} />
    <ChallengesSection />

    <HabitSheet habit={open} yearCells={open ? cellsFor(open, heatById.get(open.id) ?? new Map(), YEAR_DAYS) : []}
      running={open ? isRunning(open.id) : false} elapsedMs={open ? elapsedMs(open.id) : 0}
      onClose={() => setOpenId(null)}
      onLog={async m => { if (open) await logTime(open, m) }}
      onToggle={() => { if (open) void toggle(open) }}
      onStart={() => { if (open) startTimer(open) }}
      onStop={() => { if (open) stopTimer(open) }}
      onChanged={load}
      onDelete={() => { if (open) void removeHabit(open) }} />

    <NewHabitSheet open={adding} onClose={() => setAdding(false)} onCreated={async () => { setAdding(false); await load() }} />

    {/* Wait for any sheet to close: a modal dialog would hide the celebration while its timer marks it seen. */}
    {celebrating && openId == null && !adding && <GoalCelebration goal={celebrating} onDone={dismissCelebration} />}
  </div>
}

function NewHabitSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [timed, setTimed] = useState(true)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try { await api.createHabit(name.trim(), timed); setName(''); setTimed(true); setError(''); await onCreated() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  return <Sheet open={open} onClose={onClose} title="New habit" labelledBy="new-habit-title">
    <form className="hb-sheet" onSubmit={submit}>
      <label className="hb-field"><span>Name</span>
        <input className="hb-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Guitar" maxLength={80} required />
      </label>
      <label className="hb-check"><input type="checkbox" checked={timed} onChange={e => setTimed(e.target.checked)} /> Track time (log minutes)</label>
      {error && <p role="alert" className="hb-error">{error}</p>}
      <Button type="submit" variant="primary" block>Add habit</Button>
    </form>
  </Sheet>
}
