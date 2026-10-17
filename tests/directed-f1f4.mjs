// p4 四项收尾（F1–F4）定向回归：把验收方 9 个补充场景转成断言。
//
// 来源：审查方交付的定向验收脚本（verify-update-contract.mjs / verify-commit.mjs）
//       以及 补充更新与隐私反例.json / 提交时并发反例.json（均为审查方材料，未随仓库分发）
//
// 原则：每个场景先保留原判据形态（同夹具、同触发时机），断言 `defect === false`；
//       额外补：同请求不同 payload 必须拒绝、同版本重试幂等、update 失败不得转 create、
//       两消费者竞争提交、拒绝时 config/binding 零改动。
//
// 用法：node tests/directed-f1f4.mjs [--json <out>]
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { mkdir, writeFile, readFile, readdir, stat, unlink, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createCore } from '../src/host/kbcore.js'
import { createImportService } from '../src/host/import-service.js'
import { apply } from '../src/host/index.js'
import { planImport, runImport, readSourceMap } from '../src/host/importer.js'

const TEST_ROOT = process.env.KB_TEST_ROOT ? path.resolve(process.env.KB_TEST_ROOT) : path.join(os.tmpdir(), 'kb-p5-f1f4-' + Date.now().toString(36))
const CATEGORIES = ['00-画像', '10-项目', '20-知识笔记', '30-人物关系', '40-素材资源', '90-收件箱']
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const results = []
const skippedChecks = []
function check(name, ok, detail) {
  const passed = ok === true || (ok !== false && ok !== null && ok !== undefined && Boolean(ok))
  results.push({ name, ok: passed, detail: detail === undefined ? '' : String(detail) })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? ' — ' + detail : ''}`)
}
function skip(name, reason) {
  skippedChecks.push({ name, reason: String(reason ?? '') })
  console.log(`SKIP ${name} — ${reason}`)
}
const put = async (p, t) => { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, t, 'utf8') }

function makeCfg(kb, stateDir, privateDirs) {
  return {
    kbPath: kb,
    stateDir,
    categories: CATEGORIES,
    privateDirs,
    excludeFromSearch: ['.kb', '.kbmeta', '.kb-state', '.kb-import', '_archive', '50-底稿', '90-收件箱', '知识库地图'],
    followLinks: false,
  }
}

async function freshKb(tag, { privateDirs = ['00-画像', '30-人物关系'] } = {}) {
  const root = path.join(TEST_ROOT, tag)
  const kb = path.join(root, 'kb')
  const stateDir = path.join(root, 'state')
  await mkdir(kb, { recursive: true })
  const config = makeCfg(kb, stateDir, privateDirs)
  const core = createCore(config, () => {})
  await core.getConfig()
  const bound = await core.bind(kb, { confirmInit: true })
  if (!bound.ok) throw new Error('bind failed: ' + JSON.stringify(bound))
  return { root, kb, stateDir, core, config }
}

async function ingest(x, { source = x.kb, mode = 'attach', onProgress } = {}) {
  const p = await planImport({ stateDir: x.stateDir, source, target: x.kb, mode })
  const r = await runImport({ core: x.core, stateDir: x.stateDir, importId: p.importId, onProgress })
  return { p, r, importId: p.importId }
}

async function mapFor(x) {
  return readSourceMap(x.kb)
}
async function entryText(x, rel) {
  const m = await mapFor(x)
  const entries = Object.values(m.entries)
  const hit = rel ? entries.find((v) => v.rel === rel) : entries[0]
  return hit ? await readFile(path.join(x.kb, hit.entryPath), 'utf8') : ''
}
async function apiFor(x) {
  const st = {}
  const ctx = {
    get(n) {
      if (n === 'tools') return { register: async () => () => {} }
      if (n === 'webServer') return { register: (d) => { st.handler = d.handler; return () => {} } }
      return undefined
    },
    effect(fn) { return fn() },
  }
  apply(ctx, x.config)
  for (let i = 0; i < 100 && !st.handler; i += 1) await new Promise((r) => setTimeout(r, 20))
  return (body) => new Promise((resolve, reject) => {
    const req = { method: 'POST', on(ev, f) { if (ev === 'data') f(Buffer.from(JSON.stringify(body))); if (ev === 'end') f(); return this }, destroy() {} }
    const res = { statusCode: 0, setHeader() {}, end(t) { resolve({ status: this.statusCode, body: JSON.parse(t) }) } }
    Promise.resolve(st.handler(req, res)).catch(reject)
  })
}
const readText = (p) => readFile(p, 'utf8')

async function main() {
  await mkdir(TEST_ROOT, { recursive: true })
  console.log('TEST_ROOT =', TEST_ROOT)

  // ═════════ F1：来源更新 ═════════
  // 1) 连续三版：第三版不能被旧 requestId 当重试吃掉
  {
    const x = await freshKb('three-versions')
    const f = path.join(x.kb, 'legacy', 'item.txt')
    const states = []
    for (const v of ['VERSION_ONE_901', 'VERSION_TWO_902', 'VERSION_THREE_903']) {
      await put(f, v)
      const { r } = await ingest(x)
      const text = await entryText(x, 'legacy/item.txt')
      states.push({ source: v, ok: r.ok, stage: r.manifest.stage, contains: text.includes(v) })
    }
    check('F1 三版更新：每一版都落到同一来源条目（第三版不再被去重）', states.every((s) => s.ok && s.stage === 'done' && s.contains), JSON.stringify(states))
  }

  // 2) 用户手改：必须冲突/合并，不能被静默覆盖
  {
    const x = await freshKb('manual-edit')
    const f = path.join(x.kb, 'legacy', 'item.txt')
    await put(f, 'SOURCE_FIRST_904')
    await ingest(x)
    const hits = await x.core.search({ query: 'SOURCE_FIRST_904', limit: 20 })
    const h = hits.hits[0]
    const edited = await x.core.updateEntry({ entryId: h.entryId, expectedRevision: h.revision, content: 'USER_MANUAL_EDIT_905' })
    if (!edited.ok) throw new Error('manual edit failed: ' + JSON.stringify(edited))
    await put(f, 'SOURCE_SECOND_906')
    const { r } = await ingest(x)
    const text = await entryText(x, 'legacy/item.txt')
    const item = r.manifest.items.find((i) => i.rel === 'legacy/item.txt')
    check('F1 用户手改：导入被判冲突/失败，手改内容保留、新源未写入', r.ok === false && r.manifest.stage === 'partial' && text.includes('USER_MANUAL_EDIT_905') && !text.includes('SOURCE_SECOND_906') && /entry-conflict/.test(String(item.error)), JSON.stringify({ ok: r.ok, stage: r.manifest.stage, error: item.error, manual: text.includes('USER_MANUAL_EDIT_905') }))
  }

  // 3) 执行中同长度改源：冻结哈希不可变，不得用新内容成功
  {
    const x = await freshKb('changed-during-import')
    await put(path.join(x.kb, 'legacy', 'a.txt'), 'FIRST')
    const second = path.join(x.kb, 'legacy', 'b.txt')
    await put(second, 'BEFORE')
    let changed = false
    const p = await planImport({ stateDir: x.stateDir, source: x.kb, target: x.kb, mode: 'attach' })
    const frozenSha = (await readFile(path.join(x.stateDir, 'imports', p.importId, 'manifest.json'), 'utf8').then(JSON.parse)).items.find((i) => i.rel === 'legacy/b.txt').sha256
    const r = await runImport({
      core: x.core,
      stateDir: x.stateDir,
      importId: p.importId,
      onProgress: async () => {
        if (!changed) {
          changed = true
          await put(second, 'AFTER!')
        }
      },
    })
    const q = await x.core.search({ query: 'AFTER!', limit: 20 })
    const afterManifest = JSON.parse(await readText(path.join(x.stateDir, 'imports', p.importId, 'manifest.json')))
    const bItem = afterManifest.items.find((i) => i.rel === 'legacy/b.txt')
    check('F1 执行中改源：任务 partial、新内容不进索引、冻结哈希未被改写', r.ok === false && r.manifest.stage === 'partial' && q.hits.length === 0 && bItem.sha256 === frozenSha, JSON.stringify({ ok: r.ok, stage: r.manifest.stage, hits: q.hits.map((h) => h.path), frozenSame: bItem.sha256 === frozenSha, error: bItem.error }))
  }

  // 4) copy 更新：按内容版本归档，第二版不沿用旧归档
  {
    const x = await freshKb('copy-update')
    await put(path.join(x.kb, 'notes', 'same.md'), 'LOCAL_NOTE_COPY_907')
    const source = path.join(x.root, 'external')
    await put(path.join(source, 'notes', 'same.md'), 'REMOTE_V1_908')
    const first = await ingest(x, { source, mode: 'copy' })
    const map1 = await mapFor(x)
    await put(path.join(source, 'notes', 'same.md'), 'REMOTE_V2_909')
    const second = await ingest(x, { source, mode: 'copy' })
    const map2 = await mapFor(x)
    const v = Object.values(map2.entries).find((e) => e.sourceRoot.replaceAll('\\', '/').toLowerCase().endsWith('/external'))
    const entryText2 = v ? await readText(path.join(x.kb, v.entryPath)) : ''
    const archiveAbs = v ? path.join(x.kb, v.originalPath) : ''
    const archiveHash = archiveAbs && existsSync(archiveAbs) ? sha(await readFile(archiveAbs)) : null
    const v1ArchiveStill = Object.values(map1.entries).some((e) => e.originalPath && existsSync(path.join(x.kb, e.originalPath)))
    check('F1 copy 更新：第二版成功、归档按版本保留、正文/来源/归档哈希一致', first.r.ok === true && second.r.ok === true && second.r.manifest.stage === 'done' && second.r.manifest.verify.mismatch.length === 0 && entryText2.includes('REMOTE_V2_909') && archiveHash === v.sha256 && archiveAbs.includes(v.sha256.slice(0, 12)) && v1ArchiveStill, JSON.stringify({ ok: second.r.ok, stage: second.r.manifest.stage, verify: second.r.manifest.verify, v2: entryText2.includes('REMOTE_V2_909'), archiveSame: archiveHash === v.sha256, v1ArchiveStill }))
  }

  // 5) 同版本重试：幂等（不制造新 revision / updated 日期）
  {
    const x = await freshKb('same-version')
    const f = path.join(x.kb, 'legacy', 'same.txt')
    await put(f, 'SAME_VERSION_910')
    await ingest(x)
    const map1 = await mapFor(x)
    const v1 = Object.values(map1.entries)[0]
    const before = await readText(path.join(x.kb, v1.entryPath))
    const { r } = await ingest(x)
    const map2 = await mapFor(x)
    const v2 = Object.values(map2.entries)[0]
    const after = await readText(path.join(x.kb, v2.entryPath))
    const item = r.manifest.items.find((i) => i.rel === 'legacy/same.txt')
    check('F1 同版本重试：条目不重写（revision / updated 均不变）', r.ok === true && item.unchanged === true && before === after && v1.entryRevision === v2.entryRevision, JSON.stringify({ unchanged: item.unchanged, sameText: before === after, rev1: v1.entryRevision, rev2: v2.entryRevision }))
  }

  // 6) core：同一 requestId 的不同 payload 必须拒绝（不能返回旧结果）
  {
    const x = await freshKb('payload-mismatch')
    const create1 = await x.core.createEntry({ kind: '知识', title: 'T1', content: 'PAYLOAD_A_911', requestId: 'req-create-fixed' })
    const create2 = await x.core.createEntry({ kind: '知识', title: 'T1', content: 'PAYLOAD_B_912', requestId: 'req-create-fixed' })
    const sameCreate = await x.core.createEntry({ kind: '知识', title: 'T1', content: 'PAYLOAD_A_911', requestId: 'req-create-fixed' })
    const upd1 = await x.core.updateEntry({ entryId: create1.entryId, expectedRevision: sameCreate.revision, content: 'UPD_A_913', requestId: 'req-update-fixed' })
    const upd2 = await x.core.updateEntry({ entryId: create1.entryId, expectedRevision: upd1.revision, content: 'UPD_B_914', requestId: 'req-update-fixed' })
    check('F1 core 契约：同一 requestId 不同 payload → 拒绝（create 与 update 都是）', create1.ok && create2.ok === false && create2.reason === 'request-payload-mismatch' && sameCreate.deduplicated === true && upd1.ok && upd2.ok === false && upd2.reason === 'request-payload-mismatch', JSON.stringify({ create2: create2.reason ?? create2.ok, sameCreate: sameCreate.deduplicated, upd2: upd2.reason ?? upd2.ok }))
  }

  // 7) update 失败不得静默转 create（条目被删 → 明确失败，不新建）
  {
    const x = await freshKb('no-create-fallback')
    const f = path.join(x.kb, 'legacy', 'gone.txt')
    await put(f, 'FIRST_915')
    await ingest(x)
    const m1 = await mapFor(x)
    const v1 = Object.values(m1.entries)[0]
    await unlink(path.join(x.kb, v1.entryPath))
    await put(f, 'SECOND_916')
    const { r } = await ingest(x)
    const entries = (await readdir(path.join(x.kb, '20-知识笔记'))).filter((n) => n.endsWith('.md'))
    const item = r.manifest.items.find((i) => i.rel === 'legacy/gone.txt')
    check('F1 update 失败不转 create：条目缺失 → failed，且没有新条目', r.ok === false && /entry-missing/.test(String(item.error)) && entries.length === 0, JSON.stringify({ ok: r.ok, bestStage: r.manifest.stage, error: item.error, entries }))
  }

  // ═════════ F2：隐私继承 ═════════
  {
    const x = await freshKb('private-custom-only', { privateDirs: ['10-项目/私密'] })
    await put(path.join(x.kb, '10-项目', '私密', 'SYNTHETIC_PRIVATE_NAME_917.txt'), 'synthetic private body')
    await ingest(x)
    const call = await apiFor(x)
    const files = (await call({ op: 'files', prefix: '' })).body
    const exposed = (files.files || []).filter((f) => f.path.includes('SYNTHETIC_PRIVATE_NAME_917'))
    const status = (await call({ op: 'status' })).body.status
    const ov = (await call({ op: 'overview', fresh: true })).body.overview
    const mapResp = (await call({ op: 'map', fresh: true })).body.map
    const sec = (mapResp.sections || []).find((s) => s.name === '00-画像')
    const recent = ov.recent || []
    check('F2 自定义私密（不含 00-画像）：派生条目在 files 中不列名', files.ok === true && exposed.length === 0 && files.privateTotal >= 1, JSON.stringify({ exposed: exposed.map((f) => f.path), privateTotal: files.privateTotal }))
    check('F2 有效私密策略包含派生隐私分区（status.effectivePrivateDirs）', Array.isArray(status.effectivePrivateDirs) && status.effectivePrivateDirs.includes('00-画像'), JSON.stringify(status.effectivePrivateDirs))
    check('F2 地图分区把 00-画像 标为私密', Boolean(sec && sec.private === true), JSON.stringify(sec))
    check('F2 recent 不含私密派生条目', !JSON.stringify(recent).includes('SYNTHETIC_PRIVATE_NAME_917'), JSON.stringify(recent.map((r) => r.path)))
  }
  // 错误详情也不能泄漏（00-画像 下的 junction）
  {
    const x = await freshKb('private-error', { privateDirs: ['10-项目/私密'] })
    // 先产生一条私密派生条目，让 00-画像 进入有效私密策略（F2 的前提）
    await put(path.join(x.kb, '10-项目', '私密', 'seed.txt'), 'seed')
    await ingest(x)
    const outside = path.join(x.root, 'outside')
    await mkdir(outside, { recursive: true })
    let made = false
    try {
      await symlink(outside, path.join(x.kb, '00-画像', 'PRIVATE_LINK_NAME_918'), 'junction')
      made = true
    } catch { made = false }
    const call = await apiFor(x)
    const ov = (await call({ op: 'overview', fresh: true })).body
    if (made === false) skip('F2 错误详情不泄漏私密路径/文件名', '本机无法建立 junction——未验')
    else check('F2 错误详情不泄漏私密路径/文件名', !JSON.stringify(ov).includes('PRIVATE_LINK_NAME_918'), JSON.stringify(ov.overview ? ov.overview.issues : ov.issues).slice(0, 200))
  }
  // 重新导入仍保持私密（映射更新后 private 标记不能丢）
  {
    const x = await freshKb('private-reimport', { privateDirs: ['10-项目/私密'] })
    const f = path.join(x.kb, '10-项目', '私密', 'PRIVATE_REIMPORT_919.txt')
    await put(f, 'v1')
    await ingest(x)
    await put(f, 'v2')
    await ingest(x)
    const call = await apiFor(x)
    const files = (await call({ op: 'files', prefix: '' })).body
    check('F2 重新导入后派生条目仍被遮罩', !JSON.stringify(files.files || []).includes('PRIVATE_REIMPORT_919') && files.privateTotal >= 1, JSON.stringify({ privateTotal: files.privateTotal, files: (files.files || []).map((f2) => f2.path) }))
  }

  // ═════════ F3：来源去重 ═════════
  {
    const x = await freshKb('copy-dedup')
    await put(path.join(x.kb, 'notes', 'same.md'), 'COMMON_COPY_MARKER_920 LOCAL_ONLY')
    const source = path.join(x.root, 'copy-external')
    await put(path.join(source, 'notes', 'same.md'), 'COMMON_COPY_MARKER_920 REMOTE_ONLY')
    const { r } = await ingest(x, { source, mode: 'copy' })
    const q = await x.core.search({ query: 'COMMON_COPY_MARKER_920', limit: 20 })
    check('F3 外部复制源与库内同相对路径：两份知识都要返回（不误合并）', r.ok === true && q.hits.length === 2, JSON.stringify({ stage: r.manifest.stage, hits: q.hits.map((h) => h.path) }))
  }
  {
    const x = await freshKb('entry-count')
    await put(path.join(x.kb, 'legacy', 'note.md'), 'ONE_KNOWLEDGE_SOURCE_921')
    await ingest(x)
    const call = await apiFor(x)
    const ov = (await call({ op: 'overview', fresh: true })).body.overview
    const q = await x.core.search({ query: 'ONE_KNOWLEDGE_SOURCE_921', limit: 20 })
    const L = ov.layers
    check('F3 知识数按同来源折叠，与物理文件/索引记录分列', q.hits.length === 1 && L.entries === 1 && L.physicalEntries === 2 && L.entriesInIndex === 2 && L.foldedSources === 1, JSON.stringify({ hits: q.hits.length, entries: L.entries, physical: L.physicalEntries, inIndex: L.entriesInIndex, folded: L.foldedSources }))
  }

  // F4 附加：默认 stateDir 必须落在 profile 的 kb-state，不能落到宿主 cwd
  {
    const oldHome = process.env.DSH_HOME
    const oldProfile = process.env.DSH_PROFILE
    const home = path.join(TEST_ROOT, 'default-statedir-home')
    await mkdir(home, { recursive: true })
    process.env.DSH_HOME = home
    process.env.DSH_PROFILE = 'kb-accept-profile'
    const state = { handler: null }
    const ctx = {
      get(n) {
        if (n === 'tools') return { register: async () => () => {} }
        if (n === 'webServer') return { register: (d) => { state.handler = d.handler; return () => {} } }
        return undefined
      },
      effect(fn) { return fn() },
    }
    apply(ctx, { ...makeCfg('', ''), stateDir: '', kbPath: '' })
    for (let i = 0; i < 100 && !state.handler; i += 1) await new Promise((r) => setTimeout(r, 20))
    const call = (body) => new Promise((resolve, reject) => {
      const req = { method: 'POST', on(ev, f) { if (ev === 'data') f(Buffer.from(JSON.stringify(body))); if (ev === 'end') f(); return this }, destroy() {} }
      const res = { statusCode: 0, setHeader() {}, end(s) { resolve(JSON.parse(s)) } }
      Promise.resolve(state.handler(req, res)).catch(reject)
    })
    const st = (await call({ op: 'status' })).status
    process.env.DSH_HOME = oldHome
    process.env.DSH_PROFILE = oldProfile
    const want = path.join(home, 'profiles', 'kb-accept-profile', 'kb-state')
    check('F4 默认 stateDir：状态落在 <DSH_HOME>/profiles/<profile>/kb-state，不落 cwd', path.resolve(st.stateDir) === path.resolve(want) && path.resolve(st.config.file) === path.resolve(path.join(want, 'config.json')), JSON.stringify({ stateDir: st.stateDir, configFile: st.config.file, want }))
  }

  // F4 工具输出契约：kb_status 必须能通过宿主的 lossless JSON 校验（不能含 undefined/NaN）
  {
    const tools = new Map()
    const ctx = {
      get(n) {
        if (n === 'tools') return { register: async (d) => { tools.set(d.name, d); return () => {} } }
        if (n === 'webServer') return { register: () => () => {} }
        return undefined
      },
      effect(fn) { return fn() },
    }
    const state = path.join(TEST_ROOT, 'tool-output-state')
    apply(ctx, { ...makeCfg(path.join(TEST_ROOT, 'tool-output-kb'), state), stateDir: state, kbPath: path.join(TEST_ROOT, 'tool-output-kb') })
    for (let i = 0; i < 100 && tools.size < 7; i += 1) await new Promise((r) => setTimeout(r, 20))
    const def = tools.get('kb_status')
    const res = await def.execute({})
    const bad = []
    const walk = (v, p2) => {
      if (v === undefined) { bad.push(p2); return }
      if (typeof v === 'number' && !Number.isFinite(v)) { bad.push(p2 + '=' + v); return }
      if (typeof v === 'bigint' || typeof v === 'function') { bad.push(p2); return }
      if (v && typeof v === 'object') for (const k2 of Object.keys(v)) walk(v[k2], p2 + '.' + k2)
    }
    walk(res, 'res')
    check('F4 工具输出契约：kb_status 不含 undefined/NaN（宿主 lossless JSON 可序列化）', bad.length === 0 && typeof res.build.profile === 'string', JSON.stringify({ bad: bad.slice(0, 5), profile: res.build && res.build.profile }))
  }

  // ═════════ F4：原子提交 ═════════
  const indexSrc = await readText(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'host', 'index.js'))
  const begin = indexSrc.indexOf('      commitBinding: async (target, opts = {}) => {')
  const end = indexSrc.indexOf('\n      },', begin)
  const hookText = begin >= 0 && end > begin ? indexSrc.slice(begin, end).replace('      commitBinding: ', '') + '\n}' : ''
  const makeHook = (core) => new Function('core', 'return (' + hookText + ')')(core)
  check('F4 能提取到源码中的实际 commitBinding 回调', hookText !== '' && /commit: true/.test(hookText), `begin=${begin} end=${end}`)

  async function commitScenario(scenario) {
    const dir = path.join(TEST_ROOT, 'commit-' + scenario)
    const a = path.join(dir, 'A'); const b = path.join(dir, 'B'); const c = path.join(dir, 'C'); const state = path.join(dir, 'state')
    await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true })
    const cfg = makeCfg(a, state, ['00-画像', '30-人物关系'])
    const core = createCore(cfg, () => {})
    await core.getConfig()
    await core.bind(a, { confirmInit: true })
    await core.initializeLibrary(c, { rebuildIndex: true })
    await put(path.join(b, 'note.txt'), 'COMMIT_PROBE_922')
    let injected = false
    const wrapped = new Proxy(core, {
      get(t, p) {
        if (p !== 'bind') return t[p]
        return async (target, opts) => {
          if (!injected) {
            injected = true
            if (scenario === 'binding-change-at-commit') await core.bind(c, { confirmInit: false })
            else {
              const file = path.join(b, '.kbmeta', 'kb.json')
              const m = JSON.parse(await readFile(file, 'utf8'))
              m.kbId = crypto.randomUUID()
              await writeFile(file, JSON.stringify(m), 'utf8')
            }
          }
          return core.bind(target, opts)
        }
      },
    })
    const service = createImportService({ stateDir: state, getBaseConfig: () => core.getConfig(), getCurrentCore: () => core, commitBinding: makeHook(wrapped) })
    const planned = await service.plan({ source: b, mode: 'attach' })
    await service.start({ importId: planned.importId })
    let st
    for (let i = 0; i < 400; i += 1) {
      st = await service.status({ importId: planned.importId })
      if (!st.running) break
      await new Promise((r) => setTimeout(r, 10))
    }
    const current = (await core.status()).kbPath
    const expected = scenario === 'binding-change-at-commit' ? c : a
    return { scenario, injected, committed: st.committed, commitReason: st.commitReason, current, expected, ok: path.resolve(current) === path.resolve(expected) && st.committed === false }
  }
  {
    const r1 = await commitScenario('binding-change-at-commit')
    check('F4 提交瞬间切换当前库：拒绝提交，不覆盖用户后来的选择 C', r1.ok, JSON.stringify(r1))
    const r2 = await commitScenario('target-id-change-at-commit')
    check('F4 提交瞬间替换目标 kbId：拒绝提交，当前绑定仍是 A（先检查后写入）', r2.ok, JSON.stringify(r2))
  }
  {
    // 两消费者竞争提交：同一 stateDir / 同一预期 revision，只能一个成功
    const dir = path.join(TEST_ROOT, 'commit-race')
    const a = path.join(dir, 'A'); const b1 = path.join(dir, 'B1'); const b2 = path.join(dir, 'B2'); const state = path.join(dir, 'state')
    await mkdir(a, { recursive: true }); await mkdir(b1, { recursive: true }); await mkdir(b2, { recursive: true })
    const cfg = makeCfg(a, state, ['00-画像'])
    const core = createCore(cfg, () => {})
    await core.getConfig()
    await core.bind(a, { confirmInit: true })
    for (const b of [b1, b2]) {
      for (let i = 0; i < 40; i += 1) await put(path.join(b, `f${i}.txt`), `payload ${i}`)
    }
    const service = createImportService({ stateDir: state, getBaseConfig: () => core.getConfig(), getCurrentCore: () => core, commitBinding: makeHook(core) })
    const p1 = await service.plan({ source: b1, mode: 'attach' })
    const p2 = await service.plan({ source: b2, mode: 'attach' })
    await service.start({ importId: p1.importId })
    await service.start({ importId: p2.importId })
    let s1; let s2
    for (let i = 0; i < 600; i += 1) {
      s1 = await service.status({ importId: p1.importId })
      s2 = await service.status({ importId: p2.importId })
      if (!s1.running && !s2.running) break
      await new Promise((r) => setTimeout(r, 10))
    }
    const current = (await core.status()).kbPath
    const commits = [s1, s2].filter((s) => s.committed === true).length
    const valid = existsSync(path.join(state, 'config.json')) || existsSync(path.join(state, 'config.lock')) === false
    check('F4 两消费者竞争提交：只有一个成功，另一个 commit-conflict，配置可读', commits === 1 && valid && [b1, b2].some((b) => path.resolve(b) === path.resolve(current)), JSON.stringify({ commits, current, s1: { committed: s1.committed, reason: s1.commitReason }, s2: { committed: s2.committed, reason: s2.commitReason } }))
  }
  {
    // 拒绝时 config.json / binding.json 零改动
    const dir = path.join(TEST_ROOT, 'commit-zero-change')
    const a = path.join(dir, 'A'); const b = path.join(dir, 'B'); const state = path.join(dir, 'state')
    await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true })
    const core = createCore(makeCfg(a, state, ['00-画像']), () => {})
    await core.getConfig()
    await core.bind(a, { confirmInit: true })
    await core.initializeLibrary(b, { rebuildIndex: true })
    const cfgFile = path.join(state, 'config.json')
    const bindFile = path.join(state, 'binding.json')
    const beforeCfg = await readFile(cfgFile)
    const beforeBind = await readFile(bindFile)
    const hook = makeHook(core)
    const st = await core.status()
    const bad = await hook(b, { expectedConfigRevision: String(Number(st.config.revision) - 1), expectedCurrentKbPath: a, expectedCurrentKbId: st.kbId, expectedTargetKbId: JSON.parse(await readText(path.join(b, '.kbmeta', 'kb.json'))).kbId })
    const afterCfg = await readFile(cfgFile)
    const afterBind = await readFile(bindFile)
    check('F4 提交被拒绝时：config.json 与 binding.json 均未改动', bad.ok === false && beforeCfg.equals(afterCfg) && beforeBind.equals(afterBind), JSON.stringify({ ok: bad.ok, reason: bad.reason, conflict: bad.conflict, cfgSame: beforeCfg.equals(afterCfg), bindSame: beforeBind.equals(afterBind) }))
  }

  // ═════════ 汇总 ═════════
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 结果：通过 ${results.length - failed.length} / 未验 ${skippedChecks.length} / 失败 ${failed.length}（合计 ${results.length + skippedChecks.length}）===`)
  const idx = process.argv.indexOf('--json')
  const outFile = idx >= 0 ? path.resolve(process.argv[idx + 1]) : path.join(process.cwd(), 'P5-定向结果-F1F4.json')
  await writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), testRoot: TEST_ROOT, passed: results.length - failed.length, total: results.length, skipped: skippedChecks, totalWithSkipped: results.length + skippedChecks.length, failed: failed.map((f) => f.name), results }, null, 2), 'utf8')
  console.log('结果已写入 ' + outFile)
  if (failed.length > 0) for (const f of failed) console.log('  - ' + f.name + ' — ' + f.detail)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('harness 崩溃：', error)
  process.exitCode = 2
})
