import path from 'node:path'
import { mkdir, readdir, stat, lstat, readFile, writeFile, copyFile, rename, rm, realpath, open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { digest, inside, fail, safePath, relativePath, atomicJson, readJson, locked } from './workbench-state.js'
import { privateRootOf } from './fsindex.js'

const NAME = /^kb-backup-\d{13}-[a-f0-9-]{36}$/
async function fileHash(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export function createBackupService({ stateDir, binding, scan, userData, visible, checkDestination, now }) {
  const running = new Map()
  async function directory(b, args) {
    const value = String(args.directory || b.preferences.backup.directory || '')
    if (!value) throw fail('BACKUP_DIRECTORY_REQUIRED', '请先选择库外备份目录')
    return checkDestination(value, b)
  }
  async function verify(b, dir, name) {
    if (!NAME.test(name)) throw fail('BAD_BACKUP', '备份名称无效')
    const folder = await safePath(dir, name)
    const manifest = await readJson(await safePath(folder, 'manifest.json'), {})
    if (manifest.format !== 1 || manifest.kbId !== b.st.kbId || !Array.isArray(manifest.files)) throw fail('BACKUP_IDENTITY', '备份格式或知识库身份不匹配')
    const errors = []
    for (const item of manifest.files) {
      try {
        const file = await safePath(folder, 'files/' + relativePath(item.path))
        if ((await stat(file)).size !== item.bytes || await fileHash(file) !== item.sha256) errors.push({ path: item.path, reason: 'checksum-mismatch' })
      } catch { errors.push({ path: item.path, reason: 'missing-or-unreadable' }) }
    }
    return { folder, manifest, errors, valid: errors.length === 0 && manifest.complete === true }
  }
  async function create(b, args) {
    if (args.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', '请确认当前知识库后备份')
    const dir = await directory(b, args)
    if (running.has(b.key)) throw fail('BACKUP_BUSY', '此知识库正在备份')
    const id = randomUUID(), task = { id, state: 'running', type: 'backup', startedAt: new Date(now()).toISOString(), copied: 0 }
    running.set(b.key, task)
    try {
      await mkdir(dir, { recursive: true })
      return await locked(path.join(dir, '.kb-backup'), async () => {
        const folderName = 'kb-backup-' + now() + '-' + id
        const temp = path.join(dir, '.' + folderName + '.pending'), dest = path.join(dir, folderName)
        await mkdir(temp, { recursive: false })
        const snap = await scan(b, true)
        const includePrivate = args.includePrivate ?? b.preferences.backup.includePrivate
        const manifest = { format: 1, kbId: b.st.kbId, createdAt: new Date(now()).toISOString(), kind: args.kind || 'manual', includePrivate,
          complete: true, files: [], issues: [], coverage: snap.coverage, externalSourcesIncluded: false, userDataIncluded: includePrivate }
        if (snap.coverage.errors || snap.coverage.truncated) manifest.issues.push({ reason: 'incomplete-scan' })
        const entries = snap.files.filter(f => (args.exportOnly ? visible(b, f.path) : includePrivate || !f.private) && (!args.paths || args.paths.includes(f.path))).map(f => f.path)
        // Reconstructible caches and secret-bearing profile files are deliberately excluded.
        for (const rel of args.exportOnly ? [] : ['.kbmeta/kb.json', ...includePrivate ? ['.kbmeta/import-sources.json'] : []]) {
          try { await safePath(b.root, rel); entries.push(rel) } catch { /* optional */ }
        }
        for (const rel of entries) {
          try {
            await binding(b.st.kbId)
            const source = await safePath(b.root, rel), before = await stat(source)
            const target = await safePath(temp, 'files/' + rel, { missing: true })
            await mkdir(path.dirname(target), { recursive: true })
            await copyFile(source, target)
            const hash = await fileHash(target), after = await stat(source)
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || await fileHash(source) !== hash) throw Error('changed-during-backup')
            manifest.files.push({ path: rel, bytes: before.size, sha256: hash })
            task.copied++
          } catch (error) { manifest.issues.push({ path: rel, reason: error.code || error.message }) }
        }
        const data = await userData(b)
        const chosen = new Set(entries)
        const privatePath = p => args.exportOnly ? !chosen.has(p) : privateRootOf(p, b.privateDirs) !== null
        const filtered = includePrivate && !args.exportOnly ? data : { ...data, links: data.links.filter(e => !privatePath(e.from) && !privatePath(e.to)),
          captures: data.captures.filter(c => !privatePath(c.path)), annotations: data.annotations.filter(a => !privatePath(a.path)),
          reading: Object.fromEntries(Object.entries(data.reading).filter(([p]) => !privatePath(p))), reviews: Object.fromEntries(Object.entries(data.reviews).filter(([p]) => !privatePath(p))), tasks: [] }
        await putMetadata('workbench-user-data.json', filtered)
        try {
          if (args.exportOnly) throw Object.assign(new Error(), { code: 'ENOENT' })
          const flowFile = await safePath(path.join(stateDir, 'flows'), b.st.kbId + '/flows.json')
          // Flow definitions are user content, never include provider/credential settings.
          await putMetadata('workbench-flows.json', JSON.parse(await readFile(flowFile, 'utf8')))
        } catch (e) { if (e.code !== 'ENOENT') manifest.issues.push({ reason: 'flows-unreadable' }) }
        async function putMetadata(name, value) {
          const rel = '.kbmeta/' + name, target = path.join(temp, 'files', rel)
          await atomicJson(target, value)
          manifest.files.push({ path: rel, bytes: (await stat(target)).size, sha256: await fileHash(target) })
        }
        manifest.complete = manifest.issues.length === 0
        await atomicJson(path.join(temp, 'manifest.json'), manifest)
        await rename(temp, dest)
        task.state = manifest.complete ? 'done' : 'partial'
        return { name: folderName, directory: dir, manifest, task }
      })
    } finally { running.delete(b.key) }
  }
  const privatePath = (snap, p) => snap.files.find(f => f.path === p)?.private === true
  async function list(b, args) {
    const dir = await directory(b, args)
    let names
    try { names = await readdir(dir) } catch (e) { if (e.code === 'ENOENT') return { items: [], directory: dir }; throw e }
    const items = []
    for (const name of names.filter(n => NAME.test(n)).sort().reverse()) {
      try {
        const file = await safePath(dir, name + '/manifest.json'), m = await readJson(file, {})
        if (m.kbId === b.st.kbId && m.format === 1) items.push({ name, createdAt: m.createdAt, complete: m.complete, files: m.files.length, kind: m.kind, includePrivate: m.includePrivate })
      } catch { /* Foreign directories are never treated as our retention candidates. */ }
    }
    return { items, directory: dir, running: running.get(b.key) || null }
  }
  async function restore(b, args) {
    if (args.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', '请先确认知识库身份')
    const dir = await directory(b, args), checked = await verify(b, dir, args.name)
    if (!checked.valid) throw fail('BACKUP_INVALID', '备份不完整或校验失败，未恢复')
    const destination = String(args.destination || '')
    const resolved = await checkDestination(destination, b)
    // Exclusive creation: restores cannot overwrite arbitrary existing folders.
    await mkdir(resolved, { recursive: false })
    const restored = []
    try {
      for (const item of checked.manifest.files) {
        const src = await safePath(checked.folder, 'files/' + item.path), dst = await safePath(resolved, item.path, { missing: true })
        await mkdir(path.dirname(dst), { recursive: true }); await copyFile(src, dst)
        if (await fileHash(dst) !== item.sha256) throw fail('RESTORE_CHECKSUM', '恢复文件校验失败')
        restored.push(item.path)
      }
      await atomicJson(path.join(resolved, '.kbmeta', 'restore-report.json'), { kbId: b.st.kbId, restoredAt: new Date(now()).toISOString(), files: restored.length, verified: true })
      return { destination: resolved, files: restored.length, verified: true, note: '已恢复到新目录；尚未切换绑定。重新接入时可恢复阅读与关联数据。' }
    } catch (error) { throw fail('RESTORE_PARTIAL', '恢复未完成，新目录保留用于排查；未修改当前库。' + error.message) }
  }
  async function dispatch(b, args) {
    if (args.op === 'backup.create') return create(b, args)
    if (args.op === 'backup.list') return list(b, args)
    if (args.op === 'backup.verify') { const check = await verify(b, await directory(b, args), args.name); return { valid: check.valid, errors: check.errors } }
    if (args.op === 'backup.restore') return restore(b, args)
    if (args.op === 'backup.export') {
      if (args.format === 'files') return create(b, { ...args, exportOnly: true, kind: 'export', includePrivate: b.preferences.showPrivate })
      const snap = await scan(b), data = await userData(b), files = snap.files.filter(f => visible(b, f.path) && (!args.paths || args.paths.includes(f.path)))
      if (args.format === 'csv') {
        const cell = v => '"' + String(v ?? '').replaceAll('"', '""').replace(/^[=+@-]/, "'$&") + '"'
        return { filename: '知识库目录.csv', text: '\ufeff标题,路径,类型,标签,修改时间\n' + files.map(f => [f.title, f.path, f.kind, f.tags.join('；'), new Date(f.mtimeMs).toISOString()].map(cell).join(',')).join('\n') }
      }
      return { filename: '知识库关系与摘录.json', text: JSON.stringify({ files, links: data.links.filter(e => visible(b, e.from) && visible(b, e.to)), annotations: data.annotations.filter(a => visible(b, a.path)) }, null, 2) }
    }
    if (args.op === 'backup.restore-file') {
      const checked = await verify(b, await directory(b, args), args.name), rel = relativePath(args.path)
      if (!checked.valid) throw fail('BACKUP_INVALID', '备份校验失败')
      if (!visible(b, rel) || rel.startsWith('.')) throw fail('PRIVATE_HIDDEN', '当前范围不允许恢复此文件')
      const item = checked.manifest.files.find(f => f.path === rel)
      if (!item) throw fail('NOT_FOUND', '备份中不存在此文件')
      const target = await safePath(b.root, rel, { missing: true })
      let currentHash = null
      try { currentHash = await fileHash(target) } catch (e) { if (e.code !== 'ENOENT') throw e }
      if (args.confirm !== true) {
        const preview = /\.(md|txt|json|csv|ya?ml)$/i.test(rel) && item.bytes <= 262144
        return { requiresConfirmation: true, currentHash, backupHash: item.sha256, bytes: item.bytes,
          backupText: preview ? await readFile(await safePath(checked.folder, 'files/' + rel), 'utf8') : null,
          currentText: preview && currentHash && (await stat(target)).size <= 262144 ? await readFile(target, 'utf8') : null }
      }
      if (args.expectedKbId !== b.st.kbId || args.expectedHash !== currentHash) throw fail('FILE_CHANGED', '文件或知识库发生变化，请重新比较')
      const lock = await b.core._internal.acquireKbLock(b.root, 'workbench-restore')
      if (!lock.ok) throw fail('LIBRARY_BUSY', '知识库正在写入')
      try {
        await binding(b.st.kbId)
        await safePath(b.root, rel, { missing: true })
        if (!currentHash) { try { await stat(target); throw fail('FILE_CHANGED', '原本不存在的文件现在已出现，请重新比较') } catch (e) { if (e.code !== 'ENOENT') throw e } }
        if (currentHash) {
          if (await fileHash(target) !== currentHash) throw fail('FILE_CHANGED', '文件已改变')
          const protectedFile = await safePath(b.root, '.kbmeta/backups/restore-' + randomUUID() + '.bak', { missing: true })
          await mkdir(path.dirname(protectedFile), { recursive: true }); await copyFile(target, protectedFile)
        }
        await mkdir(path.dirname(target), { recursive: true })
        const temp = target + '.' + randomUUID() + '.restore'
        await copyFile(await safePath(checked.folder, 'files/' + rel), temp)
        if (await fileHash(temp) !== item.sha256) throw fail('RESTORE_CHECKSUM', '文件恢复校验失败')
        await rename(temp, target)
        return { restored: true, path: rel }
      } finally { if (!lock.reentrant) await b.core._internal.releaseKbLock(b.root, lock.info.token) }
    }
    throw fail('UNKNOWN_BACKUP', '未知备份操作')
  }
  async function automatic(b) {
    if (!b.preferences.backup.enabled || running.has(b.key)) return
    const listing = await list(b, {})
    const last = listing.items.find(i => i.complete && ['daily', 'weekly'].includes(i.kind))
    const period = b.preferences.backup.frequency === 'weekly' ? 7 : 1
    if (last && now() - Date.parse(last.createdAt) < period * 86400000) return
    const weekly = listing.items.find(i => i.kind === 'weekly' && i.complete)
    const kind = !weekly || now() - Date.parse(weekly.createdAt) >= 7 * 86400000 ? 'weekly' : 'daily'
    const created = await create(b, { expectedKbId: b.st.kbId, kind })
    if (!created.manifest.complete) return
    const dir = created.directory, next = await list(b, {})
    for (const [group, keep] of [['daily', 7], ['weekly', 4]]) for (const item of next.items.filter(i => i.kind === group && i.complete).slice(keep)) {
      // Only verified, owned snapshots under the configured root are eligible.
      const target = await safePath(dir, item.name)
      if (!inside(await realpath(dir), target) || !NAME.test(path.basename(target))) throw fail('RETENTION_PATH', '保留策略路径检查失败')
      const checked = await verify(b, dir, item.name)
      if (checked.valid) await rm(target, { recursive: true })
    }
  }
  return { dispatch, automatic, running }
}
