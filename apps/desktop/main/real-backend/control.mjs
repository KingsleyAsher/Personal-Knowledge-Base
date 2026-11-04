import path from 'node:path';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const config=JSON.parse(await readFile(process.argv[2],'utf8')),action=process.argv[3],{connectRuntime}=await import(pathToFileURL(path.join(config.pluginRoot,'packages/kb-service/runtime.js')).href);
const {createFixture}=await import('../fixture.js');let runtime;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await createFixture(config.library,config.pluginRoot,config.assetDir);
 runtime=await connectRuntime({library:config.library,home:config.sharedHome,candidateRoot:config.dataDir,python:config.python,kind:'desktop'});
 const call=async(method,args={},options)=>{try{return await runtime.client.call(method,args,options)}catch(e){if(e.code!=='POLICY_CHANGED')throw e;return runtime.client.call(method,args,options);}};
 if(action==='prepare'){process.stdout.write(JSON.stringify({prepared:true,library:runtime.identity,synthetic:true})+'\n');}
 else if(action==='status'||action==='wait-online'){
  const until=Date.now()+(action==='wait-online'?50000:0);let status;
  do{status=await call('dsh.status');if(status.online)break;await sleep(400);}while(Date.now()<until);
  if(!status.online&&action==='wait-online')throw Object.assign(Error('DSH 后端未在预期时间内连接。'),{code:'HOST_UNAVAILABLE'});
  process.stdout.write(JSON.stringify({online:status.online,hostCount:status.hosts.length,syntheticLibrary:true})+'\n');
 }else if(action==='verify'){
  const status=await call('dsh.status');if(!status.online)throw Object.assign(Error('DSH 尚未连接'),{code:'HOST_UNAVAILABLE'});const host=status.hosts[0],frames=[];
  const off=runtime.client.subscribe(e=>{if(e.event==='dsh.event')frames.push(e.data);});
  async function req(method,args){let job=await call('dsh.'+method,{hostInstanceId:host.id,...args});const end=Date.now()+120000;while(['queued','running'].includes(job.state)&&Date.now()<end){await sleep(200);job=await call('task.get',{taskId:job.id});}if(job.state!=='completed')throw Object.assign(Error(job.error?.message??'DSH 结果未确认'),{code:job.error?.code??'RESULT_UNKNOWN'});return job.result;}
  const created=await req('createSession',{workspaceId:host.workspaceId,preset:'minimal'}),sessionId=created.sessionId;
  const catalog=await req('modelCatalog',{sessionId}),models=catalog.groups.flatMap(g=>g.models.map(m=>({...m,provider:g.id}))),chosen=models.find(m=>m.provider===config.verifyProvider&&(!config.verifyModel||m.id===config.verifyModel));
  if(!chosen)throw Object.assign(Error('云端模型尚未进入目录；当前目录：'+catalog.groups.map(g=>g.id+':'+g.models.map(m=>m.id).join(',')).join(';')), {code:'MODEL_UNAVAILABLE'});
  await req('selectModel',{sessionId,provider:chosen.provider,model:chosen.id});await req('follow',{sessionId});
  await req('prompt',{sessionId,text:'这是隔离测试库的连接验证。不要调用任何工具，不读取任何文件。请只回复：REAL_BACKEND_OK',references:[]});
  const end=Date.now()+120000;let history,answer='';
  while(Date.now()<end){history=await req('history',{sessionId,limit:20});const replies=history.records.filter(r=>r.event?.type==='assistant/message');answer=replies.flatMap(r=>(r.event.data?.message?.content??[]).filter(p=>p.type==='text').map(p=>p.text)).join('');if(answer.includes('REAL_BACKEND_OK')&&history.turnState?.active===false)break;if(history.records.some(r=>r.event?.type==='turn/end')&&!history.turnState?.active)break;await sleep(500);}
  off();if(!answer.includes('REAL_BACKEND_OK'))throw Object.assign(Error('真实模型未返回验证标识；请在独立候选会话中核对上游状态。'),{code:'MODEL_REPLY_UNCONFIRMED'});
  const result={passed:true,realModelInference:true,syntheticAdapter:false,provider:chosen.provider,model:chosen.id,sessionId,streamed:frames.some(f=>f.sessionId===sessionId&&f.data?.type==='assistant-stream'),durableReply:true,syntheticLibrary:true,realKnowledgeBaseRead:false};
  await writeFile(path.join(config.dataDir,'backend/verification.json'),JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result)+'\n');
 }else throw Error('未知连接操作');
}catch(e){process.stderr.write(JSON.stringify({code:e.code??'BACKEND_FAILED',message:String(e.message).replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/g,'[redacted]').slice(0,300)})+'\n');process.exitCode=1;}finally{await runtime?.close();}
