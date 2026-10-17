// p4 定向验收：R1–R7（独立环境；虚构库；不碰正式库 / 宿主配置）。
//
// 用法：node tests/directed-r1r7.mjs [--json <out>]
// 环境变量：KB_TEST_ROOT（默认 os.tmpdir()/kb-p4-directed-<ts>）——建议指到工作区 _scratch 下。
//
// 设计原则（对应任务单 §3.5 与复核意见）：
//   · 每条断言都对应一个**可复现的反例**：要么本轮修复前它就是红的（见 P4-定向结果.json 的 pre-fix 记录），
//     要么本文件里带一个"坏样本"（负向对照）证明断言会叫（R2 的 5 类非法 id、R4 的改源冲突、R7 的旧实现）。
//   · 不做"只加文字断言"的关闭：凡涉及写入位置的，都落到**磁盘文件 + 独立 core 检索**两重证据。
import path from 'node:path'
import os from 'node:os'
import { mkdir, writeFile, readFile, readdir, stat, rename, symlink, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import crypto from 'node:crypto'
import { apply } from '../src/host/index.js'
import { createCore } from '../src/host/kbcore.js'
import { readManifest } from '../src/host/importer.js'

const results = []
const skippedChecks = []
const logLines = []
const log = (level, msg) => { logLines.push(`${level} ${msg}`) }
function check(group, name, ok, detail) {
  const passed = ok === true || (ok !== false && ok !== null && ok !== undefined && Boolean(ok))
  results.push({ group, name, ok: passed, detail: detail === undefined ? '' : String(detail) })
  console.log(`${passed ? 'PASS' : 'FAIL'} [${group}] ${name}${detail !== undefined && detail !== '' ? ' — ' + detail : ''}`)
}
// 未验 ≠ 通过：单独记账，不计入 passed（不能用 SKIPPED 冒充闭合）
function skip(group, name, reason) {
  skippedChecks.push({ group, name, reason: String(reason ?? '') })
  console.log(`SKIP [${group}] ${name} — ${reason}`)
}

const CATEGORIES = ['00-画像', '10-项目', '20-知识笔记', '30-人物关系', '40-素材资源', '90-收件箱']
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const readText = (p) => readFile(p, 'utf8')

async function listFilesDeep(root) {
  const out = []
  const walk = async (dir, rel) => {
    let ents = []
    try { ents = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const ent of ents) {
      const abs = path.join(dir, ent.name)
      const r = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) await walk(abs, r)
      else if (ent.isFile()) out.push(r)
    }
  }
  await walk(root, '')
  return out.sort()
}
async function hashTree(root) {
  const map = {}
  for (const rel of await listFilesDeep(root)) map[rel] = sha(await readFile(path.join(root, rel)))
  return map
}

function makeCtx() {
  const state = { tools: [], handler: null }
  const ctx = {
    get(nameText) {
      if (nameText === 'tools') return { register: async (entry) => { state.tools.push(entry); return () => {} } }
      if (nameText === 'webServer') return { register: (def) => { state.handler = def.handler; return () => {} } }
      return undefined
    },
    effect(fn) { return fn() },
  }
  return { ctx, state }
}

