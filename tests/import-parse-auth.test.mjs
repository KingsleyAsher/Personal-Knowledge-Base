import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createParseCaller, runImportParseAction } from '../src/host/index.js'
import { noteKnowledgeGrant, noteKnowledgeRevoke } from '../src/host/gateway.js'
import { createImportService } from '../src/host/import-service.js'

const h1Ready = { getStatus: () => ({ ready: true }) }
const execFor = agent => ({ agent, signal: new AbortController().signal })

test('kb_import parse rejects live ordinary agents before invoking import parsing', async () => {
  const general = { id: 'general', session: { header: { id: 'session-general', agentPreset: 'general' } } }
  const services = new Map([
    ['agents', { get: id => id === general.id ? general : null }],
    ['h1Isolation', h1Ready],
  ])
  const parseCaller = createParseCaller(name => services.get(name), {})
  let calls = 0
  const result = await runImportParseAction({
    args: { importId: 'imp-1234567890', rel: 'scan.png' },
    exec: execFor(general),
    importService: { parseItem: async () => { calls += 1; return { ok: true } } },
    parseCaller,
  })
  assert.equal(result.reason, 'PARSE_DELEGATION_REQUIRED')
  assert.equal(calls, 0)
})

test('kb_import parse accepts verified desktop knowledge roots and rejects impersonation or unavailable H1', async () => {
  const liveGeneral = { id: 'agent-1', session: { header: { id: 'session-1', agentPreset: 'general' } } }
  const forgedKnowledge = { id: 'agent-1', session: { header: { id: 'session-forged', agentPreset: 'knowledge' } } }
  let calls = 0
  const importService = { parseItem: async () => { calls += 1; return { ok: true } } }
  const args = { importId: 'imp-1234567890', rel: 'scan.png' }
  const invoke = async (agent, agents, h1 = h1Ready) => runImportParseAction({
    args,
    exec: execFor(agent),
    importService,
    parseCaller: createParseCaller(name => name === 'agents' ? agents : name === 'h1Isolation' ? h1 : null, {}),
  })

  assert.equal((await invoke(forgedKnowledge, { get: () => liveGeneral })).reason, 'PARSE_CALLER_UNVERIFIED')
  const rootKnowledge = { id: 'root', session: { header: { id: 'session-root', agentPreset: 'knowledge' } } }
  const rootRegistry = { get: id => id === rootKnowledge.id ? rootKnowledge : null }
  const canceled = new AbortController()
  canceled.abort()
  const canceledResult = await runImportParseAction({
    args,
    exec: { agent: rootKnowledge, signal: canceled.signal },
    importService,
    parseCaller: createParseCaller(name => name === 'agents' ? rootRegistry : name === 'h1Isolation' ? h1Ready : null, {}),
  })
  assert.equal(canceledResult.reason, 'PARSE_CANCELED')
  assert.equal((await invoke(rootKnowledge, rootRegistry, null)).ok, true)
  assert.equal((await invoke(rootKnowledge, rootRegistry, { getStatus: () => ({ ready: false, code: 'STOPPED' }) })).reason, 'H1_BACKEND_NOT_READY')
  assert.equal((await invoke(rootKnowledge, rootRegistry)).ok, true)
  assert.equal(calls, 2)
})

test('live knowledge grant can parse imports, preserves gate provenance, and ignores remembered provider IDs', async () => {
  const child = { id: 'child', session: { header: { id: 'session-child', agentPreset: 'knowledge', origin: 'subagent', parentSession: 'session-parent' } } }
  const agents = { get: id => id === child.id ? child : null }
  const parseCaller = createParseCaller(name => name === 'agents' ? agents : name === 'h1Isolation' ? h1Ready : null, {})
  noteKnowledgeGrant(child)
  let call
  try {
    const result = await runImportParseAction({
      args: { action: 'parse', importId: 'imp-1234567890', rel: 'scan.png', kind: 'ocr', providerId: 'remembered-old-provider' },
      exec: execFor(child),
      importService: { parseItem: async (...args) => { call = args; return { ok: true, jobId: 'job-1' } } },
      parseCaller,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(call[0], { importId: 'imp-1234567890', rel: 'scan.png', kind: 'ocr' })
    assert.deepEqual(call[1], { requestedBy: { via: 'tool', origin: 'import', gate: 'knowledge-subagent', session: 'session-child', agent: 'child' } })
  } finally {
    noteKnowledgeRevoke(child)
  }
  const afterRevoke = await runImportParseAction({
    args: { importId: 'imp-1234567890', rel: 'scan.png' },
    exec: execFor(child),
    importService: { parseItem: async () => { throw new Error('must not parse after revoke') } },
    parseCaller,
  })
  assert.equal(afterRevoke.reason, 'PARSE_DELEGATION_REQUIRED')
})

test('import service carries verified tool provenance into the parsing job request', async t => {
  const root = await mkdtemp(path.resolve('..', 'kb-import-parse-auth-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const stateDir = path.join(root, 'state')
  await mkdir(source)
  await writeFile(path.join(source, 'scan.png'), 'synthetic image')
  let submitCall
  const parsing = { submit: async (...args) => { submitCall = args; return { ok: true, jobId: 'job-1', status: 'queued' } } }
  const currentCore = { status: async () => ({ kbId: 'kb-current', kbPath: source }) }
  const service = createImportService({
    stateDir,
    getBaseConfig: async () => ({}),
    getCurrentCore: async () => currentCore,
    coreFactory: config => ({ loadConfig: async () => {}, status: async () => ({ kbId: 'kb-current', kbPath: config.kbPath }) }),
    getParsingService: () => parsing,
  })
  const plan = await service.plan({ source, mode: 'attach', current: { kbId: 'kb-current', kbPath: source } })
  assert.equal(plan.ok, true)
  const parsed = await service.parseItem(
    { importId: plan.importId, rel: 'scan.png', providerId: 'remembered-old-provider' },
    { requestedBy: { via: 'tool', gate: 'knowledge-subagent', session: 'session-child' } },
  )
  assert.equal(parsed.ok, true)
  assert.equal(submitCall[0].providerId, 'remembered-old-provider')
  assert.deepEqual(submitCall[1], { requestedBy: { via: 'tool', origin: 'import', importId: plan.importId, gate: 'knowledge-subagent', session: 'session-child', agent: null } })
})
