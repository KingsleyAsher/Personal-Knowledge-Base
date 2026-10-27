import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm, utimes, open } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRuntimeResources } from '../src/host/runtime-resources.js'
import { createSourceReader, atomicJsonStream, sourceLine, sourceLineStart } from '../src/host/storage-io.js'
import { createIndexMaintenance } from '../src/host/index-maintenance.js'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'
import { createRelationIndex } from '../src/host/workbench-relation-index.js'

async function fixture(fn) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-runtime-'))
  try { await fn(base) } finally { await rm(base, { recursive: true, force: true }) }
}
const turn = () => new Promise(resolve => setImmediate(resolve))

test('shared watcher retains TXT events, excludes generated files and reconnects after error', async () => {
  const native = [], callbacks = [], events = []
  const r = createRuntimeResources({ watch: (_root, _options, callback) => { const w = new EventEmitter(); w.close = () => { w.closed = true }; native.push(w); callbacks.push(callback); return w } })
  const a = r.watch('.', {}, (_e, f) => events.push('a:' + f)), b = r.watch('.', {}, (_e, f) => events.push('b:' + f))
  assert.equal(native.length, 1)
  callbacks[0]('change', 'note.txt'); callbacks[0]('change', '索引层/manifest.json')
  assert.deepEqual(events, ['a:note.txt', 'b:note.txt'])
  a.on('error', () => a.close()); b.on('error', () => b.close()); native[0].emit('error', Error('offline'))
  const c = r.watch('.', {}, () => {}); assert.equal(native.length, 2)
  c.close(); assert.equal(r.stats().watchers, 0); r.dispose()
})

test('background lane serializes work, yields to foreground and cancels waiting work', async () => {
  const r = createRuntimeResources(), order = []
  let release
  const foreground = r.foreground(() => new Promise(resolve => { release = resolve }))
  const first = r.background(async () => { order.push(1); await turn(); order.push(2) })
  const c = new AbortController(), canceled = r.background(() => order.push(99), c.signal)
  c.abort(); await assert.rejects(canceled, { code: 'CANCELED' })
  const second = r.background(() => order.push(3))
  await turn(); assert.deepEqual(order, [])
  release(); await Promise.all([foreground, first, second]); assert.deepEqual(order, [1, 2, 3]); r.dispose()
})

test('streamed JSON preserves values and publish failure preserves old file without temp leaks', async () => fixture(async base => {
  const file = path.join(base, 'index.json'), value = { entries: Array.from({ length: 1000 }, (_, i) => ({ text: '中文\n'.repeat(10), i, absent: undefined })), nothing: null }
  await atomicJsonStream(file, value)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), JSON.parse(JSON.stringify(value)))
  const before = await readFile(file)
  await assert.rejects(atomicJsonStream(file, { changed: true }, { beforePublish() { throw Error('changed during serialization') } }))
  assert.deepEqual(await readFile(file), before)
  await assert.rejects(atomicJsonStream(file, value, { openFile: async (...args) => { const h = await open(...args); h.sync = async () => { throw Object.assign(Error('full'), { code: 'ENOSPC' }) }; return h } }), { code: 'ENOSPC' })
  assert.deepEqual(await readFile(file), before); assert.deepEqual(await readdir(base), ['index.json'])
  const child = spawnSync(process.execPath, ['-e', "require('fs').writeFileSync(process.argv[1]+'.tmp-kb-'+process.pid+'-'+require('crypto').randomUUID(), 'unfinished')", file])
  assert.equal(child.status, 0)
  const live = file + '.tmp-kb-' + process.pid + '-' + randomUUID(); await writeFile(live, 'active writer')
  await atomicJsonStream(file, value)
  assert.deepEqual((await readdir(base)).sort(), ['index.json', path.basename(live)].sort())
}))

test('request reader handles multibyte boundaries/BOM, reuse and same-size rewrites without cross-request cache', async () => fixture(async base => {
  const file = path.join(base, 'source.md'), reader = createSourceReader(), text = 'a'.repeat(256 * 1024 - 1) + '蓝鲸\n末尾条件'
  await writeFile(file, text)
  await reader.run(async () => {
    const first = await reader.read(file, Number.MAX_SAFE_INTEGER, true)
    assert.equal(first.text, text); assert.equal((await reader.read(file, Number.MAX_SAFE_INTEGER, true)).revision, first.revision)
    const old = await stat(file); await writeFile(file, text.replace('蓝鲸', '海豚')); await utimes(file, old.atime, old.mtime)
    assert.notEqual((await reader.read(file, Number.MAX_SAFE_INTEGER, true)).revision, first.revision)
  })
  assert.equal(reader.stats().reads, 2); assert.equal(reader.stats().reused, 1)
  await reader.run(() => reader.read(file, Number.MAX_SAFE_INTEGER, true)); assert.equal(reader.stats().reads, 3)
  await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('\ufeff中文\n', 'utf16le')]))
  assert.equal((await reader.read(file, Number.MAX_SAFE_INTEGER, true)).text, '\ufeff\ufeff中文\n')
  await writeFile(file, Buffer.from([0xff, 0x00])); await assert.rejects(reader.read(file, Number.MAX_SAFE_INTEGER, true), { code: 'TEXT_ENCODING' })
  const content = { text: 'a\r\n中文\n\n末尾\n' }
  for (let i = 0; i <= content.text.length; i++) assert.equal(sourceLine(content, i), content.text.slice(0, i).split('\n').length)
  for (let i = 1; i <= content.text.split('\n').length; i++) assert.equal(sourceLineStart(content, i), content.text.split('\n').slice(0, i - 1).join('\n').length + (i > 1 ? 1 : 0))
}))

