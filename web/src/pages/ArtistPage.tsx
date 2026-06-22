import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type ArtistKpi, type MetricPoint } from '../api'
import { fmtCount, fmtDate, metricMeta } from '../lib'
import { Spark } from '../charts'

// The three KPIs, in display order. Keys match the API / metricMeta registry.
const KEYS = ['artist_monthly_listeners', 'artist_followers', 'artist_streams_total'] as const

export default function ArtistPage() {
  const [summary, setSummary] = useState<ArtistKpi[]>([])
  const [series, setSeries] = useState<Record<string, number[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form fields (any subset allowed). Date defaults to today.
  const todayIso = new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local
  const [date, setDate] = useState(todayIso)
  const [listeners, setListeners] = useState('')
  const [followers, setFollowers] = useState('')
  const [streams, setStreams] = useState('')

  async function load() {
    try {
      const [sum, ...metrics] = await Promise.all([
        api.artistSummary(),
        ...KEYS.map((k) => api.metric(k, 365).catch(() => [] as MetricPoint[])),
      ])
      setSummary(sum)
      setSeries(Object.fromEntries(KEYS.map((k, i) => [k, metrics[i].map((p) => p.value)])))
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => { load() }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s))
    const body = {
      date,
      monthlyListeners: num(listeners),
      followers: num(followers),
      totalStreams: num(streams),
    }
    if (body.monthlyListeners == null && body.followers == null && body.totalStreams == null) return
    setSaving(true); setError(null)
    try {
      await api.saveArtistKpis(body)
      setListeners(''); setFollowers(''); setStreams('')
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  const byKey = (k: string) => summary.find((s) => s.key === k)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Artist</h1>
          <p className="subtitle">Spotify for Artists — logged by hand (no public artist API)</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="kpi-grid">
        {KEYS.map((k) => <KpiCard key={k} kpi={byKey(k)} metricKey={k} spark={series[k] ?? []} />)}
      </div>

      <div className="sec-label">Log this week's numbers</div>
      <section className="card">
        <form className="kpi-form" onSubmit={save}>
          <label>
            <span>Date</span>
            <input type="date" value={date} max={todayIso} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span>Monthly listeners</span>
            <input type="number" min="0" inputMode="numeric" placeholder="e.g. 985" value={listeners} onChange={(e) => setListeners(e.target.value)} />
          </label>
          <label>
            <span>Followers</span>
            <input type="number" min="0" inputMode="numeric" placeholder="e.g. 304" value={followers} onChange={(e) => setFollowers(e.target.value)} />
          </label>
          <label>
            <span>Total streams</span>
            <input type="number" min="0" inputMode="numeric" placeholder="e.g. 40,200" value={streams} onChange={(e) => setStreams(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
        </form>
        <p className="muted" style={{ marginTop: 10 }}>Fill in whatever you have to hand — any field can be left blank. Re-entering a date corrects it.</p>
      </section>
    </>
  )
}

function KpiCard({ kpi, metricKey, spark }: { kpi: ArtistKpi | undefined; metricKey: string; spark: number[] }) {
  const meta = metricMeta(metricKey)
  const has = kpi?.latest != null
  const change = kpi?.change ?? null
  const target = kpi?.target ?? meta.target ?? null
  const pct = has && target ? Math.min(100, Math.round((kpi!.latest! / target) * 100)) : null

  return (
    <Link to={`/health/${metricKey}`} className="card kpi-card">
      <div className="kpi-name">{meta.label}</div>
      <div className="kpi-val" style={{ color: meta.color }}>{has ? fmtCount(kpi!.latest!) : '—'}</div>
      <div className="kpi-sub muted">
        {kpi?.asOf ? `as of ${fmtDate(kpi.asOf)}` : 'no entries yet'}
        {change != null && (
          <span className="kpi-change" style={{ color: change >= 0 ? 'var(--good)' : 'var(--bad)' }}>
            {' · '}{change >= 0 ? '+' : ''}{fmtCount(change)} since last
          </span>
        )}
      </div>
      {pct != null && (
        <>
          <div className="kpi-target-bar"><span style={{ width: `${pct}%`, background: meta.color }} /></div>
          <div className="kpi-sub muted">{pct}% of {fmtCount(target!)} target</div>
        </>
      )}
      <div className="kpi-spark"><Spark data={spark} color={meta.color} goal={target ?? undefined} h={34} /></div>
    </Link>
  )
}
