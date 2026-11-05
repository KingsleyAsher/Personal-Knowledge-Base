import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, writeFile, readdir, lstat, unlink, symlink } from 'node:fs/promises'
import { createLibraryFramework } from '../packages/kb-core/src/library-framework.js'
import { TEMPLATES, VERSION } from '../packages/kb-core/src/kbcore.js'
import { digest } from '../packages/kb-core/src/workbench-state.js'
import { createCore } from '../packages/kb-core/index.js'
import { connectRuntime } from '../packages/kb-service/runtime.js'
import { connectService } from '../packages/kb-service/client.js'

async function snapshot(root) {
  const rows = {}
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name
      if (entry.isDirectory()) { rows[rel + '/'] = true; await walk(path.join(dir, entry.name), rel + '/') }
      else rows[rel] = digest(await readFile(path.join(dir, entry.name)))
    }
  }
  await walk(root); return rows
}
async function fixture() {
  const parent = path.resolve('.test-runs'); await mkdir(parent, { recursive: true })
  const base = await mkdtemp(path.join(parent, 'library-framework-')), root = path.join(base, 'library')
  await mkdir(path.join(root, '_模板'), { recursive: true }); await mkdir(path.join(root, '自定义资料'), { recursive: true })
  const protectedFiles = { 'AGENTS.md': '# SYNTHETIC USER RULES\r\n保留原规则\r\n', 'INDEX.md': '# SYNTHETIC MANUAL INDEX\n',
    '_模板/知识条目.md': '# SYNTHETIC CUSTOM TEMPLATE\n', '自定义资料/课堂录音.txt': 'SYNTHETIC ORIGINAL LOCATION AND BYTES' }
  for (const [file, text] of Object.entries(protectedFiles)) await writeFile(path.join(root, file), text)
  const b = { root, key: base, st: { kbId: 'synthetic-kb' } }
  const checkProtected = async () => { for (const [file, text] of Object.entries(protectedFiles)) assert.equal(await readFile(path.join(root, file), 'utf8'), text) }
  return { base, root, b, protectedFiles, checkProtected, service: createLibraryFramework({ binding: async () => b }) }
}
async function preview(f) { return (await f.service.dispatch(f.b, { op: 'upgrade.framework-preview' })).framework }
async function apply(f, plan) { return f.service.dispatch(f.b, { op: 'upgrade.framework-apply', expectedKbId: f.b.st.kbId, confirm: true, planId: plan.planId, revision: plan.revision }) }

test('preview is read-only; additive migration preserves custom templates, rules, navigation and original locations', async () => {
  const f = await fixture(), before = await snapshot(f.root), plan = await preview(f)
  assert.deepEqual(await snapshot(f.root), before)
  assert.equal(plan.canApply, true); assert.equal(plan.movesExistingFiles, false)
  assert.equal(plan.rows.find(row => row.path === 'AGENTS.md').status, 'preserved')
  const result = (await apply(f, plan)).framework
  assert.equal(result.phase, 'completed'); await f.checkProtected()
  assert.equal(await readFile(path.join(f.root, '_模板/项目条目.md'), 'utf8'), TEMPLATES['项目条目.md'])
  assert.match(await readFile(path.join(f.root, '_手册/知识库框架.md'), 'utf8'), /已有资料继续留在原位置/)
  assert.equal((await lstat(path.join(f.root, '90-收件箱'))).isDirectory(), true)
  const again = await preview(f); assert.equal(again.creates, 0)
  assert.equal((await f.service.dispatch(f.b, { op: 'upgrade.framework-status' })).framework.phase, 'completed')
  await f.checkProtected()
})

