import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench, extractLinks } from '../src/host/workbench.js'
import { sharedDraft, captureDocument } from '../src/host/capture-surface.js'
import { Readable } from 'node:stream'

async function fixture() {
  const base = await mkdtemp(path.resolve('..', 'workbench-qa-'))
  const root = path.join(base, 'library'), stateDir = path.join(base, 'state')
  await mkdir(root)
  const core = createCore({ stateDir }, () => {})
  assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
  await mkdir(path.join(root, '20-知识笔记', 'empty'), { recursive: true })
  await writeFile(path.join(root, '20-知识笔记', 'alpha.md'), '---\ntitle: Alpha\ntype: 知识\ntags: [样本]\nstatus: 进行中\nupdated: 2026-10-20\n---\n公开蓝鲸证据。\n[另一个](beta.md)\n[隐藏](../00-画像/secret.md)\n')
  await writeFile(path.join(root, '20-知识笔记', 'beta.md'), '# Beta\n公开蓝鲸第二份。')
  await writeFile(path.join(root, '00-画像', 'secret.md'), '# 私密标题\n私密蓝鲸证据。')
  assert.equal((await core.maintainIndex()).ok, true)
  const wb = createWorkbench({ stateDir, getCore: () => core })
  const kbId = (await core.status()).kbId
  const call = args => wb.dispatch({ expectedKbId: kbId, ...args })
  const prefs = async patch => {
    const p = await call({ op: 'preferences.get' })
    return call({ op: 'preferences.save', expectedRevision: p.revision, preferences: { ...p.preferences, ...patch } })
  }
  return { base, root, stateDir, core, wb, kbId, call, prefs }
}

test('defaults, tree, search and all read endpoints hide private content server-side', async () => {
  const f = await fixture(), s = await f.call({ op: 'atlas.snapshot' })
  assert.equal(s.preferences.showPrivate, false); assert.equal(s.preferences.backup.enabled, false)
  const list = await f.call({ op: 'atlas.list' }); assert(!JSON.stringify(list).includes('secret.md'))
  const search = await f.call({ op: 'search.list', mode: 'body', q: '蓝鲸' }); assert.equal(search.total, 2)
  await assert.rejects(f.call({ op: 'atlas.detail', path: '00-画像/secret.md' }), { code: 'PRIVATE_HIDDEN' })
  const rel = await f.call({ op: 'atlas.relations' }); assert(!JSON.stringify(rel).includes('secret.md')); assert(rel.items.some(e => e.to.endsWith('beta.md')))
  const tree = await f.call({ op: 'atlas.tree', prefix: '20-知识笔记' }); assert(tree.items.some(d => d.path.endsWith('/empty')))
})

test('privacy display and model access are separate; closing invalidates old request policies', async () => {
  const f = await fixture()
  await f.prefs({ showPrivate: true })
  assert((await f.call({ op: 'atlas.list' })).items.some(i => i.path.includes('secret.md')))
  const s = await f.call({ op: 'atlas.snapshot' })
  const q = await f.call({ op: 'search.context', q: '蓝鲸', includePrivate: true, policyVersion: s.policyVersion })
  assert.equal(q.sources.length, 2)
  await f.prefs({ showPrivate: true, allowPrivateQuestions: true })
  const s2 = await f.call({ op: 'atlas.snapshot' })
  const q2 = await f.call({ op: 'search.context', q: '蓝鲸', includePrivate: true, policyVersion: s2.policyVersion })
  assert.equal(q2.sources.length, 3)
  await f.prefs({ showPrivate: false })
  assert.equal((await f.call({ op: 'preferences.get' })).preferences.allowPrivateQuestions, false)
  await assert.rejects(f.call({ op: 'atlas.list', policyVersion: s2.policyVersion }), { code: 'SETTINGS_CHANGED' })
  await assert.rejects(f.call({ op: 'search.validate', questionId: q2.questionId, answer: '[S1]' }), { code: 'CONTEXT_EXPIRED' })
})

