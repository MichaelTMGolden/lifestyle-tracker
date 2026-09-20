import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  api, type Alert, type CalendarEvent, type DailyTodo, type Habit, type HabitHeatmap,
  type ReviewRecommendation, type ScheduleBlock, type ScheduleToday, type Today, type Todo,
  type WeeklyReview,
} from '../api'
import { alertSeverity, categoryColor, fmtElapsed, fmtMinutes, habitColor } from '../lib'
import { Ring, Spark } from '../charts'
import { STATUS } from '../chartMath'
import { useNowMinutes, usePersistentToggle, usePoll } from '../hooks'
import { useTimer } from '../timer/useTimer'
import { Collapsible } from '../components/Collapsible'
import { Reorderable, DragGrip } from '../components/Reorderable'
import { CarryForwardPanel, TaskPlanActions, TodayPriorities, type PlanningAction } from '../components/DailyPlanning'
import { dailyPlanning, dateKey, nextDateKey } from '../dailyPlanning'
import { taskIsOverdue } from '../taskViews'
import '../dailyPlanning.css'
import './TodayPage.css'

const toMinutes = (iso: string) => { const d = new Date(iso); const today = new Date(); const dayDelta = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000; return dayDelta * 1440 + d.getHours() * 60 + d.getMinutes() }
const eventTime = (e: CalendarEvent) => e.allDay ? 'All day' : `${new Date(e.startsAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}–${new Date(e.endsAt).toLocaleString('en-IE', { ...(keyOf(new Date(e.startsAt)) !== keyOf(new Date(e.endsAt)) ? { day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit' })}`
const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`)
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const readyColor = (s: number) => (s >= 80 ? STATUS.good : s >= 65 ? '#9fc7b0' : s >= 45 ? STATUS.watch : STATUS.off)

type TimelineRow = { start: number; end: number } & (
  | { kind: 'block'; block: ScheduleBlock }
  | { kind: 'event'; event: CalendarEvent }
)

export default function TodayPage() {
  const [today, setToday] = useState<Today | null>(null)
  const [schedule, setSchedule] = useState<ScheduleToday | null>(null)
  const [habits, setHabits] = useState<Habit[]>([])
  const [heat, setHeat] = useState<HabitHeatmap[]>([])
  const [tasks, setTasks] = useState<Todo[]>([])
  const [daily, setDaily] = useState<DailyTodo[]>([])
  const [pending, setPending] = useState<DailyTodo[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [newDaily, setNewDaily] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actionInFlight = useRef(false)
  const loadVersion = useRef(0)

  const liveNow = useNowMinutes()
  const { timers, isRunning, start, stop, elapsedMs, dataTick } = useTimer()

  const load = useCallback(() => {
    const version = ++loadVersion.current
    return Promise.all([
    api.today(), api.scheduleToday(), api.habits(), api.habitsHeatmap(30), api.todos(), api.dailyTodos(),
    api.alerts().catch(() => [] as Alert[]),
    api.latestReview().catch(() => ({ enabled: false, review: null })),
    dailyPlanning.pending(),
  ]).then(([t, s, h, hm, tk, d, al, rv, carry]) => {
    if (version !== loadVersion.current) return
    setToday(t); setSchedule(s); setHabits(h); setHeat(hm); setTasks(tk); setDaily(d); setAlerts(al); setReview(rv.review); setPending(carry); setError(null)
    }).catch(e => { if (version === loadVersion.current) setError(String(e)) })
  }, [])
  const onAction: PlanningAction = async (operation, message) => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    ++loadVersion.current
    setBusy(true); setActionError(null); setNotice(null)
    try { await operation(); setNotice(message); await load() }
    catch (e) { setActionError(e instanceof Error ? e.message : String(e)); await load() }
    finally { actionInFlight.current = false; setBusy(false) }
  }
  async function dismissAlert(id: number) { await onAction(() => api.dismissAlert(id), 'Alert dismissed.') }
  useEffect(() => { load() }, [load])
  // Refetch when a timer is logged or a to-do is quick-added from the sticky bar.
  useEffect(() => { if (dataTick) load() }, [dataTick, load])
  // Poll so the current/next block and calendar stay fresh without a manual refresh
  // (the now-line itself advances every 30s via useNowMinutes below).
  usePoll(load, 180_000)

  if (!today || !schedule) return error ? <div className="planning-feedback error" role="alert"><span>Could not load your dashboard. {error}</span><button className="btn" onClick={load}>Retry</button></div> : <p className="muted" role="status">Loading your day…</p>

  const now = liveNow
  // Do we have any real Garmin-sourced health data yet? Drives honest empty states.
  const hasHealth = today.readiness != null
  const dateLabel = new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' })
  const openDaily = daily.filter((d) => !d.done)
  const dailyDone = daily.length - openDaily.length
  const overdue = tasks.filter(task => taskIsOverdue(task, dateKey()))
  const upcoming = tasks.filter((t) => !t.completedAt && !overdue.includes(t) && t.plannedFor !== dateKey())
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')).slice(0, 4)

  // schedule timeline (merged, partitioned around now)
  const rows: TimelineRow[] = [
    ...schedule.blocks.map((b) => ({ start: b.startMinutes, end: b.durationMinutes != null ? b.startMinutes + b.durationMinutes : Math.min(1440, ...schedule.blocks.filter(next => next.startMinutes > b.startMinutes).map(next => next.startMinutes)), kind: 'block' as const, block: b })),
    ...schedule.events.map((e) => ({ start: Math.max(0, toMinutes(e.startsAt)), end: Math.min(1440, toMinutes(e.endsAt)), kind: 'event' as const, event: e })),
  ].sort((a, b) => a.start - b.start)
  const past = rows.filter((r) => r.end <= now)
  const rest = rows.filter((r) => r.end > now)
  const blocksDone = rows.filter(row => row.kind === 'block' && row.end <= now).length
  const blocksTotal = schedule.blocks.length

  // weekly grid + momentum from heatmap
  const week = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return [...Array(7)].map((_, i) => { const d = new Date(t); d.setDate(t.getDate() - (6 - i)); return d }) })()
  // Current Monday→Sunday week for the grid, so the M T W T F S S labels line up
  // with real weekdays and today highlights under the correct column.
  const weekDays = (() => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const monday = new Date(t); monday.setDate(t.getDate() - ((t.getDay() + 6) % 7)) // Mon = start
    return [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })
  })()
  const todayKey = keyOf(new Date(new Date().setHours(0, 0, 0, 0)))
  const heatById = new Map(heat.map((h) => [h.id, new Set(h.completedDates)]))
  const weeklyTarget = habits.reduce((sum, habit) => sum + (habit.cadence === 'weekly' ? habit.targetPerPeriod : 7), 0)
  const targetHits = habits.reduce((sum, habit) => { const done = heatById.get(habit.id) ?? new Set<string>(); const hits = week.filter(day => done.has(keyOf(day))).length; return sum + Math.min(hits, habit.cadence === 'weekly' ? habit.targetPerPeriod : 7) }, 0)
  const weekPct = weeklyTarget ? Math.round(targetHits / weeklyTarget * 100) : 0
  const longest = habits.map((h) => ({ name: h.name, streak: h.currentStreak, weekly: h.cadence === 'weekly' })).sort((a, b) => b.streak * (b.weekly ? 7 : 1) - a.streak * (a.weekly ? 7 : 1))[0]

  const plannedToday = tasks.filter(task => task.plannedFor === todayKey)
  const actionsTotal = daily.length + plannedToday.length
  const actionsDone = dailyDone + plannedToday.filter(task => task.completedAt).length
  const prioritiesCount = plannedToday.filter(task => task.isPriority && !task.completedAt).length

  async function toggleHabit(id: number) {
    await onAction(() => api.toggleHabit(id), 'Habit updated.')
  }
  async function addDaily(e: FormEvent) { e.preventDefault(); if (!newDaily.trim()) return; await onAction(async () => { await api.createDailyTodo(newDaily.trim()); setNewDaily('') }, 'Added to today.') }
  async function toggleDaily(id: number) { await onAction(() => api.toggleDailyTodo(id), 'To-do updated.') }
  async function removeDaily(id: number) { await onAction(() => api.deleteDailyTodo(id), 'To-do removed.') }
  // Optimistic drag-reorder; reload to reconcile if the persist fails.
  async function reorderDaily(ids: number[]) {
    if (actionInFlight.current) return
    const byId = new Map(daily.map((d) => [d.id, d]))
    setDaily(ids.map((id) => byId.get(id)!).filter(Boolean))
    await onAction(() => api.reorderDailyTodos(ids), 'Order saved.')
  }
  // Tapping a timed skill starts its timer (tap a running one again to stop & log);
  // binary skills just toggle done. Multiple timers can run at once.
  async function mobileSkill(h: Habit) {
    if (!h.tracksTime) { await toggleHabit(h.id); return }
    if (isRunning(h.id)) await onAction(() => stop(h.id), 'Practice stopped and synced.')
    else await onAction(() => start(h.id, h.name), 'Practice timer started.')
  }
  const runningIds = timers.map((t) => t.habitId)
  // Only the habits the user pinned to quick actions (managed on the Habits page).
  const quickHabits = habits.filter((h) => h.showInQuickActions)

  const dayHead = (
    <header className="today-heading">
      <div>
        <p className="today-eyebrow">{dateLabel}</p>
        <h1>Today<span aria-hidden>.</span></h1>
        <p className="today-intro">A little structure. More room for what matters.</p>
      </div>
      <div className="today-heading-actions"><button className="btn today-add-shortcut" onClick={() => { document.getElementById('today-checklist')?.scrollIntoView({ block: 'center' }); document.getElementById('today-capture')?.focus({ preventScroll: true }) }}>＋ Quick add</button><div className="today-progress" aria-label={`${actionsDone} of ${actionsTotal} planned actions complete`}>
        <Ring value={actionsTotal ? actionsDone / actionsTotal * 100 : 0} size={48} color="var(--good)" />
        <div><strong>{actionsDone}<span> / {actionsTotal}</span></strong><span>{actionsTotal ? 'actions complete' : 'Start with one small thing'}</span></div>
      </div></div>
    </header>
  )
  const addForm = (
    <form className="daily-add" onSubmit={addDaily}>
      <input id="today-capture" aria-label="New to-do for today" value={newDaily} placeholder="Something to get done today…" onChange={(e) => setNewDaily(e.target.value)} />
      <button className="btn" type="submit" disabled={busy || !newDaily.trim()}>Add to today</button>
    </form>
  )

  const feedback = <>
    {error && <div className="planning-feedback error" role="alert"><span>Could not refresh. Your last loaded data is still shown. {error}</span><button className="btn" onClick={load}>Retry</button></div>}
    {actionError && <div className="planning-feedback error" role="alert">{actionError}<button className="btn" onClick={() => setActionError(null)}>Dismiss</button></div>}
    {notice && <p className="planning-feedback" role="status">{notice}</p>}
  </>
  const dailyActions = <CarryForwardPanel items={pending} busy={busy} onAction={onAction} />
  const priorities = <TodayPriorities tasks={tasks} busy={busy} onAction={onAction} />

  return (
    <div className="today-workspace">
      {dayHead}
      {feedback}
      <nav className="today-overview" aria-label="Today overview">
        <a href="#today-focus"><span className="overview-value">{prioritiesCount}<small>/ 3</small></span><span>Priorities</span><span aria-hidden>↗</span></a>
        <a href="#today-checklist"><span className="overview-value">{openDaily.length}</span><span>Small to-dos</span><span aria-hidden>↗</span></a>
        <Link to="/tasks?view=overdue" className={overdue.length ? 'has-overdue' : ''}><span className="overview-value">{overdue.length}</span><span>Overdue tasks</span><span aria-hidden>↗</span></Link>
      </nav>
      <AttentionStrip alerts={alerts} onDismiss={dismissAlert} />
      <a href="#today-context" className="today-mobile-now"><span>Now</span><strong>{today.current?.activity ?? 'Open time'}</strong><span aria-hidden>↗</span></a>

      <div className="today-layout">
        <div className="today-plan-column">
          <div id="today-focus" className="today-focus-area">{priorities}</div>
          <section className="card today-checklist" id="today-checklist">
            <div className="today-section-heading"><div><p className="today-eyebrow">Clear a little space</p><h2>Today's checklist</h2></div><span className="today-count">{openDaily.length} left</span></div>
            {addForm}
            <TodoListItems daily={daily} toggleDaily={toggleDaily} removeDaily={removeDaily} onReorder={reorderDaily} onAction={onAction} busy={busy} />
          </section>
          {dailyActions}
          <section className="card today-practice" id="today-practice">
            <div className="today-section-heading"><div><p className="today-eyebrow">Keep showing up</p><h2>Make time for practice</h2></div><Link to="/habits">All habits ↗</Link></div>
            {timers.map(timer => <RunningTimer key={timer.habitId} name={timer.habitName} elapsedMs={elapsedMs(timer.habitId)} onStop={() => onAction(() => stop(timer.habitId), 'Practice stopped and synced.')} />)}
            <SkillChips habits={quickHabits} onSkill={mobileSkill} runningIds={runningIds} busy={busy} />
            {!quickHabits.length && <p className="muted">Pin your regular practice on the <Link to="/habits">Habits page</Link> for a quick start here.</p>}
            <details className="today-practice-week"><summary>This week's practice <span>{today.habitsCompletedToday} logged today</span></summary><WeeklyGrid habits={habits} heatById={heatById} week={weekDays} todayKey={todayKey} /><MomentumInner weekPct={weekPct} weekHits={targetHits} weeklyTarget={weeklyTarget} longest={longest} /></details>
          </section>
          <Collapsible title={<>Choose what comes next <span className="today-count">{overdue.filter(task => task.plannedFor !== todayKey).length + upcoming.length}</span></>} storageKey="today.other-tasks.v2">
            <p className="muted">Bring a task into today when you have room for it.</p>
            <TasksInner overdue={overdue.filter(task => task.plannedFor !== todayKey)} upcoming={upcoming} busy={busy} onAction={onAction} />
            <Link to="/tasks" className="today-inline-link">Open all tasks ↗</Link>
          </Collapsible>
          <ReviewNudge review={review} />
        </div>

        <aside className="today-context" id="today-context" aria-label="Your day at a glance">
          <div className="today-context-heading"><span className="today-eyebrow">Around your plan</span><Link to="/schedule">Schedule ↗</Link></div>
          <NowNext today={today} now={now} blocksDone={blocksDone} blocksTotal={blocksTotal} />
          <section className="card today-agenda">
            <div className="today-section-heading"><h2>On the horizon</h2><span className="today-count">{schedule.events.length} appointments</span></div>
            <ScheduleInner past={past} rest={rest} now={now} showPast={showPast} setShowPast={setShowPast} />
            <Link to="/schedule" className="today-inline-link">See your full week ↗</Link>
          </section>
          <HealthCompact today={today} hasHealth={hasHealth} />
          <Link to="/nutrition" className="today-nutrition-link"><span className="today-shortcut-icon" aria-hidden>＋</span><div><strong>Log a meal</strong><span>A quick check-in with your day.</span></div><span aria-hidden>↗</span></Link>
        </aside>
      </div>
    </div>
  )
}

/* ===================== section components ===================== */

function NowNext({ today, now, blocksDone, blocksTotal }: { today: Today; now: number; blocksDone: number; blocksTotal: number }) {
  return (
    <section className="panel nownext">
      <div className="nn-cell">
        <div className="nn-k">● Now {fmtMinutes(now)}</div>
        {today.current ? (() => {
          const elapsed = Math.max(0, now - today.current!.startMinutes)
          const rem = today.current!.durationMinutes != null ? today.current!.startMinutes + today.current!.durationMinutes - now : null
          return <><div className="nn-act">{today.current!.activity}</div><div className="nn-meta">started {fmtDur(elapsed)} ago{rem != null && rem > 0 ? ` · ~${fmtDur(rem)} left` : ''}</div></>
        })() : <><div className="nn-act">Open block</div><div className="nn-meta">nothing scheduled right now</div></>}
      </div>
      <div className="nn-cell">
        <div className="nn-k next">Next{today.next ? ` · ${fmtMinutes(today.next.startMinutes)}` : ''}</div>
        {today.next
          ? <><div className="nn-act dim">{today.next.activity}</div><div className="nn-meta">in {fmtDur(today.next.startMinutes - now)}</div></>
          : <><div className="nn-act dim">Open time</div><div className="nn-meta">nothing else scheduled today</div></>}
      </div>
      <div className="nn-cell nn-right">
        <div className="nn-meta"><b style={{ color: 'var(--text)' }}>{blocksDone} of {blocksTotal}</b> scheduled blocks elapsed</div>
        <div className="prog"><i style={{ width: `${blocksTotal ? (blocksDone / blocksTotal) * 100 : 0}%` }} /></div>
        {today.tomorrowFirst && <div className="nn-tom">Tomorrow · <b>{fmtMinutes(today.tomorrowFirst.startMinutes)}</b> {today.tomorrowFirst.activity}</div>}
      </div>
    </section>
  )
}

// Top 1–3 active alerts, severity-sorted (API already sorts). Hidden when empty —
// no "all good" noise. Each row taps through to the relevant page and is dismissable.
function AttentionStrip({ alerts, onDismiss }: { alerts: Alert[]; onDismiss: (id: number) => void }) {
  if (alerts.length === 0) return null
  return (
    <section className="attention">
      {alerts.slice(0, 3).map((a) => {
        const sev = alertSeverity(a.severity)
        const href = a.subjectType === 'Goal' || a.subjectType === 'Habit' ? '/habits' : '/health'
        return (
          <div key={a.id} className={`alert-row${sev.loud ? ' loud' : ''}`} style={{ ['--sev' as string]: sev.color }}>
            <Link to={href} className="alert-main">
              <span className="alert-dot" />
              <span className="alert-text"><b>{a.title}</b><span className="alert-detail">{a.detail}</span></span>
            </Link>
            <button className="alert-x" onClick={() => onDismiss(a.id)} aria-label="Dismiss">✕</button>
          </div>
        )
      })}
    </section>
  )
}

// Keep the weekly review near the daily plan, with its latest recommendation.
// Shows the latest review's top recommendation when there is one, otherwise a
// plain prompt — but always renders so the page is reachable.
function ReviewNudge({ review }: { review: WeeklyReview | null }) {
  const rank = (r: ReviewRecommendation) => (r.priority === 'high' ? 0 : r.priority === 'medium' ? 1 : 2)
  const recs = review?.status === 'Generated' && review.output && !('error' in review.output)
    ? review.output.recommendations : null
  const top = recs && recs.length > 0 ? [...recs].sort((a, b) => rank(a) - rank(b))[0] : null
  return (
    <Link to="/review" className="review-nudge">
      <span className="rn-tag">Weekly review</span>
      <span className="rn-text">{top ? top.text : 'See how your week came together →'}</span>
      <span className="rn-arrow" aria-hidden>→</span>
    </Link>
  )
}

function HTilesRow({ today }: { today: Today }) {
  return (
    <div className="htiles">
      <HTile name="Sleep" main={today.lastSleepScore != null ? `${today.lastSleepScore}` : '—'} sub={today.sleepAvg14 != null ? `14-day avg ${today.sleepAvg14}` : 'No recent average'} spark={today.sleepSpark} goal={today.settings?.sleepScoreTarget ?? 70} color="#4fb0c6" />
      <HTile name="Resting HR" main={today.restingHr != null ? `${today.restingHr}` : '—'} sub={`baseline ${today.settings?.restingHrBaseline ?? 55}`} spark={today.rhrSpark} baseline={today.settings?.restingHrBaseline ?? 55} color="#e0697a" />
      <HTile name="Steps" main={today.stepsToday?.toLocaleString() ?? '—'} sub={today.stepsToday == null ? 'No reading for today' : `/ ${(today.settings?.stepsTarget ?? 8000).toLocaleString()}`} spark={today.stepsSpark} goal={today.settings?.stepsTarget ?? 8000} color="#d8a24f" />
    </div>
  )
}

// Body Battery from Garmin (synced via the connect page). Shows the latest
// reading as a 0–100 bar; a neutral empty state until the first sync lands.
function EnergyRow({ value }: { value: number | null }) {
  return (
    <div className="energy-row">
      <div className="er-head"><span>Energy · Body Battery</span>{value != null && <b>{Math.round(value)}</b>}</div>
      {value != null
        ? <div className="energy-bar"><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
        : <div className="energy-empty muted">No recent reading yet</div>}
    </div>
  )
}

// Compact context: show the essentials, expand for measurements and freshness.
function HealthCompact({ today, hasHealth }: { today: Today; hasHealth: boolean }) {
  const [open, toggle] = usePersistentToggle('today.health', false)
  return (
    <section className="card health-compact">
      <button type="button" className="collapse-head" aria-expanded={open} onClick={toggle}>
        <span className="hc-glance">
          {today.readiness != null && <Ring value={today.readiness} size={54} color={readyColor(today.readiness ?? 0)} />}
          <span className="hc-nums">
            <span className="hc-num">
              <b style={{ color: hasHealth ? readyColor(today.readiness ?? 0) : 'var(--text-dim)' }}>{hasHealth ? today.readiness : '—'}</b>
              <span>{hasHealth ? today.readinessLabel : 'No recent readiness'}</span>
            </span>
            <span className="hc-num"><b>{today.lastSleepScore ?? '—'}</b><span>Sleep</span></span>
            <span className="hc-num"><b>{today.restingHr ?? '—'}</b><span>Rest HR</span></span>
          </span>
        </span>
        <span className="collapse-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      <div className="hc-foot"><Link to="/health">Full page →</Link></div>
      {open && <div className="collapse-body"><HTilesRow today={today} /><EnergyRow value={today.bodyBattery} /><ReadinessFreshness today={today} /></div>}
    </section>
  )
}

function ReadinessFreshness({ today }: { today: Today }) {
  return <p className="planning-note health-freshness">{today.readinessComponents.map(component => `${component.label}: ${component.status === 'missing' ? 'not recorded' : `${component.status}${component.recordedAt ? ` · ${new Date(component.recordedAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}` : ''}`}`).join(' · ')}</p>
}

// Live pill for the timer running right now: name + ticking elapsed + stop & log.
function RunningTimer({ name, elapsedMs, onStop }: { name: string; elapsedMs: number; onStop: () => void }) {
  return (
    <div className="ql-timer">
      <span className="ql-timer-dot" aria-hidden />
      <span className="ql-timer-name">{name}</span>
      <span className="ql-timer-time">{fmtElapsed(elapsedMs)}</span>
      <button className="btn btn-sm" onClick={onStop} aria-label={`Stop and log ${name}`}>Stop &amp; log</button>
    </div>
  )
}

function SkillChips({ habits, onSkill, runningIds, busy }: { habits: Habit[]; onSkill: (h: Habit) => void; runningIds?: number[]; busy: boolean }) {
  return (
    <div className="skill-grid">
      {habits.map((h, idx) => {
        const color = habitColor(h.name, idx)
        const running = runningIds?.includes(h.id) ?? false
        return (
          <button key={h.id} disabled={busy} aria-label={`${running ? 'Stop' : h.tracksTime ? 'Start' : h.doneToday ? 'Uncheck' : 'Complete'} ${h.name}`} className={`skill-tile${h.doneToday ? ' done' : ''}${running ? ' running' : ''}`} style={{ ['--skill' as string]: color }} onClick={() => onSkill(h)}>
            <span className="skill-name">{h.name}<span className="skill-check">{running ? '●' : h.doneToday ? '✓' : ''}</span></span>
            <span className="skill-meta">{running ? 'Stop timer' : h.tracksTime ? 'Start a session' : h.doneToday ? 'Completed today' : 'Mark done'}</span>
          </button>
        )
      })}
    </div>
  )
}

function WeeklyGrid({ habits, heatById, week, todayKey }: {
  habits: Habit[]; heatById: Map<number, Set<string>>; week: Date[]; todayKey: string
}) {
  return (
    <div className="wgrid">
      <div />{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="wg-head">{d}</div>)}
      {habits.map((h, idx) => {
        const done = heatById.get(h.id) ?? new Set<string>()
        const color = habitColor(h.name, idx)
        return [
          <div key={`${h.id}n`} className="wg-name">{h.name}</div>,
          ...week.map((d) => { const k = keyOf(d); const hit = done.has(k); return <div key={`${h.id}${k}`} className={`wg-dot ${hit ? 'hit' : 'miss'} ${k === todayKey ? 'today' : ''}`} style={hit ? { background: color } : undefined} title={`${h.name}: ${d.toLocaleDateString('en-IE')} ${hit ? 'completed' : k > todayKey ? 'upcoming' : 'not logged'}`} /> }),
        ]
      })}
    </div>
  )
}

function MomentumInner({ weekPct, weekHits, weeklyTarget, longest }: {
  weekPct: number; weekHits: number; weeklyTarget: number; longest?: { name: string; streak: number; weekly: boolean }
}) {
  return (
    <div className="mom">
      <div><div className="mom-big" style={{ color: 'var(--good)' }}>{weekPct}%</div><div className="mom-lab">Last 7 days</div><div className="mom-sub">{weekHits}/{weeklyTarget} planned practice days</div></div>
      {longest && <div><div className="mom-big">{longest.streak}{longest.weekly ? 'w' : 'd'}</div><div className="mom-lab">Longest current streak</div><div className="mom-sub">{longest.name}</div></div>}
    </div>
  )
}

function ScheduleInner({ past, rest, now, showPast, setShowPast }: {
  past: TimelineRow[]; rest: TimelineRow[]; now: number; showPast: boolean; setShowPast: (v: boolean) => void
}) {
  return (
    <ul className="timeline">
      {past.length > 0 && (
        <li><button className="earlier" onClick={() => setShowPast(!showPast)}>{showPast ? '▾' : '▸'} Earlier today · {past.length} elapsed</button></li>
      )}
      {showPast && past.map((r) => <TLRow key={tlKey(r)} row={r} dim />)}
      <li className="now-line"><span className="now-label">now {fmtMinutes(now)}</span><span className="now-bar" /></li>
      {rest.map((r) => <TLRow key={tlKey(r)} row={r} current={r.kind === 'block' && r.start <= now && now < r.end} />)}
    </ul>
  )
}

function TasksInner({ overdue, upcoming, busy, onAction }: { overdue: Todo[]; upcoming: Todo[]; busy: boolean; onAction: PlanningAction }) {
  return <>
    {overdue.length > 0 && <div className="tgroup over">Overdue · {overdue.length}</div>}
    {[...overdue, ...upcoming].map(t => <div key={t.id} className="planning-item">
      <div className="planning-copy">{t.title}<small>{t.dueAt ? `Due ${new Date(`${t.dueAt.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IE')}` : 'No due date'}{t.plannedFor && t.plannedFor < dateKey() ? ` · planned ${t.plannedFor}` : ''}</small></div>
      <TaskPlanActions task={t} busy={busy} onAction={onAction} showComplete />
    </div>)}
    {overdue.length === 0 && upcoming.length === 0 && <p className="muted">Nothing else due.</p>}
  </>
}

