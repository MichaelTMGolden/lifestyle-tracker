// Health: today's readiness and its inputs, trends from Garmin, and the weekly
// summary (written by the server every Monday when an Anthropic key is set).
import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ReviewOutput, type WeeklyReview } from '../api'
import { dateKey } from '../dailyPlanning'
import { useTodayBundle } from '../todayData'
import { Button, Card, Pill, Ring, SectionHead, Skeleton, Spark, Stat, Tabs } from '../ui'
import { useToast } from '../ui/hooks'
import { ageDays, ago, daily, observed, trend } from './health/data'
import './health/health.css'

const METRICS = [
  { key: 'sleep_score', label: 'Sleep score', fmt: (v: number) => Math.round(v).toString(), unit: '', better: 'up' },
  { key: 'resting_hr', label: 'Resting HR', fmt: (v: number) => Math.round(v).toString(), unit: 'bpm', better: 'down' },
  { key: 'sleep_total_min', label: 'Sleep', fmt: (v: number) => `${Math.floor(v / 60)}h ${Math.round(v % 60)}m`, unit: '', better: 'up' },
  { key: 'steps', label: 'Steps', fmt: (v: number) => Math.round(v).toLocaleString(), unit: '', better: 'up' },
  { key: 'stress_avg', label: 'Stress', fmt: (v: number) => Math.round(v).toString(), unit: 'avg', better: 'down' },
  { key: 'body_battery', label: 'Body Battery', fmt: (v: number) => Math.round(v).toString(), unit: '', better: 'up' },
] as const
const ranges = [{ value: '14', label: '2 weeks' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }] as const

export default function HealthPage() {
  const today = dateKey()
  const [range, setRange] = useState<(typeof ranges)[number]['value']>('30')
  const days = Number(range)
  const bundle = useTodayBundle()
  const series = useQueries({ queries: METRICS.map(m => ({ queryKey: ['metric', m.key], queryFn: () => api.metric(m.key, 180) })) })
  const t = bundle.data?.today
  // When today has no reading yet, the latest one stands in, dimmed and dated.
  const latest = (key: (typeof METRICS)[number]['key']) => {
    const q = series[METRICS.findIndex(m => m.key === key)]
    // Only genuine readings stand in: sample and derived values are not measurements.
    const last = q?.data ? daily(q.data.filter(observed)).at(-1) : undefined
    return last ? { value: last.value, when: ago(last.date, today) } : null
  }
  const reading = (now: number | null, key: (typeof METRICS)[number]['key'], show: (v: number) => string) => {
    if (now != null) return { value: show(now) }
    const l = latest(key)
    return l ? { value: show(l.value), sub: l.when, stale: true } : { value: '–', sub: 'No reading', unit: undefined }
  }

  return <div className="hl-page">
    <header className="hl-head">
      <h1>Health</h1>
      <p className="hl-head__sub">From Garmin · <Link to="/connect">sync and sources</Link></p>
    </header>

    <Card title="Today" aside={t?.readinessLabel && <Pill tone={t.readiness == null ? 'warn' : t.readiness >= 70 ? 'good' : undefined}>{t.readinessLabel}</Pill>}>
      {!t ? <Skeleton lines={2} /> : <>
        <div className="hl-today">
          {t.readiness != null
            ? <Ring value={t.readiness} max={100} size={72} stroke={5} label={`Readiness ${t.readiness} of 100`}>{t.readiness}</Ring>
            : <div className="hl-today__none" aria-hidden="true">–</div>}
          <div className="hl-today__stats">
            <Stat label="Sleep" {...reading(t.lastSleepScore, 'sleep_score', v => String(Math.round(v)))} />
            <Stat label="Resting HR" unit="bpm" {...reading(t.restingHr, 'resting_hr', v => String(Math.round(v)))} />
            <Stat label="Body Battery" {...reading(t.bodyBattery, 'body_battery', v => String(Math.round(v)))} />
            <Stat label="Steps" {...reading(t.stepsToday, 'steps', v => Math.round(v).toLocaleString())} />
          </div>
        </div>
        <ul className="hl-inputs" aria-label="Readiness inputs">
          {t.readinessComponents.map(c => <li key={c.key}>
            <span>{c.label}</span>
            <span className={c.status === 'fresh' ? 'hl-ok' : 'hl-stale'}>{c.status === 'missing' ? 'Not recorded'
              : c.recordedAt ? `${c.status === 'fresh' ? 'Up to date' : 'Stale'} · ${ageDays(c.recordedAt.slice(0, 10), today) === 0 ? 'today' : `${ageDays(c.recordedAt.slice(0, 10), today)}d ago`}` : c.status}</span>
          </li>)}
        </ul>
      </>}
    </Card>

    <section aria-labelledby="hl-trends" className="hl-section">
      <SectionHead id="hl-trends" title="Trends" />
      <Tabs options={ranges} value={range} onChange={setRange} label="Trend range" />
      <div className="hl-trends">
        {METRICS.map((m, i) => {
          const q = series[i]
          if (q.isPending) return <div key={m.key} className="hl-trend"><Skeleton height={36} /></div>
          const s = trend(daily(q.data ?? []), days, today)
          // Nothing in range: show the last genuine reading, dimmed, rather than a dash.
          const old = s.avg == null ? daily((q.data ?? []).filter(observed)).at(-1) ?? null : null
          const good = s.change == null || Math.abs(s.change) < 0.5 ? null : (s.change > 0) === (m.better === 'up')
          return <div key={m.key} className="hl-trend">
            <div className="hl-trend__text">
              <span className="hl-trend__label">{m.label}</span>
              <span className={`hl-trend__value${old ? ' hl-trend__value--stale' : ''}`}>{s.avg != null ? m.fmt(s.avg) : old ? m.fmt(old.value) : '–'}{(s.avg != null || old) && m.unit && <small> {m.unit}</small>}</span>
              <span className="hl-trend__sub">
                {s.avg != null ? `${days}-day average` : old ? `Last reading ${ago(old.date, today)}` : 'No readings yet'}
                {s.change != null && Math.abs(s.change) >= 0.5 && <span className={good ? 'hl-ok' : 'hl-stale'}> · {s.change > 0 ? '▲' : '▼'} {m.fmt(Math.abs(s.change))}</span>}
              </span>
            </div>
            <Spark values={s.recent.map(p => p.value)} label={`${m.label}, last ${days} days`} />
          </div>
        })}
      </div>
    </section>

    <WeeklySummary />
  </div>
}

