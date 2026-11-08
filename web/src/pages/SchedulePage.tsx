// Routine: the recurring weekly template (calendar events take precedence on the
// day). A day at a time on phones, the whole week side by side on request; tap a
// block for its details and a note for this week only. Upload a timetable as the
// default or as a temporary routine that reverts on a date.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ScheduleBlock, type ScheduleDay } from '../api'
import { useNowMinutes, usePoll } from '../hooks'
import { categoryColor, fmtDate, fmtMinutes, withNowLine } from '../lib'
import { Button, Sheet, Skeleton, Tabs } from '../ui'
import { useToast } from '../ui/hooks'
import './schedule/schedule.css'

const endOf = (b: ScheduleBlock) => (b.durationMinutes != null ? b.startMinutes + b.durationMinutes : Infinity)
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const short = (day: string) => day.slice(0, 3)
const views = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }] as const

export default function SchedulePage() {
  const toast = useToast()
  const [week, setWeek] = useState<ScheduleDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<{ hasDefault: boolean; revertOn: string | null }>({ hasDefault: false, revertOn: null })
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const [day, setDay] = useState(todayName)
  const [view, setView] = useState<'day' | 'week'>('day')
  const [selected, setSelected] = useState<{ block: ScheduleBlock; day: string } | null>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const now = useNowMinutes()

  const load = useCallback(() => Promise.all([api.scheduleWeek(), api.scheduleStatus()])
    .then(([w, s]) => { setWeek(w); setStatus(s); setError(null) })
    .catch(e => setError(e instanceof Error ? e.message : String(e))), [])
  useEffect(() => { void load() }, [load])
  usePoll(() => { void load() }, 180_000) // a temporary routine reverting shows up without a refresh

  async function doImport(mode: 'default' | 'temporary', revertOn?: string) {
    if (!pending) return
    setBusy(true)
    try {
      const r = await api.importSchedule(pending, mode, revertOn)
      toast.show({ message: mode === 'default' ? `Saved as your default routine (${r.blocks} blocks).` : `Temporary routine applied (${r.blocks} blocks) until ${fmtDate(r.revertOn!)}.` })
      setPending(null); await load()
    } catch (e) { toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'error' }) }
    finally { setBusy(false) }
  }
  async function restoreDefault() {
    setBusy(true)
    try { await api.restoreDefaultSchedule(); toast.show({ message: 'Default routine restored.' }); await load() }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'error' }) }
    finally { setBusy(false) }
  }
  async function saveNote(id: number, text: string) {
    await api.setBlockWeekNote(id, text)
    const w = await api.scheduleWeek()
    setWeek(w)
    setSelected(sel => sel ? { ...sel, block: w.flatMap(d => d.blocks).find(b => b.id === sel.block.id) ?? sel.block } : sel)
  }

  const dayTabs = (week ?? []).map(d => ({ value: d.day, label: d.day === todayName ? 'Today' : short(d.day) }))
  const current = week?.find(d => d.day === day) ?? week?.[0]
  const isToday = (d: string) => d === todayName

  const blockRow = (b: ScheduleBlock, d: string) => {
    const live = isToday(d) && b.startMinutes <= now && now < endOf(b)
    return <li key={b.id}>
      <button type="button" className={`sc-block${live ? ' sc-block--now' : ''}`} onClick={() => setSelected({ block: b, day: d })}
        style={{ ['--cat' as string]: categoryColor[b.category] ?? 'var(--rite-muted)' }}>
        <span className="sc-block__time">{fmtMinutes(b.startMinutes)}{b.durationMinutes ? <small>{b.durationMinutes}m</small> : null}</span>
        <span className="sc-block__text"><span>{b.activity}{b.protected && <span className="sc-star" aria-label="protected"> ★</span>}</span>
          <small>{b.weekOverride ? `This week: ${b.weekOverride}` : b.category}</small></span>
      </button>
    </li>
  }
  const dayList = (d: ScheduleDay) => <ul className="sc-list" aria-label={d.day}>
    {(isToday(d.day) ? withNowLine(d.blocks, now) : d.blocks).map(b => b === 'now'
      ? <li key="now" className="sc-now" aria-label={`Now, ${fmtMinutes(now)}`}><span>Now {fmtMinutes(now)}</span></li>
      : blockRow(b, d.day))}
    {d.blocks.length === 0 && <li className="sc-empty">Nothing in the routine for this day.</li>}
  </ul>

  return <div className="sc-page">
    <header className="sc-head">
      <div>
        <h1>Routine</h1>
        <p className="sc-head__sub">Your weekly template. Calendar events take precedence on the day.</p>
      </div>
      <Button size="sm" variant="quiet" icon="plus" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Importing…' : 'Upload'}</Button>
      <input ref={fileRef} type="file" accept=".md,.markdown,.txt" hidden onChange={e => { if (e.target.files?.length) setPending(e.target.files[0]); e.target.value = '' }} />
    </header>

    {error && <p className="sc-error" role="alert">{week ? 'Showing the last loaded routine.' : "Couldn't load your routine."} <Button size="sm" variant="quiet" onClick={() => void load()}>Retry</Button></p>}
    {status.revertOn && <div className="sc-temp">
      <span>Temporary routine until <b>{fmtDate(status.revertOn)}</b>, then back to your default.</span>
      <Button size="sm" variant="quiet" disabled={busy} onClick={() => void restoreDefault()}>Restore now</Button>
    </div>}

    <Tabs options={views} value={view} onChange={setView} label="Show" />

    {!week ? <Skeleton lines={5} />
      : view === 'day' ? <>
        <div className="sc-days" role="group" aria-label="Day">
          {dayTabs.map(t => <button key={t.value} type="button" aria-pressed={t.value === current?.day} className={`sc-day${t.value === current?.day ? ' sc-day--on' : ''}`} onClick={() => setDay(t.value)}>{t.label}</button>)}
        </div>
        {current && dayList(current)}
      </>
      : <div className="sc-week">
        {week.map(d => <section key={d.day} className={`sc-col${isToday(d.day) ? ' sc-col--today' : ''}`} aria-label={d.day}>
          <h2>{isToday(d.day) ? 'Today' : short(d.day)}</h2>
          {dayList(d)}
        </section>)}
      </div>}

    <BlockSheet selected={selected} onClose={() => setSelected(null)} onSave={saveNote} />
    <ImportSheet file={pending} hasDefault={status.hasDefault} busy={busy} onCancel={() => setPending(null)} onApply={doImport} />
  </div>
}