function TodoListItems({ daily, toggleDaily, removeDaily, onReorder, onAction, busy }: {
  daily: DailyTodo[]; toggleDaily: (id: number) => void; removeDaily: (id: number) => void
  onReorder: (ids: number[]) => void; onAction: PlanningAction; busy: boolean
}) {
  const open = daily.filter(item => !item.done)
  const complete = daily.filter(item => item.done)
  return (
    <div className="list">
      {!open.length && <p className="today-empty">{complete.length ? 'A little more breathing room. Everything on this checklist is done.' : 'A call to make, an idea to follow up, a small thing to finish. Add it above.'}</p>}
      <Reorderable items={open} getId={(d) => d.id} onReorder={ids => onReorder([...ids, ...complete.map(item => item.id)])}
        renderRow={(d, handle) => (
          <div className="todo daily-row">
            {!busy && <DragGrip {...handle} />}
            <label className="daily-check">
              <input type="checkbox" disabled={busy} checked={d.done} onChange={() => toggleDaily(d.id)} />
              <span>{d.title}</span>
            </label>
            <button className="btn btn-sm" disabled={busy} onClick={() => onAction(() => dailyPlanning.carry(d.id, nextDateKey()), 'Moved to tomorrow.')}>Tomorrow</button>
            <button className="icon-btn danger" disabled={busy} onClick={() => removeDaily(d.id)} aria-label={`Remove ${d.title}`} title="Remove">✕</button>
          </div>
        )} />
      {complete.length > 0 && <details className="today-completed"><summary>Completed today <span>{complete.length}</span></summary>{complete.map(item => <div className="todo daily-row" key={item.id}><label className="daily-check"><input type="checkbox" disabled={busy} checked onChange={() => toggleDaily(item.id)} /><span className="done">{item.title}</span></label><button className="icon-btn danger" disabled={busy} onClick={() => removeDaily(item.id)} aria-label={`Remove ${item.title}`}>✕</button></div>)}</details>}
    </div>
  )
}

