import { useEffect, useRef, useState } from 'react'
import { api, type ScheduleBlock, type ScheduleDay } from '../api'
import { categoryColor, fmtMinutes, nowMinutes, withNowLine } from '../lib'

const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
const endOf = (b: ScheduleBlock) => (b.durationMinutes != null ? b.startMinutes + b.durationMinutes : Infinity)

export default function SchedulePage() {
  const [week, setWeek] = useState<ScheduleDay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ block: ScheduleBlock; day: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => api.scheduleWeek().then(setWeek).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setMsg('')
    try { const r = await api.importSchedule(files[0]); setMsg(`Imported ${r.blocks} blocks across ${r.days} days.`); await load() }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
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
          <input ref={fileRef} type="file" accept=".md,.markdown,.txt" hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </div>

      {msg && <div className="conn-msg">{msg}</div>}

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
