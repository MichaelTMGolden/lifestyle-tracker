// Your overall level: title, level number and XP to the next one.
import { Link } from 'react-router-dom'
import { Progress } from '../../ui'
import { nextTitleAt, titleFor, type Level } from './levels'

const n = (x: number) => Math.round(x).toLocaleString()

export function LevelCard({ level: l, link }: { level: Level; link?: boolean }) {
  const next = nextTitleAt(l.level)
  const body = <>
    <div className="lv-card__top">
      <span className="lv-card__badge" aria-hidden="true">{l.level}</span>
      <span className="lv-card__text">
        <span className="lv-card__title">{titleFor(l.level)}</span>
        <span className="lv-card__sub">Level {l.level} · {n(l.xp)} XP{next ? ` · ${titleFor(next)} at level ${next}` : ''}</span>
      </span>
    </div>
    <Progress value={Math.round(l.fraction * 100)} max={100} label={`${n(l.next - l.xp)} XP to level ${l.level + 1}`} />
    <span className="lv-card__next">{n(l.next - l.xp)} XP to level {l.level + 1}</span>
  </>
  return link ? <Link to="/stats#levels" className="lv-card lv-card--link">{body}</Link> : <div className="lv-card">{body}</div>
}

/** A small level chip for a habit. */
export function LevelChip({ level }: { level: number }) {
  return <span className="lv-chip" title={`Level ${level}`}>Lv {level}</span>
}
