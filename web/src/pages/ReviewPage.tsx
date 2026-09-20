import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type ReviewListItem,
  type ReviewOutput,
  type ReviewRecommendation,
  type WeeklyDigest,
  type WeeklyReview,
  type Todo,
} from '../api'
import { fmtDate } from '../lib'
import { Link } from 'react-router-dom'
import { dailyPlanning, dateKey, recommendationTag } from '../dailyPlanning'
import '../dailyPlanning.css'

// Priority → display treatment. Only "high" is loud (crimson); the rest stay quiet
// so the eye lands on what matters most, like the rest of the dashboard.
const PRIORITY: Record<string, { color: string; label: string }> = {
  high: { color: 'var(--crimson)', label: 'High' },
  medium: { color: 'var(--watch)', label: 'Medium' },
  low: { color: 'var(--text-dim)', label: 'Low' },
}

// Resolve a digest fact id back to a short, human, *number-bearing* line, so every
// claim the model makes is traceable to a figure the app computed (not the model).
function factLabel(digest: WeeklyDigest | null, id: string): string | null {
  if (!digest) return null
  const g = digest.goals.find((x) => x.id === id)
  if (g) return `${g.name}: ${g.minutesThisWeek} min this week (was ${g.minutesLastWeek}) · ${g.accumulatedHours}/${g.targetHours}h · ${g.paceStatus}`
  const s = digest.skills.find((x) => x.id === id)
  if (s) return `${s.name}: ${s.minutesThisWeek} min this week (was ${s.minutesLastWeek}) · ${s.daysCompletedThisWeek} days · streak ${s.currentStreak} ${s.cadence === 'weekly' ? 'weeks' : 'days'}`
  const m = digest.health.find((x) => x.id === id)
  if (m) return `${m.label}: ${m.avgThisWeek ?? '—'}${m.unit} avg${m.delta != null ? ` (${m.delta > 0 ? '+' : ''}${m.delta} vs last week)` : ''}`
  const a = digest.alerts.find((x) => x.id === id)
  if (a) return `${a.title} — ${a.detail}`
  if (id === digest.nutrition.id) {
    const n = digest.nutrition
    return `Nutrition: ${n.avgCalories ?? '—'} kcal / ${n.avgProtein ?? '—'}g protein avg · ${n.daysLogged} days logged`
  }
  if (id === digest.tasks.id) return `Tasks: ${digest.tasks.completedThisWeek} completed, ${digest.tasks.overdue} overdue`
  return null
}

function isOutput(o: WeeklyReview['output']): o is ReviewOutput {
  return !!o && !('error' in (o as object))
}
function errorOf(o: WeeklyReview['output']): string | null {
  return o && 'error' in (o as object) ? (o as { error: string }).error : null
}

