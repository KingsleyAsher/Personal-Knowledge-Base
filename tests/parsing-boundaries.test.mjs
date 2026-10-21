import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,symlink,rename,readdir,copyFile} from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import {createParsingService} from '../src/host/parsing.js'
import {createCore} from '../src/host/kbcore.js'
const root=await mkdtemp(path.resolve('..','boundary-qa-')),admin={viaAdmin:true}
const python=execFileSync('python',['-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true}).trim()
const wait=async(s,id,binding)=>{for(let i=0;i<500;i++){const j=await s.readJob(id,binding);if(j&&['succeeded','partial','failed','canceled'].includes(j.status))return j;await new Promise(r=>setTimeout(r,10))}throw Error('job timeout')}
const until=async(fn)=>{for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('condition timeout')}
async function fixture(extra={}){
  const dir=await mkdtemp(path.join(root,'case-')),a={kbId:'A',kbPath:path.join(dir,'A')},b={kbId:'B',kbPath:path.join(dir,'B')}
  await mkdir(a.kbPath);await mkdir(b.kbPath)
  let binding=a,config={followLinks:false,parsing:{externalPolicy:'allow-configured',providers:[]}}
  const deps={stateDir:path.join(dir,'state'),getBinding:async()=>binding,getCore:()=>({getConfig:async()=>config,setConfig:async p=>{config={...config,...p};return{ok:true,revision:1}}}),credentialStore:{configured:async()=>true,read:async()=>({apiKey:'synthetic',secretKey:'synthetic'})},...extra}
  return{dir,a,b,s:createParsingService(deps),bind:v=>binding=v,links:v=>config.followLinks=v}
}
const baidu=async(s,extra={})=>{const p=await s.saveProvider({kind:'ocr',vendor:'baidu',credentialRef:'SYNTHETIC',renderCommand:python,...extra},admin);assert.equal(p.ok,true);return p.provider}
async function pdf(file){execFileSync(python,['-X','utf8','-c','import pymupdf,sys;d=pymupdf.open();d.new_page();d.new_page();d.save(sys.argv[1])',file],{windowsHide:true})}
const tokenResponse={ok:true,json:{access_token:'synthetic',expires_in:3600}}

test('host tool provenance forces latest default despite remembered or forged provider IDs',async()=>{
  const f=await fixture({nativeRequest:async(p,url)=>url.includes('/token')?tokenResponse:{ok:true,json:{words_result:[{words:'synthetic text'}]}}})
  const first=await baidu(f.s,{id:'first'}),second=await baidu(f.s,{id:'second'})
  await writeFile(path.join(f.a.kbPath,'fixture.png'),'synthetic source')
  await f.s.setDefaults({kind:'ocr',id:first.id},admin)
  const remembered=await f.s.submit({kind:'ocr',sourceRel:'fixture.png',providerId:second.id,requestedBy:{via:'ui'},purpose:'user explicitly selected second'}, {requestedBy:{via:'tool'}})
  assert.equal(remembered.ok,true)
  let job=await wait(f.s,remembered.jobId,f.a)
  assert.equal(job.provider.id,first.id);assert.equal(job.provider.selectionSource,'settings-default')
  await f.s.setDefaults({kind:'ocr',id:second.id},admin)
  const next=await f.s.submit({kind:'ocr',sourceRel:'fixture.png',providerId:'deleted-old-id'}, {requestedBy:{via:'tool'}})
  assert.equal(next.ok,true);job=await wait(f.s,next.jobId,f.a)
  assert.equal(job.provider.id,second.id);assert.notEqual(next.jobId,remembered.jobId)
  assert.equal((await f.s.readJob(remembered.jobId,f.a)).provider.id,first.id)
  const explicit=await f.s.submit({kind:'ocr',sourceRel:'fixture.png',providerId:first.id},{requestedBy:{via:'ui'}})
  assert.equal((await f.s.readJob(explicit.jobId,f.a)).provider.id,first.id)
  const sample=await f.s.testParse({kind:'ocr',sourceRel:'fixture.png',providerId:first.id},{requestedBy:{via:'tool'}})
  assert.equal(sample.ok,true);assert.equal((await f.s.readJob(sample.jobId,f.a)).provider.id,second.id)
  assert.equal((await f.s.testParse({sourceRel:'fixture.png',providerId:first.id},{requestedBy:{via:'tool'}})).reason,'BAD_KIND')
  await f.s.deleteProvider(second.id,admin)
  const absent=await f.s.submit({kind:'ocr',sourceRel:'fixture.png',providerId:first.id},{requestedBy:{via:'tool'}})
  assert.equal(absent.ok,false)
})

test('normal source and explicitly allowed inside link work; outside and default links are blocked',async()=>{
  const bodies=[]
  const f=await fixture({nativeRequest:async(p,url,init)=>{if(url.includes('/token'))return tokenResponse;bodies.push(Buffer.from(new URLSearchParams(init.body).get('image'),'base64').toString());return{ok:true,json:{words_result:[{words:'synthetic recognized'}]}}}})
  const outside=path.join(f.dir,'outside'),inside=path.join(f.a.kbPath,'inside')
  await mkdir(outside);await mkdir(inside);await writeFile(path.join(inside,'fixture.png'),'inside original');await writeFile(path.join(outside,'fixture.png'),'outside forbidden')
  await symlink(inside,path.join(f.a.kbPath,'inside-link'),process.platform==='win32'?'junction':'dir')
  await symlink(outside,path.join(f.a.kbPath,'outside-link'),process.platform==='win32'?'junction':'dir')
  const p=await baidu(f.s)
  const normal=await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'inside/fixture.png'});assert.equal((await wait(f.s,normal.jobId,f.a)).status,'succeeded')
  assert.equal((await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'inside-link/fixture.png'})).reason,'SOURCE_ESCAPE')
  assert.equal((await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'outside-link/fixture.png'})).reason,'SOURCE_ESCAPE')
  f.links(true)
  const allowed=await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'inside-link/fixture.png'});assert.equal(allowed.ok,true)
  assert.equal((await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'outside-link/fixture.png'})).reason,'SOURCE_ESCAPE')
  assert.ok(bodies.length>0&&bodies.every(b=>b==='inside original'))
})

