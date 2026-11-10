// "Working toward": goals on a skill with no deadline (a solo to learn, a song to
// finish), each with optional steps. Reaching one is worth XP and a moment.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Habit } from '../../api'
import { Celebration } from '../../components/Celebration'
import { fmtDate } from '../../lib'
import { MAX_NOTE, MAX_STEPS, MAX_TITLE, skillGoalsApi, sortGoals, stepCount, type SkillGoal } from '../../skillGoals'
import { Button, Progress } from '../../ui'
import { haptic } from '../../ui/feedback'
import { GOAL_XP } from './levels'
import { useSkillGoals, useStoreGoal } from './useSkillGoals'
import './skillGoals.css'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export type Reached = { title: string; habit: string }

/** One goal: its steps to tick and, unless compact, editing and adding steps. */
export function GoalCard({ goal: g, habit, compact, onReached }: {
  goal: SkillGoal; habit: Habit; compact?: boolean; onReached: (r: Reached) => void
}) {
  const store = useStoreGoal()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(g.title)
  const [note, setNote] = useState(g.note ?? '')
  const [step, setStep] = useState('')
  const { done, total } = stepCount(g)

  async function act(fn: () => Promise<SkillGoal | void>) {
    if (busy) return false
    setBusy(true); setError('')
    try { const r = await fn(); if (r) store(r); return true }
    catch (e) { setError(message(e)); return false }
    finally { setBusy(false) }
  }
  const tick = (id: number, on: boolean) => { if (on) haptic(); void act(() => skillGoalsApi.editStep(g.id, id, { done: on })) }
  async function reach() {
    haptic()
    if (await act(() => skillGoalsApi.setDone(g.id, true))) onReached({ title: g.title, habit: habit.name })
  }
  async function addStep(e: FormEvent) {
    e.preventDefault()
    const t = step.trim()
    if (!t) return
    if (await act(() => skillGoalsApi.addStep(g.id, t))) setStep('')
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (await act(() => skillGoalsApi.edit(g.id, { title: title.trim(), note: note.trim() || null }))) setEditing(false)
  }
  async function remove() {
    if (!confirm(`Delete "${g.title}" and its steps?`)) return
    await act(async () => { await skillGoalsApi.remove(g.id); store({ id: g.id, deleted: true }) })
  }
  const edit = () => { setTitle(g.title); setNote(g.note ?? ''); setEditing(true) }

  return <article className={`sg-card${compact ? ' sg-card--compact' : ''}`} aria-label={g.title}>
    {editing ? <form className="sg-edit" onSubmit={save}>
      <label className="hb-field"><span>Goal</span>
        <input className="hb-input" value={title} maxLength={MAX_TITLE} onChange={e => setTitle(e.target.value)} required /></label>
      <label className="hb-field"><span>Note</span>
        <textarea className="hb-input sg-textarea" rows={2} value={note} maxLength={MAX_NOTE} onChange={e => setNote(e.target.value)} /></label>
      <div className="hb-sheet__row hb-sheet__row--wrap">
        <Button type="submit" size="sm" variant="primary" disabled={busy || !title.trim()}>Save</Button>
        <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>Done</Button>
        <Button size="sm" variant="quiet" className="hb-danger" disabled={busy} onClick={() => void remove()}>Delete goal</Button>
      </div>
    </form> : <>
      <div className="sg-card__head">
        <h4 className="sg-card__title">{g.title}</h4>
        {!compact && <Button size="sm" variant="quiet" onClick={edit} aria-label={`Edit ${g.title}`}>Edit</Button>}
      </div>
      {g.note && !compact && <p className="sg-card__note">{g.note}</p>}
    </>}

    {total > 0 && <>
      <div className="sg-card__line"><span>{done} of {total} steps</span>{done === total && <span className="sg-good">All steps done</span>}</div>
      <Progress value={Math.round((done / total) * 100)} max={100} label={`${g.title}: ${done} of ${total} steps`} />
      <ul className="sg-steps">
        {g.steps.map(s => <li key={s.id}>
          <label className={`sg-step${s.doneOn ? ' is-done' : ''}`}>
            <input type="checkbox" checked={!!s.doneOn} disabled={busy} onChange={e => tick(s.id, e.target.checked)} />
            <span>{s.title}</span>
          </label>
          {editing && <Button size="sm" variant="quiet" className="hb-danger" icon="close" aria-label={`Remove step ${s.title}`} disabled={busy}
            onClick={() => void act(() => skillGoalsApi.removeStep(g.id, s.id))} />}
        </li>)}
      </ul>
    </>}

    {!compact && total < MAX_STEPS && <form className="hb-sheet__row" onSubmit={addStep}>
      <label className="ui-sr-only" htmlFor={`sg-step-${g.id}`}>Add a step to {g.title}</label>
      <input id={`sg-step-${g.id}`} className="hb-input" value={step} maxLength={MAX_TITLE} onChange={e => setStep(e.target.value)} placeholder={total ? 'Add a step' : 'Break it into steps (optional)'} />
      <Button type="submit" size="sm" disabled={busy || !step.trim()}>Add</Button>
    </form>}

    {!editing && <Button size="sm" variant={total > 0 && done === total ? 'primary' : 'ghost'} icon="check" disabled={busy} onClick={() => void reach()}>Reached it</Button>}
    {error && <p role="alert" className="hb-error sg-error">{error}</p>}
  </article>
}

