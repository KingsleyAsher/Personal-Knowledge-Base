import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { createParsingService, normalizeProvider } from '../src/host/parsing.js'
import { createParseCredentials } from '../src/host/parse-credentials.js'
import { createNativeAdapter } from '../src/host/parse-native.js'
import { createParseDiscovery } from '../src/host/parse-discovery.js'

const admin = { viaAdmin: true }
const root = await mkdtemp(path.resolve('..', 'parse-qa-'))
function fixture(options = {}) {
  let config = { parsing: { providers: [], externalPolicy: 'local-only' } }, revision = 0
  const deps = { stateDir: path.join(root, 'state-' + Math.random()), getBinding: async () => ({ kbId: 'synthetic', kbPath: root }), getCore: () => ({ getConfig: async () => config, setConfig: async patch => { config = { ...config, ...patch }; return { ok: true, revision: ++revision } } }), lookup: async () => [{ address: '93.184.216.34', family: 4 }], ...options }
  const service = createParsingService(deps)
  return { service, config: () => config, stateDir: deps.stateDir, restart: () => createParsingService(deps) }
}
const waitJob = async (s, id) => { for (let i = 0; i < 400; i++) { const j = await s.readJob(id); if (['succeeded', 'partial', 'failed', 'canceled'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 25)) } throw Error('job timeout') }
const waitScan = async (d, id) => { for (let i = 0; i < 400; i++) { const r = d.get(id); if (r.scan.status !== 'running') return r.scan; await new Promise(r => setTimeout(r, 5)) } throw Error('scan timeout') }

test('native presets pin endpoints, enforce region/model and retain legacy providers', () => {
  const q = normalizeProvider({ id: 'qwen-test', kind: 'ocr', vendor: 'qwen', baseUrl: 'https://attacker.test' })
  assert.equal(q.ok, true); assert.equal(q.value.baseUrl, 'https://dashscope.aliyuncs.com/api/v1')
  assert.equal(normalizeProvider({ id: 'qwen-test', kind: 'asr', vendor: 'qwen', model: 'filetrans' }).ok, false)
  assert.equal(normalizeProvider({ id: 'qwen-test', kind: 'ocr', vendor: 'qwen', workspaceId: '../bad' }).ok, false)
  assert.equal(normalizeProvider({ id: 'qwen-test', kind: 'ocr', vendor: 'qwen', region: 'bad' }).ok, false)
  const w = normalizeProvider({ id: 'qwen-test', kind: 'asr', vendor: 'qwen', region: 'ap-southeast-1', workspaceId: 'workspace-123' })
  assert.equal(w.value.baseUrl, 'https://workspace-123.ap-southeast-1.maas.aliyuncs.com/api/v1')
  const legacy = normalizeProvider({ id: 'legacy', kind: 'asr', protocol: 'cli-transcribe', locality: 'local', command: 'C:\\python.exe', args: ['C:\\adapter.py'], notes: 'keep' })
  assert.equal(legacy.ok, true); assert.deepEqual(legacy.value.args, ['C:\\adapter.py'])
})

test('DPAPI roundtrip, no plaintext on disk, preserve/change/clear/reuse and admin gate', async () => {
  const dir = path.join(root, 'credentials')
  const c = createParseCredentials(dir)
  const ref = await c.save({ apiKey: 'qa-secret-value', secretKey: 'qa-secret-pair' })
  assert.deepEqual(await c.read(ref), { apiKey: 'qa-secret-value', secretKey: 'qa-secret-pair' })
  assert.equal((await readFile(path.join(dir, 'parse-credentials', ref))).includes(Buffer.from('qa-secret-value')), false)
  const { service: s, config } = fixture({ credentialStore: c })
  assert.equal((await s.saveProvider({ vendor: 'qwen', kind: 'ocr' })).reason, 'ADMIN_ONLY')
  assert.equal((await s.scanStart({})).reason, 'ADMIN_ONLY')
  const a = await s.saveProvider({ vendor: 'qwen', kind: 'ocr' }, { ...admin, credentialInput: { apiKey: 'qa-new' } })
  assert.equal(a.ok, true); assert.equal(a.provider.credentialConfigured, true)
  assert.equal(JSON.stringify(config()).includes('qa-new'), false)
  assert.equal((await s.providersPublic()).defaultOcr, null)
  const b = await s.saveProvider({ ...a.provider, label: 'edited' }, admin)
  assert.equal(b.provider.credentialRef, a.provider.credentialRef)
  const changed = await s.saveProvider(b.provider, { ...admin, credentialInput: { apiKey: 'qa-replaced' } })
  assert.notEqual(changed.provider.credentialRef, b.provider.credentialRef)
  const reused = await s.saveProvider({ kind: 'asr', vendor: 'qwen', credentialRef: changed.provider.credentialRef }, admin)
  assert.equal(reused.provider.credentialConfigured, true)
  const cleared = await s.saveProvider(changed.provider, { ...admin, clearCredential: true })
  assert.equal(cleared.provider.credentialConfigured, false)
  process.env.KB_QA_TOKEN = 'legacy-secret'
  assert.equal((await c.read('KB_QA_TOKEN')).apiKey, 'legacy-secret')
  delete process.env.KB_QA_TOKEN
})

