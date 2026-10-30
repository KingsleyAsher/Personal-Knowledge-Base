import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { initialRetrievalConfig } from '../src/host/retrieval-api.js'
import { createParsingService } from '../src/host/parsing.js'
import { createIndexPolicyService } from '../src/host/index-policy-service.js'
import { readJson } from '../src/host/workbench-state.js'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'
import { readIndexPolicy, resolveAssetPath, EXCLUDED_PARTITION } from '../src/host/index-policy.js'

async function fixture(run) {
  const base = await mkdtemp(path.resolve('..', 'kb-index-policy-'))
  let wb
  try {
    const root = path.join(base, 'library'), stateDir = path.join(base, 'state')
    await mkdir(root)
    const core = createCore({ stateDir }, () => {})
    assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
    wb = createWorkbench({ stateDir, getCore: () => core })
    const kbId = (await core.status()).kbId
    const call = args => wb.dispatch({ expectedKbId: kbId, ...args })
    await run({ root, stateDir, core, wb, kbId, call })
  } finally { wb?.dispose(); await rm(base, { recursive: true, force: true }) }
}

test('archived family moves together; all index generations and both relation directions are deleted, then restored', async () => fixture(async f => {
  await mkdir(path.join(f.root, '90-收件箱'), { recursive: true })
  const original = '90-收件箱/secret.txt'
  await writeFile(path.join(f.root, original), 'Synthetic PRIVATE_TOKEN')
  const derived = await f.core.createEntry({ title: 'private fixture', content: 'PRIVATE_TOKEN', source: original })
  assert.equal(derived.ok, true, JSON.stringify(derived))
  await f.call({ op: 'inbox.complete', path: original, entryPath: derived.path })
  const other = await f.core.createEntry({ title: 'public fixture', content: 'PUBLIC_TOKEN\n[link](' + derived.path + ')' })
  const snap = await f.call({ op: 'atlas.snapshot' })
  await f.call({ op: 'atlas.link.save', from: derived.path, to: other.path, expectedRevision: snap.revision })
  const before = await f.call({ op: 'atlas.relations', force: true })
  assert.ok(before.edges.some(e => e.from === derived.path || e.to === derived.path))
  assert.equal((await f.core.search({ query: 'PRIVATE_TOKEN' })).hits.length, 1)
  const vectorDir = path.join(f.root, '索引层', 'a'.repeat(32))
  await mkdir(vectorDir, { recursive: true }); await writeFile(path.join(vectorDir, 'vectors-0.bin'), 'sensitive old vector')
  await writeFile(path.join(vectorDir, 'catalog.json'), JSON.stringify({ documents: [{ path: derived.path }] }))
  const result = await f.call({ op: 'index.policy.set', paths: [derived.path], excluded: true })
  assert.equal(result.ok, true)
  const moved = result.mapping[derived.path], source = result.mapping[original]
  assert.ok(moved.startsWith(EXCLUDED_PARTITION + '/20-知识笔记/'))
  assert.ok(source.startsWith(EXCLUDED_PARTITION + '/90-收件箱/'))
  assert.match(await readFile(path.join(f.root, moved), 'utf8'), /排除索引分区\/90-收件箱/)
  assert.equal((await f.core.search({ query: 'PRIVATE_TOKEN' })).hits.length, 0)
  assert.equal((await f.call({ op: 'search.list', mode: 'fulltext', q: 'PRIVATE_TOKEN' })).items.length, 0)
  assert.equal((await f.call({ op: 'search.list', mode: 'path', q: 'secret' })).items.length, 0)
  await assert.rejects(stat(vectorDir), { code: 'ENOENT' })
  const graph = await f.call({ op: 'atlas.relations', force: true })
  assert.ok(graph.edges.every(e => ![e.from, e.to].some(p => p === derived.path || p.startsWith(EXCLUDED_PARTITION))))
  const entries = JSON.parse(await readFile(path.join(f.root, '.kbmeta/index/entries.json'), 'utf8'))
  assert.ok(entries.entries.every(e => e.path !== derived.path && !e.text.includes('PRIVATE_TOKEN')))
  const relationFiles = await readdir(path.join(f.stateDir, 'workbench/relations'))
  for (const name of relationFiles.filter(n => n.endsWith('.json'))) assert.ok(!(await readFile(path.join(f.stateDir, 'workbench/relations', name), 'utf8')).includes('private fixture'))
  assert.equal((await f.call({ op: 'atlas.detail', path: moved })).file.excludedFromIndex, true)
  const restored = await f.call({ op: 'index.policy.set', paths: [moved], excluded: false })
  assert.equal(restored.ok, true)
  assert.equal(restored.mapping[moved], derived.path)
  assert.equal(resolveAssetPath(f.root, source), original)
  assert.match(await readFile(path.join(f.root, derived.path), 'utf8'), /source:.*90-收件箱/)
  assert.equal((await f.core.search({ query: 'PRIVATE_TOKEN' })).hits.length, 1)
  const after = await f.call({ op: 'atlas.relations', force: true })
  assert.ok(after.edges.some(e => e.type === 'manual' && e.from === derived.path && e.to === other.path))
  assert.ok(after.edges.some(e => e.from === other.path && e.to === derived.path))
}))

