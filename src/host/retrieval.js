import path from 'node:path'
import { mkdir, readFile, open, readdir, rm, stat, statfs, copyFile, rename, lstat, rmdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRankingPool } from './retrieval-pool.js'
import { atomicJson, readJson, locked, fail, safePath } from './workbench-state.js'
import { createParseCredentials } from './parse-credentials.js'
import { initialRetrievalConfig, validateConfig, createRetrievalAPI } from './retrieval-api.js'
import { hash, bytes, byteSlice, structureDocument, embeddingText, expandRange, CHUNK_VERSION } from './retrieval-chunks.js'

const modelKey = config => hash(JSON.stringify([config.endpoint, config.model, config.dimensions || null, config.queryTemplate, config.documentTemplate, config.chunkTarget, config.chunkOverlap, config.generation, CHUNK_VERSION])).slice(0,32)
const emptyManifest = () => ({ format: 1, dimension: 0, nextSlot: 0, vectors: {} })
const safeMessage = e => e.code === 'ENOSPC' ? '磁盘空间不足，已暂停；释放空间后继续' : e.code?.startsWith('API_') ? e.message : '索引处理未完成，原文已保留；请重试'
export function retrievalDisclosure(trace, enabled = true) {
  if(!enabled||!trace)return null
  const runs=trace.runs||[trace],structured=runs.some(r=>r.requestedMode)
  let steps=trace.steps||[]
  if(structured){
    const models=[...new Set(runs.filter(r=>r.semantic).map(r=>r.embeddingModel))]
    steps=[]
    if(runs.some(r=>r.fulltext))steps.push('全文检索（精确匹配 + BM25）')
    if(models.length)steps.push('向量检索（'+models.join('、')+'）')
    if(runs.some(r=>r.crossRounds&&r.semantic))steps.push('一轮交叉补充与 RRF 融合')
    if(runs.some(r=>r.reranked))steps.push('重排序')
    steps.push('去重、版本校验与上下文扩展')
    if(trace.readOriginal)steps.push('按需读取原文')
  }
  const warnings=[...new Set(runs.map(r=>r.warning).filter(Boolean))]
  const footer='**本次知识库检索过程**：'+steps.join(' → ')+(runs.length>1?'（'+runs.length+' 次查询，合并说明）':'')+(warnings.length?'。说明：'+warnings.join('；'):'')+'。'
  return {footer,instruction:'在回答末尾附此说明；多次查询合并，不重复列流程。'}
}
async function treeBytes(dir, parts) {
  let total = 0
  for (const row of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir,row.name)
    if (row.isDirectory()) total += await treeBytes(file,parts)
    else if (row.isFile()) {
      const n=await stat(file).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return 0;throw e});total+=n
      if(parts){const key=row.name.endsWith('.tmp')?'temporary':row.name.endsWith('.bin')?'vectors':row.name==='catalog.json'||row.name==='manifest.json'?'metadata':'other';parts[key]+=n}
    }
  }
  return total
}

