import { useEffect, useState, type FormEvent } from 'react'
import { settingsApi, type DashboardSettings } from '../settings'
import './SettingsPage.css'

type Field = { key: keyof DashboardSettings; label: string; unit: string; min: number; max: number }
const groups: { title: string; note: string; fields: Field[] }[] = [
  { title: 'Nutrition', note: 'Targets apply to your logged food. Missing food entries are not treated as a complete day.', fields: [
    { key: 'caloriesTarget', label: 'Calories', unit: 'kcal / day', min: 500, max: 10000 },
    { key: 'proteinGTarget', label: 'Protein', unit: 'g / day', min: 1, max: 1000 },
    { key: 'carbsGTarget', label: 'Carbohydrates', unit: 'g / day', min: 1, max: 1500 },
    { key: 'fatGTarget', label: 'Fat', unit: 'g / day', min: 1, max: 1000 },
    { key: 'restingCaloriesEstimate', label: 'Resting energy estimate', unit: 'kcal / day', min: 500, max: 5000 },
  ] },
  { title: 'Activity & recovery', note: 'The resting heart rate baseline is your own reference. Readiness uses recent measurements and is a descriptive estimate.', fields: [
    { key: 'stepsTarget', label: 'Steps', unit: 'steps / day', min: 100, max: 100000 },
    { key: 'sleepMinutesTarget', label: 'Sleep duration', unit: 'minutes / night', min: 60, max: 960 },
    { key: 'sleepScoreTarget', label: 'Sleep score', unit: 'out of 100', min: 1, max: 100 },
    { key: 'restingHrBaseline', label: 'Resting heart rate baseline', unit: 'bpm', min: 20, max: 150 },
  ] },
  { title: 'Artist milestones', note: 'These targets appear alongside your audience metrics. Enter 0 for no target.', fields: [
    { key: 'artistMonthlyListenersTarget', label: 'Monthly listeners', unit: 'listeners', min: 0, max: 2147483647 },
    { key: 'artistFollowersTarget', label: 'Followers', unit: 'followers', min: 0, max: 2147483647 },
    { key: 'artistTotalStreamsTarget', label: 'Total streams', unit: 'streams', min: 0, max: 2147483647 },
  ] },
]

export default function SettingsPage() {
  const [value, setValue] = useState<DashboardSettings | null>(null)
  const [savedValue, setSavedValue] = useState<DashboardSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  async function load() {
    try { const data = await settingsApi.get(); setValue(data); setSavedValue(data); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    let cancelled = false
    settingsApi.get().then(data => { if (!cancelled) { setValue(data); setSavedValue(data); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])
  const dirty = JSON.stringify(value) !== JSON.stringify(savedValue)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!value || saving) return
    setSaving(true); setError(null); setSaved(false)
    try { const data = await settingsApi.save(value); setValue(data); setSavedValue(data); setSaved(true) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }
  return <div className="settings-page">
    <div className="page-head"><div><h1>Personal settings</h1><p className="subtitle">Your targets, shared across the dashboard.</p></div></div>
    <p className="muted">Starting values are editable estimates. Choose targets and baselines that reflect your own plan.</p>
    {error && <div className="error" role="alert">{error} {!value && <button className="link-btn" onClick={load}>Try again</button>}</div>}
    {!value && !error && <p className="muted" role="status">Loading settings…</p>}
    {value && <form onSubmit={save}>
      <fieldset disabled={saving}>
        {groups.map(group => <section className="card" key={group.title}>
          <h2>{group.title}</h2><p className="muted">{group.note}</p>
          <div className="settings-fields">{group.fields.map(field => <label key={field.key}>
            <span>{field.label}</span>
            <input type="number" inputMode="numeric" required step="1" min={field.min} max={field.max}
              value={Number.isNaN(value[field.key]) ? '' : value[field.key]}
              onChange={e => { setSaved(false); setValue({ ...value, [field.key]: e.target.value === '' ? NaN : Number(e.target.value) }) }} />
            <small>{field.unit}</small>
          </label>)}</div>
        </section>)}
      </fieldset>
      <div className="settings-actions">
        <button className="btn" disabled={saving || !dirty} type="submit">{saving ? 'Saving…' : 'Save settings'}</button>
        <button className="btn secondary" type="button" disabled={saving || !dirty} onClick={() => { setValue(savedValue); setSaved(false); setError(null) }}>Undo changes</button>
        <span role="status" aria-live="polite">{saved ? 'Settings saved.' : dirty ? 'You have unsaved changes.' : ''}</span>
      </div>
    </form>}
  </div>
}