test('onboarding lease is unique, defer is incomplete and completion survives instances', async () => {
  const f = await fixture(), first = 'window-0001', second = 'window-0002'
  assert.equal((await f.call({ op: 'onboarding.claim', owner: first })).claimed, true)
  assert.equal((await f.call({ op: 'onboarding.claim', owner: second })).claimed, false)
  await f.call({ op: 'onboarding.defer', owner: first })
  assert.equal((await f.call({ op: 'preferences.get' })).guideComplete, false)
  await f.call({ op: 'onboarding.claim', owner: second })
  const p = await f.call({ op: 'preferences.get' })
  await assert.rejects(f.call({ op: 'onboarding.complete', owner: second, expectedRevision: p.revision, preferences: { ...p.preferences, backup: { enabled: true } } }), { code: 'BACKUP_DIRECTORY_REQUIRED' })
  assert.equal((await f.call({ op: 'preferences.get' })).guideComplete, false)
  await f.call({ op: 'onboarding.complete', owner: second, expectedRevision: p.revision, preferences: p.preferences })
  const restarted = createWorkbench({ stateDir: f.stateDir, getCore: () => f.core })
  assert.equal((await restarted.dispatch({ op: 'onboarding.claim', owner: first })).completed, true)
})

test('conflicting settings and user data writes preserve newest revision', async () => {
  const f = await fixture(), p = await f.call({ op: 'preferences.get' })
  await f.prefs({ showPrivate: true })
  await assert.rejects(f.call({ op: 'preferences.save', expectedRevision: p.revision, preferences: p.preferences }), { code: 'CONFLICT' })
  const s = await f.call({ op: 'atlas.snapshot' })
  await f.call({ op: 'atlas.link.save', from: '20-知识笔记/alpha.md', to: '20-知识笔记/beta.md', expectedRevision: s.revision })
  await assert.rejects(f.call({ op: 'atlas.link.save', from: '20-知识笔记/alpha.md', to: '20-知识笔记/beta.md', expectedRevision: s.revision }), { code: 'CONFLICT' })
})

test('capture uses 快速收集, deduplicates and organizes into idempotent knowledge entries', async () => {
  const f = await fixture(), s = await f.call({ op: 'atlas.snapshot' })
  const r = await f.call({ op: 'capture.create', text: '采集蓝鲸', title: '采集样本', expectedRevision: s.revision })
  assert(r.capture.path.startsWith('90-收件箱/快速收集/'))
  const dup = await f.call({ op: 'capture.create', text: '采集蓝鲸', expectedRevision: r.revision }); assert(dup.requiresConfirmation)
  const org = await f.call({ op: 'capture.organize', id: r.capture.id, expectedRevision: dup.revision })
  assert.equal(org.capture.status, 'done'); assert(org.capture.entryId)
  const again = await f.call({ op: 'capture.organize', id: r.capture.id, expectedRevision: org.revision }); assert.equal(again.capture.entryId, org.capture.entryId)
  assert((await readFile(path.join(f.root, r.capture.path), 'utf8')).includes('采集蓝鲸'))
})

test('annotations validate original revision, export and review remain durable', async () => {
  const f = await fixture(), file = '20-知识笔记/alpha.md', d = await f.call({ op: 'atlas.detail', path: file })
  const a = await f.call({ op: 'reading.annotate', path: file, quote: '公开蓝鲸证据。', note: '备注', important: true, fileRevision: d.content.revision, expectedRevision: d.revision })
  const r = await f.call({ op: 'review.update', path: file, action: 'add', expectedRevision: a.revision })
  assert((await f.call({ op: 'reading.export' })).text.includes('公开蓝鲸证据。'))
  await assert.rejects(f.call({ op: 'reading.annotate', path: file, quote: '捏造文字', fileRevision: d.content.revision, expectedRevision: r.revision }), { code: 'QUOTE_NOT_FOUND' })
  assert.equal((await f.call({ op: 'reading.list' })).annotations.length, 1)
})

test('backup defaults off, rejects library path, verifies hashes and restores untouched originals', async () => {
  const f = await fixture(), destination = path.join(f.base, 'backups')
  await f.wb.runAutomatic(); assert(!(await readdir(f.base)).includes('backups'))
  await assert.rejects(f.call({ op: 'backup.create', directory: path.join(f.root, 'bad') }), { code: 'BACKUP_INSIDE_LIBRARY' })
  const before = await readFile(path.join(f.root, '20-知识笔记/alpha.md'))
  const backup = await f.call({ op: 'backup.create', directory: destination })
  assert(backup.manifest.complete, JSON.stringify(backup.manifest.issues))
  assert.equal((await f.call({ op: 'backup.verify', directory: destination, name: backup.name })).valid, true)
  const restored = path.join(f.base, 'restored')
  const result = await f.call({ op: 'backup.restore', directory: destination, name: backup.name, destination: restored })
  assert(result.verified); assert.deepEqual(await readFile(path.join(restored, '20-知识笔记/alpha.md')), before)
  assert.deepEqual(await readFile(path.join(f.root, '20-知识笔记/alpha.md')), before)
  await writeFile(path.join(destination, backup.name, 'files/20-知识笔记/alpha.md'), 'corrupt')
  assert.equal((await f.call({ op: 'backup.verify', directory: destination, name: backup.name })).valid, false)
})

