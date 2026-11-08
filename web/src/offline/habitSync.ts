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
type Waiter = { resolve: (r: WriteResult) => void; reject: (e: unknown) => void; /** stored in the queue at least once */ entered: boolean }
const waiting = new Map<string, Waiter>()
/** Writes this tab is sending right now. */
const inFlight = new Set<string>()

function load(): QueuedWrite[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as QueuedWrite[] } catch { return [] }
}
function publish(list: QueuedWrite[]) {
  snapshot = list
  listeners.forEach(fn => fn())
  // A waiter whose write entered the queue and has since left it without this
  // tab sending it was delivered by another tab. One not yet stored is still pending.
  for (const [id, w] of waiting) if (w.entered && !list.some(x => x.id === id) && !inFlight.has(id)) { waiting.delete(id); w.resolve({}) }
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
    localStorage.setItem(KEY, JSON.stringify(next)) // throws when storage is full or blocked: the caller decides
    publish(next)
  })
}

// Another tab changed the queue.
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === KEY) publish(load()) })

export const pendingWrites = () => snapshot
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

/** A v4 UUID (the server binds request ids as Guid). randomUUID needs a secure context; getRandomValues doesn't. */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** fetch() rejects with a TypeError only when the request never reached a server. */
const unreachable = (e: unknown) => e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)
/**
 * Worth retrying later rather than giving up on: no connection, signed out
 * (401: kept until you sign in again), timeouts, rate limits and server errors.
 * Other answers (404 habit deleted, 400 date too old) will never succeed.
 */
const transient = (e: unknown) => {
  if (unreachable(e)) return true
  const status = (e as { status?: unknown })?.status
  return typeof status !== 'number' || status === 401 || status === 408 || status === 429 || status >= 500
}

function send(w: QueuedWrite) {
  return w.kind === 'done'
    ? api.setHabitDone(w.habitId, w.date, w.done)
    : api.logHabitMinutesOn(w.habitId, w.minutes, w.date, w.id)
}

async function submit(w: QueuedWrite): Promise<WriteResult> {
  const result = new Promise<WriteResult>((resolve, reject) => waiting.set(w.id, { resolve, reject, entered: false }))
  try {
    await edit(list => {
      const mine = waiting.get(w.id)
      if (mine) mine.entered = true // set before the stored list (with this write in it) is published
      return [...list, w]
    })
  }
  catch {
    // This device can't store the tap (storage full or blocked).
    waiting.delete(w.id)
    // Never let it overtake older taps still waiting: a newer state sent first
    // would be overwritten when those replay.
    if (load().length > 0) throw new Error("This device can't save more taps right now, and earlier ones are still waiting to sync. Try again once they have.")
    // Nothing waiting: send it now, in turn with any delivery, and say so plainly if that fails too.
    try { return await withLock(SEND_LOCK, () => send(w)) }
    catch (e) { throw unreachable(e) ? new Error("No connection, and this device can't save taps offline. Try again when you're back online.") : e }
  }
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
    // Each write at most once per pass: if storage can't record a removal, stop instead of looping.
    const tried = new Set<string>()
    for (;;) {
      const next = load()[0]
      if (!next || tried.has(next.id)) break
      tried.add(next.id)
      inFlight.add(next.id)
      try {
        const reply = await send(next)
        // Sent: drop it from the queue. If storage can't be written, a replay is still safe (request ids, explicit states).
        await edit(list => list.filter(x => x.id !== next.id)).catch(() => publish(load().filter(x => x.id !== next.id)))
        const mine = waiting.get(next.id)
        if (mine) { mine.resolve(reply); waiting.delete(next.id) } else caughtUp++
      } catch (e) {
        if (transient(e)) {
          for (const [id, w] of waiting) { w.resolve(QUEUED); waiting.delete(id) }
          break
        }
        await edit(list => list.filter(x => x.id !== next.id)).catch(() => publish(load().filter(x => x.id !== next.id)))
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
