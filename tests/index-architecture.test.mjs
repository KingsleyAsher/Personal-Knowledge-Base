import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,rename,unlink,symlink} from 'node:fs/promises'
import {createCore} from '../packages/kb-core/src/kbcore.js'
import {createWorkbench} from '../packages/kb-core/src/workbench.js'
import {CATALOG_PATH} from '../packages/kb-core/src/file-catalog.js'
import {sourceReferenceBody} from '../packages/kb-core/src/source-references.js'
import {planImport,runImport} from '../packages/kb-core/src/importer.js'
import {connectRuntime} from '../packages/kb-service/runtime.js'
import {connectService} from '../packages/kb-service/client.js'

async function fixture(t){
 const base=await mkdtemp(path.join(os.tmpdir(),'kb-original-architecture-')),root=path.join(base,'library'),stateDir=path.join(base,'state');await mkdir(root)
 const core=createCore({stateDir});assert.equal((await core.bind(root,{confirmInit:true})).ok,true)
 const kbId=(await core.status()).kbId,wb=createWorkbench({stateDir,getCore:()=>core,authorizeDocument:async()=>true})
 const call=op=>wb.dispatch({expectedKbId:kbId,...op})
 t.after(async()=>{wb.dispose();await rm(base,{recursive:true,force:true})})
 return {base,root,stateDir,core,wb,kbId,call,async migrate(){const p=(await call({op:'architecture.preview'})).architecture;return call({op:'architecture.apply',confirm:true,planId:p.planId,revision:p.revision})}}
}
test('migration previews without writes and indexes original text, code and binary identities without changing source bytes',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.root,'课程'));const originals={'课程/笔记.txt':'SOURCE_OLD_REAL\n','课程/example.py':'print("CODE_REAL_777")\n','课程/课件.pdf':'%PDF-synthetic fixture','课程/摘要.md':'---\ntitle: 独立笔记\nsource: 课程/笔记.txt\n---\nUSER_SUMMARY_777'}
 for(const [p,text]of Object.entries(originals))await writeFile(path.join(f.root,p),text)
 const ref=await f.core.createEntry({title:'旧引用',content:sourceReferenceBody('课程/笔记.txt'),source:'课程/笔记.txt',requestId:'capture-synthetic-reference'})
 const referenceBytes=await readFile(path.join(f.root,ref.path)),before=await readdir(f.root)
 const p=(await f.call({op:'architecture.preview'})).architecture
 assert.equal(p.coverage.originals,4);assert.equal(p.coverage.references,1);assert.deepEqual(await readdir(f.root),before)
 assert(!p.files.some(x=>x.path===ref.path));assert(p.files.some(x=>x.path==='课程/摘要.md'))
 assert.equal(p.files.find(x=>x.path==='课程/笔记.txt').category,'知识笔记','inherit a readable classification from the old reference, not the archive folder')
 const r=await f.call({op:'architecture.apply',confirm:true,planId:p.planId,revision:p.revision});assert.equal(r.architecture.phase,'completed',JSON.stringify(r))
 for(const [p,text]of Object.entries(originals))assert.equal(await readFile(path.join(f.root,p),'utf8'),text)
 assert.deepEqual(await readFile(path.join(f.root,ref.path)),referenceBytes)
 const catalog=JSON.parse(await readFile(path.join(f.root,CATALOG_PATH),'utf8'));assert(!JSON.stringify(catalog).includes('SOURCE_OLD_REAL'))
 assert((await readFile(path.join(f.root,'索引层/全文/entries.json'),'utf8')).includes('SOURCE_OLD_REAL'))
 assert.equal((await f.core.search({query:'SOURCE_OLD_REAL'})).hits[0].path,'课程/笔记.txt')
 assert.equal((await f.core.search({query:'CODE_REAL_777'})).hits[0].path,'课程/example.py')
 const search=await f.call({op:'search.list',q:'SOURCE_OLD_REAL',mode:'fulltext',fresh:true});assert.equal(search.items[0].path,'课程/笔记.txt')
 await f.call({op:'architecture.classify',path:'课程/笔记.txt',category:'数学/分析',kind:'项目',tags:['课堂'],revision:catalog.revision})
 const snap=await f.call({op:'atlas.list'});assert.equal(snap.items.find(x=>x.path==='课程/笔记.txt').kind,'项目');assert(!snap.items.some(x=>x.path===ref.path))
 assert.equal(await readFile(path.join(f.root,'课程/笔记.txt'),'utf8'),originals['课程/笔记.txt'])
})
test('changed, renamed and missing files update catalog and source search, retaining manual classification',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'原件.txt'),'BEFORE_333');await writeFile(path.join(f.root,'other.md'),'OTHER_888');await f.migrate()
 await f.call({op:'architecture.classify',path:'原件.txt',category:'自定义分类',tags:['手工']})
 const original=(await f.call({op:'architecture.files'})).architecture.files.find(f=>f.path==='原件.txt')
 await writeFile(path.join(f.root,'原件.txt'),'AFTER_444');assert.equal((await f.core.maintainIndex()).ok,true)
 assert.equal((await f.core.search({query:'BEFORE_333'})).hits.length,0);assert.equal((await f.core.search({query:'AFTER_444'})).hits[0].path,'原件.txt')
 await rename(path.join(f.root,'原件.txt'),path.join(f.root,'已改名.txt'));assert.equal((await f.core.maintainIndex()).ok,true)
 const renamed=(await f.call({op:'architecture.files'})).architecture.files.find(f=>f.path==='已改名.txt');assert.equal(renamed.id,original.id);assert.equal(renamed.category,'自定义分类')
 await unlink(path.join(f.root,'已改名.txt'));assert.equal((await f.core.maintainIndex()).ok,true)
 assert.equal((await f.call({op:'architecture.files'})).architecture.files.find(f=>f.id===original.id).status,'missing')
 assert.equal((await f.core.search({query:'AFTER_444'})).hits.length,0)
})