test('four native request/response formats, no raw error body, token refresh and no blind retries', async () => {
  let tokens = 0, calls = [], expire = true
  const adapter = createNativeAdapter({ credentials: { read: async () => ({ apiKey: 'qa-key', secretKey: 'qa-pair' }) }, request: async (p, url, init) => {
    calls.push({ p, url, init })
    if (url.includes('/token')) return { ok: true, json: { access_token: 'qa-token-' + (++tokens), expires_in: 3600 } }
    if (p.protocol.startsWith('dashscope')) return { ok: true, json: { output: { choices: [{ message: { content: [{ text: '原生识别结果' }] } }] }, request_id: 'qwen-req', usage: { input_tokens: 1 } } }
    if (expire) { expire = false; return { ok: true, json: { error_code: 110 } } }
    return { ok: true, json: p.kind === 'ocr' ? { words_result: [{ words: '第一行' }, { words: '第二行' }], log_id: 123 } : { err_no: 0, result: ['转写结果'] } }
  } })
  for (const [kind, protocol] of [['ocr', 'dashscope-ocr'], ['asr', 'dashscope-asr'], ['ocr', 'baidu-ocr'], ['asr', 'baidu-asr']]) {
    const p = normalizeProvider({ id: 'native-test', kind, protocol }).value
    const r = await adapter.recognize(p, Buffer.from('fixture'), kind === 'ocr' ? 'image/png' : 'audio/wav', {})
    assert.equal(r.ok, true)
    const call = calls.filter(c => !c.url.includes('/token')).at(-1)
    if (protocol.startsWith('dashscope')) { const b = JSON.parse(call.init.body); assert.ok(b.input.messages[0].content[0][kind === 'ocr' ? 'image' : 'audio'].startsWith('data:')); assert.ok(call.url.endsWith('/multimodal-generation/generation')) }
    if (protocol === 'baidu-ocr') assert.equal(new URLSearchParams(call.init.body).get('image'), Buffer.from('fixture').toString('base64'))
    if (protocol === 'baidu-asr') { const b = JSON.parse(call.init.body); assert.equal(b.len, 7); assert.equal(b.rate, 16000); assert.equal(b.dev_pid, 1537) }
  }
  assert.equal(tokens, 2)
  let requests = 0
  const bad = createNativeAdapter({ credentials: { read: async () => ({ apiKey: 'x' }) }, request: async () => { requests++; return { ok: true, json: { code: 'QuotaExhausted', message: 'contains-qa-secret' } } } })
  const r = await bad.recognize({ protocol: 'dashscope-asr', kind: 'asr', baseUrl: 'https://fixture', model: 'qwen3-asr-flash' }, Buffer.from('x'), 'audio/wav', {})
  assert.equal(r.code, 'QuotaExhausted'); assert.equal(requests, 1); assert.ok(!JSON.stringify(r).includes('contains-qa-secret'))
})

