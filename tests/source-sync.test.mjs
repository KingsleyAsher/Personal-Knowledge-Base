import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createCore } from '../packages/kb-core/src/kbcore.js'
import { createWorkbench } from '../packages/kb-core/src/workbench.js'
import { createIndexMaintenance } from '../packages/kb-core/src/index-maintenance.js'
import { sourceReferenceBody } from '../packages/kb-core/src/source-references.js'
import { createRetrieval } from '../packages/kb-core/src/retrieval.js'
import { initialRetrievalConfig } from '../packages/kb-core/src/retrieval-api.js'
import { hash, structureDocument, embeddingText } from '../packages/kb-core/src/retrieval-chunks.js'
import { planImport, runImport } from '../packages/kb-core/src/importer.js'

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-source-sync-test-')), root = path.join(base, 'library'), stateDir = path.join(base, 'state')
  await mkdir(root)
  const core = createCore({ stateDir }, () => {})
  assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
  const kbId = (await core.status()).kbId, wb = createWorkbench({ stateDir, getCore: () => core, authorizeDocument: async () => true })
  t.after(async () => { wb.dispose(); await rm(base, { recursive: true, force: true }) })
  const call = args => wb.dispatch({ expectedKbId: kbId, ...args })
  const search = (q, extra = {}) => call({ op: 'search.list', mode: 'fulltext', q, fresh: true, ...extra })
  return { base, stateDir, root, core, wb, kbId, call, search }
}

test('organized text cites original ranges; client save updates JSON and rejects old locations', async t => {
  const f = await fixture(t), original = '# 原文件\n\n中文🧬。\n\n## 证据\n\nSOURCE_OLD_527\n'
  const saved = await f.call({ op: 'capture.create', filename: '原件 (测试).md', base64: Buffer.from(original).toString('base64'), expectedRevision: 0 })
  const org = await f.call({ op: 'capture.organize', id: saved.capture.id, expectedRevision: saved.revision })
  const source = org.capture.path, entry = org.capture.entryPath
  assert(!(await readFile(path.join(f.root, entry), 'utf8')).includes('SOURCE_OLD_527'))
  const hits = await f.search('SOURCE_OLD_527', { prefix: '20-知识笔记', path: entry })
  assert.equal(hits.items.length, 1); assert.equal(hits.items[0].path, source)
  const hit = hits.items[0]
  const expanded = await f.call({ op: 'search.expand', path: source, revision: hit.revision, start: hit.start })
  assert.equal(expanded.text, original.slice(expanded.start, expanded.end))
  assert.equal(expanded.line, original.slice(0, expanded.start).split('\n').length)
  const snapshot = await f.call({ op: 'atlas.snapshot' }), input = { expectedKbId: f.kbId, policyVersion: snapshot.policyVersion, path: source }
  const edit = await f.wb.documents.readForEdit(input, {})
  const current = '新增前段。\n\n' + original.replace('SOURCE_OLD_527', 'SOURCE_NEW_946')
  await f.wb.documents.save({ ...input, expectedRevision: edit.revision, text: current }, {})
  assert.equal((await f.core.maintainIndex({ paths: [source] })).ok, true)
  const index = JSON.parse(await readFile(path.join(f.root, '.kbmeta/index/entries.json'), 'utf8'))
  assert(index.entries.find(e => e.path === source).text.includes('SOURCE_NEW_946'))
  assert.equal((await f.search('SOURCE_OLD_527')).items.length, 0)
  assert.equal((await f.core.search({ query: 'SOURCE_OLD_527' })).hits.length, 0)
  assert.equal((await f.core.search({ query: 'SOURCE_NEW_946' })).hits[0].path, source)
  const updated = (await f.search('SOURCE_NEW_946')).items[0]
  assert.equal(updated.path, source)
  const range = await f.call({ op: 'search.expand', path: source, revision: updated.revision, start: updated.start })
  assert.equal(range.text, current.slice(range.start, range.end))
  await assert.rejects(f.call({ op: 'search.expand', path: source, revision: hit.revision, start: hit.start }), { code: 'FILE_CHANGED' })
})

