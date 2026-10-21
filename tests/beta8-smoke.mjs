// A single short synthetic-library smoke test; no production library is accessed.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'
import { fileRole } from '../src/host/workbench-files.js'

const output = await mkdtemp(path.resolve('../beta8-service-qa-'))
const root = path.join(output, 'library'), stateDir = path.join(output, 'state')
await mkdir(root)
const core = createCore({ stateDir }, () => {})
assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
await mkdir(path.join(root, '20-知识笔记/项目'), { recursive: true })
await writeFile(path.join(root, '20-知识笔记/note.md'), '# 阅读资料\n这一段用于摘录。\n')
await writeFile(path.join(root, '20-知识笔记/link.md'), '# 引用资料\n[原文](note.md)\n')
await writeFile(path.join(root, '20-知识笔记/项目/README.md'), '# 项目普通文件\n')
await writeFile(path.join(root, '20-知识笔记/AGENTS.md'), '# 系统规则\n')
await core.maintainIndex()
let clock = Date.now()
const workbench = createWorkbench({ stateDir, getCore: () => core, now: () => clock })
const snapshot = await workbench.dispatch({ op: 'atlas.snapshot' })
const base = { expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion }
const call = (op, extra = {}) => workbench.dispatch({ ...base, op, ...extra })
const revision = async () => (await call('atlas.snapshot')).revision
assert.equal(fileRole('20-知识笔记/INDEX.MD'), 'system')
assert.equal(fileRole('20-知识笔记/项目/README.md'), 'document')
const review = await call('review.list')
assert(!review.recent.some(f => f.system)); assert(review.recentSystem.some(f => f.path.endsWith('AGENTS.md')))
await assert.rejects(call('trash.move', { path: '20-知识笔记/AGENTS.md' }), { code: 'DELETE_DENIED' })
const detail = await call('atlas.detail', { path: '20-知识笔记/note.md' })
await call('reading.progress', { path: detail.file.path, page: 3, position: 120, status: 'reading', expectedRevision: await revision() })
await call('reading.annotate', { path: detail.file.path, quote: '这一段用于摘录。', note: '自己的理解', important: true, fileRevision: detail.content.revision, expectedRevision: await revision() })
await call('review.update', { path: detail.file.path, action: 'add', expectedRevision: await revision() })
const move = async file => { const preview = await call('trash.move', { path: file }); return call('trash.move', { path: file, confirm: true, expectedRevision: preview.revision, fileRevision: preview.fileRevision }) }
const deleted = await move(detail.file.path)
assert.equal(deleted.indexUpdated, true)
await assert.rejects(stat(path.join(root, detail.file.path)), { code: 'ENOENT' })
assert.equal((await call('reading.list')).annotations.length, 0)
assert((await call('links.issues')).items.some(i => i.reason === 'target-in-trash'))
const trash = await call('trash.list'); assert.equal(trash.items.length, 1); assert.equal(trash.items[0].daysRemaining, 30)
await writeFile(path.join(root, detail.file.path), '同名新文件，不可覆盖')
await assert.rejects(call('trash.restore', { id: deleted.id, expectedRevision: await revision() }), { code: 'RESTORE_CONFLICT' })
assert.equal(await readFile(path.join(root, detail.file.path), 'utf8'), '同名新文件，不可覆盖')
// Move the collision into its own trash entry, then restore the original record.
const collision = await move(detail.file.path)
await call('trash.restore', { id: deleted.id, expectedRevision: await revision() })
assert.equal((await call('reading.list')).annotations[0].note, '自己的理解')
assert.equal((await call('reading.list')).items[0].position, 120)
await call('trash.purge', { id: collision.id, confirm: true, expectedRevision: await revision() })
const expire = await move(detail.file.path)
clock += 30 * 86400000
await assert.rejects(call('trash.restore', { id: expire.id, expectedRevision: await revision() }), { code: 'TRASH_EXPIRED' })
await workbench.runAutomatic()
assert.equal((await call('trash.list')).items.length, 0)
await assert.rejects(call('atlas.detail', { path: '../escape.md' }), { code: 'BAD_PATH' })
console.log(JSON.stringify({ passed: true, checks: ['系统分类与保护', '文件移入及引用提示', '冲突恢复不覆盖', '恢复阅读摘录记录', '永久删除与30天自动清理'], output }))
