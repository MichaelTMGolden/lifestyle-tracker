// Everything for one habit: stats, the year view, logging, rhythm, entries and settings.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Habit, type HabitLogEntry } from '../../api'
import { fmtDate, fmtElapsed, fmtHours } from '../../lib'
import { skillProgressApi } from '../../skillProgressApi'
import { Button, Heatmap, Sheet, Stat, Tabs } from '../../ui'
import type { HeatCell } from '../../ui/hooks'
import { consistency, isWeekly, streakUnit } from './stats'

const cadences = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }] as const

export function HabitSheet({ habit, yearCells, running, elapsedMs, onClose, onLog, onToggle, onStart, onStop, onChanged, onDelete }: {
  habit: Habit | null
  yearCells: HeatCell[]
  running: boolean
  elapsedMs: number
  onClose: () => void
  onLog: (minutes: number) => Promise<void>
  onToggle: () => void
  onStart: () => void
  onStop: () => void
  onChanged: () => Promise<unknown>
  onDelete: () => void
}) {
  return <Sheet open={habit != null} onClose={onClose} title={habit?.name ?? ''} labelledBy="habit-sheet-title">
    {/* Keyed so each habit's form state starts fresh. */}
    {habit && <HabitDetail key={habit.id} habit={habit} yearCells={yearCells} running={running} elapsedMs={elapsedMs}
      onLog={onLog} onToggle={onToggle} onStart={onStart} onStop={onStop} onChanged={onChanged} onDelete={onDelete} />}
  </Sheet>
}

function HabitDetail({ habit: h, yearCells, running, elapsedMs, onLog, onToggle, onStart, onStop, onChanged, onDelete }: {
  habit: Habit; yearCells: HeatCell[]; running: boolean; elapsedMs: number
  onLog: (minutes: number) => Promise<void>; onToggle: () => void; onStart: () => void; onStop: () => void
  onChanged: () => Promise<unknown>; onDelete: () => void
}) {
  const [custom, setCustom] = useState('')
  // The API adds each request's minutes to the day, so block repeats until the save settles.
  const [saving, setSaving] = useState(false)
  async function log(mins: number) {
    if (saving || !(mins > 0)) return
    setSaving(true)
    try { await onLog(mins) } finally { setSaving(false) }
  }
  const addCustom = (e: FormEvent) => {
    e.preventDefault()
    const mins = parseInt(custom, 10)
    if (!mins || mins <= 0 || saving) return
    setCustom('')
    void log(mins)
  }

  return <div className="hb-sheet">
    <div className="hb-sheet__stats">
      <Stat label="Streak" value={h.currentStreak} unit={streakUnit(h, h.currentStreak)} tone="accent" />
      <Stat label="Best" value={h.bestStreak} unit={streakUnit(h, h.bestStreak)} sub="past year" />
      <Stat label="Last 30 days" value={`${consistency(h)}%`} sub={isWeekly(h) ? `of ${h.targetPerPeriod}× a week` : 'of days'} />
      <Stat label="Total" value={h.tracksTime ? fmtHours(h.totalMinutes) : h.totalCompletions} unit={h.tracksTime ? undefined : 'days'} />
    </div>

    <section className="hb-sheet__section" aria-labelledby="hb-year">
      <h3 id="hb-year" className="hb-sheet__label">Past year</h3>
      <Heatmap cells={yearCells} variant="calendar" label={`${h.name}: last year`} today={yearCells.at(-1)?.date} cellSize={10} />
    </section>

    {h.tracksTime ? <section className="hb-sheet__section" aria-labelledby="hb-log">
      <h3 id="hb-log" className="hb-sheet__label">Today · {h.minutesToday} min</h3>
      <div className="hb-sheet__row">
        {[15, 30, 45, 60].map(m => <Button key={m} size="sm" disabled={saving} onClick={() => void log(m)}>+{m}</Button>)}
      </div>
      <form className="hb-sheet__row" onSubmit={addCustom}>
        <label className="ui-sr-only" htmlFor="hb-custom">Minutes to log</label>
        <input id="hb-custom" className="hb-input" type="number" inputMode="numeric" min={1} placeholder="Minutes" value={custom} onChange={e => setCustom(e.target.value)} />
        <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Log'}</Button>
      </form>
      {running
        ? <Button variant="primary" block icon="stop" onClick={onStop}>Stop &amp; log · {fmtElapsed(elapsedMs)}</Button>
        : <Button variant="primary" block icon="play" onClick={onStart}>Start timer</Button>}
    </section>
      : <Button variant={h.doneToday ? 'ghost' : 'primary'} block icon="check" onClick={onToggle} aria-pressed={h.doneToday}>
          {h.doneToday ? 'Done today · tap to undo' : 'Mark done today'}
        </Button>}

    <Rhythm habit={h} onChanged={onChanged} />
    {h.tracksTime && <Entries habitId={h.id} version={`${h.minutesToday}:${h.totalMinutes}`} onChanged={onChanged} />}

    <section className="hb-sheet__section" aria-labelledby="hb-settings">
      <h3 id="hb-settings" className="hb-sheet__label">Settings</h3>
      <div className="hb-sheet__row hb-sheet__row--wrap">
        <Button size="sm" onClick={async () => { await api.toggleHabitTracksTime(h.id); await onChanged() }}>
          {h.tracksTime ? 'Stop tracking time' : 'Track time'}
        </Button>
        <Button size="sm" aria-pressed={h.showInQuickActions} onClick={async () => { await api.toggleHabitQuickActions(h.id); await onChanged() }}>
          {h.showInQuickActions ? 'In quick actions ✓' : 'Add to quick actions'}
        </Button>
        <Button size="sm" variant="quiet" className="hb-danger" onClick={onDelete}>Delete habit</Button>
      </div>
    </section>
  </div>
}

