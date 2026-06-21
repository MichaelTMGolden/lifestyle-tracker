import { useEffect, useRef, useState } from 'react'
import { api, type ScheduleBlock, type ScheduleDay } from '../api'
import { categoryColor, fmtDate, fmtMinutes, nowMinutes, withNowLine } from '../lib'

const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
const endOf = (b: ScheduleBlock) => (b.durationMinutes != null ? b.startMinutes + b.durationMinutes : Infinity)
const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

export default function SchedulePage() {
  const [week, setWeek] = useState<ScheduleDay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ block: ScheduleBlock; day: string } | null>(null)
  const [status, setStatus] = useState<{ hasDefault: boolean; revertOn: string | null }>({ hasDefault: false, revertOn: null })
  const [pending, setPending] = useState<File | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => Promise.all([api.scheduleWeek(), api.scheduleStatus()])
    .then(([w, s]) => { setWeek(w); setStatus(s) }).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  async function doImport(mode: 'default' | 'temporary', revertOn?: string) {
    if (!pending) return
    setBusy(true); setMsg('')
    try {
      const r = await api.importSchedule(pending, mode, revertOn)
      setMsg(mode === 'default'
        ? `Saved as your default schedule (${r.blocks} blocks).`
        : `Temporary schedule applied (${r.blocks} blocks) — reverts on ${fmtDate(r.revertOn!)}.`)
      setPending(null); await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  async function restoreDefault() {
    setBusy(true); setMsg('')
    try { await api.restoreDefaultSchedule(); setMsg('Default schedule restored.'); await load() }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  function pickFile(files: FileList | null) {
    if (files?.length) setPending(files[0])
    if (fileRef.current) fileRef.current.value = ''
  }

  if (error) return <p className="error">Couldn't load schedule ({error}).</p>

  const now = nowMinutes()
  const categories = [...new Set(week.flatMap((d) => d.blocks.map((b) => b.category)))]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekly schedule</h1>
          <p className="subtitle">Your recurring timetable · calendar events take precedence on the day</p>
        </div>
        <div className="sched-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Importing…' : 'Upload timetable'}
          </button>
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt" hidden onChange={(e) => pickFile(e.target.files)} />
        </div>
      </div>

      {status.revertOn && (
        <div className="conn-msg sched-temp">
          Temporary schedule active — reverts to your default on <b>{fmtDate(status.revertOn)}</b>.
          <button className="link-btn" disabled={busy} onClick={restoreDefault}>Restore default now</button>
        </div>
      )}
      {msg && <div className="conn-msg">{msg}</div>}

      {pending && (
        <ImportDialog file={pending} hasDefault={status.hasDefault} busy={busy}
          onCancel={() => setPending(null)} onApply={doImport} />
      )}

      <div className="legend">
        {categories.map((c) => (
          <span key={c} className="legend-item">
            <span className="tl-dot" style={{ background: categoryColor[c] ?? '#999' }} />{c}
          </span>
        ))}
      </div>

      <div className="week-grid">
        {week.map((d) => (
          <section key={d.day} className={d.day === todayName ? 'day-col today' : 'day-col'}>
            <h3>{d.day}</h3>
            <ul className="day-blocks">
              {(d.day === todayName ? withNowLine(d.blocks, now) : d.blocks).map((b) =>
                b === 'now' ? (
                  <li key="now" className="now-line-mini"><span>now {fmtMinutes(now)}</span></li>
                ) : (
                  <li key={b.id}
                    className={`day-block${d.day === todayName && b.startMinutes <= now && now < endOf(b) ? ' current' : ''}${b.details ? ' has-detail' : ''}`}
                    style={{ borderLeftColor: categoryColor[b.category] ?? '#999' }}
                    onClick={() => setSelected({ block: b, day: d.day })}
                    title="Click for details">
                    <div className="db-time">{fmtMinutes(b.startMinutes)}{b.durationMinutes ? ` · ${b.durationMinutes}m` : ''}</div>
                    <div className="db-act">
                      {b.activity}
                      {b.protected && <span className="badge">★</span>}
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </div>

      {selected && <BlockDetail block={selected.block} day={selected.day} onClose={() => setSelected(null)} />}
    </>
  )
}

function BlockDetail({ block, day, onClose }: { block: ScheduleBlock; day: string; onClose: () => void }) {
  const end = block.durationMinutes != null ? block.startMinutes + block.durationMinutes : null
  const color = categoryColor[block.category] ?? '#999'
  return (
    <div className="modal-scrim" onClick={onClose} role="dialog" aria-label={`${block.activity} details`}>
      <div className="modal-card" style={{ ['--accent' as string]: color }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="modal-eyebrow" style={{ color }}>{block.category}{block.protected ? ' · protected' : ''}</div>
        <h2 className="modal-title">{block.activity}</h2>
        <div className="modal-when">
          {day} · {fmtMinutes(block.startMinutes)}{end != null ? `–${fmtMinutes(end)}` : ' onward'}
          {block.durationMinutes ? ` · ${block.durationMinutes} min` : ''}
        </div>
        {block.notes && <p className="modal-notes">{block.notes}</p>}
        {block.details
          ? <p className="modal-details">{block.details}</p>
          : <p className="modal-details muted">No extra detail for this block yet. Add a Details column to your timetable and re-upload.</p>}
      </div>
    </div>
  )
}

function ImportDialog({ file, hasDefault, busy, onCancel, onApply }: {
  file: File; hasDefault: boolean; busy: boolean
  onCancel: () => void; onApply: (mode: 'default' | 'temporary', revertOn?: string) => void
}) {
  const [mode, setMode] = useState<'default' | 'temporary'>(hasDefault ? 'temporary' : 'default')
  const [revertOn, setRevertOn] = useState(plusDays(7))
  return (
    <div className="modal-scrim" onClick={onCancel} role="dialog" aria-label="Apply schedule">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onCancel} aria-label="Close">✕</button>
        <div className="modal-eyebrow">Apply schedule</div>
        <h2 className="modal-title">{file.name}</h2>

        {!hasDefault && <p className="muted" style={{ fontSize: 13 }}>No default saved yet — save this as your default first. After that you can apply temporary schedules that revert to it.</p>}

        <div className="seg sm sched-mode">
          <button className={mode === 'default' ? 'on' : ''} onClick={() => setMode('default')}>Set as default</button>
          <button className={mode === 'temporary' ? 'on' : ''} disabled={!hasDefault} onClick={() => setMode('temporary')}>Temporary</button>
        </div>

        {mode === 'temporary'
          ? <label className="sched-revert">Return to default on
              <input type="date" value={revertOn} min={plusDays(1)} onChange={(e) => setRevertOn(e.target.value)} />
            </label>
          : <p className="muted" style={{ fontSize: 13, marginTop: '0.6rem' }}>This becomes your permanent weekly schedule.</p>}

        <div className="gf-actions" style={{ marginTop: '1rem' }}>
          <button className="btn" disabled={busy || (mode === 'temporary' && !revertOn)}
            onClick={() => onApply(mode, mode === 'temporary' ? revertOn : undefined)}>
            {busy ? 'Applying…' : mode === 'default' ? 'Save as default' : 'Apply temporarily'}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
