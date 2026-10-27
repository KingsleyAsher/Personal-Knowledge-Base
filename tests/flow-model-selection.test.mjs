import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import { createFlowEngine, validateFlow } from '../src/host/flows.js'

const client = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
const editor = vm.runInNewContext(client.slice(client.indexOf('    const FLOW_TERMINAL'), client.indexOf('    let flowClientContext')) + ';\n({ emptyDraft, draftOf, payloadOf })')
const route = { provider: 'fixture-provider', model: 'fixture-model', reasoningEffort: 'high' }
const plain = value => JSON.parse(JSON.stringify(value))

test('saved model survives editor, disk reload and run override without changing defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb-flow-model-'))
  try {
    const kbPath = path.join(root, 'library')
    await mkdir(kbPath)
    const options = { stateDir: path.join(root, 'state'), core: { status: async () => ({ bound: true, kbId: 'fixture', kbPath }) } }
    const engine = createFlowEngine(options)
    const saved = await engine.save({ flow: { name: 'Fixture', triggers: ['fixture'], steps: [{ title: 'Fixture', instruction: 'Synthetic task' }], execution: route } })
    assert.equal(saved.ok, true)
    const edited = editor.payloadOf(editor.draftOf(saved.flow))
    assert.deepEqual(plain(edited.execution), route)
    const reloaded = createFlowEngine(options)
    const request = { id: saved.flow.id, kbId: 'fixture', expectedRevision: saved.flow.revision }
    assert.deepEqual((await reloaded.prepareConversation(request)).execution, route)
    assert.deepEqual((await reloaded.prepareConversation({ ...request, execution: {} })).execution, {})
    const changed = { provider: 'another', model: 'another-model' }
    assert.deepEqual((await reloaded.prepareConversation({ ...request, execution: changed })).execution, changed)
    assert.deepEqual((await reloaded.get(saved.flow.id)).flow.execution, route)
    assert.equal((await reloaded.prepareConversation({ ...request, execution: { model: 'incomplete' } })).reason, 'invalid-flow')
    assert.ok(validateFlow({ ...saved.flow, execution: { reasoningEffort: 'high' } }).length)
    assert.deepEqual(plain(editor.payloadOf(editor.draftOf({ ...saved.flow, execution: undefined })).execution), {})
  } finally { await rm(root, { recursive: true, force: true }) }
})

function launcher(selectionError = false, execution = route) {
  const calls = []
  const context = { get(name) { return {
    sessions: { create: async () => { calls.push('create'); return 'session-fixture' }, retain: () => ({ ready: Promise.resolve(), release() { calls.push('release') } }), scope: () => ({ get: () => ({ send: async () => calls.push('send') }) }) },
    uiWorkspace: { openSession() { calls.push('open') } }, uiConversation: { binding: () => ({ activate() {} }) },
    modelDirectories: { directoryFor: () => ({ select: async value => { calls.push(['select', plain(value)]); if (selectionError) throw Error('unsupported model') } }) },
  }[name] } }
  const code = client.slice(client.indexOf('    let flowClientContext'), client.indexOf('    function Flows()'))
  const launch = vm.runInNewContext(code + '\nflowClientContext = context; launchFlowConversation', {
    context, callApi: async () => ({ ok: true, workspaceId: 'workspace-fixture', prompt: 'fixture task', execution }),
  })
  return { calls, launch: () => launch({ id: 'fixture', revision: 1 }, 'fixture', {}) }
}

test('new session selects model before sending and blocks task on selection failure', async () => {
  const success = launcher()
  await success.launch()
  assert.deepEqual(success.calls, ['create', ['select', route], 'open', 'send', 'release'])
  const failure = launcher(true)
  await assert.rejects(failure.launch(), /unsupported model/)
  assert.equal(failure.calls.includes('send'), false)
  assert.equal(failure.calls.at(-1), 'release')
  const defaults = launcher(false, {})
  await defaults.launch()
  assert.deepEqual(defaults.calls, ['create', 'open', 'send', 'release'])
})

test('background delegation replaces inherited route and clears unrelated controls', async () => {
  const gateway = await readFile(new URL('../src/host/gateway.js', import.meta.url), 'utf8')
  const code = gateway.slice(gateway.indexOf('  let route = {}'), gateway.indexOf('  const createOpts ='))
  const selected = vm.runInNewContext(code + '\nroute', {
    safeExec: { execution: route }, parentHeader: { id: 'fixture' }, parent: {},
    inheritRoute: () => ({ provider: 'old', model: 'old', reasoningEffort: 'old', maxTokens: 100 }),
  })
  assert.deepEqual(plain(selected), route)
  const defaultEffort = vm.runInNewContext(code + '\nroute', { safeExec: { execution: { provider: 'new', model: 'new' } }, parentHeader: null })
  assert.deepEqual(plain(defaultEffort), { provider: 'new', model: 'new' })
})
