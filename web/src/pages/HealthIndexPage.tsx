import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type MetricPoint, type SleepNight, type Today, type Workout } from '../api'
import { fmtDay } from '../lib'
import { AnnotatedLine, Ring, Scatter, Spark, StackedBars } from '../charts'
import { STATUS } from '../chartMath'
import { alignPairs, correlation, isObserved, matchedCalories, rangePoints } from '../healthData'
import './HealthIndexPage.css'

const RANGES: [string, number][] = [['2W', 14], ['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365]]
const METRICS = {
  sleep_score: { label: 'Sleep score', color: '#4fb0c6', unit: '/ 100' },
  resting_hr: { label: 'Resting heart rate', color: '#e0697a', unit: 'bpm' },
  stress_avg: { label: 'Stress', color: '#a974e0', unit: '/ 100' },
  steps: { label: 'Steps', color: '#d8a24f', unit: 'steps' },
  weight_kg: { label: 'Weight', color: '#8aa0b8', unit: 'kg' },
  calories_in: { label: 'Calories logged', color: '#d8a24f', unit: 'kcal' },
  active_calories: { label: 'Active calories', color: '#e0697a', unit: 'kcal' },
  protein_g: { label: 'Protein', color: '#e0697a', unit: 'g' },
  carbs_g: { label: 'Carbohydrates', color: '#4fb0c6', unit: 'g' },
  fat_g: { label: 'Fat', color: '#a974e0', unit: 'g' },
}
type MetricKey = keyof typeof METRICS
const KEYS = Object.keys(METRICS) as MetricKey[]
const VITALS: MetricKey[] = ['sleep_score', 'resting_hr', 'stress_avg', 'steps', 'weight_kg']
const EXPLORER: MetricKey[] = [...VITALS, 'calories_in']
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const display = (value: number | null, digits = 0) => value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits })
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
interface Bundle { today: Today; metrics: Record<MetricKey, MetricPoint[]>; sleep: SleepNight[]; workouts: Workout[] }

