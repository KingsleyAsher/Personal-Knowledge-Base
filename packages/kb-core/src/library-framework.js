import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, link, unlink, rmdir } from 'node:fs/promises'
import { TEMPLATES, VERSION } from './kbcore.js'
import { digest, safePath, readJson, atomicJson, locked, fail } from './workbench-state.js'
import { atomicText } from './managed-files.js'

export const FRAMEWORK_VERSION = 'library-framework-v1'
const PHASES = new Set(['applying', 'failed', 'rolling-back', 'rolled-back', 'completed'])
const DIRECTORIES = ['00-画像', '10-项目', '20-知识笔记', '30-人物关系', '40-素材资源', '50-底稿', '90-收件箱', '_模板', '_手册']
const GUIDE = `# 知识库框架与管理规则

本框架提供标准目录和模板；已有资料继续留在原位置，自定义目录继续使用。

## 标准目录

${DIRECTORIES.map(name => '- ' + name + '/').join('\n')}

00-画像用于画像，10-项目用于项目，20-知识笔记用于知识，30-人物关系用于人物，40-素材资源用于素材。50-底稿保留加工底稿，90-收件箱接收待整理原件。_模板与_手册不作为普通知识条目检索。

## 管理规则

- 遵守本库已有 AGENTS.md、用户约定与隐私分区设置；本手册不覆盖既有规则。
- 原件与来源保持可追溯；框架升级不搬移、删除或重写已有资料。
- 使用知识库工具创建条目时保留标题、类型、标签、状态、更新时间等字段；来源与推断分别注明。
- 插件更新与知识库框架迁移分别记录。缺失目录和模板可补齐；内容不同的已有文件保留，需用户查看差异后决定如何合并。
- 全文和向量索引属于可重建派生数据；模板迁移不会重建资料或调用模型。
`
const RULES = '# 知识库管理规则\n\n本库采用可扩展的目录框架，说明见 [_手册/知识库框架.md](_手册/知识库框架.md)。\n\n保留原件、来源与用户自定义结构。整理和生成知识笔记应遵守用户要求及隐私分区设置。不要因插件更新而搬移、删除或覆盖已有资料。\n'
const INDEX = '# 知识库导航\n\n人工维护的导航页，插件不会覆盖已有内容。\n\n' + DIRECTORIES.map(name => '- [' + name + '/](' + name + '/)').join('\n') + '\n'

function catalog() {
  return [...DIRECTORIES.map(name => ({ path: name, kind: 'directory' })),
    ...Object.entries(TEMPLATES).map(([name, content]) => ({ path: '_模板/' + name, kind: 'file', content })),
    { path: '_手册/知识库框架.md', kind: 'file', content: GUIDE },
    { path: 'AGENTS.md', kind: 'file', content: RULES }, { path: 'INDEX.md', kind: 'file', content: INDEX }]
}