export function createRetrieval({ stateDir, binding, loadDocuments, visible, versionOf, verifyDocument = async () => true, notify = () => {}, credentials = createParseCredentials(path.join(stateDir,'retrieval')), fetcher, now = Date.now, openVector = open }) {
  const root = path.join(stateDir,'retrieval'), api = createRetrievalAPI({ credentials, fetcher })
  let stopped = false, running = null, watcher = null, watched = '', dirty = true, lastScan = 0, activeQueries = 0, job = { state: 'idle' }
  const cache = new Map(), ranking=createRankingPool(), pendingVectors=new Map(), statusSnapshots=new Map(), traces=new Map()
  let rankingCatalog = null, sourceTimer = null, automaticPending = null
  function invalidateComputations() { rankingCatalog=null;ranking.invalidate() }
  // Provider settings and encrypted credentials live outside the installed package.
  // Indexes belong to the library, never to the system-drive plugin state.
  const legacyDirectory = b => path.join(root,b.key)
  const directory = b => path.join(b.root,'索引层')
  const configFile = b => path.join(legacyDirectory(b),'config.json')
  const providerFile = path.join(root,'saved-providers.json')
  const providerKey = (type,c) => hash(type+'\0'+c.endpoint)
  const configuration = async b => {
    const c=await readJson(configFile(b), { revision: 0, ...initialRetrievalConfig() })
    const saved=await readJson(providerFile,{})
    for(const type of ['embedding','rerank']) {
      if(!c[type].credentialRef && saved[providerKey(type,c[type])]) c[type].credentialRef=saved[providerKey(type,c[type])]
    }
    if(['embedding','rerank'].some(type=>c[type].credentialRef&&!saved[providerKey(type,c[type])])) {
      await locked(providerFile,async()=>{
        const latest=await readJson(providerFile,{})
        for(const type of ['embedding','rerank'])if(c[type].credentialRef&&!latest[providerKey(type,c[type])])latest[providerKey(type,c[type])]=c[type].credentialRef
        await atomicJson(providerFile,latest)
      })
    }
    return c
  }
  const storageReady=new Map()
  async function ensureStorage(b) {
    // Revalidate the library path even after migration, rejecting junctions.
    await safePath(b.root,'索引层',{missing:true})
    if(storageReady.has(b.key))return storageReady.get(b.key)
    const pending=locked(path.join(legacyDirectory(b),'build.lock'),async()=>{
      const target=await safePath(b.root,'索引层',{missing:true})
      await mkdir(target,{recursive:true})
      const copyVerified=async(from,to)=>{
        let destination;try{destination=await lstat(to)}catch(e){if(e.code!=='ENOENT')throw e}
        if(destination?.isSymbolicLink())throw fail('LINK_DENIED','索引目标包含目录链接，迁移已停止')
        const info=await lstat(from)
        if(info.isSymbolicLink())throw fail('LINK_DENIED','旧索引包含目录链接，迁移已停止')
        if(info.isDirectory()) {
          await mkdir(to,{recursive:true})
          for(const row of await readdir(from))await copyVerified(path.join(from,row),path.join(to,row))
        } else if(info.isFile()) {
          const source=await readFile(from)
          let existing;try{existing=await readFile(to)}catch(e){if(e.code!=='ENOENT')throw e}
          if(existing && !existing.equals(source))throw fail('INDEX_MIGRATION_CONFLICT','新旧索引内容冲突，已保留两处文件')
          if(!existing){const temp=to+'.migration.tmp';await copyFile(from,temp);if(!(await readFile(temp)).equals(source))throw fail('INDEX_MIGRATION_VERIFY','索引迁移校验失败');await rename(temp,to)}
        }
      }
      // Copy and verify first; retain legacy data until every selected item is safe.
      const migrate=async source=>{
        const rows=(await readdir(source,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})).filter(r=>/^[a-f0-9]{32}$/.test(r.name)||['active.json','progress.json'].includes(r.name))
        for(const row of rows)await copyVerified(path.join(source,row.name),path.join(target,row.name))
        for(const row of rows)await rm(path.join(source,row.name),{recursive:true,force:true})
      }
      await migrate(legacyDirectory(b))
      const nested=await safePath(b.root,'索引层/向量检索',{missing:true})
      if(await stat(nested).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e})) {
        await locked(path.join(nested,'build.lock'),()=>migrate(nested))
        await rmdir(nested).catch(e=>{if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e})
      }
    })
    storageReady.set(b.key,pending)
    try{await pending}catch(e){storageReady.delete(b.key);throw e}
  }
  const activeOf = async b => {const active=await readJson(path.join(directory(b),'active.json'),null).catch(e=>{if(e.code==='STATE_CORRUPT')return null;throw e});return active&&active.embedding&&active.key===modelKey(active.embedding)&&(active.format==null||active.format===1)&&(active.chunkVersion==null||active.chunkVersion===CHUNK_VERSION)?active:null}
  const manifestOf = async (b, c) => {
    await ensureStorage(b)
    const dir = await safePath(b.root,'索引层/'+modelKey(c),{missing:true})
    try {
      const manifest = await readJson(path.join(dir,'manifest.json'),emptyManifest())
      if (manifest.format!==1 || !Number.isSafeInteger(manifest.dimension) || manifest.dimension<0 || !Number.isSafeInteger(manifest.nextSlot) || manifest.nextSlot<0 || !manifest.vectors || typeof manifest.vectors!=='object' || Array.isArray(manifest.vectors) || Object.values(manifest.vectors).some(x=>!Number.isSafeInteger(x)||x<0||x>=manifest.nextSlot)) throw fail('STATE_CORRUPT','向量清单无效')
      return {dir,manifest}
    }catch(e){if(e.code==='STATE_CORRUPT')return {dir,manifest:{...emptyManifest(),corrupt:true}};throw e}
  }
  async function collectOld(b) {
    if(activeQueries)return 0
    const config=await configuration(b),active=await activeOf(b),keep=new Set([active?.key,modelKey(config.embedding)])
    let removed=0
    for(const row of await readdir(directory(b),{withFileTypes:true}).catch(()=>[]))if(row.isDirectory()&&/^[a-f0-9]{32}$/.test(row.name)&&!keep.has(row.name)){await rm(path.join(directory(b),row.name),{recursive:true,force:true});removed++}
    return removed
  }
  async function documents(b, force = false, embeddingConfig = null) {
    const cfg = embeddingConfig || (await configuration(b)).embedding, {manifest} = await manifestOf(b,cfg)
    const target = manifest.effectiveTarget || cfg.chunkTarget || 2400, overlap = Math.min(cfg.chunkOverlap ?? 240, Math.floor(target/3)), chunkSignature = target + ':' + overlap
    const loadStarted=performance.now(),loaded = await loadDocuments(b,force), out = []
    const loadDocumentsMs=performance.now()-loadStarted,chunkStarted=performance.now()
    let chunkCacheHits=0,chunkCacheMisses=0
    const alive = new Set()
    for (const d of loaded.documents) {
      const key = b.key + '\0' + d.path; alive.add(key)
      let entry = cache.get(key)
      if (!entry || entry.revision !== d.revision || entry.title !== d.title || entry.chunkSignature !== chunkSignature) {
        chunkCacheMisses++
        entry = { ...d, ...structureDocument(d.text,d.title,{target,overlap}), chunkSignature }
        entry.rankingChunks=entry.chunks.map(c=>({c,text:d.text.slice(c.start,c.end),vectorHash:hash(embeddingText(d.text,c))}))
      }
      else {entry = { ...entry, ...d };chunkCacheHits++}
      cache.set(key,entry); out.push(entry)
    }
    for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key)
    return { ...loaded, documents: out,documentMetrics:{loadDocumentsMs,chunkingMs:performance.now()-chunkStarted,chunkCacheHits,chunkCacheMisses} }
  }
  async function assertCurrent(b, configRevision, signal) {
    if (signal?.aborted || stopped) throw fail('CANCELED','任务已暂停')
    const current = await binding(b.st.kbId)
    if (current.key !== b.key || versionOf(current) !== versionOf(b)) throw fail('SETTINGS_CHANGED','知识库设置已改变')
    if (configRevision != null && (await configuration(current)).revision !== configRevision) throw fail('SETTINGS_CHANGED','检索配置已改变')
    return current
  }
  async function checkpoint(b) { await atomicJson(path.join(directory(b),'progress.json'),job); notify({ type:'retrieval', kbId:b.st.kbId, state:job.state }) }
  async function build(b, config, signal, depth=0) {
    job = { state:'scanning', startedAt:now(), completed:0, pending:0, failed:0, errors:[] }; await checkpoint(b)
    const catalog = await documents(b,true,config.embedding)
    const eligible = catalog.documents.filter(d => !d.private || config.allowPrivateCloud)
    const { dir, manifest } = await manifestOf(b,config.embedding)
    if(manifest.corrupt)throw fail('INDEX_CORRUPT','向量索引损坏，请使用重建操作')
    await mkdir(dir,{recursive:true})
    const pending = new Map(), descriptions = []
    for (const d of eligible) for (const c of d.chunks) {
      const input = embeddingText(d.text,c), h = hash(input)
      descriptions.push({ path:d.path, revision:d.revision, chunk:c, hash:h })
      if (manifest.vectors[h] == null) pending.set(h,input)
    }
    job = { ...job, state:'building', documents:catalog.documents.length, chunks:descriptions.length, total:pending.size, pending:pending.size, reused:descriptions.filter(x => manifest.vectors[x.hash] != null).length,
      estimatedVectorBytes:descriptions.length * (manifest.dimension || config.embedding.dimensions || 1024) * 4, readErrors:catalog.errors, nameOnly:catalog.nameOnly }
    await checkpoint(b)
    const items = [...pending]
    for (let index = 0; index < items.length;) {
      await assertCurrent(b,config.revision,signal)
      const batch = items.slice(index,index+config.embedding.batchSize)
      let vectors
      for (let attempt=0;;attempt++) {
        try { vectors = await api.embed(config.embedding,batch.map(x => x[1]),'document',{ signal, dimension:manifest.dimension || undefined }); break }
        catch (e) {
          if(e.code==='API_TOO_LONG' && depth<5 && (manifest.effectiveTarget||config.embedding.chunkTarget||2400)>128) {
            manifest.effectiveTarget=Math.max(128,Math.floor((manifest.effectiveTarget||config.embedding.chunkTarget||2400)/2))
            await atomicJson(path.join(dir,'manifest.json'),manifest);cache.clear();return build(b,config,signal,depth+1)
          }
          if (['API_LIMIT','API_TEMPORARY','API_TIMEOUT','API_NETWORK'].includes(e.code) && attempt < 3 && !signal.aborted) {
            job.state='retrying'; job.retryAt=now()+(e.retryAfter || 1000*2**attempt); await checkpoint(b)
            await new Promise(resolve => { const t=setTimeout(done,e.retryAfter || 1000*2**attempt); function done(){clearTimeout(t); signal.removeEventListener('abort',done); resolve()}; signal.addEventListener('abort',done,{once:true}) }); await assertCurrent(b,config.revision,signal); continue
          }
          // An explicitly oversized request is split, never truncated. Ordinary
          // 400 errors remain errors, rather than silently altering source text.
          throw e
        }
      }
      await assertCurrent(b,config.revision,signal)
      const dimension = vectors[0]?.length || manifest.dimension
      if (manifest.dimension && dimension !== manifest.dimension) throw fail('API_VECTOR','模型向量维度发生变化，请重建')
      const additions = [], checksums = {}, shards = new Map()
      for (let i=0;i<batch.length;i++) {
        const slot=manifest.nextSlot+i, shard=Math.floor(slot/4096), buf=Buffer.alloc(dimension*4)
        vectors[i].forEach((n,j)=>buf.writeFloatLE(n,j*4))
        if(!shards.has(shard))shards.set(shard,[])
        shards.get(shard).push({slot,buf});checksums[slot]=hash(buf);additions.push([batch[i][0],slot])
      }
      let shardSyncs=0
      for(const [shard,rows] of shards) {
        const file=path.join(dir,'vectors-'+shard+'.bin')
        let fh
        try { fh = await openVector(file,'r+') } catch(e) { if(e.code!=='ENOENT') throw e; fh=await openVector(file,'w+') }
        try {
          for(const {slot,buf} of rows) {
            if(signal.aborted||stopped)throw fail('CANCELED','任务已暂停')
            let written=0; while(written<buf.length) { const r=await fh.write(buf,written,buf.length-written,(slot%4096)*dimension*4+written); if(!r.bytesWritten) throw fail('IO_ERROR','向量写入未完成'); written+=r.bytesWritten }
          }
          await fh.sync();shardSyncs++
        } finally { await fh.close() }
      }
      await assertCurrent(b,config.revision,signal)
      const committed={...manifest,dimension,nextSlot:manifest.nextSlot+batch.length,checksums:{...manifest.checksums,...checksums},vectors:{...manifest.vectors,...Object.fromEntries(additions)}}
      await atomicJson(path.join(dir,'manifest.json'),committed)
      Object.assign(manifest,committed);rankingCatalog=null
      job.shardSyncs=(job.shardSyncs||0)+shardSyncs
      index+=batch.length; job.completed=index; job.pending=items.length-index; job.state='building'; await checkpoint(b)
    }
    await assertCurrent(b,config.revision,signal)
    await atomicJson(path.join(dir,'catalog.json'),{ format:1, documents:eligible.map(d=>({path:d.path,revision:d.revision,sections:d.sections,chunks:d.chunks})) })
    await atomicJson(path.join(directory(b),'active.json'),{ key:modelKey(config.embedding), embedding:config.embedding, dimension:manifest.dimension,format:1,chunkVersion:CHUNK_VERSION, at:now() })
    job.state=catalog.errors.length?'partial':'synced'; job.finishedAt=now(); job.failed=catalog.errors.length; await checkpoint(b)
    // Keep the previous generation available for rollback; explicit clean reclaims it.
    return job
  }
  async function start(b, force=false) {
    await ensureStorage(b)
    if (running) { dirty=true; return { ...job, running:true } }
    const config=await configuration(b)
    if (!config.enabled) return { state:'disabled' }
    const progress=await readJson(path.join(directory(b),'progress.json'),{})
    if(running){dirty=true;return {...job,running:true}}
    if (progress.state==='paused' && !force) return progress
    const controller=new AbortController(); dirty=false; lastScan=now()
    // The new job is queued before its asynchronous build acquires the lock.
    // Do not expose the previous generation's completed state in this gap.
    job={state:'waiting',completed:0,total:0,reused:0}
    const promise=locked(path.join(directory(b),'build.lock'),()=>build(b,config,controller.signal)).catch(async e=>{
      job={...job,state:['CANCELED','SETTINGS_CHANGED','API_AUTH','ENOSPC'].includes(e.code)?'paused':'failed',error:safeMessage(e),code:e.code||'INDEX_ERROR'}
      await checkpoint(b).catch(()=>{}); return job
    }).finally(()=>{running=null})
    running={key:b.key,controller,promise}; void promise; return { ...job,running:true }
  }
  async function automaticPass() {
    if(stopped) return
    let b; try {b=await binding()} catch { running?.controller.abort(); watcher?.close(); watcher=null; watched='';clearTimeout(sourceTimer);invalidateComputations();return }
    if(watched!==b.key || !watcher) {
      if(watched!==b.key){running?.controller.abort();cache.clear();statusSnapshots.clear();invalidateComputations()}
      watcher?.close(); clearTimeout(sourceTimer); watched=b.key; dirty=true
      try {watcher=watch(b.root,{recursive:true},(_event,file)=>{
        if(stopped||watched!==b.key)return
        const rel=path.relative(stateDir,path.resolve(b.root,String(file||'')))
        if(rel===''||!rel.startsWith('..')&&!path.isAbsolute(rel))return
        if(!/(^|[\\/])(?:\.kb|\.kbmeta|\.kb-state|\.git|node_modules|索引层)([\\/]|$)/.test(String(file||''))) {
          dirty=true;statusSnapshots.clear();rankingCatalog=null
          clearTimeout(sourceTimer);sourceTimer=setTimeout(()=>{sourceTimer=null;if(!stopped&&watched===b.key)notify({type:'snapshot-dirty',kbId:b.st.kbId})},200);sourceTimer.unref?.()
        }
      }); watcher.unref?.(); const currentWatcher=watcher;watcher.on('error',()=>{if(watcher!==currentWatcher)return;currentWatcher.close();watcher=null;dirty=true;notify({type:'snapshot-dirty',kbId:b.st.kbId})})}catch{watcher=null}
    }
    const config=await configuration(b)
    if(config.enabled && (dirty || now()-lastScan>300000)) await start(b)
  }
  function automatic() {
    if(automaticPending)return automaticPending
    automaticPending=automaticPass().finally(()=>{automaticPending=null})
    return automaticPending
  }
  async function stageConfig(b,args) {
    const old=await configuration(b)
    if(args.expectedRevision!=null && args.expectedRevision!==old.revision) throw fail('CONFLICT','检索设置已改变，请刷新')
    const config=validateConfig(args.config || old)
    for(const type of ['embedding','rerank']) {
      if(!config[type].credentialRef && config[type].endpoint===old[type]?.endpoint) config[type].credentialRef=old[type].credentialRef||''
    }
    const temporary={}
    for(const type of ['embedding','rerank']) if(args[type+'ApiKey']) { temporary[type]=String(args[type+'ApiKey']); config[type].credentialRef='temporary-'+type }
    const testAPI=createRetrievalAPI({fetcher,credentials:{read:ref=>ref?.startsWith('temporary-')?{apiKey:temporary[ref.slice(10)]}:credentials.read(ref)}})
    if(config.enabled || args.op==='retrieval.test') {
      const [v]=await testAPI.embed(config.embedding,['Knowledge retrieval connection test.'],'query',{timeoutMs:6000})
      if(config.embedding.dimensions && config.embedding.dimensions!==v.length) throw fail('API_VECTOR','服务返回维度与配置不符')
      config.detectedDimension=v.length
    }
    if(config.rerank.enabled) await testAPI.rerank(config.rerank,'test',['test','unrelated'],{timeoutMs:4000})
    if(args.op==='retrieval.test') return {tested:true,dimension:config.detectedDimension}
    await assertCurrent(b,null)
    return locked(configFile(b),async()=>{
      if((await configuration(b)).revision!==old.revision) throw fail('CONFLICT','检索设置已改变，请刷新')
      running?.controller.abort(); if(running) await running.promise
      for(const type of ['embedding','rerank']) if(temporary[type]) config[type].credentialRef=await credentials.save({apiKey:temporary[type]})
      await locked(providerFile,async()=>{
        const saved=await readJson(providerFile,{})
        for(const type of ['embedding','rerank'])if(config[type].credentialRef)saved[providerKey(type,config[type])]=config[type].credentialRef
        await atomicJson(providerFile,saved)
      })
      const id=modelKey(config.embedding)
      config.profiles=[...(old.profiles||[]).filter(p=>p.id!==id),{id,embedding:config.embedding}]
      config.revision=old.revision+1; await atomicJson(configFile(b),config)
      invalidateComputations();statusSnapshots.clear()
      await atomicJson(path.join(directory(b),'progress.json'),{state:config.enabled?'waiting':'disabled'})
      dirty=true; if(config.enabled) await start(b,true)
      return {saved:true,revision:config.revision,automatic:config.enabled}
    })
  }
  async function status(b,lightweight=false) {
    await ensureStorage(b)
    const config=await configuration(b), progress=running?.key===b.key?job:await readJson(path.join(directory(b),'progress.json'),{state:config.enabled?'waiting':'disabled'})
    const cached=statusSnapshots.get(b.key)
    if(lightweight&&cached&&cached.revision===config.revision&&now()-cached.at<15000)return {...structuredClone(cached.value),config,progress,estimateUpdatedAt:cached.at}
    const data=await documents(b), chunks=data.documents.reduce((n,d)=>n+d.chunks.length,0), active=await activeOf(b)
    const components={vectors:0,metadata:0,temporary:0,other:0}, target=await manifestOf(b,config.embedding), actual=await treeBytes(directory(b),components)
    let available=null; try {const disk=await statfs(directory(b)); available=disk.bavail*disk.bsize}catch{}
    const wanted=new Set(data.documents.filter(d=>!d.private||config.allowPrivateCloud).flatMap(d=>d.chunks.map(c=>hash(embeddingText(d.text,c)))))
    const stored=Object.keys(target.manifest.vectors).filter(h=>wanted.has(h)).length
    const value={config,credentialStatus:{embedding:await credentials.configured?.(config.embedding.credentialRef)||false,rerank:await credentials.configured?.(config.rerank.credentialRef)||false},progress,estimate:{storagePath:directory(b),documents:data.documents.length,textBytes:data.documents.reduce((n,d)=>n+bytes(d.text),0),chunks,uniqueVectorInputs:wanted.size,
      vectorBytes:wanted.size*(target.manifest.dimension||config.detectedDimension||1024)*4,actualBytes:actual,metadataEstimateBytes:bytes(JSON.stringify(data.documents.map(d=>({path:d.path,sections:d.sections,chunks:d.chunks})))),
      completedVectors:stored,pendingVectors:wanted.size-stored,reclaimableVectorBytes:Math.max(0,Object.keys(target.manifest.vectors).length-stored)*(target.manifest.dimension||1024)*4,
      components:{...components,lexical:0,textCache:data.existingTextCacheBytes||0},availableBytes:available,nameOnly:data.nameOnly,readErrors:data.errors,coverage:data.coverage,activeModel:active?.embedding.model||null,staging:active?.key!==modelKey(config.embedding)}}
    statusSnapshots.set(b.key,{revision:config.revision,at:now(),value:structuredClone(value)})
    return {...value,estimateUpdatedAt:now()}
  }
  async function queryVector(b,config,embedding,query) {
    const key=hash(JSON.stringify([b.key,versionOf(b),config.revision,modelKey(embedding),embedding.credentialRef,query]))
    const old=pendingVectors.get(key)
    if(old)return {...await old,requestMerged:true}
    const pending=api.embed(embedding,[query],'query',{timeoutMs:6000}).then(v=>({vector:Array.from(v[0])})).catch(e=>({warning:safeMessage(e)}))
    pendingVectors.set(key,pending)
    try{return await pending}finally{if(pendingVectors.get(key)===pending)pendingVectors.delete(key)}
  }
  async function search(b,args={}) {
    const searchStarted=performance.now(),timings={}
    const signal=args.signal instanceof AbortSignal?args.signal:undefined
    if(signal?.aborted)throw fail('CANCELED','检索已取消')
    const query=String(args.query??args.q??'').trim(); if(!query) return {items:[],total:0,coverageNote:'请输入检索词'}
    const mode=args.retrievalMode||'hybrid'; if(!['hybrid','fulltext','semantic','exact'].includes(mode))throw fail('BAD_SEARCH_MODE','检索方式无效')
    const config=await configuration(b), active=await activeOf(b), embedding=active?.embedding||config.embedding
    const canVector=config.enabled && ['hybrid','semantic'].includes(mode)
    const vectorStarted=performance.now()
    const vectorPromise=(canVector?queryVector(b,config,embedding,query):Promise.resolve({})).then(result=>{timings.queryVectorMs=canVector?performance.now()-vectorStarted:0;return result})
    const loadStarted=performance.now()
    const data=await documents(b,args.fresh===true,embedding), current=await binding(b.st.kbId)
    timings.documentLoadMs=performance.now()-loadStarted
    Object.assign(timings,data.documentMetrics)
    if(versionOf(current)!==versionOf(b))throw fail('SETTINGS_CHANGED','检索设置已改变')
    const sourceDocs=data.documents.filter(d=>visible(current,d.path,args.question===true,args.includePrivate===true) &&
      (!args.path||d.path===args.path) && (!args.direct||args.prefix===undefined||path.posix.dirname(d.path)===(args.prefix||'.')) && (!args.prefix||d.path===args.prefix||d.path.startsWith(args.prefix.replace(/\/$/,'')+'/')) && (!args.layer||args.layer===d.layer) &&
      (!args.extension||args.extension===d.extension) && (!args.kind||args.kind===d.kind) && (!args.tag||d.tags?.includes(args.tag)) &&
      (!args.after||d.mtimeMs>=Date.parse(args.after)) && (!args.before||d.mtimeMs<Date.parse(args.before)+86400000))
    const {dir,manifest}=await manifestOf(b,embedding), catalogStarted=performance.now()
    const scope=hash(JSON.stringify([b.key,b.root,versionOf(b),config.revision,modelKey(embedding),CHUNK_VERSION,args.question===true,args.includePrivate===true,config.allowPrivateCloud]))
    const signature=hash(JSON.stringify([scope,manifest.dimension,manifest.nextSlot,manifest.vectors,manifest.checksums,sourceDocs.map(d=>[d.path,d.revision,d.chunkSignature,d.title,d.tags,d.private])]))
    let catalog=rankingCatalog?.revision===signature?rankingCatalog:null
    if(!catalog) {
      const rows=[],references=[];let size=0
      for(const d of sourceDocs)for(const {c,text,vectorHash} of d.rankingChunks) {
        const id=rows.length,slot=d.private&&!config.allowPrivateCloud?null:manifest.vectors[vectorHash],checksum=manifest.checksums?.[slot]
        const key=hash(JSON.stringify([d.path,d.revision,d.title,d.tags,d.chunkSignature,c.start,c.end,slot,checksum]))
        rows.push({id,key,path:d.path,title:d.title,tags:d.tags,section:c.section,text,slot,checksum});references.push({d,c})
        size+=bytes(text)+bytes(d.title||'')+bytes(d.path)+256
      }
      catalog={revision:signature,scope,records:rows,refs:references,allowedIds:rows.map(r=>r.id),bytes:size}
      rankingCatalog=size<=128*1024*1024?catalog:null
    }
    const currentDocs=new Map(sourceDocs.map(d=>[d.path,d]))
    const refs=catalog.refs.map(({d,c})=>({d:currentDocs.get(d.path)||d,c})),records=[]
    const nextId=()=>refs.length
    // Full-document exact matching remains independent of segmentation: even a
    // phrase longer than the overlap must survive a chunk boundary.
    for(const d of sourceDocs) {
      const needles=[query,...[...query.matchAll(/["“]([^"”]+)["”]/gu)].map(m=>m[1])]
      for(const needle of needles) {
        const at=d.text.toLowerCase().indexOf(needle.toLowerCase())
        if(at<0||d.chunks.some(c=>c.start<=at&&c.end>=at+needle.length))continue
        const base=d.chunks.find(c=>c.start<=at&&c.end>at)||d.chunks[0]
        if(!base)continue
        const c={...base,start:at,end:at+needle.length},id=nextId()
        records.push({id,path:d.path,title:d.title,tags:d.tags,section:c.section,text:d.text.slice(c.start,c.end)});refs.push({d,c})
      }
    }
    // Name-only binary sources are still discoverable; never embed bytes.
    for(const d of data.names||[]) if(visible(current,d.path,args.question===true,args.includePrivate===true) && (!args.prefix||d.path===args.prefix||d.path.startsWith(args.prefix.replace(/\/$/,'')+'/')) && (!args.path||args.path===d.path) && (!args.layer||args.layer===d.layer) && (!args.extension||args.extension===d.extension) && (!args.kind||args.kind===d.kind) && (!args.tag||d.tags?.includes(args.tag)) && (!args.after||d.mtimeMs>=Date.parse(args.after)) && (!args.before||d.mtimeMs<Date.parse(args.before)+86400000) && !args.question) {
      const id=nextId(); records.push({id,path:d.path,title:d.title,text:d.path,section:0});refs.push({d,c:null})
    }
    timings.catalogMs=performance.now()-catalogStarted
    const vectors=await vectorPromise; let warning=vectors.warning||''
    if(vectors.vector && vectors.vector.length!==manifest.dimension) {delete vectors.vector;warning='向量索引尚未就绪或维度已改变，已使用全文'}
    const result=await ranking.run({catalog:{revision:catalog.revision,scope:catalog.scope,records:catalog.records,bytes:catalog.bytes},allowedIds:catalog.allowedIds,records,query,vector:vectors.vector,vectorDir:dir,dimension:manifest.dimension,mode,useCache:args.useCache!==false},signal)
    timings.queueWaitMs=result.transport.queueWaitMs
    if(result.vectorErrors.length)warning='部分向量分片缺失或损坏，全文结果仍可用，请重建'
    let ranked=result.ranked, reranked=false
    const rerankStarted=performance.now()
    if(config.rerank.enabled && ranked.length && ['hybrid','semantic'].includes(mode)) {
      try {
        await assertCurrent(b,config.revision)
        const top=ranked.filter(r=>config.allowPrivateCloud||!refs[r.id].d.private).slice(0,40), snippets=top.map(r=>{const {d,c}=refs[r.id];return c?c.inputPrefix+'\n'+d.text.slice(c.start,c.end):d.title})
        if(!top.length)throw fail('RERANK_PRIVATE','候选未获云端处理授权')
        const scores=await api.rerank(config.rerank,query,snippets,{timeoutMs:4000}), indices=new Set(scores.map(r=>r.index))
        const sorted=[...scores].sort((a,z)=>Number(top[z.index].exact)-Number(top[a.index].exact)||z.relevance_score-a.relevance_score)
        const topIds=new Set(top.map(r=>r.id))
        ranked=[...sorted.map(r=>({...top[r.index],rerankScore:r.relevance_score})),...top.filter((_,i)=>!indices.has(i)),...ranked.filter(r=>!topIds.has(r.id))].sort((a,z)=>Number(z.exact)-Number(a.exact)); reranked=true
      }catch(e){warning=[warning,'重排序未完成，使用融合结果'].filter(Boolean).join('；')}
    }
    timings.rerankMs=performance.now()-rerankStarted
    const verifyStarted=performance.now()
    const items=[], perDoc=new Map(), limit=Math.max(1,Math.min(500,Number(args.limit)||20)), offset=Math.max(0,Number(args.offset)||0)
    let remaining=48*1024
    const verified=new Map()
    for(const r of ranked) {
      const {d,c}=refs[r.id]
      if(!args.path && (perDoc.get(d.path)||0)>=2)continue
      if(c&&!verified.has(d.path))verified.set(d.path,verifyDocument(b,d.path,d.revision).catch(()=>false))
      if(c && !(await verified.get(d.path))) {dirty=true;cache.delete(b.key+'\0'+d.path);warning='部分来源已改变，请重新检索；未返回旧片段';continue}
      const range=c?expandRange(d.text,c):{start:0,end:0,line:null,text:'',headings:[],more:false}
      const existing=items.find(x=>x.path===d.path && x.revision===d.revision && range.start<=x.end && range.end>=x.start)
      if(existing) {
        const start=Math.min(existing.start,range.start),end=Math.max(existing.end,range.end),union=d.text.slice(start,end),delta=bytes(union)-bytes(existing.text||'')
        if(bytes(union)<=12*1024 && (!args.question||delta<=remaining)) {
          if(args.question)remaining-=delta
          existing.start=start;existing.end=end;existing.text=union;existing.line=1+(d.text.slice(0,start).match(/\n/g)||[]).length
          existing.endLine=1+(d.text.slice(0,end).match(/\n/g)||[]).length;existing.ranges.push({start:range.start,end:range.end,line:range.line});existing.channels=[...new Set([...existing.channels,...r.channels])];continue
        }
        if(existing.start<=c.start&&existing.end>=c.end){existing.channels=[...new Set([...existing.channels,...r.channels])];continue}
      }
      if(!args.question) {
        const document=items.find(x=>x.path===d.path)
        if(document){document.ranges.push({start:range.start,end:range.end,line:range.line});document.channels=[...new Set([...document.channels,...r.channels])];perDoc.set(d.path,(perDoc.get(d.path)||0)+1);continue}
      }
      if(args.question && (!c||remaining<=0))continue
      if(args.question && bytes(range.text)>remaining) {range.text=byteSlice(range.text,remaining);range.end=range.start+range.text.length;range.more=true}
      if(args.question)remaining-=bytes(range.text)
      perDoc.set(d.path,(perDoc.get(d.path)||0)+1)
      items.push({...d,text:undefined,chunks:undefined,sections:undefined,rankingChunks:undefined,...range,snippet:range.text?byteSlice(d.text.slice(Math.max(range.start,c.start-80),range.end),600):'仅名称可检索',score:r.score,channels:r.channels,reranked,contentTruncated:range.more,chunk:c,ranges:[{start:range.start,end:range.end,line:range.line}]})
      if(args.question && items.length>=offset+limit)break
    }
    for(const file of new Set(items.filter(i=>i.chunk).map(i=>i.path))){const d=sourceDocs.find(d=>d.path===file);if(!await verifyDocument(b,file,d.revision))throw fail('FILE_CHANGED','来源在检索期间改变，请重新检索')}
    await assertCurrent(b,config.revision,signal)
    if(!args.question) {
      if(args.sort==='name')items.sort((a,z)=>a.path.localeCompare(z.path))
      if(args.sort==='modified')items.sort((a,z)=>z.mtimeMs-a.mtimeMs||a.path.localeCompare(z.path))
    }
    timings.verifyAndResultsMs=performance.now()-verifyStarted;timings.totalMs=performance.now()-searchStarted
    const covered=catalog.records.filter(r=>r.slot!=null).length,chunkCount=catalog.records.length+records.length
    const semanticUsed=Boolean(vectors.vector&&result.semantic>0)
    const steps=[mode==='exact'?'全文精确匹配':`全文检索（${sourceDocs.length} 份可读资料，子串匹配 + BM25，词面候选 ${result.lexical}）`]
    if(semanticUsed)steps.push(`向量检索（${embedding.model}，语义候选 ${result.semantic}）`)
    else if(canVector)steps.push(`向量未参与召回（${covered===0?'当前范围没有可用向量索引':warning?'服务或索引异常':'未获得可用查询向量'}），使用全文结果`)
    if(result.crossRounds&&semanticUsed)steps.push(`一轮交叉补充（向量→章节内全文 ${result.crossFulltext||0} 条，全文→文档内向量 ${result.crossSemantic||0} 条）`)
    if(mode==='hybrid'&&semanticUsed)steps.push('RRF 排名融合')
    steps.push('按文档与原文范围去重')
    if(reranked)steps.push(`API 重排序（${config.rerank.model}）`)
    steps.push('原文版本校验及章节、相邻上下文扩展')
    const retrievalTrace={requestedMode:mode,embeddingModel:semanticUsed?embedding.model:null,fulltext:true,semantic:semanticUsed,crossRounds:result.crossRounds,reranked,steps,warning,timings,transport:result.transport,scan:data.scanMetrics}
    const history=traces.get(b.key)||[];history.push({at:now(),...retrievalTrace,cache:result.cache});traces.set(b.key,history.slice(-10))
    return {cache:{...result.cache,queryRequestMerged:Boolean(vectors.requestMerged)},retrievalTrace,retrievalDisclosure:retrievalDisclosure(retrievalTrace,b.preferences?.showRetrievalProcess!==false),items:items.slice(offset,offset+limit),total:args.question?ranked.length:items.length,offset,limit,mode:canVector&&!vectors.vector?'fulltext':mode,crossRounds:result.crossRounds,warning,
      coverageNote:`全文覆盖 ${sourceDocs.length} 份资料、${chunkCount} 个片段；其中 ${covered} 个片段已向量化；仅名称 ${data.nameOnly} 份；读取失败 ${data.errors.length} 份。${warning}`,
      coverage:{documents:sourceDocs.length,chunks:chunkCount,vectors:covered,nameOnly:data.nameOnly,errors:data.errors.length},more:args.question?ranked.length>items.length:items.length>offset+limit}
  }
  async function reconcile(b) {
    await ensureStorage(b)
    let config=await configuration(b)
    const raw=await readJson(path.join(directory(b),'active.json'),null)
    let compatible=true,from=null
    if(raw){
      const validKey=/^[a-f0-9]{32}$/.test(raw.key||'')
      const old=validKey?await readJson(await safePath(b.root,'索引层/'+raw.key+'/manifest.json',{missing:true}),{}).catch(()=>({})):{}
      compatible=Boolean(validKey&&raw.embedding&&raw.key===modelKey(raw.embedding)&&old.format===1&&(raw.chunkVersion==null||raw.chunkVersion===CHUNK_VERSION)&&(raw.format==null||raw.format===1))
      if(!compatible)from=raw.key
    }
    const target=await manifestOf(b,config.embedding)
    if(target.manifest.corrupt)from=modelKey(config.embedding)
    if(from&&config.upgradeFrom!==from){
      if(running){running.controller.abort();await running.promise}
      await locked(configFile(b),async()=>{
        const next=await configuration(b)
        if(next.revision!==config.revision)throw fail('CONFLICT','检索设置已改变，请重试升级')
        next.embedding.generation=hash('upgrade:'+from+':'+now()).slice(0,16);next.upgradeFrom=from;next.revision++
        const previous=await readJson(path.join(directory(b),'progress.json'),{})
        await atomicJson(configFile(b),next);await atomicJson(path.join(directory(b),'progress.json'),{state:previous.state==='paused'?'paused':next.enabled?'waiting':'disabled'});config=next
      })
    }
    const active=await activeOf(b),requiresBuild=config.enabled&&(!active||active.key!==modelKey(config.embedding))
    if(requiresBuild)await start(b)
    const progress=await readJson(path.join(directory(b),'progress.json'),{})
    return {format:1,chunkVersion:CHUNK_VERSION,modelFingerprint:modelKey(config.embedding),activeGeneration:active?.key||null,compatible,requiresBuild,state:requiresBuild?(progress.state||'waiting'):config.enabled?'current':'disabled',storagePath:directory(b),fallback:compatible&&active?'compatible-active-index':'current-source-fulltext'}
  }
  const timer=setInterval(()=>void automatic().catch(()=>{}),30000);timer.unref?.()
  return {
    async expand(b,args){
      if(!visible(b,args.path))throw fail('PRIVATE_HIDDEN','资料不可见')
      const data=await documents(b), d=data.documents.find(x=>x.path===args.path)
      if(!d)throw fail('NOT_FOUND','来源不存在或不是可读取文本')
      if(args.revision!==d.revision || !(await verifyDocument(b,d.path,d.revision)))throw fail('FILE_CHANGED','来源已改变，请重新检索')
      const at=Math.max(0,Number(args.start)||0),c=d.chunks.find(x=>x.end>at)||d.chunks.at(-1)
      if(!c)return {path:d.path,text:'',more:false}
      const range=expandRange(d.text,c);await assertCurrent(b,null)
      return {path:d.path,title:d.title,revision:d.revision,...range,nextStart:range.end<d.text.length?range.end:null,previousStart:range.start>0?Math.max(0,range.start-2000):null}
    },
    reconcile,
    async search(b,args){activeQueries++;try{return await search(b,args)}finally{activeQueries--}},automatic,
    async dispatch(b,args,caller) {
      if(caller)throw fail('ADMIN_ONLY','检索服务配置与任务管理仅可在设置页操作')
      await ensureStorage(b)
      if(args.op==='retrieval.trace')return {traces:traces.get(b.key)||[]}
      if(args.op==='retrieval.get')return status(b,args.lightweight===true)
      if(['retrieval.save','retrieval.test'].includes(args.op))return stageConfig(b,args)
      if(args.op==='retrieval.pause'){running?.controller.abort();if(running)await running.promise;job={...await readJson(path.join(directory(b),'progress.json'),{}),state:'paused'};await checkpoint(b);return {paused:true}}
      if(args.op==='retrieval.resume'||args.op==='retrieval.retry') {await atomicJson(path.join(directory(b),'progress.json'),{state:'waiting'});return start(b,true)}
      if(args.op==='retrieval.rebuild') {
        if(running){running.controller.abort();await running.promise}
        // Preserve the old active generation until the replacement is ready.
        const config=await configuration(b);config.embedding.generation=hash(String(now())).slice(0,16);config.revision++
        await atomicJson(configFile(b),config);return start(b,true)
      }
      if(args.op==='retrieval.clean') {
        if(running||activeQueries)throw fail('TASK_RUNNING','构建或检索进行中，请稍后清理')
        const removed=await collectOld(b)
        return {removedGenerations:removed,note:'活动索引内废弃向量可通过重建后再次清理回收'}
      }
      throw fail('BAD_OPERATION','未知检索操作')
    },
    invalidate(){dirty=true;cache.clear();statusSnapshots.clear();traces.clear();invalidateComputations()},
    dispose(){stopped=true;clearInterval(timer);clearTimeout(sourceTimer);watcher?.close();running?.controller.abort();ranking.dispose();rankingCatalog=null;cache.clear();pendingVectors.clear();statusSnapshots.clear();traces.clear()},
  }
}
