import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,readJson,error,hash} from './io.js';
// The service owns request state. Only a live, authorized DSH UI may launch the
// existing knowledge conversation; the desktop never impersonates a Host.
export async function createInboxJobs({privateDir,list,connected,now=Date.now}){
 const file=path.join(privateDir,'inbox-organize.json'),runners=new Map();
 let task=await readJson(file,null);
 if(task&&['pending','launching'].includes(task.state)){task={...task,state:'unknown',message:'服务重启，任务发送结果需要在 DSH 会话中核对；未自动重新发送。'};await atomic(file,task);}
 function runner(){return [...runners.values()].find(r=>r.until>now()&&connected(r.grantId));}
 const publicTask=()=>task?{...Object.fromEntries(Object.entries(task).filter(([k])=>!['token','clientId','grantId','signature','paths','operationId'].includes(k))),fileCount:task.paths.length}:null;
 return {
  recoverOperation(id){return task?.operationId===id?publicTask():null;},
  status(){const r=runner();return {ready:!!r,execution:r?.execution,task:publicTask()};},
  async resolve(a){
   if(!task||task.id!==a.taskId||task.state!=='unknown')throw error('CONFLICT','待核对任务已变化，请刷新');
   if(a.confirm!==true||!['launched','failed'].includes(a.state)||a.state==='launched'&&!a.sessionId?.trim())throw error('BAD_REQUEST','请核对原会话并确认结果');
   task={...task,state:a.state,sessionId:a.state==='launched'?a.sessionId:'',resolvedAt:now(),message:a.state==='launched'?'已人工核对：DSH 会话已创建':'已人工核对：未发送，可重新发起整理'};
   await atomic(file,task);return publicTask();
  },
  async request(operationId){
   if(task?.operationId===operationId)return publicTask();
   const r=runner();if(!r)throw error('HOST_UNAVAILABLE','尚未接入可执行整理的 DSH 知识库会话；没有移动或归档文件。');
   const rows=await list(),paths=rows.map(r=>r.path).sort(),signature=hash(paths);
   if(!paths.length)throw error('BAD_REQUEST','收件箱没有待整理文件');
   if(task&&(['pending','launching'].includes(task.state)||task.state==='launched'&&task.signature===signature))return publicTask();
   if(task?.state==='unknown')throw error('RESULT_UNKNOWN','上次任务发送结果未确认，请先在 DSH 核对会话，避免重复整理。');
   task={id:randomUUID(),operationId,state:'pending',paths,signature,createdAt:now(),execution:r.execution,message:'等待 DSH 发起知识库会话'};await atomic(file,task);return publicTask();
  },
  async bridge(a,grantId){
   if(typeof a.clientId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(a.clientId))throw error('BAD_REQUEST','无效的 DSH 客户端身份');
   const key=grantId+':'+a.clientId;
   if(a.action==='heartbeat'){
    if(!a.execution?.provider||!a.execution?.model||a.execution.reasoningEffort!=='high')throw error('BAD_REQUEST','整理流程必须使用 High 模型');
    for(const [k,r]of runners)if(r.until<=now()||!connected(r.grantId))runners.delete(k);
    if(runners.size>=32&&!runners.has(key))throw error('STATE_BUSY','DSH 整理入口数量已满');
    runners.set(key,{grantId,clientId:a.clientId,execution:{provider:a.execution.provider,model:a.execution.model,reasoningEffort:'high'},until:now()+12000});return {ready:true};
   }
   if(a.action==='leave'){runners.delete(key);return {left:true};}
   const r=runners.get(key);if(a.action!=='report'&&(!r||r.until<=now()))throw error('FORBIDDEN','DSH 执行入口已失效');
   if(a.action==='claim'){
    if(!task||task.state!=='pending')return {task:null};
    if(JSON.stringify(task.execution)!==JSON.stringify(r.execution))return {task:null};
    task={...task,state:'launching',clientId:a.clientId,grantId,token:randomUUID(),message:'正在创建 DSH 知识库会话'};await atomic(file,task);return {task:{...publicTask(),token:task.token}};
   }
   if(a.action==='report'){
    if(!task||task.id!==a.taskId||task.clientId!==a.clientId||task.grantId!==grantId||task.token!==a.token||task.state!=='launching')throw error('CONFLICT','任务回执不匹配');
    if(!['launched','failed','unknown'].includes(a.state)||a.state==='launched'&&!a.sessionId)throw error('BAD_REQUEST','无效的会话回执');
    task={...task,state:a.state,sessionId:String(a.sessionId??'').slice(0,128),message:String(a.message??'').slice(0,600),updatedAt:now()};await atomic(file,task);return publicTask();
   }
   throw error('BAD_REQUEST','未知的 DSH 整理动作');
  },
 };
}
