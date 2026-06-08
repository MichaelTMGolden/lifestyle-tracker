import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, type MetricPoint, type SleepNight } from '../api'
import { fmtDay, metricMeta } from '../lib'

type ChartType = 'line' | 'bar' | 'area'
const RANGES = [7, 30, 90, 365]

export default function MetricDetailPage() {
  const { key = '' } = useParams()
  const meta = metricMeta(key)
  const isSleep = key === 'sleep_total_min'

  const [days, setDays] = useState(30)
  const [chart, setChart] = useState<ChartType>(meta.chart)
  const [data, setData] = useState<MetricPoint[]>([])
  const [sleep, setSleep] = useState<SleepNight[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (isSleep) api.sleep(days).then(setSleep).catch((e) => setError(String(e)))
    else api.metric(key, days).then(setData).catch((e) => setError(String(e)))
  }, [key, days, isSleep])

  const rows = data.map((p) => ({ date: fmtDay(p.recordedAt), value: round(p.value) }))
  const sleepRows = sleep.map((n) => ({
    date: fmtDay(n.date),
    Deep: Math.round(n.deep), Light: Math.round(n.light),
    REM: Math.round(n.rem), Awake: Math.round(n.awake),
  }))
  const interval = days <= 7 ? 0 : days <= 31 ? 4 : days <= 90 ? 10 : 30

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/health" className="back">← Health</Link>
          <h1>{meta.label}</h1>
          <p className="subtitle">{meta.unit}</p>
        </div>
        <div className="controls">
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} className={days === r ? 'on' : ''} onClick={() => setDays(r)}>{r}d</button>
            ))}
          </div>
          {!isSleep && (
            <div className="seg">
              {(['line', 'bar', 'area'] as ChartType[]).map((t) => (
                <button key={t} className={chart === t ? 'on' : ''} onClick={() => setChart(t)}>{t}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="error">Couldn't load data ({error}).</p>}

      <section className="card">
        <ResponsiveContainer width="100%" height={360}>
          {isSleep ? (
            <BarChart data={sleepRows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={interval} />
              <YAxis tick={{ fontSize: 11 }} unit="m" />
              <Tooltip />
              <Legend />
              <Bar dataKey="Deep" stackId="s" fill="#1e3a8a" isAnimationActive={false} />
              <Bar dataKey="Light" stackId="s" fill="#60a5fa" isAnimationActive={false} />
              <Bar dataKey="REM" stackId="s" fill="#a78bfa" isAnimationActive={false} />
              <Bar dataKey="Awake" stackId="s" fill="#f87171" isAnimationActive={false} />
            </BarChart>
          ) : chart === 'bar' ? (
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={interval} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name={meta.label} fill={meta.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          ) : chart === 'area' ? (
            <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={interval} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="value" name={meta.label} stroke={meta.color} fill={meta.color} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={interval} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" name={meta.label} stroke={meta.color} dot={false} strokeWidth={2} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </section>
    </>
  )
}

const round = (n: number) => Math.round(n * 100) / 100
