import { mkdir, readFile, writeFile, rename, open, unlink, realpath, lstat } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

export const digest = value => createHash('sha256').update(value).digest('hex')
export const inside = (root, file) => { const rel = path.relative(root, file); return rel === '' || !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel) }
export const fail = (code, message) => Object.assign(new Error(message), { code })
export const relativePath = value => {
  const rel = String(value ?? '').replaceAll('\\', '/')
  if (!rel || rel.startsWith('/') || rel.includes(':') || rel.split('/').some(s => s === '..' || s === '.' || !s || /[. ]$/.test(s)) || /[\x00-\x1f]/.test(rel)) throw fail('BAD_PATH', '必须指定有效的库内相对路径')
  return rel
}

// Resolve every existing component, rejecting junctions/symlinks even for writes.
export async function safePath(root, rel, { missing = false } = {}) {
  rel = relativePath(rel)
  const base = await realpath(root)
  let file = base
  const parts = rel.split('/')
  for (let i = 0; i < parts.length; i++) {
    file = path.join(file, parts[i])
    try {
      const st = await lstat(file)
      if (st.isSymbolicLink()) throw fail('LINK_DENIED', '不允许通过目录链接访问资料')
      if (!inside(base, await realpath(file))) throw fail('PATH_ESCAPE', '路径超出知识库')
    } catch (error) { if (missing && error.code === 'ENOENT') continue; throw error }
  }
  if (!inside(base, file)) throw fail('PATH_ESCAPE', '路径超出知识库')
  return file
}

export async function readJson(file, seed) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid state')
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(seed)
    throw fail('STATE_CORRUPT', '用户数据无法读取，已保留原文件，未覆盖')
  }
}

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); await rename(temp, file) }
  finally { await unlink(temp).catch(() => {}) }
}

// O_EXCL serializes across service instances/processes; never silently steal a lock.
export async function locked(file, fn) {
  await mkdir(path.dirname(file), { recursive: true })
  let handle
  const token = randomUUID()
  for (let i = 0; i < 60; i++) {
    try { handle = await open(file + '.lock', 'wx'); await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: hostname() })); break }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const old = JSON.parse(await readFile(file + '.lock', 'utf8'))
        if (old.host === hostname() && Number.isInteger(old.pid) && old.pid > 0 && old.token) {
          let dead = false
          try { process.kill(old.pid, 0) } catch (e) { dead = e.code === 'ESRCH' }
          if (dead && JSON.parse(await readFile(file + '.lock', 'utf8')).token === old.token) await unlink(file + '.lock')
        }
      } catch { /* incomplete or active lock: wait, never overwrite */ }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  if (!handle) throw fail('STATE_BUSY', '另一项操作正在保存，请稍后重试')
  try { return await fn() } finally {
    await handle.close()
    try { if (JSON.parse(await readFile(file + '.lock', 'utf8')).token === token) await unlink(file + '.lock') } catch {}
  }
}

export const DEFAULT_PREFERENCES = Object.freeze({
  showPrivate: false, allowPrivateQuestions: false, autoParse: false,
  reviewReminders: false, reviewFrequency: 'weekly', landing: 'map',
  backup: { enabled: false, directory: '', frequency: 'daily', includePrivate: true },
})

export function validatePreferences(input) {
  const p = structuredClone(DEFAULT_PREFERENCES)
  for (const key of ['showPrivate', 'allowPrivateQuestions', 'autoParse', 'reviewReminders']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw fail('BAD_SETTINGS', key + ' 必须是开关值')
    p[key] = input[key] ?? p[key]
  }
  if (!p.showPrivate) p.allowPrivateQuestions = false
  for (const [key, allowed] of [['landing', ['map', 'overview', 'remember']], ['reviewFrequency', ['daily', 'weekly']]]) {
    p[key] = input[key] ?? p[key]
    if (!allowed.includes(p[key])) throw fail('BAD_SETTINGS', key + ' 无效')
  }
  const b = input.backup ?? p.backup
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail('BAD_SETTINGS', '备份设置无效')
  for (const key of ['enabled', 'includePrivate']) if (b[key] !== undefined && typeof b[key] !== 'boolean') throw fail('BAD_SETTINGS', '备份开关无效')
  p.backup = { enabled: b.enabled ?? false, includePrivate: b.includePrivate ?? true, directory: String(b.directory ?? '').trim(), frequency: b.frequency ?? 'daily' }
  if (!['daily', 'weekly'].includes(p.backup.frequency)) throw fail('BAD_SETTINGS', '备份频率无效')
  if (p.backup.enabled && !p.backup.directory) throw fail('BACKUP_DIRECTORY_REQUIRED', '开启备份后必须选择库外备份目录')
  return p
}
