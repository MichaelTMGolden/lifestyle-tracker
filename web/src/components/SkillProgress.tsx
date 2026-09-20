import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type Habit } from '../api'
import { skillProgressApi, type SkillAssessment, type SkillBenchmark } from '../skillProgressApi'
import { fmtDate } from '../lib'

const today = () => new Date().toLocaleDateString('en-CA')
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
function atDate(benchmark: SkillBenchmark, date: string): SkillAssessment | undefined {
  return benchmark.assessments.filter(a => a.assessedOn <= date).sort((a, b) => b.assessedOn.localeCompare(a.assessedOn))[0]
}

export function SkillProgress() {
  const [benchmarks, setBenchmarks] = useState<SkillBenchmark[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [newBenchmark, setNewBenchmark] = useState(false)
  const [habitId, setHabitId] = useState('')
  const [name, setName] = useState('')
  const [rubric, setRubric] = useState('')
  const [benchmarkId, setBenchmarkId] = useState('')
  const [date, setDate] = useState(today)
  const [score, setScore] = useState('')
  const [evidence, setEvidence] = useState('')
  const [notes, setNotes] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')
  const [snapshot, setSnapshot] = useState('')
  const [comparison, setComparison] = useState('')

  function load() {
    return Promise.all([skillProgressApi.benchmarks(), api.habits()]).then(([data, skills]) => {
      setBenchmarks(data); setHabits(skills); setError('')
    }).catch(e => { setError(message(e)) }).finally(() => setLoading(false))
  }
  useEffect(() => { void load() }, [])

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setStatus('')
    try { await action(); await load(); setStatus(success) }
    catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  function addBenchmark(e: FormEvent) {
    e.preventDefault()
    void perform(async () => {
      const created = await skillProgressApi.create({ habitId: Number(habitId), name: name.trim(), rubric: rubric.trim() })
      setBenchmarkId(String(created.id)); setName(''); setRubric(''); setNewBenchmark(false)
    }, 'Benchmark saved. Add your first assessment when you have evidence.')
  }
  function assess(e: FormEvent) {
    e.preventDefault()
    void perform(async () => {
      await skillProgressApi.assess(Number(benchmarkId), { assessedOn: date, score: Number(score), evidenceUrl: evidence.trim() || null, notes: notes.trim() || null })
      setScore(''); setEvidence(''); setNotes('')
    }, 'Assessment saved.')
  }
  function edit(benchmark: SkillBenchmark, assessment: SkillAssessment) {
    setBenchmarkId(String(benchmark.id)); setDate(assessment.assessedOn); setScore(String(assessment.score))
    setEvidence(assessment.evidenceUrl ?? ''); setNotes(assessment.notes ?? '')
    document.getElementById('assessment-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    document.getElementById('assessment-score')?.focus({ preventScroll: true })
  }

  const active = benchmarks.filter(b => !b.archived)
  const selected = active.find(b => b.id === Number(benchmarkId))
  const displayed = active.filter(b => !filter || b.habitId === Number(filter))
  const dates = [...new Set(displayed.flatMap(b => b.assessments.map(a => a.assessedOn)))].sort().reverse()
  const currentDate = dates.includes(snapshot) ? snapshot : dates[0] ?? ''
  const previousDate = dates.includes(comparison) ? comparison : dates.find(d => d < currentDate) ?? ''
  const visibleBenchmarks = benchmarks.filter(b => (showArchived || !b.archived) && (!filter || b.habitId === Number(filter)))
  const correcting = selected?.assessments.some(a => a.assessedOn === date)

  return <section className="skill-progress" aria-labelledby="skill-progress-title">
    <div className="section-head"><div><h2 id="skill-progress-title">Skill progress</h2><p className="subtitle">Check your ability against your own benchmarks, with evidence behind every score.</p></div>
      <button className="btn btn-ghost" onClick={() => setNewBenchmark(v => !v)} aria-expanded={newBenchmark}>{newBenchmark ? 'Close benchmark form' : '+ New benchmark'}</button></div>
    {error && <div className="error" role="alert">{error} <button className="btn btn-ghost" onClick={() => void load()} disabled={loading}>Retry</button></div>}
    <p className="ux-status" role="status">{loading ? 'Loading skill progress…' : status}</p>
    {!loading && habits.length === 0 && <p className="card">Start by <Link to="/habits">adding a skill in Habits</Link>, then define what improvement looks like.</p>}
    {newBenchmark && <form className="card progress-form" onSubmit={addBenchmark}>
      <h3>Define a benchmark</h3>
      <div className="ux-form-grid">
        <label>Skill<select value={habitId} onChange={e => setHabitId(e.target.value)} required><option value="">Choose a skill</option>{habits.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label>Benchmark<input value={name} onChange={e => setName(e.target.value)} maxLength={120} required placeholder="e.g. Clean chord changes at a steady tempo" /></label>
      </div>
      <label>Scoring rubric (0–10)<textarea value={rubric} onChange={e => setRubric(e.target.value)} maxLength={3000} required rows={3} placeholder="Describe the same exercise and what scores such as 0, 5 and 10 mean for you." /></label>
      <p className="muted">Use the same exercise and scoring rules each time. To change the rubric later, archive this benchmark and create a new one so its history stays comparable.</p>
      <button className="btn" disabled={busy || !habits.length}>Save benchmark</button>
    </form>}
    {!loading && !active.length && <p className="card muted">No active benchmarks yet. Define one to record a baseline. Your scores will appear here after you save an assessment.</p>}
    {active.length > 0 && <>
      <form id="assessment-form" className="card progress-form" onSubmit={assess}>
        <h3>Record an assessment</h3>
        <div className="ux-form-grid">
          <label>Benchmark<select value={benchmarkId} onChange={e => { setBenchmarkId(e.target.value); setScore(''); setEvidence(''); setNotes('') }} required><option value="">Choose a benchmark</option>{active.map(b => <option key={b.id} value={b.id}>{b.habitName} · {b.name}</option>)}</select></label>
          <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} max={today()} required /></label>
          <label>Score out of 10<input id="assessment-score" type="number" min={0} max={10} step={0.1} value={score} onChange={e => setScore(e.target.value)} required /></label>
        </div>
        {selected && <p className="rubric"><strong>Rubric:</strong> {selected.rubric}</p>}
        <label>Recording or evidence link (optional)<input type="url" value={evidence} onChange={e => setEvidence(e.target.value)} maxLength={2000} placeholder="https://…" /></label>
        <label>Evidence notes<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={5000} required={!evidence.trim()} placeholder="What did you perform? What improved, and what still needs work?" /></label>
        <p className="muted">Include a link or notes supporting the score.{correcting && ' There is already an assessment on this date. Saving replaces it.'}</p>
        <button className="btn" disabled={busy || !selected}>{busy ? 'Saving…' : correcting ? 'Update assessment' : 'Save assessment'}</button>
      </form>
      <div className="card progress-comparison">
        <div className="section-head"><h3>Progress over time</h3><label className="ux-filter">Skill<select value={filter} onChange={e => { setFilter(e.target.value); setSnapshot(''); setComparison('') }}><option value="">All skills</option>{habits.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label></div>
        {dates.length > 0 ? <>
          <div className="ux-form-grid">
            <label>Snapshot as of<select value={currentDate} onChange={e => setSnapshot(e.target.value)}>{dates.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}</select></label>
            <label>Compare with<select value={previousDate} onChange={e => setComparison(e.target.value)}>{!previousDate && <option value="">No earlier assessment</option>}{dates.map(d => <option key={d} value={d}>{fmtDate(d)}</option>)}</select></label>
          </div>
          <p className="muted">Each snapshot uses the most recent assessment on or before its date. These are self-assessments against your rubric. Missing scores stay blank.</p>
          <SkillRadar benchmarks={displayed} currentDate={currentDate} previousDate={previousDate} />
          <div className="ux-table-scroll"><table className="progress-table"><caption>Benchmark scores and evidence</caption><thead><tr><th scope="col">Benchmark</th><th scope="col">Snapshot</th><th scope="col">Comparison</th><th scope="col">Change</th></tr></thead><tbody>
            {displayed.map((b, i) => {
              const current = atDate(b, currentDate), previous = previousDate ? atDate(b, previousDate) : undefined
              const change = current && previous ? Math.round((current.score - previous.score) * 10) / 10 : null
              return <tr key={b.id}><th scope="row">{i + 1}. {b.name}<span className="muted">{b.habitName}</span></th><td><Evidence assessment={current} /></td><td><Evidence assessment={previous} /></td><td>{change == null ? '—' : `${change > 0 ? '+' : ''}${change}`}</td></tr>
            })}
          </tbody></table></div>
        </> : <p className="muted">Save an assessment to start seeing progress. Three assessed benchmarks form a spider graph; one or two appear in the table.</p>}
      </div>
    </>}
    {benchmarks.length > 0 && <details className="card progress-history"><summary>Benchmarks & assessment history</summary>
      <label className="ux-checkbox"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Include archived benchmarks</label>
      {visibleBenchmarks.map(b => <article key={b.id} className="benchmark-history"><div className="section-head"><h3>{b.habitName} · {b.name}{b.archived ? ' (archived)' : ''}</h3>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void perform(() => skillProgressApi.archive(b.id, !b.archived), b.archived ? 'Benchmark restored.' : 'Benchmark archived; history kept.')}>{b.archived ? 'Restore' : 'Archive'}</button></div>
        <p className="rubric">{b.rubric}</p>
        {!b.assessments.length && <p className="muted">No assessments yet.</p>}
        {b.assessments.map(a => <div key={a.id} className="assessment-history-row"><div><strong>{fmtDate(a.assessedOn)} · {a.score}/10</strong>{a.evidenceUrl && <p><a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer">Open evidence ↗</a></p>}{a.notes && <p className="evidence-notes">{a.notes}</p>}</div>
          <div className="ux-actions">{!b.archived && <button className="btn btn-ghost" onClick={() => edit(b, a)}>Edit</button>}<button className="btn btn-ghost" disabled={busy} onClick={() => { if (confirm(`Delete the ${a.assessedOn} assessment for ${b.name}?`)) void perform(() => skillProgressApi.removeAssessment(a.id), 'Assessment deleted.') }}>Delete</button></div>
        </div>)}
      </article>)}
    </details>}
  </section>
}

function Evidence({ assessment }: { assessment?: SkillAssessment }) {
  if (!assessment) return <span className="muted">Not assessed</span>
  return <><strong>{assessment.score}/10</strong><span className="muted">{fmtDate(assessment.assessedOn)}</span>{assessment.evidenceUrl && <a href={assessment.evidenceUrl} target="_blank" rel="noopener noreferrer">Evidence ↗</a>}{assessment.notes && <details><summary>Notes</summary><p className="evidence-notes">{assessment.notes}</p></details>}</>
}

function SkillRadar({ benchmarks, currentDate, previousDate }: { benchmarks: SkillBenchmark[]; currentDate: string; previousDate: string }) {
  const count = benchmarks.length
  if (count < 3 || count > 12) return <p className="muted">The spider graph needs 3–12 benchmarks. Use the table below{count > 12 ? ', or filter to one skill' : ''}.</p>
  const point = (i: number, score: number) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    return [160 + Math.cos(angle) * score * 11, 150 + Math.sin(angle) * score * 11]
  }
  const series = [
    { date: currentDate, color: 'var(--crimson)', dashed: false, title: 'Snapshot' },
    ...(previousDate && previousDate !== currentDate ? [{ date: previousDate, color: 'var(--good)', dashed: true, title: 'Comparison' }] : []),
  ]
  return <figure className="skill-radar">
    <svg viewBox="0 0 320 310" role="img" aria-label="Spider graph of saved benchmark scores, numbered to match the table. Score range 0 to 10.">
      {[2, 4, 6, 8, 10].map(level => <polygon key={level} points={benchmarks.map((_, i) => point(i, level).join(',')).join(' ')} fill="none" stroke="var(--line-strong)" />)}
      {benchmarks.map((b, i) => { const [x, y] = point(i, 10), [lx, ly] = point(i, 12); return <g key={b.id}><line x1={160} y1={150} x2={x} y2={y} stroke="var(--line-strong)" /><text x={lx} y={ly + 5} textAnchor="middle" fill="var(--text)">{i + 1}</text></g> })}
      {series.map(s => { const scores = benchmarks.map(b => atDate(b, s.date)?.score); return <g key={s.title}>
        {scores.every(v => v != null) && <polygon points={scores.map((v, i) => point(i, v!).join(',')).join(' ')} fill={s.color} fillOpacity={0.1} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />}
        {scores.map((v, i) => { if (v == null) return null; const [cx, cy] = point(i, v); return <circle key={i} cx={cx} cy={cy} r={4} fill={s.color}><title>{benchmarks[i].name}: {v}/10 ({s.title})</title></circle> })}
      </g> })}
    </svg>
    <figcaption>{series.map(s => <span key={s.title} style={{ color: s.color }}>{s.dashed ? '┄' : '━'} {s.title}: {fmtDate(s.date)}</span>)}<span className="muted">0 at centre · 10 at edge. Shapes connect only complete snapshots.</span></figcaption>
  </figure>
}
