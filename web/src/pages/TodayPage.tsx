import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  api, type CalendarEvent, type DailyTodo, type Habit, type HabitHeatmap,
  type ScheduleBlock, type ScheduleToday, type Today, type Todo,
} from '../api'
import { categoryColor, fmtMinutes, habitColor } from '../lib'
import { Ring, Spark, STATUS } from '../charts'
import { useIsMobile, usePersistentToggle } from '../hooks'
import { useTimer } from '../timer/TimerContext'
import { Collapsible } from '../components/Collapsible'

const toMinutes = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`)
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const readyColor = (s: number) => (s >= 80 ? STATUS.good : s >= 65 ? '#9fc7b0' : s >= 45 ? STATUS.watch : STATUS.off)

// Sample intraday energy curve (real Body Battery arrives once Garmin is connected).
const SAMPLE_BB = [36, 52, 69, 84, 90, 85, 78, 73, 70, 66, 64, 71, 66, 61, 60, 61, 62]

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
  const [newDaily, setNewDaily] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMobile = useIsMobile()
  const { timer, start, dataTick } = useTimer()

  async function load() {
    try {
      const [t, s, h, hm, tk, d] = await Promise.all([
        api.today(), api.scheduleToday(), api.habits(), api.habitsHeatmap(30), api.todos(), api.dailyTodos(),
      ])
      setToday(t); setSchedule(s); setHabits(h); setHeat(hm); setTasks(tk); setDaily(d)
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => { load() }, [])
  // Refetch when a timer is logged or a to-do is quick-added from the sticky bar.
  useEffect(() => { if (dataTick) load() }, [dataTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="error">Couldn't reach the API ({error}). Is it running on :5080?</p>
  if (!today || !schedule) return <p className="muted">Loading…</p>

  const now = today.nowMinutes
  const dateLabel = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const openDaily = daily.filter((d) => !d.done)
  const dailyDone = daily.length - openDaily.length
  const overdue = tasks.filter((t) => !t.completedAt && t.dueAt && new Date(t.dueAt) < new Date(new Date().toDateString()))
  const upcoming = tasks.filter((t) => !t.completedAt && !overdue.includes(t))
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')).slice(0, 4)

  // schedule timeline (merged, partitioned around now)
  const rows: TimelineRow[] = [
    ...schedule.blocks.map((b) => ({ start: b.startMinutes, end: b.startMinutes + (b.durationMinutes ?? 0), kind: 'block' as const, block: b })),
    ...schedule.events.map((e) => ({ start: toMinutes(e.startsAt), end: toMinutes(e.endsAt), kind: 'event' as const, event: e })),
  ].sort((a, b) => a.start - b.start)
  const past = rows.filter((r) => r.end <= now)
  const rest = rows.filter((r) => r.end > now)
  const blocksDone = schedule.blocks.filter((b) => b.startMinutes + (b.durationMinutes ?? 0) <= now).length
  const blocksTotal = schedule.blocks.length

  // weekly grid + momentum from heatmap
  const week = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return [...Array(7)].map((_, i) => { const d = new Date(t); d.setDate(t.getDate() - (6 - i)); return d }) })()
  const todayKey = keyOf(new Date(new Date().setHours(0, 0, 0, 0)))
  const heatByName = new Map(heat.map((h) => [h.name, new Set(h.completedDates)]))
  const streakOf = (done: Set<string>) => { let n = 0; const d = new Date(); d.setHours(0, 0, 0, 0); if (!done.has(keyOf(d))) d.setDate(d.getDate() - 1); while (done.has(keyOf(d))) { n++; d.setDate(d.getDate() - 1) } return n }
  const weekHits = heat.reduce((s, h) => { const set = new Set(h.completedDates); return s + week.filter((d) => set.has(keyOf(d))).length }, 0)
  const weekPct = heat.length ? Math.round((weekHits / (heat.length * 7)) * 100) : 0
  const longest = heat.map((h) => ({ name: h.name, streak: streakOf(new Set(h.completedDates)) })).sort((a, b) => b.streak - a.streak)[0]

  const framing = (() => {
    if (now < 660) return <>Good morning. <b>{overdue.length} overdue</b>, {openDaily.length} to-dos · first block <b>{schedule.blocks[0] ? `${fmtMinutes(schedule.blocks[0].startMinutes)} ${schedule.blocks[0].activity}` : '—'}</b>.</>
    if (now < 1020) return <>Midday. <b>{blocksDone} of {blocksTotal}</b> blocks done · {openDaily.length} to-dos left, <b>{overdue.length} overdue</b>.</>
    return <>Winding down. <b>{openDaily.length} to-dos</b> left and <b>{overdue.length} overdue</b>{today.tomorrowFirst ? <> · tomorrow starts {fmtMinutes(today.tomorrowFirst.startMinutes)}</> : null}.</>
  })()

  async function toggleHabit(id: number) { await api.toggleHabit(id); load() }
  async function addDaily(e: FormEvent) { e.preventDefault(); if (!newDaily.trim()) return; await api.createDailyTodo(newDaily.trim()); setNewDaily(''); load() }
  async function toggleDaily(id: number) { await api.toggleDailyTodo(id); load() }
  async function removeDaily(id: number) { await api.deleteDailyTodo(id); load() }
  // Mobile capture zone: tapping a timed skill starts its timer; binary skills toggle done.
  async function mobileSkill(h: Habit) { if (h.tracksTime) await start(h.id, h.name); else await toggleHabit(h.id) }

  const dayHead = (
    <div className="dayhead">
      <div>
        <h1>{schedule.day}</h1>
        <p className="subtitle">{dateLabel}</p>
        <p className="framing">{framing}</p>
      </div>
    </div>
  )
  const addForm = (
    <form className="daily-add" onSubmit={addDaily}>
      <input value={newDaily} placeholder="Add a to-do for today…" onChange={(e) => setNewDaily(e.target.value)} />
      <button className="btn" type="submit">Add</button>
    </form>
  )

  /* ---------------- mobile: capture + glance first ---------------- */
  if (isMobile) {
    return (
      <>
        {dayHead}
        <NowNext today={today} now={now} blocksDone={blocksDone} blocksTotal={blocksTotal} />

        <section className="card quick-actions">
          <h2>Quick actions</h2>
          {addForm}
          <SkillChips habits={habits} onSkill={mobileSkill} runningId={timer?.habitId} />
        </section>

        <section className="card">
          <h2>Today's to-do</h2>
          <TodoListItems daily={daily} toggleDaily={toggleDaily} removeDaily={removeDaily} />
        </section>

        <NextAppointment events={schedule.events} now={now} />

        <HealthCompact today={today} now={now} />

        <section className="card">
          <h2>Tasks <Link to="/tasks" className="back">all →</Link></h2>
          <TasksInner overdue={overdue} upcoming={upcoming.slice(0, 3)} />
        </section>

        <Collapsible title="Momentum" storageKey="today.momentum">
          <MomentumInner weekPct={weekPct} weekHits={weekHits} heat={heat} longest={longest} />
        </Collapsible>
        <Collapsible title="Weekly habits" storageKey="today.weekly">
          <WeeklyGrid habits={habits} heatByName={heatByName} week={week} todayKey={todayKey} />
        </Collapsible>
        <Collapsible title="Today's schedule" storageKey="today.schedule">
          <ScheduleInner past={past} rest={rest} now={now} showPast={showPast} setShowPast={setShowPast} />
        </Collapsible>
      </>
    )
  }

  /* ---------------- desktop: unchanged ---------------- */
  return (
    <>
      {dayHead}
      <NowNext today={today} now={now} blocksDone={blocksDone} blocksTotal={blocksTotal} />

      <section className="panel strip">
        <HealthCluster today={today} now={now} />
        <ProductivityCluster daily={daily} dailyDone={dailyDone} openDaily={openDaily} today={today} weekPct={weekPct} overdue={overdue} />
      </section>

      <div className="columns-2-1">
        {/* LEFT — Do */}
        <div className="stack">
          <section className="card">
            <h2>Today's to-do</h2>
            {addForm}
            <TodoListItems daily={daily} toggleDaily={toggleDaily} removeDaily={removeDaily} />
          </section>

          <section className="card">
            <h2>Quick log · practice <Link to="/habits" className="back">habits →</Link></h2>
            <SkillChips habits={habits} onSkill={(h) => toggleHabit(h.id)} />
            <WeeklyGrid habits={habits} heatByName={heatByName} week={week} todayKey={todayKey} />
          </section>

          <section className="card">
            <h2>Momentum</h2>
            <MomentumInner weekPct={weekPct} weekHits={weekHits} heat={heat} longest={longest} />
          </section>
        </div>

        {/* RIGHT — Plan */}
        <div className="stack">
          <section className="card">
            <h2>Calendar today</h2>
            <CalendarInner schedule={schedule} />
          </section>

          <section className="card">
            <h2>Today's schedule <Link to="/schedule" className="back">full →</Link></h2>
            <ScheduleInner past={past} rest={rest} now={now} showPast={showPast} setShowPast={setShowPast} />
          </section>

          <section className="card">
            <h2>Tasks due soon <Link to="/tasks" className="back">all →</Link></h2>
            <TasksInner overdue={overdue} upcoming={upcoming} />
          </section>
        </div>
      </div>
    </>
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
          : <><div className="nn-act dim">Day complete</div><div className="nn-meta">no more blocks today</div></>}
      </div>
      <div className="nn-cell nn-right">
        <div className="nn-meta"><b style={{ color: 'var(--text)' }}>{blocksDone} of {blocksTotal}</b> blocks done</div>
        <div className="prog"><i style={{ width: `${blocksTotal ? (blocksDone / blocksTotal) * 100 : 0}%` }} /></div>
        {today.tomorrowFirst && <div className="nn-tom">Tomorrow · <b>{fmtMinutes(today.tomorrowFirst.startMinutes)}</b> {today.tomorrowFirst.activity}</div>}
      </div>
    </section>
  )
}

function HTilesRow({ today }: { today: Today }) {
  return (
    <div className="htiles">
      <HTile name="Sleep" main={today.lastSleepScore != null ? `${today.lastSleepScore}` : '—'} sub={`/ ${today.sleepAvg14 ?? 70}`} spark={today.sleepSpark} goal={70} color="#4fb0c6" />
      <HTile name="Resting HR" main={today.restingHr != null ? `${today.restingHr}` : '—'} sub="≈ 55" spark={today.rhrSpark} baseline={55} color="#e0697a" />
      <HTile name="Steps" main={today.stepsToday.toLocaleString()} sub="/ 8k" spark={today.stepsSpark} goal={8000} color="#d8a24f" />
    </div>
  )
}

function EnergyRow({ now }: { now: number }) {
  return (
    <div className="energy-row">
      <div className="er-head"><span>Energy · Body Battery</span><span className="muted">sample · connect Garmin</span></div>
      <EnergyMini now={now} />
    </div>
  )
}

function HealthCluster({ today, now }: { today: Today; now: number }) {
  return (
    <div className="cluster health">
      <div className="cl-label">Health <Link to="/health">full page →</Link></div>
      <div className="health-row">
        <div className="gauge-wrap">
          <Ring value={today.readiness} size={92} color={readyColor(today.readiness)} />
          <div className="gauge-lab"><b>{today.readiness}</b><span>{today.readinessLabel}</span></div>
        </div>
        <HTilesRow today={today} />
      </div>
      <EnergyRow now={now} />
    </div>
  )
}

function ProductivityCluster({ daily, dailyDone, openDaily, today, weekPct, overdue }: {
  daily: DailyTodo[]; dailyDone: number; openDaily: DailyTodo[]; today: Today; weekPct: number; overdue: Todo[]
}) {
  return (
    <div className="cluster">
      <div className="cl-label">Productivity</div>
      <div className="prod-cards">
        <div className="pcard"><div className="pc-name">To-do today</div><div className="pc-val">{dailyDone}/{daily.length}</div><div className="pc-sub muted">{openDaily.length} left</div></div>
        <Link to="/habits" className="pcard"><div className="pc-name">Habits today</div><div className="pc-val">{today.habitsCompletedToday}/{today.habitsTotal}</div><div className="pc-sub muted">{weekPct}% this week</div></Link>
        <Link to="/tasks" className={overdue.length ? 'pcard alert' : 'pcard'}>
          <div className="pc-name" style={overdue.length ? { color: 'var(--bad)' } : undefined}>Tasks overdue</div>
          <div className="pc-val" style={overdue.length ? { color: 'var(--bad)' } : undefined}>{overdue.length}</div>
          <div className="pc-sub muted">of {today.todosDueToday + today.todosOverdue} due</div>
        </Link>
      </div>
    </div>
  )
}

// Mobile compact health: ring + two key numbers, expands to the real charts.
function HealthCompact({ today, now }: { today: Today; now: number }) {
  const [open, toggle] = usePersistentToggle('today.health', false)
  return (
    <section className="card health-compact">
      <button type="button" className="collapse-head" aria-expanded={open} onClick={toggle}>
        <span className="hc-glance">
          <Ring value={today.readiness} size={54} color={readyColor(today.readiness)} />
          <span className="hc-nums">
            <span className="hc-num"><b style={{ color: readyColor(today.readiness) }}>{today.readiness}</b><span>{today.readinessLabel}</span></span>
            <span className="hc-num"><b>{today.lastSleepScore ?? '—'}</b><span>Sleep</span></span>
            <span className="hc-num"><b>{today.restingHr ?? '—'}</b><span>Rest HR</span></span>
          </span>
        </span>
        <span className="collapse-caret" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      <div className="hc-foot"><Link to="/health">Full page →</Link></div>
      {open && <div className="collapse-body"><HTilesRow today={today} /><EnergyRow now={now} /></div>}
    </section>
  )
}

function SkillChips({ habits, onSkill, runningId }: { habits: Habit[]; onSkill: (h: Habit) => void; runningId?: number }) {
  return (
    <div className="skill-grid">
      {habits.map((h, idx) => {
        const color = habitColor(h.name, idx)
        const running = runningId === h.id
        return (
          <button key={h.id} className={`skill-tile${h.doneToday ? ' done' : ''}${running ? ' running' : ''}`} style={{ ['--skill' as string]: color }} onClick={() => onSkill(h)}>
            <span className="skill-name">{h.name}<span className="skill-check">{running ? '●' : h.doneToday ? '✓' : ''}</span></span>
            <span className="skill-meta">{running ? 'timing…' : `${h.last30Completed}/30 days`}</span>
          </button>
        )
      })}
    </div>
  )
}

function WeeklyGrid({ habits, heatByName, week, todayKey }: {
  habits: Habit[]; heatByName: Map<string, Set<string>>; week: Date[]; todayKey: string
}) {
  return (
    <div className="wgrid">
      <div />{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="wg-head">{d}</div>)}
      {habits.map((h, idx) => {
        const done = heatByName.get(h.name) ?? new Set<string>()
        const color = habitColor(h.name, idx)
        return [
          <div key={`${h.id}n`} className="wg-name">{h.name}</div>,
          ...week.map((d) => { const k = keyOf(d); const hit = done.has(k); return <div key={`${h.id}${k}`} className={`wg-dot ${hit ? 'hit' : 'miss'} ${k === todayKey ? 'today' : ''}`} style={hit ? { background: color } : undefined} /> }),
        ]
      })}
    </div>
  )
}

function MomentumInner({ weekPct, weekHits, heat, longest }: {
  weekPct: number; weekHits: number; heat: HabitHeatmap[]; longest?: { name: string; streak: number }
}) {
  return (
    <div className="mom">
      <div><div className="mom-big" style={{ color: 'var(--good)' }}>{weekPct}%</div><div className="mom-lab">This week</div><div className="mom-sub">{weekHits}/{heat.length * 7} sessions</div></div>
      {longest && <div><div className="mom-big">{longest.streak}d</div><div className="mom-lab">Longest streak</div><div className="mom-sub">{longest.name}</div></div>}
    </div>
  )
}

function CalendarInner({ schedule }: { schedule: ScheduleToday }) {
  return (
    <ul className="list">
      {schedule.events.length === 0 && <li className="muted">No events</li>}
      {schedule.events.map((e) => (
        <li key={e.id}><span>{e.title}</span><span className="muted">{fmtMinutes(toMinutes(e.startsAt))}–{fmtMinutes(toMinutes(e.endsAt))}</span></li>
      ))}
    </ul>
  )
}

function NextAppointment({ events, now }: { events: CalendarEvent[]; now: number }) {
  const next = events.filter((e) => toMinutes(e.endsAt) > now).slice(0, 2)
  if (next.length === 0) return null
  return (
    <section className="card">
      <h2>Next appointment</h2>
      <ul className="list">
        {next.map((e) => (
          <li key={e.id}><span>{e.title}</span><span className="muted">{fmtMinutes(toMinutes(e.startsAt))}–{fmtMinutes(toMinutes(e.endsAt))}</span></li>
        ))}
      </ul>
    </section>
  )
}

function ScheduleInner({ past, rest, now, showPast, setShowPast }: {
  past: TimelineRow[]; rest: TimelineRow[]; now: number; showPast: boolean; setShowPast: (v: boolean) => void
}) {
  return (
    <ul className="timeline">
      {past.length > 0 && (
        <li><button className="earlier" onClick={() => setShowPast(!showPast)}>{showPast ? '▾' : '▸'} Earlier today · {past.length} done</button></li>
      )}
      {showPast && past.map((r) => <TLRow key={tlKey(r)} row={r} dim />)}
      <li className="now-line"><span className="now-label">now {fmtMinutes(now)}</span><span className="now-bar" /></li>
      {rest.map((r) => <TLRow key={tlKey(r)} row={r} current={r.kind === 'block' && r.start <= now && now < r.end} />)}
    </ul>
  )
}

function TasksInner({ overdue, upcoming }: { overdue: Todo[]; upcoming: Todo[] }) {
  return (
    <>
      {overdue.length > 0 && <div className="tgroup over">Overdue · {overdue.length}</div>}
      {overdue.map((t) => <div key={t.id} className="task over"><span>{t.title}</span><span className="muted" style={{ color: 'var(--bad)' }}>{t.dueAt && new Date(t.dueAt).toLocaleDateString()}</span></div>)}
      {upcoming.length > 0 && <div className="tgroup">Upcoming</div>}
      {upcoming.map((t) => <div key={t.id} className="task"><span>{t.title}</span><span className="muted">{t.dueAt && new Date(t.dueAt).toLocaleDateString()}</span></div>)}
      {overdue.length === 0 && upcoming.length === 0 && <p className="muted">Nothing due.</p>}
    </>
  )
}

function TodoListItems({ daily, toggleDaily, removeDaily }: {
  daily: DailyTodo[]; toggleDaily: (id: number) => void; removeDaily: (id: number) => void
}) {
  return (
    <ul className="list">
      {daily.length === 0 && <li className="muted">Nothing yet — add your first.</li>}
      {daily.map((d) => (
        <li key={d.id} className="todo daily-row">
          <label className="daily-check">
            <input type="checkbox" checked={d.done} onChange={() => toggleDaily(d.id)} />
            <span className={d.done ? 'done' : ''}>{d.title}</span>
          </label>
          <button className="icon-btn danger" onClick={() => removeDaily(d.id)} title="Remove">✕</button>
        </li>
      ))}
    </ul>
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
          <span className="tl-notes">{fmtMinutes(row.start)}–{fmtMinutes(row.end)} · calendar</span>
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

function EnergyMini({ now }: { now: number }) {
  const w = 680, h = 60, P = { l: 4, r: 4, t: 6, b: 4 }
  const pts = SAMPLE_BB.map((v, i) => ({ t: (i / (SAMPLE_BB.length - 1)) * 1440, v })).filter((p) => p.t <= now)
  if (pts.length < 2) pts.push({ t: now, v: SAMPLE_BB[0] })
  const X = (t: number) => P.l + (t / 1440) * (w - P.l - P.r)
  const Y = (v: number) => P.t + (1 - v / 100) * (h - P.t - P.b)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')
  const area = `M${X(pts[0].t).toFixed(1)},${h - P.b} ${pts.map((p) => `L${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')} L${X(pts[pts.length - 1].t).toFixed(1)},${h - P.b} Z`
  const cur = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', opacity: 0.85 }}>
      <defs><linearGradient id="bbgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#74c79a" stopOpacity=".26" /><stop offset="100%" stopColor="#74c79a" stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill="url(#bbgrad)" />
      <path d={line} fill="none" stroke="#74c79a" strokeWidth="2" strokeLinejoin="round" />
      <line x1={X(cur.t)} x2={X(cur.t)} y1={P.t} y2={h - P.b} stroke="var(--crimson)" strokeWidth="1.2" opacity=".8" />
      <circle cx={X(cur.t)} cy={Y(cur.v)} r="3.6" fill="#fff" stroke="var(--crimson)" strokeWidth="2" />
    </svg>
  )
}
