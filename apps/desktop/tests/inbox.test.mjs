import test from 'node:test';import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import vm from 'node:vm';
import {createFixture} from '../main/fixture.js';import {startService} from '../../../packages/kb-service/service.js';import {connectService} from '../../../packages/kb-service/client.js';import {createInboxJobs} from '../../../packages/kb-service/inbox-jobs.js';import {createInboxHost} from '../../../packages/kb-service/inbox-host.js';import {INBOX_FLOW} from '../../../packages/kb-core/src/inbox-flow.js';
import {METHODS,validate} from '../../../packages/kb-contracts/index.js';
const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.resolve(appDir,'../..'),python=process.env.KB_DESKTOP_PYTHON??'python';
test('inbox shared source, policy and DSH conversation bridge',async()=>{
 const parent=path.join(appDir,'.test-runs');await mkdir(parent,{recursive:true});const run=await mkdtemp(path.join(parent,'inbox-')),sandbox=path.join(run,'candidate'),library=path.join(sandbox,'libraries','示例资料库');
 await createFixture(library,repo,path.join(appDir,'fixture-assets'));for(const n of ['测试甲.md','测试乙.txt'])await writeFile(path.join(library,'90-收件箱',n),'# 虚构测试\n唯一收件箱内容\n');
 let service,desktop,host,reader,stop;const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 const retry=async(c,m,a={},opts)=>{try{return await c.call(m,a,opts);}catch(e){if(e.code!=='POLICY_CHANGED')throw e;return c.call(m,a,opts);}};
 try{
  service=await startService({library,privateDir:path.join(run,'service-private'),python,desktopRoot:sandbox,idleMs:60000});desktop=await connectService({pipe:service.pipe,python,credentialFile:service.bootstrapFile});await desktop.call('migration.commit',{planId:'fresh',quiescent:true});
  const g=await desktop.call('connection.grant',{label:'Synthetic DSH',access:['read','edit','write','admin','host'],expiresAt:Date.now()+600000});host=await connectService({pipe:service.pipe,python,credential:g.credential,kind:'dsh-adapter'});
  const r=await desktop.call('connection.grant',{label:'Read only',access:['read'],expiresAt:Date.now()+600000});reader=await connectService({pipe:service.pipe,python,credential:r.credential});
  const call=(m,a={},opts)=>retry(desktop,m,a,opts),hcall=(m,a={},opts)=>retry(host,m,a,opts),list=()=>call('inbox.list',{limit:500});
  await check('desktop, plugin tool and plugin panel use the same pending list; archives and navigation are excluded',async()=>{
   await mkdir(path.join(library,'90-收件箱/原件归档'),{recursive:true});await writeFile(path.join(library,'90-收件箱/原件归档/历史.md'),'# 历史\n');await writeFile(path.join(library,'90-收件箱/README.md'),'导航');
   const a=await list(),b=await hcall('host.tool',{name:'kb_inbox',input:{action:'list',limit:500}}),c=await hcall('adapter.dispatch',{operation:{op:'capture.inbox-files',limit:500}});assert.deepEqual(a.items.map(f=>f.path),b.items.map(f=>f.path));assert.deepEqual(a.items.map(f=>f.path),c.items.map(f=>f.path));assert.equal(a.total,3);assert(!a.items.some(f=>f.path.includes('历史')||f.path.includes('README')));
  });
  let excluded;
  await check('batch exclusion retains both inbox originals; policy revision conflicts and read-only writes are rejected',async()=>{
   const p=await call('policy.get'),paths=['90-收件箱/测试甲.md','90-收件箱/测试乙.txt'],result=await call('policy.setIndexExcluded',{paths,excluded:true,expectedRevision:p.index.revision});excluded=result.mapping;
   assert.equal((await list()).items.filter(f=>f.excludedFromIndex).length,2);assert((await list()).items.some(f=>f.path===excluded[paths[0]]));assert.equal(await readFile(path.join(library,excluded[paths[0]]),'utf8'),'# 虚构测试\n唯一收件箱内容\n');
   assert((await hcall('host.tool',{name:'kb_inbox',input:{action:'list'}})).items.some(f=>f.path===excluded[paths[1]]));await assert.rejects(call('policy.setIndexExcluded',{paths:[excluded[paths[0]]],excluded:false,expectedRevision:p.index.revision}),{code:'CONFLICT'});await assert.rejects(retry(reader,'policy.setIndexExcluded',{paths:[excluded[paths[0]]],excluded:false,expectedRevision:result.policyRevision}),{code:'FORBIDDEN'});
  });
  await check('single restore shares policy with the plugin; pending files stay out of fulltext until archiving',async()=>{
   const p=await call('policy.get');await call('policy.setIndexExcluded',{paths:[excluded['90-收件箱/测试乙.txt']],excluded:false,expectedRevision:p.index.revision});const rows=(await list()).items;assert(rows.find(f=>f.path==='90-收件箱/测试乙.txt').excludedFromIndex===false);assert(rows.find(f=>f.path.includes('测试甲')).excludedFromIndex);assert.equal((await call('desktop.search',{query:'唯一收件箱内容',mode:'fulltext'})).items.length,0);
  });
  await check('organizing requires a live Host and only a host-authorized bridge can announce availability',async()=>{
   assert.equal((await call('inbox.organizeStatus')).ready,false);await assert.rejects(call('inbox.organize'),{code:'HOST_UNAVAILABLE'});assert.equal((await call('inbox.organizeStatus')).task,null);await assert.rejects(retry(reader,'inbox.organizeBridge',{action:'heartbeat',clientId:'unauthorized-client',execution:{provider:'p',model:'m',reasoningEffort:'high'}}),{code:'FORBIDDEN'});
  });
  await check('one click launches the existing High knowledge conversation once and reports session launch without claiming archival completion',async()=>{
   const handle=createInboxHost({client:{call:hcall},getLLM:()=>({listProviders:()=>[{id:'mock'}],listModels:async()=>[{id:'synthetic-high'}],resolveModelInfo:async()=>({reasoning:{efforts:[{id:'high'}]}})}),getWorkspace:async()=>({workspaceId:'synthetic-workspace',workspacePath:path.join(sandbox,'流程工作区')})});
   const context=await handle({op:'inbox.organize-context'}),prepared=await handle({op:'flows.prepare-conversation',id:INBOX_FLOW.id,expectedRevision:1,kbId:context.kbId,execution:context.execution});assert.equal(prepared.prompt,INBOX_FLOW.prompt);assert.equal(prepared.requiredReasoningEffort,'high');
   const code=await readFile(path.join(repo,'src/client/inbox-organize-bridge.js'),'utf8'),launches=[];
   const factory=vm.runInNewContext(code+'\ncreateInboxOrganizeBridge',{setTimeout,clearTimeout,setInterval,clearInterval});stop=factory({clientId:'synthetic-ui-client',intervalMs:30,api:async b=>b.op==='status'?{ok:true,status:{runtimeMode:'service'}}:handle(b),launch:async(flow,kbId,params,execution)=>{launches.push({flow,kbId,execution});return 'synthetic-knowledge-session';}});
   await wait(async()=>(await call('inbox.organizeStatus')).ready);const req=randomUUID(),a=await call('inbox.organize',{}, {requestId:req}),again=await call('inbox.organize',{}, {requestId:req});assert.deepEqual(a,again);await wait(async()=>(await call('inbox.organizeStatus')).task?.state==='launched');assert.equal(launches.length,1);assert.equal(launches[0].flow.id,INBOX_FLOW.id);assert.equal(launches[0].execution.reasoningEffort,'high');assert.equal((await list()).total,3);assert.equal((await call('inbox.organize')).id,a.id);
  });
  await check('Host completion validates source provenance, inherits exclusions and removes the same item from both pending lists',async()=>{
   const source=excluded['90-收件箱/测试甲.md'];await assert.rejects(hcall('host.tool',{name:'kb_inbox',input:{action:'complete',path:source,entryPath:'20-知识笔记/阅读方法.md'}}),{code:'BAD_REQUEST'});
   const entry=await hcall('host.tool',{name:'kb_record',input:{action:'create',kind:'知识',title:'虚构归档结果',body:'从虚构原件整理。',source}});assert(entry.ok);assert(entry.path.startsWith('排除索引分区/'));await hcall('host.tool',{name:'kb_inbox',input:{action:'complete',path:source,entryPath:entry.path}});assert(!(await list()).items.some(f=>f.path===source));assert(!(await hcall('host.tool',{name:'kb_inbox',input:{action:'list'}})).items.some(f=>f.path===source));
  });
  await writeFile(path.join(run,'result.json'),JSON.stringify({passed:true,checks,syntheticOnly:true,dsh:'mock Host UI and mock model catalog; no real model or installed Host run'},null,2));console.log('EVIDENCE',path.join(run,'result.json'));
 }finally{stop?.();reader?.close();host?.close();desktop?.close();await service?.close();}
});
async function wait(fn){const until=Date.now()+10000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Condition timed out');}
test('policy batch boundary matches the shared kernel: 500 allowed, 501 rejected',()=>{
 const args={paths:Array.from({length:500},(_,i)=>'90-收件箱/'+i+'.md'),excluded:true,expectedRevision:0};validate(METHODS['policy.setIndexExcluded'].args,args);assert.throws(()=>validate(METHODS['policy.setIndexExcluded'].args,{...args,paths:[...args.paths,'90-收件箱/501.md']}),{code:'BAD_REQUEST'});
});
test('interrupted launch is not replayed after restart; wrong owner/token cannot report a task',async()=>{
 const dir=await mkdtemp(path.join(appDir,'.test-runs/inbox-recovery-'));const make=()=>createInboxJobs({privateDir:dir,list:async()=>[{path:'90-收件箱/虚构.md'}],connected:()=>true});let j=await make();const args={action:'heartbeat',clientId:'synthetic-client',execution:{provider:'p',model:'m',reasoningEffort:'high'}};await j.bridge(args,'host-a');const t=await j.request('operation-a'),claimed=await j.bridge({action:'claim',clientId:args.clientId},'host-a');await assert.rejects(j.bridge({action:'report',clientId:args.clientId,taskId:t.id,token:'wrong',state:'launched',sessionId:'s'},'host-a'),{code:'CONFLICT'});assert(claimed.task.token);j=await make();assert.equal(j.status().task.state,'unknown');assert.equal(j.recoverOperation('operation-a').id,t.id);await j.bridge(args,'host-a');await assert.rejects(j.request('operation-b'),{code:'RESULT_UNKNOWN'});
});