/* ===================== small reusable bits ===================== */

const tlKey = (r: TimelineRow) => (r.kind === 'event' ? `e${r.event.id}` : `b${r.block.id}`)

function TLRow({ row, dim, current }: { row: TimelineRow; dim?: boolean; current?: boolean }) {
  if (row.kind === 'event') {
    const e = row.event
    return (
      <li className={`tl-row tl-cal${dim ? ' dim' : ''}`}>
        <span className="tl-time">{fmtMinutes(row.start)}</span>
        <span className="tl-dot cal" />
        <span className="tl-body">
          <span className="tl-event">▶ {e.title}</span>
          <span className="tl-notes">{eventTime(e)} · calendar</span>
        </span>
      </li>
    )
  }
  const b = row.block
  return (
    <li className={`tl-row${dim || b.overlapped ? ' dim' : ''}${current ? ' now' : ''}`}>
      <span className="tl-time">{fmtMinutes(b.startMinutes)}</span>
      <span className="tl-dot" style={{ background: categoryColor[b.category] ?? '#999' }} />
      <span className="tl-body">
        <span className="tl-act">{b.activity}{b.protected && <span className="badge">protected</span>}</span>
        {b.notes && <span className="tl-notes">{b.notes}</span>}
      </span>
    </li>
  )
}

function HTile({ name, main, sub, spark, goal, baseline, color }: {
  name: string; main: string; sub: string; spark: number[]; goal?: number; baseline?: number; color: string
}) {
  return (
    <div className="htile">
      <div className="ht-name">{name}</div>
      <div className="ht-val">{main} <small>{sub}</small></div>
      <Spark data={spark} color={color} goal={goal} baseline={baseline} h={26} fill={false} />
    </div>
  )
}