function callHandler(handler, body) {
  return new Promise((resolve, reject) => {
    const listeners = {}
    const req = {
      method: 'POST',
      on(ev, cb) {
        if (!listeners[ev]) listeners[ev] = []
        listeners[ev].push(cb)
        if (ev === 'data') cb(Buffer.from(JSON.stringify(body)))
        else if (ev === 'end') cb()
        return req
      },
      destroy() {},
    }
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v },
      end(payload) {
        try { resolve({ status: this.statusCode, body: JSON.parse(payload) }) } catch (e) { reject(new Error('non-json: ' + String(payload).slice(0, 200))) }
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

/** 一个独立的插件实例（独立 stateDir / 独立虚构库），等价于「新装一份」 */
async function mkEnv(tag, opts = {}) {
  const root = path.join(TEST_ROOT, tag)
  const stateDir = path.join(root, 'state')
  await mkdir(stateDir, { recursive: true })
  const { ctx, state } = makeCtx()
  apply(ctx, {
    kbPath: opts.kbPath ?? '',
    stateDir,
    categories: CATEGORIES,
    privateDirs: opts.privateDirs ?? ['00-画像', '30-人物关系'],
    excludeFromSearch: ['.kb', '.kbmeta', '.kb-state', '50-底稿', '_archive', '_工具', '知识库地图'],
    followLinks: false,
    logLevel: 'error',
  })
  for (let i = 0; i < 200 && !state.handler; i += 1) await new Promise((r) => setTimeout(r, 20))
  if (!state.handler) throw new Error('env ' + tag + ' 未就绪')
  const call = (body) => callHandler(state.handler, body)
  const tools = () => Object.fromEntries(state.tools.map((t) => [t.name, t]))
  return { tag, root, stateDir, state, call, tools, api: (op, rest = {}) => call({ op, ...rest }) }
}

async function waitStage(env, importId, ms = 30000) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < ms) {
    const r = await env.api('import-status', { importId })
    last = r.body
    if (last && last.running === false && ['done', 'partial', 'failed', 'canceled', 'conflict'].includes(last.stage)) return last
    await new Promise((r2) => setTimeout(r2, 100))
  }
  return last ?? { stage: 'timeout', running: false }
}

/** 独立 core：用来证明「条目真的落在目标库」，而不是靠当前绑定自证 */
function coreAt(kbPath, stateDir) {
  return createCore({ stateDir, kbPath, categories: CATEGORIES, excludeFromSearch: ['.kb', '.kbmeta', '.kb-state', '50-底稿', '_archive', '_工具', '知识库地图'], privateDirs: ['00-画像', '30-人物关系'], followLinks: false }, () => {})
}

async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

const TEST_ROOT = process.env.KB_TEST_ROOT
  ? path.resolve(process.env.KB_TEST_ROOT)
  : path.join(os.tmpdir(), 'kb-p4-directed-' + Date.now().toString(36))

async function main() {
  await mkdir(TEST_ROOT, { recursive: true })
  console.log('TEST_ROOT =', TEST_ROOT)

  // ══════════════════════════ R1 ══════════════════════════
  // 反例（p3）：kb_import(run) 抛 ReferenceError: startImport is not defined；
  //             plan 声明 target=B 却写进当前库 A；setup 先切库后导入。
  {
    const env = await mkEnv('r1', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const kbB = path.join(env.root, 'foreign-B')
    await mkdir(kbA, { recursive: true })
    const bFiles = {}
    for (let i = 0; i < 40; i += 1) bFiles[`batch-${i}.txt`] = `batch ${i} 填充`
    bFiles['note.txt'] = 'R1_TARGET_SENTINEL_901 属于目标库 B'
    await writeTree(kbB, bFiles)
    const setupA = await env.api('setup', { path: kbA })
    check('R1', '前置：当前库 = A（空目录建库）', setupA.body.ok === true && setupA.body.action === 'created', JSON.stringify(setupA.body.action))

    const tools = env.tools()
    const kbImport = tools.kb_import
    check('R1', 'kb_import 存在且可执行（不再是词法作用域外的死代码）', Boolean(kbImport && typeof kbImport.execute === 'function'), Object.keys(tools).join(','))

    const planned = await kbImport.execute({ action: 'plan', source: kbB, mode: 'attach' })
    check('R1', '工具 plan：返回 importId + 目标目录 + 任务状态目录', planned.ok === true && Boolean(planned.importId) && Boolean(planned.target) && Boolean(planned.taskStateDir), JSON.stringify({ importId: planned.importId, target: planned.target, taskStateDir: planned.taskStateDir }))
    const manifestOnDisk = await readManifest(env.stateDir, planned.importId)
    check('R1', '清单落盘即携带 {target,taskStateDir,importId}（外来目录的 kbId 在建库时补齐）', Boolean(manifestOnDisk && manifestOnDisk.target && manifestOnDisk.taskStateDir && manifestOnDisk.importId), JSON.stringify({ target: manifestOnDisk && manifestOnDisk.target, kbId: manifestOnDisk && manifestOnDisk.targetKbId, tsd: manifestOnDisk && manifestOnDisk.taskStateDir }))

    let started = { ok: false, error: 'not-run' }
    try {
      started = await kbImport.execute({ action: 'run', importId: planned.importId })
    } catch (error) {
      started = { ok: false, error: String((error && error.message) ?? error) }
    }
    check('R1', '工具 run：不再抛 ReferenceError（直接调 execute 成功）', started.ok === true && started.started === true, JSON.stringify({ ok: started.ok, stage: started.stage, error: started.error ?? null }))
    // 启动后、完成前：当前库必须还是 A（不能先切库后导入）。导入很快时只断言"完成前没有被提前切走"。
    let observedRunning = false
    let duringPath = null
    for (let i = 0; i < 20; i += 1) {
      const p = await env.api('import-status', { importId: planned.importId })
      if (p.body.running === true) {
        observedRunning = true
        duringPath = (await env.api('status')).body.status.kbPath
        break
      }
      if (['done', 'partial', 'failed', 'canceled', 'conflict'].includes(p.body.stage)) break
      await new Promise((r) => setTimeout(r, 30))
    }
    check('R1', '导入进行中当前库仍是 A（切库不在导入前发生）', observedRunning ? path.resolve(duringPath) === path.resolve(kbA) : true, observedRunning ? duringPath : '任务过快完成，未观察到 running（由下面的"完成后才切库"覆盖）')

    let st1 = { ok: false, error: 'not-run' }
    try {
      st1 = await kbImport.execute({ action: 'status', importId: planned.importId })
    } catch (error) {
      st1 = { ok: false, error: String((error && error.message) ?? error) }
    }
    check('R1', '工具 status：能拿到阶段与计数', st1.ok === true && Boolean(st1.stage) && Boolean(st1.counts), JSON.stringify({ ok: st1.ok, error: st1.error ?? null, stage: st1.stage }))
    const done = await waitStage(env, planned.importId)
    check('R1', 'attach 任务完成（stage=done，41 条全部落在目标 B）', done.stage === 'done' && done.counts.done === 41, JSON.stringify({ stage: done.stage, counts: done.counts }))
    check('R1', '任务目标身份在建库后补齐（status.targetKbId 非空）', Boolean(done.targetKbId), done.targetKbId)
    const bCore = coreAt(kbB, path.join(env.stateDir, 'verify-B'))
    const inB = await bCore.search({ query: 'R1_TARGET_SENTINEL_901', limit: 10 })
    check('R1', '目标库 B 的**独立 core** 能搜到新条目（写入位置 = 目标，不是当前库）', inB.hits.length === 1, JSON.stringify(inB.hits.map((h) => h.path)))
    const aFiles = await listFilesDeep(path.join(kbA, '20-知识笔记'))
    check('R1', '当前库 A 没有被写入该条目', aFiles.length === 0, aFiles.join(','))
    const canceled = await kbImport.execute({ action: 'cancel', importId: planned.importId })
    check('R1', '工具 cancel：完成后再取消也返回确定结果（不抛异常）', typeof canceled.ok === 'boolean', JSON.stringify({ ok: canceled.ok, stage: canceled.stage }))
    const afterCommit = await env.api('status')
    check('R1', '导入完成并核验通过后才切库（当前库 = B）', path.resolve(afterCommit.body.status.kbPath) === path.resolve(kbB), afterCommit.body.status.kbPath)
    const committed = await env.api('import-status', { importId: planned.importId })
    check('R1', '提交记录可核（committed=true, reason=committed）', committed.body.committed === true && committed.body.commitReason === 'committed', JSON.stringify({ committed: committed.body.committed, reason: committed.body.commitReason }))
  }

  // R1：独立 core ≠ 目标已固定 —— 任务状态目录里残留旧 config.json 时必须在写入前拒绝
  {
    const env = await mkEnv('r1-mismatch', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const kbB = path.join(env.root, 'kb-B')
    await mkdir(kbA, { recursive: true }); await mkdir(kbB, { recursive: true })
    await writeTree(kbB, { 'x.txt': 'R1_MISMATCH_SENTINEL_902' })
    await env.api('setup', { path: kbA })
    const planned = await env.api('import-plan', { source: kbB, mode: 'attach' })
    const id = planned.body.importId
    const taskState = path.join(env.stateDir, 'imports', id, 'core-state')
    await mkdir(taskState, { recursive: true })
    // 关键反例：任务状态目录被"旧配置"污染，指向 A（构造参数仍然是 B）
    await writeFile(path.join(taskState, 'config.json'), JSON.stringify({ schemaVersion: 1, revision: 7, kbPath: kbA, categories: CATEGORIES, excludeFromSearch: [], followLinks: false }), 'utf8')
    const started = await env.api('import-run', { importId: id })
    check('R1', '任务状态目录有旧配置（指向 A）→ 拒绝执行 target-root-mismatch', started.body.ok === false && started.body.reason === 'target-root-mismatch', JSON.stringify({ ok: started.body.ok, reason: started.body.reason, error: started.body.error }))
    const aEntries = await listFilesDeep(path.join(kbA, '20-知识笔记'))
    const bEntries = await listFilesDeep(path.join(kbB, '20-知识笔记'))
    check('R1', '拒绝时磁盘零写入（A 与 B 都没有新条目）', aEntries.length === 0 && bEntries.length === 0, JSON.stringify({ a: aEntries, b: bEntries }))
    const m = await readManifest(env.stateDir, id)
    check('R1', '拒绝后任务仍停在 planned（没有被标成 running/done）', m.stage === 'planned', m.stage)
  }

  // R1：导入期间用户切库 → 完成后不覆盖用户的选择
  {
    const env = await mkEnv('r1-bindchange', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const kbB = path.join(env.root, 'foreign-B')
    const kbC = path.join(env.root, 'kb-C')
    await mkdir(kbA, { recursive: true }); await mkdir(kbC, { recursive: true })
    const files = {}
    for (let i = 0; i < 120; i += 1) files[`batch/f${String(i).padStart(3, '0')}.txt`] = `payload ${i} R1_BINDCHANGE_903`
    await writeTree(kbB, files)
    await env.api('setup', { path: kbA })
    const planned = await env.api('import-plan', { source: kbB, mode: 'attach' })
    const started = await env.api('import-run', { importId: planned.body.importId })
    // 立即切到 C（模拟用户在导入过程中换了库）
    const bindC = await env.api('bind', { kbPath: kbC, confirmInit: true })
    const st = await waitStage(env, planned.body.importId, 60000)
    const after = await env.api('status')
    check('R1', '导入期间切库 → 完成后不覆盖用户选择（当前库仍是 C）', started.body.ok === true && bindC.body.ok === true && path.resolve(after.body.status.kbPath) === path.resolve(kbC), JSON.stringify({ current: after.body.status.kbPath, commitReason: st.commitReason }))
    check('R1', '该情形如实记录 commitReason=binding-changed', st.commitReason === 'binding-changed', st.commitReason)
    check('R1', '目标库仍按清单写满（120 条）', st.stage === 'done' && st.counts.done === 120, JSON.stringify({ stage: st.stage, counts: st.counts }))
  }

  // ══════════════════════════ R2 ══════════════════════════
  // 反例（p3）：import-cancel 传 ../outside-import-marker → 在 stateDir 外写 cancel 标记
  {
    const env = await mkEnv('r2', { kbPath: '' })
    const before = await listFilesDeep(path.join(env.root))
    const badIds = ['../outside-import-marker', '..\\outside-import-marker', path.join(env.root, 'abs-marker'), 'IMP-ABC123', 'imp-' + 'a'.repeat(20), 'imp-ab']
    const outcomes = []
    for (const id of badIds) {
      const c = await env.api('import-cancel', { importId: id })
      const s = await env.api('import-status', { importId: id })
      const r = await env.api('import-run', { importId: id })
      outcomes.push({ id, cancel: c.status, status: s.status, run: r.status, ok: c.body.ok })
    }
    const after = await listFilesDeep(path.join(env.root))
    const added = after.filter((p) => !before.includes(p))
    check('R2', '5 类非法 importId（../、..\\、绝对路径、大写变体、超长/过短）全部 400 拒绝', outcomes.every((o) => o.cancel === 400 && o.status === 400 && o.run === 400 && o.ok === false), JSON.stringify(outcomes.slice(0, 3)))
    check('R2', '非法 id 在磁盘上零新增（没有在 imports 外写任何标记）', added.length === 0, added.join(',') || '无新增')
    check('R2', '合法但不存在 id → 明确 not-found（不创建目录）', (await env.api('import-cancel', { importId: 'imp-abcdef12' })).body.reason === 'not-found', JSON.stringify((await env.api('import-cancel', { importId: 'imp-abcdef12' })).body))
  }
  // R2：imports 内的 junction 指向库外 → realpath 复核必须拒绝
  {
    const env = await mkEnv('r2-junction', { kbPath: '' })
    const imports = path.join(env.stateDir, 'imports')
    const outside = path.join(env.root, 'outside-target')
    await mkdir(imports, { recursive: true }); await mkdir(outside, { recursive: true })
    await writeFile(path.join(outside, 'leak.txt'), 'outside', 'utf8')
    const linkId = 'imp-aaaaaaaa'
    let made = false
    try {
      await symlink(outside, path.join(imports, linkId), 'junction')
      made = true
    } catch (error) {
      made = false
      log('warn', 'junction 建立失败：' + String(error))
    }
    if (!made) {
      skip('R2', 'imports 内 junction 越界', '本机无法建立 junction（EPERM/无权限）——未验')
    } else {
      const r = await env.api('import-status', { importId: linkId })
      check('R2', 'imports 内 junction 指向库外 → 拒绝（import-dir-escape-real）', r.status === 400 && /escape/.test(String(r.body.reason)), JSON.stringify(r.body))
    }
  }
  // R2：源目录里的 junction 不能被跟进（不读、不写、不复制到库外）
  {
    const env = await mkEnv('r2-source-link', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const src = path.join(env.root, 'legacy-src')
    const outside = path.join(env.root, 'outside-src')
    await mkdir(kbA, { recursive: true })
    await writeTree(src, { 'ok/real.txt': 'REAL_SENTINEL_904' })
    await writeTree(outside, { 'secret.txt': 'OUTSIDE_SECRET_904' })
    let made = false
    try {
      await symlink(outside, path.join(src, 'linked-outside'), 'junction')
      made = true
    } catch { made = false }
    await env.api('setup', { path: kbA })
    const planned = await env.api('import-plan', { source: src, mode: 'attach' })
    const files = (planned.body.counts && planned.body.counts.total) || 0
    if (made === false) skip('R2', '源目录里的 junction 不进清单（不跟随链接）', '本机无法建立 junction——未验')
    else check('R2', '源目录里的 junction 不进清单（不跟随链接）', files === 1, `made=${made} total=${files}`)
    const started = await env.api('import-run', { importId: planned.body.importId })
    const st = await waitStage(env, planned.body.importId)
    const bCore = coreAt(kbA, path.join(env.stateDir, 'verify'))
    const leaked = await bCore.search({ query: 'OUTSIDE_SECRET_904', limit: 10 })
    check('R2', 'junction 目标内容没有被导入（搜索 0 命中）', started.body.ok === true && st.stage !== 'timeout' && leaked.hits.length === 0, JSON.stringify({ stage: st.stage, hits: leaked.hits.map((h) => h.path) }))
  }

  // R2：源与目标不得互相包含（父子目录）——防"自己导自己"
  {
    const env = await mkEnv('r2-nested', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    await mkdir(kbA, { recursive: true })
    await env.api('setup', { path: kbA })
    const planned = await env.api('import-plan', { source: env.root, mode: 'copy' })
    check('R2', '源是目标的父目录 → 拒绝 nested-source-target（不自己导自己）', planned.body.ok === false && planned.body.reason === 'nested-source-target', JSON.stringify(planned.body).slice(0, 200))
  }
  // ══════════════════════════ R3 ══════════════════════════
  // 反例（p3）：旧资料夹里 00-画像/old.txt、20-知识笔记/old.txt 被整批跳过（计划 0 条）
  {
    const env = await mkEnv('r3-legacy', { kbPath: '' })
    const legacy = path.join(env.root, 'legacy')
    await writeTree(legacy, { '00-画像/old.txt': 'legacy private', '20-知识笔记/old.txt': 'legacy knowledge' })
    const planned = await env.api('import-plan', { source: legacy, mode: 'attach' })
    check('R3', '旧资料夹与标准分区同名时**不被跳过**（2 个文件进计划）', planned.body.ok === true && planned.body.counts.total === 2, JSON.stringify({ total: planned.body.counts && planned.body.counts.total, skippedDirs: planned.body.skippedDirs }))
  }
  {
    // 反例（p3）：frontmatter type: 画像 仍落 20-知识笔记
    const env = await mkEnv('r3-type', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    await mkdir(kbA, { recursive: true })
    await env.api('setup', { path: kbA })
    await writeTree(kbA, { '旧笔记/profile.md': '---\ntitle: synthetic-profile\ntype: 画像\ntags: [private]\n---\nR3_PROFILE_SENTINEL_905' })
    const planned = await env.api('import-plan', { source: kbA, mode: 'attach' })
    await env.api('import-run', { importId: planned.body.importId })
    const st = await waitStage(env, planned.body.importId)
    const item = (await readManifest(env.stateDir, planned.body.importId)).items.find((i) => i.rel === '旧笔记/profile.md')
    check('R3', 'type: 画像 → 派生条目落在 00-画像（不再进普通知识区）', st.stage === 'done' && item && String(item.entryPath).startsWith('00-画像/'), JSON.stringify({ stage: st.stage, entryPath: item && item.entryPath }))
    const mapped = (await readManifest(env.stateDir, planned.body.importId)).items.filter((i) => i.status === 'done')
    const mappedText = mapped.length === 1 ? await readText(path.join(kbA, mapped[0].entryPath)) : ''
    check('R3', '派生条目 frontmatter 保留 type: 画像（分区与类型一致）', mapped.length === 1 && /^type:\s*画像$/m.test(mappedText), mapped.map((i) => i.entryPath).join(','))
  }
  {
    // 反例（p3）：privateDirs 未进配置播种 → 自定义嵌套私密路径明文出现在 files API
    const env = await mkEnv('r3-private', { kbPath: '', privateDirs: ['00-画像', '30-人物关系', '10-项目/私密'] })
    const kbA = path.join(env.root, 'kb-A')
    await mkdir(kbA, { recursive: true })
    await env.api('setup', { path: kbA })
    await writeTree(kbA, { '10-项目/私密/PRIVATE_CUSTOM_SENTINEL_906.md': '# 私密\n', '10-项目/公开.md': '# 公开\n' })
    const files = await env.api('files', { prefix: '' })
    const listed = (files.body.files || []).map((f) => f.path)
    const persisted = (await env.api('status')).body.status.privateDirs
    check('R3', 'privateDirs 从配置播种/持久化一路保留（status 回显含嵌套路径）', Array.isArray(persisted) && persisted.includes('10-项目/私密'), JSON.stringify(persisted))
    check('R3', '自定义嵌套私密路径被遮罩（明文不出现在 files API）', !JSON.stringify(listed).includes('PRIVATE_CUSTOM_SENTINEL_906') && files.body.privateTotal >= 1, JSON.stringify({ privateTotal: files.body.privateTotal, listed }))
    const bad = await env.api('files', { prefix: '10-项目/私密' })
    check('R3', 'prefix 指向私密目录 → 只给计数、不列名', (bad.body.files || []).length === 0 && bad.body.privateTotal >= 1, JSON.stringify({ files: bad.body.files, privateTotal: bad.body.privateTotal }))
    // setConfig 白名单：非法私密路径必须拒绝
    const cfgFile = path.join(env.stateDir, 'config.json')
    const c0 = JSON.parse(await readText(cfgFile))
    const setBad = await (async () => {
      const core = createCore({ stateDir: env.stateDir, kbPath: kbA, categories: CATEGORIES, privateDirs: ['00-画像'], excludeFromSearch: [], followLinks: false }, () => {})
      return await core.setConfig({ privateDirs: ['../escape'] })
    })()
    check('R3', 'setConfig 拒绝越界 privateDirs（../escape）', setBad.ok === false && setBad.reason === 'bad-private-dirs', JSON.stringify(setBad))
    const c1 = JSON.parse(await readText(cfgFile))
    check('R3', '拒绝后配置文件未被改动（revision 不变）', c0.revision === c1.revision, `${c0.revision} → ${c1.revision}`)
  }
  {
    // 反例（p3）：概览错误的 detail 里带出私密链接的文件名
    const env = await mkEnv('r3-leak', { kbPath: '', privateDirs: ['00-画像', '30-人物关系', '10-项目/私密'] })
    const kbA = path.join(env.root, 'kb-A')
    const outside = path.join(env.root, 'link-outside')
    await mkdir(kbA, { recursive: true }); await mkdir(outside, { recursive: true })
    await env.api('setup', { path: kbA })
    await mkdir(path.join(kbA, '00-画像'), { recursive: true })
    let made = false
    try {
      await symlink(outside, path.join(kbA, '00-画像', 'PRIVATE_LINK_SENTINEL_907'), 'junction')
      made = true
    } catch { made = false }
    const ov = await env.api('overview', { fresh: true })
    const text = JSON.stringify(ov.body)
    if (made === false) skip('R3', '概览/错误详情不泄漏私密文件名', '本机无法建立 junction——未验')
    else check('R3', '概览/错误详情不泄漏私密文件名', !text.includes('PRIVATE_LINK_SENTINEL_907'), ov.body.overview ? JSON.stringify(ov.body.overview.issues) : '')
    await writeTree(kbA, { '10-项目/私密/recent-secret-907.md': '# x\n' })
    const ov2 = await env.api('overview', { fresh: true })
    const recent = (ov2.body.overview && ov2.body.overview.recent) || []
    check('R3', '嵌套私密路径不进"最近变更"', !JSON.stringify(recent).includes('recent-secret-907'), JSON.stringify(recent.map((r) => r.path)))
  }

  // ══════════════════════════ R4 ══════════════════════════
  // 反例（p3）：plan 里 sha256=null；同长度改写仍成功；失败/截断仍报 done；二次 plan 覆盖进度、生成第二个条目
  {
    const env = await mkEnv('r4-freeze', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const src = path.join(env.root, 'src-conflict')
    await mkdir(kbA, { recursive: true })
    await writeTree(src, { 'a.txt': 'AAAA' })
    await env.api('setup', { path: kbA })
    const planned = await env.api('import-plan', { source: src, mode: 'attach' })
    const m1 = await readManifest(env.stateDir, planned.body.importId)
    check('R4', 'plan 阶段逐文件冻结 sha256/size/mtime（不再是 null）', m1.items.length === 1 && /^[0-9a-f]{64}$/.test(String(m1.items[0].sha256)) && Number.isFinite(m1.items[0].mtimeMs), JSON.stringify({ sha256: m1.items[0].sha256, size: m1.items[0].bytes, mtime: m1.items[0].mtimeMs }))
    await writeFile(path.join(src, 'a.txt'), 'BBBB', 'utf8')
    const run = await env.api('import-run', { importId: planned.body.importId })
    await waitStage(env, planned.body.importId)
    const after = await readManifest(env.stateDir, planned.body.importId)
    check('R4', '同长度改写源 → stage=conflict，且不写条目', after.stage === 'conflict' && after.counts.done === 0, JSON.stringify({ stage: after.stage, counts: after.counts, conflicts: after.conflicts }))
    const entries = await listFilesDeep(path.join(kbA, '20-知识笔记'))
    check('R4', '冲突时磁盘无新增条目', entries.length === 0, entries.join(','))
    // 重新 plan 后可正常导入
    const replan = await env.api('import-plan', { source: src, mode: 'attach' })
    await env.api('import-run', { importId: replan.body.importId })
    const st = await waitStage(env, replan.body.importId)
    check('R4', '重新 plan 后按新内容导入（BBBB）', st.stage === 'done' && st.counts.done === 1, JSON.stringify({ stage: st.stage, counts: st.counts }))
  }
  {
    // 反例：createEntry 业务失败却 stage=done
    const env = await mkEnv('r4-fail', { kbPath: '' })
    const src = path.join(env.root, 'src-fail')
    await writeTree(src, { 'a.txt': 'failure probe' })
    const planned = await env.api('import-plan', { source: src, mode: 'attach' })
    const { runImport } = await import('../src/host/importer.js')
    const r = await runImport({ stateDir: env.stateDir, importId: planned.body.importId, core: { createEntry: async () => ({ ok: false, reason: 'injected-create-failure' }) } })
    check('R4', 'createEntry 业务失败 → ok=false、stage=partial（不能报 done）', r.ok === false && r.manifest.stage === 'partial' && r.manifest.counts.failed === 1, JSON.stringify({ stage: r.manifest.stage, counts: r.manifest.counts, reasons: r.manifest.terminalReasons }))
  }
  {
    // 反例：truncated=max-files 仍报 done
    const env = await mkEnv('r4-trunc', { kbPath: '' })
    const src = path.join(env.root, 'src-trunc')
    await writeTree(src, { 'a.txt': 'a', 'b.txt': 'b' })
    const planned = await env.api('import-plan', { source: src, mode: 'attach', maxFiles: 1 })
    // import-plan API 不收 maxFiles；直接调用 importer 以构造截断
    const { planImport, runImport } = await import('../src/host/importer.js')
    const p2 = await planImport({ stateDir: path.join(env.stateDir), source: src, target: src, mode: 'attach', maxFiles: 1 })
    const core = { createEntry: async () => ({ ok: true, entryId: 'x', path: 'x.md' }) }
    const r = await runImport({ stateDir: env.stateDir, importId: p2.importId, core })
    check('R4', '扫描截断（max-files）→ stage=partial 且原因列出 truncation', r.ok === false && r.manifest.stage === 'partial' && r.manifest.terminalReasons.some((x) => /截断|truncated/.test(x)), JSON.stringify({ stage: r.manifest.stage, reasons: r.manifest.terminalReasons, truncated: r.manifest.scan.truncated }))
    check('R4', '前置：API plan 的 default maxFiles 不截断', planned.body.counts.total === 2, planned.body.counts.total)
  }
  {
    // 反例：再次 plan 无条件覆盖运行中的 manifest
    // 两段：① 确定性——清单 stage=importing 时 plan 必须只读返回；② 活体——真实跑起来时 plan 不重置进度。
    const env = await mkEnv('r4-replan', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const src = path.join(env.root, 'src-many')
    await mkdir(kbA, { recursive: true })
    const files = {}
    for (let i = 0; i < 120; i += 1) files[`f${i}.txt`] = `payload ${i}`
    await writeTree(src, files)
    await env.api('setup', { path: kbA })
    const planned = await env.api('import-plan', { source: src, mode: 'attach' })
    const importerMod = await import('../src/host/importer.js')
    const rm = importerMod.readManifest
    const frozen = await rm(env.stateDir, planned.body.importId)
    frozen.stage = 'importing'
    frozen.counts = { ...frozen.counts, done: 5, pending: frozen.counts.total - 5 }
    if (typeof importerMod.saveManifest === 'function') await importerMod.saveManifest(env.stateDir, frozen)
    else await writeFile(path.join(env.stateDir, 'imports', planned.body.importId, 'manifest.json'), JSON.stringify(frozen, null, 2), 'utf8')
    const roPlan = await env.api('import-plan', { source: src, mode: 'attach' })
    const afterRo = await rm(env.stateDir, planned.body.importId)
    check('R4', '清单 stage=importing 时重复 plan → 只读返回（running=true，不覆盖进度）', roPlan.body.ok === true && roPlan.body.running === true, JSON.stringify({ running: roPlan.body.running, note: roPlan.body.note }))
    check('R4', '只读返回后清单未被重置（done 仍 5，stage 仍 importing）', afterRo.stage === 'importing' && afterRo.counts.done === 5, JSON.stringify({ stage: afterRo.stage, counts: afterRo.counts }))
    // 活体：真实启动后立刻 plan，进度不能被清零
    const started = await env.api('import-run', { importId: planned.body.importId })
    const replan = await env.api('import-plan', { source: src, mode: 'attach' })
    const afterReplan = await rm(env.stateDir, planned.body.importId)
    check('R4', '活体任务中 plan 不把清单打回 planned（进度不回零）', started.body.ok === true && afterReplan.stage !== 'planned' && replan.body.ok === true, JSON.stringify({ stage: afterReplan.stage, planStage: replan.body.stage, running: replan.body.running }))
    await waitStage(env, planned.body.importId, 60000)
  }
  {
    // 反例：改源再跑生成第二个条目（应受控更新）
    const env = await mkEnv('r4-update', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    await mkdir(kbA, { recursive: true })
    await env.api('setup', { path: kbA })
    const f = path.join(kbA, 'legacy', 'same.txt')
    await writeTree(kbA, { 'legacy/same.txt': 'VERSION_ONE' })
    let planned = await env.api('import-plan', { source: kbA, mode: 'attach' })
    await env.api('import-run', { importId: planned.body.importId })
    await waitStage(env, planned.body.importId)
    await writeFile(f, 'VERSION_TWO_NEW', 'utf8')
    const future = new Date(Date.now() + 2000)
    const { utimes } = await import('node:fs/promises')
    await utimes(f, future, future)
    planned = await env.api('import-plan', { source: kbA, mode: 'attach' })
    await env.api('import-run', { importId: planned.body.importId })
    const st = await waitStage(env, planned.body.importId)
    const list = (await readdir(path.join(kbA, '20-知识笔记'))).filter((n) => n.endsWith('.md'))
    check('R4', '同一来源再导入 → 受控更新（条目数仍 1，不追加副本）', st.stage === 'done' && list.length === 1, JSON.stringify({ stage: st.stage, files: list }))
    let map = { entries: {} }
    try { map = JSON.parse(await readText(path.join(kbA, '.kbmeta', 'import-sources.json'))) } catch { map = { entries: {} } }
    const keys = Object.keys(map.entries)
    const one = map.entries[keys[0]] || {}
    check('R4', '来源映射含目标库身份 + 源根目录 + 源相对路径', keys.length === 1 && Boolean(one.kbId) && Boolean(one.sourceRoot) && one.rel === 'legacy/same.txt', JSON.stringify(one))
    let updatedBody = ''
    try { updatedBody = one.entryPath ? await readText(path.join(kbA, one.entryPath)) : '' } catch { updatedBody = '' }
    check('R4', '更新后条目正文是第二次内容', /VERSION_TWO_NEW/.test(updatedBody), one.entryPath ?? '(无来源映射)')
  }
  {
    // 复核意见第 2 点：不同源目录里的同名文件不能当同一来源
    const env = await mkEnv('r4-identity', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    const s1 = path.join(env.root, 'src-one')
    const s2 = path.join(env.root, 'src-two')
    await mkdir(kbA, { recursive: true })
    await writeTree(s1, { 'a/note.txt': 'FROM_SOURCE_ONE_908' })
    await writeTree(s2, { 'a/note.txt': 'FROM_SOURCE_TWO_908' })
    await env.api('setup', { path: kbA })
    for (const s of [s1, s2]) {
      const p = await env.api('import-plan', { source: s, mode: 'copy' })
      await env.api('import-run', { importId: p.body.importId })
      await waitStage(env, p.body.importId)
    }
    let map = { entries: {} }
    try { map = JSON.parse(await readText(path.join(kbA, '.kbmeta', 'import-sources.json'))) } catch { map = { entries: {} } }
    check('R4', '同名文件来自不同源根 → 两条独立来源映射（不串用）', Object.keys(map.entries).length === 2, JSON.stringify(Object.keys(map.entries)))
    const core = coreAt(kbA, path.join(env.stateDir, 'verify'))
    const one = await core.search({ query: 'FROM_SOURCE_ONE_908', limit: 10 })
    const two = await core.search({ query: 'FROM_SOURCE_TWO_908', limit: 10 })
    check('R4', '两份内容各自可检索（没有互相覆盖）', one.hits.length === 1 && two.hits.length === 1, JSON.stringify({ one: one.hits.map((h) => h.path), two: two.hits.map((h) => h.path) }))
  }
  {
    // 复核意见：任务身份必须含 target
    const env = await mkEnv('r4-taskid', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A'); const kbB = path.join(env.root, 'kb-B'); const src = path.join(env.root, 'src')
    await mkdir(kbA, { recursive: true }); await mkdir(kbB, { recursive: true })
    await writeTree(src, { 'x.txt': 'task id' })
    await env.api('setup', { path: kbA })
    const pA = await env.api('import-plan', { source: src, mode: 'copy' })
    await env.api('setup', { path: kbB })
    const pB = await env.api('import-plan', { source: src, mode: 'copy' })
    check('R4', '同一源 + 不同目标库 → 不同 importId（任务身份含 target）', pA.body.importId !== pB.body.importId, `${pA.body.importId} vs ${pB.body.importId}`)
  }

  // ══════════════════════════ R5 ══════════════════════════
  {
    const env = await mkEnv('r5', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    await mkdir(kbA, { recursive: true })
    await env.api('setup', { path: kbA })
    await writeTree(kbA, {
      'legacy/long.txt': 'a'.repeat(9000) + 'TAIL_TEXT_SENTINEL_909',
      'legacy/note.md': 'UNIQUE_MD_SENTINEL_909',
      'docs/report.pdf': Buffer.from('%PDF-1.4 fake'),
    })
    const planned = await env.api('import-plan', { source: kbA, mode: 'attach' })
    await env.api('import-run', { importId: planned.body.importId })
    const st = await waitStage(env, planned.body.importId)
    const core = coreAt(kbA, path.join(env.stateDir, 'verify'))
    const tail = await core.search({ query: 'TAIL_TEXT_SENTINEL_909', limit: 20 })
    check('R5', '纯文本 9000 字符后的关键词可检索（全文进索引，不只索引头部）', st.stage === 'done' && tail.hits.length === 1, JSON.stringify({ stage: st.stage, hits: tail.hits.map((h) => h.path) }))
    const md = await core.search({ query: 'UNIQUE_MD_SENTINEL_909', limit: 20 })
    check('R5', '原件与派生条目按来源映射去重（同一关键词只出 1 条，保留原件）', md.hits.length === 1 && md.hits[0].path === 'legacy/note.md', JSON.stringify(md.hits.map((h) => h.path)))
    const all = (await readManifest(env.stateDir, planned.body.importId)).items
    const pdfItem = all.find((i) => i.rel === 'docs/report.pdf')
    const pdfBody = await readText(path.join(kbA, pdfItem.entryPath))
    check('R5', 'PDF 仍明确"待解析"（不冒充已解析）', /待解析/.test(pdfBody), pdfItem.entryPath)
  }

  // ══════════════════════════ R6 ══════════════════════════
  {
    // 反例：kbPath:'' → path.resolve('') = cwd，dirs.bound 非空
    const env = await mkEnv('r6', { kbPath: '' })
    const dirs = await env.api('dirs')
    const st = await env.api('status')
    check('R6', '空 kbPath → 未绑定（dirs.bound=null，status.kbPath=null）', dirs.body.dirs.bound === null && st.body.status.kbPath === null && st.body.status.bound === false, JSON.stringify({ bound: dirs.body.dirs.bound, status: st.body.status.kbPath }))
    const ov = await env.api('overview', { fresh: true })
    check('R6', '未绑定时不扫描 cwd（知识条目数 0，不可能是工作目录里的 .md）', ov.body.overview.layers.entries === 0, `entries=${ov.body.overview.layers.entries}`)
    const search = await env.tools().kb_search.execute({ query: 'anything', limit: 5 })
    check('R6', '未绑定时工具检索明确拒绝（unbound），不返回 0 命中冒充"没找到"', search.ok === false && search.reason === 'unbound', JSON.stringify({ ok: search.ok, reason: search.reason }))
    const rec = await env.tools().kb_record.execute({ action: 'create', title: 'x', content: 'y' })
    check('R6', '未绑定时工具写入直接拒绝（unbound）', rec.ok === false && rec.reason === 'unbound', JSON.stringify({ ok: rec.ok, reason: rec.reason }))
    const bindEmpty = await env.tools().kb_bind.execute({ path: '' })
    check('R6', '绑定空路径被拒绝（不解释成 cwd）', bindEmpty.ok === false && bindEmpty.reason === 'empty-path', JSON.stringify({ ok: bindEmpty.ok, reason: bindEmpty.reason }))
  }
  {
    // 反例：setup 对不存在的默认候选直接 kind=missing/blocked
    const env = await mkEnv('r6-create', { kbPath: '' })
    const missing = path.join(env.root, 'does-not-exist-yet', 'KnowledgeBase')
    const r = await env.api('setup', { path: missing })
    check('R6', '不存在的目录（父级可写）→ 主按钮创建后建库（created）', r.body.ok === true && r.body.action === 'created', JSON.stringify({ ok: r.body.ok, action: r.body.action, kind: r.body.kind }))
    check('R6', '建库后目录确实存在且库结构健康', existsSync(missing) && r.body.after && r.body.after.healthy === true, JSON.stringify(r.body.after))
    const st = await env.api('status')
    check('R6', '新库立刻有有效空索引（不需要"再点重建"）', st.body.status.index.fresh === true && st.body.status.counts.entries === 0, JSON.stringify({ index: st.body.status.index, counts: st.body.status.counts }))
  }
  {
    // 老用户既有绑定不动
    const env = await mkEnv('r6-old', { kbPath: '' })
    const kbA = path.join(env.root, 'kb-A')
    await mkdir(kbA, { recursive: true })
    await env.api('setup', { path: kbA })
    await writeTree(kbA, { '20-知识笔记/keep.md': '---\ntitle: keep\ntype: 知识\ntags: [a]\nstatus: 进行中\nupdated: 2026-10-17\n---\nKEEP_SENTINEL_910\n' })
    const before = await hashTree(kbA)
    const st = await env.api('status')
    check('R6', '既有绑定保持不变（kbPath 仍是 A）', path.resolve(st.body.status.kbPath) === path.resolve(kbA), st.body.status.kbPath)
    const after = await hashTree(kbA)
    check('R6', '读取状态不改动既有文件（哈希一致）', JSON.stringify(before) === JSON.stringify(after), `${Object.keys(before).length} 文件`)
  }

  // ══════════════════════════ R7 ══════════════════════════
  {
    const { readFile: rf } = await import('node:fs/promises')
    const src = await rf(new URL('../src/client/index.js', import.meta.url), 'utf8')
    const start = src.indexOf('      const overviewSeqRef = react.useRef(0)')
    const end = src.indexOf('      react.useEffect(() => {', start)
    check('R7', '客户端源码包含概览/清单两个独立序号 ref', start >= 0 && end > start && src.includes('const filesSeqRef = react.useRef(0)'), `block=${start}..${end}`)
    if (start < 0 || end <= start) {
      check('R7', 'R7 运行时复现（交错/版本/负向对照）', false, '源码缺少独立序号 ref：无法执行（这正是 p3 的缺陷）')
      return finish()
    }
    const block = src.slice(start, end)
    const requests = []
    const states = { busy: false, data: null, list: null, toast: '' }
    const versionRef = { current: null }
    const inflightRef = { current: false }
    const overviewSeqRef = { current: 0 }
    const filesSeqRef = { current: 0 }
    const callApi = (b) => new Promise((resolve) => requests.push({ body: b, resolve }))
    // 注意：两个 ref 的声明在被抽取的代码块**内部**（组件 render 期创建），所以不能同时作为函数参数
    const make = new Function(
      'react', 'callApi', 'setBusy', 'setError', 'setData', 'setList', 'setScope', 'showToast',
      block + '\nreturn { load, loadFiles, overviewSeqRef, filesSeqRef, versionRef, inflightRef }',
    )
    const handlers = make({ useCallback: (f) => f, useRef: (v) => ({ current: v }) }, callApi, (v) => { states.busy = v }, () => {}, (v) => { states.data = v }, (v) => { states.list = v }, () => {}, (t) => { states.toast = t })
    const overviewP = handlers.load()
    const filesP = handlers.loadFiles('20-知识笔记', '', 0)
    check('R7', '交错场景：两个请求都发出（序号互不覆盖）', requests.length === 2, requests.map((r) => r.body.op).join(','))
    requests[0].resolve({ overview: { version: 'v1' } })
    await overviewP
    requests[1].resolve({ ok: true, version: 'v1', root: 'A', files: [], total: 0 })
    await filesP
    check('R7', '概览先回、清单后回：busy 被释放且概览被采用（v1）', states.busy === false && handlers.inflightRef.current === false && states.data && states.data.version === 'v1', JSON.stringify({ busy: states.busy, inflight: handlers.inflightRef.current, data: states.data }))
    check('R7', '两条请求各用自己的序号（不共用一个计数器）', handlers.overviewSeqRef.current === 1 && handlers.filesSeqRef.current === 1, `${handlers.overviewSeqRef.current}/${handlers.filesSeqRef.current}`)
    // 清单快照与当前概览版本不一致 → 拒绝显示
    const load2 = handlers.loadFiles('', '', 0)
    requests[2].resolve({ ok: true, version: 'v2', root: 'B', files: [{ path: 'x' }], total: 1 })
    await load2
    check('R7', '清单版本与概览不一致 → 拒绝显示并提示刷新（不靠 list.root 修正）', /不一致|已拒绝/.test(String(states.list && states.list.error)), JSON.stringify(states.list && { error: states.list.error, files: states.list.files }))
    // 负向对照：旧实现（共用一个 seqRef）在同一场景下必须叫
    const oldBlock = `
      const load = react.useCallback(async (opts) => {
        if (inflightRef.current) return
        inflightRef.current = true
        const seq = ++seqRef.current
        setBusy(true)
        try {
          const d = await callApi({ op: 'overview' })
          if (seq !== seqRef.current) return
          setData(d.overview)
        } finally {
          if (seq === seqRef.current) setBusy(false)
          inflightRef.current = false
        }
      }, [])
      const loadFiles = react.useCallback(async (prefix) => {
        const seq = ++seqRef.current
        const d = await callApi({ op: 'files' })
        if (seq !== seqRef.current) return
        setList(d)
      }, [])
    `
    const oldRequests = []
    const oldStates = { busy: false, data: null, list: null }
    const oldSeq = { current: 0 }
    const oldInflight = { current: false }
    const oldMake = new Function('react', 'callApi', 'seqRef', 'inflightRef', 'setBusy', 'setData', 'setList', oldBlock + '\nreturn { load, loadFiles }')
    const oldHandlers = oldMake({ useCallback: (f) => f }, (b) => new Promise((resolve) => oldRequests.push({ body: b, resolve })), oldSeq, oldInflight, (v) => { oldStates.busy = v }, (v) => { oldStates.data = v }, (v) => { oldStates.list = v })
    const oldOverview = oldHandlers.load()
    const oldFiles = oldHandlers.loadFiles('20-知识笔记')
    oldRequests[0].resolve({ overview: { version: 'v1' } })
    await oldOverview
    oldRequests[1].resolve({ ok: true, files: [] })
    await oldFiles
    check('R7', '负向对照：旧实现（共用 seqRef）在同一场景下确实卡住 busy（证明检测能叫）', oldStates.busy === true && oldInflight.current === false && oldStates.data === null, JSON.stringify({ busy: oldStates.busy, inflight: oldInflight.current, data: oldStates.data }))
    // 终态停轮询：源码契约（真浏览器点击属未验项）
    const pollOk = /TERMINAL_STAGE/.test(src) && /\[jobId, jobStage, loadUnfinished\]/.test(src) && /clearInterval\(timer\)/.test(src)
    check('R7', '导入轮询：依赖 [jobId, stage]，终态 clearInterval（源码契约）', pollOk, pollOk ? '' : '未找到 TERMINAL_STAGE / 依赖数组 / clearInterval')
    const resumeOk = src.includes('继续/重试') && src.includes("op: 'import-run'") && src.includes('import-status')
    check('R7', '重进页面可列出未完成任务并提供"继续/重试"（源码契约 + import-status 无 id 可用）', resumeOk, '')
    const listApi = await mkEnv('r7-list', { kbPath: '' })
    const l = await listApi.api('import-status')
    check('R7', 'import-status（不带 id）返回任务列表（运行态接口真实可用）', l.body.ok === true && Array.isArray(l.body.imports), JSON.stringify(l.body).slice(0, 160))
  }

  await finish()
}

async function finish() {
  // ══════════════════════════ 汇总 ══════════════════════════
  const failed = results.filter((r) => !r.ok)
  const byGroup = {}
  for (const r of results) byGroup[r.group] = (byGroup[r.group] || 0) + (r.ok ? 1 : 0)
  console.log('\n=== 结果 ===')
  for (const [g, n] of Object.entries(byGroup)) console.log(`  ${g}: ${n}`)
  const totalAll = results.length + skippedChecks.length
  console.log(`  通过 ${results.length - failed.length} / 未验 ${skippedChecks.length} / 失败 ${failed.length}（合计 ${totalAll}）`)
  const jsonIdx = process.argv.indexOf('--json')
  const outFile = jsonIdx >= 0 ? path.resolve(process.argv[jsonIdx + 1]) : path.join(process.cwd(), 'P4-定向结果.json')
  const report = { at: new Date().toISOString(), testRoot: TEST_ROOT, passed: results.length - failed.length, total: results.length, skipped: skippedChecks, totalWithSkipped: totalAll, groups: byGroup, failed, results }
  await writeFile(outFile, JSON.stringify(report, null, 2), 'utf8')
  console.log('结果已写入 ' + outFile)
  if (failed.length > 0) {
    console.log('\n失败项：')
    for (const f of failed) console.log(`  - [${f.group}] ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
  }
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('harness 崩溃：', error)
  process.exitCode = 2
})
