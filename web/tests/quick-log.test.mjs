import test from 'node:test'
import assert from 'node:assert/strict'
import { describe, parseDuration, parseQuickLog } from '../src/quickLog.ts'

const habits = [
  { id: 1, name: 'Singing', tracksTime: true },
  { id: 2, name: 'Guitar', tracksTime: true },
  { id: 3, name: 'Reading', tracksTime: false },
  { id: 4, name: 'Production/Mixing', tracksTime: true },
  { id: 5, name: 'Mobility', tracksTime: false },
]
const p = text => parseQuickLog(text, habits)

test('durations in the forms people type', () => {
  for (const [text, minutes] of [['30', 30], ['30m', 30], ['45 min', 45], ['1h', 60], ['1.5h', 90], ['1h30', 90], ['1h 30m', 90], ['1:30', 90], ['2 hours', 120]])
    assert.equal(parseDuration(`guitar ${text}`)?.minutes, minutes, text)
  assert.equal(parseDuration('guitar'), null)
  assert.equal(parseDuration('guitar 0'), null)
  assert.equal(parseDuration('guitar 2000'), null)
})

test('habit plus time logs minutes, in either order', () => {
  assert.deepEqual(p('guitar 30'), { kind: 'minutes', habit: habits[1], minutes: 30 })
  assert.deepEqual(p('1h15 singing'), { kind: 'minutes', habit: habits[0], minutes: 75 })
  assert.deepEqual(p('Mixing 45m'), { kind: 'minutes', habit: habits[3], minutes: 45 })
  assert.deepEqual(p('prod 20'), { kind: 'minutes', habit: habits[3], minutes: 20 })
})

test('a habit on its own: simple habits are marked done, timed ones start a timer', () => {
  assert.deepEqual(p('reading'), { kind: 'done', habit: habits[2] })
  assert.deepEqual(p('done mobility'), { kind: 'done', habit: habits[4] })
  assert.deepEqual(p('guitar'), { kind: 'timer', habit: habits[1] })
  assert.deepEqual(p('did guitar'), { kind: 'done', habit: habits[1] })
  assert.deepEqual(p('reading 20'), { kind: 'done', habit: habits[2] })
})

test('anything else is a to-do in the user’s own words', () => {
  assert.deepEqual(p('Book December flights'), { kind: 'todo', title: 'Book December flights' })
  assert.deepEqual(p('call mum at 5'), { kind: 'todo', title: 'call mum at 5' })
  assert.equal(p('   '), null)
})

test('an ambiguous name asks which habit', () => {
  const two = [...habits, { id: 6, name: 'Guitar theory', tracksTime: true }]
  assert.deepEqual(parseQuickLog('guit 25', two), { kind: 'choose', habits: [habits[1], two[5]], minutes: 25 })
  assert.deepEqual(parseQuickLog('guitar 25', two), { kind: 'minutes', habit: habits[1], minutes: 25 })
})

test('the preview says what will happen', () => {
  assert.equal(describe(p('guitar 90')), 'Log 1h 30m of Guitar')
  assert.equal(describe(p('reading')), 'Mark Reading done today')
  assert.equal(describe(p('guitar')), 'Start the Guitar timer')
  assert.equal(describe(p('Buy strings')), 'Add to today: “Buy strings”')
})
