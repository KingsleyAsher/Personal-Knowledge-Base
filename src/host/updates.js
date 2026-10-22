import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parseKnowledgeVersion, compareKnowledgeVersions } from './versioning.js'

// Manifest checks remain read-only. The client may automatically install stable
// updates within the same major version; installation and activation stay host-managed.
export const UPDATE_REPOSITORY = 'https://github.com/KingsleyAsher/Personal-Knowledge-Base'
export const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/release-manifest.json'
export const UPDATE_PREVIEW_MANIFEST_URL = 'https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/preview-manifest.json'
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

export function startAutomaticChecks(checker, timers = globalThis) {
  const startup = timers.setTimeout(() => { void checker.check() }, 15000)
  const interval = timers.setInterval(() => { void checker.check({ force: true }) }, UPDATE_INTERVAL_MS)
  return () => { timers.clearTimeout(startup); timers.clearInterval(interval) }
}

export function compareStableVersions(a, b) {
  if (parseKnowledgeVersion(a)?.channel !== 'stable' || parseKnowledgeVersion(b)?.channel !== 'stable') throw Error('版本号格式无效')
  return compareKnowledgeVersions(a, b)
}

export function compareReleaseVersions(a, b) {
  return compareKnowledgeVersions(a, b)
}

const REPO_PATH = 'KingsleyAsher/Personal-Knowledge-Base'
const MAX_UPDATE_BYTES = 16 * 1024 * 1024
export const UPDATE_SOURCES = Object.freeze([
  { id: 'gitee', name: 'Gitee', repository: 'https://gitee.com/' + REPO_PATH,
    file: rel => 'https://gitee.com/' + REPO_PATH + '/raw/main/' + rel,
    hosts: ['gitee.com', 'raw.giteeusercontent.com'] },
  { id: 'gitcode', name: 'GitCode', repository: 'https://gitcode.com/' + REPO_PATH,
    file: rel => 'https://api.gitcode.com/api/v5/repos/' + REPO_PATH + '/raw/' + rel + '?ref=main',
    hosts: ['api.gitcode.com', 'raw.gitcode.com', 'gitcode.com'] },
  { id: 'github', name: 'GitHub', repository: UPDATE_REPOSITORY,
    file: rel => 'https://raw.githubusercontent.com/' + REPO_PATH + '/main/' + rel,
    hosts: ['raw.githubusercontent.com'] },
])

function selectedSources(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !UPDATE_SOURCES.some(s => s.id === id))) throw Error('更新源无效')
  return [...new Set(ids)].map(id => UPDATE_SOURCES.find(s => s.id === id))
}

// Follow only a bounded set of HTTPS redirects belonging to the selected service.
// No cookies, authorization, mirror-provided download URLs or user paths are sent.
async function sourceBytes(fetchFn, source, rel, limit, timeoutMs) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  let url = source.file(rel)
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const target = new URL(url)
      if (target.protocol !== 'https:' || target.port || target.username || target.password || !source.hosts.includes(target.hostname)) throw Error('更新源跳转不受信任')
      const response = await fetchFn(url, { signal: controller.signal, redirect: source.id === 'github' ? 'error' : 'manual', cache: 'no-store',
        headers: { accept: '*/*', ...(source.id === 'gitcode' ? { referer: source.repository } : {}) } })
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === 4) throw Error('更新源跳转次数过多')
        url = new URL(location, url).href
        continue
      }
      if (!response.ok) throw Error('HTTP ' + response.status)
      if (!response.body) throw Error('更新源未返回内容')
      if ((response.headers.get('content-type') || '').toLowerCase().includes('text/html')) { await response.body.cancel(); throw Error('更新源返回网页，无法作为下载文件') }
      const reader = response.body.getReader(), chunks = []; let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break
          bytes += value.byteLength
          if (bytes > limit) { await reader.cancel(); throw Error('更新文件超过允许大小') }
          chunks.push(Buffer.from(value))
        }
      } finally { reader.releaseLock() }
      return Buffer.concat(chunks)
    }
  } catch (error) {
    if (controller.signal.aborted) throw Error('连接超时')
    throw error
  } finally { clearTimeout(timer) }
}