export default function ReviewPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [history, setHistory] = useState<ReviewListItem[]>([])
  const [busy, setBusy] = useState(false)
  const [currentDigest, setCurrentDigest] = useState<WeeklyDigest | null>(null)
  const [tasks, setTasks] = useState<Todo[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadLatest = useCallback(() => Promise.all([api.latestReview(), api.reviews(), dailyPlanning.digest(), api.todos()])
    .then(([latest, list, summary, commitments]) => {
      setEnabled(latest.enabled); setReview(latest.review); setHistory(list); setCurrentDigest(summary); setTasks(commitments); setError(null)
    }).catch(e => setError(String(e))), [])
  useEffect(() => { loadLatest() }, [loadLatest])

  async function generate() {
    setBusy(true); setError(null)
    try {
      const r = await api.generateReview()
      setReview(r)
      setHistory(await api.reviews().catch(() => history))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function pickWeek(week: string) {
    if (!week || week === review?.weekStart) return
    setError(null)
    try { setReview(await api.review(week)) } catch (e) { setError(String(e)) }
  }

  const out = review && isOutput(review.output) ? review.output : null
  const failure = review ? errorOf(review.output) : null
  const digest = review?.digest ?? currentDigest
  const weekLabel = useMemo(() => {
    if (!digest) return ''
    const start = review?.weekStart ?? digest.weekStart
    const end = digest?.weekEnd
    return end ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start)
  }, [review, digest])

  async function actOnRecommendation(rec: ReviewRecommendation, planForToday: boolean) {
    if (!review || actionBusy) return
    const tag = recommendationTag(review.weekStart, rec)
    const existing = tasks.find(task => task.notes?.includes(tag))
    if (existing?.completedAt || (existing && !planForToday)) return
    setActionBusy(true); setError(null); setNotice(null)
    try {
      const task = existing ?? await api.createTodo({ title: rec.text, priority: rec.priority === 'high' ? 1 : rec.priority === 'low' ? 3 : 2,
        notes: `${tag}\nFrom weekly review, week of ${review.weekStart}.\n${(rec.relatedFactIds ?? []).map(id => factLabel(review.digest, id)).filter(Boolean).join('\n')}` })
      // Keep the saved task in local state even if planning fails, so retrying
      // cannot create a duplicate commitment.
      if (!existing) setTasks(previous => [...previous, task])
      if (planForToday) {
        const planned = await dailyPlanning.plan(task.id, dateKey())
        setTasks(previous => previous.map(item => item.id === task.id ? planned : item))
      }
      setNotice(planForToday ? 'Accepted and added to today’s plan.' : 'Task created. It will appear in next week’s follow-through.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setActionBusy(false) }
  }
  async function completeCommitment(task: Todo) {
    if (actionBusy) return
    setActionBusy(true); setError(null)
    try { const updated = await api.toggleTodo(task.id); setTasks(previous => previous.map(item => item.id === task.id ? updated : item)); setNotice(updated.completedAt ? 'Commitment completed.' : 'Commitment reopened.') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setActionBusy(false) }
  }
  const commitments = tasks.filter(task => task.notes?.includes('[weekly-review:'))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekly Review</h1>
          <p className="subtitle">See your progress, choose your next steps and follow through</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {history.length > 0 && (
            <select aria-label="Review week" className="rv-week" value={review?.weekStart ?? ''} onChange={(e) => pickWeek(e.target.value)}>
              {history.map((h) => (
                <option key={h.weekStart} value={h.weekStart}>
                  Week of {fmtDate(h.weekStart)}{h.status === 'Failed' ? ' · failed' : ''}
                </option>
              ))}
            </select>
          )}
          {enabled && <button className="btn" onClick={generate} disabled={busy}>{busy ? 'Synthesising…' : "Generate this week's review"}</button>}
        </div>
      </div>

      {error && <div className="planning-feedback error" role="alert"><span>{error}</span><button className="btn" onClick={loadLatest}>Retry</button></div>}
      {notice && <p className="planning-feedback" role="status">{notice}</p>}
      {enabled === null && !error && <p className="muted" role="status">Loading your week…</p>}
      {(currentDigest ?? digest) && <DigestSummary digest={(currentDigest ?? digest)!} />}
      {commitments.length > 0 && <section className="card review-follow-up">
        <h2>Follow-through <Link to="/tasks" className="back">all tasks →</Link></h2>
        <p className="planning-note">Actions you accepted from your reviews. Open commitments stay visible across weeks.</p>
        {commitments.filter(task => !task.completedAt || (digest && task.completedAt.slice(0, 10) >= digest.weekStart)).map(task => <div className="planning-item" key={task.id}>
          <div className="planning-copy">{task.title}<small>{task.completedAt ? 'Completed' : task.plannedFor ? `Planned for ${task.plannedFor}` : 'Ready to plan'} · {task.notes?.match(/week of (\d{4}-\d{2}-\d{2})/)?.[0] ?? 'Weekly review'}</small></div>
          <button className="btn btn-sm" disabled={actionBusy} onClick={() => completeCommitment(task)}>{task.completedAt ? 'Reopen' : 'Complete'}</button>
        </div>)}
      </section>}

      {enabled === false && <p className="planning-note">Your weekly summary is available here. Written recommendations are available when AI reviews are enabled.</p>}

      {enabled && !review && (
        <section className="card">
          <div className="card-h">No review yet</div>
          <p className="muted" style={{ marginTop: 6 }}>Generate this week's review to see wins, misses and prioritised recommendations — each one tied to a real number from your week.</p>
        </section>
      )}

      {failure && (
        <section className="card rv-failed">
          <div className="card-h">This review couldn't be generated</div>
          <p style={{ marginTop: 6 }}>{failure}</p>
          {enabled && <p className="muted">Try generating again — your data is unchanged.</p>}
        </section>
      )}

      {out && (
        <>
          {out.narrative && (
            <section className="card rv-narrative">
              <p>{out.narrative}</p>
              <div className="rv-meta muted">Week of {weekLabel} · {review!.model} · generated {fmtDate(review!.createdAt)}</div>
            </section>
          )}

          <div className="rv-cols">
            <FactSection title="Wins" mark="▲" markColor="var(--good)" facts={out.wins} digest={digest} empty="No standout wins flagged this week." />
            <FactSection title="Watch-outs" mark="▼" markColor="var(--bad)" facts={out.misses} digest={digest} empty="Nothing slipped enough to flag." />
          </div>

          {out.recommendations && out.recommendations.length > 0 && (
            <>
              <div className="sec-label">Recommendations</div>
              <div className="rv-recs">
                {[...out.recommendations]
                  .sort((a, b) => rank(a) - rank(b))
                  .map((r) => {
                    const tag = recommendationTag(review!.weekStart, r)
                    const task = tasks.find(item => item.notes?.includes(tag))
                    return <Rec key={tag} rec={r} digest={digest} task={task} busy={actionBusy} onCreate={() => actOnRecommendation(r, false)} onAccept={() => actOnRecommendation(r, true)} />
                  })}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

const rank = (r: ReviewRecommendation) => (r.priority === 'high' ? 0 : r.priority === 'medium' ? 1 : 2)

function FactSection({ title, mark, markColor, facts, digest, empty }: {
  title: string; mark: string; markColor: string
  facts: { factId: string; text: string }[] | null; digest: WeeklyDigest | null; empty: string
}) {
  return (
    <section className="card">
      <div className="card-h">{title}</div>
      {facts && facts.length > 0 ? (
        <ul className="rv-facts">
          {facts.map((f, i) => {
            const src = factLabel(digest, f.factId)
            return (
              <li key={i}>
                <span className="rv-mark" style={{ color: markColor }}>{mark}</span>
                <div>
                  <div>{f.text}</div>
                  {src && <div className="rv-source muted">{src}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      ) : <p className="muted" style={{ marginTop: 6 }}>{empty}</p>}
    </section>
  )
}

function Rec({ rec, digest, task, busy, onCreate, onAccept }: { rec: ReviewRecommendation; digest: WeeklyDigest | null; task?: Todo; busy: boolean; onCreate: () => void; onAccept: () => void }) {
  const p = PRIORITY[rec.priority ?? 'low'] ?? PRIORITY.low
  const sources = (rec.relatedFactIds ?? []).map((id) => factLabel(digest, id)).filter(Boolean) as string[]
  return (
    <section className="card rv-rec">
      <span className="rv-prio" style={{ color: p.color, borderColor: p.color }}>{p.label}</span>
      <div>
        <div className="rv-rec-text">{rec.text}</div>
        {sources.length > 0 && (
          <ul className="rv-rec-sources">
            {sources.map((s, i) => <li key={i} className="muted">{s}</li>)}
          </ul>
        )}
        <div className="planning-actions">
          {task ? <><Link to="/tasks">{task.completedAt ? '✓ Completed' : '✓ Saved to Tasks'} →</Link>{!task.completedAt && task.plannedFor !== dateKey() && <button className="btn btn-sm" disabled={busy} onClick={onAccept}>Do today</button>}</> : <>
            <button className="btn btn-sm" disabled={busy} onClick={onCreate}>Create task</button>
            <button className="btn btn-sm" disabled={busy} onClick={onAccept}>Accept for today</button>
          </>}
        </div>
      </div>
    </section>
  )
}

function DigestSummary({ digest }: { digest: WeeklyDigest }) {
  const practiceMinutes = digest.skills.reduce((sum, skill) => sum + skill.minutesThisWeek, 0)
  const previousMinutes = digest.skills.reduce((sum, skill) => sum + skill.minutesLastWeek, 0)
  return <section className="card">
    <h2>Your week · {fmtDate(digest.weekStart)} – {fmtDate(digest.weekEnd)}</h2>
    <div className="digest-stats">
      <div><strong>{practiceMinutes} min</strong><span>Practice · {previousMinutes} min last week</span></div>
      <div><strong>{digest.tasks.completedThisWeek}</strong><span>Tasks completed · {digest.tasks.overdue} overdue</span></div>
      <div><strong>{digest.nutrition.daysLogged} days</strong><span>Nutrition logged</span></div>
    </div>
    {digest.skills.length > 0 && <ul className="list">{digest.skills.map(skill => <li key={skill.id}><span>{skill.name}</span><span className="muted">{skill.minutesThisWeek} min · {skill.daysCompletedThisWeek} days</span></li>)}</ul>}
    {digest.goals.length > 0 && <ul className="list">{digest.goals.map(goal => <li key={goal.id}><span>{goal.name}</span><span className="muted">{goal.accumulatedHours}/{goal.targetHours}h · {goal.paceStatus}</span></li>)}</ul>}
    <p className="planning-note">Based on your logged data. Missing entries are not treated as measured activity.</p>
  </section>
}
