import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, open, rm, utimes } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRankingPool } from '../src/host/retrieval-pool.js'
import { rank as baselineRank } from './fixtures/retrieval-worker-beta1.mjs'
import { createRetrieval } from '../src/host/retrieval.js'
import { initialRetrievalConfig } from '../src/host/retrieval-api.js'
import { hash } from '../src/host/retrieval-chunks.js'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'

async function temp(t) { const dir=await mkdtemp(path.join(os.tmpdir(),'kb-opt-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir }
const rows = () => Array.from({length:100},(_,id)=>({id,key:'row-'+id,path:`notes/${id}.md`,title:'资料 '+id,section:id%3,tags:[id%2?'odd':'even'],text:(id%2?'全文条件与否定 العربية':'蓝鲸 ZX-991 blood circulation')+' unique '+id}))
const catalog = (records, revision='one', scope='public') => ({records,revision,scope,bytes:Buffer.byteLength(JSON.stringify(records))})

test('resident and incremental catalogs preserve ranking, filtering, supplements and isolation',async t=>{
  const pool=createRankingPool();t.after(()=>pool.dispose())
  const records=rows(),one=catalog(records)
  for(const query of ['ZX-991','鲸','"全文条件"','العربية','notes/1.md','odd','none'])for(const mode of ['hybrid','fulltext','exact','semantic']) {
    const expected=await baselineRank({records,query,mode})
    const result=await pool.run({catalog:one,query,mode,allowedIds:records.map(r=>r.id)})
    assert.deepEqual(result.ranked,expected.ranked)
  }
  const warm=await pool.run({catalog:one,query:'鲸'})
  assert.equal(warm.transport.catalogRecordsSent,0);assert.equal(pool.stats.catalogRecordsSent,100)
  const updated=records.slice(1).map((r,id)=>({...r,id}));updated[0]={...updated[0],key:'changed',text:'new evidence'}
  const two=catalog(updated,'two')
  const delta=await pool.run({catalog:two,query:'evidence'})
  assert.equal(delta.transport.catalogRecordsSent,1)
  assert.deepEqual(delta.ranked,(await baselineRank({records:updated,query:'evidence'})).ranked)
  const subset=updated.filter(r=>r.id%2===0),supplement={id:updated.length,path:'cross.md',title:'Cross',text:'long exact evidence',section:0}
  const filtered=await pool.run({catalog:two,allowedIds:subset.map(r=>r.id),records:[supplement],query:'evidence'})
  assert.deepEqual(filtered.ranked,(await baselineRank({records:[...subset,supplement],query:'evidence'})).ranked)
  const differentScope=await pool.run({catalog:catalog(updated,'private','private'),query:'evidence'})
  assert.equal(differentScope.transport.catalogRecordsSent,99)
  pool.invalidate()
  assert.equal((await pool.run({catalog:two,query:'evidence'})).transport.catalogRecordsSent,99)
  const uncached=await pool.run({catalog:two,query:'evidence',useCache:false})
  assert.deepEqual(uncached.ranked,delta.ranked);assert.equal(uncached.cache.catalogHit,false)
  assert.deepEqual((await pool.run({catalog:two,allowedIds:subset.map(r=>r.id),records:[supplement],query:'evidence',useCache:false})).ranked,filtered.ranked)
  const large={...two,bytes:129*1024*1024}
  assert.deepEqual((await pool.run({catalog:large,query:'evidence'})).ranked,delta.ranked)
})

test('warm shard cache retains checksums and reloads changed, truncated, deleted and repaired shards',async t=>{
  const dir=await temp(t),pool=createRankingPool();t.after(()=>pool.dispose())
  const buf=Buffer.alloc(16);buf.writeFloatLE(1,0);buf.writeFloatLE(1,12)
  const file=path.join(dir,'vectors-0.bin');await writeFile(file,buf)
  const records=rows().slice(0,2).map((r,id)=>({...r,slot:id,checksum:hash(buf.subarray(id*8,id*8+8))}))
  const c=catalog(records),message={catalog:c,query:'blood',vector:[1,0],dimension:2,vectorDir:dir}
  const cold=await pool.run(message),warm=await pool.run(message)
  assert.deepEqual(cold.ranked,warm.ranked);assert.equal(cold.cache.shardReads,1);assert.equal(warm.cache.shardReads,0);assert.equal(warm.cache.shardHits,1)
  assert.deepEqual(warm.ranked,(await baselineRank({...message,records})).ranked)
  const corrupt=Buffer.from(buf);corrupt.writeFloatLE(.5,0);await writeFile(file,corrupt)
  // Restoring mtime must still be detected by ctime/size/file identity.
  await utimes(file,new Date(0),new Date(0))
  const damaged=await pool.run(message);assert.deepEqual(damaged.vectorErrors,[0]);assert.equal(damaged.cache.shardReads,1)
  await writeFile(file,buf.subarray(0,4));assert.deepEqual((await pool.run(message)).vectorErrors,[0])
  await rm(file);assert.deepEqual((await pool.run(message)).vectorErrors,[0])
  await writeFile(file,buf);assert.deepEqual((await pool.run(message)).vectorErrors,[])
})

test('vector batches sync once and failed sync never commits manifest slots; retry recovers',async t=>{
  const root=await temp(t),stateDir=path.join(root,'state'),b={root,key:'batch',st:{kbId:'batch'}}
  let failSync=true,syncs=0
  const docs=rows().slice(0,4).map(r=>({...r,revision:hash(r.text),private:false}))
  const service=createRetrieval({stateDir,binding:async()=>b,versionOf:()=>1,visible:()=>true,
    credentials:{read:async()=>({})},loadDocuments:async()=>({documents:docs,names:[],errors:[],nameOnly:0}),
    openVector:async(file,flags)=>{
      const fh=await open(file,flags)
      return {write:(...a)=>fh.write(...a),close:()=>fh.close(),sync:async()=>{syncs++;if(failSync)throw Object.assign(Error('synthetic disk failure'),{code:'EIO'});await fh.sync()}}
    },fetcher:async(_url,args)=>Response.json({data:JSON.parse(args.body).input.map((_,index)=>({index,embedding:[1,0]}))})})
  t.after(()=>service.dispose())
  const config=initialRetrievalConfig();config.enabled=true;config.embedding.endpoint='http://127.0.0.1/embeddings';config.embedding.batchSize=8
  await service.dispatch(b,{op:'retrieval.save',config})
  const finish=async()=>{for(let i=0;i<100;i++){const result=await service.dispatch(b,{op:'retrieval.get',lightweight:true});if(['failed','synced'].includes(result.progress.state))return result;await new Promise(r=>setTimeout(r,10))}throw Error('build timeout')}
  assert.equal((await finish()).progress.state,'failed')
  const generation=(await readdir(path.join(root,'索引层'))).find(name=>/^[a-f0-9]{32}$/.test(name))
  const manifestFile=path.join(root,'索引层',generation,'manifest.json')
  await assert.rejects(readFile(manifestFile),{code:'ENOENT'})
  failSync=false;await service.dispatch(b,{op:'retrieval.resume'})
  const result=await finish(),manifest=JSON.parse(await readFile(manifestFile,'utf8'))
  assert.equal(result.progress.state,'synced');assert.equal(result.progress.shardSyncs,1);assert.equal(syncs,2)
  assert.equal(manifest.nextSlot,4);assert.equal(Object.keys(manifest.checksums).length,4)
  const vectorBytes=await readFile(path.join(path.dirname(manifestFile),'vectors-0.bin'))
  for(let i=0;i<4;i++)assert.equal(hash(vectorBytes.subarray(i*8,i*8+8)),manifest.checksums[i])
})

test('external source changes invalidate before notification even with vector retrieval disabled',async t=>{
  const base=await temp(t),root=path.join(base,'library'),stateDir=path.join(base,'state');await mkdir(root)
  const core=createCore({stateDir},()=>{});await core.bind(root,{confirmInit:true})
  const wb=createWorkbench({stateDir,getCore:()=>core});t.after(()=>wb.dispose())
  await wb.retrieval.automatic()
  const initial=await wb.dispatch({op:'atlas.snapshot'})
  let events=0,afterEvent
  const received=new Promise(resolve=>{const off=wb.subscribe(event=>{if(event.type==='snapshot-dirty'){events++;afterEvent=wb.dispatch({op:'atlas.snapshot'});off();resolve()}});t.after(off)})
  await writeFile(path.join(root,'outside.txt'),'external synthetic source')
  // Production watchers/debounce timers deliberately unref themselves. The
  // test must keep its own deadline referenced while awaiting their event.
  let deadline
  try { await Promise.race([received,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('watcher notification missing')),4000)})]) }
  finally { clearTimeout(deadline) }
  const updated=await afterEvent
  assert.equal(events,1);assert.equal(updated.totals.files,initial.totals.files+1)
  const count=updated.scanMetrics.scans
  const cached=await wb.dispatch({op:'atlas.snapshot'});assert.equal(cached.scanMetrics.scans,count)
  let loop=false;const off=wb.subscribe(event=>{if(event.type==='snapshot-dirty')loop=true});t.after(off)
  await mkdir(path.join(root,'索引层'),{recursive:true});await writeFile(path.join(root,'索引层','internal.json'),'{}')
  await new Promise(r=>setTimeout(r,350));assert.equal(loop,false)
})

