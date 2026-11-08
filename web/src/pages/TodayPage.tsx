// Today: date and what's next, running timers, habits as tap tiles, today's list,
// anything carried over, and what's coming up. Essentials fit without scrolling.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
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
      <Skeleton height={40} width="60%" /><Skeleton height={120} /><Skeleton height={180} />
    </div>
  }

  const { today, schedule, habits, todos: tasks, dailyTodos: daily, pending, alerts } = data
  const day = dateKey()
  const date = new Date()
  const doneCount = habits.filter(h => h.doneToday).length
  const agenda = agendaRows(schedule.blocks, schedule.events, now)
  const nextUp = agenda.find(r => !r.current) ?? null
  const planned = tasks.filter(t => t.plannedFor === day)
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
            : 'Nothing else scheduled today'}
        </span>
      </div>
      {habits.length > 0 && <Ring value={doneCount} max={habits.length} label={`${doneCount} of ${habits.length} habits done today`} />}
    </header>

    {bundle.error && <p className="td-error" role="alert">Couldn't refresh. Showing what was last loaded. <Button size="sm" variant="quiet" onClick={() => void bundle.refetch()}>Retry</Button></p>}
    <Alerts alerts={alerts} onDismiss={id => quick(() => writes.dismissAlert(id))} />

    <RunningTimers timers={timers} goals={goals.data} elapsedMs={elapsedMs}
      onStop={id => { void stop(id).catch(() => { /* TimerProvider shows the error. */ }) }} />

    <section aria-labelledby="td-habits">
      <SectionHead id="td-habits" title="Habits" aside={<span className="td-hint">Tap to log</span>} />
      <HabitTiles habits={habits} milestone={milestone} isRunning={isRunning} elapsedMs={elapsedMs} onTap={tapHabit} onLogPast={() => setLogging(true)} />
    </section>

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
  </div>
}
