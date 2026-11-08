// Habit taps that survive a lost connection. Each write names its day and end
// state (or carries a request id when adding minutes), so the server can apply
// it late or twice with the same result.
//
// Every write joins one queue in localStorage before it is sent, and a single
// sender delivers the queue oldest first. So two quick taps can never reach the
// server out of order, a tap made offline simply stays queued, and open tabs
// share the same queue: edits and delivery are serialised across tabs with the
// Web Locks API, and each edit re-reads storage rather than trusting a copy.
import { api, type Habit } from '../api'

type Base = { id: string; habitId: number; habitName: string; date: string; createdAt: number }
export type QueuedWrite = (Base & { kind: 'done'; done: boolean }) | (Base & { kind: 'minutes'; minutes: number })

/** The write is saved on this device and will be sent later. */
export const QUEUED = 'queued' as const
export type WriteResult = { habit?: Habit | null } | typeof QUEUED
type Dropped = (w: QueuedWrite, reason: string) => void

const KEY = 'pd:offline-habit-writes'
const EDIT_LOCK = 'pd:habit-queue-edit'
const SEND_LOCK = 'pd:habit-queue-send'

const listeners = new Set<() => void>()
let snapshot: QueuedWrite[] = load()
let onDropped: Dropped | undefined
let sending: Promise<void> | null = null
/** Callers in this tab waiting to hear what happened to their write. */
const waiting = new Map<string, { resolve: (r: WriteResult) => void; reject: (e: unknown) => void }>()
/** Writes this tab is sending right now. */
const inFlight = new Set<string>()

function load(): QueuedWrite[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as QueuedWrite[] } catch { return [] }
}
function publish(list: QueuedWrite[]) {
  snapshot = list
  listeners.forEach(fn => fn())
  // A waiter whose write left the queue without this tab sending it (another tab did) is done.
  for (const [id, w] of waiting) if (!list.some(x => x.id === id) && !inFlight.has(id)) { waiting.delete(id); w.resolve({}) }
}
/** Run `fn` holding a cross-tab lock where supported (all current browsers); otherwise just run it. */
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request(name, fn) as Promise<T> : fn()
}

/** Read-modify-write the stored queue under the edit lock, from the stored copy. */
function edit(change: (list: QueuedWrite[]) => QueuedWrite[]) {
  return withLock(EDIT_LOCK, async () => {
    const next = change(load())
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage full or blocked */ }
    publish(next)
  })
}

// Another tab changed the queue.
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === KEY) publish(load()) })

export const pendingWrites = () => snapshot
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

const newId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

/** fetch() rejects with a TypeError only when the request never reached a server. */
const unreachable = (e: unknown) => e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)
/** Worth retrying later rather than giving up on. */
const transient = (e: unknown) => unreachable(e) || /temporarily unavailable|too many requests|session has expired/i.test(e instanceof Error ? e.message : String(e))

function send(w: QueuedWrite) {
  return w.kind === 'done'
    ? api.setHabitDone(w.habitId, w.date, w.done)
    : api.logHabitMinutesOn(w.habitId, w.minutes, w.date, w.id)
}

async function submit(w: QueuedWrite): Promise<WriteResult> {
  const result = new Promise<WriteResult>((resolve, reject) => waiting.set(w.id, { resolve, reject }))
  await edit(list => [...list, w])
  void flush()
  return result
}

/** Mark a habit done or not done for a day (local YYYY-MM-DD). */
export const setDone = (habit: Pick<Habit, 'id' | 'name'>, date: string, done: boolean) =>
  submit({ id: newId(), kind: 'done', habitId: habit.id, habitName: habit.name, date, done, createdAt: Date.now() })

/** Add minutes to a habit's day. The request id makes a repeat a no-op on the server. */
export const addMinutes = (habit: Pick<Habit, 'id' | 'name'>, date: string, minutes: number) =>
  submit({ id: newId(), kind: 'minutes', habitId: habit.id, habitName: habit.name, date, minutes, createdAt: Date.now() })

/**
 * Deliver the queue oldest first, one write at a time, holding the send lock so
 * only one tab delivers. Stops at the first write that can't get through now
 * (offline, server down, signed out) and tells this tab's waiters it is queued.
 * A write the server refuses (habit deleted, date too old) is removed and
 * reported: to its waiter if this tab made it, otherwise to the drop handler.
 */
export function flush(): Promise<void> {
  if (sending) return sending
  sending = withLock(SEND_LOCK, async () => {
    // Writes that had been waiting (offline, or queued by another tab): worth telling the user about.
    let caughtUp = 0
    for (;;) {
      const next = load()[0]
      if (!next) break
      inFlight.add(next.id)
      try {
        const reply = await send(next)
        await edit(list => list.filter(x => x.id !== next.id))
        const mine = waiting.get(next.id)
        if (mine) { mine.resolve(reply); waiting.delete(next.id) } else caughtUp++
      } catch (e) {
        if (transient(e)) {
          for (const [id, w] of waiting) { w.resolve(QUEUED); waiting.delete(id) }
          break
        }
        await edit(list => list.filter(x => x.id !== next.id))
        const mine = waiting.get(next.id)
        if (mine) { mine.reject(e); waiting.delete(next.id) }
        else onDropped?.(next, e instanceof Error ? e.message : String(e))
      } finally {
        inFlight.delete(next.id)
      }
    }
    if (caughtUp > 0) window.dispatchEvent(new CustomEvent('pd:habits-synced', { detail: { sent: caughtUp } }))
  }).finally(() => { sending = null })
  return sending
}

/** Deliver on start, when the connection returns, when the app comes back into view, and every 30s while anything waits. */
let started = false
export function startHabitSync(dropped?: Dropped) {
  onDropped = dropped
  if (started) return
  started = true
  const run = () => { if (load().length > 0) void flush() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run() })
  setInterval(run, 30_000)
  run()
}
