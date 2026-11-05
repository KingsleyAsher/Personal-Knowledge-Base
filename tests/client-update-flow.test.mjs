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
  const flow = factory({ api: async (request,method) => {
    if (method==='GET'||request.op === 'status') return { status: { build: method!=='GET'&&options.postOmitsBuild?undefined:installed ? { version: target.latestVersion, buildId: target.buildId } : { version: '1.1.2', buildId: 'd881ed4ff0990f64' } } }
    if(request.op==='updates.install')return (await manager.installBundle('/verified/cache/hash/package.tgz',{enabled:true,requestId:'safe-transaction'})).value
    if(request.op==='updates.status')return options.updateStatus||{transactionId:'transaction-fixture',phase:'publishing'}
    prepares++; if (options.downloadFails) throw Error(options.downloadError || 'hash mismatch')
    return { ok: true, spec: '/verified/cache/hash/package.tgz',safeInstall:true,transactionId:'transaction-fixture', ...target, ...(options.prepared || {}) }
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

test('source details are requested only after all package sources fail', async () => {
  const failed = setup({ downloadFails: true, downloadError: '安装包下载失败：Gitee：HTTP 403；GitCode：HTTP 429；GitHub：连接超时' })
  await failed.flow.install('1.1.3')
  assert.equal(failed.final.allSourcesFailed, true); assert.equal(failed.installs, 0)
  const other = setup({ downloadFails: true, downloadError: '发布版本已变化，请重新检查更新' })
  await other.flow.install('1.1.3'); assert.equal(other.final.allSourcesFailed, false)
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

test('a legacy prepare response cannot reach the destructive native installer',async()=>{const s=setup({prepared:{safeInstall:false}});await s.flow.install('1.1.3');assert.equal(s.installs,0);assert.match(s.final.message,/安全更新协议/)});

test("manual recovery help is conditional on failure",async()=>{const ok=setup();await ok.flow.install("1.1.3");assert.notEqual(ok.final.manualHelp,true);const failed=setup({application:"failed",loads:false});await failed.flow.install("1.1.3");assert.equal(failed.final.manualHelp,true)});

const legacyRecord={requestId:'legacy-request',...target,stage:'installing'}
const quietStatus={confirmationProtocol:1,phase:'none',operationActive:false,writerBusy:false,canRetryLegacy:true,installedBuild:{version:'1.1.2',buildId:'d881ed4ff0990f64'}}
const pendingData=record=>new Map([[key,JSON.stringify(record)]])
test('an absent legacy receipt unlocks only after authoritative quiet-writer and installed-build confirmation',async()=>{
  const s=setup({updateStatus:quietStatus},pendingData(legacyRecord));await s.flow.recover()
  assert.equal(JSON.parse(s.data.get(key)),null);assert.notEqual(s.final.uncertain,true);assert.equal(s.installs,0)
  await s.flow.install(target.latestVersion);assert.equal(s.installs,1)
  for(const status of [{phase:'none'},{...quietStatus,writerBusy:true},{...quietStatus,operationActive:true},{...quietStatus,phase:'publishing'},{...quietStatus,canRetryLegacy:false}]){
    const busy=setup({updateStatus:status},pendingData(legacyRecord));await busy.flow.recover()
    assert.equal(busy.final.uncertain,true);assert.equal(busy.installs,0);assert(JSON.parse(busy.data.get(key)).requestId)
  }
})
test('installed target files with an inactive old host request restart rather than endless uncertainty or reinstall',async()=>{
  const s=setup({updateStatus:{...quietStatus,installedBuild:{version:target.latestVersion,buildId:target.buildId}}},pendingData(legacyRecord))
  await s.flow.recover();assert.equal(s.final.restartRequired,true);assert.equal(s.installs,0);assert.equal(JSON.parse(s.data.get(key)).stage,'restart-required')
})
test('a prepared but never started safe transaction resumes the same transaction without preparing another package',async()=>{
  const record={...legacyRecord,transactionId:'transaction-fixture'}
  const s=setup({updateStatus:{...quietStatus,phase:'prepared',transactionId:record.transactionId}},pendingData(record))
  await s.flow.recover();assert.equal(s.final.resumeAvailable,true);assert.equal(s.installs,0)
  await s.flow.install(target.latestVersion);assert.equal(s.installs,1);assert.equal(s.prepares,0);assert.equal(JSON.parse(s.data.get(key)),null)
})

test('legacy shared Host missing POST build is confirmed through its read-only GET status',async()=>{
  const s=setup({active:true,postOmitsBuild:true},pendingData(legacyRecord));await s.flow.recover()
  assert.equal(JSON.parse(s.data.get(key)),null);assert.equal(s.final.completedVersion,target.latestVersion);assert.equal(s.installs,0)
})
