import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'
import { createFlowEngine } from '../src/host/flows.js'
import { prepareFlowConversation } from '../src/host/flow-workspace.js'
import { moveInboxFile } from '../src/host/workbench-inbox.js'

test('local inbox moves files above 8 MiB, scans the directory, and preserves collisions and rejected sources', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-inbox-move-'))
  // On Windows this also exercises a real cross-volume transfer when the repo
  // and system temp are on different drives. All files are synthetic fixtures.
  const external = await mkdtemp(path.join(process.cwd(), 'inbox-move-fixture-'))
  let wb
  try {
    const root = path.join(base, 'library'), stateDir = path.join(base, 'state')
    await mkdir(root)
    const core = createCore({ stateDir }, () => {})
    assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
    const kbId = (await core.status()).kbId
    wb = createWorkbench({ stateDir, getCore: () => core })
    const call = args => wb.dispatch({ expectedKbId: kbId, ...args })
    const move = async sourcePath => call({ op: 'capture.move-file', sourcePath, expectedRevision: (await call({ op: 'capture.list' })).revision })
    const payload = Buffer.alloc(9 * 1024 * 1024, 0x5a), source = path.join(external, '大文件.bin')
    await writeFile(source, payload)
    const result = await move(source)
    assert.equal(result.moved, true)
    assert.equal(result.path, '90-收件箱/大文件.bin')
    await assert.rejects(stat(source), { code: 'ENOENT' })
    assert.deepEqual(await readFile(path.join(root, result.path)), payload)
    assert.equal((await call({ op: 'capture.list' })).total, 0, 'inbox files do not depend on quick-capture records')
    assert.ok((await call({ op: 'inbox.list' })).items.some(f => f.path === result.path && f.bytes === payload.length))
    assert.equal((await move(path.join(root, result.path))).alreadyInInbox, true)

    const local = path.join(base, '大文件.bin')
    await writeFile(local, 'another original')
    const collision = await move(local)
    assert.equal(collision.path, '90-收件箱/大文件 (1).bin')
    assert.equal(await readFile(path.join(root, collision.path), 'utf8'), 'another original')
    await assert.rejects(stat(local), { code: 'ENOENT' })
    assert.deepEqual(await readFile(path.join(root, result.path)), payload)

    const retained = path.join(external, '保留.txt'), occupied = path.join(root, collision.path)
    await writeFile(retained, 'retain me')
    await assert.rejects(moveInboxFile(retained, occupied), { code: 'EEXIST' })
    assert.equal(await readFile(retained, 'utf8'), 'retain me')
    assert.equal(await readFile(occupied, 'utf8'), 'another original')
    const revision = (await call({ op: 'capture.list' })).revision
    await assert.rejects(call({ op: 'capture.move-file', sourcePath: retained, expectedRevision: revision - 1 }), { code: 'CONFLICT' })
    await assert.rejects(wb.dispatch({ op: 'capture.move-file', sourcePath: retained, expectedKbId: kbId, expectedRevision: revision }, { agent: {} }), { code: 'ADMIN_ONLY' })
    await assert.rejects(move(external), { code: 'INBOX_NOT_FILE' })
    assert.equal(await readFile(retained, 'utf8'), 'retain me')
    const protectedFile = path.join(root, '20-知识笔记', 'existing.md')
    await mkdir(path.dirname(protectedFile), { recursive: true }); await writeFile(protectedFile, 'existing knowledge')
    await assert.rejects(move(protectedFile), { code: 'INBOX_LIBRARY_FILE' })
    assert.equal(await readFile(protectedFile, 'utf8'), 'existing knowledge')
    const other = path.join(base, 'other-library'); await mkdir(other)
    assert.equal((await core.bind(other, { confirmInit: true })).ok, true)
    await assert.rejects(move(retained))
    assert.equal(await readFile(retained, 'utf8'), 'retain me')
  } finally { wb?.dispose(); await rm(base, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }) }
})

