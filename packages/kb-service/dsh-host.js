import {handleMemoryHost} from './memory-channel.js';
import {randomUUID} from 'node:crypto';import path from 'node:path';import {readFile,stat} from 'node:fs/promises';import {safePath} from '../kb-core/src/workbench-state.js';import {hash} from './io.js';
import {INBOX_FLOW} from '../kb-core/src/inbox-flow.js';
import {relayDshStream,chatHistoryFrame} from './dsh-stream-relay.js';
import {setTimeout as delay} from 'node:timers/promises';

// Adapted to the installed DSH 0.2.1-rc.5 SessionController schemas. The Host
// owns sessions, model credentials and streaming; no conversation DB is copied.
export function createDshHostPort({ctx,workspace,libraryRoot,send,ownsSession=()=>true,onSessionCreated=async()=>{}}){
 const controller=()=>ctx.get('sessionController'),follows=new Map(),snapshots=new Map(),created=new Set(),canceled=new Set();let modelCache,modelExpires=0;
 const signal=()=>AbortSignal.timeout(15000);
 function assertReady(){const c=controller();if(!c?.create||!c?.prompt||!c?.follow||!c?.modelCatalog)throw Error('当前 DSH 未提供所需会话接口');return c;}
 function visibleIds(){const registry=ctx.get('workspaceRegistry'),registered=registry?.list()?.find(w=>w.id===workspace.workspaceId),archived=new Set(registry?.archivedSessionIds??[]);return new Set((registered?.sessionIds??[]).filter(id=>!archived.has(id)&&ownsSession(id)));}
 function allowed(id){if(!visibleIds().has(id))throw Object.assign(Error('会话已删除、归档或不属于知识库工作区'),{code:'FORBIDDEN'});}
 function withTurnState(sessionId,frame){
  const agent=ctx.get('agents')?.get(sessionId),boundary=agent&&ctx.get('sessionProjections')?.stateOf(agent.session,'turnBoundary');
  return boundary?{...frame,turnState:{active:boundary.openTurnStartSeq!==null,asOfSeq:agent.session.seq-1}}:frame;
 }
 async function snapshot(sessionId,limit=100){
  const c=assertReady(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000),iterator=c.follow({address:{kind:'session',sessionId},assistantStream:true,maxMessages:limit},abort.signal)[Symbol.asyncIterator]();
  try{for(let i=0;i<12;i++){const next=await iterator.next();if(next.done)break;if(next.value.type==='snapshot'){const frame=chatHistoryFrame(withTurnState(sessionId,next.value));snapshots.set(sessionId,frame);return frame;}}throw Error('未收到 DSH 会话快照');}
  finally{clearTimeout(timer);abort.abort();void iterator.return?.().catch(()=>{});}
 }
 async function create(requestId,preset='knowledge'){const result=await assertReady().create({workspaceId:workspace.workspaceId,agentPreset:preset,...(requestId?{sessionId:requestId}:{})});await onSessionCreated(result.sessionId);created.add(result.sessionId);return result;}
 async function select(sessionId,execution){if(execution?.provider&&execution?.model)return controller().selectModel({sessionId,provider:execution.provider,model:execution.model,...(execution.reasoningEffort?{reasoningEffort:execution.reasoningEffort}:{})});}
 async function prompt(sessionId,text,requestId,references=[]){
  const content=[{type:'text',text}];let size=0;
  for(const ref of references){
   if(!libraryRoot)throw Error('附件来源未绑定');const file=await safePath(libraryRoot,ref.path),before=await stat(file,{bigint:true}),revision=s=>'fs:'+hash([String(s.dev),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs)]);
   if(revision(before)!==ref.revision)throw Object.assign(Error('附件已更新，请重新选择'),{code:'CONFLICT'});size+=Number(before.size);if(size>16*1024*1024)throw Error('附件总大小超过 16MB');
   const data=await readFile(file),after=await stat(file,{bigint:true});if(revision(after)!==ref.revision)throw Object.assign(Error('附件读取期间已更新'),{code:'CONFLICT'});
   const uploads=ctx.get('fileUploads');if(!uploads?.upload)throw Error('当前 DSH 未启用文件附件');const {agent,error}=await controller().resolveAgent(sessionId);if(error)throw error;
   const receipt=await uploads.upload(agent,{name:path.basename(file),data:data.toString('base64')},signal());content.push({type:'file',receiptId:receipt.receiptId});
  }
  return controller().prompt({sessionId,requestId:requestId??randomUUID(),mode:'queue',content,clientTimeZone:'Asia/Shanghai'},signal());
 }
 const interactions=new Map(),disposers=[];
 function handles(agent){if(!agent||!follows.has(agent.id))return false;try{allowed(agent.id);return ctx.get('agents')?.get(agent.id)===agent;}catch{return false;}}
 function interaction(kind,request,next){
  if(!handles(request.agent))return next();const id=randomUUID(),revision=randomUUID(),sessionId=request.agent.id;
  return new Promise((resolve,reject)=>{
   let claim,settled=false;
   const finish=(answer,failed=false)=>{if(settled)return;settled=true;clearTimeout(timer);void claim?.return?.().catch(()=>{});request.signal?.removeEventListener('abort',abort);interactions.delete(id);void send(sessionId,{type:'interaction-closed',id}).catch(()=>{});failed?reject(answer):resolve(answer);};
   const abort=()=>finish(kind==='approval'?'cancelled':Object.assign(Error('提问已取消'),{code:'ASK_ABORTED'}),kind!=='approval');
   const timer=setTimeout(abort,300000);timer.unref?.();
   if(kind==='questions'&&request.wait?.callId){const questions=request.agent.ctx.get('userQuestions')??ctx.get('userQuestions');claim=questions?.attachWait(request.agent,request.wait.callId,request.signal)[Symbol.asyncIterator]();void claim?.next().catch(()=>{});}
   const data={id,revision,kind,sessionId,...(kind==='approval'?{toolName:request.toolName,reason:request.reason}:{questions:request.questions,callId:request.wait?.callId})};
   interactions.set(id,{data,finish});request.signal?.addEventListener('abort',abort,{once:true});if(request.signal?.aborted){abort();return;}void send(sessionId,{type:'interaction',...data}).catch(abort);
  });
 }
 if(ctx.on){disposers.push(ctx.on('approval/request',(req,next)=>interaction('approval',req,next)));disposers.push(ctx.on('user-questions/request',(req,next)=>interaction('questions',req,next)));}

 const boundAgents=new WeakSet();
 async function bindAgent(sessionId){const {agent,error}=await assertReady().resolveAgent(sessionId);if(error)throw error;if(!boundAgents.has(agent)){boundAgents.add(agent);disposers.push(agent.ctx.on('approval/request',(req,next)=>interaction('approval',req,next),true));disposers.push(agent.ctx.on('user-questions/request',(req,next)=>interaction('questions',req,next),true));}return agent;}
 async function follow(sessionId){
  await bindAgent(sessionId);
  if(follows.has(sessionId))return {following:true};if(follows.size>=8){const [id,c]=follows.entries().next().value;c.abort();follows.delete(id);}
  const abort=new AbortController();follows.set(sessionId,abort);
  void (async()=>{let attempt=0;try{while(!abort.signal.aborted){const streamAbort=new AbortController(),stop=()=>streamAbort.abort();abort.signal.addEventListener('abort',stop,{once:true});try{
    allowed(sessionId);const native=assertReady().follow({address:{kind:'session',sessionId},assistantStream:true,maxMessages:30},streamAbort.signal);
    const source=(async function*(){for await(const received of native){const frame=received.type==='snapshot'?chatHistoryFrame(withTurnState(sessionId,received)):received.type==='event'?chatHistoryFrame({records:[received]}).records[0]:received;if(frame.type==='snapshot'){snapshots.set(sessionId,frame);attempt=0;}yield frame;}})();
    await relayDshStream({source,send:frame=>send(sessionId,frame),abort:stop,signal:streamAbort.signal});if(abort.signal.aborted)break;
   }catch(e){if(abort.signal.aborted)break;console.warn('[kb-dsh-stream]',String(e.code??e.name??'STREAM_INTERRUPTED').slice(0,80));if(['FORBIDDEN','NOT_FOUND','FRAME_TOO_LARGE'].includes(e.code)){await send(sessionId,{type:'resync-required',message:'该会话已不可用，请重新选择聊天。',terminal:true}).catch(()=>{});break;}}
   finally{abort.signal.removeEventListener('abort',stop);streamAbort.abort();}
   await send(sessionId,{type:'resync-required',message:'正在自动恢复会话连接…'}).catch(()=>{});await delay(Math.min(5000,250*2**Math.min(attempt++,5)),undefined,{signal:abort.signal});
  }}catch(e){if(!abort.signal.aborted)console.warn('[kb-dsh-stream]',String(e.code??e.name));}finally{if(follows.get(sessionId)===abort)follows.delete(sessionId);}})();return {following:true};
 }
 return {
  ready(){try{assertReady();return true}catch{return false}},
  async models(){if(modelCache&&Date.now()<modelExpires)return modelCache;const result=await assertReady().modelCatalog();modelCache=result;modelExpires=Date.now()+10000;return result;},
  async inbox(task){
   const catalog=await this.models(),routes=catalog.groups.flatMap(g=>g.models.filter(m=>m.reasoning?.efforts?.some(e=>e.id==='high')).map(m=>({provider:g.id,model:m.id,reasoningEffort:'high'})));
   const execution=task.execution??routes[0];if(!execution||!routes.some(r=>r.provider===execution.provider&&r.model===execution.model))throw Error('整理收件箱需要支持 High 的可用模型');
   let sessionId='',sendAttempted=false;try{sessionId=(await create(task.id)).sessionId;await select(sessionId,execution);sendAttempted=true;await prompt(sessionId,INBOX_FLOW.prompt,task.id);return sessionId;}catch(e){e.sessionId=sessionId;e.sendAttempted=sendAttempted;throw e;}
  },
  async handle(method,a={},taskId){
   if(method.startsWith('memory.'))return handleMemoryHost(()=>ctx.get('memoryStore'),method,a,taskId);
   const c=assertReady();
   if(method==='models'||method==='dsh.modelCatalog')return this.models();
   if(method==='workspace')return workspace;
   if(method==='dsh.presets'){const registry=ctx.get('agentPresets');return {presets:registry?await registry.compositionInventory():[]};}

   if(method==='dsh.sessions'){const rows=(await c.list({},signal())).items,ids=visibleIds();return {items:rows.filter(r=>ids.has(r.sessionId))};}
   if(method==='dsh.createSession')return create(taskId,a.preset);
   if(method==='flow.cancel'){canceled.add(a.sessionId);if(canceled.size>200)canceled.delete(canceled.values().next().value);if(created.has(a.sessionId))await c.cancel({sessionId:a.sessionId});return {cancelled:true};}
   if(a.sessionId)allowed(a.sessionId);
   if(method==='dsh.capabilities'){
    const catalog=ctx.get('sessionSkillCatalog'),presets=ctx.get('agentPresets');let skills=[],skillError='';try{skills=(await catalog?.list({sessionId:a.sessionId},signal()))?.skills??[];}catch(e){skillError=e.message;}
    const composition=await presets?.compositionInventory()??[];
    return {skills,skillError,presets:composition,attachments:!!ctx.get('fileUploads'),interactions:true};
   }
   if(method==='dsh.selectPreset'){const {agent,error}=await c.resolveAgent(a.sessionId);if(error)throw error;return {preset:await ctx.get('agentPresets').select(agent,a.preset)};}
   if(method==='dsh.interactions')return {items:[...interactions.values()].filter(x=>x.data.sessionId===a.sessionId).map(x=>x.data)};
   if(method==='dsh.answerInteraction'){
    const row=interactions.get(a.eventId);if(!row||row.data.sessionId!==a.sessionId||row.data.revision!==a.interactionRevision)throw Object.assign(Error('交互已过期，请刷新'),{code:'INTERACTION_EXPIRED'});
    if(row.data.kind==='approval'){
     if(!['allowed-once','rejected'].includes(a.answer?.outcome))throw Error('审批结果无效');row.finish(a.answer.outcome);
    }else{
     const answers=a.answer?.answers,questions=row.data.questions;if(!Array.isArray(answers)||answers.length!==questions.length||new Set(answers.map(x=>x.id)).size!==questions.length)throw Error('请回答每个问题');
     for(const q of questions){const ans=answers.find(x=>x.id===q.id);if(!ans||!Array.isArray(ans.selected)||ans.selected.some(x=>!(q.options??[]).some(o=>o.label===x))||ans.custom!=null&&typeof ans.custom!=='string')throw Error('问题答案无效');if(!q.multiSelect&&ans.selected.length>1)throw Error('此问题只允许单选');}row.finish({answers});
    }return {accepted:true};
   }
   if(method==='dsh.selectModel')return select(a.sessionId,a);
   if(method==='dsh.prompt')return prompt(a.sessionId,a.text,taskId,a.references);
   if(method==='dsh.cancel')return c.cancel({sessionId:a.sessionId});
   if(method==='dsh.follow')return follow(a.sessionId);
   if(method==='dsh.history'){
    const current=a.beforeSeq!=null&&snapshots.has(a.sessionId)?snapshots.get(a.sessionId):await snapshot(a.sessionId,a.limit),cut=a.throughSeq??current.cursor;
    if(a.beforeSeq!=null)return {...chatHistoryFrame(await c.page({address:{kind:'session',sessionId:a.sessionId},throughSeq:cut,beforeSeq:a.beforeSeq,maxMessages:a.limit},signal())),cursor:cut};
    return {records:current.records,hasMore:current.hasMore,cursor:cut,projections:current.projections,turnState:current.turnState,assistantStream:current.assistantStream};
   }
   if(method==='file.open')return c.openWorkspacePath(a,signal());
   if(method==='flow.delegate'){
    const checkCanceled=()=>{if(canceled.has(taskId))throw Object.assign(Error('流程已取消'),{code:'CANCELED'});};checkCanceled();const result=await create(taskId);checkCanceled();await select(result.sessionId,a.execution);checkCanceled();await prompt(result.sessionId,a.task,taskId);
    const resolved=await c.resolveAgent(result.sessionId);if(resolved.error)throw resolved.error;await resolved.agent.whenIdle();checkCanceled();const s=await snapshot(result.sessionId,100);
    const answers=s.records.filter(r=>r.event?.type==='assistant/message').map(r=>textParts(r.event.data?.message?.content));return {answer:answers.join('\n'),target:'knowledge',preset:'knowledge',subagentId:result.sessionId,kind:a.kind};
   }
   throw Object.assign(Error('DSH 不支持此接口'),{code:'CAPABILITY_UNSUPPORTED'});
  },
  dispose(){for(const dispose of disposers)dispose?.();for(const row of interactions.values())row.finish(row.data.kind==='approval'?'cancelled':Object.assign(Error('会话连接已关闭'),{code:'ASK_ABORTED'}),row.data.kind!=='approval');interactions.clear();for(const c of follows.values())c.abort();follows.clear();snapshots.clear();canceled.clear();},
 };
}
function textParts(value){return typeof value==='string'?value:Array.isArray(value)?value.filter(p=>p.type==='text').map(p=>p.text??'').join(''):'';}

