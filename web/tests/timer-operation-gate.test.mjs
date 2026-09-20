import test from 'node:test'
import assert from 'node:assert/strict'
import { TimerOperationGate } from '../src/timer/TimerOperationGate.ts'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('a stop waits for its pending start, so requests cannot overtake each other', async () => {
  const gate = new TimerOperationGate()
  const started = deferred()
  const response = deferred()
  const calls = []
  const start = gate.run(1, async () => {
    calls.push('start request'); started.resolve()
    await response.promise
    calls.push('start saved')
  })
  const stop = gate.run(1, async () => { calls.push('stop request') })
  await started.promise
  assert.deepEqual(calls, ['start request'])
  response.resolve()
  await Promise.all([start, stop])
  assert.deepEqual(calls, ['start request', 'start saved', 'stop request'])
})

test('different habits can be changed independently', async () => {
  const gate = new TimerOperationGate()
  const response = deferred()
  const first = gate.run(1, () => response.promise)
  assert.equal(await gate.run(2, async () => 'saved'), 'saved')
  assert.equal(gate.beginRead(), null)
  response.resolve()
  await first
  assert.ok(gate.beginRead())
})

test('poll responses cannot erase or resurrect a timer across a mutation', async () => {
  const gate = new TimerOperationGate()
  const stalePoll = gate.beginRead()
  const response = deferred()
  const write = gate.run(1, () => response.promise)
  assert.equal(gate.canApplyRead(stalePoll), false)
  assert.equal(gate.beginRead(), null)
  response.resolve()
  await write
  assert.equal(gate.canApplyRead(stalePoll), false)
  const freshPoll = gate.beginRead()
  assert.equal(gate.canApplyRead(freshPoll), true)
})

test('an older poll cannot overwrite a newer server response', () => {
  const gate = new TimerOperationGate()
  const first = gate.beginRead()
  const second = gate.beginRead()
  assert.equal(gate.canApplyRead(second), true)
  assert.equal(gate.canApplyRead(first), false)
})

test('save failures reach callers and do not block a queued retry', async () => {
  const gate = new TimerOperationGate()
  const failure = gate.run(1, async () => { throw new Error('Offline') })
  const rejected = assert.rejects(failure, /Offline/)
  const retry = gate.run(1, async () => 'confirmed')
  await rejected
  assert.equal(await retry, 'confirmed')
  assert.ok(gate.beginRead())
})