test('confirmation, binding, stale preview, path-type collisions and linked directories stop publication', async () => {
  const f = await fixture(), plan = await preview(f)
  await assert.rejects(f.service.dispatch(f.b, { op: 'upgrade.framework-apply', planId: plan.planId, revision: plan.revision }), { code: 'CONFIRM_REQUIRED' })
  await assert.rejects(f.service.dispatch(f.b, { op: 'upgrade.framework-apply', planId: plan.planId, revision: plan.revision, expectedKbId: 'another-kb', confirm: true }), { code: 'CONFIRM_REQUIRED' })
  await writeFile(path.join(f.root, 'AGENTS.md'), 'SYNTHETIC NEW USER EDIT')
  await assert.rejects(apply(f, plan), { code: 'FILE_CHANGED' })
  assert.equal(await readFile(path.join(f.root, 'AGENTS.md'), 'utf8'), 'SYNTHETIC NEW USER EDIT')
  await writeFile(path.join(f.root, '20-知识笔记'), 'SYNTHETIC SAME-NAME FILE')
  const blocked = await preview(f); assert.equal(blocked.canApply, false)
  await assert.rejects(apply(f, blocked), { code: 'MIGRATION_BLOCKED' })
  await unlink(path.join(f.root, '20-知识笔记'))
  const outside = path.join(f.base, 'outside'); await mkdir(outside)
  await symlink(outside, path.join(f.root, '90-收件箱'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(preview(f), { code: 'LINK_DENIED' })
  assert.deepEqual(await readdir(outside), [])
})

test('EPERM after publication rolls back only newly created files and empty directories; a fresh preview can retry', async () => {
  const f = await fixture(); let injected = false
  f.service = createLibraryFramework({ binding: async () => f.b, fault: async file => {
    if (file === '_模板/项目条目.md' && !injected) { injected = true; throw Object.assign(Error('SYNTHETIC EPERM'), { code: 'EPERM' }) }
  } })
  await assert.rejects(apply(f, await preview(f)), { code: 'FRAMEWORK_FAILED' })
  assert.equal((await f.service.dispatch(f.b, { op: 'upgrade.framework-status' })).framework.phase, 'rolled-back')
  await assert.rejects(lstat(path.join(f.root, '90-收件箱')), { code: 'ENOENT' })
  await assert.rejects(lstat(path.join(f.root, '_模板/项目条目.md')), { code: 'ENOENT' })
  await f.checkProtected()
  assert.equal((await apply(f, await preview(f))).framework.phase, 'completed')
  await f.checkProtected()
})

test('user edits after a partial migration stop recovery; a damaged receipt cannot delete arbitrary files', async () => {
  const f = await fixture()
  f.service = createLibraryFramework({ binding: async () => f.b, fault: async file => {
    if (file === '_模板/项目条目.md') { await writeFile(path.join(f.root, file), 'SYNTHETIC FOLLOW-UP EDIT'); throw Error('synthetic interruption') }
  } })
  await assert.rejects(apply(f, await preview(f)), { code: 'FRAMEWORK_FAILED' })
  assert.equal((await f.service.dispatch(f.b, { op: 'upgrade.framework-status' })).framework.needsRecovery, true)
  // A fresh manager recovers from the durable receipt, not an in-memory plan.
  f.service = createLibraryFramework({ binding: async () => f.b })
  await assert.rejects(f.service.dispatch(f.b, { op: 'upgrade.framework-recover' }), { code: 'MIGRATION_CHANGED' })
  assert.equal(await readFile(path.join(f.root, '_模板/项目条目.md'), 'utf8'), 'SYNTHETIC FOLLOW-UP EDIT')
  await f.checkProtected()
  const receiptPath = path.join(f.root, '.kbmeta/framework-migrations/last.json')
  const original = await readFile(receiptPath), bad = JSON.parse(original)
  bad.rows.push({ path: '自定义资料/课堂录音.txt', kind: 'file', beforeHash: null, desiredHash: digest(f.protectedFiles['自定义资料/课堂录音.txt']), state: 'created' })
  await writeFile(receiptPath, JSON.stringify(bad))
  await assert.rejects(f.service.dispatch(f.b, { op: 'upgrade.framework-recover' }), { code: 'STATE_CORRUPT' })
  await f.checkProtected(); await writeFile(receiptPath, original)
  // The test restores its own synthetic edit to the exact staged content before
  // retrying recovery; production recovery never overwrites it automatically.
  await writeFile(path.join(f.root, '_模板/项目条目.md'), TEMPLATES['项目条目.md'])
  assert.equal((await f.service.dispatch(f.b, { op: 'upgrade.framework-recover' })).framework.phase, 'rolled-back')
  await f.checkProtected()
})

test('real Windows shared service exposes user migration, correct program version, and rejects non-admin or wrong-library calls',
  { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const f = await fixture(), core = createCore({ stateDir: path.join(f.base, 'embedded') })
    assert.equal((await core.bind(f.root, { confirmInit: true })).ok, true)
    await writeFile(path.join(f.root, '.desktop-preview.json'), JSON.stringify({ schemaVersion: 1, synthetic: true }))
    const runtime = await connectRuntime({ library: f.root, home: path.join(f.base, 'services'), python: 'python', kind: 'dsh-adapter', candidateRoot: f.base })
    let reader
    try {
      const client = runtime.client, health = await client.call('service.health'), kbId = health.library.kbId
      const ready = JSON.parse(await readFile(path.join(runtime.privateDir, 'ready.json'), 'utf8'))
      const grant = await client.call('connection.grant', { label: 'synthetic non-admin', access: ['read', 'write'], expiresAt: Date.now() + 60000 })
      reader = await connectService({ pipe: ready.pipe, python: 'python', credential: grant.credential, kind: 'desktop' })
      for (const method of ['adapter.dispatch', 'workspace.read']) {
        await assert.rejects(reader.call(method, { operation: { op: 'upgrade.framework-preview', expectedKbId: kbId, admin: true } }), { code: 'FORBIDDEN' })
        await assert.rejects(client.call(method, { operation: { op: 'upgrade.framework-preview', expectedKbId: 'wrong-library' } }), { code: 'BINDING_CHANGED' })
      }
      const ui = operation => client.call('adapter.dispatch', { operation: { expectedKbId: kbId, ...operation } })
      const p = await ui({ op: 'upgrade.framework-preview' }); assert.equal(p.ok, true); assert.equal(p.framework.canApply, true)
      const out = await ui({ op: 'upgrade.framework-apply', planId: p.framework.planId, revision: p.framework.revision, confirm: true })
      assert.equal(out.framework.phase, 'completed')
      assert.equal((await ui({ op: 'upgrade.framework-status' })).framework.programVersion, VERSION)
      const system = await ui({ op: 'upgrade.get' }); assert.equal(system.upgrade.program.version, VERSION)
      await f.checkProtected()
    } finally { reader?.close(); try { await runtime.client.call('service.shutdown') } catch {} await runtime.close(); core.dispose?.() }
  })
