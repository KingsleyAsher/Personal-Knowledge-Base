import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFlowEngine } from '../packages/kb-core/src/flows.js'
import { createInboxHost } from '../packages/kb-service/inbox-host.js'

test('custom conversation uses its definition, validates revisions, and resolves the Host workspace', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'kb-custom-flow-host-'))
  const engine = createFlowEngine({ stateDir, core: { status: async () => ({ bound: true, kbId: 'fixture', kbPath: stateDir }) }, delegate: async () => { throw Error('must not execute') } })
  try {
    const saved = await engine.save({ name: '信息报 fixture', triggers: ['fixture-report'], steps: [{ title: 'Report', instruction: 'Synthetic report instruction' }] })
    assert.equal(saved.ok, true)
    const flow = saved.flow
    let workspaceCalls = 0
    const handle = createInboxHost({
      client: { call: async (method, args) => { assert.equal(method, 'adapter.dispatch'); return engine.prepareConversation(args.operation) } },
      getLLM: () => { throw Error('custom flow must not enter High-only inbox gate') },
      getWorkspace: async root => { assert.equal(root, stateDir); workspaceCalls++; return { workspaceId: 'fixture-workspace', workspacePath: path.join(stateDir, 'workspace') } },
    })
    const input = { op: 'flows.prepare-conversation', id: flow.id, kbId: 'fixture', expectedRevision: flow.revision, params: {}, execution: {} }
    const result = await handle(input)
    assert.equal(result.ok, true)
    assert.equal(result.flowId, flow.id)
    assert.equal(result.workspaceId, 'fixture-workspace')
    assert.equal(result.cwd, path.join(stateDir, 'workspace'))
    assert.match(result.prompt, /Synthetic report instruction/)
    assert.match(result.prompt, /【执行目录】/)
    assert.equal((await handle({ ...input, kbId: 'other' })).reason, 'kb-changed')
    assert.equal((await handle({ ...input, expectedRevision: flow.revision + 1 })).reason, 'flow-changed')
    assert.equal(workspaceCalls, 1)
  } finally { engine.dispose?.(); await rm(stateDir, { recursive: true, force: true }) }
})

test('builtin inbox retains its identity gate', async () => {
  const handle = createInboxHost({ client: { call: async () => ({ kbId: 'fixture' }) } })
  await assert.rejects(handle({ op: 'flows.prepare-conversation', id: 'builtin-inbox-organize', kbId: 'other', expectedRevision: 1 }), /身份已变化/)
})

test('builtin launch uses saved card route and updated revision; custom model catalog is not High-only', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'kb-card-host-'))
  try {
    const core = { status: async () => ({ bound: true, kbId: 'fixture', kbPath: stateDir }) }
    const engine = createFlowEngine({ stateDir, core })
    const route = { provider: 'p', model: 'high-model', reasoningEffort: 'high' }
    const saved = await engine.setExecution({ id: 'builtin-inbox-organize', kbId: 'fixture', expectedRevision: 1, execution: route })
    assert.equal(saved.ok, true)
    const handle = createInboxHost({
      client: { call: async (method, args) => method === 'host.tool' ? core.status() : engine.get(args.operation.id) },
      getWorkspace: async () => ({ workspaceId: 'fixture' }),
      getLLM: () => ({ listProviders: () => [{ id: 'p' }], listModels: async () => [{ id: 'high-model' }, { id: 'plain-model' }], resolveModelInfo: async (p, id) => ({ reasoning: { efforts: id === 'high-model' ? [{ id: 'high' }] : [] } }) }),
    })
    const prepared = await handle({ op: 'flows.prepare-conversation', id: 'builtin-inbox-organize', kbId: 'fixture', expectedRevision: saved.revision })
    assert.deepEqual(prepared.execution, route)
    assert.equal(prepared.flowRevision, saved.revision)
    assert.equal((await handle({ op: 'flows.models' })).groups[0].models.length, 2)
    await assert.rejects(handle({ op: 'flows.prepare-conversation', id: 'builtin-inbox-organize', kbId: 'fixture', expectedRevision: 1 }), /身份已变化/)
  } finally { await rm(stateDir, { recursive: true, force: true }) }
})
