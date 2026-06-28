import { useEffect, useState, type FormEvent } from 'react'
import { api, type Challenge, type ChallengeInput } from '../api'
import { dayRange, fmtCount, fmtDate } from '../lib'

// Celebrate a challenge's completion only once (like goals), not on every load.
const CELEB_KEY = 'pd:challenges-celebrated'
const loadCelebrated = (): number[] => { try { return JSON.parse(localStorage.getItem(CELEB_KEY) || '[]') } catch { return [] } }
const markCelebrated = (id: number) => {
  const s = new Set(loadCelebrated()); s.add(id)
  localStorage.setItem(CELEB_KEY, JSON.stringify([...s]))
}

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const pct = (p: number) => Math.round(Math.min(1, p) * 100)

export function ChallengesSection() {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [celebrating, setCelebrating] = useState<Challenge | null>(null)

  const load = () => api.challenges().then(setChallenges).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  // Fire the celebration once when a challenge first reads complete.
  useEffect(() => {
    if (celebrating) return
    const done = loadCelebrated()
    const fresh = challenges.find((c) => c.isComplete && !done.includes(c.id))
    if (fresh) setCelebrating(fresh)
  }, [challenges, celebrating])
  const dismissCelebration = () => { if (celebrating) markCelebrated(celebrating.id); setCelebrating(null) }

  // Mutations return the recomputed challenge — splice it back in (optimistic-ish).
  const replace = (c: Challenge) => setChallenges((cs) => cs.map((x) => (x.id === c.id ? c : x)))

  async function create(input: ChallengeInput) { const c = await api.createChallenge(input); setChallenges((cs) => [c, ...cs]); setShowNew(false) }
  async function remove(id: number, name: string) {
    if (!confirm(`Delete the challenge "${name}" and all its entries?`)) return
    await api.deleteChallenge(id); setChallenges((cs) => cs.filter((c) => c.id !== id))
  }
  async function toggleDay(id: number, date: string) { replace(await api.toggleChallengeDay(id, date)) }
  async function increment(id: number, body: { amount?: number; label?: string }) { replace(await api.incrementChallenge(id, body)) }
  async function removeEntry(entryId: number) { replace(await api.deleteChallengeEntry(entryId)) }

  if (error) return <p className="error">Couldn't load challenges ({error}).</p>

  const active = challenges.filter((c) => !c.archived)

  return (
    <section className="challenges-section">
      <div className="section-head">
        <h2 className="section-title">Challenges</h2>
        {!showNew && <button className="btn btn-ghost" onClick={() => setShowNew(true)}>+ New challenge</button>}
      </div>

      {showNew && <NewChallengeForm onSubmit={create} onCancel={() => setShowNew(false)} />}

      <div className="challenge-grid">
        {active.map((c) =>
          c.mode === 'Daily'
            ? <DailyChallengeCard key={c.id} c={c} onToggleDay={toggleDay} onDelete={remove} />
            : <QuantityChallengeCard key={c.id} c={c} onIncrement={increment} onRemoveEntry={removeEntry} onDelete={remove} />,
        )}
        {active.length === 0 && !showNew && (
          <p className="subtitle">No challenges yet — start a daily chain or a quantity count.</p>
        )}
      </div>

      {celebrating && <ChallengeCelebration challenge={celebrating} onDone={dismissCelebration} />}
    </section>
  )
}

