import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type ReviewListItem,
  type ReviewOutput,
  type ReviewRecommendation,
  type WeeklyDigest,
  type WeeklyReview,
} from '../api'
import { fmtDate } from '../lib'

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
  if (s) return `${s.name}: ${s.minutesThisWeek} min this week (was ${s.minutesLastWeek}) · ${s.daysCompletedThisWeek} days · streak ${s.currentStreak}`
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
  const [error, setError] = useState<string | null>(null)

  async function loadLatest() {
    try {
      const [latest, list] = await Promise.all([api.latestReview(), api.reviews().catch(() => [])])
      setEnabled(latest.enabled)
      setReview(latest.review)
      setHistory(list)
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => { loadLatest() }, [])

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
  const digest = review?.digest ?? null
  const weekLabel = useMemo(() => {
    if (!review) return ''
    const start = review.weekStart
    const end = digest?.weekEnd
    return end ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start)
  }, [review, digest])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekly Review</h1>
          <p className="subtitle">A synthesis of the week — every figure computed here, only the judgement is the model's</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {history.length > 0 && (
            <select className="rv-week" value={review?.weekStart ?? ''} onChange={(e) => pickWeek(e.target.value)}>
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

      {error && <p className="error">{error}</p>}

      {enabled === false && !review && (
        <section className="card">
          <div className="card-h">Reviews are switched off</div>
          <p className="muted" style={{ marginTop: 6 }}>
            Add an Anthropic API key (<code>Anthropic:ApiKey</code> in user-secrets, or the
            <code> ANTHROPIC_API_KEY</code> environment variable) to enable weekly synthesis.
            Your computed digest never leaves the app until a key is set.
          </p>
        </section>
      )}

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
                  .map((r, i) => <Rec key={i} rec={r} digest={digest} />)}
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

function Rec({ rec, digest }: { rec: ReviewRecommendation; digest: WeeklyDigest | null }) {
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
      </div>
    </section>
  )
}
