import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

// Checking remains read-only. Downloads require a separate user-triggered action;
// installation and activation belong to the host's pluginManager service.
export const UPDATE_REPOSITORY = 'https://github.com/KingsleyAsher/Personal-Knowledge-Base'
export const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/release-manifest.json'
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export function startAutomaticChecks(checker, timers = globalThis) {
  const startup = timers.setTimeout(() => { void checker.check() }, 15000)
  const interval = timers.setInterval(() => { void checker.check({ force: true }) }, UPDATE_INTERVAL_MS)
  return () => { timers.clearTimeout(startup); timers.clearInterval(interval) }
}

function stableParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.length > 50) return null
  return version.split('.').map(BigInt)
}

export function compareStableVersions(a, b) {
  const left = stableParts(a), right = stableParts(b)
  if (!left || !right) throw new Error('版本号格式无效')
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}

export function createUpdateChecker({ currentVersion, fetch: fetchFn = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  let cached = null
  let expiresAt = 0
  let inflight = null
  async function fetchLatest() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(UPDATE_MANIFEST_URL, {
        signal: controller.signal, redirect: 'error', cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('GitHub 返回 HTTP ' + response.status)
      const reader = response.body.getReader()
      const chunks = []
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > 65536) { await reader.cancel(); throw new Error('更新信息过大') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const data = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
      const manifest = JSON.parse(new TextDecoder().decode(data))
      if (manifest.package !== '@local/dsh-knowledge-base' || !stableParts(manifest.version)
        || manifest.tgz !== 'local-dsh-knowledge-base-' + manifest.version + '.tgz'
        || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) throw new Error('GitHub 更新清单无效')
      // A local preview may compare with the stable feed, while remote
      // prereleases remain rejected by the manifest validation above.
      const currentBase = typeof currentVersion === 'string' ? currentVersion.replace(/-preview\.[1-9]\d*$/, '') : currentVersion
      let comparison = compareStableVersions(manifest.version, currentBase)
      if (comparison === 0 && currentBase !== currentVersion) comparison = 1
      return {
        ok: true, currentVersion, latestVersion: manifest.version,
        updateAvailable: comparison > 0, ahead: comparison < 0,
        checkedAt: new Date(now()).toISOString(), source: UPDATE_REPOSITORY,
        downloadUrl: UPDATE_RAW_ROOT + encodeURIComponent(manifest.tgz),
        notesUrl: UPDATE_REPOSITORY + '/blob/main/RELEASE.md',
        tgz: manifest.tgz, sha256: manifest.sha256, bytes: manifest.bytes, buildId: manifest.buildId,
      }
    } catch (error) {
      const detail = controller.signal.aborted ? '连接 GitHub 超时' : error instanceof SyntaxError ? 'GitHub 更新清单无效' : String(error.message || error)
      return { ok: false, currentVersion, checkedAt: new Date(now()).toISOString(), error: '检查更新失败：' + (detail === 'fetch failed' ? '无法连接 GitHub，请稍后重试' : detail) }
    } finally { clearTimeout(timer) }
  }
  return {
    check({ force = false } = {}) {
      if (inflight) return inflight
      if (!force && cached && now() < expiresAt) return Promise.resolve({ ...cached, cached: true })
      inflight = fetchLatest().then(result => {
        cached = result
        expiresAt = now() + (result.ok ? UPDATE_INTERVAL_MS : 5 * 60 * 1000)
        return result
      }).finally(() => { inflight = null })
      return inflight
    },
  }
}

const UPDATE_RAW_ROOT = 'https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/'
const MAX_UPDATE_BYTES = 16 * 1024 * 1024

/** Preflight the archive before handing it to the host package manager. */
export function verifyUpdateArchive(raw, release) {
  if (raw.length !== release.bytes || createHash('sha256').update(raw).digest('hex') !== release.sha256) throw Error('安装包摘要或大小不符，请重新检查更新')
  const tar = gunzipSync(raw, { maxOutputLength: 32 * 1024 * 1024 })
  let info = null
  const paths = new Set()
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const text = (start, end) => header.subarray(start, end).toString('utf8').split('\0')[0]
    const octal = (value) => { if (!/^[0-7]+$/.test(value.trim())) throw Error('安装包 tar 字段无效'); return parseInt(value.trim(), 8) }
    const sum = [...header].reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0)
    if (sum !== octal(text(148, 156))) throw Error('安装包 tar 校验失败')
    const size = octal(text(124, 136)), type = text(156, 157), name = [text(345, 500), text(0, 100)].filter(Boolean).join('/')
    const end = offset + 512 + size
    if (!Number.isSafeInteger(size) || end > tar.length) throw Error('安装包内容不完整')
    if (type === 'x' || type === 'g') {
      // Permit timestamps emitted by npm/Python tar; never accept path overrides.
      const metadata = tar.subarray(offset + 512, end).toString('utf8')
      if (/(?:^|\n)\d+ (?:path|linkpath|size)=/.test(metadata)) throw Error('安装包不允许重写路径或大小')
    } else {
      if (!['', '0', '5'].includes(type) || !name.startsWith('package/') || /[\\:]/.test(name) || name.split('/').includes('..')) throw Error('安装包含不允许的路径或链接')
      const canonical = name.replace(/\/$/, '').toLowerCase()
      if (paths.has(canonical)) throw Error('安装包含重复路径')
      paths.add(canonical)
      if (name === 'package/package.json') {
        if (info !== null || type === '5') throw Error('安装包清单重复或无效')
        info = JSON.parse(tar.subarray(offset + 512, end).toString('utf8'))
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (info?.name !== '@local/dsh-knowledge-base' || info.version !== release.latestVersion || !info.dsh?.bundle) throw Error('安装包名称、版本或插件声明不符')
  return info
}

/** Downloads only to a hash-specific cache. No client-supplied URL/path is used. */
export function createUpdateDownloader({ checker, cacheDir, fetch: fetchFn = globalThis.fetch, timeoutMs = 60000 } = {}) {
  let inflight = null, inflightVersion = null
  async function download(expectedVersion) {
    if (!cacheDir) throw Error('当前宿主未提供插件更新缓存目录')
    const release = await checker.check({ force: true })
    if (!release.ok) throw Error(release.error)
    if (!release.updateAvailable) throw Error('没有可安装的新版本')
    if (!stableParts(expectedVersion) || expectedVersion !== release.latestVersion) throw Error('发布版本已变化，请重新检查更新')
    if (release.tgz !== 'local-dsh-knowledge-base-' + expectedVersion + '.tgz' || !/^[a-f0-9]{64}$/.test(release.sha256 || '') || !/^[a-f0-9]{16}$/.test(release.buildId || '') || !Number.isSafeInteger(release.bytes) || release.bytes < 1 || release.bytes > MAX_UPDATE_BYTES) throw Error('发布清单缺少有效的大小、摘要或构建号')
    const dir = path.resolve(cacheDir, release.sha256)
    const target = path.join(dir, release.tgz)
    await mkdir(dir, { recursive: true })
    const result = { ok: true, spec: target, latestVersion: release.latestVersion, buildId: release.buildId }
    try {
      const existing = await stat(target)
      if (existing.isFile() && existing.size === release.bytes) {
        verifyUpdateArchive(await readFile(target), release)
        return { ...result, cached: true }
      }
    } catch { /* missing or corrupt cache is downloaded again */ }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
    const temporary = target + '.' + randomUUID() + '.tmp'
    try {
      const response = await fetchFn(UPDATE_RAW_ROOT + encodeURIComponent(release.tgz), { signal: controller.signal, redirect: 'error', cache: 'no-store' })
      if (!response.ok) throw Error('安装包下载失败：HTTP ' + response.status)
      if (!response.body) throw Error('安装包下载未返回内容')
      const reader = response.body.getReader(), chunks = []
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > release.bytes || bytes > MAX_UPDATE_BYTES) { await reader.cancel(); throw Error('安装包超过发布清单大小') }
          chunks.push(Buffer.from(value))
        }
      } finally { reader.releaseLock() }
      const raw = Buffer.concat(chunks)
      verifyUpdateArchive(raw, release)
      await writeFile(temporary, raw, { flag: 'wx', mode: 0o600 })
      try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
      await rename(temporary, target)
      return result
    } catch (error) {
      if (controller.signal.aborted) throw Error('下载安装包超时，请重试')
      throw error
    } finally {
      clearTimeout(timer)
      try { await unlink(temporary) } catch { /* no partial archive is offered for installation */ }
    }
  }
  return {
    prepare({ expectedVersion } = {}) {
      if (inflight) return expectedVersion === inflightVersion ? inflight : Promise.reject(Error('另一个更新下载正在进行'))
      inflightVersion = expectedVersion
      inflight = download(expectedVersion).finally(() => { inflight = null; inflightVersion = null })
      return inflight
    },
  }
}
