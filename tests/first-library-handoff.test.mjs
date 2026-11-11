import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {createFirstLibraryHandoff} from '../packages/kb-service/first-library-handoff.js'

const source=readFileSync(new URL('../src/client/index.js',import.meta.url),'utf8')
test('concurrent setup and retries reuse one receipt; another target cannot switch the embedded Host',async()=>{
 let calls=0,release
 const gate=createFirstLibraryHandoff(async kbPath=>{calls++;await new Promise(r=>{release=r});return {ok:true,kbPath,restartRequired:true}})
 const first=gate.select('C:/synthetic'),second=gate.select('C:/synthetic')
 await new Promise(r=>setImmediate(r));release()
 const result=await first
 assert.deepEqual(await second,result);assert.deepEqual(await gate.select('C:/synthetic'),result);assert.equal(calls,1)
 await assert.rejects(gate.select('C:/other'),{code:'SERVICE_RESTART_REQUIRED'})
})
test('failed setup remains retryable and ordinary embedded setup is not cached',async()=>{
 let calls=0
 const gate=createFirstLibraryHandoff(async()=>{if(++calls===1)throw Error('startup failed');return null})
 await assert.rejects(gate.select('C:/synthetic'),/startup failed/)
 assert.equal(await gate.select('C:/synthetic'),null);assert.equal(await gate.select('C:/synthetic'),null);assert.equal(calls,3)
})

for(const file of ['index.js','workbench-ui.js'])test(file+': first-use guide preserves successful setup and stops embedded preference refresh until restart',async()=>{
 const source=readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8')
 const begin=source.indexOf("btn('接入或建立知识库', async () => ")+"btn('接入或建立知识库', ".length
 const end=source.indexOf(', busy || !folder)',begin)
 let refreshes=0,restart='',active={current:true},deferred={current:false}
 const action=vm.runInNewContext('('+source.slice(begin,end)+')',{folder:'C:/synthetic',active,deferred,setBusy(){},setError:message=>assert.fail(message),setBindingRestart:message=>{restart=message},api:async()=>({ok:true,restartRequired:true,note:'请重新打开 DSH'}),refresh:async()=>{refreshes++;throw Error('embedded preferences are forbidden')}})
 await action();assert.equal(refreshes,0);assert.equal(restart,'请重新打开 DSH');assert.equal(active.current,false);assert.equal(deferred.current,true)
})
test('library settings do not refresh the old embedded runtime after fresh shared setup',async()=>{
 const begin=source.indexOf('      const doSetup = async () => {'),end=source.indexOf('\n      // R7',begin)
 let refreshes=0,restart=false,message=''
 const action=vm.runInNewContext(source.slice(begin,end)+'\ndoSetup',{candidate:'C:/synthetic',setBusy(){},setMessage:v=>{message=v},setResult(){},setJob(){},setProbe(){},dirtyRef:{current:true},setBindingRestart:v=>{restart=v},callApi:async r=>r.op==='probe-folder'?{folder:{kind:'empty'}}:{ok:true,restartRequired:true,note:'请重启 DSH'},refresh:async()=>{refreshes++;throw Error('must not refresh')}})
 await action();assert.equal(restart,true);assert.equal(refreshes,0);assert.equal(message,'请重启 DSH')
})

test('Host rejects old-runtime workspace calls during handoff and keeps setup retry idempotent',async()=>{
 const host=readFileSync(new URL('../src/host/index.js',import.meta.url),'utf8')
 const begin=host.indexOf('              if (firstLibraryHandoff.receipt) {'),end=host.indexOf("              if (typeof body.op === 'string'",begin)
 let embeddedCalls=0,retries=0
 const receipt={ok:true,kbPath:'C:/synthetic',restartRequired:true}
 const action=vm.runInNewContext('(async body=>{'+host.slice(begin,end)+'; embedded();return null})',{
  firstLibraryHandoff:{receipt},maybeFirstShared:async()=>{retries++;return receipt},FIRST_LIBRARY_RESTART:'请重启 DSH',res:{},kbSendJson:(_res,status,value)=>({status,value}),embedded:()=>{embeddedCalls++},
 })
 for(const op of ['preferences.get','onboarding.claim','reading.save','check']){
  const r=await action({op});assert.equal(r.value.code,'SERVICE_RESTART_REQUIRED');assert.equal(r.value.restartRequired,true)
 }
 assert.equal((await action({op:'setup',path:'C:/synthetic'})).value,receipt)
 assert.equal((await action({op:'setup',path:'C:/synthetic',mode:'copy'})).value.code,'SERVICE_RESTART_REQUIRED')
 assert.equal(retries,1);assert.equal(embeddedCalls,0)
 await action({op:'status'});assert.equal(embeddedCalls,1)
})
