// One bounded smoke run, synthetic sources and a stub engine only.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile, rename, readdir } from 'node:fs/promises'
import { createRelationIndex } from '../src/host/workbench-relation-index.js'
import { collectRelations } from '../src/host/workbench-links.js'
import { digest } from '../src/host/workbench-state.js'
import { createParseSourceAuthority } from '../src/host/parse-source-authority.js'
import { createParsingService } from '../src/host/parsing.js'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'

const output = await mkdtemp(path.resolve('../beta9-smoke-')), root = path.join(output, 'library'), stateDir = path.join(output, 'state'), workspace = path.join(output, 'workspace')
await mkdir(root); await mkdir(workspace)
let reads = 0, texts = { 'a.md': '[资料](b.md#标题)', 'b.md': '# 标题\n有效正文' }
const b = { key: 'synthetic', root, st: { kbId: 'synthetic' } }, files = () => Object.keys(texts).map(p => ({ path: p, bytes: texts[p].length, mtimeMs: texts[p].length, ctimeMs: texts[p].length, title: p }))
const reader = async (_, p) => { reads++; return { text: texts[p], revision: digest(texts[p]) } }
const index = createRelationIndex({ stateDir, readText: reader })
let docs = await index.documents(b, files()); assert.equal(reads, 2)
await index.documents(b, files()); assert.equal(reads, 2)
const diskIndex = createRelationIndex({ stateDir, readText: reader })
await diskIndex.documents(b, files()); assert.equal(reads, 2, 'restart reuses per-file cache')
texts['b.md'] += '\n新增'; docs = await index.documents(b, files()); assert.equal(reads, 3)
let graph = await collectRelations({ files: files(), readDocument: async p => docs[p], visible: () => true, links: [] })
assert.equal(graph.edges.length, 1); assert.equal(reads, 3)
texts['c.md'] = texts['b.md']; delete texts['b.md']; docs = await index.documents(b, files())
graph = await collectRelations({ files: files(), readDocument: async p => docs[p], visible: () => true, links: [] })
assert.equal(graph.edges.length, 0); assert.equal(graph.issues[0].reason, 'unresolved')
await index.documents(b, files(), { force: true }); assert.equal(index.entry(b).reads, 2)

const core = createCore({ stateDir: path.join(output, 'core-state') }, () => {})
assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
await writeFile(path.join(root, '20-知识笔记/a.md'), '# A\n[资料](b.md)')
await writeFile(path.join(root, '20-知识笔记/b.md'), '# B')
await core.maintainIndex()
let clock = Date.now()
const workbench = createWorkbench({ stateDir: path.join(output, 'core-state'), getCore: () => core, now: () => clock })
const snapshot = await workbench.dispatch({ op: 'atlas.snapshot' }), base = { expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion }
const relation = await workbench.dispatch({ ...base, op: 'atlas.relations', mode: 'overview' })
assert.equal(relation.sync.status, 'synced')
await workbench.dispatch({ ...base, op: 'reading.progress', path: '20-知识笔记/a.md', status: 'reading', position: 20, expectedRevision: snapshot.revision })
assert.equal((await workbench.dispatch({ ...base, op: 'atlas.relations', mode: 'overview' })).relationVersion, relation.relationVersion)
await rename(path.join(root, '20-知识笔记/b.md'), path.join(root, '20-知识笔记/c.md')); clock += 6000
const changed = await workbench.dispatch({ ...base, op: 'atlas.relations' }); assert(changed.issues.some(i => i.reason === 'unresolved'))

const binding = { kbId: snapshot.kbId, kbPath: root }
const agents = new Map(), a = { id: 'one', session: { header: { id: 's-one', cwd: workspace, agentPreset: 'coding' } } }, other = { id: 'two', session: { header: { id: 's-two', cwd: workspace, agentPreset: 'chat' } } }
agents.set(a.id, a); agents.set(other.id, other)
await writeFile(path.join(workspace, 'image.png'), 'synthetic image')
const authority = createParseSourceAuthority({ getAgents: () => agents, getBinding: async () => binding, knowledgeCaller: () => ({ ok: false }), getController: () => ({ attachment: async request => { assert.equal(request.sessionId, 's-one'); return { attachment: { mediaType: 'image/png', bytes: 3, name: 'fixture.png' }, data: Buffer.from('img').toString('base64') } } }) })
const source = await authority.issue('image.png', { agent: a })
assert((await authority.resolve(source.sourceRef, { agent: a })).external)
await assert.rejects(authority.resolve(source.sourceRef, { agent: other }), { code: 'SOURCE_REFERENCE_EXPIRED' })
await assert.rejects(authority.issue(path.join(root, '20-知识笔记/a.md'), { agent: a }), { code: 'KNOWLEDGE_DELEGATION_REQUIRED' })
await authority.issue('image.png', { agent: other })
const attachment = await authority.issueAttachment('owned-image', { agent: a }); assert.equal((await authority.resolve(attachment.sourceRef, { agent: a })).data.length, 3)

