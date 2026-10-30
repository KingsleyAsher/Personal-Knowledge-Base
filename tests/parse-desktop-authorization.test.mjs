import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createParseCaller } from '../src/host/index.js'
import { createParseSourceAuthority } from '../src/host/parse-source-authority.js'
import { createParsingService } from '../src/host/parsing.js'
import { createCore } from '../src/host/kbcore.js'
import { noteKnowledgeGrant, noteKnowledgeRevoke } from '../src/host/gateway.js'

function identity(preset = 'knowledge', extra = {}) {
  const agent = { id: 'live-agent', session: { header: { id: 'live-session', agentPreset: preset, ...extra } } }
  const agents = { get: id => id === agent.id ? agent : null }
  const gate = (config = {}, h1 = null) => createParseCaller(name => name === 'agents' ? agents : name === 'h1Isolation' ? h1 : null, config)
  return { agent, gate }
}

test('desktop knowledge identity works without H1; explicit isolation, live identity and delegation still apply', () => {
  const { agent, gate } = identity(), exec = { agent }
  assert.equal(gate()(exec).ok, true)
  assert.equal(gate()(exec).isolation, 'none')
  assert.equal(gate({ parse: { allowWithoutIsolation: false } })(exec).reason, 'H1_REQUIRED')
  assert.equal(gate({}, { getStatus: () => ({ ready: false }) })(exec).reason, 'H1_BACKEND_NOT_READY')
  assert.equal(gate()({ agent: { ...agent } }).reason, 'PARSE_CALLER_UNVERIFIED')
  const controller = new AbortController(); controller.abort()
  assert.equal(gate()({ agent, signal: controller.signal }).reason, 'PARSE_CANCELED')
  const general = identity('general')
  assert.equal(general.gate()({ agent: general.agent }).reason, 'PARSE_DELEGATION_REQUIRED')
  const child = identity('knowledge', { origin: 'subagent', parentSession: 'parent' })
  assert.equal(child.gate()({ agent: child.agent }).reason, 'PARSE_DELEGATION_REQUIRED')
  noteKnowledgeGrant(child.agent)
  try { assert.equal(child.gate()({ agent: child.agent }).ok, true) }
  finally { noteKnowledgeRevoke(child.agent) }
  assert.equal(child.gate()({ agent: child.agent }).reason, 'PARSE_DELEGATION_REQUIRED')
})

test('knowledge flow outside the library submits OCR and ASR from inbox and reads results; isolation errors retain their cause', async t => {
  const base = await mkdtemp(path.resolve('..', 'kb-desktop-parse-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const library = path.join(base, 'library'), workspace = path.join(base, 'flow-workspace'), stateDir = path.join(base, 'state')
  await mkdir(library); await mkdir(workspace)
  const core = createCore({ stateDir }, () => {})
  assert.equal((await core.bind(library, { confirmInit: true })).ok, true)
  await mkdir(path.join(library, '90-收件箱'), { recursive: true })
  const binding = { kbId: (await core.status()).kbId, kbPath: library }
  const { agent, gate } = identity('knowledge', { cwd: workspace }), exec = { agent }
  const authority = config => createParseSourceAuthority({ getAgents: () => ({ get: id => id === agent.id ? agent : null }), getBinding: async () => binding, knowledgeCaller: gate(config) })
  let calls = 0
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) {} calls++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(req.url.endsWith('/chat/completions') ? { choices: [{ message: { content: 'synthetic OCR result' } }] } : { text: 'synthetic ASR result' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const parser = createParsingService({ stateDir, getCore: () => core, getBinding: async () => binding })
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1'
  for (const kind of ['ocr', 'asr']) {
    const rel = '90-收件箱/synthetic.' + (kind === 'ocr' ? 'png' : 'wav'), absolute = path.join(library, rel)
    await writeFile(absolute, 'synthetic ' + kind + ' original')
    await assert.rejects(authority({ parse: { allowWithoutIsolation: false } }).issue(absolute, exec), { code: 'H1_REQUIRED' })
    assert.equal(calls, kind === 'ocr' ? 0 : 1)
    const provider = await parser.saveProvider({ id: 'synthetic-' + kind, kind, protocol: kind === 'ocr' ? 'openai-vision' : 'openai-audio-transcriptions', locality: 'local', baseUrl }, { viaAdmin: true })
    assert.equal(provider.ok, true, JSON.stringify(provider))
    await parser.setDefaults({ kind, id: provider.provider.id }, { viaAdmin: true })
    const source = await authority().issue(absolute, exec)
    assert.equal(source.scope, 'knowledge'); assert.equal(source.sourceRel, rel)
    const submitted = await parser.submit({ kind, sourceRel: source.sourceRel }, { requestedBy: { via: 'tool', gate: gate()(exec).via, session: 'live-session' } })
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    let job
    for (let i = 0; i < 200; i++) {
      job = await parser.readJob(submitted.jobId)
      if (['succeeded', 'failed', 'partial', 'canceled'].includes(job.status)) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics))
    assert.equal((await parser.readResult(job.jobId)).text, 'synthetic ' + kind.toUpperCase() + ' result')
    assert.equal((await parser.listRequests()).requests.find(r => r.requestId === submitted.requestId).status, 'accepted')
  }
  assert.equal(calls, 2)
  const ordinary = identity('general', { cwd: workspace })
  const denied = createParseSourceAuthority({ getAgents: () => ({ get: () => ordinary.agent }), getBinding: async () => binding, knowledgeCaller: ordinary.gate() })
  await assert.rejects(denied.issue(path.join(library, '90-收件箱/synthetic.png'), { agent: ordinary.agent }), { code: 'PARSE_DELEGATION_REQUIRED' })
  await writeFile(path.join(base, 'outside.png'), 'outside')
  await assert.rejects(authority().issue(path.join(base, 'outside.png'), exec), { code: 'SOURCE_DENIED' })
  assert.equal(calls, 2)
})