test('classification repair backs up old labels, preserves manual edits, groups topics and separates processing artifacts',async t=>{
 const f=await fixture(t),paths=['90-收件箱/原件归档/2026-11-06/数学分析.pdf','90-收件箱/原件归档/2026-11-06/高等代数.m4a','50-底稿/数学分析-OCR/page001.json','手工.md']
 for(const p of paths){await mkdir(path.dirname(path.join(f.root,p)),{recursive:true});await writeFile(path.join(f.root,p),'unchanged-original')};await f.migrate()
 await f.call({op:'architecture.classify',path:'手工.md',category:'我的收藏/随笔'})
 const catalogFile=path.join(f.root,CATALOG_PATH),old=JSON.parse(await readFile(catalogFile,'utf8'));delete old.classificationVersion
 for(const row of old.files){delete row.presentationRole;if(!row.manual)row.category=path.posix.dirname(row.path)}
 await writeFile(catalogFile,JSON.stringify(old));const receipt=await f.call({op:'architecture.reclassify'})
 assert(receipt.classification.changed>=3);assert.equal(receipt.classification.manualPreserved,1)
 assert.deepEqual(JSON.parse(await readFile(path.join(f.root,receipt.classification.backup),'utf8')),old)
 for(const p of paths)assert.equal(await readFile(path.join(f.root,p),'utf8'),'unchanged-original')
 const root=(await f.call({op:'architecture.categories',hierarchical:true,parent:''})).architecture
 assert.equal(root.categories.find(c=>c.label==='学习与课程').count,2);assert(!root.categories.some(c=>/原件归档|底稿|收件箱/.test(c.label)))
 const subjects=(await f.call({op:'architecture.categories',hierarchical:true,parent:'学习与课程'})).architecture
 assert.deepEqual(subjects.categories.map(c=>c.label).sort(),['数学分析','高等代数'].sort())
 const originals=(await f.call({op:'architecture.files'})).architecture;assert.equal(originals.total,3);assert.equal(originals.files.find(f=>f.path==='手工.md').category,'我的收藏/随笔')
 const auxiliary=(await f.call({op:'architecture.files',includeAuxiliary:true,auxiliaryOnly:true})).architecture;assert.equal(auxiliary.total,1)
 assert.equal((await f.call({op:'architecture.reclassify'})).classification.changed,0,'repair is idempotent')
})
test('missing original, source changes after preview, wrong identity and linked paths stop activation',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'原件.md'),'PREVIEW_777');let p=(await f.call({op:'architecture.preview'})).architecture
 await assert.rejects(f.call({op:'architecture.apply',planId:p.planId,revision:p.revision}),{code:'CONFIRM_REQUIRED'})
 await writeFile(path.join(f.root,'原件.md'),'CHANGED_999');await assert.rejects(f.call({op:'architecture.apply',planId:p.planId,revision:p.revision,confirm:true}),{code:'FILE_CHANGED'})
 await assert.rejects(f.call({op:'architecture.preview',expectedKbId:'wrong'}),{code:'BINDING_CHANGED'})
 const ref=await f.core.createEntry({title:'missing',source:'不存在.pdf',content:sourceReferenceBody('不存在.pdf')})
 await assert.rejects(f.call({op:'architecture.preview'}),{code:'SOURCE_MISSING'});await unlink(path.join(f.root,ref.path))
 const outside=path.join(f.base,'outside');await mkdir(outside);await symlink(outside,path.join(f.root,'linked'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(f.call({op:'architecture.preview'}),{code:'SCAN_INCOMPLETE'})
})