/** The celebration for a goal just reached. */
export function GoalReached({ reached, onDone }: { reached: Reached; onDone: () => void }) {
  // Stable for Celebration: its auto-close restarts whenever the callback changes,
  // and Focus re-renders every second while a timer runs.
  const latest = useRef(onDone)
  useEffect(() => { latest.current = onDone })
  const done = useCallback(() => latest.current(), [])
  return <Celebration eyebrow="Goal reached" title={reached.title} figure="★" note={`+${GOAL_XP} XP for ${reached.habit}. On to the next one.`} onDone={done} />
}

/** A habit's goals on its page: open ones to work on, a form for a new one, and those reached. */
export function GoalsSection({ habit: h }: { habit: Habit }) {
  const { all, loaded, error, refetch } = useSkillGoals()
  const store = useStoreGoal()
  const { open, reached } = sortGoals(all.filter(g => g.habitId === h.id))
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [steps, setSteps] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | string>('idle')
  const [celebrate, setCelebrate] = useState<Reached | null>(null)
  const stepList = steps.split('\n').map(s => s.trim()).filter(Boolean)
  const tooLong = stepList.some(s => s.length > MAX_TITLE)

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || state === 'saving') return
    setState('saving')
    try {
      store(await skillGoalsApi.create({ habitId: h.id, title: title.trim(), note: note.trim() || null, steps: stepList }))
      setTitle(''); setNote(''); setSteps(''); setAdding(false); setState('idle')
    } catch (err) { setState(message(err)) }
  }
  async function reopen(g: SkillGoal) {
    setState('idle')
    try { store(await skillGoalsApi.setDone(g.id, false)) }
    catch (e) { setState(message(e)) }
  }

  return <section className="hb-sheet__section" id="working-toward" aria-labelledby="hb-toward">
    <h3 id="hb-toward" className="hb-sheet__label">Working toward</h3>
    {!loaded && <p className="hb-hint">Loading…</p>}
    {error != null && !all.length && <p className="hb-error" role="alert">Couldn't load goals. <Button size="sm" variant="quiet" onClick={() => void refetch()}>Retry</Button></p>}
    {loaded && !error && !open.length && !adding && <p className="hb-hint">A finish line with no deadline: a solo to learn, a song to finish, a technique to get clean. Reaching one is worth {GOAL_XP} XP.</p>}
    {open.map(g => <GoalCard key={g.id} goal={g} habit={h} onReached={setCelebrate} />)}

    {adding ? <form className="sg-card sg-new" onSubmit={create}>
      <label className="hb-field"><span>What are you working toward?</span>
        <input className="hb-input" autoFocus value={title} maxLength={MAX_TITLE} onChange={e => setTitle(e.target.value)} placeholder="e.g. Learn the solo in Hotel California" required /></label>
      <label className="hb-field"><span>Steps (optional, one per line)</span>
        <textarea className="hb-input sg-textarea" rows={4} value={steps} onChange={e => setSteps(e.target.value)} placeholder={'Intro riff\nFirst verse\nBends in tune\nFull speed'} /></label>
      <label className="hb-field"><span>Note (optional)</span>
        <input className="hb-input" value={note} maxLength={MAX_NOTE} onChange={e => setNote(e.target.value)} placeholder="Why it matters, a link, a tab" /></label>
      {stepList.length > MAX_STEPS && <p className="hb-error" role="alert">Up to {MAX_STEPS} steps.</p>}
      {tooLong && <p className="hb-error" role="alert">Each step can be up to {MAX_TITLE} characters.</p>}
      <div className="hb-sheet__row">
        <Button type="submit" size="sm" variant="primary" disabled={state === 'saving' || !title.trim() || stepList.length > MAX_STEPS || tooLong}>{state === 'saving' ? 'Saving…' : 'Add goal'}</Button>
        <Button size="sm" variant="quiet" onClick={() => { setAdding(false); setState('idle') }}>Cancel</Button>
      </div>
    </form> : loaded && !error && <Button size="sm" icon="plus" onClick={() => { setAdding(true); setState('idle') }}>{open.length ? 'Another goal' : 'Set a goal'}</Button>}
    {!['idle', 'saving'].includes(state) && <p className="hb-error" role="alert">{state}</p>}

    {reached.length > 0 && <details className="sg-reached">
      <summary className="hb-sheet__label">Reached · {reached.length}</summary>
      <ul>
        {reached.map(g => <li key={g.id}>
          <span className="sg-reached__star" aria-hidden="true">★</span>
          <span className="sg-reached__title">{g.title}<small>{fmtDate(g.doneOn!)}{g.steps.length ? ` · ${g.steps.length} steps` : ''}</small></span>
          <Button size="sm" variant="quiet" onClick={() => void reopen(g)}>Reopen</Button>
        </li>)}
      </ul>
    </details>}
    {celebrate && <GoalReached reached={celebrate} onDone={() => setCelebrate(null)} />}
  </section>
}

