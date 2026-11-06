import { createTodoLifecycleUI } from '../src/client/todo-lifecycle-ui.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTodoCompletionGuard, createTodoProgressGuard } from '../src/host/todo-lifecycle.js'

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

test('long tool runs request live progress updates before the final response, without rewriting todo state', async () => {
  const f = fixture(), guard = createTodoProgressGuard(agent => agent === f.agent)
  for (let i = 1; i <= 3; i++) f.events.push({ type: 'tool/result', data: { callId: String(i) } }, { type: 'step/end', data: { step: i } })
  const before = JSON.stringify(f.events), next = async () => ({ kind: 'enter', messages: [] })
  const decision = await guard({ ...f.payload, step: 4 }, next)
  assert.equal(decision.messages.length, 1)
  assert.match(decision.messages[0].content[0].text, /调用 todo_write/)
  assert.equal(JSON.stringify(f.events), before)
  assert.equal((await guard({ ...f.payload, step: 4 }, next)).messages.length, 0)
  f.events.push({ type: 'todo/write', data: { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] } })
  assert.equal((await guard({ ...f.payload, step: 8 }, next)).messages.length, 0)
  assert.equal((await createTodoProgressGuard()({ ...f.payload, step: 8, signal: AbortSignal.abort() }, next)).messages.length, 0)
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

test('todo panel uses composer border-box geometry with bounded variable fallbacks', async () => {
  const source = await readFile(new URL('../src/client/todo-lifecycle-ui.js', import.meta.url), 'utf8')
  const rule = source.match(/\[data-todo-lifecycle-panel\]\{([^}]+)\}/)[1]
  assert.ok(rule.includes('box-sizing:border-box'))
  assert.ok(rule.includes('width:max(0px,calc(100% - var(--dsh-composer-side-clearance,16px)*2 - var(--dsh-composer-dock-inset,8px)*4))'))
  assert.ok(rule.includes('max-width:max(0px,calc(var(--dsh-composer-card-max-width,952px) - var(--dsh-composer-dock-inset,8px)*4))'))
  for (const value of ['margin:0 auto;', 'margin-bottom:8px;', 'border:.5px solid', 'border-radius:12px;', 'font-size:13px;', 'overflow:hidden']) assert.ok(rule.includes(value), value)
  assert.ok(source.includes('body:has([data-todo-lifecycle-panel]) section[data-testid="todo-panel"]{display:none}'))
  assert.ok(source.includes('React.useState(true)'))
})

test('viewOf preserves all five progress states and never mutates synthetic todos', () => {
  const { viewOf } = createTodoLifecycleUI({ createElement() {} })
  const todos = Object.freeze(['completed', 'in_progress', 'pending'].map((status, i) => Object.freeze({ content: `Synthetic ${i}`, status })))
  for (const [running, waiting, expected] of [[true, false, 'active'], [false, false, 'unconfirmed'], [undefined, false, 'syncing'], [true, true, 'waiting'], [false, true, 'waiting']]) {
    assert.deepEqual(viewOf(todos, running, waiting).map(item => item.displayStatus), ['completed', expected, 'pending'])
    assert.deepEqual(viewOf(todos, running, waiting).map(item => item.status), ['completed', 'in_progress', 'pending'])
  }
})
