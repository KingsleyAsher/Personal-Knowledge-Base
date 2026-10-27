import { open, rename, unlink, stat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createByteCache } from './retrieval-cache.js'

export const fileFingerprint = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')
const ioError = (code, message) => Object.assign(new Error(message), { code })
const positions = new WeakMap()
function lineStarts(content) {
  let starts = positions.get(content)
  if (!starts) {
    let count = 1
    for (let i = 0; i < content.text.length; i++) if (content.text.charCodeAt(i) === 10) count++
    starts = new Uint32Array(count); let at = 1
    for (let i = 0; i < content.text.length; i++) if (content.text.charCodeAt(i) === 10) starts[at++] = i + 1
    positions.set(content, starts)
  }
  return starts
}
export function sourceLine(content, offset) {
  const starts = lineStarts(content); let low = 0, high = starts.length
  while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid + 1; else high = mid }
  return Math.max(1, low)
}
export function sourceLineStart(content, line) { return lineStarts(content)[line - 1] }

async function removeAbandonedTemps(file) {
  const prefix = path.basename(file) + '.tmp-kb-'
  for (const name of await readdir(path.dirname(file))) {
    if (!name.startsWith(prefix)) continue
    const match = /^(\d+)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.exec(name.slice(prefix.length))
    if (!match) continue
    try { process.kill(Number(match[1]), 0) } catch (error) {
      if (error.code === 'ESRCH') await unlink(path.join(path.dirname(file), name)).catch(() => {})
    }
  }
}

// Iterative serialization keeps arrays/maps from acquiring a second whole-JSON
// string. Values are ordinary JSON data; do not use for arbitrary toJSON objects.
function* jsonParts(value) {
  if (Array.isArray(value)) {
    yield '['
    for (let i = 0; i < value.length; i++) { if (i) yield ','; yield* jsonParts(value[i] === undefined ? null : value[i]) }
    yield ']'
  } else if (value && typeof value === 'object') {
    yield '{'; let first = true
    for (const key of Object.keys(value)) {
      if (value[key] === undefined || typeof value[key] === 'function' || typeof value[key] === 'symbol') continue
      if (!first) yield ','; first = false
      yield JSON.stringify(key) + ':'; yield* jsonParts(value[key])
    }
    yield '}'
  } else yield JSON.stringify(value) ?? 'null'
}

export async function atomicJsonStream(file, value, { beforePublish = async () => {}, openFile = open, renameFile = rename } = {}) {
  await removeAbandonedTemps(file)
  const temp = file + '.tmp-kb-' + process.pid + '-' + randomUUID()
  let handle
  try {
    handle = await openFile(temp, 'wx')
    let buffer = '', parts = 0
    const flush = async () => { if (buffer) { await handle.writeFile(buffer, 'utf8'); buffer = '' }; await new Promise(resolve => setImmediate(resolve)) }
    for (const part of jsonParts(value)) {
      buffer += part
      if (buffer.length >= 64 * 1024 || ++parts % 4096 === 0) await flush()
    }
    buffer += '\n'; await flush(); await handle.sync(); await handle.close(); handle = null
    await beforePublish()
    for (let attempt = 0;; attempt++) {
      try { await renameFile(temp, file); break } catch (error) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  } finally { await handle?.close().catch(() => {}); await unlink(temp).catch(() => {}) }
}

export function createSourceReader() {
  const requests = new AsyncLocalStorage()
  const metrics = { reads: 0, bytes: 0, reused: 0 }
  return {
    run(fn) { return requests.getStore() ? fn() : requests.run(createByteCache({ maxBytes: 64 * 1024 * 1024, sizeOf: v => v.cost }), fn) },
    async read(file, max, strict = false) {
      const handle = await open(file, 'r')
      try {
        const before = await handle.stat({ bigint: true }), fingerprint = fileFingerprint(before)
        const key = file + '\0' + fingerprint + '\0' + max + '\0' + strict, cache = requests.getStore(), old = cache?.get(key)
        if (old) {
          if (fingerprint !== fileFingerprint(await stat(file, { bigint: true })) || fingerprint !== fileFingerprint(await handle.stat({ bigint: true }))) throw ioError('FILE_CHANGED', '文件在读取期间发生变化，请重试')
          metrics.reused++; return old.value
        }
        const size = Number(before.size), limit = Math.min(size, max), block = Buffer.alloc(Math.min(limit || 1, 256 * 1024))
        const hash = createHash('sha256'), pieces = []
        let decoder, used = 0
        while (used < limit) {
          const { bytesRead } = await handle.read(block, 0, Math.min(block.length, limit - used), used)
          if (!bytesRead) throw ioError('FILE_CHANGED', '文件在读取期间发生变化，请重试')
          const bytes = block.subarray(0, bytesRead); hash.update(bytes)
          if (!decoder) {
            const encoding = strict && bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : strict && bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
            decoder = new TextDecoder(encoding, { fatal: strict, ignoreBOM: true })
          }
          try { pieces.push(decoder.decode(bytes, { stream: true })) } catch { throw ioError('TEXT_ENCODING', '文本编码不是有效 UTF-8 或带 BOM 的 UTF-16，请先转换编码') }
          used += bytesRead
        }
        if (decoder) try { pieces.push(decoder.decode()) } catch { throw ioError('TEXT_ENCODING', '文本编码不是有效 UTF-8 或带 BOM 的 UTF-16，请先转换编码') }
        const after = await handle.stat({ bigint: true }), current = await stat(file, { bigint: true })
        if (fingerprint !== fileFingerprint(after) || fingerprint !== fileFingerprint(current)) throw ioError('FILE_CHANGED', '文件在读取期间发生变化，请重试')
        const value = { text: pieces.join(''), revision: hash.digest('hex'), truncated: size > max, bytes: size }
        metrics.reads++; metrics.bytes += used
        // Include the worst-case lazy line table, not just the text string.
        cache?.set(key, { value, cost: value.text.length * 6 + 256 })
        return value
      } finally { await handle.close() }
    },
    stats: () => ({ ...metrics }),
  }
}