test('citation validation rejects fabricated and changed sources', async () => {
  const f = await fixture(), snap = await f.call({ op: 'atlas.snapshot' })
  const q = await f.call({ op: 'search.context', q: '蓝鲸', policyVersion: snap.policyVersion })
  const c = await f.call({ op: 'search.validate', questionId: q.questionId, answer: '结论 [S1] [S999]' })
  assert.equal(c.valid.length, 1); assert.deepEqual(c.invalid, ['S999'])
  await writeFile(path.join(f.root, q.sources[0].path), '# changed')
  assert.deepEqual((await f.call({ op: 'search.validate', questionId: q.questionId, answer: '[S1]' })).invalid, ['S1'])
})

test('path traversal is rejected and code samples are not relationships', async () => {
  const f = await fixture()
  await assert.rejects(f.call({ op: 'atlas.detail', path: '../outside.md' }), { code: 'BAD_PATH' })
  assert.equal(extractLinks('```md\n[x](bad.md)\n```\n`[x](bad.md)`\n[x](good.md)').length, 1)
  assert.equal((await f.call({ op: 'atlas.relations', path: '20-知识笔记/alpha.md' })).items.filter(e => e.type === 'reference').length, 1)
})

test('clipper pairing is origin-bound, one-use, revocable and capture-only', async () => {
  const f = await fixture(), origin = 'chrome-extension://' + 'a'.repeat(32)
  const pair = await f.call({ op: 'capture.pair.create', origin })
  await assert.rejects(f.wb.clipper({ origin: 'chrome-extension://' + 'b'.repeat(32), code: pair.code }), { code: 'PAIRING_FAILED' })
  const grant = await f.wb.clipper({ origin, code: pair.code })
  await assert.rejects(f.wb.clipper({ origin, code: pair.code }), { code: 'PAIRING_FAILED' })
  const result = await f.wb.clipper({ origin, token: grant.token, item: { title: '剪藏样本', url: 'https://example.com/synthetic', text: '网页正文' } })
  assert(result.saved)
  assert((await f.call({ op: 'capture.list' })).items.some(c => c.title === '剪藏样本'))
  const list = await f.call({ op: 'capture.pair.list' }); assert.equal(list.items.length, 1)
  await f.call({ op: 'capture.pair.revoke', id: list.items[0].id })
  await assert.rejects(f.wb.clipper({ origin, token: grant.token, item: { text: '失败样本' } }), { code: 'CLIPPER_UNAUTHORIZED' })
})

test('new unindexed notes are searched from disk and system metadata cannot be previewed', async () => {
  const f = await fixture()
  await writeFile(path.join(f.root, '20-知识笔记/new.md'), '# 新文件\n新文件检索样本')
  const r = await f.call({ op: 'search.list', mode: 'body', q: '新文件检索样本', fresh: true })
  assert.equal(r.total, 1)
  await assert.rejects(f.call({ op: 'atlas.media', path: '.kbmeta/private.png' }), { code: 'SYSTEM_PATH' })
  await assert.rejects(f.call({ op: 'atlas.detail', path: '20-知识笔记/alpha.md:stream' }), { code: 'BAD_PATH' })
})

test('filtered backup excludes private originals and user-data references, restoring user data works', async () => {
  const f = await fixture(); await f.prefs({ showPrivate: true })
  const d = await f.call({ op: 'atlas.detail', path: '00-画像/secret.md' })
  await f.call({ op: 'reading.annotate', path: '00-画像/secret.md', quote: '私密蓝鲸证据。', fileRevision: d.content.revision, expectedRevision: d.revision })
  const backup = await f.call({ op: 'backup.create', directory: path.join(f.base, 'backups'), includePrivate: false })
  assert(backup.manifest.complete)
  assert(!backup.manifest.files.some(f => f.path.includes('secret.md')))
  const user = await readFile(path.join(f.base, 'backups', backup.name, 'files/.kbmeta/workbench-user-data.json'), 'utf8')
  assert(!user.includes('secret.md'))
})

