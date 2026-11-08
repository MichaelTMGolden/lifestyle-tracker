import { useState } from 'react'
import { useTimer } from '../timer/useTimer'
import { useIsMobile } from '../hooks'
import { fmtElapsed } from '../lib'
import { QuickLogSheet } from './QuickLog'
import '../dailyPlanning.css'

/**
 * Mobile-only sticky utility bar: Quick log (habit time, ticks, timers or a
 * to-do from one box) and a pill per running timer (glance + stop from anywhere).
 */
export function MobileActionBar() {
  const isMobile = useIsMobile()
  const { timers, elapsedMs, stop } = useTimer()
  const [open, setOpen] = useState(false)
  if (!isMobile) return null

  return <>
    <QuickLogSheet open={open} onClose={() => setOpen(false)} />
    <div className="action-bar">
      <button className="ab-add" onClick={() => setOpen(true)} aria-label="Quick log" aria-haspopup="dialog">
        <span className="ab-plus" aria-hidden>＋</span> Quick log
      </button>
      {timers.length > 0 && (
        <div className="ab-pills">
          {timers.map((t) => (
            <div key={t.habitId} className="ab-pill">
              <span className="ab-dot" aria-hidden />
              <span className="ab-pill-name">{t.habitName}</span>
              <span className="ab-pill-time">{fmtElapsed(elapsedMs(t.habitId))}</span>
              {/* TimerProvider shows a lasting banner if stopping fails. */}
              <button className="ab-stop" onClick={() => { void stop(t.habitId).catch(() => {}) }} aria-label={`Stop and log ${t.habitName}`}>Stop</button>
            </div>
          ))}
        </div>
      )}
    </div>
  </>
}
