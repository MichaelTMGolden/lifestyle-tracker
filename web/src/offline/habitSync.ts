// Habit taps that survive a lost connection. Each write names its day and end
// state (or carries a request id when adding minutes), so the server can apply
// it late or twice with the same result. When the network is unreachable the
// write waits here, in localStorage, and is sent in order once back online.
import { api, type Habit } from '../api'

type Base = { id: string; habitId: number; habitName: string; date: string; createdAt: number }
export type QueuedWrite = (Base & { kind: 'done'; done: boolean }) | (Base & { kind: 'minutes'; minutes: number })

/** A write was queued instead of sent. */
export const QUEUED = 'queued' as const
export type WriteResult = { habit?: Habit | null } | typeof QUEUED

const KEY = 'pd:offline-habit-writes'
const listeners = new Set<() => void>()
let cache: QueuedWrite[] | null = null
let flushing: Promise<void> | null = null

function read(): QueuedWrite[] {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) || '[]') as QueuedWrite[] } catch { cache = [] }
  return cache
}
function save(list: QueuedWrite[]) {
  cache = list
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage full or blocked: kept in memory */ }
  listeners.forEach(fn => fn())
}

export const pendingWrites = () => read()
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

const newId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

/** fetch() rejects with a TypeError only when the request never reached a server. */
const unreachable = (e: unknown) => e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)

function send(w: QueuedWrite) {
  return w.kind === 'done'
    ? api.setHabitDone(w.habitId, w.date, w.done)
    : api.logHabitMinutesOn(w.habitId, w.minutes, w.date, w.id)
}

async function submit(w: QueuedWrite): Promise<WriteResult> {
  // Anything already waiting goes first, so a newer tap never lands before an older one.
  if (read().length > 0) { save([...read(), w]); void flush(); return QUEUED }
  try { return await send(w) }
  catch (e) {
    if (!unreachable(e)) throw e
    save([...read(), w])
    return QUEUED
  }
}

/** Mark a habit done or not done for a day (local YYYY-MM-DD). */
export const setDone = (habit: Pick<Habit, 'id' | 'name'>, date: string, done: boolean) =>
  submit({ id: newId(), kind: 'done', habitId: habit.id, habitName: habit.name, date, done, createdAt: Date.now() })

/** Add minutes to a habit's day. The request id makes a repeat a no-op on the server. */
export const addMinutes = (habit: Pick<Habit, 'id' | 'name'>, date: string, minutes: number) =>
  submit({ id: newId(), kind: 'minutes', habitId: habit.id, habitName: habit.name, date, minutes, createdAt: Date.now() })

/**
 * Send queued writes oldest first. Stops at the first unreachable request and
 * tries again later. A write the server refuses (say the habit was deleted, or
 * it is now outside the backfill window) is dropped and reported to `onDropped`.
 */
export function flush(onDropped?: (w: QueuedWrite, reason: string) => void): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    while (read().length > 0) {
      const [next] = read()
      try { await send(next) }
      catch (e) {
        if (unreachable(e)) break
        const reason = e instanceof Error ? e.message : String(e)
        // Server trouble: keep it and retry later. Anything else will never succeed.
        if (/temporarily unavailable|too many requests|session has expired/i.test(reason)) break
        onDropped?.(next, reason)
      }
      save(read().filter(w => w.id !== next.id))
      sent++
    }
    if (sent > 0) window.dispatchEvent(new CustomEvent('pd:habits-synced'))
  })().finally(() => { flushing = null })
  return flushing
}

/** Flush when the app starts, when the connection returns, when it comes back into view, and every 30s while anything waits. */
let started = false
export function startHabitSync(onDropped?: (w: QueuedWrite, reason: string) => void) {
  if (started) return
  started = true
  const run = () => { if (read().length > 0) void flush(onDropped) }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run() })
  setInterval(run, 30_000)
  run()
}