export function createUpdateChecker({ currentVersion, fetch: fetchFn = globalThis.fetch, now = Date.now, timeoutMs = 6000,
  previewManifestUrl = UPDATE_PREVIEW_MANIFEST_URL, sourceIds = UPDATE_SOURCES.map(s => s.id) } = {}) {
  const sources = selectedSources(sourceIds)
  let cached = null, expiresAt = 0, inflight = null
  async function channel(preview) {
    const results = await Promise.all(sources.map(async source => {
      try {
        const raw = await sourceBytes(fetchFn, source, preview ? 'preview-manifest.json' : 'release-manifest.json', 65536, timeoutMs)
        const m = JSON.parse(raw.toString('utf8'))
        const parsedVersion = parseKnowledgeVersion(m.version, { allowLegacyPreview: preview })
        if (m.package !== '@local/dsh-knowledge-base' || parsedVersion?.channel !== (preview ? 'preview' : 'stable') ||
            m.tgz !== 'local-dsh-knowledge-base-' + m.version + '.tgz' || !/^[a-f0-9]{64}$/.test(m.sha256 || '')) throw Error('更新清单无效')
        if (!/^[a-f0-9]{16}$/.test(m.buildId || '') || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > MAX_UPDATE_BYTES) throw Error('更新清单缺少有效的构建号或大小')
        return { source, manifest: m, ok: true }
      } catch (error) { return { source, ok: false, error: error instanceof SyntaxError ? '更新清单无效' : String(error.message || error).slice(0,180) } }
    }))
    const good = results.filter(x => x.ok).sort((a,b) => compareReleaseVersions(b.manifest.version,a.manifest.version))
    const sourceStatus = results.map(x => ({ id: x.source.id, name: x.source.name, ok: x.ok, version: x.manifest?.version, error: x.error }))
    if (!good.length) return { ok: false, sourceStatus, error: '检查更新失败：所有更新源暂不可用，请稍后重试' }
    const chosen = good[0], m = chosen.manifest
    if (good.some(x => x.manifest.version === m.version && (x.manifest.sha256 !== m.sha256 || x.manifest.bytes !== m.bytes || x.manifest.buildId !== m.buildId))) {
      return { ok: false, sourceStatus, error: '检查更新失败：相同版本的更新源摘要不一致，请稍后重试' }
    }
    const comparison = compareReleaseVersions(m.version,currentVersion)
    const installedVersion = parseKnowledgeVersion(currentVersion, { allowLegacyPreview: true })
    const latestVersion = parseKnowledgeVersion(m.version)
    const autoInstallEligible = comparison > 0 && !preview && installedVersion?.channel === 'stable' && latestVersion?.channel === 'stable' && installedVersion.major === latestVersion.major
    return { ok: true, currentVersion, latestVersion: m.version, channel: preview ? 'preview' : 'stable', updateAvailable: comparison > 0, autoInstallEligible, ahead: comparison < 0,
      checkedAt: new Date(now()).toISOString(), source: chosen.source.repository, sourceId: chosen.source.id, sourceName: chosen.source.name,
      sourceIds: sources.map(s => s.id), sourceStatus,
      downloadUrl: chosen.source.file('dist/' + encodeURIComponent(m.tgz)),
      downloadSources: sources.map(s => ({ id: s.id, name: s.name, url: s.file('dist/' + encodeURIComponent(m.tgz)) })),
      notesUrl: chosen.source.repository + '/blob/main/' + (preview ? 'PREVIEW.md' : 'RELEASE.md'),
      tgz: m.tgz, sha256: m.sha256, bytes: m.bytes, buildId: m.buildId }
  }
  async function latest() {
    const [stable, preview] = await Promise.all([channel(false), previewManifestUrl ? channel(true) : null])
    const result = { ...stable, currentVersion, currentChannel: parseKnowledgeVersion(currentVersion, { allowLegacyPreview: true })?.channel || 'unknown', checkedAt: new Date(now()).toISOString() }
    if (preview?.ok) result.preview = preview
    else if (preview) { result.previewError = '预览版信息暂不可用，可稍后重新检查'; result.previewSourceStatus = preview.sourceStatus }
    return result
  }
  return { check({ force = false } = {}) {
    if (inflight) return inflight
    if (!force && cached && now() < expiresAt) return Promise.resolve({ ...cached, cached: true })
    inflight = latest().then(result => { cached = result; expiresAt = now() + (result.ok ? UPDATE_INTERVAL_MS : 5 * 60 * 1000); return result }).finally(() => { inflight = null })
    return inflight
  } }
}

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
export function createUpdateDownloader({ checker, cacheDir, fetch: fetchFn = globalThis.fetch, timeoutMs = 20000 } = {}) {
  let inflight = null, inflightVersion = null
  async function download(expectedVersion) {
    if (!cacheDir) throw Error('当前宿主未提供插件更新缓存目录')
    const checked = await checker.check({ force: true })
    const release = checked.preview?.latestVersion === expectedVersion ? checked.preview : checked
    if (!release.ok) throw Error(release.error)
    if (!release.updateAvailable) throw Error('没有可安装的新版本')
    if (!parseKnowledgeVersion(expectedVersion, { allowLegacyPreview: true }) || expectedVersion !== release.latestVersion) throw Error('发布版本已变化，请重新检查更新')
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
    const temporary = target + '.' + randomUUID() + '.tmp'
    const sources = selectedSources(release.sourceIds || ['github'])
    sources.sort((a,b) => (a.id === release.sourceId ? -1 : b.id === release.sourceId ? 1 : 0))
    const errors = []
    try {
      for (const source of sources) {
        try {
          const raw = await sourceBytes(fetchFn, source, 'dist/' + encodeURIComponent(release.tgz), release.bytes, timeoutMs)
          verifyUpdateArchive(raw, release)
          await writeFile(temporary, raw, { flag: 'wx', mode: 0o600 })
          try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
          await rename(temporary, target)
          return { ...result, downloadSource: source.id, downloadSourceName: source.name }
        } catch (error) {
          errors.push(source.name + '：' + String(error.message || error))
          try { await unlink(temporary) } catch { /* keep no unverified temporary package */ }
        }
      }
      throw Error('安装包下载失败：' + errors.join('；'))
    } finally { try { await unlink(temporary) } catch { /* no partial archive is installable */ } }
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
