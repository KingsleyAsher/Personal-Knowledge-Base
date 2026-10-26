// Exact pre-change vs current comparison in separate Node processes. Synthetic
// data only; no network/model calls and no writes to a user's library.
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { hash,structureDocument } from '../src/host/retrieval-chunks.js'
import { structureDocument as oldStructure } from '../tests/fixtures/retrieval-chunks-original.mjs'
import { createNameLookup } from '../src/host/relation-name-lookup.js'

const options=new Map(process.argv.slice(2).map(a=>{const at=a.indexOf('=');return[a.slice(0,at),a.slice(at+1)]}))
if(options.has('--child')) {
  const dir=options.get('--fixture'),fixture=JSON.parse(await readFile(path.join(dir,'fixture.json'),'utf8'))
  if(options.get('--child').startsWith('cancel-')){
    const {createRankingPool}=await import(options.get('--child')==='cancel-baseline'?'../tests/fixtures/retrieval-pool-original.mjs':'../src/host/retrieval-pool.js')
    const pool=createRankingPool(),{records,dimension,vectors}=fixture,catalog={revision:'cancel-v1',scope:'cancel',records,bytes:Buffer.byteLength(JSON.stringify(records))}
    const message={catalog,query:'审批 exception',mode:'hybrid',vector:vectors[0],vectorDir:dir,dimension}
    try{
      await pool.run(message)
      const controller=new AbortController(),canceled=pool.run(message,controller.signal).then(()=>{throw Error('Expected cancellation')},e=>{if(e.code!=='CANCELED')throw e})
      await new Promise(resolve=>setTimeout(resolve,20))
      const at=performance.now();controller.abort();await canceled;const rejectedMs=performance.now()-at
      const tiny=await pool.run({records:[{id:0,path:'tiny.md',title:'Tiny',text:'small proof'}],query:'proof'})
      if(tiny.ranked[0]?.id!==0)throw Error('Canceled worker broke the next query')
      console.log(JSON.stringify({rejectedMs,nextQueryFinishedAfterAbortMs:performance.now()-at,nextQueueWaitMs:tiny.transport.queueWaitMs,pool:pool.stats}))
    }finally{pool.dispose()}
    process.exit(0)
  }
  const {rank}=await import(options.get('--child')==='baseline'?'../tests/fixtures/retrieval-worker-original.mjs':'../src/host/retrieval-worker.js')
  const {records,dimension,vectors}=fixture,rows=[]
  for(let i=0;i<7;i++){
    global.gc?.()
    const begin=performance.now(),message={query:'审批 exception '+i%3,mode:i%2?'semantic':'hybrid',vector:vectors[i%vectors.length],dimension,vectorDir:dir,catalogRevision:'synthetic-v1'}
    if(!i)message.catalogUpdate={revision:'synthetic-v1',scope:'synthetic',reset:true,remove:[],upsert:records,order:records.map(r=>r.key)}
    const result=await rank(message)
    rows.push({ms:performance.now()-begin,fingerprint:hash(JSON.stringify(result.ranked)),lexical:result.lexical,semantic:result.semantic,cache:result.cache})
  }
  console.log(JSON.stringify({rows,memory:process.memoryUsage(),peakRssBytes:process.resourceUsage().maxRSS*1024}))
  process.exit(0)
}

