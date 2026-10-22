import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { rank } from '../src/host/retrieval-worker.js'
import { rank as baselineRank } from './fixtures/retrieval-worker-beta1.mjs'
import { createRankingPool } from '../src/host/retrieval-pool.js'
import { createRetrieval } from '../src/host/retrieval.js'
import { initialRetrievalConfig } from '../src/host/retrieval-api.js'
import { createQuestionService } from '../src/host/workbench-question.js'
import { syncManagedFiles } from '../src/host/managed-files.js'
import { createSystemUpgrades } from '../src/host/system-upgrades.js'
import { digest } from '../src/host/workbench-state.js'

const temp = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'kb-beta2-')); t.after(() => rm(dir, {recursive:true,force:true})); return dir }

test('cache preserves baseline ranking; warm/cold and cancellation remain isolated', async t => {
  const records=Array.from({length:100},(_,id)=>({id,path:'doc-'+id+'.md',title:'资料 '+id,tags:[],section:0,text:(id%2?'全文条件与否定。':'蓝鲸 ZX-991 Arabic العربية。')+' unique '+id}))
  const started=performance.now(),metrics=[]
  for(const query of ['ZX-991','鲸','"全文条件"','العربية','不存在的词']) {
    const message={records,query,mode:'hybrid'},start=performance.now(),expected=await baselineRank(message),row={query,baselineMs:performance.now()-start,runs:[]}
    for(const useCache of [false,true,true]) {
      const begin=performance.now(),result=await rank({...message,useCache});row.runs.push({useCache,ms:performance.now()-begin,hits:result.cache.lexicalHits})
      assert.deepEqual(result.ranked,expected.ranked);assert.equal(result.crossRounds,expected.crossRounds)
    }
    metrics.push(row)
  }
  console.log('beta2-ranking-metrics:'+JSON.stringify(metrics))
  const pool=createRankingPool();t.after(()=>pool.dispose())
  const first=pool.run({records,query:'蓝鲸'}),controller=new AbortController()
  const canceled=assert.rejects(pool.run({records,query:'鲸'},controller.signal),{code:'CANCELED'});controller.abort()
  const bad=assert.rejects(pool.run({records:null,query:'x'}),{code:'SEARCH_ERROR'})
  const last=pool.run({records,query:'蓝鲸'})
  await canceled;await bad;assert.deepEqual((await first).ranked,(await last).ranked);assert.equal(pool.stats.started,1)
  console.log('beta2 fixed sample ranking checks, ms:',Math.round(performance.now()-started))
})

test('only in-flight embeddings merge; subsequent queries run again and source changes reject',async t=>{
  const root=await temp(t),b={root,key:'one',st:{kbId:'kb'}},text='# Source\n蓝鲸 ZX-991 前提是已批准。'
  let requests=0,sourceChanged=false
  const service=createRetrieval({stateDir:path.join(root,'state'),binding:async()=>b,versionOf:()=>1,visible:()=>true,
    loadDocuments:async()=>({documents:[{path:'source.md',title:'Source',text,revision:digest(text),tags:[]}],names:[],errors:[],nameOnly:0}),
    verifyDocument:async()=>!sourceChanged,credentials:{save:async()=> 'test-ref',read:async()=>({apiKey:'synthetic'})},
    fetcher:async(_url,args)=>{const body=JSON.parse(args.body);if(body.input[0]==='蓝鲸'){requests++;await new Promise(r=>setTimeout(r,40))}return Response.json({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})}})
  t.after(()=>service.dispose())
  const config=initialRetrievalConfig();config.enabled=true;config.embedding.endpoint='http://127.0.0.1/mock'
  await service.dispatch(b,{op:'retrieval.save',config})
  for(let i=0;i<100;i++){if((await service.dispatch(b,{op:'retrieval.get'})).progress.state==='synced')break;await new Promise(r=>setTimeout(r,5))}
  const [a,z]=await Promise.all([service.search(b,{query:'蓝鲸'}),service.search(b,{query:'蓝鲸'})])
  assert.equal(requests,1);assert.deepEqual(a.items,z.items);assert(a.cache.queryRequestMerged||z.cache.queryRequestMerged)
  await service.search(b,{query:'蓝鲸'});assert.equal(requests,2);console.log('beta2-query-api-counts:',JSON.stringify({simultaneousQueries:2,simultaneousApiRequests:1,afterSequentialQuery:requests}))
  sourceChanged=true;const stale=await service.search(b,{query:'蓝鲸'});assert.equal(stale.items.length,0)
  await assert.rejects(service.dispatch(b,{op:'retrieval.get'},'agent'),{code:'ADMIN_ONLY'})
})