// Additive migration: existing bytes never become replacement/deletion targets.
// Preview is read-only. Apply needs the same binding and exact preview state.
export function createLibraryFramework({ binding, now = Date.now, fault = async () => {} }) {
  const plans = new Map()
  const receipt = async b => safePath(b.root, '.kbmeta/framework-migrations/last.json', { missing: true })
  const assertIdentity = async b => {
    if ((await binding(b.st.kbId)).key !== b.key) throw fail('BINDING_CHANGED', '知识库已切换，请重新预览')
  }
  async function inspect(b) {
    const rows = []
    for (const item of catalog()) {
      const file = await safePath(b.root, item.path, { missing: true })
      let stat
      try { stat = await lstat(file) } catch (e) { if (e.code !== 'ENOENT') throw e }
      const beforeHash = stat?.isFile() ? digest(await readFile(file)) : null
      const desiredHash = item.kind === 'file' ? digest(item.content) : null
      const blocked = Boolean(stat && (item.kind === 'file' ? !stat.isFile() : !stat.isDirectory()))
      rows.push({ path: item.path, kind: item.kind, beforeHash, desiredHash,
        status: blocked ? 'blocked' : !stat ? 'create' : item.kind === 'directory' || beforeHash === desiredHash ? 'current' : 'preserved' })
    }
    return rows
  }
  const fingerprint = (b, rows) => digest(JSON.stringify({ key: b.key, version: FRAMEWORK_VERSION, rows }))
  async function status(b) {
    const journal = await readJson(await receipt(b), null)
    if (!journal) return null
    if (journal.format !== 1 || journal.key !== b.key || !PHASES.has(journal.phase) || !Array.isArray(journal.rows) || journal.rows.some(row => !row || typeof row.path !== 'string')) throw fail('STATE_CORRUPT', '迁移记录无法核对，未覆盖')
    return { phase: journal.phase, frameworkVersion: journal.frameworkVersion, programVersion: journal.programVersion,
      created: journal.rows.filter(row => row.state === 'created').map(row => row.path), error: journal.error || null,
      needsRecovery: ['applying', 'failed', 'rolling-back'].includes(journal.phase) }
  }
  async function preview(b) {
    await assertIdentity(b)
    const previous = await status(b), rows = await inspect(b)
    const planId = randomUUID(), revision = fingerprint(b, rows)
    for (const [id, plan] of plans) if (plan.expiresAt < now()) plans.delete(id)
    plans.set(planId, { key: b.key, revision, expiresAt: now() + 600000 })
    return { planId, revision, kbId: b.st.kbId, frameworkVersion: FRAMEWORK_VERSION, programVersion: VERSION,
      rows: rows.map(row => row.status === 'preserved' ? { ...row, candidate: catalog().find(item => item.path === row.path).content } : row),
      canApply: !rows.some(row => row.status === 'blocked') && !previous?.needsRecovery,
      creates: rows.filter(row => row.status === 'create').length, preserved: rows.filter(row => row.status === 'preserved').length,
      previous, movesExistingFiles: false }
  }
  async function loadJournal(b) {
    const file = await receipt(b), journal = await readJson(file, null)
    if (!journal || journal.format !== 1 || journal.key !== b.key || !PHASES.has(journal.phase) || !Array.isArray(journal.rows) || !/^[a-f0-9-]{36}$/.test(journal.id)) throw fail('STATE_CORRUPT', '迁移记录无法核对，未自动恢复')
    // A damaged receipt must not turn arbitrary paths into deletion targets.
    const allowed = new Map(catalog().map(item => [item.path, item]))
    const seen = new Set()
    for (const row of journal.rows) {
      const item = allowed.get(row?.path)
      if (!item || seen.has(row.path) || row.kind !== item.kind || row.beforeHash !== null ||
          row.kind === 'file' && row.desiredHash !== digest(item.content)) throw fail('STATE_CORRUPT', '迁移恢复范围无法核对')
      seen.add(row.path)
    }
    return { file, journal }
  }
  async function rollback(b, file, journal) {
    await assertIdentity(b)
    const owned = journal.rows.filter(row => ['creating', 'created'].includes(row.state))
    const ownedPaths = new Set(owned.map(row => row.path))
    // Validate every target before removing any new file. New user edits stop
    // recovery and remain available for manual reconciliation.
    for (const row of owned) {
      const target = await safePath(b.root, row.path, { missing: true })
      let stat
      try { stat = await lstat(target) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
      if (row.kind === 'file') {
        if (!stat.isFile() || !row.identity || String(stat.ino) !== row.identity.ino || String(stat.dev) !== row.identity.dev || digest(await readFile(target)) !== row.desiredHash) throw fail('MIGRATION_CHANGED', '迁移新增文件已有后续改动，已保留：' + row.path)
      } else {
        if (!stat.isDirectory() || !row.identity || String(stat.ino) !== row.identity.ino || String(stat.dev) !== row.identity.dev || (await readdir(target)).some(name => !ownedPaths.has(row.path + '/' + name))) throw fail('MIGRATION_CHANGED', '迁移目录身份或内容无法核对，已保留：' + row.path)
      }
    }
    journal.phase = 'rolling-back'; await atomicJson(file, journal)
    for (const row of [...owned].reverse()) {
      await assertIdentity(b)
      const target = await safePath(b.root, row.path, { missing: true })
      try {
        const stat = await lstat(target)
        if (String(stat.ino) !== row.identity.ino || String(stat.dev) !== row.identity.dev) throw fail('MIGRATION_CHANGED', '文件身份已改变，未删除：' + row.path)
        if (row.kind === 'file') {
          if (digest(await readFile(target)) !== row.desiredHash) throw fail('MIGRATION_CHANGED', '文件已改变，未删除：' + row.path)
          await unlink(target)
        } else await rmdir(target) // Empty only; never recursive removal.
      } catch (e) { if (e.code !== 'ENOENT') throw e }
      row.state = 'rolled-back'; await atomicJson(file, journal)
    }
    journal.phase = 'rolled-back'; await atomicJson(file, journal)
  }
  async function apply(b, args) {
    if (args.confirm !== true || args.expectedKbId !== b.st.kbId) throw fail('CONFIRM_REQUIRED', '请先预览并确认当前知识库的迁移内容')
    const plan = plans.get(args.planId)
    if (!plan || plan.key !== b.key || plan.revision !== args.revision || plan.expiresAt < now()) throw fail('MIGRATION_STALE', '迁移预览已失效，请重新检查')
    const file = await receipt(b)
    return locked(file, async () => {
      await assertIdentity(b)
      if ((await status(b))?.needsRecovery) throw fail('RECOVERY_REQUIRED', '请先恢复未完成的框架迁移')
      const rows = await inspect(b)
      if (fingerprint(b, rows) !== plan.revision) throw fail('FILE_CHANGED', '预览后框架文件已改变，请重新检查')
      if (rows.some(row => row.status === 'blocked')) throw fail('MIGRATION_BLOCKED', '存在同名文件或目录冲突，未迁移')
      plans.delete(args.planId)
      if (!rows.some(row => row.status === 'create')) return { phase: 'completed', frameworkVersion: FRAMEWORK_VERSION, created: [], preserved: rows.filter(row => row.status === 'preserved').map(row => row.path) }
      const journal = { format: 1, id: args.planId, key: b.key, frameworkVersion: FRAMEWORK_VERSION, programVersion: VERSION,
        phase: 'applying', createdAt: now(), rows: rows.filter(row => row.status === 'create').map(row => ({ ...row, state: 'pending' })) }
      const items = new Map(catalog().map(item => [item.path, item]))
      await atomicJson(file, journal)
      try {
        for (const row of journal.rows) {
          await assertIdentity(b)
          const target = await safePath(b.root, row.path, { missing: true })
          // Persist intent before publication. Hard-linking a completely staged
          // file is atomic and exclusive: a newly appearing file is not replaced.
          if (row.kind === 'file') {
            const staged = await safePath(b.root, '.kbmeta/framework-migrations/' + journal.id + '/staged/' + row.path, { missing: true })
            await atomicText(staged, items.get(row.path).content)
            const identity = await lstat(staged); row.identity = { ino: String(identity.ino), dev: String(identity.dev) }
            row.state = 'creating'; await atomicJson(file, journal)
            try { await link(staged, target) } catch (e) { row.state = 'pending'; await atomicJson(file, journal); throw e }
          } else {
            row.state = 'creating'; await atomicJson(file, journal)
            try { await mkdir(target) } catch (e) { row.state = 'pending'; await atomicJson(file, journal); throw e }
            const identity = await lstat(target); row.identity = { ino: String(identity.ino), dev: String(identity.dev) }
          }
          row.state = 'created'; await atomicJson(file, journal)
          await fault(row.path)
        }
        journal.phase = 'completed'; journal.completedAt = now(); await atomicJson(file, journal)
      } catch (e) {
        journal.phase = 'failed'; journal.error = { code: e.code || 'FRAMEWORK_FAILED', message: '迁移未完成，已有资料保持原位' }; await atomicJson(file, journal)
        try { await rollback(b, file, journal) } catch (recovery) { journal.phase = 'failed'; journal.error.recovery = recovery.code || 'RECOVERY_REQUIRED'; await atomicJson(file, journal) }
        throw fail('FRAMEWORK_FAILED', journal.phase === 'rolled-back' ? '迁移未完成，本次新增内容已撤销，已有资料未改动' : '迁移未完成，部分新增内容需核对；请保留迁移记录并恢复')
      }
      return { phase: journal.phase, frameworkVersion: FRAMEWORK_VERSION, created: journal.rows.map(row => row.path), preserved: rows.filter(row => row.status === 'preserved').map(row => row.path) }
    })
  }
  async function dispatch(b, args) {
    if (args.op === 'upgrade.framework-preview') return { framework: await preview(b) }
    if (args.op === 'upgrade.framework-status') return { framework: await status(b) }
    if (args.op === 'upgrade.framework-apply') return { framework: await apply(b, args) }
    if (args.op === 'upgrade.framework-recover') {
      const file = await receipt(b)
      await locked(file, async () => { const { journal } = await loadJournal(b); if (['applying', 'failed', 'rolling-back'].includes(journal.phase)) await rollback(b, file, journal) })
      return { framework: await status(b) }
    }
    throw fail('BAD_OPERATION', '未知框架迁移操作')
  }
  return { dispatch }
}