test('directory discovery: multiple models, unknown weights, depth/entry limits, cancellation and no script execution', async () => {
  const dir = path.join(root, '目录 with spaces')
  for (const name of ['Qwen3-ASR', 'PaddleOCR-VL', 'unknown']) {
    await mkdir(path.join(dir, name), { recursive: true })
    await writeFile(path.join(dir, name, 'model.safetensors'), '')
    await writeFile(path.join(dir, name, 'config.json'), JSON.stringify({ model_type: name }))
    await writeFile(path.join(dir, name, 'run.cmd'), 'exit 99')
  }
  const d = createParseDiscovery()
  const a = await d.start({ mode: 'directory', directory: dir })
  const scan = await waitScan(d, a.scan.id)
  assert.equal(scan.results.length, 3)
  assert.equal(scan.results.find(r => r.name === 'unknown').status, 'unsupported')
  assert.ok(scan.results.every(r => r.status !== 'reachable'))
  const single = await d.start({ mode: 'directory', directory: path.join(dir, 'Qwen3-ASR') })
  assert.equal((await waitScan(d, single.scan.id)).results.length, 1)
  assert.equal((await d.start({ mode: 'directory', directory: 'relative' })).reason, 'ABSOLUTE_DIRECTORY_REQUIRED')
  assert.equal((await d.start({ mode: 'directory', directory: path.join(dir, 'absent') })).reason, 'DIRECTORY_MISSING')
  const empty = path.join(root, 'empty'); await mkdir(empty)
  const e = await d.start({ mode: 'directory', directory: empty }); assert.equal((await waitScan(d, e.scan.id)).results.length, 0)
  const limited = createParseDiscovery({ limits: { maxEntries: 2, maxDepth: 0 } })
  const b = await limited.start({ mode: 'directory', directory: dir }); assert.equal((await waitScan(limited, b.scan.id)).incomplete, true)
  const canceled = await d.start({ mode: 'directory', directory: dir }); d.cancel(canceled.scan.id)
  assert.equal((await waitScan(d, canceled.scan.id)).status, 'canceled')
  const linked = path.join(root, 'junction'); await symlink(dir, linked, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await d.start({ mode: 'directory', directory: linked })).reason, 'NOT_DIRECTORY')
})

test('native cloud policy blocks before credentials or source are sent', async () => {
  let calls = 0
  const { service: s } = fixture({ nativeRequest: async () => { calls++; throw Error('must not request') } })
  const p = await s.saveProvider({ vendor: 'qwen', kind: 'ocr' }, admin)
  assert.equal((await s.testConnection(p.provider.id)).reason, 'LOCAL_ONLY_BLOCKED')
  assert.equal((await s.submit({ providerId: p.provider.id, kind: 'ocr', sourceRel: 'anything.png' })).reason, 'LOCAL_ONLY_BLOCKED')
  assert.equal(calls, 0)
})

test('PP component roles, separate model/runtime paths, malformed URL and versioned validation',async()=>{
  const dir=path.join(root,'component deployment')
  for(const name of ['PP-DocLayoutV3','PP-OCRv5_server_det','PP-OCRv5_server_rec']){
    await mkdir(path.join(dir,name),{recursive:true})
    await writeFile(path.join(dir,name,'inference.yml'),'Global:\n  model_name: '+name)
    await writeFile(path.join(dir,name,'inference.pdiparams'),'synthetic weight marker')
  }
  const d=createParseDiscovery(), started=await d.start({mode:'directory',directory:dir}),scan=await waitScan(d,started.scan.id)
  const layout=scan.results.find(r=>r.role==='layout')
  assert.equal(layout.status,'component');assert.equal(layout.candidate.protocol,'paddle-service')
  assert.equal(layout.candidate.layoutModelPath,path.join(dir,'PP-DocLayoutV3'))
  for(const r of scan.results.filter(r=>['detection','recognition'].includes(r.role))){assert.equal(r.candidate.detModelPath,path.join(dir,'PP-OCRv5_server_det'));assert.equal(r.candidate.recModelPath,path.join(dir,'PP-OCRv5_server_rec'))}
  const asr=normalizeProvider({id:'split-asr',kind:'asr',vendor:'local',protocol:'qwen3-local',locality:'local',command:path.join(dir,'separate env'),modelPath:path.join(dir,'separate weights'),ffmpegCommand:path.join(dir,'tools')})
  assert.equal(asr.ok,true);assert.equal(asr.value.command,path.join(dir,'separate env','Scripts','python.exe'));assert.equal(asr.value.ffmpegCommand,path.join(dir,'tools','ffmpeg.exe'))
  assert.equal(normalizeProvider({id:'bad-url',kind:'ocr',vendor:'local',protocol:'paddle-service',locality:'local',command:asr.value.command,baseUrl:'http://['}).ok,false)
})