function Rhythm({ habit, onChanged }: { habit: Habit; onChanged: () => Promise<unknown> }) {
  const [cadence, setCadence] = useState<'daily' | 'weekly'>(habit.cadence === 'weekly' ? 'weekly' : 'daily')
  const [target, setTarget] = useState(String(habit.cadence === 'weekly' ? habit.targetPerPeriod : 3))
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle')
  const dirty = cadence !== habit.cadence || (cadence === 'weekly' && Number(target) !== habit.targetPerPeriod)

  async function save(e: FormEvent) {
    e.preventDefault(); setState('saving')
    try {
      await skillProgressApi.cadence(habit.id, cadence, cadence === 'daily' ? 1 : Number(target))
      await onChanged(); setState('saved')
    } catch (err) { setState(err instanceof Error ? err.message : String(err)) }
  }

  return <form className="hb-sheet__section" onSubmit={save} aria-labelledby="hb-rhythm">
    <h3 id="hb-rhythm" className="hb-sheet__label">Rhythm</h3>
    <Tabs options={cadences} value={cadence} onChange={v => { setCadence(v); setState('idle') }} label="How often" />
    {cadence === 'weekly' && <label className="hb-field">
      <span>Practice days a week</span>
      <input className="hb-input" type="number" inputMode="numeric" min={1} max={7} value={target} onChange={e => { setTarget(e.target.value); setState('idle') }} required />
    </label>}
    <p className="hb-hint">Weekly targets allow rest days. Several sessions on one day count as one practice day.</p>
    <div className="hb-sheet__row">
      <Button type="submit" size="sm" disabled={!dirty || state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save rhythm'}</Button>
      {state === 'saved' && <span role="status" className="hb-hint">Saved.</span>}
      {!['idle', 'saving', 'saved'].includes(state) && <span role="alert" className="hb-error">{state}</span>}
    </div>
  </form>
}

/**
 * Edit or delete the last 30 days of logged minutes (fixes bad timer data).
 * Entries are fetched each time the list opens and again whenever the habit's
 * minutes change (`version`), and pending edits are dropped then, so a stale
 * value can never overwrite time logged since.
 */
function Entries({ habitId, version, onChanged }: { habitId: number; version: string; onChanged: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<HabitLogEntry[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const fresh = await api.habitLogs(habitId, 30)
      setLogs(fresh); setEdits({}); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [habitId])
  useEffect(() => {
    if (!open) return
    let live = true
    api.habitLogs(habitId, 30).then(
      fresh => { if (live) { setLogs(fresh); setEdits({}); setError('') } },
      e => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [open, version, habitId])
  const save = async (date: string) => {
    const v = parseInt(edits[date] ?? '', 10)
    if (isNaN(v) || v < 0) return
    await api.setHabitLog(habitId, date, v)
    setEdits(e => { const c = { ...e }; delete c[date]; return c })
    await reload(); await onChanged()
  }
  const remove = async (date: string) => {
    if (!confirm(`Delete the entry for ${fmtDate(date)}?`)) return
    await api.deleteHabitLog(habitId, date); await reload(); await onChanged()
  }

  return <details className="hb-sheet__section hb-entries" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary className="hb-sheet__label">Edit entries</summary>
    {error && <p role="alert" className="hb-error">{error}</p>}
    {!logs && !error && <p className="hb-hint">Loading…</p>}
    {logs?.length === 0 && <p className="hb-hint">No entries in the last 30 days.</p>}
    {logs && logs.length > 0 && <ul className="hb-entries__list">
      {logs.map(l => <li key={l.id}>
        <span className="hb-entries__date">{fmtDate(l.date)}</span>
        <label className="ui-sr-only" htmlFor={`hb-entry-${l.id}`}>Minutes on {fmtDate(l.date)}</label>
        <input id={`hb-entry-${l.id}`} className="hb-input hb-input--sm" type="number" inputMode="numeric" min={0}
          value={edits[l.date] ?? String(l.minutes)} onChange={e => setEdits(s => ({ ...s, [l.date]: e.target.value }))} />
        <span className="hb-hint">min</span>
        <Button size="sm" variant="quiet" disabled={edits[l.date] === undefined} onClick={() => void save(l.date)}>Save</Button>
        <Button size="sm" variant="quiet" className="hb-danger" icon="close" aria-label={`Delete ${fmtDate(l.date)} entry`} onClick={() => void remove(l.date)} />
      </li>)}
    </ul>}
  </details>
}