/** The latest weekly summary, or how to get one. */
function WeeklySummary() {
  const qc = useQueryClient()
  const toast = useToast()
  const latest = useQuery({ queryKey: ['review-latest'], queryFn: api.latestReview })
  const [busy, setBusy] = useState(false)
  const lastMonday = (() => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return dateKey(d) })()

  async function writeNow() {
    setBusy(true)
    try {
      const r = await api.generateReview(lastMonday)
      toast.show({ message: r.status === 'Generated' ? 'Summary written.' : "Couldn't write the summary this time.", tone: r.status === 'Generated' ? undefined : 'error' })
      await qc.invalidateQueries({ queryKey: ['review-latest'] })
    } catch (e) { toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'error' }) }
    finally { setBusy(false) }
  }

  const review = latest.data?.review ?? null
  return <section aria-labelledby="hl-summary" className="hl-section">
    <SectionHead id="hl-summary" title="Weekly summary" aside={latest.data?.enabled && review?.status === 'Generated' && <span className="hl-muted">Week of {new Date(`${review.weekStart}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>} />
    {latest.isPending ? <Skeleton lines={3} />
      : !latest.data?.enabled ? <Card>
        <p className="hl-p">Each Monday morning the dashboard can write a short review of last week across your Garmin data, habits and calendar, and notify your phone. It needs an Anthropic API key on the server.</p>
        <p className="hl-p hl-muted">In Render, open <b>personal-dashboard → Environment</b>, add <code>ANTHROPIC_API_KEY</code>, and save. The service restarts with it and the first summary follows the next Monday at 8:00.</p>
      </Card>
      : !review || review.status !== 'Generated' ? <Card>
        <p className="hl-p">{review?.status === 'Failed' ? "Last week's summary couldn't be written. It will try again automatically." : 'Your first summary arrives Monday at 8:00.'}</p>
        <Button size="sm" disabled={busy} onClick={() => void writeNow()}>{busy ? 'Writing…' : "Write last week's now"}</Button>
      </Card>
      : <ReviewCard review={review} />}
  </section>
}

function ReviewCard({ review }: { review: WeeklyReview }) {
  const out = review.output && !('error' in review.output) ? review.output as ReviewOutput : null
  const recs = [...(out?.recommendations ?? [])].sort((a, b) => rank(a.priority) - rank(b.priority))
  return <Card tone="accent">
    {review.narrative && <p className="hl-narrative">{review.narrative}</p>}
    {(out?.wins?.length ?? 0) > 0 && <div className="hl-list"><h3 className="hl-label">Went well</h3><ul>{out!.wins!.map(w => <li key={w.factId + w.text}>{w.text}</li>)}</ul></div>}
    {(out?.misses?.length ?? 0) > 0 && <div className="hl-list"><h3 className="hl-label">Slipped</h3><ul>{out!.misses!.map(m => <li key={m.factId + m.text}>{m.text}</li>)}</ul></div>}
    {recs.length > 0 && <div className="hl-list"><h3 className="hl-label">This week</h3><ul>{recs.map(r => <li key={r.text}>{r.priority === 'high' && <Pill tone="accent">Priority</Pill>} {r.text}</li>)}</ul></div>}
  </Card>
}
const rank = (p: string | null) => p === 'high' ? 0 : p === 'medium' ? 1 : 2
