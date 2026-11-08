// Component kit preview (/kit). Sample values only, not your data; not in the nav.
import { useState } from 'react'
import { Button, Card, CheckRow, Heatmap, ListRow, Pill, Progress, Ring, SectionHead, Sheet, Skeleton, Stat, Tabs, type HeatCell } from '../ui'
import { useToast } from '../ui/hooks'

// Deterministic sample cells so the preview looks the same on every load.
function sampleCells(days: number, seed: number, density: number): HeatCell[] {
  const end = new Date(Date.UTC(2026, 10, 8))
  let s = seed
  return Array.from({ length: days }, (_, i) => {
    s = (s * 9301 + 49297) % 233280
    const r = s / 233280
    const d = new Date(end); d.setUTCDate(end.getUTCDate() - (days - 1 - i))
    const level = (r < density ? 1 + Math.floor((r / density) * 3.99) : 0) as HeatCell['level']
    return { date: d.toISOString().slice(0, 10), level }
  })
}

const ranges = [{ value: '4w', label: '4 weeks' }, { value: '6m', label: '6 months' }, { value: 'y', label: 'Year' }] as const

export default function KitPage() {
  const toast = useToast()
  const [range, setRange] = useState<(typeof ranges)[number]['value']>('4w')
  const [sheet, setSheet] = useState(false)
  const [checks, setChecks] = useState([true, false, false])
  const year = sampleCells(371, 7, 0.7)

  return <div className="kit">
    <header className="kit-head">
      <h1>Components</h1>
      <p className="subtitle">The Rite kit with sample values. Pages are rebuilt from these in Phase 3.</p>
    </header>

    <div className="kit-grid">
      <Card title="Card" aside="aside text">
        <p className="kit-note">Surface, hairline border, 18px radius. The accent tone marks the one thing that's live.</p>
      </Card>
      <Card title="Running" tone="accent" aside={<Pill tone="accent" live>Guitar</Pill>}>
        <div className="kit-row"><span className="kit-big">24:18</span><Button variant="primary">Stop &amp; log</Button></div>
        <Progress value={62} max={100} label="Guitar goal, 62 of 100 hours" />
      </Card>

      <Card title="Stats">
        <div className="kit-row kit-row--spread">
          <Stat label="This week" value="18" unit="/35" sub="On pace" tone="good" />
          <Stat label="Longest run" value="41" unit="days" />
          <Stat label="Behind" value="3" unit="h" sub="Catch up Sunday" tone="warn" />
        </div>
      </Card>

      <Card title="Buttons and pills">
        <div className="kit-row kit-row--wrap">
          <Button variant="primary">Primary</Button>
          <Button>Ghost</Button>
          <Button variant="quiet">Quiet</Button>
          <Button icon="play" aria-label="Start timer" />
          <Button size="sm" icon="plus">Small</Button>
        </div>
        <div className="kit-row kit-row--wrap">
          <Pill tone="accent" icon="flame">41</Pill>
          <Pill tone="good">On pace</Pill>
          <Pill tone="warn">3h behind</Pill>
          <Pill>Daily</Pill>
        </div>
      </Card>

      <Card title="Ring">
        <div className="kit-row">
          <Ring value={2} max={5} label="2 of 5 habits done" />
          <Ring value={5} max={5} label="All 5 habits done" />
          <Ring value={0} max={5} label="No habits done yet" />
          <Ring value={7} max={10} size={72} stroke={5} label="7 of 10 hours">7h</Ring>
        </div>
      </Card>

      <Card title="Tabs">
        <Tabs options={ranges} value={range} onChange={setRange} label="Range" />
        <p className="kit-note">Selected: {ranges.find(r => r.value === range)?.label}</p>
      </Card>

      <Card title="Heatmap">
        <Heatmap cells={sampleCells(28, 3, 0.8)} label="Sample: last 28 days" today="2026-11-08" />
        <Heatmap cells={year} variant="calendar" label="Sample: last year" today="2026-11-08" />
      </Card>

      <Card title="Check rows">
        <div>
          {['Book December flights', 'Update weekly routine', 'Record vocal demo'].map((t, i) =>
            <CheckRow key={t} label={t} meta={i === 2 ? 'Verse 2' : undefined} checked={checks[i]} onChange={v => setChecks(c => c.map((x, j) => j === i ? v : x))} />)}
        </div>
      </Card>

      <Card title="List rows" flush>
        <div className="ui-list">
          <ListRow icon="schedule" title="Schedule" meta="Your week and appointments" onClick={() => toast.show({ message: 'Opened Schedule' })} />
          <ListRow icon="settings" title="Settings" meta="Targets and baselines" trailing="3 set" />
          <ListRow icon="connect" title="Connect" meta="Garmin, Google Calendar" />
        </div>
      </Card>

      <Card title="Sheet and toast">
        <div className="kit-row kit-row--wrap">
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Button onClick={() => toast.show({ message: 'Guitar logged · 25 min', action: { label: 'Undo', onClick: () => toast.show({ message: 'Undone' }) } })}>Toast with Undo</Button>
          <Button onClick={() => toast.show({ message: 'Could not save. Check your connection.', tone: 'error' })}>Error toast</Button>
        </div>
      </Card>

      <Card title="Skeleton">
        <Skeleton height={28} width="45%" />
        <Skeleton lines={3} />
      </Card>
    </div>

    <SectionHead title="Section heading" aside={<a href="#top">Link →</a>} />

    <Sheet open={sheet} onClose={() => setSheet(false)} title="Log time" labelledBy="kit-sheet-title">
      <p className="kit-note">Sheets slide up from the bottom on phones and sit centred on desktop. Escape or a tap outside closes them.</p>
      <Button variant="primary" block onClick={() => setSheet(false)}>Done</Button>
    </Sheet>
  </div>
}