/* ---------- Daily challenge: a tappable day chain ---------- */
function DailyChallengeCard({ c, onToggleDay, onDelete }: {
  c: Challenge; onToggleDay: (id: number, date: string) => void; onDelete: (id: number, name: string) => void
}) {
  const accent = c.colorHex || 'var(--crimson)'
  const done = new Set(c.entries.map((e) => e.date))
  const days = dayRange(c.startDate)
  const tk = todayKey()

  return (
    <div className={`card challenge-card${c.isComplete ? ' challenge-done' : ''}`} style={{ ['--ch' as string]: accent }}>
      <div className="ch-top">
        <div className="ch-titlewrap">
          <h3 className="ch-name">{c.name}</h3>
          <span className={`ch-pill ${c.strict ? 'strict' : 'forgiving'}`}>{c.strict ? 'Strict chain' : 'Forgiving'}</span>
          {c.isComplete && <span className="ch-pill done">✓ Complete</span>}
        </div>
        <button className="icon-btn danger" title="Delete" onClick={() => onDelete(c.id, c.name)}>✕</button>
      </div>

      <div className="ch-figures">
        <span className="ch-big" style={{ color: accent }}>{c.strict ? c.currentStreak : c.daysDone}</span>
        <span className="ch-unit">{c.strict ? 'day streak' : `/ ${c.target} days`}</span>
        <span className="ch-pct">{pct(c.progress)}%</span>
      </div>

      <div className="ch-bar" title={`${pct(c.progress)}%`}>
        <span className="ch-seg" style={{ width: `${pct(c.progress)}%`, background: accent }} />
      </div>

      <div className="ch-meta">
        {c.strict
          ? <span>{c.currentStreak} / {c.target} consecutive · {c.daysDone} days total</span>
          : <span>{c.daysDone} / {c.target} days · {c.currentStreak} day streak</span>}
      </div>

      <div className="ch-grid" role="group" aria-label="Day chain — tap to fill or clear">
        {days.map((d) => {
          const on = done.has(d)
          const isToday = d === tk
          return (
            <button
              key={d}
              className={`ch-cell${on ? ' on' : ''}${isToday ? ' today' : ''}`}
              style={on ? { background: accent } : undefined}
              title={`${fmtDate(d)}${on ? ' — done' : ' — tap to fill'}`}
              aria-label={`${fmtDate(d)} ${on ? 'done' : 'not done'}`}
              onClick={() => onToggleDay(c.id, d)}
            />
          )
        })}
      </div>
      <div className="ch-hint muted">Tap any day to fill or clear it — back-filling a gap repairs the chain.</div>
    </div>
  )
}

