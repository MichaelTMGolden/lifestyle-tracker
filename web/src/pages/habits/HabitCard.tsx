// One habit on the Habits page: streak, cadence, a one-tap action and its heatmap.
import { useState } from 'react'
import type { Goal, Habit } from '../../api'
import { habitStyle } from '../../habitColor'
import { haptic } from '../../ui/feedback'
import { fmtElapsed, fmtHours } from '../../lib'
import { Button, Heatmap, Icon, Progress } from '../../ui'
import type { HeatCell } from '../../ui/hooks'
import { cadenceLabel, goalPace, streakUnit } from './stats'
import { LevelChip } from './LevelCard'
import type { SkillGoal } from '../../skillGoals'
import { GoalLine } from './SkillGoals'

export type Range = '4w' | '6m' | 'y'

export function HabitCard({ habit, cells, range, doneThisWeek, goal, running, elapsedMs, milestone, level, aims, onOpen, onToggle, onStart, onStop }: {
  habit: Habit
  cells: HeatCell[]
  range: Range
  doneThisWeek: number
  goal?: Goal
  running: boolean
  elapsedMs: number
  /** True briefly after this habit's streak reaches a milestone. */
  milestone?: boolean
  /** The habit's level, shown as a chip. */
  level?: number
  /** Open skill goals, lead first. */
  aims?: SkillGoal[]
  onOpen: () => void
  onToggle: () => void
  onStart: () => void
  onStop: () => void
}) {
  const h = habit
  const pace = goal ? goalPace(goal) : null
  const streakText = `${h.currentStreak} ${streakUnit(h, h.currentStreak)} streak`
  // A short pop on the check when it is ticked (not when it is unticked).
  const [ticked, setTicked] = useState(false)
  const tick = () => { haptic(); if (!h.doneToday) setTicked(true); onToggle() }
  const press = (fn: () => void) => () => { haptic(); fn() }

  return <article className={`hb-card${running ? ' hb-card--running' : ''}${milestone ? ' hb-card--milestone' : ''}`} aria-label={h.name} style={habitStyle(h)}>
    <div className="hb-card__head">
      <button type="button" className="hb-card__open" onClick={onOpen} aria-label={`${h.name}: ${streakText}. Open details`}>
        <h2 className="hb-card__name">{h.name}</h2>
        <span className="hb-card__streak" aria-hidden="true"><Icon name="flame" size={13} filled />{h.currentStreak}</span>
        {level != null && <LevelChip level={level} />}
        <span className="hb-card__cadence">{cadenceLabel(h, doneThisWeek)}</span>
      </button>
      {h.tracksTime
        ? running
          ? <span className="hb-card__timer">
              <span className="hb-card__elapsed" aria-live="off">{fmtElapsed(elapsedMs)}</span>
              <Button variant="primary" size="sm" icon="stop" onClick={press(onStop)} aria-label={`Stop ${h.name} timer and log the time`}>Stop</Button>
            </span>
          : <Button className="hb-card__action" icon="play" onClick={press(onStart)} aria-label={`Start ${h.name} timer`} />
        : <Button className={`hb-card__action${ticked && h.doneToday ? ' is-ticked' : ''}`}
            onAnimationEnd={e => { if (e.animationName === 'ui-burst') setTicked(false) }} variant={h.doneToday ? 'primary' : 'ghost'} icon="check" onClick={tick}
            aria-pressed={h.doneToday} aria-label={h.doneToday ? `${h.name} done today. Undo` : `Mark ${h.name} done today`} />}
    </div>

    <button type="button" className="hb-card__heat" onClick={onOpen} tabIndex={-1} aria-hidden="true">
      <Heatmap cells={cells} variant={range === '4w' ? 'strip' : 'calendar'} label={`${h.name}: ${range === '4w' ? 'last 4 weeks' : range === '6m' ? 'last 6 months' : 'last year'}`}
        today={cells.at(-1)?.date} cellSize={range === 'y' ? 9 : 11} />
    </button>

    {aims && aims.length > 0 && <button type="button" className="hb-card__aim" onClick={onOpen} aria-label={`${h.name}: working toward ${aims[0].title}`}>
      <GoalLine goal={aims[0]} more={aims.length - 1} />
    </button>}

    {h.tracksTime && h.minutesToday > 0 && !goal && <p className="hb-card__note">{h.minutesToday} min today · {fmtHours(h.totalMinutes)} total</p>}

    {goal && <div className="hb-card__goal">
      <div className="hb-card__goal-line">
        <span>{goal.name} · {fmtHours(goal.accumulatedMinutes)} of {fmtHours(goal.targetMinutes)}</span>
        {pace && <span className={pace.tone ? `hb-tone--${pace.tone}` : undefined}>{pace.text}</span>}
      </div>
      <Progress value={Math.round(goal.progress * 100)} max={100} label={`${goal.name}: ${Math.round(goal.progress * 100)}%`} />
    </div>}
  </article>
}
