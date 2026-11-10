import test from 'node:test'
import assert from 'node:assert/strict'
import { badges, levelOf, nextTitleAt, titleFor, xpFor, xpForLevel } from '../src/pages/habits/levels.ts'

const timed = { name: 'Guitar', tracksTime: true, cadence: 'daily', totalMinutes: 600, totalCompletions: 20, bestStreak: 7 }

test('xp: minutes and days for timed, days for ticked, plus the best run', () => {
  assert.equal(xpFor(timed), 600 + 200 + 35)
  assert.equal(xpFor({ ...timed, tracksTime: false }), 30 * 20 + 35)
  assert.equal(xpFor({ ...timed, cadence: 'weekly', bestStreak: 3 }), 600 + 200 + 60)
})

test('levels follow 50 × (level − 1)² and report progress to the next', () => {
  assert.equal(xpForLevel(1), 0)
  assert.equal(xpForLevel(2), 50)
  assert.deepEqual(levelOf(0), { level: 1, xp: 0, floor: 0, next: 50, fraction: 0 })
  assert.equal(levelOf(49).level, 1)
  assert.equal(levelOf(50).level, 2)
  const l = levelOf(125) // between 50 (lv 2) and 200 (lv 3)
  assert.equal(l.level, 2)
  assert.equal(l.fraction, 0.5)
})

test('titles change at their levels', () => {
  assert.equal(titleFor(1), 'Initiate')
  assert.equal(titleFor(9), 'Acolyte')
  assert.equal(titleFor(10), 'Adept')
  assert.equal(titleFor(60), 'Legend')
  assert.equal(nextTitleAt(10), 15)
  assert.equal(nextTitleAt(50), null)
})

test('badges read across habits and show progress', () => {
  const list = badges([timed, { ...timed, name: 'Reading', tracksTime: false, totalMinutes: 0, bestStreak: 31 }])
  const by = Object.fromEntries(list.map(b => [b.id, b]))
  assert.ok(by['first-light'].earned)
  assert.ok(by['moon-cycle'].earned) // Reading's 31-day run
  assert.ok(by['ten-hours'].earned) // Guitar's 10 h
  assert.ok(!by['hundred-hours'].earned)
  assert.equal(by['hundred-hours'].progress, '10 / 100 h')
  assert.equal(by['polymath'].progress, '2 / 5 habits')
})
