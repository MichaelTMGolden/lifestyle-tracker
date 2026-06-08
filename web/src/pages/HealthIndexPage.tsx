import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type Alert, type MetricPoint, type SleepNight, type Today, type Workout } from '../api'
import { fmtDay } from '../lib'
import {
  AnnotatedLine, mean, movingAvg, pearson, Ring, round, Scatter, Spark, StackedBars, STATUS,
} from '../charts'

// distinct hue per metric (sleep kept teal so it never collides with stress purple)
const C = {
  sleep: '#4fb0c6', stress: '#a974e0', rhr: '#e0697a', hrv: '#74c79a',
  steps: '#d8a24f', weight: '#8aa0b8', calin: '#d8a24f', calout: '#e0697a',
}
const RANGES: [string, number][] = [['2W', 14], ['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365]]

const V = (p: MetricPoint[]) => p.map((x) => x.value)
const D = (p: MetricPoint[]) => p.map((x) => new Date(x.recordedAt))
const tail = <T,>(a: T[], n: number) => (a.length > n ? a.slice(-n) : a)
const latest = (p: MetricPoint[]) => (p.length ? p[p.length - 1].value : null)
const avgLast = (p: MetricPoint[], n: number) => mean(V(p).slice(-n))

interface Trend { recent: number; pct: number; dir: 'up' | 'down' | 'flat'; good: boolean | null }
function trend(p: MetricPoint[], betterHigher: boolean | null): Trend | null {
  const v = V(p); const n = v.length; if (n < 4) return null
  const w = Math.min(14, Math.max(2, Math.floor(n / 2)))
  const recent = mean(v.slice(n - w)); const prior = mean(v.slice(Math.max(0, n - 2 * w), n - w))
  if (!prior) return { recent, pct: 0, dir: 'flat', good: null }
  const pct = ((recent - prior) / prior) * 100
  const dir = Math.abs(pct) < 1.5 ? 'flat' : pct > 0 ? 'up' : 'down'
  const good = betterHigher === null || dir === 'flat' ? null : (pct > 0) === betterHigher
  return { recent, pct, dir, good }
}
function alignPairs(a: MetricPoint[], b: MetricPoint[]) {
  const mb = new Map(b.map((p) => [p.recordedAt.slice(0, 10), p.value]))
  const xs: number[] = [], ys: number[] = []
  for (const p of a) { const k = p.recordedAt.slice(0, 10); if (mb.has(k)) { xs.push(p.value); ys.push(mb.get(k)!) } }
  return { xs, ys }
}

interface Bundle {
  today: Today; sleepScore: MetricPoint[]; stress: MetricPoint[]; rhr: MetricPoint[]
  steps: MetricPoint[]; weight: MetricPoint[]; calIn: MetricPoint[]; active: MetricPoint[]
  protein: MetricPoint[]; carbs: MetricPoint[]; fat: MetricPoint[]
  sleep: SleepNight[]; workouts: Workout[]; keys: string[]; alerts: Alert[]
}

export default function HealthDashboard() {
  const [days, setDays] = useState(30)
  const [b, setB] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wInput, setWInput] = useState('')
  const [xK, setXK] = useState('sleep_score')
  const [yK, setYK] = useState('stress_avg')
  const fetchN = Math.max(days, 28)

  async function load() {
    try {
      const [today, sleepScore, stress, rhr, steps, weight, calIn, active, protein, carbs, fat, sleep, keyList, workouts, alerts] = await Promise.all([
        api.today(),
        api.metric('sleep_score', fetchN), api.metric('stress_avg', fetchN), api.metric('resting_hr', fetchN),
        api.metric('steps', fetchN), api.metric('weight_kg', fetchN), api.metric('calories_in', fetchN),
        api.metric('active_calories', fetchN),
        api.metric('protein_g', fetchN), api.metric('carbs_g', fetchN), api.metric('fat_g', fetchN),
        api.sleep(days), api.metricKeys(), api.workouts(), api.alerts().catch(() => [] as Alert[]),
      ])
      setB({ today, sleepScore, stress, rhr, steps, weight, calIn, active, protein, carbs, fat, sleep, workouts, keys: keyList.map((k) => k.key), alerts })
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => { load() }, [days]) // eslint-disable-line

  async function addWeight() {
    const v = parseFloat(wInput); if (!v || v < 30 || v > 300) return
    await api.addWeight(v); setWInput(''); load()
  }

  if (error) return <p className="error">Couldn't load health data ({error}).</p>
  if (!b) return <p className="muted">Loading…</p>

  // display slices (range drives the page)
  const sleepD = tail(b.sleepScore, days), stressD = tail(b.stress, days), rhrD = tail(b.rhr, days)
  const stepsD = tail(b.steps, days), weightD = tail(b.weight, days)

  // Any real Garmin-sourced signals yet? Drives honest empty states.
  const hasHealth = b.sleepScore.length > 0 || b.rhr.length > 0 || b.stress.length > 0 || b.steps.length > 0
  // Metric keys with an active anomaly alert → show an inline marker on that vital.
  const anomalyKeys = new Set(
    b.alerts.filter((a) => a.kind === 'MetricSpike' || a.kind === 'MetricDrop').map((a) => a.subjectKey),
  )

  // readiness from available signals
  const sleepToday = b.today.lastSleepScore ?? latest(b.sleepScore) ?? 60
  const rhrNow = b.today.restingHr ?? latest(b.rhr) ?? 55
  const stressRecent = avgLast(b.stress, 7)
  const sleepComp = sleepToday
  const rhrComp = Math.max(0, Math.min(100, 100 - (rhrNow - 55) * 8))
  const stressComp = Math.max(0, Math.min(100, 100 - stressRecent))
  const readiness = Math.round(0.45 * sleepComp + 0.25 * rhrComp + 0.30 * stressComp)
  const rLabel = readiness >= 80 ? 'Primed' : readiness >= 65 ? 'Steady' : readiness >= 45 ? 'Strained' : 'Depleted'
  const rColor = readiness >= 80 ? STATUS.good : readiness >= 65 ? '#9fc7b0' : readiness >= 45 ? STATUS.watch : STATUS.off
  const why = [
    sleepToday < 60 ? 'last night’s sleep was poor' : 'sleep is solid',
    stressRecent > 50 ? 'stress is running high' : 'stress is in check',
    rhrNow > 58 ? 'resting HR sits above baseline' : 'resting HR is near baseline',
  ]

  // trends
  const tSleep = trend(b.sleepScore, true), tStress = trend(b.stress, false)
  const tRhr = trend(b.rhr, false), tSteps = trend(b.steps, true), tWeight = trend(b.weight, null)
  const sleep14 = avgLast(b.sleepScore, 14)

  // relationships (range-scoped)
  const rSleepStress = alignPairs(sleepD, stressD)
  const rSleepRhr = alignPairs(sleepD, rhrD)
  const rStepsStress = alignPairs(stepsD, stressD)
  const corr = (p: { xs: number[]; ys: number[] }) => ({ r: pearson(p.xs, p.ys), n: p.xs.length })
  const cSS = corr(rSleepStress), cSR = corr(rSleepRhr), cStS = corr(rStepsStress)

  // explorer
  const EXP: Record<string, { label: string; color: string; pts: MetricPoint[] }> = {
    sleep_score: { label: 'Sleep score', color: C.sleep, pts: sleepD },
    stress_avg: { label: 'Stress', color: C.stress, pts: stressD },
    resting_hr: { label: 'Resting HR', color: C.rhr, pts: rhrD },
    steps: { label: 'Steps', color: C.steps, pts: stepsD },
    weight_kg: { label: 'Weight', color: C.weight, pts: weightD },
    calories_in: { label: 'Calories in', color: C.calin, pts: tail(b.calIn, days) },
  }
  const expPair = alignPairs(EXP[xK].pts, EXP[yK].pts)
  const expR = pearson(expPair.xs, expPair.ys), expN = expPair.xs.length
  const interp = (r: number) => {
    const a = Math.abs(r), s = a < 0.2 ? 'little to no' : a < 0.4 ? 'a weak' : a < 0.6 ? 'a moderate' : 'a strong'
    return `${s} ${r < 0 ? 'negative' : 'positive'} relationship — more ${EXP[xK].label.toLowerCase()} tends to mean ${r < 0 ? 'less' : 'more'} ${EXP[yK].label.toLowerCase()}.`
  }

  // sleep section
  const stageRows = b.sleep.map((n) => ({ deep: n.deep, light: n.light, rem: n.rem, awake: n.awake }))
  const sleepDates = b.sleep.map((n) => new Date(n.date))
  const sleepDebt = Math.round(b.sleep.reduce((s, n) => s + (480 - (n.deep + n.light + n.rem)), 0) / 60)

  // weight + nutrition
  const wMA = movingAvg(V(b.weight), 7)
  const wMAd = tail(wMA, days)
  const calInAvg = Math.round(avgLast(b.calIn, days))
  const activeAvg = Math.round(avgLast(b.active, days))
  const calOutAvg = 1700 + activeAvg // BMR + active
  const calNet = calInAvg - calOutAvg
  const netSeries = tail(b.calIn, days).map((p, i) => { const a = tail(b.active, days)[i]; return p.value - (1700 + (a ? a.value : activeAvg)) })

  // macros (from the materialized nutrition rollup; same generic metric series)
  const PROTEIN_TARGET = 150
  const hasMacros = b.protein.length > 0
  const proteinLatest = latest(b.protein) ?? 0
  const proteinAvg = Math.round(avgLast(b.protein, days))
  const carbsAvg = Math.round(avgLast(b.carbs, days))
  const fatAvg = Math.round(avgLast(b.fat, days))
  const proteinSeries = tail(b.protein, days)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Health</h1>
          <p className="subtitle">Personal intelligence briefing{hasHealth ? '' : ' · connect Garmin to populate health metrics'}</p>
        </div>
        <div className="seg">
          {RANGES.map(([l, dn]) => <button key={dn} className={days === dn ? 'on' : ''} onClick={() => setDays(dn)}>{l}</button>)}
        </div>
      </div>

      {/* ===== readiness hero ===== */}
      <div className="hero-grid">
        <section className="card ring-card">
          {hasHealth ? (
            <>
              <div className="ring-wrap"><Ring value={readiness} color={rColor} /><div className="ring-label"><b>{readiness}</b><span>{rLabel}</span></div></div>
              <div>
                <h2 style={{ margin: '0 0 6px' }}>{rLabel} · readiness {readiness}/100</h2>
                <p className="why">{capitalize(why[0])}, {why[1]}, and {why[2]}. {readiness < 65 ? 'Favour an easier day and protect tonight’s sleep.' : 'Good day to push if you feel it.'}</p>
                <div className="chips">
                  <Chip s={sleepToday >= 70 ? 'good' : sleepToday >= 55 ? 'watch' : 'off'}>Sleep {Math.round(sleepToday)}</Chip>
                  <Chip s={rhrNow <= 58 ? 'good' : 'watch'}>Resting HR {Math.round(rhrNow)} · {rhrNow > 55 ? '+' : ''}{Math.round(rhrNow - 55)} vs base</Chip>
                  <Chip s={stressRecent < 45 ? 'good' : 'watch'}>Stress {Math.round(stressRecent)}</Chip>
                  <Chip s="stub">HRV · awaiting Garmin</Chip>
                  <Chip s="stub">Training load · awaiting Garmin</Chip>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ring-wrap"><div className="ring-label"><b>—</b><span>No data</span></div></div>
              <div>
                <h2 style={{ margin: '0 0 6px' }}>Readiness needs Garmin</h2>
                <p className="why">Connect Garmin so sleep, resting HR and stress flow in — your daily readiness score and trends appear here once they do.</p>
                <div className="chips">
                  <Chip s="stub">Sleep · awaiting Garmin</Chip>
                  <Chip s="stub">Resting HR · awaiting Garmin</Chip>
                  <Chip s="stub">Stress · awaiting Garmin</Chip>
                </div>
              </div>
            </>
          )}
        </section>
        <section className="card stub-card">
          <div className="stub-tag">Awaiting Garmin sync</div>
          <div className="hero-label">Body Battery</div>
          <div className="hero-value muted">—</div>
          <p className="muted" style={{ fontSize: 13 }}>Garmin’s energy reserve (charged/drained today) will appear here once the Health API is connected.</p>
        </section>
      </div>

      {/* ===== vitals ===== */}
      <div className="sec-label">Key vitals · trend vs prior fortnight</div>
      <div className="vitals">
        <Vital to="sleep_score" name="Sleep Score" value={Math.round(sleepToday)} valSub="today"
          sub={`14-day avg ${round(sleep14, 0)}`} target={sleep14 >= 70 ? 'within 70+ target' : 'below 70+ target'}
          tStatus={sleep14 >= 70 ? 'good' : 'off'} t={tSleep} betterHigher anomaly={anomalyKeys.has('sleep_score')}
          spark={<Spark data={V(sleepD)} color={C.sleep} goal={70} />} />
        <Vital to="resting_hr" name="Resting HR" value={Math.round(rhrNow)} valSub="bpm" sub="baseline 55"
          target={rhrNow <= 58 ? 'near baseline' : 'above baseline'} tStatus={rhrNow <= 58 ? 'good' : 'watch'}
          t={tRhr} betterHigher={false} anomaly={anomalyKeys.has('resting_hr')} spark={<Spark data={V(rhrD)} color={C.rhr} baseline={55} />} />
        <StubVital name="HRV" note="awaiting Garmin" />
        <Vital to="stress_avg" name="Stress" value={Math.round(avgLast(b.stress, 14))} valSub="avg" sub="lower is better"
          target={avgLast(b.stress, 14) < 45 ? 'calm' : 'elevated'} tStatus={avgLast(b.stress, 14) < 45 ? 'good' : 'watch'}
          t={tStress} betterHigher={false} anomaly={anomalyKeys.has('stress_avg')} spark={<Spark data={V(stressD)} color={C.stress} />} />
        <Vital to="steps" name="Steps" value={Math.round(avgLast(b.steps, 7)).toLocaleString()} valSub="7-day avg"
          sub="goal 8,000" target={avgLast(b.steps, 7) >= 8000 ? 'at goal' : `${Math.round((1 - avgLast(b.steps, 7) / 8000) * 100)}% under goal`}
          tStatus={avgLast(b.steps, 7) >= 8000 ? 'good' : 'off'} t={tSteps} betterHigher spark={<Spark data={V(stepsD)} color={C.steps} goal={8000} />} />
        <Vital to="weight_kg" name="Weight" value={round(latest(b.weight) ?? 0, 1)} valSub="kg" sub="7-day trend"
          target="tracked" tStatus="good" t={tWeight} betterHigher={false} spark={<Spark data={wMAd} color={C.weight} fill={false} />} />
      </div>

      {/* ===== insights & actions ===== */}
      <div className="sec-label">What the data says</div>
      <section className="card insights">
        <div className="ins-group">
          <h3>Trends</h3>
          {tSleep && <Ins mark={tSleep.good === false ? '!' : '•'} markColor={tSleep.good === false ? STATUS.off : 'var(--dim)'}>
            <b>Sleep {tSleep.dir === 'flat' ? 'steady' : tSleep.dir === 'up' ? 'up' : 'down'} {Math.abs(Math.round(tSleep.pct))}%</b> — averaging {round(sleep14, 0)} vs the prior fortnight{sleep14 < 70 ? ', under the 70+ target' : ''}.
          </Ins>}
          {tStress && <Ins mark={tStress.good === false ? '!' : '•'} markColor={tStress.good === false ? STATUS.off : 'var(--dim)'}>
            <b>Stress {tStress.dir} {Math.abs(Math.round(tStress.pct))}%</b> — now {round(tStress.recent, 0)} on average.
            {tStress.good === false && <Act>Your data says better sleep is the fastest lever to bring it down.</Act>}
          </Ins>}
          {avgLast(b.steps, 7) < 8000 && <Ins mark="!" markColor={STATUS.off}>
            <b>Steps under goal</b> — {Math.round(avgLast(b.steps, 7)).toLocaleString()}/day vs 8,000.
            <Act>A 20-minute walk most days closes most of the gap.</Act>
          </Ins>}
        </div>
        <div className="ins-group">
          <h3>Relationships</h3>
          <Rel c={cSS} pos="More sleep tracks with higher stress — worth a look." neg="Better sleep clearly lowers your stress — your strongest lever." flat="Sleep & stress show little link right now." act="Protect a consistent bedtime." />
          <Rel c={cSR} pos="Better sleep tracks with higher resting HR — unusual." neg="Better sleep tends to lower next-day resting HR." flat="Sleep & resting HR show little link right now." />
          <Rel c={cStS} pos="More steps tracks with higher stress." neg="On higher-step days, stress runs lower." flat="Steps & stress show essentially no link." />
        </div>
      </section>

      {/* ===== correlation explorer ===== */}
      <div className="sec-label">Correlation explorer</div>
      <section className="card">
        <div className="explorer-controls">
          <select value={xK} onChange={(e) => setXK(e.target.value)}>{Object.entries(EXP).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <span className="muted">vs</span>
          <select value={yK} onChange={(e) => setYK(e.target.value)}>{Object.entries(EXP).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <span className="rval" style={{ marginLeft: 'auto' }}>r = <b style={{ color: Math.abs(expR) >= 0.4 ? 'var(--text)' : 'var(--dim)' }}>{round(expR, 2)}</b> · n = {expN}{expN < 40 && <span className="lowconf">low confidence</span>}</span>
        </div>
        <div className="rel-2">
          <Scatter xs={expPair.xs} ys={expPair.ys} xLabel={EXP[xK].label} yLabel={EXP[yK].label} xColor={EXP[xK].color} yColor={EXP[yK].color} />
          <div className="interp">
            {interp(expR)}
            {expN < 40 && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Based on only {expN} overlapping days — treat as a hint, not a finding.</div>}
            {xK === 'sleep_score' && yK === 'stress_avg' && <div className="act" style={{ marginTop: 10 }}>Your strongest relationship — improving sleep is the highest-leverage change you can make.</div>}
          </div>
        </div>
      </section>

      {/* ===== sleep ===== */}
      <div className="sec-label">Sleep</div>
      <div className="rel-13">
        <section className="card">
          <div className="card-h">Sleep stages <span className="muted">· deep / light / REM / awake</span></div>
          <StackedBars dates={sleepDates} data={stageRows} keys={['deep', 'light', 'rem', 'awake']} colors={['#2f6f86', '#4fb0c6', '#a974e0', '#e0697a']} />
          <div className="legend"><span><i style={{ background: '#2f6f86' }} />Deep</span><span><i style={{ background: '#4fb0c6' }} />Light</span><span><i style={{ background: '#a974e0' }} />REM</span><span><i style={{ background: '#e0697a' }} />Awake</span></div>
        </section>
        <section className="card">
          <div className="card-h">Score & debt <span className="muted">· target 70+</span></div>
          <Spark data={V(sleepD)} color={C.sleep} goal={70} h={60} />
          <div style={{ marginTop: 12 }}>
            <div className="stat-line"><span className="muted">Sleep debt (range)</span><b style={{ color: sleepDebt > 0 ? STATUS.off : STATUS.good }}>{sleepDebt > 0 ? `−${sleepDebt}h` : 'on target'}</b></div>
            <div className="stat-line"><span className="muted">Bed/wake consistency</span><b className="muted">awaiting Garmin</b></div>
          </div>
        </section>
      </div>

      {/* ===== recovery & stress ===== */}
      <div className="sec-label">Recovery & stress</div>
      <div className="rel-2">
        <section className="card">
          <div className="card-h">Resting heart rate <span className="muted">· baseline 55</span></div>
          <p className="card-sub">Fitness proxy — the slow trend is what matters. <span className="muted">(event annotations land in Phase 3)</span></p>
          <AnnotatedLine dates={D(rhrD)} data={V(rhrD)} color={C.rhr} baseline={55} unit=" bpm" />
        </section>
        <section className="card stub-card">
          <div className="stub-tag">Awaiting Garmin sync</div>
          <div className="card-h">HRV</div>
          <p className="muted" style={{ fontSize: 13 }}>HRV status (Balanced / Unbalanced / Low) and your personal baseline band will appear here once Garmin HRV data is connected. It’s a key recovery signal.</p>
        </section>
      </div>

      {/* ===== activity ===== */}
      <div className="sec-label">Activity & training</div>
      <div className="rel-13">
        <section className="card">
          <div className="card-h">Recent workouts</div>
          <div style={{ marginTop: 4 }}>
            {b.workouts.slice(0, 6).map((w) => <div className="workout" key={w.id}>
              <span className="w-ico">{ICON[w.type] ?? '•'}</span>
              <div><div>{w.type}</div><div className="muted" style={{ fontSize: 12 }}>{fmtDay(w.startedAt)}</div></div>
              <div className="w-meta">{w.durationMinutes}m{w.calories ? ` · ${w.calories} kcal` : ''}{w.averageHeartRate ? <><br />{w.averageHeartRate} bpm avg</> : null}</div>
            </div>)}
          </div>
        </section>
        <section className="card stub-card">
          <div className="stub-tag">Awaiting Garmin sync</div>
          <div className="card-h">Training status, intensity minutes, VO₂max</div>
          <p className="muted" style={{ fontSize: 13 }}>Acute/chronic load (Productive / Overreaching), weekly intensity minutes vs goal, and VO₂max trend come from Garmin’s training metrics — designed and ready to populate.</p>
        </section>
      </div>

      {/* ===== nutrition ===== */}
      <div className="sec-label">Nutrition · Open Food Facts / USDA</div>
      <div className="rel-2">
        <section className="card">
          <div className="card-h">Calorie balance <span className="muted">· avg over range</span></div>
          <div style={{ display: 'flex', gap: 24, margin: '10px 0 4px', flexWrap: 'wrap' }}>
            <Big label="In (logged)" value={calInAvg.toLocaleString()} color={C.calin} />
            <Big label="Out (Garmin)" value={calOutAvg.toLocaleString()} color={C.calout} />
            <Big label="Net" value={`${calNet > 0 ? '+' : ''}${calNet}`} color={calNet < 0 ? STATUS.good : STATUS.watch} />
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>{calNet < 0 ? `Mild deficit of ${Math.abs(calNet)} kcal/day — consistent with a slow cut.` : 'Slight surplus.'} <span className="muted">Out = est. BMR 1,700 + active.</span> <Link to="/nutrition" style={{ color: C.calin }}>Log food →</Link></p>
          <div className="card-sub" style={{ marginTop: 12 }}>Net balance over range</div>
          <Spark data={netSeries} color={C.calout} baseline={0} h={50} />
        </section>
        {hasMacros ? (
          <section className="card">
            <div className="card-h">Macros <span className="muted">· protein / carbs / fat</span></div>
            <div style={{ display: 'flex', gap: 24, margin: '10px 0 4px', flexWrap: 'wrap' }}>
              <Big label="Protein" value={`${Math.round(proteinLatest)} g`} color={C.rhr} />
              <Big label="Carbs · avg" value={`${carbsAvg} g`} color={C.sleep} />
              <Big label="Fat · avg" value={`${fatAvg} g`} color={C.stress} />
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              Protein vs {PROTEIN_TARGET} g target · {proteinAvg} g avg over range
            </div>
            <div className="macro-target-bar">
              <span style={{ width: `${Math.min(100, Math.round((proteinLatest / PROTEIN_TARGET) * 100))}%`, background: C.rhr }} />
            </div>
            <div className="card-sub" style={{ marginTop: 12 }}>Protein over range</div>
            <Spark data={V(proteinSeries)} color={C.rhr} baseline={PROTEIN_TARGET} h={50} />
          </section>
        ) : (
          <section className="card stub-card">
            <div className="stub-tag">No food logged yet</div>
            <div className="card-h">Macros · protein / carbs / fat</div>
            <p className="muted" style={{ fontSize: 13 }}>Log meals on the <Link to="/nutrition">Nutrition</Link> page and protein-vs-target, carbs and fat light up here — they read the same materialized metrics as every other series.</p>
          </section>
        )}
      </div>

      {/* ===== body composition ===== */}
      <div className="sec-label">Body composition</div>
      <section className="card">
        <div className="card-h">Weight <span className="muted">· daily (noisy) with 7-day moving average</span></div>
        <p className="card-sub">The moving average is the truth; daily readings swing with water & food.</p>
        <WeightChart dates={D(weightD)} daily={V(weightD)} ma={wMAd} color={C.weight} />
        <div className="rel-2" style={{ marginTop: 14 }}>
          <div className="stat-line"><span className="muted">Body fat %</span><b className="muted">— not tracked</b></div>
          <div className="stat-line"><span className="muted">Waist</span><b className="muted">— not tracked</b></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 13 }}>Log today’s weight:</span>
          <input type="number" step="0.1" placeholder="75.9" value={wInput} onChange={(e) => setWInput(e.target.value)} style={{ width: 90 }} />
          <span className="muted">kg</span>
          <button className="btn" onClick={addWeight}>Add</button>
        </div>
      </section>

      <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, margin: '36px 0 0' }}>
        Time range drives every section · modules marked “awaiting sync” populate as Garmin / MyFitnessPal integrations land.
      </div>
    </>
  )
}

