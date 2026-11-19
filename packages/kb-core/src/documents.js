import path from 'node:path'
import { readFile, stat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { digest, relativePath, safePath, fail, atomicJson } from './workbench-state.js'
import { fileRole, writableFile } from './workbench-files.js'

const MAX_EDIT_BYTES = 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const fingerprint = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
const revisionOf = bytes => 'raw-sha256:' + digest(bytes)
const lineEndings = text => {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const cr = (text.match(/\r(?!\n)/g) ?? []).length
  return [crlf > 0, lf > 0, cr > 0].filter(Boolean).length > 1 ? 'mixed' : crlf ? 'crlf' : lf ? 'lf' : cr ? 'cr' : 'none'
}

/** Trusted application boundary. A Host/controller must supply real caller authorization. */
export function createDocumentService({ binding, versionOf, assertVisible, notify, invalidate, authorize = async () => false }) {
  async function checked(input, action, caller) {
    if (!input || typeof input !== 'object') throw fail('BAD_REQUEST', 'Document request required')
    const b = await binding(input.expectedKbId)
    if (input.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', 'Current knowledge identity is required')
    if (input.policyVersion !== versionOf(b)) throw fail('SETTINGS_CHANGED', 'Knowledge policy changed')
    if (await authorize({ action, caller, kbId: b.st.kbId, root: b.root }) !== true) throw fail('FORBIDDEN', 'Document access requires a trusted caller')
    const file = relativePath(input.path)
    assertVisible(b, file)
    if (fileRole(file) !== 'document' || /^(?:_模板|_手册|索引层)\//.test(file)) throw fail('READ_ONLY', 'Generated and system files cannot be edited')
    if (!/\.md$/i.test(file)) throw fail('UNSUPPORTED_EDIT', 'The embedded editor supports Markdown only')
    const absolute = await safePath(b.root, file)
    const capabilities = await writableFile(b.root, file)
    if (!capabilities.canDelete) throw fail('READ_ONLY', 'Document or directory is not writable')
    const latest = await binding(b.st.kbId)
    if (latest.key !== b.key) throw fail('BINDING_CHANGED', 'Knowledge binding changed')
    if (versionOf(latest) !== input.policyVersion) throw fail('SETTINGS_CHANGED', 'Knowledge policy changed during authorization')
    assertVisible(latest, file)
    return { b: latest, file, absolute }
  }
  async function load(absolute) {
    const before = await stat(absolute, { bigint: true })
    if (!before.isFile()) throw fail('READ_ONLY', 'A regular document is required')
    if (before.size > BigInt(MAX_EDIT_BYTES)) throw fail('EDIT_TOO_LARGE', 'Document exceeds the complete editing limit')
    const bytes = await readFile(absolute)
    if (bytes.length > MAX_EDIT_BYTES) throw fail('EDIT_TOO_LARGE', 'Document exceeds the complete editing limit')
    const after = await stat(absolute, { bigint: true })
    if (fingerprint(before) !== fingerprint(after)) throw fail('CONFLICT', 'Document changed during read')
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    let text
    try { text = decoder.decode(bom ? bytes.subarray(3) : bytes) }
    catch { throw fail('UNSUPPORTED_ENCODING', 'Only lossless UTF-8 editing is supported') }
    return { bytes, text, bom, revision: revisionOf(bytes), fingerprint: fingerprint(after), newline: lineEndings(text) }
  }
  async function recheck(input, original, action, caller) {
    const current = await checked(input, action, caller)
    if (current.b.key !== original.b.key || current.absolute !== original.absolute) throw fail('BINDING_CHANGED', 'Knowledge binding changed')
    return current
  }
  return {
    async readForEdit(input, caller) {
      const current = await checked(input, 'readForEdit', caller)
      const content = await load(current.absolute)
      await recheck(input, current, 'readForEdit', caller)
      return { kbId: current.b.st.kbId, path: current.file, text: content.text, revision: content.revision,
        encoding: 'utf-8', bom: content.bom, newline: content.newline,
        original: true, complete: true, canEdit: true, maxBytes: MAX_EDIT_BYTES }
    },
    async save(input, caller) {
      if (typeof input?.text !== 'string' || !input.expectedRevision?.startsWith('raw-sha256:')) throw fail('BAD_REQUEST', 'Complete original text and its editing revision are required')
      if (input.text.startsWith('\ufeff') || Buffer.from(input.text, 'utf8').toString('utf8') !== input.text) throw fail('BAD_REQUEST', 'Text must be lossless UTF-8 without a caller-supplied BOM')
      const original = await checked(input, 'save', caller)
      const result = await original.b.core._internal.withMutationLock(original.b.root, async () => {
        const current = await recheck(input, original, 'save', caller)
        const before = await load(current.absolute)
        if (before.revision !== input.expectedRevision) throw fail('CONFLICT', 'Document was modified by another writer')
        const payload = Buffer.concat([before.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(input.text, 'utf8')])
        if (payload.length > MAX_EDIT_BYTES) throw fail('EDIT_TOO_LARGE', 'Document exceeds the complete editing limit')
        const transaction = input.operationId ?? randomUUID(); if (!/^[a-f0-9-]{32,64}$/.test(transaction)) throw fail('BAD_REQUEST', 'Invalid internal operation identity'); const backupRelative = '.kbmeta/backups/editor-' + transaction
        const backup = await safePath(current.b.root, backupRelative, { missing: true })
        await mkdir(backup, { recursive: false })
        const backupFile = path.join(backup, 'original.md')
        let backupHandle
        try { backupHandle = await open(backupFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY); await backupHandle.writeFile(before.bytes); await backupHandle.sync() }
        finally { await backupHandle?.close() }
        await atomicJson(path.join(backup, 'manifest.json'), { format: 1, path: current.file, revision: before.revision, bytes: before.bytes.length, sha256: digest(before.bytes) })
        const temporary = current.absolute + '.tmp-kb-editor-' + transaction
        let handle
        try {
          handle = await open(temporary, 'wx'); await handle.writeFile(payload); await handle.sync(); await handle.close(); handle = null
          await recheck(input, current, 'save', caller)
          const final = await load(current.absolute)
          if (final.revision !== before.revision || final.fingerprint !== before.fingerprint) throw fail('CONFLICT', 'Document changed before publish')
          await rename(temporary, current.absolute)
        } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
        invalidate()
        notify({ type: 'files-changed', kbId: current.b.st.kbId, paths: [current.file] })
        return { committed: true, kbId: current.b.st.kbId, path: current.file, revision: revisionOf(payload), backup: backupRelative,
          index: { state: 'pending' } }
      })
      if (result?.ok === false) throw fail('STATE_BUSY', result.detail || result.reason || 'Knowledge writer is busy')
      return result
    },
  }
}
