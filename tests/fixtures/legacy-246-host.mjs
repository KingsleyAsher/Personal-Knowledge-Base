// Minimal Host services around the unmodified published adapter. The adapter,
// HTTP handler, updater, Python worker and runtime all come from the package.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'

export function shippedFunction(source, name) {
  source = source.replaceAll('\r', '')
  const start = source.indexOf('    function ' + name + '(')
  assert.ok(start >= 0, name)
  const end = source.indexOf('\n    }', start) + 6
  return source.slice(start, end)
}

export function clientFlow(source, { api, record = null, version = '2.4.6' }) {
  const key = 'dsh-kb-update-operation', states = []
  let stored = JSON.stringify(record), task
  const manager = {
    installBundle() { assert.fail('Safe installation must use the shipped API, not the Host installer') },
    async waitForInstall() { return { ok: true, value: null } },
  }
  const factory = vm.runInNewContext(shippedFunction(source, 'createClientUpdateFlow') + '\ncreateClientUpdateFlow')
  const automatic = {
    buildBadgeState: { version }, updateManager: manager, updateViewState: {}, automaticUpdateAttempts: new Set(),
  }
  const flow = factory({ api, manager: () => manager, clientVersion: () => version,
    storage: { getItem(name) { assert.equal(name, key); return stored }, setItem(name, value) { assert.equal(name, key); stored = value } },
    notify(state) { states.push(state); automatic.updateViewState = state }, delay: async () => {},
  })
  automatic.updateFlow = { install(target) { task = flow.install(target); return task } }
  vm.runInNewContext(['compareReleaseVersions', 'availableUpdates', 'isAutomaticUpdate', 'maybeAutoInstallUpdate']
    .map(name => shippedFunction(source, name)).join('\n') + '\nthis.runAutomatic=maybeAutoInstallUpdate', automatic)
  return { flow, states, get pending() { return JSON.parse(stored) },
    async auto(update) { automatic.runAutomatic(update); assert.ok(task, 'Shipped automatic decision must start the flow'); await task },
  }
}

export async function mountPublishedHost(options) {
  const { plugin, profile, library, home, python } = options
  const { readCandidateBuild } = await import(pathToFileURL(path.join(plugin, 'packages/kb-service/build.js')))
  const { mountServiceHost } = await import(pathToFileURL(path.join(plugin, 'packages/kb-service/host-adapter.js')))
  const build = await readCandidateBuild(plugin), routes = new Map(), cleanup = [], calls = []
  const tools = new Map()
  const values = new Map([
    ['profileContext', { dir: profile }],
    ['pluginManager', { installBundle() { assert.fail('Must not bypass old safe updater') } }],
    ['tools', { register(entry) { tools.set(entry.name, entry); return () => tools.delete(entry.name) }, get: name => tools.get(name) }],
    ['webServer', { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } }],
  ])
  const ctx = {
    get: name => values.get(name), provide: (name, value) => values.set(name, value),
    // No Agent/model/session controller is supplied: no user conversations run.
    inject() {}, effect(create) { const dispose = create(); if (typeof dispose === 'function') cleanup.push(dispose) },
  }
  const mounted = await mountServiceHost(ctx, { shared: { home, python, candidateRoot: options.root } },
    { build, profileDir: profile, library, python, isLiveKnowledgeGrant: () => false })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url, 'http://fixture').pathname)
    if (!handler) { res.writeHead(404); res.end(); return }
    Promise.resolve(handler(req, res)).catch(error => { res.writeHead(500); res.end(error.message) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const fetchLocal = options.fetchLocal || globalThis.fetch
  return {
    build, client: mounted.client, calls,
    async api(body, method = 'POST') {
      calls.push({ op: body.op, method })
      const response = await fetchLocal('http://127.0.0.1:' + server.address().port + '/kb-core/api', {
        method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined,
      })
      assert.equal(response.status, 200)
      return response.json()
    },
    async close() {
      try { await mounted.client.call('service.shutdown') } catch { /* the updater may have drained its own service */ }
      for (const dispose of cleanup.reverse()) await dispose()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

// A fresh process is essential: import caches must not reuse 2.4.6 modules after
// replacement and turn a simulated reload into a false activation result.
if (process.argv[2] === '--verify-new') {
  const input = JSON.parse(await readFile(process.argv[3], 'utf8'))
  const host = await mountPublishedHost(input)
  try {
    assert.equal(host.build.version, '2.4.13')
    assert.equal(host.build.buildId, '280919e50a3d55eb')
    const health = await host.client.call('service.health')
    assert.equal(health.active, true)
    assert.notEqual(health.bootId, input.oldBootId)
    const source = await readFile(path.join(input.plugin, 'src/client/index.js'), 'utf8')
    const flow = clientFlow(source, { api: host.api, record: input.pending, version: '2.4.13' })
    await flow.flow.recover()
    assert.equal(flow.pending, null)
    assert.equal(flow.states.at(-1).completedVersion, '2.4.13')
    const result = { activeVersion: host.build.version, activeBuild: host.build.buildId,
      runtimeBuild: health.serviceBuildId, freshService: true, pendingClearedByNewClient: true }
    await writeFile(input.output, JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } finally { await host.close() }
}
