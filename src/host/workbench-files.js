import path from 'node:path'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { safePath } from './workbench-state.js'

// One role definition for recents, delete protection and future file actions.
export function fileRole(file) {
  const normalized = String(file).replaceAll('\\', '/'), parts = normalized.split('/'), name = parts.at(-1).toLowerCase()
  if (parts.some(p => p.startsWith('.') || p.toLowerCase() === 'node_modules')) return 'internal'
  if (['index.md', 'agents.md'].includes(name) || parts.length === 1 && ['readme.md', '知识库清单.md'].includes(name)) return 'system'
  return 'document'
}

export function fileCapabilities(file, writable = true) {
  const system = fileRole(file) !== 'document'
  return { system, canDelete: !system && writable, deleteReason: system ? '知识库系统文件受保护' : !writable ? '文件或所在目录为只读，不能移入回收站' : '' }
}

export async function writableFile(root, file) {
  const absolute = await safePath(root, file), info = await stat(absolute)
  if (!info.isFile()) return { ...fileCapabilities(file, false), canDelete: false, deleteReason: '仅支持单个普通文件，不删除目录' }
  let writable = Boolean(info.mode & 0o222)
  try { await access(absolute, constants.W_OK); await access(path.dirname(absolute), constants.W_OK) } catch { writable = false }
  return { ...fileCapabilities(file, writable), bytes: info.size }
}
