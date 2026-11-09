// Seasons: which habits are in focus for now. The sheet picks them, an optional
// name and how long it lasts; the banner shows the current season on Habits.
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Habit, type SeasonRow } from '../../api'
import { habitStyle } from '../../habitColor'
import { Button, Sheet, Tabs } from '../../ui'
import { todayKey } from './stats'

const fmt = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: k.slice(0, 4) === todayKey().slice(0, 4) ? undefined : 'numeric' })
function monthsFromToday(n: number): string {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setMonth(d.getMonth() + n); d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function SeasonBanner({ habits, current, onEdit }: { habits: Habit[]; current: SeasonRow | null; onEdit: () => void }) {
  const focus = current ? habits.filter(h => current.habitIds.includes(h.id)) : []
  if (!current || focus.length === 0) return <div className="hb-season hb-season--empty">
    <p><b>No season set.</b> Every habit counts every day. Pick a few to focus on for a while; the rest stay trackable.</p>
    <Button size="sm" onClick={onEdit}>Set a season</Button>
  </div>
  return <div className="hb-season">
    <div>
      <span className="hb-season__eyebrow">{current.name ? `Season · ${current.name}` : 'This season'}{current.endsOn ? ` · until ${fmt(current.endsOn)}` : ''}</span>
      <p className="hb-season__focus">{focus.map(h => <span key={h.id} className="hb-season__habit" style={habitStyle(h)}>{h.name}</span>)}</p>
    </div>
    <Button size="sm" variant="quiet" onClick={onEdit}>Change</Button>
  </div>
}

const lengths = [{ value: 'open', label: 'Open' }, { value: '1', label: '1 mo' }, { value: '3', label: '3 mo' }, { value: '6', label: '6 mo' }, { value: 'date', label: 'Date' }] as const
type Length = typeof lengths[number]['value']

export function SeasonSheet({ open, habits, current, onClose }: { open: boolean; habits: Habit[]; current: SeasonRow | null; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title={current ? 'Change season' : 'New season'} labelledBy="season-title">
    {/* Keyed so it starts from the saved season each time it opens. */}
    {open && <SeasonForm key={current?.id ?? 0} habits={habits} current={current} onDone={onClose} />}
  </Sheet>
}

function SeasonForm({ habits, current, onDone }: { habits: Habit[]; current: SeasonRow | null; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(current?.name ?? '')
  const [picked, setPicked] = useState<number[]>(() => current ? current.habitIds.filter(id => habits.some(h => h.id === id)) : [])
  const [length, setLength] = useState<Length>(current?.endsOn ? 'date' : 'open')
  const [date, setDate] = useState(current?.endsOn ?? monthsFromToday(3))
  const [state, setState] = useState<'idle' | 'saving' | string>('idle')
  const toggle = (id: number) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const endsOn = length === 'open' ? null : length === 'date' ? date || null : monthsFromToday(Number(length))
  const startsToday = current?.startsOn === todayKey()

  const done = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['seasons'] }), qc.invalidateQueries({ queryKey: ['stats'] })])
    setState('idle'); onDone()
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (picked.length === 0 || state === 'saving') return
    setState('saving')
    try { await api.setSeason({ name: name.trim() || null, habitIds: picked, endsOn }); await done() }
    catch (err) { setState(err instanceof Error ? err.message : String(err)) }
  }
  async function end() {
    if (state === 'saving') return
    setState('saving')
    try { await api.endSeason(); await done() }
    catch (err) { setState(err instanceof Error ? err.message : String(err)) }
  }

  return <form className="hb-sheet" onSubmit={save}>
    <fieldset className="hb-field hb-fieldset">
      <legend>In focus</legend>
      <div className="hb-chips">
        {habits.map(h => <button key={h.id} type="button" style={habitStyle(h)} className={`hb-chip${picked.includes(h.id) ? ' hb-chip--on' : ''}`}
          aria-pressed={picked.includes(h.id)} onClick={() => toggle(h.id)}>{h.name}</button>)}
      </div>
      <small>The rest stay on Habits and Today, smaller, and you can still log them. Days you skip them don't count as missed.</small>
    </fieldset>
    <label className="hb-field"><span>Name (optional)</span>
      <input className="hb-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Winter: guitar & singing" maxLength={80} />
    </label>
    <div className="hb-field">
      <span>How long</span>
      <Tabs options={lengths} value={length} onChange={setLength} label="How long" />
      {length === 'date' && <input className="hb-input" type="date" min={todayKey()} value={date} onChange={e => setDate(e.target.value)} aria-label="Last day of the season" />}
      <small>{endsOn ? `Ends after ${fmt(endsOn)}; then every habit counts again until you set the next one.` : 'Runs until you change it.'}</small>
    </div>
    <p className="hb-hint">{current && !startsToday ? 'Saving starts a new season from today; the current one is kept in your history.' : 'Starts today.'}</p>
    {!['idle', 'saving'].includes(state) && <p role="alert" className="hb-error">{state}</p>}
    <Button type="submit" variant="primary" block disabled={picked.length === 0 || state === 'saving' || (length === 'date' && !date)}>{state === 'saving' ? 'Saving…' : 'Save season'}</Button>
    {current && <Button variant="quiet" block disabled={state === 'saving'} onClick={() => void end()}>End season · every habit counts again</Button>}
  </form>
}