test('core reuses verified JSON but rejects external corruption; one-file update keeps unrelated sources', async () => fixture(async base => {
  const root = path.join(base, 'library'); await mkdir(root)
  const core = createCore({ stateDir: path.join(base, 'state') }, () => {})
  assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
  await writeFile(path.join(root, 'a.md'), '# Blue\nEvidence A'); await writeFile(path.join(root, 'b.md'), '# Whale\nEvidence B')
  assert.equal((await core.maintainIndex()).ok, true)
  const conf = await core.getConfig()
  await core._internal.indexSnapshot(conf); const initial = core._internal.ioStats()
  await Promise.all(Array.from({ length: 4 }, () => core._internal.indexSnapshot(conf)))
  const after = core._internal.ioStats()
  assert.equal(after.indexReads, initial.indexReads); assert.equal(after.indexValidations, initial.indexValidations)
  assert.ok(after.diskMerged > initial.diskMerged)
  const file = path.join(root, '.kbmeta/index/entries.json'), data = JSON.parse(await readFile(file, 'utf8'))
  data.entries[0].text = 'tampered'; await writeFile(file, JSON.stringify(data))
  assert.equal((await core.indexFreshness()).reason, 'index-corrupt')
  assert.equal((await core.maintainIndex()).ok, true)
  const original = await readFile(path.join(root, 'b.md'))
  await writeFile(path.join(root, 'a.md'), '# Blue\nUpdated A')
  assert.equal((await core.maintainIndex({ paths: ['a.md'] })).ok, true)
  assert.deepEqual(await readFile(path.join(root, 'b.md')), original)
  const wb = createWorkbench({ stateDir: path.join(base, 'state'), getCore: () => core })
  try {
    const result = await wb.dispatch({ op: 'search.list', mode: 'body', q: 'Updated' })
    assert.equal(result.items.length, 1)
    assert.ok(wb.runtimeStats().sourceReads.reused > 0)
  } finally { wb.dispose() }
}))

test('relation restart reuses unchanged records without rewriting JSON', async () => fixture(async base => {
  const b = { key: 'test', root: base, st: { kbId: 'test' } }, files = [{ path: 'a.md', bytes: 10, mtimeMs: 1, ctimeMs: 2 }]
  const readText = async () => ({ text: '# A\n[[B]]', revision: 'revision' })
  await createRelationIndex({ stateDir: base, readText }).documents(b, files)
  const second = createRelationIndex({ stateDir: base, readText: () => { throw Error('unchanged source was read') } })
  await second.documents(b, files)
  assert.equal(second.entry(b).commits || 0, 0)
}))

test('transient disk failures retry automatically while identity protection remains paused', async () => {
  let clock = 0, calls = 0, reason = 'ENOSPC', callback
  const core = { configGate: async () => ({ ok: true, conf: { kbPath: 'test', revision: 1 } }), status: async () => ({ healthy: true, kbId: 'test' }), maintainIndex: async () => { calls++; return reason ? { ok: false, reason } : { ok: true } } }
  const s = createIndexMaintenance({ getCore: () => core, now: () => clock, timers: { setInterval: () => 1, clearInterval() {} }, watch: (_r, _o, fn) => { callback = fn; return { close() {}, on() {} } } })
  await s.tick()
  for (const time of [5000, 35000, 95000]) { clock = time; await s.tick() }
  assert.equal(calls, 3); assert.equal(s.status().state, 'retrying')
  reason = null; clock = 100000; callback('change', 'note.md'); clock = 125000; await s.tick()
  assert.equal(s.status().state, 'synced')
  reason = 'index-kbid-mismatch'; clock = 160000; callback('change', 'note.md'); clock = 165000; await s.tick()
  assert.equal(s.status().state, 'paused'); const before = calls
  callback('change', 'note.md'); clock = 1000000; await s.tick(); assert.equal(calls, before); s.dispose()
})

test('relation changes during a background scan advance to the newest snapshot without another poll', async () => fixture(async base => {
  const b = { key: 'latest', root: base, st: { kbId: 'latest' } }
  let release, blocked = false
  const service = createRelationIndex({ stateDir: base, readText: async (_b, file) => {
    if (blocked && file === 'a.md') { blocked = false; await new Promise(resolve => { release = resolve }) }
    return { text: '# A', revision: file + Date.now() }
  } })
  const a = { path: 'a.md', bytes: 1, mtimeMs: 1, ctimeMs: 1 }
  await service.documents(b, [a]); blocked = true
  await service.documents(b, [{ ...a, mtimeMs: 2 }], { background: true })
  while (!release) await turn()
  await service.documents(b, [{ ...a, mtimeMs: 2 }, { ...a, path: 'b.md' }], { background: true })
  await service.documents(b, [{ ...a, mtimeMs: 2 }, { ...a, path: 'b.md' }, { ...a, path: 'c.md' }], { background: true })
  release()
  for (let i = 0; i < 100 && (service.entry(b).pending || !service.entry(b).documents['c.md']); i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.deepEqual(Object.keys(service.entry(b).documents), ['a.md', 'b.md', 'c.md'])
  assert.equal(service.entry(b).commits, 3) // initial, active, latest (no intermediate snapshot)
}))
