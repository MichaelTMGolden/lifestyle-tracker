// Connect: where the dashboard's data comes from. Workouts (Hevy, Apple Health), Garmin (live sync or CSV),
// Google Calendar (secret iCal feeds, read-only), and the remaining sources.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, type Connection } from '../api'
import { Button, Card, Pill } from '../ui'
import { useToast } from '../ui/hooks'
import { HealthCard, HevyCard, WorkoutHabitsCard } from './connect/WorkoutCards'
import './connect/connect.css'

/** "Synced 12 Jun, 18:53 · 3h ago"; "Never synced" when it hasn't run. */
const ago = (iso: string | null) => {
  if (!iso) return 'Never synced'
  const d = new Date(iso)
  const exact = d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const h = Math.floor((Date.now() - d.getTime()) / 3.6e6)
  return `Synced ${exact} · ${h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`}`
}

/** Runs an action with a busy key, reporting success or failure as a toast. */
function useRunner(reload: () => void) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast.show({ message: await fn() }) }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'error' }) }
    finally { setBusy(null); reload() }
  }
  return { busy, run }
}

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Connection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => { api.connections().then(c => { setConns(c); setError(null) }, e => setError(e instanceof Error ? e.message : String(e))) }
  useEffect(load, [])
  const { busy, run } = useRunner(load)
  const others = (conns ?? []).filter(c => !['Garmin', 'GoogleCalendar', 'Hevy', 'AppleHealth'].includes(c.kind))

  return <div className="cn-page">
    <header className="cn-head">
      <h1>Connect</h1>
      <p className="cn-head__sub">Where your data comes from. Sources sync on their own every hour.</p>
    </header>
    <HevyCard />
    <HealthCard />
    <WorkoutHabitsCard />
    <GarminCard />
    <GoogleCard />
    {error && <p className="cn-error" role="alert">Couldn't load the other sources ({error}).</p>}
    {others.length > 0 && <Card title="Other sources" flush>
      <ul className="cn-others">
        {others.map(c => <li key={c.kind}>
          <div className="cn-others__text">
            <span className="cn-others__name">{c.name}</span>
            <span className="cn-muted">{c.status} · {c.records.toLocaleString()} records · {ago(c.lastSyncedAt)}</span>
          </div>
          {c.configured && c.kind !== 'Manual'
            ? <Button size="sm" disabled={busy === c.kind} onClick={() => void run(c.kind, async () => (await api.syncConnection(c.kind)).message)}>{busy === c.kind ? 'Syncing…' : 'Sync'}</Button>
            : <Pill>{c.kind === 'Manual' ? 'Manual' : 'Not connected'}</Pill>}
        </li>)}
      </ul>
    </Card>}
  </div>
}

function SourceCard({ title, sub, connected, children }: { title: string; sub: string; connected: ReactNode; children: ReactNode }) {
  return <Card title={title} aside={connected}>
    <p className="cn-muted cn-sub">{sub}</p>
    {children}
  </Card>
}

type GarminStatus = { configured: boolean; email: string | null; lastSyncedAt: string | null; sampleCount: number }

function GarminCard() {
  const [st, setSt] = useState<GarminStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [days, setDays] = useState(30)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => { api.garminStatus().then(setSt, () => setSt(null)) }
  useEffect(load, [])
  const { busy, run } = useRunner(load)

  const connect = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    void run('connect', async () => { await api.garminConnect(email.trim(), password); setPassword(''); return 'Garmin connected. Sync to pull your history.' })
  }

  return <SourceCard title="Garmin" sub="Steps, sleep, heart rate, stress, Body Battery and weight."
    connected={<Pill tone={st?.configured ? 'good' : undefined}>{st?.configured ? 'Connected' : 'Not connected'}</Pill>}>
    {st?.configured ? <>
      <p className="cn-p">Signed in as <b>{st.email}</b> · {st.sampleCount.toLocaleString()} readings</p>
      <p className="cn-muted">{ago(st.lastSyncedAt)}</p>
      <div className="cn-row">
        <label className="cn-days">Last
          <input className="cn-input cn-input--sm" type="number" min={1} max={365} value={days} onChange={e => setDays(Math.max(1, +e.target.value || 1))} />
          days</label>
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run('sync', async () => { const r = await api.garminSync(days); return `Synced ${r.written} readings from the last ${r.days} days.` })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>
        <Button size="sm" variant="quiet" disabled={!!busy} onClick={() => void run('disconnect', async () => { await api.garminDisconnect(); return 'Disconnected. Saved sign-in removed.' })}>Disconnect</Button>
      </div>
    </> : <form className="cn-form" onSubmit={connect}>
      <label className="ui-sr-only" htmlFor="cn-garmin-email">Garmin email</label>
      <input id="cn-garmin-email" className="cn-input" type="email" placeholder="Garmin email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
      <label className="ui-sr-only" htmlFor="cn-garmin-password">Garmin password</label>
      <input id="cn-garmin-password" className="cn-input" type="password" placeholder="Garmin password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
      <Button type="submit" variant="primary" disabled={busy === 'connect' || !email.trim() || !password}>{busy === 'connect' ? 'Connecting…' : 'Connect Garmin'}</Button>
    </form>}
    <div className="cn-row cn-foot">
      <Button size="sm" variant="quiet" disabled={!!busy} onClick={() => fileRef.current?.click()}>Upload a Garmin CSV export</Button>
      <Button size="sm" variant="quiet" disabled={!!busy} onClick={() => void run('clear', async () => `Cleared ${(await api.garminClearSamples()).deleted} sample rows.`)}>Clear sample data</Button>
      <input ref={fileRef} type="file" accept=".csv" multiple hidden onChange={e => { const f = e.target.files; if (f?.length) void run('upload', async () => (await api.importGarmin(Array.from(f))).message); e.target.value = '' }} />
    </div>
  </SourceCard>
}

type GoogleStatus = { configured: boolean; calendars: { id: string; label: string }[]; lastSyncedAt: string | null; eventCount: number }

function GoogleCard() {
  const [st, setSt] = useState<GoogleStatus | null>(null)
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const load = () => { api.googleStatus().then(setSt, () => setSt(null)) }
  useEffect(load, [])
  const { busy, run } = useRunner(load)
  const cals = st?.calendars ?? []

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    void run('add', async () => { const c = await api.googleAddCalendar(url.trim(), label.trim() || undefined); setUrl(''); setLabel(''); return `Added “${c.label}”.` })
  }

  return <SourceCard title="Google Calendar" sub="Read-only, from each calendar's secret iCal address. Events show on Today and Plan."
    connected={<Pill tone={cals.length ? 'good' : undefined}>{cals.length ? `${cals.length} connected` : 'Not connected'}</Pill>}>
    {cals.length > 0 && <>
      <ul className="cn-cals">
        {cals.map(c => <li key={c.id}>
          <span>{c.label}</span>
          <Button size="sm" variant="quiet" icon="close" disabled={!!busy} aria-label={`Remove ${c.label}`} onClick={() => void run(`rm-${c.id}`, async () => { await api.googleRemoveCalendar(c.id); return `Removed “${c.label}”.` })} />
        </li>)}
      </ul>
      <div className="cn-row">
        <span className="cn-muted">{(st?.eventCount ?? 0).toLocaleString()} events · {ago(st?.lastSyncedAt ?? null)}</span>
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void run('sync', async () => {
          const r = await api.googleSync()
          return r.failures?.length ? `Synced ${r.events} events · ${r.failures.length} failed: ${r.failures.join('; ')}` : `Synced ${r.events} events.`
        })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>
      </div>
    </>}
    <form className="cn-form" onSubmit={add}>
      {cals.length === 0 && <p className="cn-muted">In Google Calendar: Settings → your calendar → <b>Integrate calendar</b> → copy the “Secret address in iCal format” and paste it here.</p>}
      <label className="ui-sr-only" htmlFor="cn-cal-label">Label</label>
      <input id="cn-cal-label" className="cn-input" type="text" placeholder="Label (e.g. Work)" value={label} onChange={e => setLabel(e.target.value)} />
      <label className="ui-sr-only" htmlFor="cn-cal-url">Secret iCal address</label>
      <input id="cn-cal-url" className="cn-input" type="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={e => setUrl(e.target.value)} />
      <Button type="submit" variant={cals.length ? 'ghost' : 'primary'} disabled={busy === 'add' || !url.trim()}>{busy === 'add' ? 'Adding…' : cals.length ? 'Add another calendar' : 'Connect calendar'}</Button>
    </form>
  </SourceCard>
}
