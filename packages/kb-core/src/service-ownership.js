import path from 'node:path'
import { readFile } from 'node:fs/promises'
// Persistent mode barrier, deliberately survives service exit. No writable fallback.
export async function assertServiceOwner(root, token) {
  if (!root) return
  let value
  try { value = JSON.parse(await readFile(path.join(root, '.kbmeta', 'service-mode.json'), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return; throw Object.assign(new Error('Service mode marker is unreadable'), { code: 'RECOVERY_REQUIRED' }) }
  if (value.schemaVersion !== 1 || !token || token !== value.ownerToken) throw Object.assign(new Error('Library is managed by the shared service; connect to it explicitly'), { code: 'SERVICE_REQUIRED' })
}