const ICON: Record<string, string> = { Run: '🏃', Strength: '🏋', Cycling: '🚴', Swim: '🏊', Walk: '🚶' }
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Chip({ s, children }: { s: 'good' | 'watch' | 'off' | 'stub'; children: ReactNode }) {
  const color = s === 'stub' ? 'var(--text-dim)' : STATUS[s]
  return <span className={s === 'stub' ? 'chip stub' : 'chip'}><span className="dot" style={{ background: color }} />{children}</span>
}

function Vital({ to, name, value, valSub, sub, target, tStatus, t, spark, anomaly }: {
  to: string; name: string; value: string | number; valSub?: string; sub?: string; target?: string
  tStatus?: 'good' | 'watch' | 'off'; t: Trend | null; betterHigher?: boolean | null; spark: ReactNode; anomaly?: boolean
}) {
  return (
    <Link to={`/health/${to}`} className={`card vcard${anomaly ? ' vcard-anomaly' : ''}`}>
      <div className="v-top"><span className="v-name">{name}{anomaly && <span className="v-anomaly" title="Unusual today — see alert">!</span>}</span><TrendBadge t={t} /></div>
      <div className="v-val">{value}{valSub && <small>{valSub}</small>}</div>
      {sub && <div className="v-sub">{sub}</div>}
      {target && <div className="v-target" style={{ color: tStatus ? STATUS[tStatus] : 'var(--dim)' }}>{target}</div>}
      <div className="v-spark">{spark}</div>
    </Link>
  )
}
function StubVital({ name, note }: { name: string; note: string }) {
  return <div className="card vcard stub-card"><div className="stub-tag">{note}</div><div className="v-name">{name}</div><div className="v-val muted">—</div><div className="v-sub muted">not yet connected</div></div>
}
function TrendBadge({ t }: { t: Trend | null }) {
  if (!t || t.dir === 'flat') return <span className="trend" style={{ color: 'var(--dim)' }}>— flat</span>
  const cls = t.good === null ? 'var(--dim)' : t.good ? STATUS.good : STATUS.off
  return <span className="trend" style={{ color: cls }}>{t.dir === 'up' ? '▲' : '▼'} {Math.abs(Math.round(t.pct))}%</span>
}
function Ins({ mark, markColor, children }: { mark: string; markColor: string; children: ReactNode }) {
  return <div className="ins"><span className="mark" style={{ color: markColor }}>{mark}</span><div>{children}</div></div>
}
function Act({ children }: { children: ReactNode }) { return <span className="act">→ {children}</span> }
function Rel({ c, pos, neg, flat, act }: { c: { r: number; n: number }; pos: string; neg: string; flat: string; act?: string }) {
  if (c.n < 4) return <Ins mark="↔" markColor="var(--dim)">Not enough overlapping data yet to read this.</Ins>
  const msg = c.r <= -0.2 ? neg : c.r >= 0.2 ? pos : flat
  const low = c.n < 40
  return <Ins mark="↔" markColor={Math.abs(c.r) >= 0.4 ? STATUS.good : 'var(--dim)'}>
    {msg} <span className="rval">r = {round(c.r, 2)}, n = {c.n}</span>{low && <span className="lowconf">low confidence · {c.n}d</span>}
    {act && Math.abs(c.r) >= 0.4 && <Act>{act}</Act>}
  </Ins>
}
function Big({ label, value, color }: { label: string; value: string; color: string }) {
  return <div><div className="muted" style={{ fontSize: 12 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div></div>
}

function WeightChart({ dates, daily, ma, color }: { dates: Date[]; daily: number[]; ma: number[]; color: string }) {
  if (daily.length < 2) return <div className="muted">Not enough data.</div>
  const W = 720, H = 220, P = { l: 38, r: 14, t: 12, b: 24 }
  const lo = Math.min(...daily) - 0.4, hi = Math.max(...daily) + 0.4
  const X = (i: number) => P.l + i / (daily.length - 1) * (W - P.l - P.r)
  const Y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
  return <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }}>
    {[0, .5, 1].map((f, k) => { const y = P.t + f * (H - P.t - P.b); return <g key={k}><line className="gridline" x1={P.l} x2={W - P.r} y1={y} y2={y} /><text className="axis" x={P.l - 6} y={y + 3} textAnchor="end">{round(hi - (hi - lo) * f, 1)}</text></g> })}
    {daily.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="2" fill={color} opacity=".4" />)}
    <path d={ma.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth="2.4" />
    {[0, Math.floor(daily.length / 2), daily.length - 1].map((i) => <text key={i} className="axis" x={X(i)} y={H - 7} textAnchor="middle">{fmtDay(dates[i].toISOString())}</text>)}
  </svg></div>
}