export function startDshHostBridge({client,ctx,workspace,libraryRoot,label,ensureWorkspace,ownsSession,onSessionCreated,onError=()=>{}}){
 let memoryRevision;
 const hostInstanceId=randomUUID(),jobs=new Set(),inboxId='host-'+hostInstanceId;let disposed=false,timer,pumping=false,inboxChecking=false,nextInbox=0,nextRegister=0;
 const call=async(method,args)=>{try{return await client.call(method,args);}catch(e){if(e.code!=='POLICY_CHANGED')throw e;return client.call(method,args);}};
 const port=createDshHostPort({ctx,workspace,libraryRoot,ownsSession,onSessionCreated,send:(sessionId,data)=>call('host.bridge',{action:'event',hostInstanceId,sessionId,data})});
 const result=(task,value,failure)=>{
  if(!failure&&Buffer.byteLength(JSON.stringify(value)??'null')>700000)failure=Object.assign(Error('会话内容超过单次同步上限，请分批加载历史。'),{code:'FRAME_TOO_LARGE'});
  return call('host.bridge',{action:'result',hostInstanceId,taskId:task.id,token:task.token,...(failure?{error:{code:failure.code??'HOST_UNAVAILABLE',message:'DSH 操作未完成：'+String(failure.message).slice(0,500)}}:{result:value})});
 };
 async function dispatch(task){
  let timer;
  try{return await Promise.race([port.handle(task.method,task.args,task.id),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('宿主操作超时，请重新连接；该操作未自动重发。'),{code:'HOST_TIMEOUT'})),18000);timer.unref?.();})]);}
  finally{clearTimeout(timer);}
 }
 async function pump(){
  if(disposed||pumping)return;pumping=true;
  try{
   if(!port.ready())return;
   if(ensureWorkspace&&!ctx.get('workspaceRegistry')?.list()?.some(w=>w.id===workspace.workspaceId)){
    // Refresh the registry identity before admitting another task. Never replay
    // an already dispatched prompt when the previous workspace disappeared.
    await call('host.bridge',{action:'leave',hostInstanceId}).catch(()=>{});
    const refreshed=await ensureWorkspace();Object.assign(workspace,refreshed);nextRegister=0;
   }
   if(Date.now()>=nextRegister){await call('host.bridge',{action:'register',hostInstanceId,label,workspaceId:workspace.workspaceId,workspacePath:workspace.workspacePath,capabilities:[...(ctx.get('memoryStore')?.globalRequest?['memory-v1']:[]),'sessions','history','prompt','cancel','models','stream','reasoning','presets','skills','attachments','interactions','knowledge-flows']});nextRegister=Date.now()+2000;}
   const revision=ctx.get('memoryStore')?.revision;
   if(revision&&revision!==memoryRevision){await call('host.bridge',{action:'memory-changed',hostInstanceId,revision});memoryRevision=revision;}
   while(jobs.size<4){const {task}=await call('host.bridge',{action:'poll',hostInstanceId});if(!task)break;jobs.add(task.id);void dispatch(task).then(v=>result(task,v),e=>result(task,null,e)).catch(onError).finally(()=>jobs.delete(task.id));}
   if(!inboxChecking&&Date.now()>nextInbox){inboxChecking=true;nextInbox=Date.now()+5000;void(async()=>{
   const catalog=await port.models(),execution=catalog.groups.flatMap(g=>g.models.filter(m=>m.reasoning?.efforts?.some(e=>e.id==='high')).map(m=>({provider:g.id,model:m.id,reasoningEffort:'high'})))[0];
   if(execution){await call('inbox.organizeBridge',{action:'heartbeat',clientId:inboxId,execution});const r=await call('inbox.organizeBridge',{action:'claim',clientId:inboxId});if(r.task){const t=r.task;void port.inbox(t).then(sessionId=>call('inbox.organizeBridge',{action:'report',clientId:inboxId,taskId:t.id,token:t.token,state:'launched',sessionId,message:'已在 DSH 发起整理会话，归档进度以共享清单和会话为准。'})).catch(e=>call('inbox.organizeBridge',{action:'report',clientId:inboxId,taskId:t.id,token:t.token,state:e.sendAttempted?'unknown':'failed',sessionId:e.sessionId??'',message:'整理会话未确认：'+String(e.message).slice(0,500)})).catch(onError);}}
   })().catch(onError).finally(()=>{inboxChecking=false;});}
  }catch(e){nextRegister=0;onError(e)}finally{pumping=false;if(!disposed)timer=setTimeout(pump,200);}
 }
 void pump();return {hostInstanceId,port,dispose(){disposed=true;clearTimeout(timer);port.dispose();void call('host.bridge',{action:'leave',hostInstanceId}).catch(()=>{});void call('inbox.organizeBridge',{action:'leave',clientId:inboxId}).catch(()=>{});}};
}
