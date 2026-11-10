// Today: date and what's next, running timers, habits as tap tiles, today's list,
// anything carried over, and what's coming up. Essentials fit without scrolling.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type DailyTodo, type Habit, type Todo } from '../api'
import { CarryForwardPanel, type PlanningAction } from '../components/DailyPlanning'
import { Collapsible } from '../components/Collapsible'
import { dailyPlanning, dateKey, nextDateKey } from '../dailyPlanning'
import { useNowMinutes } from '../hooks'
import { fmtMinutes } from '../lib'
import { taskIsOverdue } from '../taskViews'
import { useTimer } from '../timer/useTimer'
import { useTodayBundle, useTodayWrites } from '../todayData'
import { Button, Ring, SectionHead, Skeleton } from '../ui'
import { useToast } from '../ui/hooks'
import { addMinutes, QUEUED } from '../offline/habitSync'
import { agendaRows } from './today/agenda'
import { useStreakMilestones } from './habits/milestones'
import { useLevels } from './habits/useLevels'
import { titleFor } from './habits/levels'
import { Celebration } from '../components/Celebration'
import { useSeasons } from './habits/useSeasons'
import { useSkillGoals } from './habits/useSkillGoals'
import { sortGoals, type SkillGoal } from '../skillGoals'
import { GoalLine } from './habits/SkillGoals'
import { habitStyle } from '../habitColor'
import { CheckIn } from './today/CheckIn'
import { splitByFocus } from '../seasons'
import { eventOnDay, PLAN_DAYS } from './plan/days'
import { Alerts, ComingUp, HabitTiles, LogTimeSheet, RunningTimers, TodayList } from './today/parts'
import '../dailyPlanning.css'
import './today/today.css'