test('legacy capture mirrors redirect to current source without rewriting user summaries', async t => {
  const f = await fixture(t), source = '90-收件箱/legacy.md'
  await mkdir(path.dirname(path.join(f.root, source)), { recursive: true })
  await writeFile(path.join(f.root, source), '# Legacy\nLEGACY_OLD_TOKEN\n')
  const mirror = await f.core.createEntry({ title: 'legacy', content: 'LEGACY_OLD_TOKEN', source, requestId: 'capture-legacy-fixture' })
  await f.call({ op: 'inbox.complete', path: source, entryPath: mirror.path })
  const summary = await f.core.createEntry({ title: 'User summary', content: 'INDEPENDENT_SUMMARY_TOKEN', source })
  await writeFile(path.join(f.root, source), '# Legacy\nLEGACY_NEW_TOKEN\n')
  assert.equal((await f.core.maintainIndex({ paths: [source] })).ok, true)
  assert.equal((await f.search('LEGACY_OLD_TOKEN')).items.length, 0)
  assert.equal((await f.search('LEGACY_NEW_TOKEN')).items[0].path, source)
  assert.equal((await f.search('INDEPENDENT_SUMMARY_TOKEN')).items[0].path, summary.path)
  assert.equal((await f.core.search({ query: 'LEGACY_OLD_TOKEN' })).hits.length, 0)
})

test('archives are searchable, pending inbox stays excluded, and exclusion covers source and references', async t => {
  const f = await fixture(t), archive = '90-收件箱/原件归档/项目资料/original.txt'
  await mkdir(path.dirname(path.join(f.root, archive)), { recursive: true })
  await writeFile(path.join(f.root, archive), 'ARCHIVED_SOURCE_TOKEN')
  await writeFile(path.join(f.root, '90-收件箱/pending.md'), 'PENDING_SOURCE_TOKEN')
  assert.equal((await f.core.maintainIndex()).ok, true)
  assert.equal((await f.search('ARCHIVED_SOURCE_TOKEN')).items[0].path, archive)
  assert.equal((await f.core.search({ query: 'ARCHIVED_SOURCE_TOKEN' })).hits[0].path, archive)
  assert.equal((await f.search('PENDING_SOURCE_TOKEN')).items.length, 0)
  const excluded = await f.call({ op: 'index.policy.set', paths: [archive], excluded: true })
  assert.equal((await f.search('ARCHIVED_SOURCE_TOKEN')).items.length, 0)
  await f.call({ op: 'index.policy.set', paths: [excluded.mapping[archive]], excluded: false })
  assert.equal((await f.search('ARCHIVED_SOURCE_TOKEN')).items[0].path, archive)
})

test('continuous saves reach maximum wait and a save during maintenance remains pending', async () => {
  let clock = 0, runs = 0, scheduler
  const core = { configGate: async () => ({ ok: true, conf: { kbPath: 'synthetic', revision: 1 } }), status: async () => ({ healthy: true, kbId: 'synthetic' }), maintainIndex: async () => { runs++; if (runs === 1) scheduler.notify('next.md'); return { ok: true, indexWritten: true } } }
  scheduler = createIndexMaintenance({ getCore: () => core, now: () => clock, quietMs: 5000, maximumWaitMs: 30000, minimumMs: 0, watch: () => ({ close() {}, on() {} }), timers: { setInterval: () => 1, clearInterval() {} } })
  try {
    await scheduler.tick()
    for (clock = 2000; clock <= 30000; clock += 2000) { scheduler.notify('sample.md'); await scheduler.tick() }
    assert.equal(runs, 1); assert.equal(scheduler.status().pending, true)
    clock = 35000; await scheduler.tick(); assert.equal(runs, 2)
  } finally { scheduler.dispose() }
})

test('private classification protects the associated original from search and direct preview', async t => {
  const f = await fixture(t)
  const saved = await f.call({ op: 'capture.create', filename: 'private.md', base64: Buffer.from('PRIVATE_SOURCE_784').toString('base64'), expectedRevision: 0 })
  await f.call({ op: 'capture.organize', id: saved.capture.id, kind: '画像', expectedRevision: saved.revision })
  assert.equal((await f.search('PRIVATE_SOURCE_784')).items.length, 0)
  await assert.rejects(f.call({ op: 'atlas.detail', path: saved.capture.path }), { code: 'PRIVATE_HIDDEN' })
})