test('automatic catalog refresh saves raw old classifications before upgrading them',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'数学分析.txt'),'original');await f.migrate()
 const file=path.join(f.root,CATALOG_PATH),old=JSON.parse(await readFile(file,'utf8'));delete old.classificationVersion
 old.files[0].category='90-收件箱/原件归档/2026-11-06';delete old.files[0].presentationRole;await writeFile(file,JSON.stringify(old))
 assert.equal((await f.core.maintainIndex()).ok,true)
 const backups=await readdir(path.join(f.root,'索引层/分类历史'));assert.equal(backups.length,1)
 assert.deepEqual(JSON.parse(await readFile(path.join(f.root,'索引层/分类历史',backups[0]),'utf8')),old)
 const next=JSON.parse(await readFile(file,'utf8'));assert.equal(next.files[0].category,'学习与课程/数学分析');assert.equal(next.policyRevision,old.policyRevision+1)
})
test('active imports register originals without category mirrors; automatic upgrades do not recreate templates',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'接入.txt'),'IMPORTED_REAL_477');await f.migrate()
 const p=await planImport({stateDir:f.stateDir,source:f.root,target:f.root,mode:'attach'}),r=await runImport({core:f.core,stateDir:f.stateDir,importId:p.importId});assert.equal(r.ok,true,JSON.stringify(r))
 const item=r.manifest.items.find(x=>x.rel==='接入.txt');assert.equal(item.entryPath,'接入.txt');assert.equal(await readFile(path.join(f.root,'接入.txt'),'utf8'),'IMPORTED_REAL_477')
 await rm(path.join(f.root,'_模板'),{recursive:true});await f.call({op:'upgrade.check'});await assert.rejects(readdir(path.join(f.root,'_模板')),{code:'ENOENT'})
})
test('index publication failure reports pending and preserves originals; active initialization does not add business directories',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'real.txt'),'FAILURE_ORIGINAL_522');await mkdir(path.join(f.root,'索引层'));await writeFile(path.join(f.root,'索引层/全文'),'synthetic collision')
 const result=await f.migrate();assert.equal(result.architecture.phase,'index-pending');assert.equal(await readFile(path.join(f.root,'real.txt'),'utf8'),'FAILURE_ORIGINAL_522')
 await unlink(path.join(f.root,'索引层/全文'));assert.equal((await f.call({op:'architecture.refresh'})).architecture.phase,'completed')
 for(const name of ['00-画像','10-项目','20-知识笔记','30-人物关系','40-素材资源','_模板'])await rm(path.join(f.root,name),{recursive:true,force:true})
 assert.equal((await f.core.init()).ok,true);assert(!(await readdir(f.root)).includes('20-知识笔记'));assert(!(await readdir(f.root)).includes('_模板'))
 await f.call({op:'architecture.classify',path:'real.txt',kind:'画像'});assert(!(await f.call({op:'architecture.files'})).architecture.files.some(f=>f.path==='real.txt'))
 await assert.rejects(f.call({op:'atlas.detail',path:'real.txt'}),{code:'PRIVATE_HIDDEN'})
})
test('independent plugin and desktop service connections share migration and classification; non-admin cannot migrate', {skip:process.platform!=='win32',timeout:30000},async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'real.txt'),'SHARED_ORIGINAL_111');f.wb.dispose()
 await writeFile(path.join(f.root,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
 const runtime=await connectRuntime({library:f.root,home:path.join(f.base,'services'),python:'python',kind:'dsh-adapter',candidateRoot:f.base});let desktop,reader
 try{
  const plugin=runtime.client,ready=JSON.parse(await readFile(path.join(runtime.privateDir,'ready.json'),'utf8'))
  desktop=await connectService({pipe:ready.pipe,python:'python',credentialFile:path.join(runtime.privateDir,'bootstrap.dpapi.json'),kind:'desktop'})
  await desktop.call('events.subscribe')
  const grant=await plugin.call('connection.grant',{label:'nonadmin',access:['read','write'],expiresAt:Date.now()+60000});reader=await connectService({pipe:ready.pipe,python:'python',credential:grant.credential,kind:'desktop'})
  const ui=(client,op,write=false)=>client.call(write?'workspace.write':'workspace.read',{operation:{expectedKbId:f.kbId,...op}})
  await assert.rejects(ui(reader,{op:'architecture.preview',admin:true}),{code:'FORBIDDEN'})
  const p=(await ui(desktop,{op:'architecture.preview'})).architecture
  assert.equal((await ui(desktop,{op:'architecture.apply',planId:p.planId,revision:p.revision,confirm:true},true)).architecture.phase,'completed')
  assert.equal((await ui(plugin,{op:'architecture.status'})).architecture.active,true)
  await ui(plugin,{op:'architecture.classify',path:'real.txt',category:'同库分类'},true)
  assert.equal((await desktop.call('desktop.stat',{path:'real.txt'})).category,'同库分类')
  assert.equal((await ui(desktop,{op:'architecture.categories'})).architecture.categories.find(c=>c.category==='同库分类').count,1)
  assert((await reader.call('service.health')).active,'a non-subscribed client refreshes a rejected stale policy once')
  await assert.rejects(reader.call('service.health',{}, {policyVersion:'explicit-stale-policy'}),{code:'POLICY_CHANGED'})
  assert.equal((await ui(desktop,{op:'architecture.files'})).architecture.files.find(f=>f.path==='real.txt').category,'同库分类')
  await runtime.close();assert.equal((await ui(desktop,{op:'architecture.status'})).architecture.active,true)
  await ui(desktop,{op:'architecture.classify',path:'real.txt',category:'客户端独立分类'},true)
  const pluginOnly=await connectService({pipe:ready.pipe,python:'python',credentialFile:path.join(runtime.privateDir,'bootstrap.dpapi.json'),kind:'dsh-adapter'})
  desktop.close();desktop=null;assert.equal((await ui(pluginOnly,{op:'architecture.files'})).architecture.files.find(f=>f.path==='real.txt').category,'客户端独立分类')
  reader.close();reader=null
  try{for(let i=0;i<20&&(await pluginOnly.call('service.health')).connections>1;i++)await new Promise(r=>setTimeout(r,50));await pluginOnly.call('service.prepareUpgrade')}finally{pluginOnly.close()}
 }finally{reader?.close();desktop?.close();await runtime.close()}
})

