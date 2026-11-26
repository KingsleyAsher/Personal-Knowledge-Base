import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createSafeUpdate } from './safe-update.js'
import { readCandidateBuild } from './build.js'
import { compareStableVersions, readUpdateSourceBytes, startAutomaticChecks, UPDATE_INTERVAL_MS } from '../../src/host/updates.js'

const PACKAGE = '@kingsleyasher/dsh-knowledge-base'
const registry = 'https://registry.npmjs.org'
const registrySource = { id: 'npm', hosts: ['registry.npmjs.org'], file: url => url }
const packagePage = 'https://www.npmjs.com/package/' + PACKAGE
const stable = /^\d+\.\d+\.\d+$/
const sha512 = /^sha512-[A-Za-z0-9+/]{86}==$/

export function createNpmUpdateChecker({ currentVersion, fetch = globalThis.fetch, now = Date.now }) {
  let cache, expiresAt = 0, pending
  return {
    check({ force = false } = {}) {
      if (pending) return pending
      if (!force && cache && now() < expiresAt) return Promise.resolve(cache)
      pending = (async () => {
        const base = { distribution: 'npm', currentVersion, currentChannel: 'stable', channel: 'stable', sourceName: 'npm', notesUrl: packagePage }
        try {
          const url = registry + '/' + encodeURIComponent(PACKAGE) + '/latest'
          const raw = await readUpdateSourceBytes(fetch, registrySource, url, 1024 * 1024, 8000)
          const manifest = JSON.parse(raw)
          const { version, dist } = manifest
          const archiveUrl = registry + '/' + PACKAGE + '/-/dsh-knowledge-base-' + version + '.tgz'
          if (manifest.name !== PACKAGE || !stable.test(version) || dist?.tarball !== archiveUrl || !sha512.test(dist.integrity)) {
            throw Error('npm 返回的版本或安装包信息无效')
          }
          const comparison = compareStableVersions(version, currentVersion)
          return { ...base, ok: true, onlineChecked: true, latestVersion: version, updateAvailable: comparison > 0,
            autoInstallEligible: comparison > 0, ahead: comparison < 0, integrity: dist.integrity, archiveUrl }
        } catch (error) {
          return { ...base, ok: false, updateAvailable: false, error: 'npm 更新检查失败：' + error.message }
        }
      })().then(result => {
        cache = result
        expiresAt = now() + (result.ok ? UPDATE_INTERVAL_MS : 5 * 60 * 1000)
        return result
      }).finally(() => { pending = null })
      return pending
    },
  }
}

export function createHostUpdates({ ctx, build, profileDir, fetch = globalThis.fetch,
  packageRoot = path.resolve(import.meta.dirname, '../..'), quiesce, resume, withUpdateLock }) {
  const checker = createNpmUpdateChecker({ currentVersion: build.version, fetch })
  const directory = ctx.get('profileContext')?.dir || profileDir
  const installedRoot = directory && path.join(directory, 'node_modules', PACKAGE)
  const hmr = ctx.get('hmr')
  const canActivate = typeof hmr?.runExclusive === 'function' && typeof hmr?.reconcileProfile === 'function'
  const safe = installedRoot && quiesce && withUpdateLock && createSafeUpdate({
    profileDir: directory, packageRoot, installedRoot, journalName: '.kb-npm-updates',
    quiesce, resume, withUpdateLock, activeBuild: build,
    activate: canActivate ? () => hmr.runExclusive(() => hmr.reconcileProfile()) : undefined,
  })
  const installedHere = Boolean(installedRoot && path.relative(installedRoot, packageRoot) === '')
  const supported = Boolean(safe && installedHere)
  const unavailable = () => ({ ok: false, code: 'NPM_MANAGED_UPDATE',
    error: '当前安装模式无法安全交接知识库，请通过 DSH 插件管理器更新 npm 版。' })
  let preparing
  ctx.effect(() => startAutomaticChecks(checker), 'kb-service: npm update checks')
  return {
    async check(body = {}) {
      return { ...await checker.check({ force: body.force === true }), installSupported: supported }
    },
    status: () => supported ? safe.status() : { phase: 'none', installSupported: false },
    install: body => supported ? safe.install(body) : unavailable(),
    async prepare({ expectedVersion } = {}) {
      if (!supported) return unavailable()
      if (preparing) throw Error('另一个 npm 更新正在准备')
      preparing = true
      let temp
      try {
        const installed = await readCandidateBuild(installedRoot)
        if (installed.version !== build.version || installed.buildId !== build.buildId) throw Error('已安装的插件发生变化，请先重启 DSH')
        const release = await checker.check({ force: true })
        if (!release.ok) throw Error(release.error)
        if (!release.updateAvailable || release.latestVersion !== expectedVersion) throw Error('npm 最新版本已变化，请重新检查')
        const raw = await readUpdateSourceBytes(fetch, registrySource, release.archiveUrl, 64 * 1024 * 1024, 20000)
        if ('sha512-' + createHash('sha512').update(raw).digest('base64') !== release.integrity) throw Error('npm 安装包完整性校验失败')
        temp = await mkdtemp(path.join(os.tmpdir(), 'kb-npm-update-'))
        const spec = path.join(temp, 'plugin.tgz')
        await writeFile(spec, raw, { flag: 'wx', mode: 0o600 })
        return await safe.prepare({ spec, latestVersion: expectedVersion, currentVersion: build.version, bytes: raw.length,
          sha256: createHash('sha256').update(raw).digest('hex'), integrity: release.integrity })
      } finally {
        preparing = false
        if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}