export default function HealthDashboard() {
  const [days, setDays] = useState(30)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [weight, setWeight] = useState('')
  const [saving, setSaving] = useState(false)
  const [weightStatus, setWeightStatus] = useState('')
  const [xKey, setXKey] = useState<MetricKey>('sleep_score')
  const [yKey, setYKey] = useState<MetricKey>('stress_avg')

  function load() { setLoading(true); setRefresh(value => value + 1) }
  useEffect(() => {
    let cancelled = false
    Promise.all([api.today(), api.sleep(days), api.workouts(), ...KEYS.map(key => api.metric(key, days + 1))])
      .then(([today, sleep, workouts, ...series]) => {
      if (cancelled) return
      const metrics = Object.fromEntries(KEYS.map((key, i) => [key, rangePoints(series[i], days, todayKey())])) as Bundle['metrics']
      setBundle({ today, sleep, workouts, metrics }); setError(null)
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days, refresh])

  async function addWeight(e: FormEvent) {
    e.preventDefault()
    const value = Number(weight)
    if (!Number.isFinite(value) || value < 30 || value > 300 || saving) return
    setSaving(true); setWeightStatus('')
    try { await api.addWeight(value); setWeight(''); setWeightStatus('Weight saved.'); load() }
    catch (e) { setWeightStatus(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const header = <div className="page-head"><div><h1>Health</h1><p className="subtitle">Recent measurements, patterns and your personal targets.</p></div>
    <div className="health-page-actions"><Link to="/settings">Edit targets</Link><div className="seg" aria-label="Health date range">
      {RANGES.map(([label, count]) => <button key={count} className={days === count ? 'on' : ''} aria-pressed={days === count} onClick={() => { if (days !== count) setLoading(true); setDays(count) }}>{label}</button>)}
    </div></div></div>
  if (!bundle) return <>{header}{error ? <div className="error" role="alert">Couldn't load health data. <button className="link-btn" onClick={load}>Try again</button><p>{error}</p></div> : <p className="muted" role="status">Loading health data…</p>}</>

  const { today, metrics: m } = bundle
  const settings = today.settings
  const readiness = today.readiness
  const components = today.readinessComponents
  const color = readiness === null ? 'var(--text-dim)' : readiness >= 65 ? STATUS.good : readiness >= 45 ? STATUS.watch : STATUS.off
  const pair = alignPairs(m[xKey], m[yKey])
  const r = xKey === yKey ? null : correlation(pair.xs, pair.ys)
  const balances = matchedCalories(m.calories_in, m.active_calories, settings.restingCaloriesEstimate)
  const net = average(balances.map(day => day.net))
  const input = average(balances.map(day => day.intake))
  const output = average(balances.map(day => day.output))
  const hasDerived = Object.values(m).some(points => points.some(point => !isObserved(point)))
  const rangeStart = new Date(`${todayKey()}T12:00:00Z`); rangeStart.setUTCDate(rangeStart.getUTCDate() - days + 1)
  const sleepNights = bundle.sleep.filter(night => night.date >= rangeStart.toISOString().slice(0, 10) && night.date <= todayKey() && (night.hasCompleteStages || night.deep + night.light + night.rem > 0))
  const completeNights = sleepNights.filter(night => night.hasCompleteStages)
  const sleepSources = [...new Set(sleepNights.flatMap(night => night.sources ?? []))]
  const deficit = completeNights.length ? Math.round(completeNights.reduce((total, night) => total + Math.max(0, settings.sleepMinutesTarget - night.deep - night.light - night.rem), 0) / 60) : null
  const workouts = bundle.workouts.filter(workout => workout.startedAt.slice(0, 10) >= rangeStart.toISOString().slice(0, 10) && workout.startedAt.slice(0, 10) <= todayKey())

  return <div className="health-page">{header}
    {error && <div className="error" role="alert">The latest refresh failed. Showing the last loaded data. <button className="link-btn" onClick={load}>Retry</button></div>}
    {loading && <p className="muted" role="status">Refreshing health data…</p>}
    <section className="card ring-card">
      <div className="ring-wrap">{readiness !== null && <Ring value={readiness} color={color} />}<div className="ring-label"><b>{readiness ?? '—'}</b><span>{today.readinessLabel}</span></div></div>
      <div><h2>Daily readiness</h2>
        <p className="why">{readiness === null ? 'A score needs observed sleep, resting heart rate and stress from today or yesterday.' : 'An estimate based on your recent sleep, resting heart rate and stress.'}</p>
        <div className="health-readiness-signals">{components.map(component => <div key={component.key}>
          <b>{component.label}</b><span>{component.value === null ? 'No measurement' : display(component.value, 1)}{component.key === 'resting_hr' && component.value !== null ? ' bpm' : ''}</span>
          <small>{component.recordedAt ? `${fmtDay(component.recordedAt)} · ` : ''}{component.status === 'fresh' ? 'used in score' : `${component.status} · excluded`}</small>
        </div>)}</div>
        <p className="muted health-note">The same estimate appears on Today. Resting heart rate reference: {settings.restingHrBaseline} bpm. Missing or older signals never receive substitute values.</p>
      </div>
    </section>
    {hasDerived && <p className="health-data-note">Some historical records are sample or derived data. They are labelled below and excluded from readiness, relationships and calorie comparisons.</p>}

    <div className="sec-label">Latest measurements in this range</div>
    <div className="vitals">{VITALS.map(key => {
      const points = m[key], last = points.at(-1), meta = METRICS[key]
      const target = key === 'steps' ? settings.stepsTarget : key === 'sleep_score' ? settings.sleepScoreTarget : key === 'resting_hr' ? settings.restingHrBaseline : undefined
      return <Link key={key} to={`/health/${key}`} className="card vcard">
        <div className="v-name">{meta.label}</div><div className="v-val">{display(last?.value ?? null, key === 'weight_kg' ? 1 : 0)}<small>{meta.unit}</small></div>
        <div className="v-sub">{last ? `${fmtDay(last.recordedAt)}${!isObserved(last) ? ' · sample / derived' : ''}` : 'No recorded measurement'}</div>
        {last?.sourceName && <div className="v-sub">{last.sourceName}</div>}
        {target !== undefined && <div className="v-target">{key === 'resting_hr' ? 'Baseline' : 'Target'} {target.toLocaleString()}</div>}
        <div className="v-spark"><Spark data={points.map(point => point.value)} color={meta.color} goal={target} /></div>
      </Link>
    })}</div>

    <div className="sec-label">Explore relationships</div>
    <section className="card">
      <div className="explorer-controls"><label className="health-select-label">First metric<select value={xKey} onChange={e => setXKey(e.target.value as MetricKey)}>{EXPLORER.map(key => <option key={key} value={key}>{METRICS[key].label}</option>)}</select></label>
        <span className="muted">vs</span><label className="health-select-label">Second metric<select value={yKey} onChange={e => setYKey(e.target.value as MetricKey)}>{EXPLORER.map(key => <option key={key} value={key}>{METRICS[key].label}</option>)}</select></label>
        <span className="rval">{r === null ? 'r unavailable' : `r = ${r.toFixed(2)}`} · {pair.xs.length} matched days</span>
      </div>
      <div className="rel-2"><Scatter xs={pair.xs} ys={pair.ys} xLabel={METRICS[xKey].label} yLabel={METRICS[yKey].label} xColor={METRICS[xKey].color} yColor={METRICS[yKey].color} />
        <div className="interp">{xKey === yKey ? 'Choose two different metrics to compare them.' : r === null ? 'At least four matched days with variation in both metrics are needed for a correlation.' : Math.abs(r) < .2 ? 'These measurements show little linear association in this range.' : `${METRICS[xKey].label} and ${METRICS[yKey].label.toLowerCase()} show a ${r < 0 ? 'negative' : 'positive'} association in this range.`}
          <p className="muted health-note">Only observed records from the same date are paired. An association does not establish a cause or identify which change would help.</p>
          {r !== null && pair.xs.length < 40 && <p className="muted health-note">Limited history: this pattern may change as more days are recorded.</p>}
        </div>
      </div>
    </section>

    <div className="sec-label">Sleep & recovery</div>
    <div className="rel-2"><section className="card"><h2>Sleep stages</h2>
      <StackedBars dates={sleepNights.map(night => new Date(night.date))} data={sleepNights.map(night => ({ deep: night.deep, light: night.light, rem: night.rem, awake: night.awake }))} keys={['deep', 'light', 'rem', 'awake']} colors={['#2f6f86', '#4fb0c6', '#a974e0', '#e0697a']} />
      <div className="legend"><span><i style={{ background: '#2f6f86' }} />Deep</span><span><i style={{ background: '#4fb0c6' }} />Light</span><span><i style={{ background: '#a974e0' }} />REM</span><span><i style={{ background: '#e0697a' }} />Awake</span></div>
      <p className="muted health-note">{deficit === null ? 'Full-night comparisons need deep, light and REM measurements.' : `${completeNights.length} complete recorded nights · ${deficit} hours below your ${settings.sleepMinutesTarget}-minute target across shorter nights.`} Missing stages are excluded from this comparison.{sleepSources.length > 0 && ` Sources: ${sleepSources.join(', ')}.`}</p>
    </section><section className="card"><h2>Resting heart rate</h2><p className="card-sub">Your reference: {settings.restingHrBaseline} bpm. Dates and data sources are available in the detailed metric view.</p>
      {m.resting_hr.length > 1 ? <AnnotatedLine dates={m.resting_hr.map(point => new Date(point.recordedAt))} data={m.resting_hr.map(point => point.value)} color={METRICS.resting_hr.color} baseline={settings.restingHrBaseline} unit=" bpm" /> : <p className="muted">At least two readings are needed to show a trend.</p>}
    </section></div>

    <div className="sec-label">Nutrition</div>
    <div className="rel-2"><section className="card"><h2>Estimated calorie comparison</h2>
      <div className="health-stats"><Stat label="Logged intake" value={display(input)} /><Stat label="Estimated expenditure" value={display(output)} /><Stat label="Logged intake − estimate" value={net === null ? '—' : `${net > 0 ? '+' : ''}${display(net)}`} /></div>
      <p className="muted health-note">{balances.length ? `Averages from ${balances.length} dates with both food and activity records.` : 'Needs food and activity records on the same date.'} Expenditure uses your {settings.restingCaloriesEstimate.toLocaleString()} kcal resting estimate plus recorded activity. Incomplete food logs can understate intake.</p>
      <Spark data={balances.map(day => day.net)} color={METRICS.active_calories.color} baseline={0} h={50} />
      <Link to="/nutrition">Open food log →</Link>
    </section><section className="card"><h2>Macros on logged days</h2>
      <div className="health-stats">{(['protein_g', 'carbs_g', 'fat_g'] as const).map((key, i) => <Stat key={key} label={`${METRICS[key].label} · avg`} value={`${display(average(m[key].filter(isObserved).map(point => point.value)))} g`} sub={`Target ${[settings.proteinGTarget, settings.carbsGTarget, settings.fatGTarget][i]} g`} />)}</div>
      <p className="muted health-note">Averages use days with logged values. A missing entry is not counted as zero.</p>
      <Spark data={m.protein_g.filter(isObserved).map(point => point.value)} color={METRICS.protein_g.color} goal={settings.proteinGTarget} h={50} />
    </section></div>

    <div className="sec-label">Weight & activity</div>
    <div className="rel-2"><section className="card"><h2>Weight</h2>
      {m.weight_kg.length > 1 ? <WeightTrend points={m.weight_kg} /> : <p className="muted">At least two readings are needed to show a trend.</p>}
      <form className="health-weight-form" onSubmit={addWeight}><label>Today's weight (kg)<input type="number" required min="30" max="300" step="0.1" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} /></label><button className="btn" type="submit" disabled={saving || !weight}>{saving ? 'Saving…' : 'Save weight'}</button></form>
      {weightStatus && <p className="muted" role="status">{weightStatus}</p>}
    </section><section className="card"><h2>Recent workouts</h2>
      {!workouts.length && <p className="muted">No workouts recorded in this range.</p>}
      {workouts.slice(0, 6).map(workout => <div className="workout" key={workout.id}><div>{workout.type}<div className="muted">{fmtDay(workout.startedAt)}</div></div><div className="w-meta">{workout.durationMinutes} min{workout.calories !== null && ` · ${workout.calories} kcal`}</div></div>)}
    </section></div>
  </div>
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="muted">{label}</div><strong>{value}</strong>{sub && <small>{sub}</small>}</div>
}

function WeightTrend({ points }: { points: MetricPoint[] }) {
  const [smooth, setSmooth] = useState(true)
  const values = points.map((point, index) => {
    if (!smooth) return point.value
    const since = new Date(point.recordedAt.slice(0, 10)); since.setUTCDate(since.getUTCDate() - 6)
    const window = points.slice(0, index + 1).filter(previous => previous.recordedAt.slice(0, 10) >= since.toISOString().slice(0, 10))
    return average(window.map(previous => previous.value))!
  })
  return <><div className="seg" aria-label="Weight chart display"><button type="button" className={smooth ? 'on' : ''} aria-pressed={smooth} onClick={() => setSmooth(true)}>7-day average</button><button type="button" className={!smooth ? 'on' : ''} aria-pressed={!smooth} onClick={() => setSmooth(false)}>Daily readings</button></div>
    <p className="card-sub">{smooth ? 'Average of recorded weights in the preceding seven calendar days.' : 'Daily weight can vary with hydration and food.'}</p>
    <AnnotatedLine dates={points.map(point => new Date(point.recordedAt))} data={values} color={METRICS.weight_kg.color} unit=" kg" />
  </>
}
