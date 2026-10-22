import path from 'node:path'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { digest, safePath, readJson, atomicJson, locked, fail } from './workbench-state.js'

export async function atomicText(file, content) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  try { await writeFile(temp, content, { flag: 'wx' }); await rename(temp, file) }
  finally { await unlink(temp).catch(() => {}) }
}
const readOptional = file => readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e })

// Shared by bundled skills and library templates. Applied hashes only advance
// after a successful write/read-back; preserving local edits never advances them.
export async function syncManagedFiles({ root, items, manifest = '.kb-managed.json', backup = '.kb-managed-backups', candidates = '.kb-managed-candidates', check = async () => {}, now = Date.now }) {
  await mkdir(root, { recursive: true })
  const manifestFile = await safePath(root, manifest, { missing: true })
  return locked(manifestFile, async () => {
    const old = await readJson(manifestFile, {})
    if(old.format!==undefined&&old.format!==2)throw fail('STATE_CORRUPT','托管清单格式不兼容，未覆盖')
    const records = old.format === 2 ? old.files : Object.fromEntries(Object.entries(old).filter(([,v]) => typeof v === 'string').map(([k,v]) => [k, { appliedHash: v }]))
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw fail('STATE_CORRUPT', '托管清单损坏，已保留文件')
    const state = { format: 2, files: records }, result = []
    for (const item of items) {
      await check()
      const file = await safePath(root, item.path, { missing: true }), current = await readOptional(file)
      const desired = Buffer.from(item.content), previous = records[item.path] || {}
      let existing = current, replacement = desired, malformed = false
      if (item.block && current) {
        const text = current.toString('utf8'), { start, end } = item.block
        const a = text.indexOf(start), z = text.indexOf(end, a + start.length)
        malformed = a < 0 || z < 0 || text.indexOf(start, a + start.length) >= 0 || text.indexOf(end, z + end.length) >= 0
        if (!malformed) { existing = Buffer.from(text.slice(a, z + end.length)); replacement = Buffer.from(text.slice(0,a) + item.content + text.slice(z + end.length)) }
      } else if (item.block) malformed = true
      const currentHash = current ? digest(current) : null, appliedPart = existing ? digest(existing) : null, desiredHash = digest(desired)
      let status = malformed ? 'conflict' : appliedPart === desiredHash ? 'current' : !current ? 'created' : previous.appliedHash === appliedPart || (item.knownHashes || []).includes(appliedPart) ? 'updated' : 'conflict'
      const record = { ...previous, desiredHash, currentHash, version: item.version, status, needsNewSession: Boolean(item.instructions) }
      if (status === 'conflict') {
        if (previous.status === 'kept-local' && previous.desiredHash === desiredHash && previous.currentHash === currentHash) record.status = 'kept-local'
        record.candidate = candidates + '/' + item.path + '.new'
        await atomicText(await safePath(root, record.candidate, { missing: true }), desired)
      } else {
        if (status !== 'current') {
          if (current) {
            record.backup = backup + '/' + now() + '-' + randomUUID() + '/' + item.path + '.bak'
            await atomicText(await safePath(root, record.backup, { missing: true }), current)
          }
          records[item.path] = { ...record, status: 'applying' }; await atomicJson(manifestFile, state)
          await check()
          const live = await readOptional(file)
          if ((live ? digest(live) : null) !== currentHash) throw fail('FILE_CHANGED', '托管文件已改变，未覆盖')
          await atomicText(file, replacement)
          if (!(await readFile(file)).equals(replacement)) throw fail('UPGRADE_VERIFY', '托管文件写入校验失败')
        }
        record.appliedHash = desiredHash
        record.currentHash = digest(replacement)
        delete record.candidate
      }
      records[item.path] = record
      await atomicJson(manifestFile, state)
      result.push({ path: item.path, ...record })
    }
    const paths=new Set(items.map(i=>i.path))
    for(const [file,record] of Object.entries(records))if(!paths.has(file)){record.status='retired-pending';result.push({path:file,...record})}
    await atomicJson(manifestFile,state)
    return { files: result, conflicts: result.filter(r => ['conflict','retired-pending'].includes(r.status)).length }
  })
}
