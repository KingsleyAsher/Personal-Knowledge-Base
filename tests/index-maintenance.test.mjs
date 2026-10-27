import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,readFile,unlink,utimes,readdir,rename,symlink } from 'node:fs/promises'
import path from 'node:path'
import {createCore} from '../src/host/kbcore.js'
import {createIndexMaintenance} from '../src/host/index-maintenance.js'
const root=await mkdtemp(path.resolve('..','index-qa-'))
async function fixture(count=3){
  const base=await mkdtemp(path.join(root,'case-')), library=path.join(base,'library'), core=createCore({stateDir:path.join(base,'state')},()=>{})
  await mkdir(library)
  const binding=await core.bind(library,{confirmInit:true});assert.equal(binding.ok,true,JSON.stringify(binding))
  for(let i=0;i<count;i++)await writeFile(path.join(library,`note-${i}.md`),`# Synthetic ${i}\n\nContent ${i}\n`)
  const first=await core.maintainIndex();assert.equal(first.ok,true,JSON.stringify(first))
  return{core,library,index:path.join(library,'.kbmeta','index','entries.json')}
}
test('mtime-only changes update metadata, actual changes/add/remove use incremental path',async()=>{
  const f=await fixture(), file=path.join(f.library,'note-0.md')
  const source=await readFile(file)
  await utimes(file,new Date(),new Date(Date.now()+5000))
  assert.equal((await f.core.indexFreshness()).reason,'index-stale-content')
  const metadata=await f.core.maintainIndex();assert.equal(metadata.mode,'metadata');assert.equal(metadata.diff.changed.length,0)
  assert.equal((await f.core.indexFreshness()).fresh,true)
  assert.deepEqual(await readFile(file),source)
  await writeFile(file,'# Updated synthetic text')
  await writeFile(path.join(f.library,'added.md'),'# Added')
  await unlink(path.join(f.library,'note-1.md'))
  const updated=await f.core.maintainIndex({paths:['note-0.md']})
  assert.equal(updated.mode,'incremental');assert.deepEqual(updated.diff.changed,['note-0.md']);assert.deepEqual(updated.diff.added,['added.md']);assert.deepEqual(updated.diff.removed,['note-1.md'])
  assert.equal((await f.core.indexFreshness()).fresh,true)
})
test('large drops preserve original index, exact confirmation permits safe replacement, snapshots limited to three',async()=>{
  const f=await fixture(25), before=await readFile(f.index)
  for(let i=0;i<6;i++)await unlink(path.join(f.library,`note-${i}.md`))
  const refused=await f.core.maintainIndex({full:true});assert.equal(refused.reason,'index-drop-confirmation');assert.deepEqual(await readFile(f.index),before)
  assert.equal((await f.core.maintainIndex({confirmDrop:'wrong'})).ok,false)
  const result=await f.core.maintainIndex({confirmDrop:refused.confirmationToken});assert.equal(result.ok,true);assert.equal(result.entries,19)
  for(let i=0;i<5;i++){await writeFile(path.join(f.library,'note-10.md'),'# Change '+i);assert.equal((await f.core.maintainIndex()).ok,true)}
  const list=await f.core.indexSnapshots();assert.equal(list.snapshots.length,3)
  const primary=await readFile(path.join(f.library,'note-10.md'))
  const restored=await f.core.indexSnapshots({restore:list.snapshots[0].name});assert.equal(restored.ok,true);assert.equal((await f.core.getConfig()).autoIndex,false)
  assert.deepEqual(await readFile(path.join(f.library,'note-10.md')),primary)
})
test('empty drop and identity mismatch never silently overwrite',async()=>{
  const f=await fixture(1), before=await readFile(f.index)
  await unlink(path.join(f.library,'note-0.md'))
  assert.equal((await f.core.maintainIndex()).reason,'index-drop-confirmation');assert.deepEqual(await readFile(f.index),before)
  const bad=JSON.parse(before);bad.meta.kbId='other-library';await writeFile(f.index,JSON.stringify(bad));const mismatch=await readFile(f.index)
  assert.equal((await f.core.maintainIndex({full:true})).reason,'index-kbid-mismatch');assert.deepEqual(await readFile(f.index),mismatch)
})
test('binding revision, cancellation, disabled automation and missing roots refuse maintenance',async()=>{
  const f=await fixture(), before=await readFile(f.index)
  assert.equal((await f.core.maintainIndex({expectedKbId:'wrong'})).reason,'binding-changed')
  assert.equal((await f.core.maintainIndex({expectedRevision:0})).reason,'binding-changed')
  const c=new AbortController();c.abort();assert.equal((await f.core.maintainIndex({signal:c.signal})).reason,'canceled')
  await f.core.setConfig({autoIndex:false});assert.equal((await f.core.maintainIndex({automatic:true})).reason,'maintenance-disabled-or-unhealthy')
  assert.deepEqual(await readFile(f.index),before)
  const renamed=f.library+'-offline';await rename(f.library,renamed)
  assert.equal((await f.core.maintainIndex()).ok,false);assert.deepEqual(await readFile(path.join(renamed,'.kbmeta/index/entries.json')),before)
})
test('corrupt index repairs without touching originals; concurrent writes and index maintenance share locks',async()=>{
  const f=await fixture(), file=path.join(f.library,'note-0.md'), original=await readFile(file)
  await writeFile(f.index,'broken-json')
  assert.equal((await f.core.maintainIndex()).mode,'full');assert.deepEqual(await readFile(file),original)
  const results=await Promise.all([f.core.maintainIndex({full:true}),f.core.createEntry({title:'Concurrent synthetic',text:'Synthetic concurrent writer',kind:'知识'})])
  assert.ok(results.every(r=>r.ok));assert.equal((await f.core.indexFreshness()).fresh,true)
})

