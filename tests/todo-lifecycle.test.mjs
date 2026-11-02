import { createTodoLifecycleUI } from '../src/client/todo-lifecycle-ui.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTodoCompletionGuard } from '../src/host/todo-lifecycle.js'

function fixture(statuses = ['in_progress', 'pending']) {
  const events = [{ type: 'turn/start', data: { turn: 3 } }, { type: 'todo/write', data: { todos: statuses.map((status, i) => ({ content: 'Synthetic step ' + i, status })) } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Synthetic ending' }] } } }]
  const messages = [], agent = { session: { snapshotEvents: () => events }, inject: value => messages.push(value) }
  return { events, messages, agent, payload: { agent, turn: 3, signal: new AbortController().signal } }
}

test('stale first-step plan gets one owning-session reconciliation, without fabricated completion', async () => {
  const f = fixture(), before = JSON.stringify(f.events), guard = createTodoCompletionGuard(agent => agent === f.agent)
  await guard(f.payload); await guard(f.payload)
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0].content[0].text, /不要只为清除进度条/)
  assert.equal(JSON.stringify(f.events), before)
})

test('completed plans, cancellation, interrupted messages and unverified callers do not restart work', async () => {
  const complete = fixture(['completed', 'completed']); await createTodoCompletionGuard()(complete.payload); assert.equal(complete.messages.length, 0)
  const canceled = fixture(); canceled.payload.signal = AbortSignal.abort(); await createTodoCompletionGuard()(canceled.payload); assert.equal(canceled.messages.length, 0)
  const interrupted = fixture(); interrupted.events.at(-1).data.message.interrupted = true; await createTodoCompletionGuard()(interrupted.payload); assert.equal(interrupted.messages.length, 0)
  const unverified = fixture(); await createTodoCompletionGuard(() => false)(unverified.payload); assert.equal(unverified.messages.length, 0)
})

test('new turns cannot reuse an earlier plan or trigger repeated repair feedback', async () => {
  const f = fixture(), guard = createTodoCompletionGuard()
  f.events.push({ type: 'turn/start', data: { turn: 4 } }, { type: 'assistant/message', data: { message: {} } })
  await guard({ ...f.payload, turn: 4 }); assert.equal(f.messages.length, 0)
  f.events.push({ type: 'todo/write', data: { todos: [{ content: 'New synthetic work', status: 'pending' }] } },
    { type: 'user/message', data: { source: { kind: 'todo:lifecycle-reconcile' } } })
  await guard({ ...f.payload, turn: 4 }); assert.equal(f.messages.length, 0)
})

test('client follows later steps and stops spinning without marking unfinished work complete', async () => {
  const module = createTodoLifecycleUI({ createElement() {} })
  const todos = [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'pending' }]
  assert.deepEqual(Array.from(module.viewOf(todos, true), item => item.displayStatus), ['completed', 'active', 'pending'])
  assert.deepEqual(Array.from(module.viewOf(todos, false), item => item.displayStatus), ['completed', 'unconfirmed', 'pending'])
  assert.equal(module.viewOf(todos, false).filter(item => item.status === 'completed').length, 1)
  assert.equal(module.viewOf(todos, undefined)[1].displayStatus, 'syncing')
  assert.equal(module.viewOf(todos, false, true)[1].displayStatus, 'waiting')
})

test('the shipped client embeds the tested todo UI source', async () => {
  const client = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
  const source = (await readFile(new URL('../src/client/todo-lifecycle-ui.js', import.meta.url), 'utf8')).replace('export function ', 'function ', 1)
  const embedded = client.split('    // BEGIN GENERATED TODO LIFECYCLE UI\n')[1].split('    // END GENERATED TODO LIFECYCLE UI')[0]
  assert.equal(embedded.split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n'), source)
})