test('native OCR uses the same multi-page PDF pipeline and preserves request ids', async () => {
  const python = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim()
  const pdf = path.join(root, 'two-pages.pdf')
  execFileSync(python, ['-X', 'utf8', '-c', 'import pymupdf,sys; d=pymupdf.open(); d.new_page(); d.new_page(); d.save(sys.argv[1])', pdf], { windowsHide: true })
  let calls = 0
  const { service: s } = fixture({ nativeRequest: async (p, url, init) => {
    assert.equal(p.protocol, 'baidu-ocr')
    if (url.includes('/token')) return { ok: true, json: { access_token: 'fixture-token', expires_in: 3600 } }
    calls++
    assert.ok(new URLSearchParams(init.body).get('image'))
    return { ok: true, json: { words_result: [{ words: '第 ' + calls + ' 页识别' }], log_id: calls } }
  }, credentialStore: { read: async () => ({ apiKey: 'fixture', secretKey: 'pair' }), configured: async () => true } })
  await s.setPolicy('allow-configured', admin)
  const p = await s.saveProvider({ kind: 'ocr', vendor: 'baidu', credentialRef: 'KB_QA_TOKEN', renderCommand: python }, admin)
  const j = await s.submit({ kind: 'ocr', providerId: p.provider.id, sourceRel: 'two-pages.pdf' })
  const done = await waitJob(s, j.jobId)
  assert.equal(done.status, 'succeeded', JSON.stringify(done.diagnostics))
  assert.equal(done.result.pages.length, 2); assert.equal(calls, 2)
  assert.equal(done.diagnostics.filter(d => d.code === 'PROVIDER_REQUEST').length, 2)
})

test('native errors preserve status without automatic quota, permission or malformed response retries', async () => {
  for (const code of ['HTTP_401', 'HTTP_403', 'HTTP_429', 'PARSE_TIMEOUT', 'BAD_JSON']) {
    let calls = 0
    const a = createNativeAdapter({ credentials: { read: async () => ({ apiKey: 'fixture' }) }, request: async () => { calls++; return { ok: false, code, detail: 'fixed-safe-error' } } })
    const p = normalizeProvider({ id: 'error-fixture', kind: 'asr', vendor: 'qwen' }).value
    const r = await a.recognize(p, Buffer.from('fixture'), 'audio/wav', {})
    assert.equal(r.code, code); assert.equal(calls, 1)
  }
  let tokens = 0
  const a = createNativeAdapter({ credentials: { read: async () => ({ apiKey: 'fixture', secretKey: 'pair' }) }, request: async (p, url) => url.includes('/token') ? { ok: true, json: { access_token: 'expired-' + (++tokens), expires_in: 1 } } : { ok: true, json: { result: ['fixture'] } } })
  const p = normalizeProvider({ id: 'expire-fixture', kind: 'asr', vendor: 'baidu' }).value
  await a.recognize(p, Buffer.from('fixture'), 'audio/wav', {})
  await a.recognize(p, Buffer.from('fixture'), 'audio/wav', {})
  assert.equal(tokens, 2)
})

test('legacy HTTP parsing retains behavior; model listing is not parsing', async () => {
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'fixture-ocr' }] }))
    else { for await (const _ of req) {} res.end(JSON.stringify({ choices: [{ message: { content: '兼容识别结果' } }] })) }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    const { service: s } = fixture()
    const p = await s.saveProvider({ id: 'legacy-http', kind: 'ocr', protocol: 'openai-vision', locality: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-ocr' }, admin)
    assert.equal(p.ok, true)
    assert.equal((await s.testConnection(p.provider.id)).kind, 'connection')
    await writeFile(path.join(root, 'fixture.png'), Buffer.from('synthetic-image'))
    const j = await s.submit({ kind: 'ocr', providerId: p.provider.id, sourceRel: 'fixture.png' })
    const done = await waitJob(s, j.jobId)
    assert.equal(done.status, 'succeeded'); assert.ok(done.result.text.includes('兼容识别结果'))
  } finally { await new Promise(r => server.close(r)) }
})

function wav(seconds) {
  const bytes = seconds * 32000, b = Buffer.alloc(44 + bytes)
  b.write('RIFF'); b.writeUInt32LE(bytes + 36, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40)
  return b
}
test('long native ASR converts, checkpoints and retries only failures', async () => {
  let calls = 0
  const { service: s } = fixture({ nativeRequest: async (p, url) => {
    calls++
    return calls === 2 ? { ok: false, code: 'HTTP_429' } : { ok: true, json: { output: { choices: [{ message: { content: [{ text: '片段 ' + calls }] } }] }, request_id: 'fixture-' + calls } }
  }, credentialStore: { read: async () => ({ apiKey: 'synthetic' }), configured: async () => true } })
  await s.setPolicy('allow-configured', admin)
  const p = await s.saveProvider({ vendor: 'qwen', kind: 'asr', credentialRef: 'KB_QA_TOKEN' }, admin)
  await writeFile(path.join(root, 'long.wav'), wav(65))
  const j = await s.submit({ providerId: p.provider.id, kind: 'asr', sourceRel: 'long.wav' })
  const partial = await waitJob(s, j.jobId)
  assert.equal(partial.status, 'partial', JSON.stringify(partial.diagnostics)); assert.equal(calls, 2)
  assert.equal(partial.result.segments.length, 2); assert.equal(partial.result.segments[1].status, 'failed')
  assert.ok(partial.result.text.includes('识别失败')); assert.equal(partial.result.segments[0].granularity, 'chunk')
  assert.equal((await s.retry(j.jobId)).retryKind, 'parse')
  assert.equal((await waitJob(s, j.jobId)).status, 'succeeded'); assert.equal(calls, 3)
  const j2 = await s.submit({ providerId: p.provider.id, kind: 'asr', sourceRel: 'long.wav', purpose: 'test' })
  assert.equal(j2.deduped, true)
})

