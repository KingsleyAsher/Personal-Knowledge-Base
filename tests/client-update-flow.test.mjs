import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    function createClientUpdateFlow(')
const factory = vm.runInNewContext(source.slice(start, source.indexOf('    let updateViewState', start)) + '\ncreateClientUpdateFlow')
const key = 'dsh-kb-update-operation'
const target = { latestVersion: '1.1.3', buildId: '31705b475ab67f14' }
function setup(options = {}, data = new Map()) {
  let installed = options.active || false, installs = 0, prepares = 0, waits = 0
  const states = []
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { if (options.storageFails) throw Error('blocked'); data.set(key, value) } }
  const manager = options.noManager ? null : {
    async installBundle(spec, args) {
      installs++; assert.equal(spec, '/verified/cache/hash/package.tgz'); assert.equal(args.enabled, true); assert.ok(args.requestId)
      installed = options.loads !== false
      if (options.reply) return await options.reply
      if (options.lostReply) throw Error('transport disconnected during HMR')
      return { ok: true, value: { application: options.application || 'applied', error: { code: 'operation-error' } } }
    },
    async waitForInstall() { waits++; return { ok: true, value: null } },
  }
  const flow = factory({ api: async (request) => {
    if (request.op === 'status') return { status: { build: installed ? { version: target.latestVersion, buildId: target.buildId } : { version: '1.1.2', buildId: 'd881ed4ff0990f64' } } }
    prepares++; if (options.downloadFails) throw Error('hash mismatch')
    return { ok: true, spec: '/verified/cache/hash/package.tgz', ...target, ...(options.prepared || {}) }
  }, manager: () => manager, storage, clientVersion: () => installed && options.clientLoads !== false ? target.latestVersion : '1.1.2', notify: (state) => states.push(state), delay: async () => {} })
  return { flow, states, data, get installs() { return installs }, get prepares() { return prepares }, get waits() { return waits }, get final() { return states.at(-1) } }
}
test('one click downloads, delegates to native manager and verifies the active build; concurrent clicks deduplicate', async () => {
  const s = setup(); await Promise.all([s.flow.install('1.1.3'), s.flow.install('1.1.3')])
  assert.equal(s.prepares, 1); assert.equal(s.installs, 1); assert.match(s.final.message, /新版本已加载/)
  assert.equal(JSON.parse(s.data.get(key)), null)
  assert.match(s.states[0].message, /下载并校验/)
})
test('missing native service, download failure, stale metadata or storage failure never start installation', async () => {
  for (const options of [{ noManager: true }, { downloadFails: true }, { prepared: { latestVersion: '1.1.4' } }, { storageFails: true }]) {
    const s = setup(options); await s.flow.install('1.1.3'); assert.equal(s.installs, 0); assert.equal(s.final.busy, false)
  }
})
test('native installation failure is visible and never reported as applied', async () => {
  const s = setup({ application: 'failed', loads: false }); await s.flow.install('1.1.3')
  assert.match(s.final.message, /安装失败/); assert.equal(JSON.parse(s.data.get(key)), null)
})
test('restart-required survives a module reload and does not reinstall', async () => {
  const s = setup({ application: 'restart-required', loads: false }); await s.flow.install('1.1.3')
  assert.equal(s.final.restartRequired, true)
  const next = setup({ loads: false }, s.data); await next.flow.install('1.1.3')
  assert.equal(next.installs, 0); assert.equal(next.final.restartRequired, true)
  const restarted = setup({ active: true }, s.data); await restarted.flow.recover()
  assert.match(restarted.final.message, /新版本已加载/)
})
test('lost HMR reply is reconciled against the active build without reinstalling', async () => {
  const s = setup({ lostReply: true }); await s.flow.install('1.1.3')
  assert.equal(s.installs, 1); assert.match(s.final.message, /新版本已加载/)
})
test('unknown native outcome blocks repeat installs and can recover after module replacement', async () => {
  const s = setup({ lostReply: true, loads: false }); await s.flow.install('1.1.3')
  assert.equal(s.final.uncertain, true); await s.flow.install('1.1.3'); assert.equal(s.installs, 1)
  const next = setup({ active: true }, s.data); await next.flow.recover()
  assert.match(next.final.message, /新版本已加载/); assert.equal(next.installs, 0)
})
test('native applied alone cannot report success while old build is still active', async () => {
  const s = setup({ loads: false }); await s.flow.install('1.1.3')
  assert.equal(s.final.uncertain, true); assert.ok(JSON.parse(s.data.get(key)).requestId)
})
test('host activation without client replacement requests a page refresh, not a host restart or false success', async () => {
  const s = setup({ clientLoads: false }); await s.flow.install('1.1.3')
  assert.equal(s.final.refreshRequired, true); assert.equal(s.final.restartRequired, false)
  assert.equal(JSON.parse(s.data.get(key)).stage, 'client-refresh')
  const reloaded = setup({ active: true }, s.data); await reloaded.flow.recover()
  assert.match(reloaded.final.message, /新版本已加载/); assert.equal(reloaded.installs, 0)
})
test('late reply from an old module cannot erase a newer installation record', async () => {
  let resolve
  const reply = new Promise((done) => { resolve = done })
  const s = setup({ reply, loads: false }), operation = s.flow.install('1.1.3')
  for (let i = 0; i < 20 && s.installs === 0; i++) await Promise.resolve()
  assert.equal(s.installs, 1)
  const newer = { requestId: 'a-newer-installation', latestVersion: '1.1.4', buildId: 'a'.repeat(16), stage: 'installing' }
  s.data.set(key, JSON.stringify(newer))
  resolve({ ok: true, value: { application: 'failed' } }); await operation
  assert.deepEqual(JSON.parse(s.data.get(key)), newer)
})