test('ten thousand files paginate without silent loss and relation graph stays bounded', async () => {
  const f = await fixture(), folder = path.join(f.root, '20-知识笔记', 'scale')
  await mkdir(folder)
  const start = Date.now()
  for (let i = 0; i < 10000; i += 100) await Promise.all(Array.from({ length: 100 }, (_, j) => writeFile(path.join(folder, `n-${i+j}.md`), `# Scale ${i+j}\n[[n-${(i+j+1)%10000}]]\nSynthetic scale sample.\n`)))
  assert.equal((await f.core.maintainIndex()).ok, true)
  const list = await f.call({ op: 'atlas.list', prefix: '20-知识笔记/scale', offset: 9900 })
  assert.equal(list.total, 10000); assert.equal(list.items.length, 100); assert.equal(list.coverage.truncated, false)
  const graph = await f.call({ op: 'atlas.relations' })
  assert(graph.nodes.length <= 200); assert(graph.edges.length <= 500); assert(graph.graphLimited)
  assert(graph.total >= 10000)
  console.log('Scale evidence: 10000 files; elapsed=' + (Date.now()-start) + 'ms; relations=' + graph.total)
})

test('unbound onboarding saves future preferences but each newly bound library confirms before exposure', async () => {
  const base = await mkdtemp(path.resolve('..', 'workbench-unbound-')), stateDir = path.join(base, 'state')
  const core = createCore({ stateDir }, () => {}), wb = createWorkbench({ stateDir, getCore: () => core })
  const p = await wb.dispatch({ op: 'preferences.get' })
  assert.equal(p.kbId, null)
  await wb.dispatch({ op: 'onboarding.claim', owner: 'unbound-window' })
  await wb.dispatch({ op: 'onboarding.complete', owner: 'unbound-window', expectedRevision: p.revision, preferences: { ...p.preferences, showPrivate: true } })
  const library = path.join(base, 'library'); await mkdir(library)
  await core.bind(library, { confirmInit: true })
  const next = await wb.dispatch({ op: 'preferences.get' })
  assert.equal(next.needsConfirmation, true); assert.equal(next.preferences.showPrivate, false); assert.equal(next.suggestedDefaults.showPrivate, true)
  await wb.dispatch({ op: 'preferences.save', expectedKbId: next.kbId, expectedRevision: next.revision, preferences: next.suggestedDefaults })
  assert.equal((await wb.dispatch({ op: 'preferences.get' })).preferences.showPrivate, true)
})

test('automatic parsing requires completed onboarding and selected opt-in', async () => {
  const f = await fixture(); let submissions = 0
  const parser = { submit: async () => { submissions++; return { ok: true, jobId: 'synthetic-parse' } }, readJob: async () => null }
  const wb = createWorkbench({ stateDir: f.stateDir, getCore: () => f.core, getParsing: () => parser })
  const snap = await f.call({ op: 'atlas.snapshot' })
  await f.call({ op: 'capture.create', filename: 'synthetic.png', base64: Buffer.from('fake image').toString('base64'), expectedRevision: snap.revision })
  await f.prefs({ autoParse: true })
  await wb.runAutomatic(); assert.equal(submissions, 0)
  await f.call({ op: 'onboarding.claim', owner: 'parse-window' })
  const prefs = await f.call({ op: 'preferences.get' })
  await f.call({ op: 'onboarding.complete', owner: 'parse-window', expectedRevision: prefs.revision, preferences: prefs.preferences })
  await wb.runAutomatic(); assert.equal(submissions, 1)
})

test('single-file restore protects the current version and rejects outdated comparison', async () => {
  const f = await fixture(), directory = path.join(f.base, 'backups'), file = '20-知识笔记/alpha.md'
  const original = await readFile(path.join(f.root, file), 'utf8')
  const backup = await f.call({ op: 'backup.create', directory })
  await writeFile(path.join(f.root, file), '# user edit')
  const comparison = await f.call({ op: 'backup.restore-file', directory, name: backup.name, path: file })
  assert.equal(comparison.currentText, '# user edit'); assert.equal(comparison.backupText, original)
  await assert.rejects(f.call({ op: 'backup.restore-file', directory, name: backup.name, path: file, confirm: true, expectedHash: 'wrong' }), { code: 'FILE_CHANGED' })
  await f.call({ op: 'backup.restore-file', directory, name: backup.name, path: file, confirm: true, expectedHash: comparison.currentHash })
  assert.equal(await readFile(path.join(f.root, file), 'utf8'), original)
  assert((await readdir(path.join(f.root, '.kbmeta/backups'))).some(n => n.startsWith('restore-')))
})

