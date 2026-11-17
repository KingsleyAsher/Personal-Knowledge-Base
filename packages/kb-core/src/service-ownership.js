import path from 'node:path'
import { readFile } from 'node:fs/promises'
// Persistent mode barrier, deliberately survives service exit. No writable fallback.
export async function assertServiceOwner(root, token, { freshSetup = false } = {}) {
  if (!root) return
  let value
  try { value = JSON.parse(await readFile(path.join(root, '.kbmeta', 'service-mode.json'), 'utf8')) }
  catch (e) {
    if (e.code !== 'ENOENT') throw Object.assign(new Error('Service mode marker is unreadable'), { code: 'RECOVERY_REQUIRED' })
    if (token || freshSetup) return
    let meta
    try { meta = JSON.parse(await readFile(path.join(root, '.kbmeta', 'kb.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return; throw error }
    if (meta?.freshSharedSetup === true) throw Object.assign(new Error('新库正在启用共享服务，请在原设置页重试'), { code: 'SERVICE_REQUIRED' })
    return
  }
  if (value.schemaVersion !== 1 || !token || token !== value.ownerToken) throw Object.assign(new Error('此知识库由共享服务管理；请完全退出并重新打开 DSH 后接入，无需再次建库。'), { code: 'SERVICE_REQUIRED' })
}
