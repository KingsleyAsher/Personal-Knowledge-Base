import { parentPort } from 'node:worker_threads'
import { readFile, stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { terms, hash } from './retrieval-chunks.js'

export const LEXICAL_VERSION='bm25-unchanged-1'
const lexicalCache=new Map()
const CATALOG_LIMIT = 128 * 1024 * 1024, SHARD_LIMIT = 64 * 1024 * 1024
let resident = null, shardBytes = 0, lexicalBytes = 0
const shardCache = new Map()
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
 const at=performance.now(), buffer=await readFile(file);metrics.vectorReadMs+=performance.now()-at;metrics.shardReads++;metrics.vectorBytesRead+=buffer.length
 const after=await stat(file,{bigint:true})
 if(fingerprint(after)!==version)throw Error('Shard changed during read')
 if(useCache&&buffer.length<=SHARD_LIMIT){
   while(shardBytes+buffer.length>SHARD_LIMIT&&shardCache.size){const key=shardCache.keys().next().value;shardBytes-=shardCache.get(key).buffer.length;shardCache.delete(key)}
   shardCache.set(file,{version,buffer});shardBytes+=buffer.length
 }
 return buffer
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
  const started = performance.now(), metrics = { shardHits:0, shardReads:0, vectorBytesRead:0, vectorReadMs:0, vectorCheckMs:0, vectorDotMs:0 }
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
  for (const r of documents) {
    const lower = r.lower, exact = r.titleLower === q || r.pathLower === q || quoted.some(s => lower.includes(s))
    const substring = lower.includes(q) || r.metadataLower.includes(q)
    if(catalog && !candidates.has(r.id) && !substring && !exact)continue
    let score = substring ? 4 : 0
    for (const t of qt) {
      const f = r.tf.get(t) || 0
      if (f) score += Math.log(1 + (documents.length - df.get(t) + .5) / (df.get(t) + .5)) * f * 2.2 / (f + 1.2 * (.25 + .75 * r.length / average))
    }
    if ((mode === 'exact' ? substring || exact : score > 0) || exact) lexical.push({ id: r.id, score, exact, path: r.path, section: r.section })
  }
  lexical.sort((a,b) => Number(b.exact)-Number(a.exact) || b.score-a.score || a.id-b.id)
  metrics.lexicalMs=performance.now()-lexicalStarted
  const semantic = [], byShard = new Map(), vectorErrors = []
  if (vector && dimension) {
    for (const r of records) if (r.slot != null) {
      const shard = Math.floor(r.slot / 4096)
      if (!byShard.has(shard)) byShard.set(shard, [])
      byShard.get(shard).push(r)
    }
    for (const [shard, rows] of byShard) {
      let buf
      try { buf = await shardBuffer(path.join(vectorDir, 'vectors-' + shard + '.bin'),useCache,metrics) }
      catch { vectorErrors.push(shard); continue }
      for (const r of rows) {
        const base = (r.slot % 4096) * dimension * 4
        if (base + dimension * 4 > buf.length) { vectorErrors.push(shard); continue }
        const checkStarted=performance.now()
        const validChecksum=!r.checksum||hash(buf.subarray(base,base+dimension*4))===r.checksum
        metrics.vectorCheckMs+=performance.now()-checkStarted
        if(!validChecksum){vectorErrors.push(shard);continue}
        const dotStarted=performance.now()
        let score = 0, valid = true
        for (let i = 0; i < dimension; i++) { const x = buf.readFloatLE(base + i * 4); if (!Number.isFinite(x)) { valid = false; break }; score += vector[i] * x }
        if (valid) semantic.push({ id: r.id, score, path: r.path, section: r.section })
        metrics.vectorDotMs+=performance.now()-dotStarted
      }
    }
    semantic.sort((a,b) => b.score-a.score || a.id-b.id)
  }
  const l = lexical.slice(0,80), s = semantic.slice(0,80)
  // Exactly one cross supplement: search lexically within semantic sections;
  // search semantically within lexical documents. No generated queries.
  const sections = new Set(s.slice(0,10).map(r => r.path + '\0' + r.section)), paths = new Set(l.slice(0,10).map(r => r.path))
  const localLexical = lexical.filter(r => sections.has(r.path + '\0' + r.section)).slice(0,20)
  const localSemantic = semantic.filter(r => paths.has(r.path)).slice(0,20)
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
  return { ranked,cache,catalogResident,crossFulltext:mode==='hybrid'&&vector?localLexical.length:0,crossSemantic:mode==='hybrid'&&vector?localSemantic.length:0, vectorErrors: [...new Set(vectorErrors)], crossRounds: mode === 'hybrid' && vector ? 1 : 0, lexical: lexical.length, semantic: semantic.length }
}
if (parentPort) parentPort.on('message', async message => {
  try { parentPort.postMessage({requestId:message.requestId,result: await rank(message) }) }
  catch { parentPort.postMessage({requestId:message.requestId,error: '检索计算未完成' }) }
})
