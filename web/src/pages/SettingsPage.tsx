// Settings: targets and baselines shared across the dashboard, and a full data export.
import { useEffect, useState, type FormEvent } from 'react'
import { Collapsible } from '../components/Collapsible'
import { settingsApi, type DashboardSettings } from '../settings'
import { Button, Card } from '../ui'
import { useToast } from '../ui/hooks'
import './SettingsPage.css'

type Field = { key: keyof DashboardSettings; label: string; unit: string; min: number; max: number }
type Group = { title: string; note: string; fields: Field[] }

const active: Group = { title: 'Activity & recovery', note: 'Used on Health and Today. The resting heart rate baseline is your own reference; readiness is a descriptive estimate.', fields: [
  { key: 'stepsTarget', label: 'Steps', unit: 'per day', min: 100, max: 100000 },
  { key: 'sleepMinutesTarget', label: 'Sleep', unit: 'minutes a night', min: 60, max: 960 },
  { key: 'sleepScoreTarget', label: 'Sleep score', unit: 'out of 100', min: 1, max: 100 },
  { key: 'restingHrBaseline', label: 'Resting HR baseline', unit: 'bpm', min: 20, max: 150 },
] }
// Their pages are hidden in v2, but the settings (and data) are kept.
const hidden: Group[] = [
  { title: 'Nutrition', note: 'Targets for logged food.', fields: [
    { key: 'caloriesTarget', label: 'Calories', unit: 'kcal a day', min: 500, max: 10000 },
    { key: 'proteinGTarget', label: 'Protein', unit: 'g a day', min: 1, max: 1000 },
    { key: 'carbsGTarget', label: 'Carbohydrates', unit: 'g a day', min: 1, max: 1500 },
    { key: 'fatGTarget', label: 'Fat', unit: 'g a day', min: 1, max: 1000 },
    { key: 'restingCaloriesEstimate', label: 'Resting energy', unit: 'kcal a day', min: 500, max: 5000 },
  ] },
  { title: 'Artist milestones', note: 'Enter 0 for no target.', fields: [
    { key: 'artistMonthlyListenersTarget', label: 'Monthly listeners', unit: 'listeners', min: 0, max: 2147483647 },
    { key: 'artistFollowersTarget', label: 'Followers', unit: 'followers', min: 0, max: 2147483647 },
    { key: 'artistTotalStreamsTarget', label: 'Total streams', unit: 'streams', min: 0, max: 2147483647 },
  ] },
]

export default function SettingsPage() {
  const toast = useToast()
  const [value, setValue] = useState<DashboardSettings | null>(null)
  const [savedValue, setSavedValue] = useState<DashboardSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = () => settingsApi.get().then(d => { setValue(d); setSavedValue(d); setError(null) }, e => setError(e instanceof Error ? e.message : String(e)))
  useEffect(() => {
    let live = true
    settingsApi.get().then(d => { if (live) { setValue(d); setSavedValue(d) } }, e => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  const dirty = JSON.stringify(value) !== JSON.stringify(savedValue)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!value || saving) return
    setSaving(true); setError(null)
    try { const d = await settingsApi.save(value); setValue(d); setSavedValue(d); toast.show({ message: 'Settings saved.' }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSaving(false) }
  }

  const fields = (g: Group) => <div className="st-fields">{g.fields.map(f => <label key={f.key} className="st-field">
    <span>{f.label}</span>
    <input className="st-input" type="number" inputMode="numeric" required step="1" min={f.min} max={f.max}
      value={!value || Number.isNaN(value[f.key]) ? '' : value[f.key]}
      onChange={e => value && setValue({ ...value, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })} />
    <small>{f.unit}</small>
  </label>)}</div>

  return <div className="st-page">
    <header className="st-head">
      <h1>Settings</h1>
      <p className="st-head__sub">Your targets and baselines. Starting values are estimates; set your own.</p>
    </header>
    {error && <p className="st-error" role="alert">{error} {!value && <Button size="sm" variant="quiet" onClick={() => void load()}>Try again</Button>}</p>}
    {!value && !error && <p className="st-muted" role="status">Loading settings…</p>}
    {value && <form className="st-form" onSubmit={save}>
      <fieldset disabled={saving}>
        <Card title={active.title}><p className="st-muted">{active.note}</p>{fields(active)}</Card>
        <Collapsible title="Hidden features" storageKey="settings.hidden-features">
          <p className="st-muted">Nutrition and Artist are hidden in this version of the dashboard. Their data and targets are kept.</p>
          {hidden.map(g => <Card key={g.title} title={g.title}><p className="st-muted">{g.note}</p>{fields(g)}</Card>)}
        </Collapsible>
      </fieldset>
      <div className="st-actions">
        <Button type="submit" variant="primary" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button variant="quiet" disabled={saving || !dirty} onClick={() => { setValue(savedValue); setError(null) }}>Undo changes</Button>
        <span className="st-muted" role="status" aria-live="polite">{dirty ? 'Unsaved changes' : ''}</span>
      </div>
    </form>}
    <Card title="Your data">
      <p className="st-muted">Download a complete copy of everything the dashboard holds: habits and logs, timers, goals, challenges, tasks, calendar and health data. Saved connection passwords are left out.</p>
      <a className="ui-btn ui-btn--ghost ui-btn--sm st-download" href="/api/export" download>Download my data (JSON)</a>
    </Card>
  </div>
}