test('protocol v2 preserves late evidence, gates review, and avoids answer echo; v1 stays compatible',async()=>{
  const text='前文背景。'.repeat(300)+'\n重要结论：AUDIT-991，仅限审批通过后。',b={key:'test',st:{kbId:'test'},root:'D:/synthetic',preferences:{showRetrievalProcess:true}}
  let changed=false,denied=false
  const service=createQuestionService({binding:async()=>b,versionOf:()=>1,visible:()=>!denied,textOf:async()=>({text,revision:changed?'new':'v1'}),redactReferences:(_b,_p,t)=>t,now:Date.now,
    search:async()=>({items:[{path:'sample.md',title:'sample',revision:'v1',start:0,end:text.length}],coverageNote:'synthetic'})})
  const make=protocolVersion=>service.dispatch(b,{op:'question.create',sessionId:'s',policyVersion:1,protocolVersion},'s')
  const modern=await make(2),found=await service.dispatch(b,{op:'question.search',questionId:modern.questionId,query:'AUDIT-991'},'s')
  assert(found.sources[0].text.includes('AUDIT-991'));assert(found.sources[0].text.includes('仅限审批通过后'))
  const again=await service.dispatch(b,{op:'question.search',questionId:modern.questionId,query:'AUDIT-991'},'s');assert.equal(again.sources[0].text,found.sources[0].text)
  const args={op:'question.validate',questionId:modern.questionId,answer:'示例回答。'.repeat(200)+found.sources[0].citation,review:{coverage:'sufficient',gaps:[],conflicts:[]}}
  const valid=await service.dispatch(b,args,'s');assert.equal(valid.review.decision,'ready');assert.equal(valid.answerWithRetrievalFooter,undefined)
  assert.deepEqual(valid.valid[0].citations,[found.sources[0].citation]);assert(valid.nextAction.includes('保留'))
  const missing=await service.dispatch(b,{...args,answer:'没有引用的答案'},'s')
  assert.equal(missing.missingCitations,true);assert.notEqual(missing.review.decision,'ready');assert(missing.nextAction.includes('再校验'))
  assert((await service.dispatch(b,{...args,returnAnswer:true},'s')).answerWithRetrievalFooter)
  assert.equal((await service.dispatch(b,{...args,review:{coverage:'uncertain',gaps:['日期不明确'],conflicts:[]}},'s')).review.decision,'supplement-needed')
  assert.equal((await service.dispatch(b,{...args,answer:'[S99]'},'s')).review.decision,'repair-citations')
  const old=await make(undefined),oldFound=await service.dispatch(b,{op:'question.search',questionId:old.questionId,query:'AUDIT-991'},'s')
  const legacy=await service.dispatch(b,{op:'question.validate',questionId:old.questionId,answer:'示例回答。'.repeat(200)+oldFound.sources[0].citation,review:{coverage:'sufficient',gaps:[],conflicts:[]}},'s');assert(legacy.answerWithRetrievalFooter)
  console.log('beta2 validation wire bytes:',{legacy:Buffer.byteLength(JSON.stringify(legacy)),modern:Buffer.byteLength(JSON.stringify(valid))})
  changed=true;assert((await service.dispatch(b,args,'s')).invalid.length)
  denied=true;await assert.rejects(service.dispatch(b,{op:'question.read',questionId:modern.questionId,sourceId:'S1'},'s'),{code:'SOURCE_DENIED'})
})

