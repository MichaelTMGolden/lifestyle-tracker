// Evening check-in on Today: tick what's left, rate the day 1–5, write one line,
// and move anything unfinished to tomorrow. Shown from 8 pm (or with ?checkin=1);
// once saved it folds down to a one-line summary.
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type DailyTodo, type Habit, type Todo } from '../../api'
import { dailyPlanning, dateKey, nextDateKey } from '../../dailyPlanning'
import type { PlanningAction } from '../../components/DailyPlanning'
import { Button } from '../../ui'
import { haptic } from '../../ui/feedback'

import { EVENING_HOUR, MOODS } from './mood'

export function CheckIn({ openHabits, tasks, daily, busy, onAction, onTapHabit, forced }: {
  /** Focus habits not done yet today. */
  openHabits: Habit[]
  /** Unfinished tasks planned for today. */
  tasks: Todo[]
  /** Unfinished items on today's list. */
  daily: DailyTodo[]
  busy: boolean
  onAction: PlanningAction
  onTapHabit: (h: Habit) => void
  /** Opened on purpose (?checkin=1): show the form whatever the time. */
  forced?: boolean
}) {
  const day = dateKey()
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['day-notes', 14], queryFn: () => api.dayNotes(14) })
  const saved = notes.data?.find(n => n.date === day)
  const [editing, setEditing] = useState(false)
  const evening = new Date().getHours() >= EVENING_HOUR
  if (!notes.isSuccess) return null
  if (!evening && !forced && !saved) return null

  if (saved && !editing) return <section className="td-checkin td-checkin--done" aria-label="Today's check-in">
    <p><span className="td-checkin__eyebrow">Checked in</span>
      {saved.mood && <b>{MOODS[saved.mood - 1]}</b>}{saved.note && <span className="td-checkin__line">“{saved.note}”</span>}</p>
    <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>Edit</Button>
  </section>

  const leftover = tasks.length + daily.length
  const moveAll = () => onAction(async () => {
    const tomorrow = nextDateKey()
    for (const t of tasks) await dailyPlanning.plan(t.id, tomorrow, t.isPriority ?? false)
    for (const d of daily) await dailyPlanning.carry(d.id, tomorrow)
  }, `Moved ${leftover} to tomorrow.`)

  return <section className="td-checkin" aria-labelledby="td-checkin-title">
    <h2 id="td-checkin-title" className="td-checkin__title">Close the day</h2>

    {openHabits.length > 0 && <div className="td-checkin__part">
      <span className="td-checkin__label">Still open</span>
      <div className="td-checkin__habits">
        {openHabits.map(h => <button key={h.id} type="button" className="td-checkin__habit" onClick={() => { haptic(); onTapHabit(h) }}
          aria-label={h.tracksTime ? `Start ${h.name} timer` : `Mark ${h.name} done`}>{h.name}</button>)}
      </div>
    </div>}

    {leftover > 0 && <div className="td-checkin__part td-checkin__row">
      <span>{leftover} unfinished on today's list</span>
      <Button size="sm" disabled={busy} onClick={() => void moveAll()}>Move to tomorrow</Button>
    </div>}

    <NoteForm key={saved ? `${saved.mood}:${saved.note}` : 'new'} day={day} mood={saved?.mood ?? null} note={saved?.note ?? ''}
      onSaved={async () => { await qc.invalidateQueries({ queryKey: ['day-notes'] }); setEditing(false) }} />
  </section>
}

function NoteForm({ day, mood: savedMood, note: savedNote, onSaved }: { day: string; mood: number | null; note: string; onSaved: () => Promise<void> }) {
  const [mood, setMood] = useState<number | null>(savedMood)
  const [note, setNote] = useState(savedNote)
  const [state, setState] = useState<'idle' | 'saving' | string>('idle')
  async function save(e: FormEvent) {
    e.preventDefault()
    if (state === 'saving' || (mood == null && !note.trim())) return
    setState('saving')
    try { await api.saveDayNote(day, { mood, note: note.trim() || null }); setState('idle'); await onSaved() }
    catch (err) { setState(err instanceof Error ? err.message : String(err)) }
  }
  return <form className="td-checkin__part" onSubmit={save}>
    <span className="td-checkin__label" id="td-mood">How was today?</span>
    <div className="td-mood" role="radiogroup" aria-labelledby="td-mood">
      {MOODS.map((m, i) => <button key={m} type="button" role="radio" aria-checked={mood === i + 1} className="td-mood__opt"
        onClick={() => setMood(mood === i + 1 ? null : i + 1)}><span className="td-mood__dot" data-mood={i + 1} aria-hidden="true" />{m}</button>)}
    </div>
    <label className="ui-sr-only" htmlFor="td-note">One line about today</label>
    <input id="td-note" className="td-checkin__input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="One line about today (optional)" enterKeyHint="done" />
    {!['idle', 'saving'].includes(state) && <p role="alert" className="td-error">{state}</p>}
    <Button type="submit" variant="primary" block disabled={state === 'saving' || (mood == null && !note.trim())}>{state === 'saving' ? 'Saving…' : 'Save check-in'}</Button>
  </form>
}