let conf = { followLinks: false, parsing: { externalPolicy: 'allow-configured', providers: [] } }, engineCalls = 0
const parserState = path.join(output, 'parser-state')
const parser = createParsingService({ stateDir: parserState, getBinding: async () => binding,
  lookup: async () => [{ address: '8.8.8.8', family: 4 }],
  getCore: () => ({ getConfig: async () => conf, setConfig: async patch => { conf = { ...conf, ...patch }; return { ok: true, revision: 1 } } }),
  credentialStore: { configured: async () => true, read: async () => ({ apiKey: 'synthetic', secretKey: 'synthetic' }) },
  nativeRequest: async (_, url) => { engineCalls++; return url.includes('/token') ? { ok: true, json: { access_token: 'synthetic', expires_in: 3600 } } : { ok: true, json: { words_result: [{ words: '虚构识别结果' }] } } } })
assert.equal((await parser.saveProvider({ id: 'fixture', kind: 'ocr', vendor: 'baidu', credentialRef: 'SYNTHETIC' }, { viaAdmin: true })).ok, true)
await parser.setDefaults({ kind: 'ocr', id: 'fixture' }, { viaAdmin: true })
const requestedBy = { via: 'tool', session: 's-one', agent: 'one' }
const submitted = await parser.submit({ kind: 'ocr' }, { requestedBy, authorizedSource: await authority.resolve(source.sourceRef, { agent: a }) })
assert.equal(submitted.ok, true, JSON.stringify(submitted)); assert(submitted.requestId)
for (let i = 0; i < 100; i++) { const j = await parser.readJob(submitted.jobId); if (['succeeded', 'failed'].includes(j.status)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
assert.equal((await parser.readJob(submitted.jobId)).status, 'succeeded')
assert.equal((await parser.readResult(submitted.jobId)).text, '虚构识别结果')
const calls = engineCalls, reused = await parser.submit({ kind: 'ocr' }, { requestedBy, authorizedSource: await authority.resolve(source.sourceRef, { agent: a }) })
assert.equal(reused.deduped, true); assert.equal(engineCalls, calls)
const secondSource = await authority.issue('image.png', { agent: other })
const secondTask = await parser.submit({ kind: 'ocr' }, { requestedBy: { via: 'tool', session: 's-two', agent: 'two' }, authorizedSource: await authority.resolve(secondSource.sourceRef, { agent: other }) })
assert.equal(secondTask.ok, true); assert.notEqual(secondTask.jobId, submitted.jobId)
for (let i = 0; i < 100; i++) { const j = await parser.readJob(secondTask.jobId); if (['succeeded', 'failed'].includes(j.status)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
assert.equal((await parser.readJob(secondTask.jobId)).status, 'succeeded')
const rejected = await parser.submit({ kind: 'ocr', sourceRel: '../escape.png' }, { requestedBy }); assert.equal(rejected.ok, false); assert(rejected.requestId)
assert((await parser.listRequests({ kind: 'ocr' })).requests.some(r => r.status === 'rejected'))
// More than eight mixed jobs demonstrate server-side kind + visibility before paging.
const jobsDir = path.join(parserState, 'parse', binding.kbId.replace(/[^a-zA-Z0-9_-]/g, ''), 'jobs')
const sample = await parser.readJob(submitted.jobId)
for (let i = 0; i < 25; i++) await writeFile(path.join(jobsDir, `fixture-${i}.json`), JSON.stringify({ ...sample, jobId: `fixture-${i}`, kind: i % 2 ? 'asr' : 'ocr', createdAt: new Date(Date.now() + i * 1000).toISOString(), requestedBy: { session: i % 3 ? 's-one' : 's-two' } }))
const filter = async rows => rows.filter(j => j.requestedBy.session === 's-one')
const page = await parser.listJobs({ kind: 'ocr', offset: 2, limit: 4, filter })
assert.equal(page.jobs.length, 4); assert(page.jobs.every(j => j.kind === 'ocr' && j.requestedBy.session === 's-one')); assert(page.total > 4)
assert.equal((await parser.listJobs({ kind: 'ocr', filter: async () => [] })).total, 0)
console.log(JSON.stringify({ passed: true, synthetic: true, realEngine: false, fullRegression: false, checks: ['关系重复查询与重启缓存', '单文件增量与重命名', '阅读进度不改变关系版本', '跨会话文件引用拒绝', '附件授权', '外部原件解析与去重复用', '提交拒绝留痕', '先筛选再分页'], output }))
