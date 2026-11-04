import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import {createUpdateChecker} from '../src/host/updates.js'
import {createHostUpdates} from '../packages/kb-service/host-updates.js'
import {createParsingService,normalizeProvider} from '../packages/kb-core/src/parsing.js'
import {createCore as oldCore} from './fixtures/kbcore-2.4.1.mjs'
import {createCore} from '../packages/kb-core/src/kbcore.js'

const release=version=>({package:'@local/dsh-knowledge-base',version,tgz:`local-dsh-knowledge-base-${version}.tgz`,sha256:'a'.repeat(64),buildId:'b'.repeat(16),bytes:100})
const mockFetch=version=>async url=>Response.json(url.endsWith('preview-manifest.json')?{package:'@local/dsh-knowledge-base',channel:'preview',active:false}:{...release(version),files:[{padding:'x'.repeat(80000)}]})

test('legacy local builds query a real feed, expose migration, and do not auto-install',async()=>{
 const r=await createUpdateChecker({currentVersion:'2.3.1+desktop.1',sourceIds:['github'],fetch:mockFetch('2.4.2')}).check()
 assert.equal(r.ok,true);assert.equal(r.onlineChecked,true);assert.equal(r.updateAvailable,true);assert.equal(r.currentChannel,'local');assert.equal(r.migrationRequired,true);assert.equal(r.autoInstallEligible,false)
})
test('2.4.2 checks a manifest larger than 64 KiB and detects the next release',async()=>{
 const r=await createUpdateChecker({currentVersion:'2.4.2',sourceIds:['github'],fetch:mockFetch('2.4.3')}).check()
 assert.equal(r.ok,true);assert.equal(r.updateAvailable,true);assert.equal(r.autoInstallEligible,true)
})
test('shared Host update endpoint uses the checker, including force, and keeps native install gating',async()=>{
 const effects=[];let calls=0
 const ctx={get:n=>n==='profileContext'?{dir:os.tmpdir()}:undefined,effect:fn=>{effects.push(fn)}}
 const u=createHostUpdates({ctx,build:{version:'2.4.2'},fetch:async url=>{calls++;return mockFetch('2.4.3')(url)}})
 assert.equal((await u.check()).updateAvailable,true);const n=calls;await u.check();assert.equal(calls,n);await u.check({force:true});assert(calls>n)
 assert.equal((await u.check()).installSupported,false);assert.equal((await u.prepare({expectedVersion:'2.4.3'})).code,'CAPABILITY_UNSUPPORTED');assert.equal(effects.length,1)
})
test('labels distinguish skipped, failed, offline, local, stable, preview, and ahead checks',async()=>{
 const text=await readFile(new URL('../src/client/index.js',import.meta.url),'utf8')
 const start=text.indexOf('    function pluginUpdateLabel('),end=text.indexOf('    function BuildBadge(',start)
 const label=vm.runInNewContext(text.slice(start,end)+'\npluginUpdateLabel')
 assert.match(label(false,{ok:true,channel:'local',updateAvailable:false}),/试用版/)
 assert.match(label(false,{ok:true,status:'candidate'}),/试用版/)
 assert.match(label(false,{ok:true}),/尚未完成/)
 assert.match(label(false,{ok:false,error:'网络错误'}),/网络错误/)
 assert.equal(label(false,{ok:true,onlineChecked:true,currentChannel:'stable'}),'已是最新正式版')
 assert.equal(label(false,{ok:true,onlineChecked:true,currentChannel:'preview'}),'已是最新预览版')
 assert.match(label(false,{ok:true,onlineChecked:true,ahead:true,latestVersion:'2.4.1'}),/高于更新源/)
})
test('restart with 2.4.2 retains 2.4.1 binding, config, queued/submitted and completed record bytes',async t=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'kb-242-'));t.after(()=>rm(tmp,{recursive:true,force:true}))
 const stateDir=path.join(tmp,'state'),library=path.join(tmp,'library');await mkdir(library)
 const old=oldCore({stateDir},()=>{});assert.equal((await old.bind(library,{confirmInit:true})).ok,true)
 const provider=normalizeProvider({id:'local-asr',kind:'asr',protocol:'cli-transcribe',locality:'local',command:path.join(tmp,'python.exe'),args:[path.join(tmp,'local-transcribe.py')]});assert.equal(provider.ok,true)
 assert.equal((await old.setConfig({parsing:{externalPolicy:'local-only',providers:[provider.value],defaultAsr:'local-asr'}})).ok,true)
 const binding=await old.status(),configPath=path.join(stateDir,'config.json'),configBefore=await readFile(configPath)
 const dir=path.join(stateDir,'parse',binding.kbId);await mkdir(path.join(dir,'jobs'),{recursive:true});await mkdir(path.join(dir,'requests'))
 const files=[]
 for(const [id,status]of [['queued-1','queued'],['done-1','succeeded']]){const f=path.join(dir,'jobs',id+'.json');await writeFile(f,JSON.stringify({jobId:id,kbId:binding.kbId,binding,kind:'asr',status,provider:{id:'local-asr'},source:{relPath:'synthetic.wav',external:false},createdAt:'2026-11-05T00:00:00Z'}));files.push(f)}
 const req=path.join(dir,'requests','submitted-1.json');await writeFile(req,JSON.stringify({requestId:'submitted-1',binding,kind:'asr',status:'submitted',createdAt:'2026-11-05T00:00:00Z'}));files.push(req)
 const before=await Promise.all(files.map(f=>readFile(f)))
 const current=createCore({stateDir},()=>{});assert.equal((await current.status()).kbId,binding.kbId);assert.equal((await current.status()).kbPath,binding.kbPath)
 const parsing=createParsingService({stateDir,getCore:()=>current,getBinding:()=>current.status()})
 assert.equal((await parsing.listJobs()).total,2);assert.equal((await parsing.listJobs({status:'completed'})).total,1);assert.equal((await parsing.listRequests()).total,1)
 assert.equal((await parsing.providersPublic()).defaultAsr,'local-asr')
 assert.deepEqual(await readFile(configPath),configBefore);assert.deepEqual(await Promise.all(files.map(f=>readFile(f))),before)
})
