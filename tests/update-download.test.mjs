import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createUpdateChecker, createUpdateDownloader, verifyUpdateArchive } from '../src/host/updates.js'

const manifest = JSON.parse(await readFile(new URL('../release-manifest.json', import.meta.url), 'utf8'))
const archive = await readFile(new URL(`../dist/${manifest.tgz}`, import.meta.url))
const release = (raw = archive) => ({ ok: true, updateAvailable: true, latestVersion: manifest.version, tgz: manifest.tgz,
  sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length, buildId: manifest.buildId })
async function sandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kb-update-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
function tarFixture({ name = 'package/package.json', type = '0', packageName = '@local/dsh-knowledge-base', version = manifest.version } = {}) {
  const body = Buffer.from(JSON.stringify({ name: packageName, version, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  const h = Buffer.alloc(512)
  h.write(name); h.write(body.length.toString(8).padStart(11, '0'), 124); h.fill(32, 148, 156); h.write(type, 156)
  h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  return gzipSync(Buffer.concat([h, body, Buffer.alloc((512 - body.length % 512) % 512 + 1024)]))
}

test('download uses fixed repository URL, verifies, deduplicates and reuses verified cache', async (t) => {
  const dir = await sandbox(t); let calls = 0
  const downloader = createUpdateDownloader({ checker: { check: async () => release() }, cacheDir: dir, fetch: async (url, options) => {
    calls++; assert.equal(url, `https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/${manifest.tgz}`)
    assert.equal(options.redirect, 'error'); return new Response(archive)
  } })
  const [a, b] = await Promise.all([downloader.prepare({ expectedVersion: manifest.version }), downloader.prepare({ expectedVersion: manifest.version })])
  assert.equal(a.spec, b.spec); assert.equal(calls, 1); assert.deepEqual(await readFile(a.spec), archive)
  assert.equal((await downloader.prepare({ expectedVersion: manifest.version })).cached, true)
  assert.equal(calls, 1)
  await writeFile(a.spec, 'bad cache')
  await downloader.prepare({ expectedVersion: manifest.version }); assert.equal(calls, 2)
})

test('no downgrade, no stale click, no arbitrary paths and no invalid metadata download', async (t) => {
  const dir = await sandbox(t); let calls = 0
  for (const data of [{ ...release(), updateAvailable: false }, { ...release(), bytes: 17 * 1024 * 1024 }, { ...release(), tgz: '../../evil.tgz' }, { ...release(), buildId: 'bad' }]) {
    const downloader = createUpdateDownloader({ checker: { check: async () => data }, cacheDir: dir, fetch: () => { calls++; throw Error('must not download') } })
    await assert.rejects(downloader.prepare({ expectedVersion: manifest.version }))
  }
  const downloader = createUpdateDownloader({ checker: { check: async () => release() }, cacheDir: dir, fetch: () => { calls++; throw Error('must not download') } })
  await assert.rejects(downloader.prepare({ expectedVersion: '0.0.0' }), /发布版本已变化/)
  assert.equal(calls, 0)
})

test('corrupt, truncated, oversized, HTTP and timed-out responses never leave an installable file', async (t) => {
  const dir = await sandbox(t)
  const badHash = Buffer.from(archive); badHash[10] ^= 1
  for (const body of [badHash, archive.subarray(0, 30), Buffer.concat([archive, Buffer.from('extra')])]) {
    const downloader = createUpdateDownloader({ checker: { check: async () => release() }, cacheDir: dir, fetch: async () => new Response(body) })
    await assert.rejects(downloader.prepare({ expectedVersion: manifest.version }))
  }
  const http = createUpdateDownloader({ checker: { check: async () => release() }, cacheDir: dir, fetch: async () => new Response('', { status: 503 }) })
  await assert.rejects(http.prepare({ expectedVersion: manifest.version }), /HTTP 503/)
  const timeout = createUpdateDownloader({ checker: { check: async () => release() }, cacheDir: dir, timeoutMs: 5,
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))) })
  await assert.rejects(timeout.prepare({ expectedVersion: manifest.version }), /超时/)
  assert.deepEqual(await readdir(path.join(dir, release().sha256)), [])
})

test('archive preflight checks package identity, version, traversal, links and tar checksum', () => {
  assert.equal(verifyUpdateArchive(archive, release()).version, manifest.version)
  const good = tarFixture(); assert.equal(verifyUpdateArchive(good, release(good)).name, '@local/dsh-knowledge-base')
  for (const fixture of [{ packageName: 'evil' }, { version: '1.1.4' }, { name: 'package/../package.json' }, { type: '2' }]) {
    const raw = tarFixture(fixture.version ? fixture : { ...fixture, version: '0.0.0' }); assert.throws(() => verifyUpdateArchive(raw, release(raw)))
  }
  const invalid = gunzipSync(good); invalid[0] ^= 1
  const raw = gzipSync(invalid)
  assert.throws(() => verifyUpdateArchive(raw, release(raw)), /tar 校验失败/)
})

test('checking alone never downloads a package', async () => {
  const data = release(); let calls = 0
  const checker = createUpdateChecker({ sourceIds: ['github'], previewManifestUrl: null, currentVersion: '2.0.1', fetch: async (url) => {
    calls++; assert.ok(url.endsWith('/release-manifest.json'))
    return Response.json({ ...data, package: '@local/dsh-knowledge-base', version: data.latestVersion })
  } })
  const result = await checker.check()
  assert.equal(result.updateAvailable, true); assert.equal(result.sha256, data.sha256); assert.equal(calls, 1)
})