test('queued source replaced with outside junction is refused before its engine request',async()=>{
  let requests=0,release
  const pending=new Promise(r=>release=r)
  const server=http.createServer(async(req,res)=>{for await(const _ of req){}requests++;if(requests===1)await pending;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'synthetic result'}}]}))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{
    const f=await fixture(),incoming=path.join(f.a.kbPath,'incoming'),outside=path.join(f.dir,'outside')
    await mkdir(incoming);await mkdir(outside)
    await writeFile(path.join(f.a.kbPath,'first.png'),'first');await writeFile(path.join(incoming,'fixture.png'),'queued original');await writeFile(path.join(outside,'fixture.png'),'outside forbidden')
    const p=await f.s.saveProvider({kind:'ocr',protocol:'openai-vision',locality:'local',baseUrl:`http://127.0.0.1:${server.address().port}/v1`},admin)
    const first=await f.s.submit({kind:'ocr',providerId:p.provider.id,sourceRel:'first.png'});await until(()=>requests===1)
    const second=await f.s.submit({kind:'ocr',providerId:p.provider.id,sourceRel:'incoming/fixture.png'})
    await rename(incoming,incoming+'-original');await symlink(outside,incoming,process.platform==='win32'?'junction':'dir');release()
    assert.equal((await wait(f.s,first.jobId,f.a)).status,'succeeded')
    const denied=await wait(f.s,second.jobId,f.a);assert.equal(denied.status,'failed');assert.ok(denied.diagnostics.some(d=>d.code==='SOURCE_ESCAPE'));assert.equal(requests,1)
  }finally{release?.();await new Promise(r=>server.close(r))}
})

test('normal PDF completes; binding switch stops next page and every record stays in original task directory',async()=>{
  let calls=0,switchLibrary=false,f
  f=await fixture({nativeRequest:async(p,url)=>{if(url.includes('/token'))return tokenResponse;calls++;if(switchLibrary)f.bind(f.b);return{ok:true,json:{words_result:[{words:'synthetic page '+calls}]}}}})
  await pdf(path.join(f.a.kbPath,'fixture.pdf'));const p=await baidu(f.s)
  const normal=await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'fixture.pdf'});assert.equal((await wait(f.s,normal.jobId,f.a)).status,'succeeded');assert.equal(calls,2)
  await copyFile(path.join(f.a.kbPath,'fixture.pdf'),path.join(f.a.kbPath,'next.pdf'))
  await f.s.saveProvider({...p,notes:'changed configuration for new task'},admin)
  switchLibrary=true
  const active=await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'next.pdf'}),stopped=await wait(f.s,active.jobId,f.a)
  assert.equal(stopped.status,'failed');assert.ok(stopped.diagnostics.some(d=>d.code==='BINDING_CHANGED'));assert.equal(calls,3)
  assert.equal(stopped.result.pages.length,1);assert.ok(stopped.partial.failedUnits.length>0)
  assert.equal(await f.s.readJob(active.jobId),null)
  assert.deepEqual(await readdir(path.join(f.dir,'state/parse/B/jobs')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e)),[])
  f.bind(f.a);assert.equal((await f.s.readJob(active.jobId)).kbId,'A')
})

test('global cloud policy blocks later PDF pages and retains the first page',async()=>{
  let calls=0,f
  f=await fixture({nativeRequest:async(p,url)=>{if(url.includes('/token'))return tokenResponse;calls++;await f.s.setPolicy('local-only',admin);return{ok:true,json:{words_result:[{words:'synthetic first page'}]}}}})
  await pdf(path.join(f.a.kbPath,'fixture.pdf'));const p=await baidu(f.s),submitted=await f.s.submit({kind:'ocr',providerId:p.id,sourceRel:'fixture.pdf'}),j=await wait(f.s,submitted.jobId,f.a)
  assert.equal(calls,1);assert.equal(j.status,'failed');assert.ok(j.diagnostics.some(d=>d.code==='LOCAL_ONLY_BLOCKED'));assert.equal(j.result.pages.length,1);assert.equal(j.partial.failedUnits.length,1)
})