test('refresh scheduling coalesces events, serializes requests, pauses hidden pages and resumes on focus',async()=>{
  const source=await readFile(new URL('../src/client/workbench-ui.js',import.meta.url),'utf8')
  const start=source.indexOf('  function refreshSchedule('),end=source.indexOf('  const btn =',start)
  const window=new EventTarget(),document=new EventTarget();document.hidden=false
  const timers=new Map(),intervals=new Map();let sequence=0,calls=0,release
  const scheduler=vm.runInNewContext('('+source.slice(start,end).trim()+')',{window,document,
    setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{const id=++sequence;intervals.set(id,{fn,ms});return id},clearInterval:id=>intervals.delete(id)})
  const flush=async()=>{const batch=[...timers.values()];timers.clear();await Promise.all(batch.map(fn=>fn()))}
  const schedule=scheduler(async()=>{calls++;if(calls===1)await new Promise(r=>release=r)})
  for(let i=0;i<20;i++)schedule.schedule()
  assert.equal(timers.size,1);assert.equal([...intervals.values()][0].ms,60000)
  const first=flush();assert.equal(calls,1)
  schedule.schedule();schedule.schedule();assert.equal(timers.size,0)
  release();await first;await flush();assert.equal(calls,2)
  document.hidden=true;schedule.schedule();for(const {fn} of intervals.values())fn();await flush();assert.equal(calls,2)
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,3)
  schedule.dispose();assert.equal(timers.size,0);assert.equal(intervals.size,0)
})