function BlockSheet({ selected, onClose, onSave }: {
  selected: { block: ScheduleBlock; day: string } | null; onClose: () => void; onSave: (id: number, text: string) => Promise<void>
}) {
  return <Sheet open={selected != null} onClose={onClose} title={selected?.block.activity ?? ''} labelledBy="sc-block-title">
    {selected && <BlockDetail key={selected.block.id} block={selected.block} day={selected.day} onSave={onSave} />}
  </Sheet>
}

function BlockDetail({ block, day, onSave }: { block: ScheduleBlock; day: string; onSave: (id: number, text: string) => Promise<void> }) {
  const end = block.durationMinutes != null ? block.startMinutes + block.durationMinutes : null
  const override = block.weekOverride ?? null
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(override ?? block.details ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (value: string) => {
    setBusy(true); setError('')
    try { await onSave(block.id, value); setEditing(false); if (!value) setText(block.details ?? '') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="sc-detail">
    <p className="sc-detail__when" style={{ ['--cat' as string]: categoryColor[block.category] ?? 'var(--rite-muted)' }}>
      <span className="sc-dot" aria-hidden="true" />{block.category}{block.protected ? ' · protected' : ''} · {day} {fmtMinutes(block.startMinutes)}{end != null ? `–${fmtMinutes(end)}` : ' onward'}
    </p>
    {block.notes && <p className="sc-p">{block.notes}</p>}
    {!editing ? <>
      {override ? <p className="sc-p"><b>This week:</b> {override}</p> : block.details ? <p className="sc-p">{block.details}</p> : <p className="sc-p sc-muted">No details for this block yet.</p>}
      <Button size="sm" variant="quiet" onClick={() => { setText(override ?? block.details ?? ''); setEditing(true) }}>{override ? 'Edit this week’s note' : 'Add a note for this week'}</Button>
    </> : <div className="sc-edit">
      <label className="sc-label" htmlFor="sc-note">Just for this week</label>
      <textarea id="sc-note" className="sc-input" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="What to focus on in this block this week…" />
      <div className="sc-row">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(text.trim())}>Save for this week</Button>
        {override && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void run('')}>Clear</Button>}
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      {block.details && <p className="sc-muted">Usually: {block.details}</p>}
    </div>}
    {error && <p className="sc-error" role="alert">{error}</p>}
  </div>
}

function ImportSheet({ file, hasDefault, busy, onCancel, onApply }: {
  file: File | null; hasDefault: boolean; busy: boolean; onCancel: () => void; onApply: (mode: 'default' | 'temporary', revertOn?: string) => void
}) {
  // The form mounts per chosen file, so its starting mode reflects the loaded status
  // (temporary whenever a default exists: an upload never silently replaces it).
  return <Sheet open={file != null} onClose={onCancel} title="Apply routine" labelledBy="sc-import-title">
    {file && <ImportForm key={`${file.name}:${file.lastModified}:${file.size}`} file={file} hasDefault={hasDefault} busy={busy} onApply={onApply} />}
  </Sheet>
}

function ImportForm({ file, hasDefault, busy, onApply }: {
  file: File; hasDefault: boolean; busy: boolean; onApply: (mode: 'default' | 'temporary', revertOn?: string) => void
}) {
  const [mode, setMode] = useState<'default' | 'temporary'>(hasDefault ? 'temporary' : 'default')
  const [revertOn, setRevertOn] = useState(plusDays(7))
  const modes = [{ value: 'default', label: 'New default' }, ...(hasDefault ? [{ value: 'temporary', label: 'Temporary' }] : [])] as { value: 'default' | 'temporary'; label: string }[]
  return <div className="sc-detail">
    <p className="sc-p">{file.name}</p>
    {!hasDefault && <p className="sc-muted">No default routine yet: save this one as your default first. After that you can apply temporary routines that revert to it.</p>}
    <Tabs options={modes} value={mode} onChange={setMode} label="Apply as" />
    {mode === 'temporary'
      ? <label className="sc-label">Back to the default on
          <input className="sc-input" type="date" value={revertOn} min={plusDays(1)} onChange={e => setRevertOn(e.target.value)} />
        </label>
      : <p className="sc-muted">{hasDefault ? 'This replaces your current default routine.' : 'This becomes your weekly routine.'}</p>}
    <Button variant="primary" block disabled={busy || (mode === 'temporary' && !revertOn)} onClick={() => onApply(mode, mode === 'temporary' ? revertOn : undefined)}>
      {busy ? 'Applying…' : mode === 'default' ? (hasDefault ? 'Replace default' : 'Save as default') : 'Apply until then'}
    </Button>
  </div>
}
