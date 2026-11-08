// Challenges: a daily chain (tap the days you did it) or a count toward a target.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Challenge, type ChallengeInput } from '../api'
import { dayRange, fmtCount, fmtDate } from '../lib'
import { Button, Card, Pill, Progress, SectionHead, Sheet, Tabs } from '../ui'
import { useToast } from '../ui/hooks'
import { Celebration } from './Celebration'
import './Challenges.css'

// Celebrate a challenge's completion only once, not on every load.
const CELEB_KEY = 'pd:challenges-celebrated'
const loadCelebrated = (): number[] => { try { return JSON.parse(localStorage.getItem(CELEB_KEY) || '[]') } catch { return [] } }
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const pct = (p: number) => Math.round(Math.min(1, p) * 100)

export function ChallengesSection() {
  const toast = useToast()
  const [challenges, setChallenges] = useState<Challenge[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [celebrated, setCelebrated] = useState(loadCelebrated)

  const load = useCallback(() => api.challenges().then(d => { setChallenges(d); setError(null) }, e => setError(e instanceof Error ? e.message : String(e))), [])
  useEffect(() => { void load() }, [load])

  const replace = (c: Challenge) => setChallenges(cs => (cs ?? []).map(x => x.id === c.id ? c : x))
  const attempt = async (work: () => Promise<void>) => {
    try { await work() } catch (e) { toast.show({ message: `Couldn't save: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' }); void load() }
  }
  const create = (input: ChallengeInput) => attempt(async () => { const c = await api.createChallenge(input); setChallenges(cs => [c, ...(cs ?? [])]); setAdding(false) })
  const remove = (c: Challenge) => {
    if (!confirm(`Delete the challenge "${c.name}" and all its entries? This can't be undone.`)) return
    void attempt(async () => { await api.deleteChallenge(c.id); setChallenges(cs => (cs ?? []).filter(x => x.id !== c.id)) })
  }

  const celebrating = challenges?.find(c => c.isComplete && !celebrated.includes(c.id)) ?? null
  const dismiss = useCallback(() => {
    if (!celebrating) return
    const ids = [...new Set([...loadCelebrated(), celebrating.id])]
    try { localStorage.setItem(CELEB_KEY, JSON.stringify(ids)) } catch { /* private mode */ }
    setCelebrated(ids)
  }, [celebrating])

  const active = (challenges ?? []).filter(c => !c.archived)
  return <section className="ch-section" aria-labelledby="ch-title">
    <SectionHead id="ch-title" title="Challenges" aside={<Button size="sm" variant="quiet" icon="plus" onClick={() => setAdding(true)}>New challenge</Button>} />
    {error && <p className="ch-error" role="alert">Couldn't load challenges ({error}). <Button size="sm" variant="quiet" onClick={() => void load()}>Retry</Button></p>}
    <div className="ch-grid">
      {active.map(c => c.mode === 'Daily'
        ? <DailyCard key={c.id} c={c} onToggle={d => void attempt(async () => replace(await api.toggleChallengeDay(c.id, d)))} onDelete={() => remove(c)} />
        : <QuantityCard key={c.id} c={c}
            onAdd={body => void attempt(async () => replace(await api.incrementChallenge(c.id, body)))}
            onRemoveEntry={id => void attempt(async () => replace(await api.deleteChallengeEntry(id)))}
            onDelete={() => remove(c)} />)}
      {challenges && active.length === 0 && <p className="ch-muted">No challenges yet. Start a daily chain or a count toward a number.</p>}
    </div>
    <Sheet open={adding} onClose={() => setAdding(false)} title="New challenge" labelledBy="ch-new-title">
      {adding && <NewChallengeForm onSubmit={input => void create(input)} />}
    </Sheet>
    {celebrating && <Celebration eyebrow="Challenge complete" title={celebrating.name}
      figure={celebrating.mode === 'Quantity' ? `${fmtCount(celebrating.target)} ${celebrating.unit ?? ''}`.trim() : `${celebrating.target} days`}
      note={celebrating.strict ? 'Chain unbroken.' : 'Target reached.'} onDone={dismiss} />}
  </section>
}

function Head({ c, kind, onDelete }: { c: Challenge; kind: string; onDelete: () => void }) {
  return <div className="ch-head">
    <div className="ch-head__title"><h3>{c.name}</h3><Pill tone={c.isComplete ? 'good' : undefined}>{c.isComplete ? 'Complete' : kind}</Pill></div>
    <Button size="sm" variant="quiet" icon="close" className="ch-danger" aria-label={`Delete ${c.name}`} onClick={onDelete} />
  </div>
}

/** Daily: tap any day to fill or clear it; back-filling a gap repairs the chain. */
function DailyCard({ c, onToggle, onDelete }: { c: Challenge; onToggle: (date: string) => void; onDelete: () => void }) {
  const done = new Set(c.entries.map(e => e.date))
  const today = todayKey()
  return <Card className="ch-card" tone={c.isComplete ? 'accent' : undefined}>
    <Head c={c} kind={c.strict ? 'Strict chain' : 'Forgiving'} onDelete={onDelete} />
    <div className="ch-figures">
      <span className="ch-big">{c.strict ? c.currentStreak : c.daysDone}</span>
      <span className="ch-muted">{c.strict ? `of ${c.target} in a row · ${c.daysDone} days in all` : `of ${c.target} days · ${c.currentStreak}-day streak`}</span>
    </div>
    <Progress value={pct(c.progress)} max={100} label={`${c.name}: ${pct(c.progress)}%`} />
    <div className="ch-days" role="group" aria-label={`${c.name}: days. Tap to fill or clear.`}>
      {dayRange(c.startDate).map(d => {
        const on = done.has(d)
        return <button key={d} type="button" className={`ch-day${on ? ' ch-day--on' : ''}${d === today ? ' ch-day--today' : ''}`}
          aria-pressed={on} aria-label={`${fmtDate(d)}${on ? ', done' : ''}`} title={fmtDate(d)} onClick={() => onToggle(d)} />
      })}
    </div>
  </Card>
}

/** Quantity: +1 or a labelled amount toward the target, with the entries listed. */
function QuantityCard({ c, onAdd, onRemoveEntry, onDelete }: {
  c: Challenge; onAdd: (body: { amount?: number; label?: string }) => void; onRemoveEntry: (id: number) => void; onDelete: () => void
}) {
  const unit = c.unit || 'done'
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const add = (e: FormEvent) => {
    e.preventDefault()
    const a = parseFloat(amount)
    onAdd({ amount: isNaN(a) || a <= 0 ? 1 : a, label: label.trim() || undefined })
    setLabel(''); setAmount('')
  }
  const recent = [...c.entries].reverse()
  return <Card className="ch-card" tone={c.isComplete ? 'accent' : undefined}>
    <Head c={c} kind={unit} onDelete={onDelete} />
    <div className="ch-figures">
      <span className="ch-big">{fmtCount(c.total)}</span>
      <span className="ch-muted">of {fmtCount(c.target)} {unit} · {pct(c.progress)}%</span>
    </div>
    <Progress value={pct(c.progress)} max={100} label={`${c.name}: ${pct(c.progress)}%`} />
    <form className="ch-add" onSubmit={add}>
      <Button size="sm" variant="primary" onClick={() => onAdd({ amount: 1 })}>+1</Button>
      <label className="ui-sr-only" htmlFor={`ch-label-${c.id}`}>Label</label>
      <input id={`ch-label-${c.id}`} className="ch-input" placeholder={unit === 'songs' ? 'Song title' : 'Label'} value={label} onChange={e => setLabel(e.target.value)} />
      <label className="ui-sr-only" htmlFor={`ch-amount-${c.id}`}>Amount</label>
      <input id={`ch-amount-${c.id}`} className="ch-input ch-input--sm" type="number" min="0" step="any" inputMode="decimal" placeholder="1" value={amount} onChange={e => setAmount(e.target.value)} />
      <Button size="sm" type="submit">Add</Button>
    </form>
    {recent.length > 0 && <details className="ch-entries">
      <summary>Entries <span>{recent.length}</span></summary>
      <ul>{recent.map(e => <li key={e.id}>
        <span>{e.label || `+${fmtCount(e.amount)}`}</span>
        <span className="ch-muted">{e.amount !== 1 ? `${fmtCount(e.amount)} · ` : ''}{fmtDate(e.date)}</span>
        <Button size="sm" variant="quiet" icon="close" className="ch-danger" aria-label={`Remove ${e.label || 'entry'}`} onClick={() => onRemoveEntry(e.id)} />
      </li>)}</ul>
    </details>}
  </Card>
}

const modes = [{ value: 'Daily', label: 'Daily chain' }, { value: 'Quantity', label: 'Count' }] as const

function NewChallengeForm({ onSubmit }: { onSubmit: (input: ChallengeInput) => void }) {
  const [mode, setMode] = useState<'Daily' | 'Quantity'>('Daily')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('100')
  const [unit, setUnit] = useState('')
  const [strict, setStrict] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = parseInt(target, 10) || 0
    if (!name.trim() || t <= 0) return
    onSubmit({ name: name.trim(), mode, target: t, unit: unit.trim() || null, strict: mode === 'Daily' ? strict : undefined, colorHex: '#b23a5b' })
  }
  return <form className="ch-form" onSubmit={submit}>
    <Tabs options={modes} value={mode} onChange={setMode} label="Kind" />
    <p className="ch-muted">{mode === 'Daily' ? 'Tick each day you do it, toward a number of days.' : 'Add to a running count toward a target.'}</p>
    <label className="ch-field"><span>Name</span>
      <input className="ch-input" value={name} onChange={e => setName(e.target.value)} placeholder={mode === 'Daily' ? 'e.g. 10 pull-ups a day' : 'e.g. Write 100 songs'} required />
    </label>
    <div className="ch-two">
      <label className="ch-field"><span>{mode === 'Daily' ? 'Days' : 'Target'}</span>
        <input className="ch-input" type="number" min={1} inputMode="numeric" value={target} onChange={e => setTarget(e.target.value)} />
      </label>
      <label className="ch-field"><span>Unit (optional)</span>
        <input className="ch-input" value={unit} onChange={e => setUnit(e.target.value)} placeholder={mode === 'Daily' ? 'pull-ups' : 'songs'} />
      </label>
    </div>
    {mode === 'Daily' && <label className="ch-check"><input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} /> Strict: the days must be in a row</label>}
    <Button type="submit" variant="primary" block disabled={!name.trim() || !(parseInt(target, 10) > 0)}>Start challenge</Button>
  </form>
}
