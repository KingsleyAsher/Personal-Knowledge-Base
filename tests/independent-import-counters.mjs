// 审查方 16 条独立反例的**直接转换**（p4）。
//
// 来源：审查方交付的导入反例脚本（verify-import.mjs，未随仓库分发）
// 转换原则（复核意见第 4 点）：
//   · 保留原反例（同夹具、同判定表达式），但**断言方向反过来**：`defect === false` 才算关闭；
//   · 与新产品契约冲突的地方（只有 tool-attach 一条）保留原表达式作为 originalDefect，另加符合新契约的检查，
//     并在 detail 里写明为什么改（写入目标是 B、完成后才切库——所以"命中在 A"不再是缺陷判据）。
//   · 所有检查都落到真实磁盘与独立 core，不用"只加文字断言"。
//
// 用法：node tests/independent-import-counters.mjs [--json <out>]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, readFile, readdir, utimes, symlink } from 'node:fs/promises'
import { createCore } from '../src/host/kbcore.js'
import { apply } from '../src/host/index.js'
import { planImport, runImport, readManifest, isValidImportId } from '../src/host/importer.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(process.env.KB_TEST_ROOT ?? path.join(here, 'fixtures-import-counters'))
await mkdir(root, { recursive: true })
const results = []
const unverified = []
const record = (name, defect, details) => {
  results.push({ name, defect, ...details })
  console.log(`${defect ? 'FAIL' : 'PASS'} ${name}${defect ? '' : ''} — ${JSON.stringify(details).slice(0, 260)}`)
}
const put = async (p, t) => { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, t, 'utf8') }
const conf = (kb, state) => ({ kbPath: kb, stateDir: state, categories: ['00-画像', '10-项目', '20-知识笔记', '30-人物关系', '40-素材资源', '90-收件箱'], privateDirs: ['00-画像', '30-人物关系', '10-项目/私密'], excludeFromSearch: ['.kb', '.kbmeta', '.kb-state', '50-底稿', '_archive', '_工具', '知识库地图'], followLinks: false })
async function ownCore(name) {
  const kb = path.join(root, name, 'kb'); const stateDir = path.join(root, name, 'state')
  await mkdir(kb, { recursive: true })
  const core = createCore(conf(kb, stateDir), () => {})
  await core.getConfig()
  const b = await core.bind(kb, { confirmInit: true })
  if (!b.ok) throw Error(JSON.stringify(b))
  return { kb, stateDir, core }
}