test('inbox shows uploaded and manually added files, paginates, and rejects a stale library', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-inbox-'))
  let wb
  try {
    const root = path.join(base, 'library'), stateDir = path.join(base, 'state')
    await mkdir(root)
    const core = createCore({ stateDir }, () => {})
    assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
    const kbId = (await core.status()).kbId
    wb = createWorkbench({ stateDir, getCore: () => core })
    const call = args => wb.dispatch({ expectedKbId: kbId, ...args })
    await mkdir(path.join(root, '90-收件箱'), { recursive: true })
    await mkdir(path.join(root, '20-知识笔记'), { recursive: true })
    await writeFile(path.join(root, '90-收件箱', '手动放入.txt'), 'Synthetic manual file')
    for (const folder of ['原件归档', '分类/原件归档', '_archive']) {
      await mkdir(path.join(root, '90-收件箱', folder), { recursive: true })
      await writeFile(path.join(root, '90-收件箱', folder, '已归档.txt'), 'Archived original without capture metadata')
    }
    await mkdir(path.join(root, '90-收件箱/待处理'), { recursive: true })
    const systemFiles = ['README.md', '待处理/ReadMe.MD', 'INDEX.md', '待处理/AGENTS.md', '知识库清单.md']
    for (const file of systemFiles) await writeFile(path.join(root, '90-收件箱', file), 'System navigation, not pending material')
    await writeFile(path.join(root, '90-收件箱/待处理/原件归档说明.txt'), 'Pending file, not an archive directory')
    await writeFile(path.join(root, '20-知识笔记', 'outside.md'), 'Not in inbox')
    const captures = await call({ op: 'capture.list' })
    const saved = await call({ op: 'capture.create', filename: '上传样本.txt', base64: Buffer.from('Synthetic upload').toString('base64'), expectedRevision: captures.revision })
    assert.equal(saved.ok, true)
    const listed = await call({ op: 'capture.inbox-files' })
    assert.equal(listed.ok, true)
    assert.ok(listed.items.some(f => f.path.endsWith('手动放入.txt')))
    assert.ok(listed.items.some(f => f.path === saved.capture.path))
    assert.ok(listed.items.every(f => f.path.startsWith('90-收件箱/')))
    assert.equal(listed.total, 3)
    assert.ok(listed.items.some(f => f.path.endsWith('原件归档说明.txt')))
    assert.ok(listed.items.every(f => !f.path.endsWith('/已归档.txt')))
    assert.ok(listed.items.every(f => !systemFiles.some(name => f.path === '90-收件箱/' + name)))
    assert.equal((await call({ op: 'inbox.list' })).total, 3, 'AI and UI use the same pending list')
    const archived = await call({ op: 'index.policy.set', paths: ['90-收件箱/原件归档/已归档.txt'], excluded: true })
    assert.ok(!(await call({ op: 'inbox.list' })).items.some(f => f.path === archived.mapping['90-收件箱/原件归档/已归档.txt']))
    const movedSystem = await call({ op: 'index.policy.set', paths: ['90-收件箱/README.md'], excluded: true })
    assert.ok(!(await call({ op: 'inbox.list' })).items.some(f => f.path === movedSystem.mapping['90-收件箱/README.md']))
    const page = await call({ op: 'capture.inbox-files', limit: 1, offset: 1 })
    assert.equal(page.items.length, 1)
    assert.equal(page.total, listed.total)
    await assert.rejects(call({ op: 'capture.inbox-files', expectedKbId: 'other-library' }))
  } finally { wb?.dispose(); await rm(base, { recursive: true, force: true }) }
})

test('builtin flow survives reload, cannot be changed, and forces High conversation execution', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-inbox-flow-'))
  try {
    const opts = { stateDir: base, core: { status: async () => ({ bound: true, kbId: 'fixture', kbPath: base }) }, delegate: async () => { throw Error('must not delegate') } }
    const engine = createFlowEngine(opts), id = 'builtin-inbox-organize'
    const summary = (await engine.list()).flows.find(f => f.id === id)
    assert.equal(summary.builtin, true)
    assert.equal((await engine.archive(id)).reason, 'builtin-flow')
    assert.equal((await engine.setEnabled(id, false)).reason, 'builtin-flow')
    const flow = (await engine.get(id)).flow
    assert.equal((await engine.save({ flow, expectedRevision: 1 })).reason, 'builtin-flow')
    assert.equal((await engine.start({ id })).reason, 'conversation-required')
    await engine.save({ name: 'Custom', triggers: ['custom'], steps: [{ title: 'test', instruction: 'Synthetic task' }] })
    assert.equal((await createFlowEngine(opts).get(id)).flow.builtin, true)
    const prepared = await engine.prepareConversation({ id, kbId: 'fixture', expectedRevision: 1, execution: { provider: 'wrong', model: 'wrong', reasoningEffort: 'low' } })
    assert.equal(prepared.ok, true)
    assert.equal(prepared.requiredReasoningEffort, 'high')
    assert.deepEqual(prepared.execution, { provider: 'wrong', model: 'wrong', reasoningEffort: 'high' })
    assert.equal(prepared.prompt, '整理并归档收件箱内的文件。')
    const conversation = await prepareFlowConversation(engine, { ensure: async () => ({ workspaceId: 'workspace', workspacePath: base }) }, { id, kbId: 'fixture', expectedRevision: 1 })
    assert.equal(conversation.prompt, '整理并归档收件箱内的文件。')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('High is selected before sending; lack of a High model never creates or sends a session', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('    let flowClientContext'), source.indexOf('    function Flows()'))
  for (const supported of [true, false]) {
    const calls = []
    const services = {
      sessions: { create: async opts => { assert.equal(opts.agentPreset, 'knowledge'); calls.push('create'); return 'session' }, retain: () => ({ ready: Promise.resolve(), release() {} }), scope: () => ({ get: () => ({ send: async prompt => calls.push(prompt) }) }) },
      uiWorkspace: { openSession() {} }, uiConversation: { binding: () => ({ activate() {} }) },
      modelDirectories: { directoryFor: () => ({ select: async route => { assert.equal(route.reasoningEffort, 'high'); calls.push('select-high') } }) },
    }
    const launch = vm.runInNewContext(code + '\nflowLaunchContext = context; launchFlowConversation', {
      context: { get: name => services[name] },
      callApi: async args => args.op === 'flows.models' ? { ok: true, groups: [{ id: 'provider', models: [{ id: 'model', reasoning: { efforts: supported ? [{ id: 'high' }] : [] } }] }] } : { ok: true, workspaceId: 'workspace', execution: args.execution, requiredReasoningEffort: 'high', prompt: 'organize-inbox' },
    })
    if (supported) { await launch({ id: 'builtin-inbox-organize', revision: 1 }, 'fixture', {}, { provider: 'provider', model: 'model' }); assert.deepEqual(calls, ['create', 'select-high', 'organize-inbox']) }
    else { await assert.rejects(launch({ id: 'builtin-inbox-organize', revision: 1 }, 'fixture', {}), /High/); assert.deepEqual(calls, []) }
  }
})
