import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { normalizeParsingConfig, normalizeProvider, createParsingService } from '../packages/kb-core/src/parsing.js'
import { createNativeAdapter } from '../packages/kb-core/src/parse-native.js'

test('DeepSeek defaults pin official APIs and retain saved choices and privacy policy', () => {
  const fresh = normalizeParsingConfig(null)
  assert.equal(fresh.ok, true)
  assert.equal(fresh.value.defaultOcr, 'deepseek-ocr')
  assert.equal(fresh.value.defaultAsr, 'deepseek-asr')
  assert.equal(fresh.value.externalPolicy, 'allow-configured')
  const p = normalizeProvider({ id: 'deepseek-ocr', vendor: 'deepseek', kind: 'ocr', baseUrl: 'https://attacker.test', locality: 'local' }).value
  assert.equal(p.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(p.locality, 'cloud')
  assert.equal(p.credentialRef, 'DEEPSEEK_API_KEY')
  assert.equal(p.maxPages, 1000)
  const saved = { providers: [p], defaultOcr: null, externalPolicy: 'local-only' }
  assert.equal(normalizeParsingConfig(saved).value.defaultOcr, null)
  assert.equal(normalizeParsingConfig(saved).value.externalPolicy, 'local-only')
})

test('DeepSeek multipart fields, OCR truncation, ASR text and HTTP-200 errors', async () => {
  let response, last
  const a = createNativeAdapter({ credentials: { read: async () => ({ apiKey: 'synthetic-key' }) }, request: async (p, url, init) => { last = { url, init }; return { ok: true, json: response } } })
  const p = normalizeProvider({ id: 'deepseek-ocr', kind: 'ocr', vendor: 'deepseek' }).value
  response = { page_count: 1, pages: [{ index: 0, text: 'page text', finish_reason: 'length' }] }
  const ocr = await a.recognize(p, Buffer.from('synthetic file'), 'application/pdf', { extension: 'pdf' })
  assert.equal(ocr.ok, true)
  assert.equal(ocr.pages[0].finish_reason, 'length')
  assert.equal(last.url, 'https://api.deepseek.com/v1/tools/ocr')
  const body = last.init.body.toString()
  assert.ok(last.init.body.includes(Buffer.from([13, 10])), 'multipart must contain real CRLF bytes')
  assert.ok(!body.includes(String.fromCharCode(92) + 'r'), 'multipart must not contain escaped CRLF text')
  assert.match(body, /name="purpose"\r\n\r\ntext_recognition/)
  assert.match(body, /filename="source.pdf"/)
  assert.doesNotMatch(body, /name="model"/)
  response = { error: { message: 'sensitive provider body' } }
  const failed = await a.recognize(p, Buffer.from('file'), 'image/png', {})
  assert.equal(failed.ok, false)
  assert.doesNotMatch(JSON.stringify(failed), /sensitive provider body/)
  response = { text: 'transcript', duration_ms: 500 }
  const asr = await a.recognize({ ...p, kind: 'asr', protocol: 'deepseek-asr' }, Buffer.from('wav'), 'audio/wav', {})
  assert.equal(asr.text, 'transcript')
  assert.equal(last.url, 'https://api.deepseek.com/v1/tools/asr')
  assert.doesNotMatch(last.init.body.toString(), /name="purpose"|name="model"/)
})

test('service routes PDF directly and converts long audio into bounded PCM chunks; local-only blocks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kb-deepseek-'))
  let config = {}, requests = []
  const service = createParsingService({ stateDir: path.join(root, 'state'), getBinding: async () => ({ kbId: 'synthetic', kbPath: root }), getCore: () => ({ getConfig: async () => config, setConfig: async patch => { config = { ...config, ...patch }; return { ok: true } } }), credentialStore: { read: async () => ({ apiKey: 'synthetic-key' }), configured: async () => true }, nativeRequest: async (p, url, init) => {
    requests.push({ p, url, init })
    if (p.kind === 'ocr') return { ok: true, json: { page_count: 2, pages: [{ index: 0, text: 'first', finish_reason: 'stop' }, { index: 1, text: 'second', finish_reason: 'length' }] } }
    assert.match(init.body.toString('latin1'), /RIFF[\s\S]*WAVE/)
    assert.ok(init.body.length < 8 * 1024 * 1024)
    return { ok: true, json: { text: 'transcribed chunk', duration_ms: 50000 } }
  } })
  async function wait(id) {
    for (let i = 0; i < 500; i++) {
      const job = await service.readJob(id)
      if (['succeeded', 'partial', 'failed'].includes(job.status)) return job
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw Error('job timed out')
  }
  try {
    await writeFile(path.join(root, 'document.pdf'), 'synthetic PDF: no local rendering should occur')
    const submitted = await service.submit({ kind: 'ocr', sourceRel: 'document.pdf' })
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    const ocr = await wait(submitted.jobId)
    assert.equal(ocr.status, 'partial', JSON.stringify(ocr))
    assert.equal(ocr.result.pageCount, 2)
    assert.match(ocr.result.text, /first[\s\S]*second/)
    assert.equal(requests.length, 1)
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '121', '-c:a', 'pcm_s16le', path.join(root, 'long.wav')])
    const audio = await service.submit({ kind: 'asr', sourceRel: 'long.wav' })
    assert.equal(audio.ok, true, JSON.stringify(audio))
    const asr = await wait(audio.jobId)
    assert.equal(asr.status, 'succeeded', JSON.stringify(asr))
    assert.equal(asr.result.segments.length, 3)
    assert.equal(asr.result.segments[0].granularity, 'chunk')
    await service.setPolicy('local-only', { viaAdmin: true })
    const before = requests.length
    assert.equal((await service.submit({ kind: 'ocr', sourceRel: 'document.pdf' })).reason, 'LOCAL_ONLY_BLOCKED')
    assert.equal(requests.length, before)
  } finally { service.dispose?.(); await rm(root, { recursive: true, force: true }) }
})