// A: 旧库恰好使用产品标准目录名，不能因此推断为新生成物。
{
  const src = path.join(root, 'legacy')
  await put(path.join(src, '20-知识笔记', 'old.txt'), 'legacy knowledge')
  await put(path.join(src, '00-画像', 'old.txt'), 'synthetic private profile')
  const p = await planImport({ stateDir: path.join(root, 'legacy-state'), source: src, target: src, mode: 'attach' })
  record('legacy-managed-names-skipped', p.items.length === 0, { sourceFiles: p.scan.files, planned: p.counts.total, skippedDirs: p.skippedDirs })
}
// B: 计划没有冻结哈希，同长度改写无法被发现。
{
  const src = path.join(root, 'freeze-source'); await put(path.join(src, 'a.txt'), 'AAAA')
  const stateDir = path.join(root, 'freeze-state')
  const p = await planImport({ stateDir, source: src, target: src, mode: 'attach' })
  await put(path.join(src, 'a.txt'), 'BBBB')
  let body = ''
  const r = await runImport({ stateDir, importId: p.importId, core: { createEntry: async (a) => { body = a.content; return { ok: true, entryId: 'test', path: 'entry.md' } } } })
  record('planned-hash-and-same-size-change', p.items[0].sha256 === null && r.ok && body.includes('BBBB'), { plannedSha256: p.items[0].sha256, ok: r.ok, stage: r.manifest.stage, changedContentAccepted: body.includes('BBBB') })
}
// C: createEntry 业务失败，任务不能仍然 done / ok=true。
{
  const src = path.join(root, 'failure-source'); await put(path.join(src, 'a.txt'), 'failure probe')
  const stateDir = path.join(root, 'failure-state')
  const p = await planImport({ stateDir, source: src, target: src, mode: 'attach' })
  const r = await runImport({ stateDir, importId: p.importId, core: { createEntry: async () => ({ ok: false, reason: 'injected-create-failure' }) } })
  record('failed-item-reported-done', r.ok && r.manifest.counts.failed === 1, { ok: r.ok, stage: r.manifest.stage, counts: r.manifest.counts })
}
// D: 文本后半段可检索，且 md 原件与条目不能重复。
{
  const x = await ownCore('search')
  await put(path.join(x.kb, 'legacy', 'long.txt'), 'a'.repeat(9000) + 'TAIL_TEXT_SENTINEL_783')
  await put(path.join(x.kb, 'legacy', 'note.md'), 'UNIQUE_MD_SENTINEL_783')
  const p = await planImport({ ...x, source: x.kb, target: x.kb, mode: 'attach' })
  const r = await runImport({ ...x, importId: p.importId })
  const tail = await x.core.search({ query: 'TAIL_TEXT_SENTINEL_783', limit: 20 })
  const md = await x.core.search({ query: 'UNIQUE_MD_SENTINEL_783', limit: 20 })
  record('text-tail-unsearchable', r.ok && tail.hits.length === 0, { importOk: r.ok, tailHits: tail.hits.length })
  record('source-and-entry-double-hit', md.hits.length === 2, { paths: md.hits.map((h) => h.path) })
}
// E: 同一源文件更新后应刷新映射条目，而非加一份重复知识。
{
  const x = await ownCore('update')
  const f = path.join(x.kb, 'legacy', 'same.txt')
  await put(f, 'VERSION_ONE')
  let p = await planImport({ ...x, source: x.kb, target: x.kb, mode: 'attach' })
  await runImport({ ...x, importId: p.importId })
  await put(f, 'VERSION_TWO_NEW')
  await utimes(f, new Date(), new Date(Date.now() + 2000))
  p = await planImport({ ...x, source: x.kb, target: x.kb, mode: 'attach' })
  await runImport({ ...x, importId: p.importId })
  const list = (await readdir(path.join(x.kb, '20-知识笔记'))).filter((n) => n.endsWith('.md'))
  record('source-update-duplicates-entry', list.length === 2, { generatedFiles: list })
}
// F: frontmatter 明确 type: 画像，不能进普通知识分区。
{
  const x = await ownCore('classification')
  await put(path.join(x.kb, '旧笔记', 'profile.md'), '---\ntitle: synthetic-profile\ntype: 画像\ntags: [private]\n---\nSYNTHETIC_PROFILE_CONTENT')
  const p = await planImport({ ...x, source: x.kb, target: x.kb, mode: 'attach' })
  const r = await runImport({ ...x, importId: p.importId })
  record('explicit-profile-type-imported-as-public-knowledge', String(r.manifest.items[0].entryPath).startsWith('20-知识笔记/'), { entryPath: r.manifest.items[0].entryPath })
}
// 截断：扫描被截断不能报完整完成。
{
  const src = path.join(root, 'truncated')
  await put(path.join(src, 'a.txt'), 'a'); await put(path.join(src, 'b.txt'), 'b')
  const stateDir = path.join(root, 'truncated-state')
  const p = await planImport({ source: src, target: src, stateDir, mode: 'attach', maxFiles: 1 })
  const r = await runImport({ stateDir, importId: p.importId, core: { createEntry: async () => ({ ok: true, entryId: 'x', path: 'x.md' }) } })
  record('truncated-plan-reported-complete', r.ok && p.scan.truncated !== null, { stage: r.manifest.stage, scan: p.scan })
}
// 真实 apply/API：私密规则、工具入口、目标写入、importId 越界、缺省候选、私密链接泄漏、两步 setup。
let api
{
  const state = { tools: [] }
  const ctx = {
    get(n) {
      if (n === 'tools') return { register: async (t) => { state.tools.push(t); return () => {} } }
      if (n === 'webServer') return { register: (d) => { state.handler = d.handler; return () => {} } }
      return undefined
    },
    effect(fn) { return fn() },
  }
  const stateDir = path.join(root, 'api-state')
  const a = path.join(root, 'api-A')
  await mkdir(a, { recursive: true })
  apply(ctx, conf(a, stateDir))
  const call = async (body) => new Promise((resolve, reject) => {
    const req = { method: 'POST', on(n, fn) { if (n === 'data') fn(Buffer.from(JSON.stringify(body))); if (n === 'end') fn(); return this }, destroy() {} }
    const res = { statusCode: 0, setHeader() {}, end(s) { try { resolve(JSON.parse(s)) } catch (e) { reject(e) } } }
    Promise.resolve(state.handler(req, res)).catch(reject)
  })
  for (let i = 0; i < 100 && !state.handler; i += 1) await new Promise((r) => setTimeout(r, 20))
  if (!state.handler) throw Error('no handler')
  await call({ op: 'setup', path: a })
  api = { state, stateDir, call, a }
  await put(path.join(a, '10-项目', '私密', 'PRIVATE_CUSTOM_SENTINEL_783.md'), 'synthetic custom private file')
  const privateFiles = await call({ op: 'files', prefix: '' })
  record('configured-private-dirs-not-preserved', JSON.stringify(privateFiles.files).includes('PRIVATE_CUSTOM_SENTINEL_783'), { privateTotal: privateFiles.privateTotal, matching: (privateFiles.files || []).filter((f) => f.path.includes('PRIVATE_CUSTOM_SENTINEL_783')).map((f) => f.path) })

  const source = path.join(root, 'api-B')
  await put(path.join(source, 'note.txt'), 'TARGET_BINDING_SENTINEL_783')
  const tool = state.tools.find((x) => x.name === 'kb_import')
  const p = await tool.execute({ action: 'plan', source, mode: 'attach' })
  let toolError = null
  try { await tool.execute({ action: 'run', importId: p.importId }) } catch (e) { toolError = String(e) }
  record('model-tool-run-reference-error', toolError !== null, { error: toolError })
  await call({ op: 'import-run', importId: p.importId })
  let st
  for (let i = 0; i < 300; i += 1) {
    st = await call({ op: 'import-status', importId: p.importId })
    if (st && st.running === false && ['done', 'partial', 'failed', 'canceled', 'conflict'].includes(st.stage)) break
    await new Promise((r) => setTimeout(r, 50))
  }
  const q = await state.tools.find((t) => t.name === 'kb_search').execute({ query: 'TARGET_BINDING_SENTINEL_783', limit: 20 })
  // 原判据：stage done 且当前库里能搜到（=写错库）。新契约下"当前库在完成后才切到 B"，
  // 所以正确判据是：A 里没有、B 里有、且任务目标就是 B。
  const aCore = createCore(conf(a, path.join(root, 'api-verify-A')), () => {})
  const aHits = await aCore.search({ query: 'TARGET_BINDING_SENTINEL_783', limit: 20 })
  const bCore = createCore(conf(source, path.join(root, 'api-verify-B')), () => {})
  const bHits = await bCore.search({ query: 'TARGET_BINDING_SENTINEL_783', limit: 20 })
  const statusNow = await call({ op: 'status' })
  const originalDefect = st.stage === 'done' && q.hits.length > 0
  const newContractOk = st.stage === 'done' && aHits.hits.length === 0 && bHits.hits.length === 1 && path.resolve(statusNow.status.kbPath) === path.resolve(source)
  record('tool-attach-writes-active-other-library', !newContractOk, { originalDefect, declaredTarget: st.target, currentBinding: statusNow.status.kbPath, aHits: aHits.hits.map((x) => x.path), bHits: bHits.hits.map((x) => x.path), note: '原判据（命中在 A）已按新契约更正：完成后当前库=B 属预期' })

  const traversal = '../outside-import-marker'
  const canceled = await call({ op: 'import-cancel', importId: traversal })
  let marker = false
  try { await readFile(path.join(stateDir, 'outside-import-marker', 'cancel')); marker = true } catch { /* 没有标记才是对的 */ }
  record('import-id-directory-escape', canceled.ok && marker, { accepted: canceled.ok, wroteOutsideImports: marker, httpStatus: canceled.ok === false ? 400 : null })

  const missing = path.join(root, 'does-not-exist-yet')
  const m = await call({ op: 'setup', path: missing })
  record('new-missing-candidate-blocked', !m.ok && m.kind === 'missing', { ok: m.ok, kind: m.kind, action: m.action })

  const privateLink = path.join(a, '00-画像', 'PRIVATE_LINK_SENTINEL_783')
  const outside = path.join(root, 'link-target')
  await mkdir(outside, { recursive: true })
  try {
    await symlink(outside, privateLink, 'junction')
    const o = await call({ op: 'overview', fresh: true })
    const leak = JSON.stringify(o).includes('PRIVATE_LINK_SENTINEL_783')
    record('overview-error-reveals-private-link-name', leak, { leaked: leak, issues: o.overview ? o.overview.issues : o.issues })
  } catch (e) {
    // 未验 ≠ 通过：不能把"建不起 junction"记成 defect=false
    unverified.push({ name: 'overview-error-reveals-private-link-name', reason: 'junction 无法建立：' + String(e) })
    console.log('UNVERIFIED overview-error-reveals-private-link-name — ' + String(e).slice(0, 120))
  }

  const pending = path.join(root, 'setup-pending')
  for (let i = 0; i < 12; i += 1) await put(path.join(pending, `n${i}.txt`), 'pending')
  const setup = await call({ op: 'setup', path: pending })
  const current = await call({ op: 'status' })
  const progress = await call({ op: 'import-status', importId: setup.importId })
  record('setup-switches-before-import-complete', path.resolve(current.status.kbPath) === path.resolve(pending) && progress.counts.pending > 0, { action: setup.action, currentBinding: current.status.kbPath, stage: progress.stage, counts: progress.counts })
  for (let i = 0; i < 400; i += 1) {
    const s = await call({ op: 'import-status', importId: setup.importId })
    if (s && s.running === false && ['done', 'partial', 'failed', 'canceled', 'conflict'].includes(s.stage)) break
    await new Promise((r) => setTimeout(r, 50))
  }
}
{
  const state = {}
  const ctx = {
    get(n) {
      if (n === 'tools') return { register: async () => () => {} }
      if (n === 'webServer') return { register: (d) => { state.handler = d.handler; return () => {} } }
      return undefined
    },
    effect(fn) { return fn() },
  }
  apply(ctx, conf('', path.join(root, 'unbound-state')))
  for (let i = 0; i < 100 && !state.handler; i += 1) await new Promise((r) => setTimeout(r, 20))
  const call = (body) => new Promise((resolve, reject) => {
    const req = { method: 'POST', on(n, f) { if (n === 'data') f(Buffer.from(JSON.stringify(body))); if (n === 'end') f(); return this }, destroy() {} }
    const res = { setHeader() {}, end(s) { resolve(JSON.parse(s)) } }
    Promise.resolve(state.handler(req, res)).catch(reject)
  })
  const d = await call({ op: 'dirs' })
  record('empty-default-binds-cwd', Boolean(d.dirs.bound), { bound: d.dirs.bound, defaultCandidate: d.dirs.defaultKnowledgeBase })
}
{
  // importId 契约本身（额外检查，不在原 16 条里）：所有非法形式必须被统一拒绝
  const bad = ['../x', 'imp-ABC', 'imp-' + 'a'.repeat(20), 'imp-ab']
  const ok = bad.every((id) => isValidImportId(id) === false) && isValidImportId('imp-abcdef1234') === true
  record('import-id-contract', !ok, { bad, sample: 'imp-abcdef1234' })
}

const failed = results.filter((r) => r.defect)
console.log(`\n=== 结果：通过 ${results.length - failed.length} / 未验 ${unverified.length} / 失败 ${failed.length}（合计 ${results.length + unverified.length}）===`)
for (const f of failed) console.log(`  - ${f.name}`)
const idx = process.argv.indexOf('--json')
const outFile = idx >= 0 ? path.resolve(process.argv[idx + 1]) : path.join(process.cwd(), 'P4-独立反例结果.json')
await writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), root, passed: results.length - failed.length, total: results.length, unverified, totalWithUnverified: results.length + unverified.length, failed: failed.map((f) => f.name), results }, null, 2), 'utf8')
console.log('结果已写入 ' + outFile)
process.exitCode = failed.length === 0 ? 0 : 1