test('pending exclusion survives reload; new parsed/archived entries inherit it without indexing and completion removes pending card', async () => fixture(async f => {
  let rows = await f.call({ op: 'capture.list' })
  const saved = await f.call({ op: 'capture.create', filename: 'input.txt', base64: Buffer.from('PENDING_TOKEN').toString('base64'), expectedRevision: rows.revision })
  const original = saved.capture.path
  assert.equal((await f.call({ op: 'search.list', mode: 'fulltext', q: 'PENDING_TOKEN' })).items.length, 0)
  const excluded = await f.call({ op: 'index.policy.set', paths: [original], excluded: true })
  const moved = excluded.mapping[original]
  assert.ok((await f.call({ op: 'inbox.list' })).items.some(i => i.path === moved && i.excludedFromIndex))
  const anotherCore = createCore({ stateDir: f.stateDir }, () => {})
  const parsed = await anotherCore.createEntry({ title: 'parsed', kind: '素材', source: original, content: 'PARSED_TOKEN' })
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  assert.ok(parsed.path.startsWith(EXCLUDED_PARTITION + '/40-素材资源/'))
  const final = await f.core.createEntry({ title: 'final', source: moved, content: 'ARCHIVED_TOKEN' })
  assert.equal(final.ok, true, JSON.stringify(final))
  assert.equal((await f.core.search({ query: 'ARCHIVED_TOKEN' })).hits.length, 0)
  const changed = await f.core.updateEntry({ entryId: final.entryId, expectedRevision: final.revision, content: 'ARCHIVED_TOKEN updated' })
  assert.equal(changed.ok, true, JSON.stringify(changed))
  await f.call({ op: 'inbox.complete', path: moved, entryPath: final.path })
  assert.equal((await f.call({ op: 'inbox.list' })).total, 0)
  await f.call({ op: 'index.policy.set', paths: [final.path], excluded: false })
  assert.equal((await f.core.search({ query: 'ARCHIVED_TOKEN' })).hits.length, 1)
  assert.equal((await f.core.search({ query: 'PARSED_TOKEN' })).hits.length, 1)
  assert.equal((await f.call({ op: 'inbox.list' })).total, 0)
}))

