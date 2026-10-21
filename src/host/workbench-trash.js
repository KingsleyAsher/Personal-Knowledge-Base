import path from 'node:path'
import { mkdir, readdir, rename, unlink, rmdir, link, copyFile, stat, realpath } from 'node:fs/promises'
import { constants, createReadStream } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { digest, fail, relativePath, safePath, readJson, atomicJson, locked } from './workbench-state.js'
import { writableFile, fileRole } from './workbench-files.js'

const fileHash = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
const TTL = 30 * 86400000
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const exists = async file => { try { await stat(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const own = (data, file) => ({
  reading: data.reading[file] || null, review: data.reviews[file] || null,
  annotations: data.annotations.filter(a => a.path === file), captures: data.captures.filter(c => c.path === file),
  links: data.links.filter(l => l.from === file || l.to === file),
})
const detach = (data, record) => {
  data.trashOperations ??= {}
  if (data.trashOperations[record.id] === 'moved') return
  delete data.reading[record.path]; delete data.reviews[record.path]
  for (const [key, values] of [['annotations', record.metadata.annotations], ['captures', record.metadata.captures], ['links', record.metadata.links]]) {
    const ids = new Set(values.map(v => v.id)); data[key] = data[key].filter(v => !ids.has(v.id))
  }
  data.trashOperations[record.id] = 'moved'
}
const attach = (data, record) => {
  data.trashOperations ??= {}
  if (data.trashOperations[record.id] === 'restored') return
  if (record.metadata.reading) data.reading[record.path] = record.metadata.reading
  if (record.metadata.review) data.reviews[record.path] = record.metadata.review
  for (const [key, values] of [['annotations', record.metadata.annotations], ['captures', record.metadata.captures], ['links', record.metadata.links]]) {
    const ids = new Set(data[key].map(v => v.id)); data[key].push(...values.filter(v => !ids.has(v.id)))
  }
  data.trashOperations[record.id] = 'restored'
}

export function createTrashService({ stateDir, getCore, binding, versionOf, userData, mutate, assertVisible, visible, relations, fileInfo, now, log }) {
  const registry = path.join(stateDir, 'workbench', 'trash-libraries.json')
  let lastSweep = -Infinity
  const location = async (b, id, name = 'manifest.json', missing = false) => {
    if (!ID.test(id)) throw fail('BAD_TRASH_ID', '回收站编号无效')
    return safePath(b.root, '.kbmeta/trash/' + id + '/' + name, { missing })
  }
  async function register(b) {
    await locked(registry, async () => {
      const value = await readJson(registry, { format: 1, libraries: {} })
      value.libraries[b.key] = { root: b.root, kbId: b.st.kbId, dataFile: b.dataFile }
      await atomicJson(registry, value)
    })
    lastSweep = -Infinity
  }
  async function entries(b) {
    let directory
    try { directory = await safePath(b.root, '.kbmeta/trash') } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    const result = []
    for (const id of await readdir(directory)) {
      if (!ID.test(id)) continue
      try {
        const item = await readJson(await location(b, id), {})
        if (item.id !== id || item.kbId !== b.st.kbId || item.format !== 1 || !Number.isFinite(item.deletedAt) || item.expiresAt !== item.deletedAt + TTL || !['moving', 'stored', 'restoring', 'restored', 'purging', 'purged'].includes(item.state) || !item.metadata) throw fail('TRASH_CORRUPT', '回收站记录损坏')
        relativePath(item.path)
        if (fileRole(item.path) !== 'document' || !Array.isArray(item.metadata.annotations) || !Array.isArray(item.metadata.links) || !Array.isArray(item.metadata.captures)) throw fail('TRASH_CORRUPT', '回收站记录不兼容')
        result.push(item)
      } catch (error) { log('warn', '回收站条目无法读取，保留未删除：' + id + ' · ' + (error.code || error.message)) }
    }
    return result
  }
  const save = async (b, item) => atomicJson(await location(b, item.id, 'manifest.json', true), item)
  async function validateRoot(b) {
    const meta = await readJson(await safePath(b.root, '.kbmeta/kb.json'), {})
    if (meta.kbId !== b.st.kbId) throw fail('BINDING_CHANGED', '知识库身份不一致，回收站操作已停止')
  }
  const editState = (b, fn) => locked(b.dataFile, async () => {
    await validateRoot(b)
    const data = await userData(b)
    if (fn(data) === false) return
    data.revision++; await atomicJson(b.dataFile, data)
  })
  async function removeJournal(b, item) {
    // Only these two owned files can be removed; never recursively delete a supplied path.
    const payload = await location(b, item.id, 'payload', true)
    if (await exists(payload)) throw fail('TRASH_INCOMPLETE', '文件仍在回收站，操作记录已保留')
    await unlink(await location(b, item.id))
    await rmdir(await safePath(b.root, '.kbmeta/trash/' + item.id)).catch(e => { if (e.code !== 'ENOTEMPTY') throw e })
    await editState(b, data => { if (!data.trashOperations?.[item.id]) return false; delete data.trashOperations[item.id] })
  }
  async function reconcile(b) {
    await validateRoot(b)
    for (const item of await entries(b)) {
      const payload = await location(b, item.id, 'payload', true), target = await safePath(b.root, item.path, { missing: true })
      if (item.state === 'moving') {
        if (await exists(payload)) {
          if (await exists(target)) { log('warn', '回收站移动中断且原路径有文件，保留两份待处理：' + item.id); continue }
          await editState(b, data => detach(data, item))
          item.state = 'stored'; await save(b, item)
        } else if (await exists(target) && (await fileHash(target)) === item.sha256) { item.state = 'restored'; await save(b, item); await removeJournal(b, item) }
      } else if (item.state === 'restoring') {
        const targetInfo = await stat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e })
        const payloadInfo = await stat(payload).catch(e => { if (e.code === 'ENOENT') return null; throw e })
        const ownedTarget = targetInfo && (item.targetIdentity && targetInfo.ino === item.targetIdentity.ino && targetInfo.dev === item.targetIdentity.dev || payloadInfo && targetInfo.ino === payloadInfo.ino && targetInfo.dev === payloadInfo.dev)
        if (ownedTarget && (await fileHash(target)) === item.sha256) {
          await editState(b, data => attach(data, item))
          if (await exists(payload)) await unlink(payload)
          item.state = 'restored'; await save(b, item); await removeJournal(b, item)
        } else if (await exists(payload)) { item.state = 'stored'; await save(b, item) }
      } else if (item.state === 'restored' || item.state === 'purged') await removeJournal(b, item)
      else if (item.state === 'purging') await purge(b, item)
    }
  }
  async function purge(b, item) {
    await validateRoot(b)
    item.state = 'purging'; await save(b, item)
    const payload = await location(b, item.id, 'payload', true)
    if (await exists(payload)) await unlink(payload)
    item.metadata = { reading: null, review: null, annotations: [], captures: [], links: [] }
    item.state = 'purged'; await save(b, item); await removeJournal(b, item)
  }
  async function dispatch(b, args) {
    await validateRoot(b)
    if (args.op === 'trash.move' && args.confirm !== true) {
      const file = relativePath(args.path); assertVisible(b, file)
      const capabilities = await writableFile(b.root, file)
      if (!capabilities.canDelete) throw fail('DELETE_DENIED', capabilities.deleteReason)
      // A file can reappear at the same path between two actions. The normal
      // five-second directory snapshot must not reject that new file here.
      const absolute = await safePath(b.root, file), info = await stat(absolute), sha256 = await fileHash(absolute), data = await userData(b), graph = await relations(b, { path: file, includeArchive: true, includeNavigation: true, fresh: true })
      return { preview: true, path: file, bytes: info.size, fileRevision: sha256, revision: data.revision, relatedCount: graph.total || 0 }
    }
    if (args.op === 'trash.list') {
      const items = (await entries(b)).filter(item => item.state !== 'restored' && item.state !== 'purged' && visible(b, item.path)).sort((a, z) => z.deletedAt - a.deletedAt)
      return { revision: (await userData(b)).revision, items: items.map(({ metadata, sha256, ...item }) => ({ ...item, title: item.title || path.posix.basename(item.path), daysRemaining: Math.max(0, Math.ceil((item.expiresAt - now()) / 86400000)), canRestore: item.state === 'stored' && item.expiresAt > now() })) }
    }
    if (args.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', '删除或恢复必须绑定当前知识库')
    await register(b)
    return b.core._internal.withMutationLock(b.root, async () => {
      const gate = await b.core.configGate()
      if (!gate.ok || versionOf(await binding(b.st.kbId)) !== versionOf(b)) throw fail('SETTINGS_CHANGED', '知识库设置已改变，操作未执行')
      const current = await userData(b)
      if (args.expectedRevision !== current.revision) throw fail('CONFLICT', '内容已改变，请刷新后重试')
      if (args.op === 'trash.move') {
        const file = relativePath(args.path); assertVisible(b, file)
        const capabilities = await writableFile(b.root, file)
        if (!capabilities.canDelete) throw fail('DELETE_DENIED', capabilities.deleteReason)
        const source = await safePath(b.root, file), info = await stat(source), sha256 = await fileHash(source)
        if (!args.fileRevision || sha256 !== args.fileRevision) throw fail('FILE_CHANGED', '文件内容已改变，请重新确认删除')
        const deletedAt = now()
        const item = { format: 1, id: randomUUID(), kbId: b.st.kbId, path: file, title: (await fileInfo(b, file))?.title || path.posix.basename(file), bytes: info.size, sha256, deletedAt, expiresAt: deletedAt + TTL, state: 'moving', metadata: own(current, file) }
        await mkdir(await safePath(b.root, '.kbmeta/trash/' + item.id, { missing: true }), { recursive: true })
        await save(b, item)
        const payload = await location(b, item.id, 'payload', true)
        await mutate(b, args, async data => {
          if ((await fileHash(source)) !== sha256) throw fail('FILE_CHANGED', '文件内容已改变，未删除')
          await rename(source, payload)
          detach(data, item); return {}
        })
        item.state = 'stored'; await save(b, item)
        return { id: item.id, path: file, deletedAt: item.deletedAt, expiresAt: item.expiresAt, note: '已移入回收站，30 天内可恢复' }
      }
      const item = (await entries(b)).find(i => i.id === args.id)
      if (!item || item.state !== 'stored') throw fail('TRASH_NOT_READY', '回收站条目不存在或待恢复处理，请刷新')
      assertVisible(b, item.path)
      if (args.op === 'trash.restore') {
        if (now() >= item.expiresAt) throw fail('TRASH_EXPIRED', '已超过 30 天保留期限，不能恢复')
        const target = await safePath(b.root, item.path, { missing: true }), payload = await location(b, item.id, 'payload')
        if (await exists(target)) throw fail('RESTORE_CONFLICT', '原路径已有同名文件，请先处理现有文件；未覆盖')
        if ((await fileHash(payload)) !== item.sha256) throw fail('TRASH_CHANGED', '回收站文件校验失败，已保留文件')
        await mkdir(path.dirname(target), { recursive: true })
        item.state = 'restoring'; await save(b, item)
        try {
          await mutate(b, args, async data => {
            try { await link(payload, target) } catch (e) {
              if (!['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM'].includes(e.code)) throw e
              await copyFile(payload, target, constants.COPYFILE_EXCL)
            }
            const targetInfo = await stat(target); item.targetIdentity = { ino: targetInfo.ino, dev: targetInfo.dev }; await save(b, item)
            if ((await fileHash(target)) !== item.sha256) throw fail('RESTORE_VERIFY', '恢复文件校验失败，保留回收站原件')
            attach(data, item); return {}
          })
        } catch (error) { if (error.code === 'EEXIST' || !await exists(target)) { item.state = 'stored'; await save(b, item) }; throw error }
        await unlink(payload); item.state = 'restored'; await save(b, item); await removeJournal(b, item)
        return { path: item.path, note: '文件及原有阅读、摘录、回顾记录已恢复' }
      }
      if (args.op !== 'trash.purge' || args.confirm !== true) throw fail('CONFIRM_REQUIRED', '永久删除需要明确确认')
      await mutate(b, args, () => ({}))
      await purge(b, item)
      return { note: '已永久删除，无法从回收站恢复' }
    })
  }
  async function automatic() {
    if (!getCore()) return
    if (now() - lastSweep < 3600000) return
    lastSweep = now()
    const value = await readJson(registry, { libraries: {} })
    for (const [key, stored] of Object.entries(value.libraries)) {
      try {
        const root = await realpath(stored.root), expectedKey = digest(stored.kbId + '\0' + root.toLowerCase()).slice(0, 24)
        if (expectedKey !== key || path.resolve(stored.dataFile) !== path.resolve(stateDir, 'workbench', 'libraries', key + '.json')) throw fail('TRASH_IDENTITY', '回收站登记身份不匹配')
        const b = { root, key, st: { kbId: stored.kbId }, dataFile: stored.dataFile }
        const core = getCore(); if (!core) return
        await core._internal.withMutationLock(root, async () => {
          await validateRoot(b)
          await reconcile(b)
          for (const item of await entries(b)) if (['stored', 'purging'].includes(item.state) && now() >= item.expiresAt) await purge(b, item)
        })
      } catch (error) { log('warn', '回收站到期清理暂未完成，稍后重试：' + (error.code || error.message)) }
    }
  }
  return { dispatch, entries, automatic, reconcile, capabilities: writableFile }
}
