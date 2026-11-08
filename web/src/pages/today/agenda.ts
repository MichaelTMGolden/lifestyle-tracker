// Rest of today's schedule: routine blocks and calendar events still to come.
import type { CalendarEvent, ScheduleBlock } from '../../api'
import { fmtMinutes } from '../../lib'

export type AgendaRow = { key: string; start: number; title: string; meta: string; current: boolean }

export function agendaRows(blocks: ScheduleBlock[], events: CalendarEvent[], now: number): AgendaRow[] {
  const toMinutes = (iso: string) => { const d = new Date(iso); const t = new Date(); const day = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000; return day * 1440 + d.getHours() * 60 + d.getMinutes() }
  const rows: (AgendaRow & { end: number })[] = [
    ...blocks.map(b => {
      const end = b.durationMinutes != null ? b.startMinutes + b.durationMinutes : Math.min(1440, ...blocks.filter(n => n.startMinutes > b.startMinutes).map(n => n.startMinutes))
      return { key: `b${b.id}`, start: b.startMinutes, end, title: b.activity, meta: 'Routine', current: b.startMinutes <= now && now < end }
    }),
    ...events.map(e => {
      const start = e.allDay ? 0 : Math.max(0, toMinutes(e.startsAt)), end = e.allDay ? 1440 : Math.min(1440, toMinutes(e.endsAt))
      return { key: `e${e.id}`, start, end, title: e.title, meta: e.allDay ? 'All day' : `${fmtMinutes(start)}–${fmtMinutes(end)}${e.location ? ` · ${e.location}` : ''}`, current: start <= now && now < end }
    }),
  ]
  return rows.filter(r => r.end > now).sort((a, b) => a.start - b.start)
}
