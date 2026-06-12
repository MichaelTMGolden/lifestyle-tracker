import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type Connection } from '../api'

const ICON: Record<string, string> = {
  Garmin: '⌚', GoogleCalendar: '📅', Spotify: '♪', Manual: '✎',
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

  const load = () => api.connections().then(setConns).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  async function sync(kind: string) {
    setBusy(kind)
    try { const r = await api.syncConnection(kind); setMsg((m) => ({ ...m, [kind]: r.message })) }
    catch (e) { setMsg((m) => ({ ...m, [kind]: String(e) })) }
    finally { setBusy(null); load() }
  }

  if (error) return <p className="error">Couldn't load connections ({error}).</p>

  // Garmin & Google get their own rich panels; the grid shows the remaining seams.
  const others = conns.filter((c) => c.kind !== 'Garmin' && c.kind !== 'GoogleCalendar')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p className="subtitle">Where your data comes from · live integrations drop in behind these seams</p>
        </div>
      </div>

      <GarminPanel />
      <GoogleCalPanel />

      <div className="conn-grid">
        {others.map((c) => (
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
              {!c.configured && c.kind !== 'Manual' && <button className="btn btn-ghost" disabled>Configure later</button>}
            </div>
          </section>
        ))}
      </div>

      <div className="section-title">How this works</div>
      <section className="card">
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          Every source implements one <code>IDataProvider</code> interface behind a shared sync engine.
          <b style={{ color: 'var(--text)' }}> Garmin is live</b> — connect your account above and the dashboard pulls your real
          steps, sleep, heart rate, stress and weight. <b style={{ color: 'var(--text)' }}>Google Calendar &amp; Spotify</b> have
          official OAuth APIs — those go live by adding credentials; the seam is already here. Nothing else in the app changes
          when a source flips from “Not connected” to live.
        </p>
      </section>
    </>
  )
}

/* ---------- Garmin live-sync panel ---------- */
type GarminStatus = { configured: boolean; email: string | null; lastSyncedAt: string | null; sampleCount: number }

function GarminPanel() {
  const [st, setSt] = useState<GarminStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => api.garminStatus().then(setSt).catch(() => setSt(null))
  useEffect(() => { load() }, [])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setErr(''); setNote('')
    try { setNote(await fn()) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null); load() }
  }

  const connect = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    run('connect', async () => {
      await api.garminConnect(email.trim(), password)
      setPassword('')
      return 'Garmin connected. Run a sync to pull your history.'
    })
  }
  const sync = () => run('sync', async () => { const r = await api.garminSync(days); return `Synced ${r.written} samples from the last ${r.days} days.` })
  const disconnect = () => run('disconnect', async () => { await api.garminDisconnect(); return 'Disconnected. Credentials removed.' })
  const clearSamples = () => run('clear', async () => { const r = await api.garminClearSamples(); return `Cleared ${r.deleted} placeholder sample rows.` })
  const upload = (files: FileList | null) => {
    if (!files?.length) return
    run('upload', async () => { const r = await api.importGarmin(Array.from(files)); return r.message })
  }

  return (
    <section className="card garmin-panel">
      <div className="conn-top">
        <span className="conn-ico">⌚</span>
        <div className="conn-id">
          <div className="conn-name">Garmin · Live sync</div>
          <div className="conn-mode">via local Garmin Connect bridge</div>
        </div>
        <span className={st?.configured ? 'pill ok' : 'pill pending'}>{st?.configured ? 'Connected' : 'Not connected'}</span>
      </div>

      {st?.configured ? (
        <>
          <p className="conn-status">Connected as <b>{st.email}</b></p>
          <div className="conn-meta">
            <span>{st.sampleCount.toLocaleString()} samples</span>
            <span className="muted">{ago(st.lastSyncedAt)}</span>
          </div>
          <div className="garmin-row">
            <label className="garmin-days">Days
              <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, +e.target.value || 1))} />
            </label>
            <button className="btn" disabled={!!busy} onClick={sync}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={disconnect}>Disconnect</button>
          </div>
        </>
      ) : (
        <form className="garmin-form" onSubmit={connect}>
          <p className="conn-status">Sign in with your Garmin Connect account to pull real health data.</p>
          <input type="email" placeholder="Garmin email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <input type="password" placeholder="Garmin password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <button className="btn" type="submit" disabled={busy === 'connect' || !email.trim() || !password}>
            {busy === 'connect' ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}

      {note && <div className="conn-msg">{note}</div>}
      {err && <div className="conn-msg err">{err}</div>}

      <div className="garmin-foot">
        <button className="link-btn" disabled={!!busy} onClick={clearSamples}>Clear placeholder sample data</button>
        <span className="sep">·</span>
        <button className="link-btn" onClick={() => fileRef.current?.click()}>Upload Garmin CSV export</button>
        <input ref={fileRef} type="file" accept=".csv" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
    </section>
  )
}

/* ---------- Google Calendar panel (secret iCal URL) ---------- */
type GoogleStatus = { configured: boolean; lastSyncedAt: string | null; eventCount: number }

function GoogleCalPanel() {
  const [st, setSt] = useState<GoogleStatus | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const load = () => api.googleStatus().then(setSt).catch(() => setSt(null))
  useEffect(() => { load() }, [])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setErr(''); setNote('')
    try { setNote(await fn()) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null); load() }
  }
  const connect = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    run('connect', async () => { await api.googleConnect(url.trim()); setUrl(''); return 'Connected. Run a sync to pull your events.' })
  }
  const sync = () => run('sync', async () => { const r = await api.googleSync(); return `Synced ${r.events} events.` })
  const disconnect = () => run('disconnect', async () => { await api.googleDisconnect(); return 'Disconnected.' })

  return (
    <section className="card garmin-panel">
      <div className="conn-top">
        <span className="conn-ico">📅</span>
        <div className="conn-id">
          <div className="conn-name">Google Calendar</div>
          <div className="conn-mode">read-only · secret iCal feed</div>
        </div>
        <span className={st?.configured ? 'pill ok' : 'pill pending'}>{st?.configured ? 'Connected' : 'Not connected'}</span>
      </div>

      {st?.configured ? (
        <>
          <p className="conn-status">Calendar feed connected.</p>
          <div className="conn-meta">
            <span>{st.eventCount.toLocaleString()} events</span>
            <span className="muted">{ago(st.lastSyncedAt)}</span>
          </div>
          <div className="garmin-row">
            <button className="btn" disabled={!!busy} onClick={sync}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={disconnect}>Disconnect</button>
          </div>
        </>
      ) : (
        <form className="garmin-form" onSubmit={connect}>
          <p className="conn-status">
            In Google Calendar → Settings → your calendar → <b>Integrate calendar</b>, copy the
            “Secret address in iCal format” URL and paste it here.
          </p>
          <input type="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" type="submit" disabled={busy === 'connect' || !url.trim()}>
            {busy === 'connect' ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}

      {note && <div className="conn-msg">{note}</div>}
      {err && <div className="conn-msg err">{err}</div>}
    </section>
  )
}
