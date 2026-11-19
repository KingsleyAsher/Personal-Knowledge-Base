import { parentPort } from 'node:worker_threads'
import { readFile, stat, open } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { endianness } from 'node:os'
import { terms, hash } from './retrieval-chunks.js'

export const LEXICAL_VERSION='bm25-unchanged-1'
const lexicalCache=new Map()
const CATALOG_LIMIT = 128 * 1024 * 1024, SHARD_LIMIT = 64 * 1024 * 1024
let resident = null, shardBytes = 0, lexicalBytes = 0
const shardCache = new Map()
const LITTLE_ENDIAN=endianness()==='LE'
function clearCaches() { resident = null; lexicalCache.clear(); lexicalBytes = 0; shardCache.clear(); shardBytes = 0 }
function prepare(record) {
 const tf = new Map(); for (const term of terms(record.text+'\n'+record.title)) tf.set(term,(tf.get(term)||0)+1)
 const lower = record.text.toLowerCase(), titleLower = record.title.toLowerCase(), pathLower = record.path.toLowerCase()
 return {...record,tf,length:[...tf.values()].reduce((a,b)=>a+b,0),lower,titleLower,pathLower,
   metadataLower:(record.path+'\n'+record.title+'\n'+(record.tags||[]).join(' ')).toLowerCase(),
   memoryBytes:Buffer.byteLength(record.text)*6+Buffer.byteLength(record.title||'')*4+Buffer.byteLength(record.path)*4+[...tf.keys()].reduce((n,t)=>n+64+t.length*2,0)+256}
}
function updateCatalog(update) {
 const previous = !update.reset && resident && resident.scope === update.scope ? resident.byKey : new Map()
 // Do not mutate the current catalog until the complete update is available.
 const byKey = new Map(previous)
 for (const key of update.remove) byKey.delete(key)
 for (const record of update.upsert) byKey.set(record.key, prepare(record))
 const documents = update.order.map((key,id) => { const data=byKey.get(key); if(!data) throw Error('Missing catalog record'); return {...data,id,hit:previous.has(key)} })
 const df = new Map(), postings = new Map()
 let memoryBytes = 0
 for (const d of documents) {
   memoryBytes += d.memoryBytes
   for (const term of d.tf.keys()) { df.set(term,(df.get(term)||0)+1); if(!postings.has(term))postings.set(term,new Set());postings.get(term).add(d.id);memoryBytes+=16 }
 }
 resident = {revision:update.revision,scope:update.scope,byKey,documents,df,postings,memoryBytes,
   totalLength:documents.reduce((n,d)=>n+d.length,0)}
 return resident
}
const fingerprint = s => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':')
async function shardBuffer(file, useCache, metrics) {
 const before = await stat(file,{bigint:true}), version = fingerprint(before), old = shardCache.get(file)
 if (useCache && old?.version === version) { shardCache.delete(file);shardCache.set(file,old);metrics.shardHits++;return old.buffer }
 if(old){shardBytes-=old.buffer.length;shardCache.delete(file)}
 const at=performance.now(), buffer=await readFile(file);metrics.vectorReadMs+=performance.now()-at;metrics.shardReads++;metrics.vectorReadCalls++;metrics.vectorBytesRead+=buffer.length
 const after=await stat(file,{bigint:true})
 if(fingerprint(after)!==version)throw Error('Shard changed during read')
 if(useCache&&buffer.length<=SHARD_LIMIT){
   while(shardBytes+buffer.length>SHARD_LIMIT&&shardCache.size){const key=shardCache.keys().next().value;shardBytes-=shardCache.get(key).buffer.length;shardCache.delete(key)}
   shardCache.set(file,{version,buffer});shardBytes+=buffer.length
 }
 return buffer
}
async function scanShard(file, rows, dimension, visit, metrics, scratch) {
 const stride=dimension*4,windowSize=Math.max(stride,Math.floor(1024*1024/stride)*stride),groups=new Map()
 for(const row of rows){const position=(row.slot%4096)*stride,window=Math.floor(position/windowSize);if(!groups.has(window))groups.set(window,[]);groups.get(window).push(row)}
 const handle=await open(file,'r')
 try {
   const before=await handle.stat({bigint:true}),version=fingerprint(before)
   metrics.shardReads++;metrics.streamedShards++
   for(const [window,items] of [...groups].sort((a,b)=>a[0]-b[0])) {
     const position=window*windowSize,length=Math.max(0,Math.min(windowSize,Number(before.size)-position)),buffer=scratch.subarray(0,length),at=performance.now()
     metrics.vectorWindowPeakBytes=Math.max(metrics.vectorWindowPeakBytes,length)
     let used=0
     while(used<length){const r=await handle.read(buffer,used,length-used,position+used);metrics.vectorReadCalls++;if(!r.bytesRead)break;used+=r.bytesRead;metrics.vectorBytesRead+=r.bytesRead}
     metrics.vectorReadMs+=performance.now()-at
     const complete=buffer.subarray(0,used)
     for(const row of items)visit(row,complete,(row.slot%4096)*stride-position)
   }
   if(fingerprint(await handle.stat({bigint:true}))!==version||fingerprint(await stat(file,{bigint:true}))!==version)throw Error('Shard changed during scan')
 }finally{await handle.close()}
}
const lexicalOrder=(a,b)=>Number(b.exact)-Number(a.exact)||b.score-a.score||a.id-b.id
const semanticOrder=(a,b)=>b.score-a.score||a.id-b.id
function offer(rows,item,limit,compare) {
 if(rows.length===limit&&compare(item,rows[rows.length-1])>=0)return
 let low=0,high=rows.length
 while(low<high){const mid=(low+high)>>>1;if(compare(item,rows[mid])<0)high=mid;else low=mid+1}
 rows.splice(low,0,item);if(rows.length>limit)rows.pop()
}
function lexicalData(record,enabled) {
 const key=hash(JSON.stringify([LEXICAL_VERSION,record.text,record.title,record.path,record.tags]))
 let data=enabled?lexicalCache.get(key):null
 if(data)return {...data,hit:true}
 data=prepare(record)
 if(enabled&&data.memoryBytes<=CATALOG_LIMIT){lexicalCache.set(key,data);lexicalBytes+=data.memoryBytes;while(lexicalBytes>CATALOG_LIMIT||lexicalCache.size>32768){const first=lexicalCache.keys().next().value;lexicalBytes-=lexicalCache.get(first).memoryBytes;lexicalCache.delete(first)}}
 return {...data,hit:false}
}
export async function rank({ records = [], query, vector, vectorDir, dimension, mode = 'hybrid', focused = false, useCache = true, catalogUpdate, catalogRevision, allowedIds, clearCaches: reset }) {
  const started = performance.now(), metrics = { shardHits:0, shardReads:0, vectorBytesRead:0, vectorReadCalls:0, streamedShards:0, vectorWindowPeakBytes:0, vectorReadMs:0, vectorCheckMs:0, vectorDotMs:0 }
  if(reset)clearCaches()
  let catalogHit = false
  if(catalogUpdate)updateCatalog(catalogUpdate)
  if(catalogRevision && resident?.revision!==catalogRevision)throw Error('Catalog revision mismatch')
  const catalog = catalogRevision ? resident : null
  catalogHit = Boolean(catalog && !catalogUpdate)
  const q = query.toLowerCase(), quoted = [...query.matchAll(/["“]([^"”]+)["”]/gu)].map(m => m[1].toLowerCase()), qt = [...new Set(terms(query))]
  const allowed = allowedIds ? new Set(allowedIds) : null
  const base = catalog ? (allowed ? catalog.documents.filter(r=>allowed.has(r.id)) : catalog.documents) : []
  const additions = records.map(r => ({...lexicalData(r,useCache),...r}))
  const documents = [...base,...additions]
  records = documents
  const complete = catalog && base.length===catalog.documents.length
  const average = (complete ? catalog.totalLength+additions.reduce((n,d)=>n+d.length,0) : documents.reduce((a,d)=>a+d.length,0))/(documents.length||1)||1
  const df = new Map(qt.map(t => [t, complete ? (catalog.df.get(t)||0)+additions.reduce((n,d)=>n+Number(d.tf.has(t)),0) : documents.reduce((n,d)=>n+Number(d.tf.has(t)),0)]))
  const lexicalStarted=performance.now()
  const candidates = new Set(additions.map(r=>r.id))
  if(catalog)for(const term of qt)for(const id of catalog.postings.get(term)||[])candidates.add(id)
  const lexical = []
  let lexicalCount=0,semanticCount=0
  const lexicalRow = r => {
    const lower = r.lower, exact = r.titleLower === q || r.pathLower === q || quoted.some(s => lower.includes(s))
    const substring = lower.includes(q) || r.metadataLower.includes(q)
    if(catalog && !candidates.has(r.id) && !substring && !exact)return null
    let score = substring ? 4 : 0
    for (const t of qt) {
      const f = r.tf.get(t) || 0
      if (f) score += Math.log(1 + (documents.length - df.get(t) + .5) / (df.get(t) + .5)) * f * 2.2 / (f + 1.2 * (.25 + .75 * r.length / average))
    }
    return ((mode === 'exact' ? substring || exact : score > 0) || exact) ? { id: r.id, score, exact, path: r.path, section: r.section } : null
  }
  for(const r of documents){const row=lexicalRow(r);if(row){lexicalCount++;offer(lexical,row,80,lexicalOrder)}}
  metrics.lexicalMs=performance.now()-lexicalStarted
  const semantic = [], localSemantic = [], byShard = new Map(), vectorErrors = new Set(),paths = new Set(lexical.slice(0,10).map(r=>r.path))
  if (vector && dimension) {
    for (const r of records) if (r.slot != null) {
      const shard = Math.floor(r.slot / 4096)
      if (!byShard.has(shard)) byShard.set(shard, [])
      byShard.get(shard).push(r)
    }
    let workingBytes=0
    for(const shard of byShard.keys())try{workingBytes+=(await stat(path.join(vectorDir,'vectors-'+shard+'.bin'))).size}catch{vectorErrors.add(shard)}
    const largeWorkingSet=workingBytes>SHARD_LIMIT
    metrics.largeWorkingSet=largeWorkingSet
    metrics.vectorWorkingSetBytes=workingBytes
    const stride=dimension*4,scanBuffer=largeWorkingSet?Buffer.allocUnsafe(Math.max(stride,Math.floor(1024*1024/stride)*stride)):null
    for (const [shard, rows] of byShard) {
      const best=[],local=[]
      let validCount=0
      const visit=(r,buf,base)=>{
        if (base + dimension * 4 > buf.length) { vectorErrors.add(shard); return }
        const checkStarted=performance.now()
        const validChecksum=!r.checksum||hash(buf.subarray(base,base+dimension*4))===r.checksum
        metrics.vectorCheckMs+=performance.now()-checkStarted
        if(!validChecksum){vectorErrors.add(shard);return}
        const dotStarted=performance.now()
        const values=LITTLE_ENDIAN&&(buf.byteOffset+base)%4===0?new Float32Array(buf.buffer,buf.byteOffset+base,dimension):null
        let score = 0, valid = true
        for (let i = 0; i < dimension; i++) { const x = values?values[i]:buf.readFloatLE(base + i * 4); if (!Number.isFinite(x)) { valid = false; break }; score += vector[i] * x }
        if (valid) { const row={ id:r.id,score,path:r.path,section:r.section };validCount++;offer(best,row,80,semanticOrder);if(paths.has(r.path))offer(local,row,20,semanticOrder) }
        metrics.vectorDotMs+=performance.now()-dotStarted
      }
      try {
        const file=path.join(vectorDir,'vectors-'+shard+'.bin')
        if(largeWorkingSet)await scanShard(file,rows,dimension,visit,metrics,scanBuffer)
        else {const buf=await shardBuffer(file,useCache,metrics);for(const r of rows)visit(r,buf,(r.slot%4096)*dimension*4)}
      }catch{vectorErrors.add(shard);continue}
      semanticCount+=validCount
      for(const row of best)offer(semantic,row,80,semanticOrder)
      for(const row of local)offer(localSemantic,row,20,semanticOrder)
    }
  }
  const l = lexical.slice(0,80), s = semantic.slice(0,80)
  // Exactly one cross supplement: search lexically within semantic sections;
  // search semantically within lexical documents. No generated queries.
  const sections = new Set(s.slice(0,10).map(r => r.path + '\0' + r.section)),localLexical=[]
  for(const r of documents)if(sections.has(r.path+'\0'+r.section)){const row=lexicalRow(r);if(row)offer(localLexical,row,20,lexicalOrder)}
  metrics.retainedLexicalScores=lexical.length+localLexical.length;metrics.retainedSemanticScores=semantic.length+localSemantic.length
  const fused = new Map()
  const add = (rows, channel) => rows.forEach((r, i) => {
    let x = fused.get(r.id)
    if (!x) { x = { id: r.id, path: r.path, score: 0, exact: false, channels: [], families: [] }; fused.set(r.id, x) }
    if (!x.channels.includes(channel)) x.channels.push(channel)
    const family = channel.endsWith('fulltext') ? 'fulltext' : 'semantic'
    if (!x.families.includes(family)) { x.families.push(family); x.score += 1 / (60+i+1) }
    x.exact ||= Boolean(r.exact)
  })
  if (mode !== 'semantic' || !vector || !semantic.length) add(l,'fulltext')
  if (mode !== 'fulltext' && mode !== 'exact') add(s,'semantic')
  if (mode === 'hybrid') { add(localLexical, 'semantic→fulltext'); add(localSemantic, 'fulltext→semantic') }
  const ranked = [...fused.values()].sort((a,b) => Number(b.exact)-Number(a.exact) || b.score-a.score || a.id-b.id)
  const cache={kind:'computation',lexicalHits:(catalogHit?base.length:base.filter(d=>d.hit).length)+additions.filter(d=>d.hit).length,lexicalEntries:documents.length,fullResultHit:false,catalogHit,
    catalogBytes:catalog?.memoryBytes||0,shardBytes,...metrics,workerMs:performance.now()-started,workerMemory:process.memoryUsage()}
  const catalogResident=Boolean(catalog&&catalog.memoryBytes<=CATALOG_LIMIT)
  if(catalog&&!catalogResident)resident=null
  return { ranked,cache,catalogResident,crossFulltext:mode==='hybrid'&&vector?localLexical.length:0,crossSemantic:mode==='hybrid'&&vector?localSemantic.length:0, vectorErrors: [...vectorErrors], crossRounds: mode === 'hybrid' && vector ? 1 : 0, lexical: lexicalCount, semantic: semanticCount }
}
if (parentPort) parentPort.on('message', async message => {
  try { parentPort.postMessage({requestId:message.requestId,result: await rank(message) }) }
  catch { parentPort.postMessage({requestId:message.requestId,error: '检索计算未完成' }) }
})
