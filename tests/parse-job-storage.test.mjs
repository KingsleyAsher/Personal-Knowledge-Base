import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createParseJobStorage } from '../packages/kb-core/src/parse-job-storage.js'
import { createParsingService } from '../src/host/parsing.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const denied = () => Object.assign(new Error('synthetic locked destination'), { code: 'EPERM' })
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb-job-storage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('a held reader blocks replacement across storage instances, then queued reads see the new record', async t => {
  const root = await fixture(t), file = path.join(root, 'job.json')
  await writeFile(file, JSON.stringify({ status: 'queued' }))
  const entered = deferred(), release = deferred()
  let readerOpen = false, replacements = 0
  const reader = createParseJobStorage({ read: async (...args) => {
    readerOpen = true; entered.resolve(); await release.promise
    try { return await readFile(...args) } finally { readerOpen = false }
  } })
  const writer = createParseJobStorage({ replace: async (...args) => {
    assert.equal(readerOpen, false); replacements++; return rename(...args)
  } })
  const first = reader.read(file); await entered.promise
  const write = writer.write(file, { status: 'succeeded' })
  const last = writer.read(file)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(replacements, 0)
  release.resolve()
  assert.equal((await first).status, 'queued'); await write
  assert.equal((await last).status, 'succeeded'); assert.equal(replacements, 1)
})

test('transient replacement failures retry; exhausted failures preserve the old record and remove temporary files', async t => {
  const root = await fixture(t), file = path.join(root, 'job.json')
  await writeFile(file, JSON.stringify({ status: 'queued' }))
  let attempts = 0
  const store = createParseJobStorage({ delay: async () => {}, replace: async (...args) => {
    if (++attempts <= 2) throw denied()
    return rename(...args)
  } })
  await store.write(file, { status: 'running' }); assert.equal(attempts, 3)
  let failures = 0
  const blocked = createParseJobStorage({ delay: async () => {}, replace: async () => { failures++; throw denied() } })
  await assert.rejects(blocked.write(file, { status: 'succeeded' }), { code: 'EPERM' })
  assert.equal(failures, 8)
  assert.deepEqual(await store.read(file), { status: 'running' })
  assert.deepEqual(await readdir(root), ['job.json'])
  await store.write(file, { status: 'succeeded' }) // Failed queue must not poison later operations.
  assert.equal((await store.read(file)).status, 'succeeded')
})

for (const phase of ['initial', 'terminal', 'persistent']) {
  test(`background ${phase} write failure is caught, reported and recoverable`, { timeout: 10000 }, async t => {
    const root = await fixture(t), library = path.join(root, 'library')
    await mkdir(library); await writeFile(path.join(library, 'image.png'), 'synthetic image')
    const binding = { kbId: 'synthetic-library', kbPath: library }, store = createParseJobStorage()
    let injected = false, block = true, calls = 0
    const reported = deferred()
    let config = { parsing: { externalPolicy: 'allow-configured', providers: [] } }
    const options = {
      stateDir: path.join(root, 'state'), getBinding: async () => binding,
      getCore: () => ({ getConfig: async () => config, setConfig: async patch => { config = { ...config, ...patch }; return { ok: true, revision: 1 } } }),
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      credentialStore: { configured: async () => true, read: async () => ({ apiKey: 'synthetic', secretKey: 'synthetic' }) },
      nativeRequest: async (_provider, url) => {
        if (url.includes('/token')) return { ok: true, json: { access_token: 'synthetic', expires_in: 3600 } }
        calls++; return { ok: true, json: { words_result: [{ words: 'SYNTHETIC_RESULT' }] } }
      },
      onEvent: event => { if (event.type === 'parse-job-error') reported.resolve(event) },
      jobStorage: { read: file => store.read(file), write: async (file, job) => {
        if (block && (phase === 'persistent' ? job.status !== 'queued' : !injected && job.status === (phase === 'initial' ? 'running' : 'succeeded'))) {
          injected = true; throw denied()
        }
        return store.write(file, job)
      } },
    }
    let service = createParsingService(options)
    const provider = await service.saveProvider({ kind: 'ocr', vendor: 'baidu', credentialRef: 'SYNTHETIC' }, { viaAdmin: true })
    assert.equal(provider.ok, true)
    const submitted = await service.submit({ kind: 'ocr', providerId: provider.provider.id, sourceRel: 'image.png' })
    assert.equal(submitted.ok, true)
    const event = await reported.promise
    assert.equal(event.code, 'JOB_STATE_WRITE_FAILED'); assert.equal(event.cause, 'EPERM')
    assert.equal(event.persisted, phase !== 'persistent')
    let job = await service.readJob(submitted.jobId)
    assert.equal(job.status, phase === 'persistent' ? 'queued' : 'failed')
    assert.equal(calls, phase === 'terminal' ? 1 : 0)
    if (phase === 'terminal') assert.match(job.result.text, /SYNTHETIC_RESULT/)
    block = false
    if (phase === 'persistent') {
      service = createParsingService({ ...options, jobStorage: store })
      await service.recover()
      assert.equal((await service.readJob(submitted.jobId)).status, 'failed')
    }
    assert.equal((await service.retry(submitted.jobId)).ok, true)
    for (let i = 0; i < 300; i++) {
      job = await service.readJob(submitted.jobId)
      if (job.status === 'succeeded') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(job.status, 'succeeded'); assert.match(job.result.text, /SYNTHETIC_RESULT/)
  })
}