test('managed upgrades preserve custom content, original applied hashes, backups, blocks and interrupted writes',async t=>{
  const root=await temp(t),item={path:'rules.md',content:'v1',version:'one',instructions:true}
  await syncManagedFiles({root,items:[item]})
  await writeFile(path.join(root,'rules.md'),'custom')
  let result=await syncManagedFiles({root,items:[{...item,content:'v2',version:'two'}]})
  assert.equal(await readFile(path.join(root,'rules.md'),'utf8'),'custom');assert.equal(result.files[0].appliedHash,digest('v1'))
  await writeFile(path.join(root,'rules.md'),'v1')
  let calls=0
  await assert.rejects(syncManagedFiles({root,items:[{...item,content:'v2'}],check:async()=>{if(++calls===2)throw Object.assign(Error('interrupted'),{code:'ENOSPC'})}}),{code:'ENOSPC'})
  assert.equal(await readFile(path.join(root,'rules.md'),'utf8'),'v1')
  result=await syncManagedFiles({root,items:[{...item,content:'v2'}]})
  assert.equal(await readFile(path.join(root,'rules.md'),'utf8'),'v2');assert(result.files[0].backup)
  const block={path:'AGENTS.md',content:'<!-- kb -->old<!-- /kb -->',block:{start:'<!-- kb -->',end:'<!-- /kb -->'},knownHashes:[digest('<!-- kb -->old<!-- /kb -->')]}
  await writeFile(path.join(root,'AGENTS.md'),'USER\n'+block.content+'\nTAIL')
  await syncManagedFiles({root,items:[block]})
  await syncManagedFiles({root,items:[{...block,content:'<!-- kb -->new<!-- /kb -->'}]})
  assert.equal(await readFile(path.join(root,'AGENTS.md'),'utf8'),'USER\n<!-- kb -->new<!-- /kb -->\nTAIL')
  await writeFile(path.join(root,'AGENTS.md'),'<!-- kb -->one<!-- kb -->two<!-- /kb -->')
  result=await syncManagedFiles({root,items:[block]});assert.equal(result.files[0].status,'conflict')
})

test('system checks are idempotent and preserve user AGENTS; migration failures can retry',async t=>{
  const root=await temp(t);await writeFile(path.join(root,'AGENTS.md'),'USER RULES')
  const b={root,key:'k',st:{kbId:'kb'},conf:{revision:1},core:{status:async()=>({index:{reason:'ok'}})}}
  let fail=true,calls=0
  const manager=createSystemUpgrades({binding:async()=>b,catalog:async()=>[{path:'_模板/sample.md',content:'template',version:'v2'}],runtime:async()=>({version:'2.1-beta2',buildId:'build'}),retrieval:{reconcile:async()=>{calls++;if(fail)throw Object.assign(Error('space'),{code:'ENOSPC'});return {format:1,chunkVersion:'structure-1',requiresBuild:false}}}})
  let result=await manager.check(b);assert.equal(result.status,'failed');assert(!result.appliedBuildId)
  fail=false;result=await manager.check(b,true);assert.equal(result.status,'current');assert.equal(result.appliedBuildId,'build')
  await manager.check(b);assert.equal(calls,2);assert.equal(await readFile(path.join(root,'AGENTS.md'),'utf8'),'USER RULES')
  await assert.rejects(manager.dispatch(b,{op:'upgrade.check'},'agent'),{code:'ADMIN_ONLY'})
})

test('compatible vector indexes do not rebuild; incompatible formats preserve old data and pause intent',async t=>{
  const root=await temp(t),b={root,key:'library',st:{kbId:'library'}},stateDir=path.join(root,'state'),text='# Evidence\n蓝鲸编号 UPGRADE-991。'
  let apiCalls=0
  const service=createRetrieval({stateDir,binding:async()=>b,versionOf:()=>1,visible:()=>true,verifyDocument:async()=>true,
    loadDocuments:async()=>({documents:[{path:'a.md',title:'Evidence',text,revision:digest(text),tags:[]}],names:[],nameOnly:0,errors:[]}),
    credentials:{read:async()=>({})},fetcher:async(_url,args)=>{apiCalls++;const body=JSON.parse(args.body);return Response.json({data:body.input.map((_,index)=>({index,embedding:[1,0]}))})}})
  t.after(()=>service.dispose())
  const config=initialRetrievalConfig();config.enabled=true;config.embedding.endpoint='http://127.0.0.1/mock'
  await service.dispatch(b,{op:'retrieval.save',config})
  for(let i=0;i<100;i++){if((await service.dispatch(b,{op:'retrieval.get'})).progress.state==='synced')break;await new Promise(r=>setTimeout(r,5))}
  const before=apiCalls,compatible=await service.reconcile(b);assert.equal(compatible.requiresBuild,false);assert.equal(apiCalls,before)
  await service.dispatch(b,{op:'retrieval.pause'})
  const manifestFile=path.join(root,'索引层',compatible.activeGeneration,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));manifest.format=99
  await writeFile(manifestFile,JSON.stringify(manifest))
  const next=await service.reconcile(b);assert.equal(next.compatible,false);assert.equal(next.state,'paused');assert.notEqual(next.modelFingerprint,compatible.modelFingerprint)
  assert.equal(JSON.parse(await readFile(manifestFile,'utf8')).format,99);assert.equal(apiCalls,before)
  const found=await service.search(b,{query:'UPGRADE-991',retrievalMode:'fulltext'});assert(found.items[0].text.includes('UPGRADE-991'))
})
