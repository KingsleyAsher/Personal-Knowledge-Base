import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createUpdateChecker, createUpdateDownloader, compareReleaseVersions } from '../src/host/updates.js'

const stable = { package: '@local/dsh-knowledge-base', version: '1.1.3', tgz: 'local-dsh-knowledge-base-1.1.3.tgz', sha256: 'a'.repeat(64) }
const preview = { ...stable, version: '2.0.1-beta1', tgz: 'local-dsh-knowledge-base-2.0.1-beta1.tgz', buildId: 'b'.repeat(16), bytes: 100 }
test('stable and preview checks are read-only; preview remains an independent user choice', async () => {
  const urls = []
  const checker = createUpdateChecker({ sourceIds: ['github'], currentVersion: '1.1.3', fetch: async url => { urls.push(url); return Response.json(url.endsWith('/preview-manifest.json') ? preview : stable) } })
  const result = await checker.check()
  assert.equal(result.updateAvailable, false)
  assert.equal(result.preview.updateAvailable, true)
  assert.equal(result.preview.latestVersion, '2.0.1-beta1')
  assert.equal(urls.length, 2)
  assert(urls.every(url => url.endsWith('manifest.json')))
  assert.equal(compareReleaseVersions('2.0.1-beta1', '2.0.1-beta1'), 0)
  assert.equal(compareReleaseVersions('2.0.1', '2.0.1-beta1'), 1)
  assert.equal(compareReleaseVersions('2.0.2-beta1', '2.0.1-beta1'), 1)
  assert.equal(compareReleaseVersions('2.0.1-beta.10', '2.0.1-beta.2'), 1)
  assert.throws(() => compareReleaseVersions('2.0.1-01', '2.0.1'))
})
test('unavailable or unsafe preview metadata does not break the stable channel', async () => {
  for (const bad of [null, { ...preview, tgz: '../bad.tgz' }, { ...preview, version: '2.0.1' }, { ...preview, bytes: 20 * 1024 * 1024 }]) {
    const checker = createUpdateChecker({ sourceIds: ['github'], currentVersion: '2.0.1-beta1', fetch: async url => {
      if (!url.endsWith('/preview-manifest.json')) return Response.json(stable)
      return bad ? Response.json(bad) : new Response('', { status: 404 })
    } })
    const result = await checker.check()
    assert.equal(result.ok, true); assert(result.previewError); assert.equal(result.preview, undefined)
  }
})
test('current preview does not repeat an update and stable successor is offered', async () => {
  const checker = createUpdateChecker({ sourceIds: ['github'], currentVersion: '2.0.1-beta1', fetch: async url => Response.json(url.endsWith('/preview-manifest.json') ? preview : { ...stable, version: '2.0.1', tgz: 'local-dsh-knowledge-base-2.0.1.tgz' }) })
  const result = await checker.check()
  assert.equal(result.preview.updateAvailable, false); assert.equal(result.updateAvailable, true)
})
test('explicit preview selection downloads and verifies that exact package; stale choice is rejected', async t => {
  const body = Buffer.from(JSON.stringify({ name: '@local/dsh-knowledge-base', version: preview.version, dsh: { bundle: {} } }))
  const header = Buffer.alloc(512); header.write('package/package.json'); header.write(body.length.toString(8).padStart(11, '0'), 124); header.fill(32, 148, 156); header.write('0', 156)
  header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
  const raw = gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512 + 1024)]))
  const release = { ...preview, latestVersion: preview.version, ok: true, updateAvailable: true, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') }
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'kb-beta-')); t.after(() => rm(cacheDir, { recursive: true, force: true }))
  let calls = 0
  const downloader = createUpdateDownloader({ checker: { check: async () => ({ ok: true, updateAvailable: false, preview: release }) }, cacheDir,
    fetch: async url => { calls++; assert(url.endsWith('/' + preview.tgz)); return new Response(raw) } })
  assert.equal((await downloader.prepare({ expectedVersion: preview.version })).latestVersion, preview.version)
  assert.equal(calls, 1)
  await assert.rejects(downloader.prepare({ expectedVersion: '2.0.1-beta2' }))
  assert.equal(calls, 1)
})
