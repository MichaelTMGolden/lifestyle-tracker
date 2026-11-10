// Workouts: Hevy (lifting, pulled with your Hevy Pro key), Apple Health (runs and
// anything else, pushed from your phone by Health Auto Export or a Shortcut), and
// which habit each kind of workout ticks.
import { useEffect, useState, type FormEvent } from 'react'
import { api, type Habit, type WorkoutHabits } from '../../api'
import { Button, Card, Pill } from '../../ui'
import { useToast } from '../../ui/hooks'

const ago = (iso: string | null, never: string) => {
  if (!iso) return never
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3.6e6)
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}
const workouts = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'workout' : 'workouts'}`
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export function HevyCard() {
  const toast = useToast()
  const [st, setSt] = useState<{ connected: boolean; lastSyncedAt: string | null; workouts: number } | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => { api.hevyStatus().then(setSt, () => setSt(null)) }
  useEffect(load, [])
  const act = async (fn: () => Promise<string>) => {
    setBusy(true)
    try { toast.show({ message: await fn() }) } catch (e) { toast.show({ message: message(e), tone: 'error' }) }
    finally { setBusy(false); load() }
  }
  const summary = (r: { created: number; updated: number; deleted: number }) =>
    r.created + r.updated + r.deleted === 0 ? 'Hevy is up to date.' : `Hevy: ${r.created} new, ${r.updated} updated${r.deleted ? `, ${r.deleted} removed` : ''}.`
  const connect = (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    void act(async () => { const r = await api.hevyConnect(key.trim()); setKey(''); return `Hevy connected. ${summary(r)}` })
  }

  return <Card title="Hevy" aside={<Pill tone={st?.connected ? 'good' : undefined}>{st?.connected ? 'Connected' : 'Not connected'}</Pill>}>
    <p className="cn-muted cn-sub">Lifting workouts with every set, rep and weight. Needs Hevy Pro.</p>
    {st?.connected ? <>
      <p className="cn-p">{workouts(st.workouts)} · synced {ago(st.lastSyncedAt, 'never')}</p>
      <div className="cn-row">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(async () => summary(await api.hevySync()))}>{busy ? 'Syncing…' : 'Sync now'}</Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => void act(async () => { await api.hevyDisconnect(); return 'Hevy disconnected. Imported workouts stay.' })}>Disconnect</Button>
      </div>
    </> : <form className="cn-form" onSubmit={connect}>
      <p className="cn-muted">On the web at <a href="https://hevy.com/settings?developer" target="_blank" rel="noreferrer">hevy.com/settings?developer</a>, copy your API key and paste it here. It's stored encrypted and only used to read your workouts.</p>
      <label className="ui-sr-only" htmlFor="cn-hevy-key">Hevy API key</label>
      <input id="cn-hevy-key" className="cn-input" type="password" autoComplete="off" placeholder="Hevy API key" value={key} onChange={e => setKey(e.target.value)} />
      <Button type="submit" variant="primary" disabled={busy || !key.trim()}>{busy ? 'Connecting…' : 'Connect Hevy'}</Button>
    </form>}
  </Card>
}

export function HealthCard() {
  const toast = useToast()
  const [st, setSt] = useState<{ hasKey: boolean; lastReceivedAt: string | null; workouts: number; path: string } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => { api.healthStatus().then(setSt, () => setSt(null)) }
  useEffect(load, [])
  const url = `${window.location.origin}${st?.path ?? '/api/ingest/workouts'}`
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => toast.show({ message: `${what} copied` }), () => toast.show({ message: `Couldn't copy; select it instead.`, tone: 'error' })) }
  async function newKey() {
    if (st?.hasKey && !confirm('Make a new key? The old one stops working, so update it on your phone too.')) return
    setBusy(true)
    try { setFresh((await api.healthNewKey()).key); load() } catch (e) { toast.show({ message: message(e), tone: 'error' }) } finally { setBusy(false) }
  }
  async function revoke() {
    if (!confirm('Turn off uploads? Your phone will be refused until you make a new key. Workouts already received stay.')) return
    setBusy(true)
    try { await api.healthRevokeKey(); setFresh(null); load() } catch (e) { toast.show({ message: message(e), tone: 'error' }) } finally { setBusy(false) }
  }

  return <Card title="Apple Health" aside={<Pill tone={st?.hasKey ? 'good' : undefined}>{st?.hasKey ? 'Receiving' : 'Off'}</Pill>}>
    <p className="cn-muted cn-sub">Runs, walks and any workout on your iPhone (from Strava, the Workout app or a watch), sent here by your phone.</p>
    {st?.hasKey && <p className="cn-p">{workouts(st.workouts)} · last received {ago(st.lastReceivedAt, 'not yet')}</p>}
    {fresh && <div className="cn-key" role="status">
      <p><b>Your upload key</b>, shown only now. Copy it into the app on your phone.</p>
      <code className="cn-code">{fresh}</code>
      <Button size="sm" onClick={() => copy(fresh, 'Key')}>Copy key</Button>
    </div>}
    <details className="cn-steps" open={!st?.hasKey || !!fresh}>
      <summary>How to set it up on your iPhone</summary>
      <ol>
        <li>In Strava (if you use it), connect <b>Apple Health</b> in its settings so your runs are saved to Health.</li>
        <li>Install <b>Health Auto Export</b> from the App Store and allow it to read <b>Workouts</b>.</li>
        <li>In it: <b>Automations → New → REST API</b>.
          <ul>
            <li>URL: <code className="cn-code">{url}</code> <Button size="sm" variant="quiet" onClick={() => copy(url, 'Address')}>Copy</Button></li>
            <li>Data type: <b>Workouts</b>; format <b>JSON</b>, version <b>2</b>; period <b>Since last sync</b>.</li>
            <li>HTTP header: key <code className="cn-code">Authorization</code>, value <code className="cn-code">Bearer</code> then a space and your upload key.</li>
            <li>Turn it on and choose how often (hourly is plenty).</li>
          </ul>
        </li>
        <li>Run it once by hand: your workouts appear here and in Stats.</li>
      </ol>
    </details>
    <div className="cn-row">
      <Button size="sm" variant={st?.hasKey ? 'quiet' : 'primary'} disabled={busy} onClick={() => void newKey()}>{st?.hasKey ? 'Make a new key' : 'Make an upload key'}</Button>
      {st?.hasKey && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void revoke()}>Turn off uploads</Button>}
    </div>
  </Card>
}

