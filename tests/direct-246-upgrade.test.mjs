import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createCore } from '../packages/kb-core/index.js'
import { clientFlow, mountPublishedHost } from './fixtures/legacy-246-host.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const repo = path.resolve(import.meta.dirname, '..')
const originalArchive = path.join(repo, 'dist/local-dsh-knowledge-base-2.4.6.tgz')
const manifest = JSON.parse(execFileSync('git', ['show', 'v2.4.13:release-manifest-v2.json'], { cwd: repo, encoding: 'utf8' }))
const targetArchive = await readFile(path.join(repo, 'dist', manifest.tgz))
assert.equal(manifest.version, '2.4.13')
assert.equal(sha(targetArchive), 'a7966d297df119573d85a4cbca532359beab1018fd469f387a0a496cc8984b49')

test('unmodified 2.4.6 automatic flow to official 2.4.13 with real Windows adapter, pnpm and services',
  { skip: process.platform !== 'win32', timeout: 180000 }, async t => {
    const parent = path.join(repo, '.test-runs'); await mkdir(parent, { recursive: true })
    const root = await mkdtemp(path.join(parent, 'direct246-'))
    const realFetch = globalThis.fetch, downloads = []
    // Supply exact released bytes over the updater's fetch interface. No worker,
    // adapter or client source is patched; network/mirror availability is outside
    // this deterministic Windows integration check.
    globalThis.fetch = async url => {
      const name = new URL(url).pathname
      if (name.endsWith('/preview-manifest.json')) return new Response(JSON.stringify({ package: manifest.package, channel: 'preview', active: false }))
      if (name.endsWith('/release-manifest.json') || name.endsWith('/release-manifest-v2.json')) return new Response(JSON.stringify(manifest))
      if (name.endsWith('/' + manifest.tgz)) { downloads.push(name); return new Response(targetArchive) }
      throw Error('Unexpected remote fetch in isolated fixture')
    }
    const evidence = { oldVersion: '2.4.6', targetVersion: '2.4.13', patchedOldFiles: 0, recoveryToolUsed: false, scenarios: {} }
    async function fixture(label, extra = {}) {
      const directory = path.join(root, label), profile = path.join(directory, 'profile')
      const plugin = path.join(profile, 'node_modules/@local/dsh-knowledge-base'), library = path.join(directory, 'library')
      await mkdir(plugin, { recursive: true }); await mkdir(library)
      execFileSync('python', ['-X', 'utf8', '-c',
        "import tarfile,pathlib,sys,hashlib;p=pathlib.Path(sys.argv[1]);assert hashlib.sha256(p.read_bytes()).hexdigest()=='dba33f268771d01435aafa6bf331fb00d83901daeaab2353c2bdc3832ca93c45';d=pathlib.Path(sys.argv[2]);t=tarfile.open(p);[(d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).parent.mkdir(parents=True,exist_ok=True),d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).write_bytes(t.extractfile(m).read())) for m in t if m.isfile()]",
        originalArchive, plugin], { windowsHide: true })
      const oldSpec = 'file:' + originalArchive.replaceAll('\\', '/')
      await writeFile(path.join(profile, 'package.json'), JSON.stringify({ private: true,
        dependencies: { '@local/dsh-knowledge-base': oldSpec, ...extra }, dsh: { profile: { bundles: ['@local/dsh-knowledge-base'] } } }))
      await writeFile(path.join(profile, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: false\n\nimporters:\n  .:\n    dependencies:\n      '@local/dsh-knowledge-base':\n        specifier: " + JSON.stringify(oldSpec) + '\n        version: ' + JSON.stringify(oldSpec) + '\n\npackages:\n  ' + JSON.stringify('@local/dsh-knowledge-base@' + oldSpec) + ':\n    resolution: {tarball: ' + JSON.stringify(oldSpec) + '}\n\nsnapshots:\n  ' + JSON.stringify('@local/dsh-knowledge-base@' + oldSpec) + ': {}\n')
      const core = createCore({ stateDir: path.join(directory, 'embedded') })
      assert.equal((await core.bind(library, { confirmInit: true })).ok, true)
      await writeFile(path.join(library, '.desktop-preview.json'), JSON.stringify({ schemaVersion: 1, synthetic: true }))
      await writeFile(path.join(library, 'original.txt'), 'SYNTHETIC_ORIGINAL_UNCHANGED')
      const { resolveHostPython } = await import(pathToFileURL(path.join(plugin, 'packages/kb-service/host-python.js')))
      const python = await resolveHostPython(plugin, { home: path.join(directory, 'external-python') })
      const options = { root: directory, profile, plugin, library, home: path.join(directory, 'services'), python }
      const host = await mountPublishedHost({ ...options, fetchLocal: realFetch })
      assert.equal(host.build.buildId, '5c9679e46cbc1498')
      const clientSource = await readFile(path.join(plugin, 'src/client/index.js'), 'utf8')
      const beforeConfig = await readFile(path.join(profile, 'package.json')), beforeLock = await readFile(path.join(profile, 'pnpm-lock.yaml'))
      const beforeWorker = await readFile(path.join(plugin, 'tools/kb-transactional-update.py'))
      return { ...options, host, core, clientSource, beforeConfig, beforeLock, beforeWorker }
    }
    async function assertOld(f) {
      assert.equal(JSON.parse(await readFile(path.join(f.plugin, 'package.json'), 'utf8')).version, '2.4.6')
      assert.ok((await readFile(path.join(f.profile, 'package.json'))).equals(f.beforeConfig))
      assert.ok((await readFile(path.join(f.profile, 'pnpm-lock.yaml'))).equals(f.beforeLock))
      assert.ok((await readFile(path.join(f.plugin, 'tools/kb-transactional-update.py'))).equals(f.beforeWorker))
      assert.equal(await readFile(path.join(f.library, 'original.txt'), 'utf8'), 'SYNTHETIC_ORIGINAL_UNCHANGED')
      assert.equal((await f.host.client.call('service.health')).active, true)
    }
    try {
      await t.test('clean profile: shipped automatic trigger downloads, commits and confirms 2.4.13 after a fresh Host process', async () => {
        const f = await fixture('clean')
        try {
          const checked = await f.host.api({ op: 'updates.check', force: true })
          assert.equal(checked.latestVersion, '2.4.13'); assert.equal(checked.autoInstallEligible, true)
          const oldHealth = await f.host.client.call('service.health')
          const flow = clientFlow(f.clientSource, { api: f.host.api })
          await flow.auto(checked)
          assert.equal(flow.states.at(-1).restartRequired, true, JSON.stringify(flow.states))
          const journal = JSON.parse(await readFile(path.join(f.profile, '.kb-safe-updates/transaction.json'), 'utf8'))
          assert.equal(journal.phase, 'committed'); assert.equal(journal.version, '2.4.13')
          assert.equal(JSON.parse(await readFile(path.join(f.plugin, 'package.json'), 'utf8')).version, '2.4.13')
          const receipt = JSON.parse(await readFile(path.join(f.home, oldHealth.library.instanceId, 'last-close.json'), 'utf8'))
          assert.equal(receipt.clean, true); assert.equal(receipt.bootId, oldHealth.bootId)
          await f.host.close()
          const input = path.join(root, 'verify-new.json'), output = path.join(root, 'verify-new-result.json')
          await writeFile(input, JSON.stringify({ root: f.root, profile: f.profile, plugin: f.plugin, library: f.library, home: f.home,
            python: f.python, oldBootId: oldHealth.bootId, pending: flow.pending, output }))
          const fresh = await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [path.join(repo, 'tests/fixtures/legacy-246-host.mjs'), '--verify-new', input], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
            let text = ''; child.stdout.on('data', b => { text += b }); child.stderr.on('data', b => { text += b })
            child.on('error', reject); child.on('exit', code => resolve({ code, text }))
          })
          assert.equal(fresh.code, 0, fresh.text)
          assert.equal(await readFile(path.join(f.library, 'original.txt'), 'utf8'), 'SYNTHETIC_ORIGINAL_UNCHANGED')
          const active = JSON.parse(await readFile(output, 'utf8'))
          evidence.scenarios.clean = { committed: true, automaticTrigger: true, realOldWorker: true, oldServiceCleanExit: true,
            restartRequired: true, originalUnchanged: true, ...active }
        } finally { await f.host.close(); f.core.dispose?.() }
      })
      await t.test('old pending receipt: actual original API leaves the client blocked before prepare', async () => {
        const f = await fixture('pending')
        try {
          const checked = await f.host.api({ op: 'updates.check', force: true })
          const pending = { requestId: 'synthetic-old-host-request', latestVersion: '2.4.6', buildId: f.host.build.buildId, stage: 'installing' }
          const post = await f.host.api({ op: 'status' }), get = await f.host.api({}, 'GET')
          assert.equal(post.status.build, undefined); assert.equal(get.status.build.buildId, pending.buildId)
          const start = f.host.calls.length, flow = clientFlow(f.clientSource, { api: f.host.api, record: pending })
          await flow.auto(checked)
          assert.equal(flow.states.at(-1).uncertain, true)
          assert.deepEqual(flow.pending, pending)
          assert.equal(f.host.calls.slice(start).some(x => x.op === 'updates.prepare'), false)
          await assertOld(f)
          evidence.scenarios.pendingReceipt = { blockedBeforePrepare: true, oldPackageAndMetadataUnchanged: true, serviceStillActive: true }
        } finally { await f.host.close(); f.core.dispose?.() }
      })
      for (const [name, other] of [
        ['relativeDependency', { '@example/local-agent': 'file:local-plugins/agent' }],
        ['unavailableSdk', { '@example/kb-unpublished-host-sdk': '99.0.0-synthetic-unavailable' }],
      ]) await t.test(name + ': original preparation fails without replacing the old version', async () => {
        const f = await fixture(name, other)
        try {
          if (name === 'relativeDependency') {
            await mkdir(path.join(f.profile, 'local-plugins/agent'), { recursive: true })
            await writeFile(path.join(f.profile, 'local-plugins/agent/package.json'), JSON.stringify({ name: '@example/local-agent', version: '1.0.0' }))
          }
          const checked = await f.host.api({ op: 'updates.check', force: true }), flow = clientFlow(f.clientSource, { api: f.host.api })
          const start = f.host.calls.length
          await flow.auto(checked)
          assert.equal(flow.states.at(-1).manualHelp, true)
          assert.match(flow.states.at(-1).message, /安全更新未完成/)
          assert.equal(f.host.calls.slice(start).filter(x => x.op === 'updates.prepare').length, 1)
          assert.equal(f.host.calls.slice(start).some(x => x.op === 'updates.install'), false)
          await assertOld(f)
          evidence.scenarios[name] = { blockedAtPrepare: true, oldPackageAndMetadataUnchanged: true, serviceStillActive: true,
            ...(name === 'unavailableSdk' ? { sdkMissingFromOldLockAndOfflineCache: true } : {}) }
        } finally { await f.host.close(); f.core.dispose?.() }
      })
    } finally {
      globalThis.fetch = realFetch
      evidence.downloadRequests = downloads.length
      await writeFile(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
      console.log('EVIDENCE ' + path.join(root, 'result.json'))
      console.log(JSON.stringify(evidence))
    }
  })
