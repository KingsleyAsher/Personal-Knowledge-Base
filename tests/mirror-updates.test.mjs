import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createUpdateChecker, createUpdateDownloader } from '../src/host/updates.js'

const stable = { package: '@local/dsh-knowledge-base', version: '1.1.4', tgz: 'local-dsh-knowledge-base-1.1.4.tgz', sha256: 'a'.repeat(64), bytes: 100, buildId: 'b'.repeat(16) }
const preview = { ...stable, version: '2.0.1-beta2', tgz: 'local-dsh-knowledge-base-2.0.1-beta2.tgz' }
test('domestic manifests work without GitHub; source links and status are explicit', async () => {
  let packages = 0
  const c = createUpdateChecker({ currentVersion: '1.1.3', fetch: async (url, options) => {
    if (url.includes('/dist/')) packages++
    if (url.includes('githubusercontent')) throw Error('offline')
    if (url.startsWith('https://gitee.com/')) return new Response(null, { status: 302, headers: { location: 'https://raw.giteeusercontent.com/file/' + (url.includes('preview') ? 'preview-manifest.json' : 'release-manifest.json') } })
    if (url.includes('api.gitcode')) assert.equal(options.headers.referer, 'https://gitcode.com/KingsleyAsher/Personal-Knowledge-Base')
    return Response.json(url.includes('preview') ? preview : stable)
  } })
  const result = await c.check()
  assert(result.ok && result.updateAvailable && result.preview.updateAvailable)
  assert.equal(result.sourceId, 'gitee'); assert.equal(result.downloadSources.length, 3)
  assert(result.downloadSources[1].url.startsWith('https://api.gitcode.com/'))
  assert.equal(result.sourceStatus.find(s => s.id === 'github').ok, false)
  assert.equal(packages, 0)
})
test('lagging mirror does not hide a newer release; equal-version hash conflicts fail closed', async () => {
  const newer = { ...stable, version: '1.1.5', tgz: 'local-dsh-knowledge-base-1.1.5.tgz' }
  let conflict = false
  const c = createUpdateChecker({ currentVersion: '1.1.4', previewManifestUrl: null, fetch: async url => Response.json(url.includes('gitee.com') ? (conflict ? { ...newer, sha256: 'c'.repeat(64) } : stable) : newer) })
  const r = await c.check(); assert.equal(r.latestVersion, '1.1.5'); assert(r.updateAvailable)
  conflict = true; assert.match((await c.check({ force: true })).error, /摘要不一致/)
})
test('reject login HTML, unsafe redirects, oversized and missing manifests; preview can survive stable failure', async () => {
  const c = createUpdateChecker({ currentVersion: '1.1.4', fetch: async url => {
    if (url.includes('preview')) return Response.json(preview)
    if (url.includes('gitee.com')) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
    if (url.includes('gitcode')) return new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })
    return new Response(' '.repeat(65537))
  } })
  const result = await c.check()
  assert.equal(result.ok, false); assert(result.preview.ok)
  assert.match(result.sourceStatus[0].error, /跳转不受信任/)
  assert.match(result.sourceStatus[1].error, /网页/)
  assert.match(result.sourceStatus[2].error, /大小/)
})
test('download falls through 403 and corrupt bytes to a verified GitHub package', async t => {
  const raw = await readFile(new URL('../dist/local-dsh-knowledge-base-1.1.4.tgz', import.meta.url))
  const release = { ...stable, ok: true, updateAvailable: true, latestVersion: stable.version, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), sourceId: 'gitee', sourceIds: ['gitee','gitcode','github'] }
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'kb-mirrors-')); t.after(() => rm(cacheDir, { force: true, recursive: true }))
  const urls = []
  const d = createUpdateDownloader({ checker: { check: async () => release }, cacheDir, fetch: async url => {
    urls.push(url)
    if (url.includes('gitee.com')) return new Response('', { status: 403 })
    if (url.includes('gitcode')) return new Response(Buffer.alloc(raw.length))
    return new Response(raw)
  } })
  const result = await d.prepare({ expectedVersion: stable.version })
  assert.equal(result.downloadSource, 'github'); assert.equal(urls.length, 3)
  assert.deepEqual(await readFile(result.spec), raw)
})
test('GitCode API alone can download a verified package anonymously', async t => {
  const raw = await readFile(new URL('../dist/local-dsh-knowledge-base-1.1.4.tgz', import.meta.url))
  const release = { ...stable, ok: true, updateAvailable: true, latestVersion: stable.version, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex'), sourceId: 'gitcode', sourceIds: ['gitcode'] }
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'kb-gitcode-')); t.after(() => rm(cacheDir, { force: true, recursive: true }))
  const d = createUpdateDownloader({ checker: { check: async () => release }, cacheDir, fetch: async (url, options) => {
    assert(url.includes('/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/') && url.endsWith('?ref=main'))
    assert(!options.headers.authorization && !options.headers.cookie)
    return new Response(raw)
  } })
  assert.equal((await d.prepare({ expectedVersion: stable.version })).downloadSource, 'gitcode')
})