test('watch event checks content even when size and modification time are preserved',async()=>{
  const f=await fixture(), file=path.join(f.library,'note-0.md')
  const entry=JSON.parse(await readFile(f.index,'utf8')).entries.find(e=>e.path==='note-0.md')
  await writeFile(file,entry.text.replace('Content 0','Content 9'))
  await utimes(file,new Date(entry.mtimeMs),new Date(entry.mtimeMs))
  const r=await f.core.maintainIndex({paths:['note-0.md']})
  assert.equal(r.mode,'incremental');assert.deepEqual(r.diff.changed,['note-0.md'])
})

test('structured index corruption is repaired and damaged snapshots cannot be restored',async()=>{
  const f=await fixture(), payload=JSON.parse(await readFile(f.index,'utf8'))
  payload.entries[0].text='tampered synthetic cache'
  await writeFile(f.index,JSON.stringify(payload))
  assert.equal((await f.core.indexFreshness()).reason,'index-corrupt')
  assert.equal((await f.core.maintainIndex()).mode,'full')
  await f.core.maintainIndex({full:true})
  const list=await f.core.indexSnapshots(), name=list.snapshots[0].name, before=await readFile(f.index)
  await writeFile(path.join(f.library,'.kbmeta','index','snapshots',name),JSON.stringify(payload))
  assert.equal((await f.core.indexSnapshots({restore:name})).ok,false)
  assert.deepEqual(await readFile(f.index),before)
})