/* ---------- Quantity challenge: a counter toward a target ---------- */
function QuantityChallengeCard({ c, onIncrement, onRemoveEntry, onDelete }: {
  c: Challenge
  onIncrement: (id: number, body: { amount?: number; label?: string }) => void
  onRemoveEntry: (entryId: number) => void
  onDelete: (id: number, name: string) => void
}) {
  const accent = c.colorHex || 'var(--crimson)'
  const unit = c.unit || 'done'
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')

  function addCustom(e: FormEvent) {
    e.preventDefault()
    const a = parseFloat(amount)
    onIncrement(c.id, { amount: isNaN(a) || a <= 0 ? 1 : a, label: label.trim() || undefined })
    setLabel(''); setAmount('')
  }

  const recent = [...c.entries].reverse() // newest first

  return (
    <div className={`card challenge-card${c.isComplete ? ' challenge-done' : ''}`} style={{ ['--ch' as string]: accent }}>
      <div className="ch-top">
        <div className="ch-titlewrap">
          <h3 className="ch-name">{c.name}</h3>
          <span className="ch-pill quantity">{unit}</span>
          {c.isComplete && <span className="ch-pill done">✓ Complete</span>}
        </div>
        <button className="icon-btn danger" title="Delete" onClick={() => onDelete(c.id, c.name)}>✕</button>
      </div>

      <div className="ch-figures">
        <span className="ch-big" style={{ color: accent }}>{fmtCount(c.total)}</span>
        <span className="ch-unit">/ {fmtCount(c.target)} {unit}</span>
        <span className="ch-pct">{pct(c.progress)}%</span>
      </div>

      <div className="ch-bar" title={`${pct(c.progress)}%`}>
        <span className="ch-seg" style={{ width: `${pct(c.progress)}%`, background: accent }} />
      </div>

      <div className="ch-add">
        <button className="btn" onClick={() => onIncrement(c.id, { amount: 1 })}>+1</button>
        <form className="ch-add-form" onSubmit={addCustom}>
          <input className="ch-label" placeholder={`Label (e.g. ${unit === 'songs' ? 'song title' : unit})`} value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="ch-amt" type="number" min="0" step="any" placeholder="amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn btn-ghost btn-sm" type="submit">Add</button>
        </form>
      </div>

      {recent.length > 0 && (
        <ul className="ch-entries">
          {recent.map((e) => (
            <li key={e.id} className="ch-entry">
              <span className="ch-entry-label">{e.label || `+${fmtCount(e.amount)}`}</span>
              <span className="ch-entry-meta muted">{e.amount !== 1 ? `${fmtCount(e.amount)} · ` : ''}{fmtDate(e.date)}</span>
              <button className="icon-btn danger" title="Remove" onClick={() => onRemoveEntry(e.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- New challenge form ---------- */
function NewChallengeForm({ onSubmit, onCancel }: { onSubmit: (input: ChallengeInput) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'Daily' | 'Quantity'>('Daily')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('100')
  const [unit, setUnit] = useState('')
  const [strict, setStrict] = useState(false)
  const [color, setColor] = useState('#b23a5b')

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = parseInt(target, 10) || 0
    if (!name.trim() || t <= 0) return
    onSubmit({
      name: name.trim(), mode, target: t,
      unit: unit.trim() || null,
      strict: mode === 'Daily' ? strict : undefined,
      colorHex: color,
    })
  }

  return (
    <form className="goal-form card" onSubmit={submit}>
      <div className="gf-feeders">
        <span className="gf-label">Mode</span>
        <div className="seg sm">
          <button type="button" className={mode === 'Daily' ? 'on' : ''} onClick={() => setMode('Daily')}>Daily chain</button>
          <button type="button" className={mode === 'Quantity' ? 'on' : ''} onClick={() => setMode('Quantity')}>Quantity</button>
        </div>
        <span className="gf-hint muted">{mode === 'Daily'
          ? 'A check per day toward a number of days.'
          : 'Increment toward a target count.'}</span>
      </div>
      <div className="gf-row">
        <label className="gf-field gf-grow">
          <span>Challenge name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'Daily' ? 'e.g. 10 pulls a day' : 'e.g. Write 100 songs'} autoFocus />
        </label>
        <label className="gf-field gf-narrow">
          <span>{mode === 'Daily' ? 'Target days' : 'Target count'}</span>
          <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="gf-field gf-color">
          <span>Color</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="gf-row">
        <label className="gf-field gf-grow">
          <span>Unit (optional)</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={mode === 'Daily' ? 'e.g. pulls' : 'e.g. songs'} />
        </label>
        {mode === 'Daily' && (
          <label className="gf-check skill-timed">
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
            Strict (must be consecutive days)
          </label>
        )}
      </div>
      <div className="gf-actions">
        <button type="submit" className="btn">Create challenge</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/* ---------- Completion celebration ---------- */
const SHARD_COLORS = ['var(--crimson)', 'var(--watch)', '#e8dcc8']
function ChallengeCelebration({ challenge, onDone }: { challenge: Challenge; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 4500); return () => clearTimeout(t) }, [onDone])
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <div className="celebrate-overlay" onClick={onDone} role="dialog" aria-label={`${challenge.name} complete`}>
      {!reduced && (
        <div className="celebrate-confetti" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => (
            <span key={i} className="shard" style={{
              left: `${(i * 97 % 100)}%`, background: SHARD_COLORS[i % SHARD_COLORS.length],
              animationDelay: `${(i % 12) * 0.13}s`, animationDuration: `${2.4 + (i % 5) * 0.35}s`,
            }} />
          ))}
        </div>
      )}
      <div className="celebrate-card" style={{ ['--goal' as string]: challenge.colorHex || 'var(--crimson)' }} onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-eyebrow">Challenge complete</div>
        <h2 className="celebrate-name">{challenge.name}</h2>
        <div className="celebrate-hours">
          {challenge.mode === 'Quantity' ? `${fmtCount(challenge.target)} ${challenge.unit || ''}`.trim() : `${challenge.target} days`}
        </div>
        <p className="celebrate-sub">{challenge.strict ? 'Chain unbroken' : 'Target reached'}</p>
        <button className="btn" onClick={onDone}>Mark it done</button>
      </div>
    </div>
  )
}