export function WorkoutHabitsCard() {
  const toast = useToast()
  const [habits, setHabits] = useState<Habit[]>([])
  const [map, setMap] = useState<WorkoutHabits | null>(null)
  useEffect(() => { api.habits().then(setHabits, () => {}); api.workoutHabits().then(setMap, () => {}) }, [])
  async function change(kind: keyof WorkoutHabits, value: string) {
    if (!map) return
    const next = { ...map, [kind]: value ? Number(value) : null }
    setMap(next)
    try { await api.setWorkoutHabits(next); toast.show({ message: 'Saved' }) }
    catch (e) { toast.show({ message: message(e), tone: 'error' }); setMap(map) }
  }
  const row = (kind: keyof WorkoutHabits, label: string) => <label className="cn-map">
    <span>{label}</span>
    <select className="cn-input cn-input--sm" value={map?.[kind] ?? ''} disabled={!map} onChange={e => void change(kind, e.target.value)}>
      <option value="">Nothing</option>
      {habits.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
    </select>
  </label>
  return <Card title="Workouts tick habits">
    <p className="cn-muted cn-sub">A new workout from Hevy or Apple Health marks this habit done that day (adding its minutes to a timed habit), so it counts for streaks and XP. Only workouts from the last 7 days.</p>
    <div className="cn-maps">
      {row('strength', 'Lifting')}
      {row('run', 'Runs')}
      {row('other', 'Other workouts')}
    </div>
  </Card>
}
