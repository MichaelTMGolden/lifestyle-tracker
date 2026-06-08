import { useEffect, useState } from 'react'
import { api, type ScheduleDay } from '../api'
import { categoryColor, fmtMinutes, nowMinutes, withNowLine } from '../lib'

const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })

export default function SchedulePage() {
  const [week, setWeek] = useState<ScheduleDay[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.scheduleWeek().then(setWeek).catch((e) => setError(String(e)))
  }, [])

  if (error) return <p className="error">Couldn't load schedule ({error}).</p>

  const categories = [...new Set(week.flatMap((d) => d.blocks.map((b) => b.category)))]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weekly schedule</h1>
          <p className="subtitle">Your recurring timetable · calendar events take precedence on the day</p>
        </div>
      </div>

      <div className="legend">
        {categories.map((c) => (
          <span key={c} className="legend-item">
            <span className="tl-dot" style={{ background: categoryColor[c] ?? '#999' }} />{c}
          </span>
        ))}
      </div>

      <div className="week-grid">
        {week.map((d) => (
          <section key={d.day} className={d.day === todayName ? 'day-col today' : 'day-col'}>
            <h3>{d.day}</h3>
            <ul className="day-blocks">
              {(d.day === todayName ? withNowLine(d.blocks, nowMinutes()) : d.blocks).map((b) =>
                b === 'now' ? (
                  <li key="now" className="now-line-mini" />
                ) : (
                  <li key={b.id} className="day-block" style={{ borderLeftColor: categoryColor[b.category] ?? '#999' }}>
                    <div className="db-time">{fmtMinutes(b.startMinutes)}{b.durationMinutes ? ` · ${b.durationMinutes}m` : ''}</div>
                    <div className="db-act">
                      {b.activity}
                      {b.protected && <span className="badge">★</span>}
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