test('large-library migration and classification stay within frame budget and enumerate all originals over the real service', {skip:process.platform!=='win32',timeout:90000},async t=>{
 const f=await fixture(t),tags=Array.from({length:32},(_,i)=>String(i).padEnd(100,'大')),paths=Array.from({length:360},(_,i)=>`课程/原件-${String(i).padStart(4,'0')}.md`)
 await mkdir(path.join(f.root,'课程'));await Promise.all(paths.map(p=>writeFile(path.join(f.root,p),'---\ntitle: '+('课'.repeat(512))+'\ntags: '+JSON.stringify(tags)+'\n---\nFRAME_BUDGET_ORIGINAL')))
 f.wb.dispose();await writeFile(path.join(f.root,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
 const runtime=await connectRuntime({library:f.root,home:path.join(f.base,'services'),python:'python',kind:'dsh-adapter',candidateRoot:f.base})
 const client=runtime.client,ui=op=>client.call('workspace.read',{operation:{expectedKbId:f.kbId,...op}})
 try{
  const preview=(await ui({op:'architecture.preview'})).architecture
  assert.equal(preview.total,360);assert(preview.files.length<360);assert(Buffer.byteLength(JSON.stringify(preview))<256*1024)
  const collect=async(op,extra,first)=>{const out=[...first.files];let page=first;while(page.nextOffset!==undefined){page=(await ui({op,...extra,offset:page.nextOffset})).architecture;assert(Buffer.byteLength(JSON.stringify(page))<256*1024);out.push(...page.files)}return out}
  assert.deepEqual((await collect('architecture.preview-files',{planId:preview.planId},preview)).map(f=>f.path),paths)
  const activated=await client.call('workspace.write',{operation:{op:'architecture.apply',expectedKbId:f.kbId,planId:preview.planId,revision:preview.revision,confirm:true}});assert.equal(activated.architecture.phase,'completed')
  const first=(await ui({op:'architecture.files'})).architecture,all=await collect('architecture.files',{catalogRevision:first.revision},first)
  assert.equal(all.length,360);assert(Buffer.byteLength(JSON.stringify(all))>1024*1024,'counterexample must exceed the old one-frame budget')
  assert.deepEqual((await ui({op:'architecture.categories'})).architecture.categories,[{category:'课程',count:360}])
  const filtered=(await ui({op:'architecture.files',q:'原件-0359'})).architecture;assert.equal(filtered.total,1);assert.equal(filtered.files[0].path,paths.at(-1))
  assert.equal((await client.call('desktop.stat',{path:paths.at(-1)})).category,'课程')
 }finally{try{await client.call('service.prepareUpgrade')}finally{await runtime.close()}}
})
