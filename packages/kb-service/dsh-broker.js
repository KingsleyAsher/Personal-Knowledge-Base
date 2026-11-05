import path from 'node:path';import {randomUUID} from 'node:crypto';
import {atomic,readJson,error,hash} from './io.js';

// One authenticated Host owns a job claim. Prompts never go to a second Host
// after an ambiguous delivery; durable records contain no prompt text.
export async function createDshBroker({privateDir,alive,emit,now=Date.now}){
 const file=path.join(privateDir,'dsh-jobs.json'),hosts=new Map(),sessions=new Map(),jobs=new Map(),waiters=new Map();
 const prior=await readJson(file,[]);for(const j of prior)jobs.set(j.id,{...j,...(['queued','running'].includes(j.state)?{state:'unknown',error:{code:'RESULT_UNKNOWN',message:'服务重启，请核对 DSH 会话；任务未自动重发'}}:{})});
 const persist=()=>{for(const j of [...jobs.values()].slice(0,-200))if(!['queued','running'].includes(j.state))jobs.delete(j.id);return atomic(file,[...jobs.values()].map(({args,token,result,...j})=>({...j,result:['dsh.createSession','dsh.prompt','dsh.selectModel','dsh.cancel','dsh.follow'].includes(j.method)?result??null:null})).slice(-200));};
 const publicJob=j=>{const {args,token,...out}=j;return out};
 const live=h=>h&&h.until>now()&&alive(h.owner);
 function selected(id){const h=id?hosts.get(id):[...hosts.values()].find(live);if(!live(h))throw error('HOST_UNAVAILABLE','DSH 未连接，依赖模型的操作暂不可用');return h;}
 function authorizeSession(h,id){if(id&&!sessions.get(h.id)?.has(id))throw error('FORBIDDEN','会话不属于该知识库的已授权工作区');}
 return {
  status(){return {busy:[...jobs.values()].some(j=>['queued','running'].includes(j.state)),online:[...hosts.values()].some(live),hosts:[...hosts.values()].filter(live).map(({owner,until,...h})=>h)};},
  scope(hostId){const h=selected(hostId);return {hostInstanceId:h.id,workspaces:[h.workspaceId],sessions:[...(sessions.get(h.id)??[])]};},
  async request(method,args,grantId,operationId){
   const old=[...jobs.values()].find(j=>j.operationId===operationId&&j.grantId===grantId);if(old)return publicJob(old);
   const h=selected(args.hostInstanceId);if(args.workspaceId&&args.workspaceId!==h.workspaceId)throw error('FORBIDDEN');if(!(grantId==='internal'&&method==='flow.cancel'))authorizeSession(h,args.sessionId);
   const active=[...jobs.values()].filter(j=>['queued','running'].includes(j.state));if(active.length>=32)throw error('STATE_BUSY','DSH 任务队列已满');
   const id=randomUUID(),j={id,operationId,grantId,hostId:h.id,method,args,state:'queued',createdAt:now(),fingerprint:hash({method,args})};jobs.set(id,j);await persist();return publicJob(j);
  },
  get(id,grantId){const j=jobs.get(id);if(!j||j.grantId!==grantId)throw error('NOT_FOUND');return publicJob(j);},
  recover(operationId){const j=[...jobs.values()].find(j=>j.operationId===operationId);return j?publicJob(j):null;},
  async invoke(method,args,{signal}={}){
   signal?.throwIfAborted();const h=selected(),j=await this.request(method,{...args,hostInstanceId:h.id},'internal',randomUUID());
   return new Promise((resolve,reject)=>{const cleanup=()=>signal?.removeEventListener('abort',cancel),timer=setTimeout(()=>{cleanup();waiters.delete(j.id);reject(error('RESULT_UNKNOWN','DSH 执行未确认，请查看该会话，不自动重复执行'));},300000);
    const cancel=()=>{clearTimeout(timer);cleanup();waiters.delete(j.id);const row=jobs.get(j.id);if(row?.state==='queued'){row.state='canceled';delete row.args;void persist();}else if(method==='flow.delegate')void this.request('flow.cancel',{hostInstanceId:h.id,sessionId:j.id},'internal',randomUUID()).catch(()=>{});reject(error('CANCELED','流程已取消'));};
    timer.unref?.();waiters.set(j.id,{resolve,reject,timer,cleanup});signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
   });
  },
  async audit(){let changed=false;for(const j of jobs.values())if(['queued','running'].includes(j.state)&&!live(hosts.get(j.hostId))){const running=j.state==='running';j.state=running?'unknown':'failed';j.error={code:running?'RESULT_UNKNOWN':'HOST_UNAVAILABLE',message:running?'DSH 已断线，请核对会话；未自动重发':'DSH 离线，任务尚未发送'};delete j.args;const w=waiters.get(j.id);if(w){clearTimeout(w.timer);w.cleanup?.();waiters.delete(j.id);w.reject(error(j.error.code,j.error.message));}changed=true;}if(changed)await persist();return changed;},
  async bridge(a,owner){
   if(a.action==='register'){
    if(!a.workspaceId||!a.label||!Array.isArray(a.capabilities))throw error('BAD_REQUEST');const old=hosts.get(a.hostInstanceId);if(live(old)&&old.owner!==owner)throw error('FORBIDDEN');
    hosts.set(a.hostInstanceId,{id:a.hostInstanceId,label:a.label,workspaceId:a.workspaceId,workspacePath:a.workspacePath,capabilities:a.capabilities,owner,until:now()+8000});sessions.set(a.hostInstanceId,old?.workspaceId===a.workspaceId?sessions.get(a.hostInstanceId)??new Set():new Set());return {registered:true};
   }
   const h=hosts.get(a.hostInstanceId);if(!h||h.owner!==owner)throw error('FORBIDDEN');
   if(a.action==='leave'){hosts.delete(h.id);return {left:true};}
   h.until=now()+8000;
   if(a.action==='poll'){
    const j=[...jobs.values()].find(j=>j.hostId===h.id&&j.state==='queued');if(!j)return {task:null};j.state='running';j.token=randomUUID();await persist();return {task:{id:j.id,method:j.method,args:j.args,token:j.token}};
   }
   if(a.action==='memory-changed'){await emit({type:'memory-changed',hostInstanceId:h.id,revision:String(a.revision??'').slice(0,128)});return {published:true};}
   if(a.action==='event'){authorizeSession(h,a.sessionId);if(Buffer.byteLength(JSON.stringify(a.data))>500000)throw error('BAD_REQUEST');await emit({hostInstanceId:h.id,sessionId:a.sessionId,data:a.data});return {published:true};}
   if(a.action==='result'){
    const j=jobs.get(a.taskId);if(!j||j.hostId!==h.id||j.token!==a.token||j.state!=='running')throw error('CONFLICT');
    j.state=a.error?'failed':'completed';j.result=a.result??null;j.error=a.error?{code:String(a.error.code??'HOST_UNAVAILABLE').slice(0,64),message:String(a.error.message??'DSH 操作失败').slice(0,600)}:null;j.finishedAt=now();
    if(!a.error){if(j.method==='dsh.createSession'&&j.result?.sessionId)sessions.get(h.id).add(j.result.sessionId);if(j.method==='dsh.sessions')for(const row of j.result?.items??[])if(row.sessionId)sessions.get(h.id).add(row.sessionId);}
    delete j.args;await persist();const w=waiters.get(j.id);if(w){clearTimeout(w.timer);w.cleanup?.();waiters.delete(j.id);j.error?w.reject(error(j.error.code,j.error.message)):w.resolve(j.result);}return {received:true};
   }
   throw error('BAD_REQUEST');
  },
  dispose(){for(const w of waiters.values()){clearTimeout(w.timer);w.cleanup?.();w.reject(error('HOST_UNAVAILABLE'));}waiters.clear();},
 };
}