test('copy imports cite editable archived originals and search their changed content', async t => {
  const f = await fixture(t), sourceDir = path.join(f.base, 'external')
  await mkdir(sourceDir); await writeFile(path.join(sourceDir, 'original.md'), '# Imported\nIMPORTED_OLD_573\n')
  const plan = await planImport({ stateDir: f.stateDir, source: sourceDir, target: f.root, mode: 'copy' })
  const result = await runImport({ core: f.core, stateDir: f.stateDir, importId: plan.importId })
  assert.equal(result.ok, true, JSON.stringify(result))
  const original = result.manifest.items[0].originalPath
  const policyFile = path.join(f.root, '.kbmeta/index-policy.json'), policy = JSON.parse(await readFile(policyFile, 'utf8'))
  for (const group of Object.values(policy.groups)) group.pending = true // Completed imports from older versions.
  await writeFile(policyFile, JSON.stringify(policy))
  assert.equal((await f.core.maintainIndex()).ok, true)
  assert.equal((await f.search('IMPORTED_OLD_573')).items[0].path, original)
  await writeFile(path.join(f.root, original), '# Imported\nIMPORTED_NEW_683\n')
  assert.equal((await f.core.maintainIndex({ paths: [original] })).ok, true)
  assert.equal((await f.search('IMPORTED_NEW_683')).items[0].path, original)
  assert.equal((await f.search('IMPORTED_OLD_573')).items.length, 0)
  assert.equal((await f.core.search({ query: 'IMPORTED_OLD_573' })).hits.length, 0)
  assert.equal((await readFile(path.join(sourceDir, 'original.md'), 'utf8')).includes('IMPORTED_OLD_573'), true)
})

test('original link click resolves encoded Chinese, spaces, parentheses and hash characters', async () => {
  const source = await readFile(new URL('../src/client/workbench-ui.js', import.meta.url), 'utf8')
  const begin = source.indexOf('    function textNodes(text) {'), end = source.indexOf("    return e('aside'", begin)
  const calls = [], errors = [], navigate = []
  const render = vm.runInNewContext(source.slice(begin, end) + '\ntextNodes', {
    detail: { annotations: [] }, content: {}, base: {}, file: '20-知识笔记/reference.md',
    e: (type, props, ...children) => ({ type, props, children }), setError: value => errors.push(value),
    api: async args => calls.push(args), onNavigate: (...args) => navigate.push(args),
  })
  const original = '90-收件箱/原件归档/项目资料/中文 原件(测试)#%.md'
  const button = render(sourceReferenceBody(original)).find(n => n?.type === 'button')
  assert(button); await button.props.onClick()
  assert.equal(calls[0].path, original); assert.equal(navigate[0][1], original); assert.equal(errors.length, 0)
})

test('source text edits embed only changed inputs; deleted sections reuse remaining vectors', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-vector-sync-test-'))
  let text = Array.from({ length: 8 }, (_, i) => `## Section ${i}\n\n` + `Section ${i} original paragraph. `.repeat(20) + '\n\n').join(''), calls = 0
  const binding = { key: 'synthetic', st: { kbId: 'synthetic' }, root: base }
  const service = createRetrieval({ stateDir: base, binding: async () => binding, versionOf: () => '1', visible: () => true,
    credentials: { read: async () => ({}) }, loadDocuments: async () => ({ documents: [{ path: 'source.md', title: 'Source', text, revision: hash(text), tags: [], private: false }], names: [], errors: [] }),
    fetcher: async (_url, args) => { const body = JSON.parse(args.body); calls += body.input.length; return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) }) },
  })
  t.after(async () => { service.dispose(); await rm(base, { recursive: true, force: true }) })
  async function finish() {
    for (let i = 0; i < 200; i++) {
      const status = await service.dispatch(binding, { op: 'retrieval.get' })
      if (status.progress.state === 'synced') return
      assert(!['failed', 'paused'].includes(status.progress.state), JSON.stringify(status.progress))
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('vector build timed out')
  }
  const config = initialRetrievalConfig(); config.enabled = true; config.embedding.endpoint = 'http://127.0.0.1/synthetic'
  await service.dispatch(binding, { op: 'retrieval.save', config }); await finish()
  const initial = calls, old = new Set(structureDocument(text, 'Source').chunks.map(c => hash(embeddingText(text, c))))
  text = text.replace('Section 3 original paragraph.', 'Section 3 revised paragraph.')
  const wanted = new Set(structureDocument(text, 'Source').chunks.map(c => hash(embeddingText(text, c))))
  const changed = [...wanted].filter(h => !old.has(h)).length
  await service.dispatch(binding, { op: 'retrieval.resume' }); await finish()
  assert.equal(calls - initial, changed); assert(changed > 0 && changed < initial)
  const beforeDelete = calls; text = text.slice(0, text.indexOf('## Section 7'))
  await service.dispatch(binding, { op: 'retrieval.resume' }); await finish(); assert.equal(calls, beforeDelete)
})
