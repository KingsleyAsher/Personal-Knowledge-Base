import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { structureDocument, embeddingText, bytes, expandRange, hash } from '../src/host/retrieval-chunks.js'
import { createRetrievalAPI, validateConfig, initialRetrievalConfig } from '../src/host/retrieval-api.js'
import { createRetrieval } from '../src/host/retrieval.js'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'

test('long multilingual source: coverage, UTF-8 bounds, structure hints and contextual evidence', () => {
  const text='---\ntitle: specimen\n---\n# Long chapter\n\n'+('前提说明 العربية русский 日本語 emoji🧬。\n\n'.repeat(100))+
    '| Key | Meaning |\n| --- | --- |\n'+Array.from({length:130},(_,i)=>`| ${i} | Meaning 内容🦈 ${'value '.repeat(10)} |\n`).join('')+
    '\n## Code\n```js\n'+('// source\n# not a heading\n'.repeat(140))+'```\n\n## Answer\n前文条件成立。答案是深海蓝鲸。\n'
  const d=structureDocument(text,'specimen')
  assert(d.chunks.length>10)
  const covered=new Uint8Array(text.length)
  for(const c of d.chunks){assert(bytes(embeddingText(text,c))<=3200);assert(!text.slice(c.start,c.end).includes('\uFFFD'));for(let i=c.start;i<c.end;i++)covered[i]=1}
  for(let i=d.frontmatterEnd;i<text.length;i++)if(text[i].trim())assert(covered[i],`uncovered offset ${i}`)
  assert(!d.sections.some(s=>s.title==='not a heading'))
  assert(d.chunks.filter(c=>c.kind==='table'&&c.continued).every(c=>embeddingText(text,c).includes('| Key | Meaning |')))
  const hit=d.chunks.find(c=>text.slice(c.start,c.end).includes('答案是深海蓝鲸'))
  const expanded=expandRange(text,hit)
  assert(expanded.text.includes('前文条件成立'));assert.equal(expanded.text,text.slice(expanded.start,expanded.end))
  assert(bytes(expanded.text)<=12*1024)
})

test('generic embedding reorders response, rejects bad vectors and supports Qwen instructions', async()=>{
  const config=validateConfig({...initialRetrievalConfig(),enabled:true,embedding:{endpoint:'http://127.0.0.1/embeddings',model:'Qwen/Qwen3-Embedding-0.6B'}})
  let sent
  const api=createRetrievalAPI({credentials:{read:async()=>({})},fetcher:async(_url,args)=>{sent=JSON.parse(args.body);return Response.json({data:[{index:1,embedding:[0,2]},{index:0,embedding:[3,0]}]})}})
  const result=await api.embed(config.embedding,['one','two'],'query')
  assert.deepEqual(Array.from(result[0]),[1,0]);assert(sent.input[0].startsWith('Instruct:'))
  const invalid=createRetrievalAPI({credentials:{read:async()=>({})},fetcher:async()=>Response.json({data:[{index:0,embedding:[0,0]}]})})
  await assert.rejects(invalid.embed(config.embedding,['x']),{code:'API_VECTOR'})
})

test('automatic API build, cross-language retrieval, one-round cooperation, reuse, rerank fallback and model isolation',async t=>{
  const stateDir=await mkdtemp(path.join(os.tmpdir(),'retrieval-')), b={key:'sample',st:{kbId:'kb'},root:stateDir}
  const docs=[{path:'chapter.md',title:'医学资料',text:'# 循环系统\n\n心脏推动血液循环。\n',private:false},{path:'ocean.md',title:'Ocean',text:'# Ocean\n\nDolphins live in water.',private:false},{path:'private.md',title:'Secret',text:'私密心脏资料',private:true}].map(d=>({...d,revision:hash(d.text),tags:[]}))
  let calls=0, failRerank=false, version='1'
  const secrets=new Map(), credentials={save:async v=>{const id='key-'+secrets.size;secrets.set(id,v);return id},read:async id=>secrets.get(id)||{}}
  const service=createRetrieval({stateDir,binding:async()=>b,versionOf:()=>version,visible:(_b,p,question,include)=>p!=='private.md'||include,
    loadDocuments:async()=>({documents:docs,names:[],nameOnly:0,errors:[]}),credentials,
    fetcher:async(url,args)=>{const body=JSON.parse(args.body)
      if(url.endsWith('/rerank')) {if(failRerank)return new Response('',{status:503});return Response.json({results:body.documents.map((_,index)=>({index,relevance_score:1/(index+1)}))})}
      calls+=body.input.length
      return Response.json({data:body.input.map((text,index)=>({index,embedding:/heart|心脏/i.test(text)?[1,0]:[0,1]})).reverse()})
    }})
  t.after(()=>service.dispose())
  const config=initialRetrievalConfig();config.enabled=true;config.embedding.endpoint='http://127.0.0.1/embeddings'
  await service.dispatch(b,{op:'retrieval.save',config,embeddingApiKey:'secret'})
  async function finish(){for(let i=0;i<100;i++){const s=await service.dispatch(b,{op:'retrieval.get'});if(['synced','partial','failed','paused'].includes(s.progress.state))return s;await new Promise(r=>setTimeout(r,10))};throw Error('build did not finish')}
  const ready=await finish();assert.equal(ready.progress.state,'synced');assert.equal(ready.estimate.completedVectors,3)
  assert(!JSON.stringify(ready.config).includes('"secret"'));assert(ready.config.embedding.credentialRef)
  const found=await service.search(b,{query:'heart pump',limit:5,question:true})
  assert(found.retrievalDisclosure.footer.includes('向量检索'));assert(found.retrievalDisclosure.footer.includes('RRF'));assert(found.retrievalDisclosure.footer.includes('全文检索'));
  assert.equal(found.items[0].path,'chapter.md');assert.equal(found.crossRounds,1);assert(!JSON.stringify(found).includes('private.md'))
  assert(found.items[0].channels.includes('semantic'));assert(found.items[0].text.includes('心脏'))
  const before=calls;await service.dispatch(b,{op:'retrieval.resume'});await finish();assert.equal(calls,before)
  const newer=(await service.dispatch(b,{op:'retrieval.get'})).config
  newer.rerank={enabled:true,endpoint:'http://127.0.0.1/rerank',model:'custom-ranking',timeoutMs:4000}
  await service.dispatch(b,{op:'retrieval.save',config:newer});await finish();failRerank=true
  const fallback=await service.search(b,{query:'heart pump'});assert(fallback.items.length);assert(fallback.warning.includes('重排序'))
  const withoutPrivate=(await service.dispatch(b,{op:'retrieval.get'})).config;withoutPrivate.allowPrivateCloud=false;withoutPrivate.rerank.enabled=false
  await service.dispatch(b,{op:'retrieval.save',config:withoutPrivate});await finish()
  const stats=await service.dispatch(b,{op:'retrieval.get'});assert.equal(stats.estimate.uniqueVectorInputs,2)
  await assert.rejects(service.dispatch(b,{op:'retrieval.save',config},'model-session'),{code:'ADMIN_ONLY'})
  const previous=stats.estimate.activeModel
  const changed=structuredClone(stats.config);changed.embedding.model='other-embedding'
  await service.dispatch(b,{op:'retrieval.save',config:changed});const switched=await finish()
  assert.equal(switched.progress.state,'synced',JSON.stringify(switched.progress))
  assert.notEqual((await service.dispatch(b,{op:'retrieval.get'})).estimate.activeModel,previous)
})

