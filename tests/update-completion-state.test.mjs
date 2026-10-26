import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('    const RELEASE_VERSION ='), source.indexOf('    function apply(ctx)'))
const code = source.slice(source.indexOf('    function createClientUpdateFlow('), source.indexOf('    function BuildBadge('))

test('verified completion refreshes every badge and rejects a late check from the old build', async () => {
  let installed = false, checks = 0, resolveOld
  const oldCheck = new Promise(resolve => { resolveOld = resolve })
  const data = new Map(), events = []
  const available = { ok: true, channel: 'stable', latestVersion: '2.1.3', buildId: 'a'.repeat(16), updateAvailable: true, autoInstallEligible: true }
  const api = vm.runInNewContext(helpers + '\n' + code + '\n({ updateFlow, checkBuildUpdates, patchBuildBadge, getBuildBadge, pendingUpdatePrompts })', {
    callApi: async request => {
      if (request.op === 'status') return { status: { build: { version: installed ? '2.1.3' : '2.1.2', buildId: installed ? available.buildId : 'b'.repeat(16) } } }
      if (request.op === 'updates.prepare') return { ...available, spec: '/verified/package.tgz' }
      if (++checks === 1) return oldCheck
      assert.equal(request.force, true)
      return { ...available, currentVersion: '2.1.3', updateAvailable: false, autoInstallEligible: false }
    },
    updateManager: {
      async installBundle() { installed = true; return { ok: true, value: { application: 'applied' } } },
      async waitForInstall() { return { ok: true, value: null } },
    },
    document: { documentElement: { getAttribute: () => installed ? '2.1.3' : '2.1.2' } },
    window: { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }, dispatchEvent: event => events.push(event.detail) },
    CustomEvent: class { constructor(name, options) { this.detail = options.detail } },
  })
  api.patchBuildBadge({ version: '2.1.2', update: available })
  const checking = api.checkBuildUpdates()
  await api.updateFlow.install('2.1.3')
  assert.equal(api.getBuildBadge().version, '2.1.3')
  assert.equal(api.getBuildBadge().update.updateAvailable, false)
  assert.equal(api.pendingUpdatePrompts().length, 0)
  assert.ok(events.some(event => event.completedVersion === '2.1.3'))
  resolveOld(available); await checking
  assert.equal(api.getBuildBadge().update.updateAvailable, false)
  assert.equal(api.getBuildBadge().checking, false)
  assert.equal(checks, 2)
})