test('batch exclusion, cross-library guard and collision preserve files without overwriting', async () => fixture(async f => {
  const a = await f.core.createEntry({ title: 'a', content: 'A_TOKEN' })
  const b = await f.core.createEntry({ title: 'b', content: 'B_TOKEN' })
  const snap = await f.call({ op: 'atlas.snapshot' })
  await f.call({ op: 'atlas.link.save', from: a.path, to: b.path, expectedRevision: snap.revision })
  await assert.rejects(f.call({ op: 'index.policy.set', paths: [a.path], excluded: true, expectedKbId: 'wrong' }))
  const excluded = await f.call({ op: 'index.policy.set', paths: [a.path, b.path], excluded: true })
  assert.equal(excluded.groups.length, 2)
  await writeFile(path.join(f.root, a.path), 'user-created collision')
  await assert.rejects(f.call({ op: 'index.policy.set', paths: [excluded.mapping[a.path]], excluded: false }), /已存在/)
  assert.equal(await readFile(path.join(f.root, a.path), 'utf8'), 'user-created collision')
  assert.match(await readFile(path.join(f.root, excluded.mapping[a.path]), 'utf8'), /A_TOKEN/)
  assert.equal((await f.core.search({ query: 'A_TOKEN' })).hits.length, 0)
  assert.equal(readIndexPolicy(f.root).format, 1)
  await rm(path.join(f.root, a.path))
  await f.call({ op: 'index.policy.set', paths: [excluded.mapping[a.path]], excluded: false })
  const data = await readJson((await f.wb.binding()).dataFile, {})
  assert.equal(data.links.length, 0, 'a relation to another excluded group must not return early')
  await f.call({ op: 'index.policy.set', paths: [excluded.mapping[b.path]], excluded: false })
  assert.ok((await f.call({ op: 'atlas.relations', force: true })).edges.some(e => e.from === a.path && e.to === b.path))
}))

test('enabled embedding rebuild sends only allowed material and re-inclusion restores vector coverage', async () => fixture(async f => {
  const inputs = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); inputs.push(...body.input)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: text.includes('VECTOR_PRIVATE') ? [1,0] : [0,1] })) }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const privateEntry = await f.core.createEntry({ title: 'private vector', content: 'VECTOR_PRIVATE' })
    await f.core.createEntry({ title: 'public vector', content: 'VECTOR_PUBLIC' })
    await mkdir(path.join(f.root, '90-收件箱'), { recursive: true })
    await writeFile(path.join(f.root, '90-收件箱/pending.txt'), 'VECTOR_PENDING')
    const config = initialRetrievalConfig(); config.enabled = true; config.embedding.endpoint = 'http://127.0.0.1:' + server.address().port + '/embeddings'
    await f.call({ op: 'retrieval.save', config })
    const finish = async () => {
      for (let i = 0; i < 100; i++) {
        const s = await f.call({ op: 'retrieval.get' })
        if (s.progress.state === 'synced') return s
        if (['failed','paused'].includes(s.progress.state)) throw Error(JSON.stringify(s.progress))
        await new Promise(r => setTimeout(r, 10))
      }
      throw Error('vector build timeout')
    }
    const initialCount = (await finish()).estimate.completedVectors
    assert.ok(inputs.some(s => s.includes('VECTOR_PRIVATE')))
    assert.ok(inputs.every(s => !s.includes('VECTOR_PENDING')))
    inputs.length = 0
    const moved = await f.call({ op: 'index.policy.set', paths: [privateEntry.path], excluded: true })
    const excluded = await finish()
    assert.equal(excluded.estimate.completedVectors, initialCount - 1)
    assert.ok(inputs.every(s => !s.includes('VECTOR_PRIVATE') && !s.includes('VECTOR_PENDING')))
    const generations = (await readdir(path.join(f.root, '索引层'))).filter(n => /^[a-f0-9]{32}$/.test(n))
    for (const generation of generations) assert.ok(!(await readFile(path.join(f.root, '索引层', generation, 'catalog.json'), 'utf8')).includes(privateEntry.path))
    inputs.length = 0
    await f.call({ op: 'index.policy.set', paths: [moved.mapping[privateEntry.path]], excluded: false })
    assert.equal((await finish()).estimate.completedVectors, initialCount)
    assert.ok(inputs.some(s => s.includes('VECTOR_PRIVATE')))
    await f.call({ op: 'retrieval.pause' })
    inputs.length = 0
    await f.call({ op: 'index.policy.set', paths: [privateEntry.path], excluded: true })
    assert.equal((await f.call({ op: 'retrieval.get' })).progress.state, 'paused')
    assert.equal(inputs.length, 0, 'a user-paused embedding task must remain paused during exclusion')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}))