const count=Number(options.get('--count')||20000),dimension=Number(options.get('--dimension')||1024)
if(!Number.isSafeInteger(count)||count<10||count>100000||!Number.isSafeInteger(dimension)||dimension<2||dimension>4096)throw Error('Invalid synthetic sample size')
const dir=await mkdtemp(path.join(os.tmpdir(),'kb-existing-benchmark-'))
let seed=12345
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296-.5}
try{
  const records=[]
  for(let shard=0;shard<Math.ceil(count/4096);shard++){
    const size=Math.min(4096,count-shard*4096),buffer=Buffer.alloc(size*dimension*4)
    for(let slot=0;slot<size;slot++){
      const id=shard*4096+slot,values=Float32Array.from({length:dimension},random),norm=Math.hypot(...values),at=slot*dimension*4
      for(let j=0;j<dimension;j++)buffer.writeFloatLE(values[j]/norm,at+j*4)
      records.push({id,key:String(id),path:`notes/${id%1000}.md`,title:`Title ${id%301}`,section:id%7,text:`审批条件 ${id%13} approval exception otherwise forbidden ${id}`,slot:id,checksum:hash(buffer.subarray(at,at+dimension*4))})
    }
    await writeFile(path.join(dir,`vectors-${shard}.bin`),buffer)
  }
  const vectors=Array.from({length:3},()=>{const v=Array.from({length:dimension},random),n=Math.hypot(...v);return v.map(x=>x/n)})
  await writeFile(path.join(dir,'fixture.json'),JSON.stringify({records,dimension,vectors}))
  const run=mode=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--child='+mode,'--fixture='+dir],{stdio:['ignore','pipe','pipe']})
    let output='',error=''
    child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b)
    child.on('error',reject);child.on('exit',code=>{if(code)reject(Error(error||'Benchmark failed'));else try{resolve(JSON.parse(output))}catch(e){reject(e)}})
  })
  process.stderr.write('Comparing exact baseline and current retrieval in isolated processes\n')
  const baseline=await run('baseline'),current=await run('current')
  if(baseline.rows.some((r,i)=>r.fingerprint!==current.rows[i].fingerprint||r.lexical!==current.rows[i].lexical||r.semantic!==current.rows[i].semantic))throw Error('Ranking/coverage parity failed; performance result rejected')
  const median=rows=>{const sorted=rows.slice(1).map(r=>r.ms).sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2}
  const cancellation={baseline:await run('cancel-baseline'),current:await run('cancel-current')}
  const chunks=[]
  for(const length of [2*1024*1024,8*1024*1024]){
    const paragraph='审批后才允许使用；未批准不得使用。例外需要登记。\n\n',text=paragraph.repeat(Math.ceil(length/Buffer.byteLength(paragraph)))
    const one={textBytes:Buffer.byteLength(text),baseline:[],current:[]}
    for(let i=0;i<3;i++)for(const [name,fn] of [['baseline',oldStructure],['current',structureDocument]]){const at=performance.now(),out=fn(text,'合成条款');one[name].push({ms:performance.now()-at,fingerprint:hash(JSON.stringify(out)),chunks:out.chunks.length})}
    if(one.baseline.some((r,i)=>r.fingerprint!==one.current[i].fingerprint))throw Error('Chunk compatibility failed')
    chunks.push(one)
  }
  const names=new Map(Array.from({length:3000},(_,i)=>['document-'+i+'-reference',[`notes/${i}.md`]])),queries=Array.from({length:3000},(_,i)=>i%5?'missing-'+i:'document-'+i)
  const lookupAt=performance.now(),lookup=createNameLookup(names),indexBuildMs=performance.now()-lookupAt
  const oldAt=performance.now(),oldHints=queries.map(q=>[...new Set([...names].filter(([k])=>k.includes(q)).flatMap(([,v])=>v))].slice(0,12)),oldMs=performance.now()-oldAt
  const newAt=performance.now(),newHints=queries.map(q=>lookup.find(q)),newMs=performance.now()-newAt
  if(hash(JSON.stringify(oldHints))!==hash(JSON.stringify(newHints)))throw Error('Relationship suggestion parity failed')
  const report={synthetic:true,baseline:'0ee3c97 exact retrieval; normal caches enabled',runtime:process.version,platform:process.platform,count,dimension,rawVectorBytes:count*dimension*4,quality:{allRankingFingerprintsEqual:true,allCoverageCountsEqual:true,allChunkFingerprintsEqual:true,allRelationshipSuggestionsEqual:true,realModelAnswerQualityVerified:false},ranking:{baseline,current,baselineWarmMedianMs:median(baseline.rows),currentWarmMedianMs:median(current.rows)},cancellation,chunks,relations:{names:names.size,queries:queries.length,baselineMs:oldMs,currentBuildMs:indexBuildMs,currentLookupMs:newMs,index:lookup.stats()},limits:['Synthetic samples, not a hundreds-GB real-library qualification','Exact scan still visits all eligible vectors; byte reads may stay the same','RSS includes catalog and runtime; score/window counters are separate','Warm median is six runs; no long-run p95 claim','No model services, answer-compression changes, ANN or new index layer']}
  if(options.has('--output'))await writeFile(options.get('--output'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
}finally{await rm(dir,{recursive:true,force:true})}