test('workbench integration covers drafts and inbox, enforces privacy, and supplies verifiable question ranges',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'retrieval-wb-')), root=path.join(base,'library'),stateDir=path.join(base,'state');await mkdir(root)
  const core=createCore({stateDir},()=>{});assert.equal((await core.bind(root,{confirmInit:true})).ok,true)
  await mkdir(path.join(root,'50-底稿'),{recursive:true});await mkdir(path.join(root,'90-收件箱'),{recursive:true})
  await writeFile(path.join(root,'50-底稿','draft.md'),'# Evidence\n\n前提为干燥环境。\n\n蓝鲸编号ZX-991。')
  await writeFile(path.join(root,'90-收件箱','source.txt'),'Original blue whale record ZX-991.')
  await writeFile(path.join(root,'00-画像','secret.md'),'私密蓝鲸ZX-991。')
  const wb=createWorkbench({stateDir,getCore:()=>core});t.after(()=>wb.dispose())
  const result=await wb.dispatch({op:'search.list',mode:'hybrid',q:'ZX-991'})
  assert(result.items.some(f=>f.path.startsWith('50-底稿')));assert(result.items.some(f=>f.path.startsWith('90-收件箱')));assert(!JSON.stringify(result).includes('secret.md'))
  const policy=await wb.dispatch({op:'preferences.get'}),q=await wb.dispatch({op:'question.create',sessionId:'session',policyVersion:policy.version},'session')
  const found=await wb.dispatch({op:'question.search',questionId:q.questionId,query:'ZX-991'},'session')
  assert(found.sources.some(s=>s.text.includes('前提为干燥环境')))
  assert(found.retrievalDisclosure.footer.includes('全文检索'));assert(!found.retrievalDisclosure.footer.includes('向量检索'))
  const answer=found.sources.map(s=>s.citation).join('\n'), checked=await wb.dispatch({op:'question.validate',questionId:q.questionId,answer,returnAnswer:true},'session');assert(checked.answerWithRetrievalFooter.includes('本次知识库检索过程'))
  assert.equal(checked.invalid.length,0);assert(checked.valid.length)
})

test('retrieval process preference defaults on and disables answer disclosure without changing retrieval',async t=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'kb-disclosure-')),root=path.join(base,'library'),stateDir=path.join(base,'state');await mkdir(root)
 const core=createCore({stateDir},()=>{});await core.bind(root,{confirmInit:true});await writeFile(path.join(root,'sample.md'),'# Evidence\n蓝鲸编号 DISC-1')
 const wb=createWorkbench({stateDir,getCore:()=>core});t.after(()=>wb.dispose())
 let p=await wb.dispatch({op:'preferences.get'});assert.equal(p.preferences.showRetrievalProcess,true)
 let q=await wb.dispatch({op:'question.create',sessionId:'test',policyVersion:p.version},'test')
 const notSearched=await wb.dispatch({op:'question.validate',questionId:q.questionId,answer:'普通回答',returnAnswer:true},'test');assert.equal(notSearched.retrievalDisclosure,null);assert.equal(notSearched.answerWithRetrievalFooter,'普通回答')
 await wb.dispatch({op:'preferences.save',expectedKbId:p.kbId,expectedRevision:p.revision,preferences:{...p.preferences,showRetrievalProcess:false}})
 p=await wb.dispatch({op:'preferences.get'});assert.equal(p.preferences.showRetrievalProcess,false)
 q=await wb.dispatch({op:'question.create',sessionId:'test',policyVersion:p.version},'test')
 const found=await wb.dispatch({op:'question.search',questionId:q.questionId,query:'DISC-1'},'test');assert(found.sources.length);assert.equal(found.retrievalDisclosure,null)
 const checked=await wb.dispatch({op:'question.validate',questionId:q.questionId,answer:found.sources[0].citation,returnAnswer:true},'test');assert.equal(checked.retrievalDisclosure,null);assert(!checked.answerWithRetrievalFooter.includes('本次知识库检索过程'))
})