const NO_HABITS: Habit[] = []
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export default function TodayPage() {
  const bundle = useTodayBundle()
  const writes = useTodayWrites()
  const toast = useToast()
  const now = useNowMinutes()
  const { timers, isRunning, start, stop, elapsedMs, dataTick } = useTimer()
  const [busy, setBusy] = useState(false)
  const [logging, setLogging] = useState(false)
  const inFlight = useRef(false)
  // Goals only matter for the running-timer card; fetch them while a timer runs.
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals, enabled: timers.length > 0 })
  const qc = useQueryClient()
  const milestone = useStreakMilestones(bundle.data?.habits ?? NO_HABITS)
  const { levels, celebrate: levelUp, dismiss: dismissLevelUp } = useLevels(bundle.data?.habits ?? NO_HABITS, !!bundle.data)
  const { current: season } = useSeasons()
  const skillGoals = useSkillGoals().all
  const [params] = useSearchParams()
  // Once today has nothing left, the header previews tomorrow. Same cache as Plan.
  const [quietDay, setQuietDay] = useState(false)
  const upcoming = useQuery({ queryKey: ['calendar', PLAN_DAYS], queryFn: () => api.calendarDays(PLAN_DAYS), enabled: quietDay })

  // A timer stopped here, in the action bar or on another device logged minutes:
  // re-sync once, goals included so other running timers' cards stay accurate.
  const refresh = writes.refresh
  useEffect(() => {
    if (!dataTick) return
    void refresh()
    void qc.invalidateQueries({ queryKey: ['goals'] })
  }, [dataTick, refresh, qc])

  const failed = (e: unknown) => toast.show({ message: `Couldn't save: ${message(e)}`, tone: 'error' })
  // Planning actions change several sections at once, so they re-sync the bundle.
  const onAction: PlanningAction = async (operation, done) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true)
    try { await operation(); toast.show({ message: done }) }
    catch (e) { failed(e) }
    finally { await writes.refresh(); inFlight.current = false; setBusy(false) }
  }
  // Single taps update at once and never lock the page.
  const quick = (operation: () => Promise<void>) => { operation().catch(failed) }

  const data = bundle.data
  if (!data) {
    if (bundle.error) return <div className="td-page"><p className="td-error" role="alert">Couldn't load your day. {message(bundle.error)} <Button size="sm" variant="quiet" onClick={() => void bundle.refetch()}>Retry</Button></p></div>
    return <div className="td-page" aria-busy="true">
      <p className="ui-sr-only" role="status">Loading your day…</p>
      <div className="td-head" aria-hidden="true">
        <div className="td-head__text"><Skeleton height={12} width={72} /><Skeleton height={38} width={200} /><Skeleton height={14} width={170} /></div>
        <Skeleton width={56} height={56} radius={28} />
      </div>
      <section aria-hidden="true"><Skeleton height={24} width={90} />
        <div className="td-tiles">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={60} radius={14} />)}</div>
      </section>
      <section aria-hidden="true"><Skeleton height={24} width={70} /><Skeleton lines={3} height={44} /></section>
    </div>
  }

  const { today, schedule, habits, todos: tasks, dailyTodos: daily, pending, alerts } = data
  const day = dateKey()
  const date = new Date()
  // This season's habits are the day's tiles and ring; the rest sit below as chips.
  const { focus, others } = splitByFocus(habits, season)
  const doneCount = focus.filter(h => h.doneToday).length
  const agenda = agendaRows(schedule.blocks, schedule.events, now)
  const nextUp = agenda.find(r => !r.current) ?? null
  const planned = tasks.filter(t => t.plannedFor === day)
  const quiet = !today.current && !nextUp
  if (quiet !== quietDay) setQuietDay(quiet)
  const tomorrow = nextDateKey()
  const tomorrowEvent = quiet ? (upcoming.data ?? []).filter(e => eventOnDay(e, tomorrow))
    .filter(e => e.allDay || Date.parse(e.startsAt) >= new Date(`${tomorrow}T00:00:00`).getTime())
    .sort((a, b) => Number(a.allDay) - Number(b.allDay) || Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] : undefined
  const tomorrowTasks = quiet ? tasks.filter(t => !t.completedAt && t.plannedFor === tomorrow).length : 0
  const candidates = [
    ...tasks.filter(t => taskIsOverdue(t, day) && t.plannedFor !== day),
    ...tasks.filter(t => !t.completedAt && !taskIsOverdue(t, day) && t.plannedFor !== day)
      .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')).slice(0, 4),
  ]

  function tapHabit(h: Habit) {
    if (h.tracksTime) {
      if (isRunning(h.id)) void stop(h.id).catch(() => { /* TimerProvider shows the error. */ })
      else void start(h.id, h.name).catch(() => { /* TimerProvider shows the error. */ })
      return
    }
    // Offer Undo only once the change is saved; a failed write has already rolled back.
    writes.toggleHabit(h).then(() => {
      const saved = { ...h, doneToday: !h.doneToday }
      toast.show({ message: h.doneToday ? `${h.name} unmarked` : `${h.name} done`, action: { label: 'Undo', onClick: () => quick(() => writes.toggleHabit(saved)) } })
    }, failed)
  }
  async function logPast(h: Habit, mins: number) {
    try {
      if (await addMinutes(h, dateKey(), mins) === QUEUED) { toast.show({ message: `${h.name} · ${mins} min: saved on this device · syncs when you are back online` }); return }
      toast.show({ message: `${h.name} · ${mins} min logged` })
      await Promise.all([writes.refresh(), qc.invalidateQueries({ queryKey: ['goals'] })])
    }
    catch (e) { failed(e) }
  }
  const completeTask = (t: Todo) => void onAction(() => api.toggleTodo(t.id), t.completedAt ? 'Task reopened.' : 'Task done.')
  const laterDaily = (d: DailyTodo) => void onAction(() => dailyPlanning.carry(d.id, nextDateKey()), 'Moved to tomorrow.')

  return <div className="td-page">
    <header className="td-head">
      <div className="td-head__text">
        <span className="td-head__day">{date.toLocaleDateString(undefined, { weekday: 'long' })}</span>
        <h1>{date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</h1>
        <span className="td-head__next">
          {today.current ? <>Now · <b>{today.current.activity}</b></>
            : nextUp ? <>Next · <b>{fmtMinutes(nextUp.start)} {nextUp.title}</b></>
            : tomorrowEvent ? <>Tomorrow · <b>{tomorrowEvent.allDay ? tomorrowEvent.title : `${new Date(tomorrowEvent.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ${tomorrowEvent.title}`}</b></>
            : tomorrowTasks ? <>Tomorrow · <b>{tomorrowTasks} {tomorrowTasks === 1 ? 'task' : 'tasks'} planned</b></>
            : 'Nothing else scheduled today'}
        </span>
        {habits.length > 0 && <Link to="/stats#levels" className="td-head__level">Level {levels.player.level} · {titleFor(levels.player.level)}</Link>}
      </div>
      {focus.length > 0 && <Ring value={doneCount} max={focus.length} label={`${doneCount} of ${focus.length} ${season && others.length ? 'focus ' : ''}habits done today`} />}
    </header>

    {bundle.error && <p className="td-error" role="alert">Couldn't refresh. Showing what was last loaded. <Button size="sm" variant="quiet" onClick={() => void bundle.refetch()}>Retry</Button></p>}
    <Alerts alerts={alerts} onDismiss={id => quick(() => writes.dismissAlert(id))} />

    <RunningTimers timers={timers} goals={goals.data} elapsedMs={elapsedMs}
      onStop={id => { void stop(id).catch(() => { /* TimerProvider shows the error. */ }) }} />

    <section aria-labelledby="td-habits">
      <SectionHead id="td-habits" title="Habits" aside={<span className="td-hint">Tap to log</span>} />
      <HabitTiles habits={focus} milestone={milestone} isRunning={isRunning} elapsedMs={elapsedMs} onTap={tapHabit} onLogPast={() => setLogging(true)} />
      <Aims habits={focus} goals={skillGoals} />
      {others.length > 0 && <div className="td-others">
        <span className="td-others__label">Also tracking</span>
        <HabitTiles compact habits={others} milestone={milestone} isRunning={isRunning} elapsedMs={elapsedMs} onTap={tapHabit} />
      </div>}
    </section>

    <CheckIn openHabits={focus.filter(h => !h.doneToday)} tasks={planned.filter(t => !t.completedAt)} daily={daily.filter(d => !d.done)}
      busy={busy} onAction={onAction} onTapHabit={tapHabit} forced={params.get('checkin') === '1'} />

    <section aria-labelledby="td-today">
      <SectionHead id="td-today" title="Today" aside={<Link className="td-link" to="/tasks?view=today">Plan →</Link>} />
      <TodayList planned={planned} daily={daily} busy={busy} onAction={onAction}
        onCompleteTask={completeTask}
        onToggleDaily={d => quick(() => writes.toggleDaily(d))}
        onRemoveDaily={d => quick(() => writes.removeDaily(d))}
        onLaterDaily={laterDaily}
        onReorderDaily={ids => quick(() => writes.reorderDaily(ids))}
        onAdd={title => quick(() => writes.addDaily(title))} />
    </section>

    <CarryForwardPanel items={pending} busy={busy} onAction={onAction} />

    <Collapsible title={<>Coming up <span className="td-count">{agenda.length + candidates.length}</span></>} storageKey="today.coming-up">
      <ComingUp agenda={agenda} tasks={candidates} busy={busy} onAction={onAction} />
    </Collapsible>

    <LogTimeSheet open={logging} habits={habits} onClose={() => setLogging(false)} onLog={logPast} />
    {levelUp && !logging && <Celebration eyebrow={levelUp.newTitle ? 'New title' : 'Level up'} title={levelUp.newTitle ? levelUp.title : `Level ${levelUp.level}`}
      figure={String(levelUp.level)} note={levelUp.newTitle ? `You're now ${levelUp.title} · level ${levelUp.level}.` : `${levelUp.title} · keep going.`} onDone={dismissLevelUp} />}
  </div>
}

/** The lead goal of each focus habit that has one: a reminder of what the practice is for. */
function Aims({ habits, goals }: { habits: Habit[]; goals: SkillGoal[] }) {
  const rows = habits.flatMap(h => { const open = sortGoals(goals.filter(g => g.habitId === h.id)).open; return open.length ? [{ h, open }] : [] })
  if (!rows.length) return null
  return <div className="td-aims">
    <span className="td-others__label">Working toward</span>
    <ul>
      {rows.map(({ h, open }) => <li key={h.id} style={habitStyle(h)}>
        <Link to={`/habits/${h.id}#working-toward`} className="td-aims__row"><span className="td-aims__dot" aria-hidden="true" /><b>{h.name}</b><GoalLine goal={open[0]} more={open.length - 1} /></Link>
      </li>)}
    </ul>
  </div>
}
