import path from 'node:path'
import { copyFile, link, lstat, open, realpath, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { fail, inside, safePath } from './workbench-state.js'

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs
async function fingerprint(file) {
  const handle = await open(file, 'r')
  try {
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    return hash.digest('hex')
  } finally { await handle.close() }
}

// Hard-link then unlink gives same-volume moves no-clobber semantics. Other
// filesystems use a disk copy; verify it before removing the source. Neither
// route loads the whole file into memory or transports it through JSON.
export async function moveInboxFile(source, destination) {
  const before = await lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw fail('INBOX_NOT_FILE', '请选择普通文件，不支持文件夹或链接')
  let created = false
  try {
    try { await link(source, destination); created = true }
    catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
      // COPYFILE_EXCL must preserve a pre-existing destination. On failure Node
      // removes its incomplete copy; never remove a file we did not create.
      await copyFile(source, destination, constants.COPYFILE_EXCL); created = true
      if (await fingerprint(source) !== await fingerprint(destination)) throw fail('INBOX_COPY_MISMATCH', '迁移校验失败，原文件已保留')
    }
    const latest = await lstat(source)
    // Creating a hard link changes ctime, so compare content/identity fields.
    if (!sameFile(before, latest)) throw fail('INBOX_SOURCE_CHANGED', '迁移时原文件发生变化，请稍后重试；原文件已保留')
    await unlink(source)
    return { bytes: before.size }
  } catch (error) {
    if (created) await unlink(destination).catch(() => {})
    throw error
  }
}

export async function inboxSource(root, stateDir, value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw fail('INBOX_SOURCE_PATH', '无法取得本机文件路径，请在 DSH 桌面端选择或拖入文件')
  const absolute = path.resolve(value), info = await lstat(absolute)
  if (!info.isFile() || info.isSymbolicLink()) throw fail('INBOX_NOT_FILE', '请选择普通文件，不支持文件夹或链接')
  const source = await realpath(absolute), library = await realpath(root), state = await realpath(stateDir)
  if (inside(state, source)) throw fail('INBOX_STATE_FILE', '不能迁移插件状态文件')
  if (inside(library, source)) {
    const rel = path.relative(library, source).replaceAll('\\', '/')
    await safePath(library, rel)
    if (!rel.startsWith('90-收件箱/')) throw fail('INBOX_LIBRARY_FILE', '该文件已在知识库中，请从资料目录管理')
    return { source, alreadyInInbox: true, path: rel, bytes: info.size }
  }
  return { source, alreadyInInbox: false, bytes: info.size }
}