test('restart recovers successful ASR pieces; changed source refuses checkpoint reuse', async () => {
  let calls = 0
  const f = fixture({ nativeRequest: async () => {
    calls++
    return calls === 2 ? { ok: false, code: 'HTTP_429' } : { ok: true, json: { output: { choices: [{ message: { content: [{ text: '恢复片段' }] } }] } } }
  }, credentialStore: { read: async () => ({ apiKey: 'synthetic' }), configured: async () => true } })
  const s = f.service
  await s.setPolicy('allow-configured', admin)
  const p = await s.saveProvider({ vendor: 'qwen', kind: 'asr', credentialRef: 'KB_QA_TOKEN' }, admin)
  await writeFile(path.join(root, 'restart.wav'), wav(65))
  const j = await s.submit({ providerId: p.provider.id, kind: 'asr', sourceRel: 'restart.wav' })
  const partial = await waitJob(s, j.jobId)
  assert.equal(partial.status, 'partial')
  // Simulate a persisted interrupted record, after the old runner has finished.
  partial.status = 'running'; partial.stage = 'transcribing'
  await writeFile(path.join(f.stateDir, 'parse', 'synthetic', 'jobs', j.jobId + '.json'), JSON.stringify(partial))
  const recovered = f.restart()
  assert.equal((await recovered.recover()).recovered, 1)
  assert.equal((await waitJob(recovered, j.jobId)).status, 'succeeded')
  assert.equal(calls, 3)
  // A changed original must never be mixed with the successful saved pieces.
  const finished = await recovered.readJob(j.jobId)
  finished.status = 'failed'; finished.attempts = 1
  await writeFile(path.join(f.stateDir, 'parse', 'synthetic', 'jobs', j.jobId + '.json'), JSON.stringify(finished))
  await writeFile(path.join(root, 'restart.wav'), wav(66))
  assert.equal((await recovered.retry(j.jobId)).ok, true)
  const changed = await waitJob(recovered, j.jobId)
  assert.equal(changed.status, 'failed'); assert.equal(changed.diagnostics.at(-1).code, 'SOURCE_CHANGED'); assert.equal(calls, 3)
})

test('cancel native ASR preserves completed pieces and retry runs only the rest', async () => {
  let calls = 0, secondStarted
  const started = new Promise(resolve => { secondStarted = resolve })
  const f = fixture({ nativeRequest: async (p, url, init, context) => {
    calls++
    if (calls === 2) { secondStarted(); return new Promise(resolve => context.signal.addEventListener('abort', () => resolve({ ok: false, code: 'CANCELED' }), { once: true })) }
    return { ok: true, json: { output: { choices: [{ message: { content: [{ text: '完成片段' }] } }] } } }
  }, credentialStore: { read: async () => ({ apiKey: 'synthetic' }), configured: async () => true } })
  const s = f.service
  await s.setPolicy('allow-configured', admin)
  const p = await s.saveProvider({ vendor: 'qwen', kind: 'asr', credentialRef: 'KB_QA_TOKEN' }, admin)
  await writeFile(path.join(root, 'cancel.wav'), wav(65))
  const j = await s.submit({ providerId: p.provider.id, kind: 'asr', sourceRel: 'cancel.wav' })
  await started
  await s.cancel(j.jobId)
  const canceled = await waitJob(s, j.jobId)
  assert.equal(canceled.status, 'canceled'); assert.equal(canceled.chunkResults[0].ok, true)
  await s.retry(j.jobId)
  assert.equal((await waitJob(s, j.jobId)).status, 'succeeded'); assert.equal(calls, 3)
})

test('DPAPI storage and native adapters are packaged', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.files.includes('tools/kb-local-model.py'))
})
