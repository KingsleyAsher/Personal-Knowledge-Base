import assert from 'node:assert/strict'
import { createUpdateChecker, startAutomaticChecks, compareStableVersions, UPDATE_MANIFEST_URL, UPDATE_INTERVAL_MS } from '../src/host/updates.js'

const manifest = version => ({ package: '@local/dsh-knowledge-base', version, tgz: 'local-dsh-knowledge-base-' + version + '.tgz', sha256: 'a'.repeat(64) })
assert.equal(compareStableVersions('1.0.10', '1.0.9'), 1)
assert.equal(compareStableVersions('2.0.0', '1.99.99'), 1)
assert.equal(compareStableVersions('1.0.3', '1.0.3'), 0)
assert.throws(() => compareStableVersions('1.0.3-beta', '1.0.3'))
assert.throws(() => compareStableVersions('01.0.3', '1.0.3'))
const scheduled = [], cleared = []
let automaticChecks = 0
const stop = startAutomaticChecks({check:()=>{automaticChecks++;return Promise.resolve()}},{
  setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return 'startup'},
  setInterval:(fn,ms)=>{scheduled.push({fn,ms});return 'interval'},
  clearTimeout:id=>cleared.push(id),clearInterval:id=>cleared.push(id),
})
assert.deepEqual(scheduled.map(job=>job.ms),[15000,UPDATE_INTERVAL_MS])
scheduled.forEach(job=>job.fn())
assert.equal(automaticChecks,2)
stop(); assert.deepEqual(cleared,['startup','interval'])
let calls = 0, clock = 1_000_000, mode = 'ok', latest = '1.0.4'
const checker = createUpdateChecker({ previewManifestUrl: null, currentVersion: '1.0.3', now: () => clock, fetch: async (url, options) => {
  calls++
  assert.equal(url, UPDATE_MANIFEST_URL)
  assert.equal(options.method, undefined)
  assert.equal(options.body, undefined)
  if (mode === 'network') throw Error('fetch failed')
  if (mode === 'http') return new Response('', {status: 503})
  if (mode === 'bad') return new Response('{')
  if (mode === 'oversize') return new Response(' '.repeat(65537))
  if (mode === 'wrong-package') return Response.json({...manifest(latest), package:'other'})
  if (mode === 'unsafe-link') return Response.json({...manifest(latest), tgz:'https://other.invalid/code.tgz'})
  if (mode === 'prerelease') return Response.json(manifest('1.0.5-beta'))
  await new Promise(resolve => setTimeout(resolve, 10))
  return Response.json(manifest(latest))
} })
const first = await Promise.all([checker.check(), checker.check(), checker.check({force:true})])
assert.equal(calls, 1)
assert.equal(first[0].updateAvailable, true)
assert.equal(first[0].latestVersion, '1.0.4')
assert.ok(first[0].downloadUrl.startsWith('https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/'))
assert.equal((await checker.check()).cached, true)
assert.equal(calls, 1)
latest = '1.0.3'; assert.equal((await checker.check({force:true})).updateAvailable, false)
latest = '1.0.2'; assert.equal((await checker.check({force:true})).ahead, true)
clock += UPDATE_INTERVAL_MS + 1
await checker.check(); assert.equal(calls, 4)
for (const bad of ['network','http','bad','oversize','wrong-package','unsafe-link','prerelease']) {
  mode = bad
  const result = await checker.check({force:true})
  assert.equal(result.ok, false, bad)
  assert.equal(result.updateAvailable, undefined, bad)
  assert.ok(result.error.includes('检查更新失败'), bad)
}
const before = calls
assert.equal((await checker.check()).cached, true)
assert.equal(calls, before)
clock += 5 * 60 * 1000 + 1
mode = 'ok'; latest = '1.0.4'
assert.equal((await checker.check()).ok, true)
assert.equal(calls, before + 1)
const timeout = createUpdateChecker({ previewManifestUrl: null,currentVersion:'1.0.3', timeoutMs:20, fetch:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))})
assert.ok((await timeout.check()).error.includes('超时'))
const preview = createUpdateChecker({ previewManifestUrl: null,currentVersion:'1.0.7-preview.1',fetch:async()=>Response.json(manifest(latest))})
latest='1.0.6';assert.equal((await preview.check({force:true})).ahead,true)
latest='1.0.7';assert.equal((await preview.check({force:true})).updateAvailable,true)
latest='1.0.8';assert.equal((await preview.check({force:true})).updateAvailable,true)
console.log('PASS: numeric versions; newer/equal/ahead; six-hour cache; concurrent/manual dedup; forced refresh; error retry; network/HTTP/JSON/size/package/path/prerelease failures; timeout')
