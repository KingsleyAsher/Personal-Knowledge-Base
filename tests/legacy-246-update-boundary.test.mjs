import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const root = new URL('..', import.meta.url)
const oldSource = execFileSync('python', ['-X', 'utf8', '-c',
  "import tarfile,hashlib;from pathlib import Path;p=Path('dist/local-dsh-knowledge-base-2.4.6.tgz');assert hashlib.sha256(p.read_bytes()).hexdigest()=='dba33f268771d01435aafa6bf331fb00d83901daeaab2353c2bdc3832ca93c45';print(tarfile.open(p).extractfile('package/src/client/index.js').read().decode())"],
  { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true })
function factory(source) {
  const start = source.indexOf('    function createClientUpdateFlow(')
  return vm.runInNewContext(source.slice(start, source.indexOf('    let updateViewState', start)) + '\ncreateClientUpdateFlow')
}
const key = 'dsh-kb-update-operation'
const pending = { requestId: 'original-host-request', latestVersion: '2.4.6', buildId: '5c9679e46cbc1498', stage: 'installing' }

test('pristine 2.4.6 blocks before downloading a transition or 2.4.13 when the old receipt is absent', async () => {
  let stored = JSON.stringify(pending), prepares = 0
  const states = []
  const flow = factory(oldSource)({
    api: async (request, method) => {
      if (request.op === 'updates.prepare') { prepares++; throw Error('must never be reached') }
      // Original shared Host POST omitted build; GET had the correct build.
      return { status: method === 'GET' ? { build: { version: pending.latestVersion, buildId: pending.buildId } } : {} }
    },
    manager: () => ({ installBundle() { throw Error('must not install') }, async waitForInstall() { return { ok: true, value: null } } }),
    storage: { getItem: () => stored, setItem: (_, value) => { stored = value } },
    clientVersion: () => '2.4.6', notify: state => states.push(state), delay: async () => {},
  })
  await flow.install('2.4.13')
  assert.equal(prepares, 0)
  assert.equal(states.at(-1).uncertain, true)
  assert.equal(stored, JSON.stringify(pending))
})

test('released 2.4.13 reconciles the legacy Host receipt after external migration, without clearing other storage', async () => {
  const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  let stored = JSON.stringify(pending)
  const states = []
  const installed = { version: '2.4.13', buildId: '280919e50a3d55eb' }
  const flow = factory(source)({
    api: async request => request.op === 'updates.status'
      ? { confirmationProtocol: 1, phase: 'committed', operationActive: false, writerBusy: false, canRetryLegacy: true, installedBuild: installed }
      : { status: { build: installed } },
    manager: () => ({ async waitForInstall() { return { ok: true, value: null } } }),
    storage: { getItem: name => { assert.equal(name, key); return stored }, setItem: (name, value) => { assert.equal(name, key); stored = value } },
    clientVersion: () => installed.version, notify: state => states.push(state), delay: async () => {},
  })
  await flow.recover()
  assert.equal(JSON.parse(stored), null)
  assert.match(states.at(-1).message, /可重新安装新版/)
})