test('snapshot directory links are rejected before maintenance writes',async()=>{
  const f=await fixture(), before=await readFile(f.index), outside=path.join(root,'outside-'+Date.now())
  await mkdir(outside)
  await rename(path.join(f.library,'.kbmeta','index','snapshots'),path.join(f.library,'.kbmeta','index','original-snapshots')).catch(e=>{if(e.code!=='ENOENT')throw e})
  await symlink(outside,path.join(f.library,'.kbmeta','index','snapshots'),process.platform==='win32'?'junction':'dir')
  const r=await f.core.maintainIndex({full:true})
  assert.equal(r.ok,false);assert.equal(r.indexPreserved,true)
  assert.deepEqual(await readFile(f.index),before);assert.deepEqual(await readdir(outside),[])
})
test('scheduler debounces, ignores generated paths, enforces minimum interval and closes on binding switch/dispose',async()=>{
  let clock=0, config={kbPath:'synthetic-A',revision:1}, callback, closed=0,calls=[]
  const core={configGate:async()=>({ok:true,conf:config}),status:async()=>({healthy:true,kbId:'A'}),maintainIndex:async opts=>{calls.push(opts);return{ok:true,indexWritten:true}}}
  const s=createIndexMaintenance({getCore:()=>core,now:()=>clock,watch:(_root,_opts,fn)=>{callback=fn;return{close:()=>closed++,on:()=>{}}},timers:{setInterval:()=>1,clearInterval:()=>{}}})
  await s.tick();clock=4999;await s.tick();assert.equal(calls.length,0)
  clock=5000;await s.tick();assert.equal(calls.length,1)
  callback('change','.kbmeta/index/entries.json');assert.equal(s.status().pending,false)
  callback('change','note.md');clock=11000;await s.tick();assert.equal(calls.length,1)
  clock=35000;await s.tick();assert.equal(calls.length,2);assert.deepEqual(calls[1].paths,['note.md'])
  config={kbPath:'synthetic-B',revision:2};await s.tick();assert.equal(closed,1)
  s.dispose();assert.equal(closed,2)
})
test('scheduler pauses after three failures and never starts overlapping maintenance',async()=>{
  let clock=0,calls=0,resolve
  const core={configGate:async()=>({ok:true,conf:{kbPath:'synthetic',revision:1}}),status:async()=>({healthy:true,kbId:'A'}),maintainIndex:async()=>{calls++;return{ok:false,reason:'scan-incomplete'}}}
  const options={getCore:()=>core,now:()=>clock,watch:()=>({close(){},on(){}}),timers:{setInterval:()=>1,clearInterval(){}}}
  const s=createIndexMaintenance(options);await s.tick()
  for(clock=5000;clock<=100000;clock+=30000)await s.tick()
  assert.equal(calls,3);assert.equal(s.status().state,'paused');s.dispose()
  calls=0;clock=0
  core.maintainIndex=()=>{calls++;return new Promise(r=>{resolve=r})}
  const concurrent=createIndexMaintenance(options);await concurrent.tick();clock=5000
  const running=concurrent.tick();await new Promise(r=>setImmediate(r));await concurrent.tick();assert.equal(calls,1)
  resolve({ok:true});await running;concurrent.dispose()
})

test('patrol compensates missing watcher events and failure pause is not reset by new events',async()=>{
  let clock=0,calls=0,callback
  const core={configGate:async()=>({ok:true,conf:{kbPath:'synthetic',revision:1,excludeFromSearch:['private/nested']}}),status:async()=>({healthy:true,kbId:'A'}),maintainIndex:async()=>{calls++;return {ok:true}}}
  const s=createIndexMaintenance({getCore:()=>core,now:()=>clock,watch:(_r,_o,fn)=>{callback=fn;return{close(){},on(){}}},timers:{setInterval:()=>1,clearInterval(){}}})
  await s.tick();clock=5000;await s.tick();assert.equal(calls,1)
  callback('change','private/nested/test.md');assert.equal(s.status().pending,false)
  clock=300000;await s.tick();assert.equal(calls,2)
  core.maintainIndex=async()=>{calls++;return{ok:false,reason:'scan-incomplete'}}
  for(const time of [600000,630000,690000]){clock=time;callback('change','note.md');clock+=5000;await s.tick()}
  assert.equal(s.status().state,'paused')
  callback('change','more.md');clock=1000000;await s.tick();assert.equal(calls,5);s.dispose()
})
