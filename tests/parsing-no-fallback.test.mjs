import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { createParsingService } from '../packages/kb-core/src/parsing.js'

test('ASR missing cloud credentials stops on the configured default despite a remembered working local service', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb-no-fallback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let localCalls = 0, config = {}
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) {}
    localCalls++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ text: 'local ASR is available' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const service = createParsingService({
    stateDir: path.join(root, 'state'),
    getBinding: async () => ({ kbId: 'synthetic', kbPath: root }),
    getCore: () => ({ getConfig: async () => config, setConfig: async patch => { config = { ...config, ...patch }; return { ok: true } } }),
    credentialStore: { read: async () => ({}), configured: async () => false },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  })
  t.after(() => service.dispose?.())
  const admin = { viaAdmin: true }, caller = { requestedBy: { via: 'tool', session: 'synthetic-session' } }
  for (const provider of [
    { id: 'available-local', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', locality: 'local', authScheme: 'none' },
    { id: 'configured-cloud', baseUrl: 'https://example.test/v1', locality: 'cloud', credentialRef: 'SYNTHETIC_MISSING_KEY', authScheme: 'bearer' },
  ]) assert.equal((await service.saveProvider({ ...provider, kind: 'asr', protocol: 'openai-audio-transcriptions' }, admin)).ok, true)
  await service.setPolicy('allow-configured', admin)
  await service.setDefaults({ kind: 'asr', id: 'available-local' }, admin)
  await writeFile(path.join(root, 'synthetic.wav'), 'synthetic audio: no decoder used by this HTTP fixture')
  const wait = async id => {
    for (let i = 0; i < 200; i++) {
      const job = await service.readJob(id)
      if (['failed', 'succeeded', 'partial'].includes(job.status)) return job
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw Error('job timed out')
  }
  const control = await service.submit({ kind: 'asr', sourceRel: 'synthetic.wav' }, caller)
  assert.equal((await wait(control.jobId)).status, 'succeeded')
  assert.equal(localCalls, 1)
  await service.setDefaults({ kind: 'asr', id: 'configured-cloud' }, admin)
  const submitted = await service.submit({ kind: 'asr', sourceRel: 'synthetic.wav', providerId: 'available-local' }, caller)
  assert.equal(submitted.ok, true, JSON.stringify(submitted))
  const job = await wait(submitted.jobId)
  assert.equal(job.status, 'failed')
  assert.equal(job.provider.id, 'configured-cloud')
  assert(job.diagnostics.some(d => d.code === 'MISSING_CREDENTIAL'))
  assert.equal(service.publicJob(job).recovery.requiresUserConfirmation, true)
  const result = await service.readResult(job.jobId)
  assert.equal(result.ok, false)
  assert.equal(result.recovery.automaticFallbackAllowed, false)
  assert.match(result.detail, /MISSING_CREDENTIAL/)
  // Retry retains the original configured cloud provider too.
  assert.equal((await service.retry(job.jobId)).ok, true)
  assert.equal((await wait(job.jobId)).provider.id, 'configured-cloud')
  assert.equal(localCalls, 1)
  await service.setDefaults({ kind: 'asr', id: '' }, admin)
  const rejected = await service.submit({ kind: 'asr', sourceRel: 'synthetic.wav', providerId: 'available-local' }, caller)
  assert.equal(rejected.reason, 'NO_DEFAULT_PROVIDER')
  assert.equal(rejected.recovery.nextAction, 'ask-user')
  assert.equal(localCalls, 1)
})

test('all-agent instructions explicitly prohibit local fallback and preserve the actual error in rendering', async () => {
  const host = await readFile(new URL('../src/host/index.js', import.meta.url), 'utf8')
  assert.match(host, /设置优先于记忆/)
  assert.match(host, /禁止自动切换本机模型、其他云端/)
  assert.match(host, /j\.recovery\?\.instruction/)
  assert.match(host, /v\?\.detail/)
  const adapter = await readFile(new URL('../packages/kb-service/host-adapter.js', import.meta.url), 'utf8')
  assert.match(adapter, /name:'kb:parse-policy'/)
  assert.match(adapter, /description:definition\.name === 'kb_parse' \? parseRule/)
  assert.match(adapter, /禁止自动切换本机模型、其他云端、脚本或 HTTP/)
})
