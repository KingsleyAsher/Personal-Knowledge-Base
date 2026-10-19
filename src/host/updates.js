// Update metadata only. The check never downloads/installs code or reads library data.
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
        downloadUrl: UPDATE_REPOSITORY + '/blob/main/dist/' + encodeURIComponent(manifest.tgz),
        notesUrl: UPDATE_REPOSITORY + '/blob/main/RELEASE.md',
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
