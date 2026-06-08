import { useEffect, useRef, useState } from 'react'
import { api, type Connection } from '../api'

const ICON: Record<string, string> = {
  Garmin: '⌚', MyFitnessPal: '🍎', GoogleCalendar: '📅', Spotify: '♪', Manual: '✎',
}
const ago = (iso: string | null) => {
  if (!iso) return 'never synced'
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3.6e6)
  if (h < 1) return 'synced just now'
  if (h < 24) return `synced ${h}h ago`
  return `synced ${Math.floor(h / 24)}d ago`
}

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Connection[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => api.connections().then(setConns).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  async function sync(kind: string) {
    setBusy(kind)
    try { const r = await api.syncConnection(kind); setMsg({ ...msg, [kind]: r.message }) }
    catch (e) { setMsg({ ...msg, [kind]: String(e) }) }
    finally { setBusy(null); load() }
  }
  async function upload(files: FileList | null) {
    if (!files || !files.length) return
    setBusy('Garmin')
    try { const r = await api.importGarmin(Array.from(files)); setMsg({ ...msg, Garmin: r.message }) }
    catch (e) { setMsg({ ...msg, Garmin: String(e) }) }
    finally { setBusy(null); load() }
  }

  if (error) return <p className="error">Couldn't load connections ({error}).</p>

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p className="subtitle">Where your data comes from · live integrations drop in behind these seams</p>
        </div>
      </div>

      <div className="conn-grid">
        {conns.map((c) => (
          <section className="card conn-card" key={c.kind}>
            <div className="conn-top">
              <span className="conn-ico">{ICON[c.kind] ?? '•'}</span>
              <div className="conn-id">
                <div className="conn-name">{c.name}</div>
                <div className="conn-mode">{c.mode === 'Api' ? 'API' : c.mode}</div>
              </div>
              <span className={c.configured ? 'pill ok' : 'pill pending'}>{c.configured ? 'Connected' : 'Not connected'}</span>
            </div>

            <p className="conn-status">{c.status}</p>

            <div className="conn-meta">
              <span>{c.records.toLocaleString()} records</span>
              <span className="muted">{ago(c.lastSyncedAt)}</span>
            </div>

            {msg[c.kind] && <div className="conn-msg">{msg[c.kind]}</div>}

            <div className="conn-actions">
              {c.configured && c.kind !== 'Manual' && (
                <button className="btn" disabled={busy === c.kind} onClick={() => sync(c.kind)}>
                  {busy === c.kind ? 'Syncing…' : 'Sync now'}
                </button>
              )}
              {c.kind === 'Garmin' && (
                <>
                  <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Upload export</button>
                  <input ref={fileRef} type="file" accept=".csv" multiple hidden onChange={(e) => upload(e.target.files)} />
                </>
              )}
              {!c.configured && c.kind !== 'Manual' && c.kind !== 'Garmin' && (
                <button className="btn btn-ghost" disabled>Configure later</button>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="section-title">How this works</div>
      <section className="card">
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          Every source implements one <code>IDataProvider</code> interface behind a shared sync engine.
          <b style={{ color: 'var(--text)' }}> Garmin via file import is live today</b> — upload a Garmin Connect export (or
          drop the CSVs in the import folder) and Sync. <b style={{ color: 'var(--text)' }}>MyFitnessPal</b> has no public API,
          so it connects the same way (CSV export). <b style={{ color: 'var(--text)' }}>Google Calendar &amp; Spotify</b> have
          official OAuth APIs — those go live by adding credentials; the seam is already here. Nothing else in the app changes
          when a source flips from “Not connected” to live.
        </p>
      </section>
    </>
  )
}
