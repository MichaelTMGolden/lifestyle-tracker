// Quick log: turn a short phrase into an action. "guitar 30", "1h15 singing",
// "reading", "done mobility". Anything that isn't about a habit becomes a to-do.
// This only interprets text for the UI; every action it suggests is shown to the
// user before it runs.

export type QuickHabit = { id: number; name: string; tracksTime: boolean }

export type Intent<H extends QuickHabit = QuickHabit> =
  | { kind: 'minutes'; habit: H; minutes: number }
  | { kind: 'done'; habit: H }
  | { kind: 'timer'; habit: H }
  | { kind: 'todo'; title: string }
  | { kind: 'choose'; habits: H[]; minutes: number | null }

const DONE_WORDS = new Set(['done', 'did', 'finished', 'complete', 'completed', 'check', 'tick', 'log', 'logged'])

/** "30", "30m", "45 min", "1h", "1.5h", "1h30", "1h 30m", "1:30", "2 hours" → minutes; null if none. */
export function parseDuration(text: string): { minutes: number; rest: string } | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => number][] = [
    [/(?:^|\s)(\d{1,2}):([0-5]\d)(?=\s|$)/i, m => Number(m[1]) * 60 + Number(m[2])],
    [/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d{1,2})\s*(?:m|min|mins|minute|minutes)?(?=\s|$)/i, m => Math.round(Number(m[1]) * 60) + Number(m[2])],
    [/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?=\s|$)/i, m => Math.round(Number(m[1]) * 60)],
    [/(?:^|\s)(\d+)\s*(?:m|min|mins|minute|minutes)?(?=\s|$)/i, m => Number(m[1])],
  ]
  for (const [re, toMinutes] of patterns) {
    const m = text.match(re)
    if (!m) continue
    const minutes = toMinutes(m)
    if (!(minutes > 0) || minutes > 24 * 60) return null
    return { minutes, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length)).trim() }
  }
  return null
}

const norm = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Habits whose name matches the words, best first: whole name, then name prefix, then any word prefix. */
export function matchHabits<H extends QuickHabit>(query: string, habits: H[]): H[] {
  const q = norm(query)
  if (!q) return []
  const scored = habits.map(h => {
    const name = norm(h.name)
    const words = name.split(' ')
    const score = name === q ? 3 : name.startsWith(q) ? 2 : words.some(w => w.startsWith(q)) || (q.length >= 3 && name.includes(q)) ? 1 : 0
    return { h, score }
  }).filter(x => x.score > 0)
  const best = Math.max(0, ...scored.map(x => x.score))
  return scored.filter(x => x.score === best).map(x => x.h)
}

export function parseQuickLog<H extends QuickHabit>(input: string, habits: H[]): Intent<H> | null {
  const text = input.trim()
  if (!text) return null
  const duration = parseDuration(text)
  const words = norm(duration ? duration.rest : text).split(' ').filter(Boolean)
  const doneWord = words.some(w => DONE_WORDS.has(w))
  const query = words.filter(w => !DONE_WORDS.has(w)).join(' ')
  const matches = matchHabits(query, habits)

  // Not about a habit: it's a to-do, in the user's own words.
  if (matches.length === 0) return { kind: 'todo', title: text }
  if (matches.length > 1) return { kind: 'choose', habits: matches, minutes: duration?.minutes ?? null }

  const habit = matches[0]
  if (duration) return habit.tracksTime ? { kind: 'minutes', habit, minutes: duration.minutes } : { kind: 'done', habit }
  if (habit.tracksTime && !doneWord) return { kind: 'timer', habit }
  return { kind: 'done', habit }
}

/** What will happen, in words, for the preview line. */
export function describe(intent: Intent): string {
  switch (intent.kind) {
    case 'minutes': return `Log ${fmt(intent.minutes)} of ${intent.habit.name}`
    case 'done': return `Mark ${intent.habit.name} done today`
    case 'timer': return `Start the ${intent.habit.name} timer`
    case 'todo': return `Add to today: “${intent.title}”`
    case 'choose': return intent.minutes ? `Log ${fmt(intent.minutes)} to which habit?` : 'Which habit?'
  }
}

const fmt = (m: number) => m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`
