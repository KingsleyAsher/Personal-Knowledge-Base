
import test from 'node:test';import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {mkdir,mkdtemp,readFile,writeFile,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createFixture,requirementPath} from '../main/fixture.js';
import {startService} from '../../../packages/kb-service/service.js';
import {connectService} from '../../../packages/kb-service/client.js';
const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.resolve(appDir,'../..'),python=process.env.KB_DESKTOP_PYTHON??'python';
test('candidate shared service and file lifecycle',async()=>{
 const parent=path.join(appDir,'.test-runs');await mkdir(parent,{recursive:true});const run=await mkdtemp(path.join(parent,'service-')),sandbox=path.join(run,'candidate'),library=path.join(sandbox,'libraries','示例资料库');
 await createFixture(library,repo,path.join(appDir,'fixture-assets'));
 const privateDir=path.join(run,'service-private');let service,client,other,restored;
 const checks=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
 try{
  service=await startService({library,privateDir,python,desktopRoot:sandbox,idleMs:60000});
  client=await connectService({pipe:service.pipe,python,credentialFile:service.bootstrapFile});
  await client.call('migration.commit',{planId:'fresh',quiescent:true});
  const call=(m,a={},o)=>client.call(m,a,o);
  await check('one writer, capability-gated extension',async()=>{const s=await call('service.health');assert.equal(s.writers,1);assert(s.supported.includes('desktop.list'));});
  await check('mixed tree and private/internal filtering',async()=>{const root=await call('desktop.list');assert(root.items.some(f=>f.type==='directory'));assert(!root.items.some(f=>f.name==='00-画像'||f.name.startsWith('.')));const attachments=await call('desktop.list',{parent:'40-素材资源/附件'});assert(attachments.items.some(f=>f.name.endsWith('.xlsx')));assert(attachments.items.some(f=>f.name.endsWith('.png')));});
  await check('path traversal and private reads denied',async()=>{await assert.rejects(call('desktop.stat',{path:'../escape'}));await assert.rejects(call('desktop.preview',{path:'00-画像/仅用于拒绝访问测试.md'}),{code:'FORBIDDEN'});});
  await check('complete editor read and concurrent conflict',async()=>{const grant=await call('connection.grant',{label:'peer',access:['read','edit','write'],expiresAt:Date.now()+120000});other=await connectService({pipe:service.pipe,python,credential:grant.credential});const d=await call('document.readForEdit',{path:requirementPath});const outcomes=await Promise.allSettled([call('document.save',{path:requirementPath,expectedRevision:d.revision,text:d.text+'\nSYNTHETIC_SAVE_A\n'}),other.call('document.save',{path:requirementPath,expectedRevision:d.revision,text:d.text+'\nSYNTHETIC_SAVE_B\n'})]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'CONFLICT');});
  let created;
  await check('create plan, duplicate receipt and no clobber',async()=>{const plan=await call('desktop.plan',{operation:'create',destination:'10-项目/桌面客户端/新笔记.md'});const req=randomUUID(),args={planId:plan.id,text:'# 新笔记\nSYNTHETIC_NEW\n'};const a=await call('desktop.commit',args,{requestId:req}),b=await call('desktop.commit',args,{requestId:req});assert.deepEqual(a,b);assert.equal((await call('operation.status',{requestId:req})).state,'committed');await assert.rejects(call('desktop.plan',{operation:'create',destination:a.path}),{code:'CONFLICT'});created=a.path;});
  await check('move updates explicit references',async()=>{const f=await call('desktop.stat',{path:requirementPath}),plan=await call('desktop.plan',{operation:'move',path:requirementPath,destination:'10-项目/桌面客户端/需求更名.md',revision:f.revision});assert(plan.linkUpdates>=1);await call('desktop.commit',{planId:plan.id});const ref=(await call('document.readForEdit',{path:'10-项目/桌面客户端/交互记录.md'})).text;assert(ref.includes('需求更名'));assert(!ref.includes('需求梳理'));});
  await check('filename search sees excluded inbox, fulltext does not',async()=>{const named=await call('desktop.search',{query:'待整理',mode:'name'});assert(named.items.length);const full=await call('desktop.search',{query:'虚构待整理资料',mode:'fulltext'});assert.equal(full.items.length,0);});
  await check('move preserves inbox exclusion',async()=>{const p='90-收件箱/待整理.docx',f=await call('desktop.stat',{path:p}),plan=await call('desktop.plan',{operation:'move',path:p,destination:'40-素材资源/待整理.docx',revision:f.revision});await call('desktop.commit',{planId:plan.id});assert((await call('desktop.stat',{path:'40-素材资源/待整理.docx'})).access.indexExcluded);});
  await check('directory move preserves inbound and outgoing explicit links',async()=>{
   const src='20-知识笔记/目录移动';await mkdir(path.join(library,src));await writeFile(path.join(library,src,'内部.md'),'# 内部\n\n[阅读方法](../阅读方法.md)\n');await writeFile(path.join(library,'20-知识笔记/目录引用.md'),'[[20-知识笔记/目录移动/内部|引用]]\n\n[引用](目录移动/内部.md)\n');
   const f=await call('desktop.stat',{path:src}),p=await call('desktop.plan',{operation:'move',path:src,revision:f.revision,destination:'40-素材资源/目录移动'});assert(p.linkUpdates>=2);await call('desktop.commit',{planId:p.id});assert((await readFile(path.join(library,'20-知识笔记/目录引用.md'),'utf8')).includes('40-素材资源/目录移动/内部|引用'));assert(decodeURI(await readFile(path.join(library,'40-素材资源/目录移动/内部.md'),'utf8')).includes('../../20-知识笔记/阅读方法.md'));
  });
  await check('directory move refuses hidden descendants',async()=>{
   const src='20-知识笔记/不可整目录移动';await mkdir(path.join(library,src));await writeFile(path.join(library,src,'.hidden'),'SYNTHETIC_HIDDEN');const f=await call('desktop.stat',{path:src});await assert.rejects(call('desktop.plan',{operation:'move',path:src,revision:f.revision,destination:'40-素材资源/不可整目录移动'}),{code:'READ_ONLY'});assert.equal(await readFile(path.join(library,src,'.hidden'),'utf8'),'SYNTHETIC_HIDDEN');
  });
  await check('media handle chunk and caller binding',async()=>{const p=await call('desktop.preview',{path:'40-素材资源/附件/界面草图.png'});const chunk=await call('desktop.media',{handle:p.resourceHandle,offset:0,length:16});assert.equal(Buffer.from(chunk.data,'base64').subarray(1,4).toString(),'PNG');await assert.rejects(other.call('desktop.media',{handle:p.resourceHandle,offset:0,length:16}));other.close();other=null;});
  await check('Office edit originals survive source changes and are bound to the caller',async()=>{
   const p='40-素材资源/附件/调研数据.xlsx',before=await readFile(path.join(library,p)),preview=await call('desktop.preview',{path:p});assert.equal(preview.kind,'xlsx');
   const grant=await call('connection.grant',{label:'office-editor',access:['read','edit'],expiresAt:Date.now()+120000});const editor=await connectService({pipe:service.pipe,python,credential:grant.credential});
   try{await assert.rejects(editor.call('desktop.editOriginal',{path:p,originalKey:preview.originalKey}),{code:'FORBIDDEN'});}finally{editor.close();}
   await writeFile(path.join(library,p),Buffer.concat([before,Buffer.from([0])]));const original=await call('desktop.editOriginal',{path:p,originalKey:preview.originalKey});const part=await call('desktop.media',{handle:original.resourceHandle,offset:0,length:262144});assert.deepEqual(Buffer.from(part.data,'base64'),before);await writeFile(path.join(library,p),before);
  });
  await check('edit-only grant saves complete text with a durable receipt and stale replacement cannot overwrite',async()=>{
   const p='20-知识笔记/完整文本.txt';await writeFile(path.join(library,p),'original\r\n');const grant=await call('connection.grant',{label:'text-editor',access:['read','edit'],expiresAt:Date.now()+120000});const editor=await connectService({pipe:service.pipe,python,credential:grant.credential});
   try{const file=await editor.call('desktop.stat',{path:p}),stage=await editor.call('desktop.editStage',{name:'完整文本.txt',data:Buffer.from('\ufeff客户端更新\r\n').toString('base64'),final:true}),args={path:p,expectedRevision:file.revision,stageId:stage.stageId},requestId=randomUUID();const first=await editor.call('desktop.fileReplace',args,{requestId}),again=await editor.call('desktop.fileReplace',args,{requestId});assert.deepEqual(first,again);assert.equal(await readFile(path.join(library,p),'utf8'),'\ufeff客户端更新\r\n');await assert.rejects(editor.call('desktop.fileReplace',args),{code:'CONFLICT'});await assert.rejects(editor.call('desktop.importPlan',{stageId:stage.stageId,destination:'20-知识笔记/不可创建.txt'}),{code:'FORBIDDEN'});}finally{editor.close();}
  });
  await check('read-only and private replacement are denied; Markdown keeps its existing save protocol',async()=>{
   const grant=await call('connection.grant',{label:'reader',access:['read'],expiresAt:Date.now()+120000}),reader=await connectService({pipe:service.pipe,python,credential:grant.credential});try{await assert.rejects(reader.call('desktop.editStage',{name:'a.txt',data:'YQ==',final:true}),{code:'FORBIDDEN'});}finally{reader.close();}
   const stage=await call('desktop.editStage',{name:'a.txt',data:'YQ==',final:true});await assert.rejects(call('desktop.fileReplace',{path:'00-画像/仅用于拒绝访问测试.md',expectedRevision:'x',stageId:stage.stageId}),{code:'FORBIDDEN'});const f=await call('desktop.stat',{path:'20-知识笔记/阅读方法.md'});await assert.rejects(call('desktop.fileReplace',{path:f.path,expectedRevision:f.revision,stageId:stage.stageId}),{code:'READ_ONLY'});
  });
  await check('trash, collision refusal and original-byte restore',async()=>{const before=await readFile(path.join(library,created)),f=await call('desktop.stat',{path:created});const p=await call('desktop.plan',{operation:'trash',path:created,revision:f.revision});await call('desktop.commit',{planId:p.id});const item=(await call('desktop.trash')).items[0];await writeFile(path.join(library,created),'external');await assert.rejects(call('desktop.plan',{operation:'restore',path:item.id,destination:created}),{code:'CONFLICT'});const restore=await call('desktop.plan',{operation:'restore',path:item.id,destination:'20-知识笔记/恢复笔记.md'});await call('desktop.commit',{planId:restore.id});assert.deepEqual(await readFile(path.join(library,'20-知识笔记/恢复笔记.md')),before);});
  await check('backup and new-copy restoration with shared state',async()=>{
   const snapshot=await call('library.snapshot');await call('state.patch',{expectedRevision:snapshot.sharedStateRevision,domain:'reading',patch:[{op:'put',key:'20-知识笔记/恢复笔记.md',value:{status:'done',page:2}}]});
   const b=await call('desktop.backupCreate'),plan=await call('desktop.restorePreview',{backupId:b.id}),copy=await call('desktop.restoreCommit',{planId:plan.id});
   assert(copy.copyRoot.startsWith(sandbox));assert.deepEqual(await readFile(path.join(copy.copyRoot,'20-知识笔记/恢复笔记.md')),await readFile(path.join(library,'20-知识笔记/恢复笔记.md')));
   restored=await startService({library:copy.copyRoot,privateDir:path.join(run,'restored-private'),python,desktopRoot:sandbox,idleMs:60000});
   const c=await connectService({pipe:restored.pipe,python,credentialFile:restored.bootstrapFile});
   try{await c.call('migration.commit',{planId:'fresh',quiescent:true});await c.call('desktop.restoreState');const raw=JSON.parse(await readFile(path.join(copy.copyRoot,'.kbmeta/shared-state.json'),'utf8'));assert.equal(raw.reading['20-知识笔记/恢复笔记.md'].status,'done');}finally{c.close();}
  });
  await check('outside candidate rejected before ownership write',async()=>{await assert.rejects(startService({library,privateDir:path.join(run,'blocked-private'),python,desktopRoot:path.join(run,'service-private')}),{code:'FORBIDDEN'});});
  await writeFile(path.join(run,'result.json'),JSON.stringify({status:'passed',checks,syntheticOnly:true},null,2));
  console.log('EVIDENCE '+path.join(run,'result.json'));
 }finally{other?.close();client?.close();await restored?.close();await service?.close();}
});

