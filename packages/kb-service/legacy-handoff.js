import path from 'node:path'
import { readJson, native, error } from './io.js'

// Exact runtime fingerprint of the published 2.4.3 package, not a caller label.
export const LEGACY_243_BUILD = '7ed38d914480a2b3'
export async function waitForLegacy243({ health, client, privateDir, python, timeoutMs = 60000, pause = ms => new Promise(r => setTimeout(r, ms)), read = readJson, birth = pid => native(python, 'birth', { pid }) }) {
  try {
    if (health.serviceBuildId !== LEGACY_243_BUILD) throw error('CAPABILITY_UNSUPPORTED', '未识别的旧服务，请查看更新恢复说明')
    const ready = await read(path.join(privateDir, 'ready.json'), null)
    if (!ready || ready.bootId !== health.bootId) throw error('BINDING_CHANGED', '旧服务身份已变化')
    const originalBirth = await birth(ready.pid)
    // Never request shutdown from a legacy service without a drain protocol.
    // Releasing this probe allows its existing idle lifecycle to finish. Other
    // clients/tasks are not terminated to make an update proceed.
    client.close()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const latest = await read(path.join(privateDir, 'ready.json'), null)
      if (latest?.bootId !== ready.bootId) throw error('BINDING_CHANGED', '其他连接已更换服务，未强制接管')
      const stopped = originalBirth === null || await birth(ready.pid) !== originalBirth
      const receipt = await read(path.join(privateDir, 'last-close.json'), null)
      if (stopped && receipt?.bootId === ready.bootId && receipt.clean === true) return { legacy: true, bootId: ready.bootId }
      await pause(200)
    }
    throw error('SERVICE_UPGRADE_REQUIRED', '旧服务仍有连接或任务，交接已延后；请查看更新恢复说明')
  } finally { client.close() }
}