/** A habit's lead open goal as one line ("→ Learn the solo · 2/5"). */
export function GoalLine({ goal: g, more }: { goal: SkillGoal; more?: number }) {
  const { done, total } = stepCount(g)
  return <span className="sg-line"><span aria-hidden="true">→ </span>{g.title}{total > 0 && <small> · {done}/{total}</small>}{more ? <small> · +{more} more</small> : null}</span>
}

/** Focus: the habit's lead goal with its steps to tick mid-session, or a way to set one. */
export function FocusGoals({ habit: h }: { habit: Habit }) {
  const { all, loaded } = useSkillGoals()
  const [celebrate, setCelebrate] = useState<Reached | null>(null)
  const { open } = sortGoals(all.filter(g => g.habitId === h.id))
  if (!loaded) return null
  const lead = open[0]
  return <div className="fx__aims">
    {lead ? <>
      <span className="fx__aims-label">Working toward{open.length > 1 ? ` · 1 of ${open.length}` : ''}</span>
      <GoalCard key={lead.id} goal={lead} habit={h} compact onReached={setCelebrate} />
    </> : <Link to={`/habits/${h.id}#working-toward`} className="fx__link">Set something to work toward</Link>}
    {celebrate && <GoalReached reached={celebrate} onDone={() => setCelebrate(null)} />}
  </div>
}
