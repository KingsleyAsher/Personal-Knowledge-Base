import path from 'node:path'
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { atomic, readJson, native, error } from './io.js'
export const nonce = () => randomBytes(32).toString('hex')
export const proof = (secret, side, transcript) => createHmac('sha256', Buffer.from(secret, 'hex')).update(side + '\0' + JSON.stringify(transcript)).digest('hex')
export const sameProof = (a, b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
export async function createAuthorization({ privateDir, python, identity }) {
  const file = path.join(privateDir, 'grants.dpapi.json')
  let vault = await readJson(file, null)
  vault = vault ? await native(python, 'unprotect', vault) : { schemaVersion: 1, grants: {} }
  const save = async () => atomic(file, await native(python, 'protect', vault))
  async function issue(label, access, expiresAt) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 366 * 86400000) throw error('BAD_REQUEST', 'Grant expiry must be within one year')
    const row = { id: randomUUID(), label, access: [...new Set(access)], expiresAt, secret: nonce(), ...identity, revoked: false }
    vault.grants[row.id] = row; await save()
    return { grantId: row.id, credential: await native(python, 'protect', row) }
  }
  const get = id => {
    const row = vault.grants[id]
    if (!row || row.revoked || row.expiresAt <= Date.now()) throw error('UNAUTHORIZED', 'Connection grant is missing, revoked or expired')
    return row
  }
  const revoke = async id => { if (!vault.grants[id]) throw error('NOT_FOUND'); vault.grants[id].revoked = true; await save() }
  let provisionCheckedUntil = 0
  return { issue, get, revoke, async provision() {
    const file = path.join(privateDir, 'bootstrap.dpapi.json')
    if (Date.now() < provisionCheckedUntil) return file
    const encrypted = await readJson(file, null)
    const current = encrypted ? await native(python, 'unprotect', encrypted) : null
    if (current) {
      const stored = vault.grants[current.id]
      if (!stored || stored.revoked || stored.secret !== current.secret || stored.instanceId !== identity.instanceId) throw error('UNAUTHORIZED', 'Bootstrap grant was revoked or identity changed')
      if (stored.expiresAt > Date.now() + 7 * 86400000) { provisionCheckedUntil = Date.now() + 3600000; return file }
    }
    await atomic(file, (await issue('local bootstrap administrator', ['read', 'edit', 'write', 'admin', 'host','chat','chat-write','approval'], Date.now() + 365 * 86400000)).credential)
    provisionCheckedUntil = Date.now() + 3600000
    return file
  } }
}