test('production HTTP guard rechecks global policy after DNS before opening connection',async()=>{
  let requests=0,lookups=0,f
  const server=http.createServer((_req,res)=>{requests++;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'must not be requested'}}]}))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  try{
    f=await fixture({lookup:async()=>{lookups++;if(lookups===2)await f.s.setPolicy('local-only',admin);return[{address:'127.0.0.1',family:4}]}})
    const p=await f.s.saveProvider({kind:'ocr',protocol:'openai-vision',locality:'cloud',baseUrl:`http://synthetic.test:${server.address().port}/v1`},admin)
    await writeFile(path.join(f.a.kbPath,'fixture.png'),'synthetic')
    const submitted=await f.s.submit({kind:'ocr',providerId:p.provider.id,sourceRel:'fixture.png'}),j=await wait(f.s,submitted.jobId,f.a)
    assert.equal(j.status,'failed');assert.ok(j.diagnostics.some(d=>d.code==='LOCAL_ONLY_BLOCKED'));assert.equal(requests,0)
  }finally{await new Promise(r=>server.close(r))}
})

test('cloud policy stops later audio chunks; reenabled manual retry reuses successful chunk',async()=>{
  let calls=0,f
  f=await fixture({nativeRequest:async()=>{calls++;if(calls===1)await f.s.setPolicy('local-only',admin);return{ok:true,json:{output:{choices:[{message:{content:[{text:'synthetic chunk '+calls}]}}]}}}}})
  const size=65*32000,buf=Buffer.alloc(44+size)
  buf.write('RIFF');buf.writeUInt32LE(size+36,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(16000,24);buf.writeUInt32LE(32000,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(size,40)
  await writeFile(path.join(f.a.kbPath,'fixture.wav'),buf)
  const p=await f.s.saveProvider({kind:'asr',vendor:'qwen',credentialRef:'SYNTHETIC'},admin),submitted=await f.s.submit({kind:'asr',providerId:p.provider.id,sourceRel:'fixture.wav'}),stopped=await wait(f.s,submitted.jobId,f.a)
  assert.equal(stopped.status,'failed');assert.equal(calls,1);assert.equal(stopped.chunkResults[0].ok,true)
  await f.s.setPolicy('allow-configured',admin);assert.equal((await f.s.retry(submitted.jobId)).ok,true)
  const retried=await wait(f.s,submitted.jobId,f.a);assert.equal(retried.status,'succeeded');assert.equal(retried.result.segments.length,2);assert.equal(calls,2)
})

test('index rules-only update clears warning; malformed old cache repairs through automatic path without changing source',async()=>{
  const dir=await mkdtemp(path.join(root,'index-')),library=path.join(dir,'library');await mkdir(library)
  const core=createCore({stateDir:path.join(dir,'state')},()=>{});await core.bind(library,{confirmInit:true})
  const file=path.join(library,'fixture.md'),original=Buffer.from('# Synthetic source')
  await writeFile(file,original);await core.maintainIndex();await core.setConfig({excludeFromSearch:['missing-directory']})
  assert.equal((await core.maintainIndex({automatic:true})).mode,'metadata');assert.equal((await core.indexFreshness()).fresh,true)
  const index=path.join(library,'.kbmeta/index/entries.json')
  for(const cache of [null,{}, {entries:[null,5,{}],meta:{format:1}}, {entries:'bad'}]){
    await writeFile(index,JSON.stringify(cache));assert.equal((await core.status()).index.fresh,false)
    const r=await core.maintainIndex({automatic:true});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.mode,'full');assert.equal((await core.indexFreshness()).fresh,true)
    assert.deepEqual(await readFile(file),original)
  }
})

test('landing create/update require matching binding while ordinary create/update remain usable',async()=>{
  const dir=await mkdtemp(path.join(root,'landing-')),library=path.join(dir,'library');await mkdir(library)
  const core=createCore({stateDir:path.join(dir,'state')},()=>{});await core.bind(library,{confirmInit:true});const st=await core.status(),expectedBinding={kbId:st.kbId,kbPath:library}
  const created=await core.createEntry({kind:'知识',title:'Synthetic landing',content:'Original synthetic',expectedBinding});assert.equal(created.ok,true)
  assert.equal((await core.updateEntry({entryId:created.entryId,expectedRevision:created.revision,content:'Updated',expectedBinding:{...expectedBinding,kbId:'other'}})).reason,'flow-binding-changed')
  const updated=await core.updateEntry({entryId:created.entryId,expectedRevision:created.revision,content:'Updated',expectedBinding});assert.equal(updated.ok,true)
  assert.equal((await core.createEntry({kind:'知识',title:'Wrong binding',content:'Do not write',expectedBinding:{...expectedBinding,kbId:'other'}})).reason,'flow-binding-changed')
})