test('mobile share intake parses files as an unsaved draft and escapes script-like input', async () => {
  const form = new FormData(); form.set('title', '手机分享样本'); form.set('text', '</script><script>globalThis.attacked=true</script>'); form.set('files', new File(['synthetic'], 'sample.txt'))
  const request = new Request('http://localhost/share', { method: 'POST', body: form })
  const req = Readable.from([Buffer.from(await request.arrayBuffer())]); req.method = 'POST'; req.headers = Object.fromEntries(request.headers); req.url = '/kb-core/collect'
  const draft = await sharedDraft(req)
  assert.equal(draft.files[0].filename, 'sample.txt'); assert.equal(Buffer.from(draft.files[0].base64, 'base64').toString(), 'synthetic')
  const html = captureDocument('<script type="application/json">__KB_CAPTURE_DRAFT__</script>', draft)
  assert(!html.includes('<script>globalThis'))
  assert.equal(JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))).text, draft.text)
})

test('mobile PWA declares explicit-confirmation share target and never caches API data', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/client/capture.webmanifest', import.meta.url), 'utf8'))
  assert.equal(manifest.share_target.action, '/kb-core/collect'); assert.equal(manifest.share_target.method, 'POST')
  const sw = await readFile(new URL('../src/client/capture-sw.js', import.meta.url), 'utf8')
  assert(!sw.includes("'/kb-core/api'")); assert(sw.includes("event.request.method !== 'GET'"))
})

test('HTML anchors and uppercase Markdown files produce links with exact repair evidence', async () => {
  const f = await fixture()
  const html = '<!-- <a href="missing-comment.md">ignored</a> -->\n<script>const x = \'<a href="missing-script.md">\';</script>\n<a class="local" href="20-知识笔记/alpha.md">Alpha</a>\n<a href="20-知识笔记/missing.md">Broken</a>\n<a href="https://example.org">External</a>'
  await writeFile(path.join(f.root, '知识库地图.html'), html)
  await writeFile(path.join(f.root, '20-知识笔记', 'upper.MD'), '[带标题](beta.md "说明")\n')
  f.wb.invalidate()
  const graph = await f.call({ op: 'atlas.relations', path: '知识库地图.html' })
  assert(graph.edges.some(e => e.from === '知识库地图.html' && e.to === '20-知识笔记/alpha.md'))
  assert.equal(graph.centerIssueTotal, 1)
  assert(graph.suggestedCenters.some(f => f.count > 0))
  const upper = await f.call({ op: 'atlas.relations', path: '20-知识笔记/upper.MD' })
  assert(upper.edges.some(e => e.to === '20-知识笔记/beta.md'))
  const issues = await f.call({ op: 'links.issues' })
  const broken = issues.items.find(i => i.path === '知识库地图.html')
  assert.equal(broken.line, 4)
  assert.equal(html.slice(broken.start, broken.end), '20-知识笔记/missing.md')
  const preview = await f.call({ op: 'links.preview', changes: [{ id: broken.id, target: '20-知识笔记/beta.md' }] })
  await f.call({ op: 'links.apply', previewId: preview.previewId })
  const repaired = await readFile(path.join(f.root, '知识库地图.html'), 'utf8')
  assert.equal(repaired, html.replace('20-知识笔记/missing.md', '20-知识笔记/beta.md'))
})

test('relations distinguish hidden links from absent links and keep private suggestions hidden', async () => {
  const f = await fixture()
  await writeFile(path.join(f.root, '20-知识笔记/alpha.md'), '[目录](INDEX.md)\n[隐私](../00-画像/secret.md)')
  await writeFile(path.join(f.root, '20-知识笔记/INDEX.md'), '# 目录')
  f.wb.invalidate()
  const hidden = await f.call({ op: 'atlas.relations', path: '20-知识笔记/alpha.md' })
  assert.equal(hidden.total, 0)
  assert.equal(hidden.unfilteredTotal, 1)
  assert(!JSON.stringify(hidden).includes('secret.md'))
  const shown = await f.call({ op: 'atlas.relations', path: '20-知识笔记/alpha.md', includeNavigation: true })
  assert.equal(shown.total, 1)
  assert(shown.suggestedCenters.some(f => f.path === '20-知识笔记/alpha.md'))
  const empty = await f.call({ op: 'atlas.relations', path: '20-知识笔记/beta.md' })
  assert.equal(empty.unfilteredTotal, 0)
})
