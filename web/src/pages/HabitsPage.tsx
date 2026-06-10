import { useEffect, useState, type FormEvent } from 'react'
import { api, type Habit, type HabitHeatmap, type Goal, type GoalInput } from '../api'
import { habitColor, fmtHours, fmtElapsed, fmtMonthYear, fmtDaySpan, intensityLevel } from '../lib'
import { useTimer } from '../timer/TimerContext'

const WEEKS = 26
const DAYS = WEEKS * 7
const ALPHA = [0, 0.3, 0.52, 0.76, 1] // intensity level → cell opacity

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** GitHub-style cell grid: columns = weeks, each column 7 weekdays. */
function buildWeeks(): Date[][] {
  const end = new Date(); end.setHours(0, 0, 0, 0)
  const start = new Date(end); start.setDate(end.getDate() - (DAYS - 1))
  start.setDate(start.getDate() - start.getDay()) // back up to Sunday
  const weeks: Date[][] = []
  const cur = new Date(start)
  while (cur <= end) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
    weeks.push(week)
  }
  return weeks
}

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [heat, setHeat] = useState<HabitHeatmap[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState<Record<number, string>>({})
  const [showNew, setShowNew] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showNewSkill, setShowNewSkill] = useState(false)
  const [skillName, setSkillName] = useState('')
  const [skillTimed, setSkillTimed] = useState(true)

  // Running-timer state lives in shared context (also driven by the sticky bar).
  const { timer, elapsedMs, start, stop, dataTick } = useTimer()

  const weeks = buildWeeks()
  const today = keyOf(new Date(new Date().setHours(0, 0, 0, 0)))

  const load = () =>
    Promise.all([api.habits(), api.habitsHeatmap(DAYS), api.goals()])
      .then(([h, hm, g]) => { setHabits(h); setHeat(hm); setGoals(g) })
      .catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])
  // Refetch when a timer is logged (here or from the sticky bar).
  useEffect(() => { if (dataTick) load() }, [dataTick]) // eslint-disable-line react-hooks/exhaustive-deps

  async function quickAdd(id: number, mins: number) { await api.logHabitTime(id, mins); await load() }
  async function addCustom(id: number) {
    const mins = parseInt(custom[id] ?? '', 10)
    if (!mins || mins <= 0) return
    setCustom((c) => ({ ...c, [id]: '' }))
    await api.logHabitTime(id, mins); await load()
  }
  async function toggle(id: number) { await api.toggleHabit(id); await load() }
  async function flipTracksTime(id: number) { await api.toggleHabitTracksTime(id); await load() }
  async function createSkill(e: FormEvent) {
    e.preventDefault()
    if (!skillName.trim()) return
    await api.createHabit(skillName.trim(), skillTimed)
    setSkillName(''); setSkillTimed(true); setShowNewSkill(false); await load()
  }
  async function removeHabit(id: number, name: string) {
    if (!confirm(`Delete "${name}" and all its logs? This can't be undone.`)) return
    await api.deleteHabit(id); await load()
  }

  async function createGoal(input: GoalInput) { await api.createGoal(input); setShowNew(false); await load() }
  async function saveGoal(id: number, input: GoalInput) { await api.updateGoal(id, input); setEditingId(null); await load() }
  async function removeGoal(id: number) {
    if (!confirm('Delete this goal? The skills and their logs are untouched.')) return
    await api.deleteGoal(id); setEditingId(null); await load()
  }

  if (error) return <p className="error">Couldn't load habits ({error}).</p>

  const habitIndex = new Map(habits.map((h, i) => [h.name, i] as const))
  const colorOf = (name: string) => habitColor(name, habitIndex.get(name) ?? 0)
  // habitId → (dateKey → minutes) for the active (completed) days
  const minsById = new Map(heat.map((h) => [h.id, new Map(h.days.map((d) => [d.date, d.minutes] as const))] as const))

  const monthLabels = weeks.map((w, i) => {
    const first = w[0]
    const prev = i > 0 ? weeks[i - 1][0] : null
    return !prev || prev.getMonth() !== first.getMonth()
      ? first.toLocaleDateString(undefined, { month: 'short' })
      : ''
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Habits</h1>
          <p className="subtitle">Goals & daily practice · last {WEEKS} weeks</p>
        </div>
      </div>

      {/* ---- Goals: hour targets fed by one or more skills ---- */}
      <section className="goals-section">
        <div className="section-head">
          <h2 className="section-title">Goals</h2>
          {!showNew && !editingId && (
            <button className="btn btn-ghost" onClick={() => setShowNew(true)}>+ New goal</button>
          )}
        </div>

        {showNew && (
          <GoalForm habits={habits} onSubmit={createGoal} onCancel={() => setShowNew(false)} />
        )}

        <div className="goal-grid">
          {goals.map((g, i) =>
            editingId === g.id ? (
              <GoalForm
                key={g.id}
                habits={habits}
                goal={g}
                onSubmit={(input) => saveGoal(g.id, input)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <GoalCard
                key={g.id}
                goal={g}
                hero={i === 0 && g.targetMinutes >= 30000}
                colorOf={colorOf}
                onEdit={() => { setShowNew(false); setEditingId(g.id) }}
                onDelete={() => removeGoal(g.id)}
              />
            ),
          )}
          {goals.length === 0 && !showNew && (
            <p className="subtitle">No goals yet — create one to roll practice minutes into an hour target.</p>
          )}
        </div>
      </section>

      {/* ---- Skills: heatmap + per-skill controls ---- */}
      <div className="section-head">
        <h2 className="section-title">Skills</h2>
        {!showNewSkill && <button className="btn btn-ghost" onClick={() => setShowNewSkill(true)}>+ New skill</button>}
      </div>
      {showNewSkill && (
        <form className="goal-form card skill-form" onSubmit={createSkill}>
          <div className="gf-row">
            <label className="gf-field gf-grow">
              <span>Skill name</span>
              <input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="e.g. Exercise" autoFocus />
            </label>
            <label className="gf-check skill-timed">
              <input type="checkbox" checked={skillTimed} onChange={(e) => setSkillTimed(e.target.checked)} />
              Track time (log minutes)
            </label>
          </div>
          <div className="gf-actions">
            <button type="submit" className="btn">Add skill</button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowNewSkill(false)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="habit-stack">
        {habits.map((h) => {
          const color = colorOf(h.name)
          const byDate = minsById.get(h.id) ?? new Map<string, number>()
          const running = timer?.habitId === h.id
          const weekMins = Array.from({ length: 7 }).reduce<number>((sum, _, i) => {
            const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
            return sum + (byDate.get(keyOf(d)) ?? 0)
          }, 0)

          return (
            <section className="card habit-card" key={h.id} style={{ ['--habit' as string]: color }}>
              <div className="habit-head">
                <h2 style={{ margin: 0, color }}>
                  {h.name}
                  {h.tracksTime && <span className="badge" style={{ color, borderColor: `${color}66` }}>timed</span>}
                </h2>
                <div className="habit-stats">
                  <span><b className="hl" style={{ color }}>{h.currentStreak}</b> day streak</span>
                  <span>
                    <b className="hl" style={{ color }}>{h.tracksTime ? fmtHours(h.totalMinutes) : h.totalCompletions}</b>
                    {h.tracksTime ? ' total' : ' days'}
                  </span>
                  {h.tracksTime && <span><b className="hl" style={{ color }}>{fmtHours(weekMins)}</b> this week</span>}
                </div>
              </div>

              <div className="habit-body">
                <div className="heat-wrap">
                  <div className="heat-months">
                    {monthLabels.map((m, i) => <span key={i} className="heat-month">{m}</span>)}
                  </div>
                  <div className="heat">
                    {weeks.map((week, wi) => (
                      <div className="heat-week" key={wi}>
                        {week.map((d) => {
                          const k = keyOf(d)
                          const future = k > today
                          const present = byDate.has(k)
                          const mins = byDate.get(k) ?? 0
                          const level = h.tracksTime ? intensityLevel(mins) : (present ? 4 : 0)
                          const label = h.tracksTime
                            ? (present ? `${mins} min` : future ? '' : 'none')
                            : (present ? 'done' : future ? '' : 'missed')
                          return (
                            <span
                              key={k}
                              className={`heat-cell${level > 0 ? ' on' : ''}${future ? ' future' : ''}`}
                              style={level > 0 ? { background: color, opacity: ALPHA[level] } : undefined}
                              title={`${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — ${label}`}
                            />
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="habit-side">
                  {h.tracksTime ? (
                    <div className="time-controls">
                      <div className="today-mins">
                        <span className="tm-val" style={{ color }}>{h.minutesToday}</span> min today
                      </div>
                      <div className="quick-adds">
                        {[15, 30, 45].map((m) => (
                          <button key={m} className="btn btn-ghost btn-sm" onClick={() => quickAdd(h.id, m)}>+{m}</button>
                        ))}
                      </div>
                      <div className="custom-add">
                        <input
                          type="number" min={1} placeholder="min"
                          value={custom[h.id] ?? ''}
                          onChange={(e) => setCustom((c) => ({ ...c, [h.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') addCustom(h.id) }}
                        />
                        <button className="btn btn-sm" onClick={() => addCustom(h.id)}>Add</button>
                      </div>
                      <div className="timer">
                        {running ? (
                          <>
                            <span className="timer-elapsed" style={{ color }}>{fmtElapsed(elapsedMs)}</span>
                            <button className="btn btn-sm" onClick={() => stop()}
                              style={{ color, borderColor: color, background: `${color}1f` }}>Stop & log</button>
                          </>
                        ) : (
                          <button className="btn btn-ghost btn-sm" disabled={!!timer} onClick={() => start(h.id, h.name)}>
                            ▶ Start timer
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      className={h.doneToday ? 'btn' : 'btn btn-ghost'}
                      onClick={() => toggle(h.id)}
                      style={h.doneToday ? { color, borderColor: color, background: `${color}1f`, boxShadow: `0 0 14px ${color}55` } : undefined}
                    >
                      {h.doneToday ? '✓ Logged today' : 'Log today'}
                    </button>
                  )}
                  <div className="skill-foot">
                    <button className="track-toggle" onClick={() => flipTracksTime(h.id)}>
                      {h.tracksTime ? 'Switch to simple' : 'Track time'}
                    </button>
                    <button className="track-toggle danger" onClick={() => removeHabit(h.id, h.name)}>Delete</button>
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

/* ---------- Goal card ---------- */
function GoalCard({ goal, hero, colorOf, onEdit, onDelete }: {
  goal: Goal
  hero: boolean
  colorOf: (name: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const pct = Math.round(goal.progress * 100)
  const accent = goal.colorHex || 'var(--crimson)'

  // ETA line from the projection + state.
  const etaLine =
    goal.state === 'complete' ? 'Complete'
    : goal.state === 'stalled' ? 'Stalled — no recent practice'
    : goal.projectedDate ? `~${fmtMonthYear(goal.projectedDate)} at your 4-week pace`
    : 'No recent pace to project from'

  // Ahead/behind pill (only when a target date is set and goal isn't done).
  // Uses the schedule-relative gap (actual vs straight-line expected progress),
  // which stays bounded — a freshly created goal reads "on pace", not wildly behind.
  const gap = goal.paceGapDays
  const pace = goal.targetDate && goal.state !== 'complete'
    ? gap != null
      ? Math.abs(gap) <= 3
        ? { ahead: true, text: 'on pace' }
        : { ahead: gap < 0, text: `${fmtDaySpan(gap)} ${gap < 0 ? 'ahead' : 'behind'}` }
      : { ahead: goal.paceStatus === 'ahead', text: goal.paceStatus === 'ahead' ? 'on pace' : 'behind' }
    : null

  return (
    <div className={`goal-card${hero ? ' goal-hero' : ''}`} style={{ ['--goal' as string]: accent }}>
      <div className="goal-top">
        <div className="goal-titlewrap">
          <h3 className="goal-name">{goal.name}</h3>
          {pace && <span className={`pace-pill ${pace.ahead ? 'ahead' : 'behind'}`}>{pace.text}</span>}
        </div>
        <div className="goal-actions">
          <button className="icon-btn" title="Edit" onClick={onEdit}>✎</button>
          <button className="icon-btn" title="Delete" onClick={onDelete}>✕</button>
        </div>
      </div>
      <div className="goal-figures">
        <span className="goal-acc">{fmtHours(goal.accumulatedMinutes)}</span>
        <span className="goal-target">/ {fmtHours(goal.targetMinutes)}</span>
        <span className="goal-pct">{pct}%</span>
      </div>
      <div className="goal-bar" title={`${pct}% complete`}>
        {goal.sources.map((s) => (
          <span
            key={s.habitId}
            className="goal-seg"
            style={{ width: `${Math.min(100, (s.minutes / Math.max(1, goal.targetMinutes)) * 100)}%`, background: colorOf(s.name) }}
            title={`${s.name}: ${fmtHours(s.minutes)}`}
          />
        ))}
        {goal.expectedFraction != null && (
          <span className="goal-marker" style={{ left: `${goal.expectedFraction * 100}%` }}
            title={`Where you'd need to be today to hit ${goal.targetDate ? fmtMonthYear(goal.targetDate) : 'target'}`} />
        )}
      </div>
      <div className="goal-meta">
        <span>{fmtHours(goal.remainingMinutes)} to go</span>
        <span className="goal-eta">{etaLine}</span>
        {goal.targetDate && <span className="goal-target-date">target {fmtMonthYear(goal.targetDate)}</span>}
      </div>
      <div className="goal-feeders">
        {goal.sources.map((s) => {
          const c = colorOf(s.name)
          return (
            <span key={s.habitId} className="feeder-chip" style={{ color: c, borderColor: `${c}73`, background: `${c}1f` }}>
              {s.name} · {fmtHours(s.minutes)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- Goal create/edit form ---------- */
function GoalForm({ habits, goal, onSubmit, onCancel }: {
  habits: Habit[]
  goal?: Goal
  onSubmit: (input: GoalInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(goal?.name ?? '')
  const [hours, setHours] = useState(goal ? String(Math.round(goal.targetMinutes / 60)) : '100')
  const [color, setColor] = useState(goal?.colorHex ?? '#b23a5b')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [feeders, setFeeders] = useState<number[]>(goal ? goal.sources.map((s) => s.habitId) : [])

  const toggleFeeder = (id: number) =>
    setFeeders((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const targetHours = parseInt(hours, 10) || 0
    if (!name.trim() || feeders.length === 0 || targetHours <= 0) return
    onSubmit({
      name: name.trim(), targetHours, colorHex: color, sourceHabitIds: feeders,
      targetDate: targetDate || null,
      startDate: goal?.startDate ?? null, // preserve existing start on edit
    })
  }

  return (
    <form className="goal-form card" onSubmit={submit}>
      <div className="gf-row">
        <label className="gf-field gf-grow">
          <span>Goal name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 100h Guitar" autoFocus />
        </label>
        <label className="gf-field gf-narrow">
          <span>Target hours</span>
          <input type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className="gf-field gf-color">
          <span>Color</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="gf-row">
        <label className="gf-field gf-grow">
          <span>Target date (optional)</span>
          <input type="date" value={targetDate ?? ''} onChange={(e) => setTargetDate(e.target.value)} />
        </label>
        {targetDate && <button type="button" className="btn btn-ghost btn-sm gf-clear" onClick={() => setTargetDate('')}>Clear date</button>}
      </div>
      <div className="gf-feeders">
        <span className="gf-label">Feeder skills</span>
        <div className="gf-checks">
          {habits.map((h) => (
            <label key={h.id} className={`gf-check${feeders.includes(h.id) ? ' on' : ''}`}>
              <input type="checkbox" checked={feeders.includes(h.id)} onChange={() => toggleFeeder(h.id)} />
              {h.name}
            </label>
          ))}
        </div>
      </div>
      <div className="gf-actions">
        <button type="submit" className="btn">{goal ? 'Save' : 'Create goal'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