test('a failed cleanup keeps the policy denied and a retry resumes the same file group', async () => fixture(async f => {
  const note = await f.core.createEntry({ title: 'recoverable', content: 'RECOVERY_TOKEN' })
  const b = await f.wb.binding()
  const broken = createIndexPolicyService({ userData: b => readJson(b.dataFile, { revision: 0, captures: [], links: [], annotations: [], reading: {}, reviews: {} }), getParsing: () => null, invalidate: () => f.wb.invalidate(), notify() {}, purge: async () => { throw Error('simulated cleanup failure') }, rebuild: async () => {} })
  await assert.rejects(broken.set(b, { paths: [note.path], excluded: true }), /simulated/)
  const policy = readIndexPolicy(f.root), ids = Object.keys(policy.groups)
  assert.equal(ids.length, 1); assert.equal(policy.groups[ids[0]].state, 'failed')
  assert.equal((await f.core.search({ query: 'RECOVERY_TOKEN' })).hits.length, 0)
  const retry = await f.call({ op: 'index.policy.set', paths: [note.path], excluded: true })
  assert.deepEqual(retry.groups, ids)
  assert.match(await readFile(path.join(f.root, retry.mapping[note.path]), 'utf8'), /RECOVERY_TOKEN/)
}))

test('excluded OCR output is materialized beside the original and follows it back to normal storage', async () => fixture(async f => {
  await mkdir(path.join(f.root, '90-收件箱'), { recursive: true })
  const original = '90-收件箱/sample.png'
  await writeFile(path.join(f.root, original), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0R8AAAAASUVORK5CYII=', 'base64'))
  const parser = createParsingService({ stateDir: f.stateDir, getBinding: async () => ({ kbId: f.kbId, kbPath: f.root }), getCore: () => f.core,
    credentialStore: { configured: async () => true, read: async () => ({ apiKey: 'fixture', secretKey: 'fixture' }) },
    nativeRequest: async (_p, url) => url.includes('/token') ? { ok: true, json: { access_token: 'fixture-token', expires_in: 3600 } } : { ok: true, json: { words_result: [{ words: 'SYNTHETIC_OCR_TOKEN' }] } } })
  await parser.setPolicy('allow-configured', { viaAdmin: true })
  const provider = await parser.saveProvider({ kind: 'ocr', vendor: 'baidu', credentialRef: 'FIXTURE' }, { viaAdmin: true })
  assert.equal(provider.ok, true, JSON.stringify(provider))
  const wb = createWorkbench({ stateDir: f.stateDir, getCore: () => f.core, getParsing: () => parser })
  try {
    await wb.dispatch({ op: 'index.policy.set', expectedKbId: f.kbId, paths: [original], excluded: true })
    const submitted = await parser.submit({ kind: 'ocr', providerId: provider.provider.id, sourceRel: original })
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    let job
    for (let i = 0; i < 200; i++) { job = await parser.readJob(submitted.jobId); if (['succeeded','failed','partial'].includes(job.status)) break; await new Promise(r => setTimeout(r, 10)) }
    assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics))
    // Terminal job publication includes the materialized parse artifact.
    assert.ok(job.materializedFile?.startsWith(EXCLUDED_PARTITION + '/解析文件/'), JSON.stringify(job))
    assert.match(await readFile(path.join(f.root, job.materializedFile), 'utf8'), /SYNTHETIC_OCR_TOKEN/)
    assert.equal((await f.core.search({ query: 'SYNTHETIC_OCR_TOKEN' })).hits.length, 0)
    const restored = await wb.dispatch({ op: 'index.policy.set', expectedKbId: f.kbId, paths: [job.materializedFile], excluded: false })
    assert.ok(restored.mapping[job.materializedFile].startsWith('50-底稿/解析文件/'))
    assert.match(await readFile(path.join(f.root, restored.mapping[job.materializedFile]), 'utf8'), /SYNTHETIC_OCR_TOKEN/)
  } finally { wb.dispose() }
}))
