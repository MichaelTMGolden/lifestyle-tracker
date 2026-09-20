import test from 'node:test'
import assert from 'node:assert/strict'
import { filterTasks, isCompleteOpenOrder, taskIsOverdue, taskMatchesSearch } from '../src/taskViews.ts'

const today = '2026-09-20'
const tomorrow = '2026-09-21'
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, notes: null, dueAt: null, completedAt: null, plannedFor: null, priority: 2, sortOrder: id, ...extra })
const tasks = [task(1), task(2, { plannedFor: '2026-09-18' }), task(3, { plannedFor: today }), task(4, { plannedFor: tomorrow }), task(5, { plannedFor: '2026-09-22' }), task(6, { plannedFor: today, completedAt: '2026-09-20T10:00:00Z' })]

test('daily views keep unfinished past plans in backlog and future plans discoverable', () => {
  assert.deepEqual(filterTasks(tasks, 'backlog', '', today, tomorrow).map(item => item.id), [1, 2])
  assert.deepEqual(filterTasks(tasks, 'today', '', today, tomorrow).map(item => item.id), [3])
  assert.deepEqual(filterTasks(tasks, 'tomorrow', '', today, tomorrow).map(item => item.id), [4])
  assert.deepEqual(filterTasks(tasks, 'later', '', today, tomorrow).map(item => item.id), [5])
  assert.deepEqual(filterTasks(tasks, 'all', '', today, tomorrow).map(item => item.id), [1, 2, 3, 4, 5])
})

test('plans and deadlines remain independent', () => {
  const items = [task(1, { plannedFor: tomorrow, dueAt: '2026-09-19T00:00:00Z' }), task(2, { dueAt: `${today}T00:00:00Z` })]
  assert.deepEqual(filterTasks(items, 'overdue', '', today, tomorrow).map(item => item.id), [1])
  assert.deepEqual(filterTasks(items, 'tomorrow', '', today, tomorrow).map(item => item.id), [1])
  assert.deepEqual(filterTasks(items, 'today', '', today, tomorrow), [])
})

test('calendar due dates do not move into yesterday in a negative timezone offset', () => {
  assert.equal(taskIsOverdue(task(1, { dueAt: '2026-09-20T00:00:00Z' }), '2026-09-20'), false)
  assert.equal(taskIsOverdue(task(1, { dueAt: '2026-09-20T00:00:00Z' }), '2026-09-21'), true)
  assert.equal(taskIsOverdue(task(1, { dueAt: '2026-09-19T00:00:00Z', completedAt: '2026-09-20T10:00:00Z' }), today), false)
})

test('search matches title and notes, ignores metadata and keeps manual order', () => {
  const items = [task(8, { title: 'Book rehearsal', notes: 'Ask Ana for Friday' }), task(2, { title: 'Buy strings', notes: '[weekly-review:2026-09-14:abc123]\nFor rehearsal' })]
  assert.deepEqual(filterTasks(items, 'all', '  REHEARSAL ', today, tomorrow).map(item => item.id), [8, 2])
  assert.equal(taskMatchesSearch(items[0], 'ana book'), true)
  assert.equal(taskMatchesSearch(items[1], 'abc123'), false)
  assert.equal(taskMatchesSearch(items[0], 'record vocals'), false)
})

test('reordering requires every open task exactly once and rejects hidden or stale subsets', () => {
  assert.equal(isCompleteOpenOrder(tasks, [5, 4, 3, 2, 1]), true)
  assert.equal(isCompleteOpenOrder(tasks, [3]), false)
  assert.equal(isCompleteOpenOrder(tasks, [1, 2, 3, 4, 4]), false)
  assert.equal(isCompleteOpenOrder(tasks, [1, 2, 3, 4, 5, 6]), false)
  assert.equal(isCompleteOpenOrder(tasks, [1, 2, 3, 4, 99]), false)
})
