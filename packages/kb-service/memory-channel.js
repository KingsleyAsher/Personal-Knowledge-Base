// Global memory stays owned by the memory plugin. Only explicitly selected
// knowledge memories are merged, through this library's authorized dispatcher.
import {randomUUID} from 'node:crypto';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
export const hasMemoryHost=store=>store?.memoryApi?.version===1||typeof store?.globalRequest==='function';
function memoryView(local,knowledge,shared){
  if(knowledge?.protocol!=='dsh-memory/v1'||knowledge.complete!==true)fail('RESULT_UNKNOWN','知识库记忆快照未完整读取，请重试');
  return {ok:true,...local,entries:[...(local.entries??[]),...knowledge.entries],knowledge:{state:'connected',libraryId:knowledge.libraryId},memory:{mode:shared?'shared':'independent',globalAvailable:shared,changeEvents:true}};
}
export function createMemoryChannel({broker,snapshot}){
  const independent=async()=>memoryView({},await snapshot(),false);
  return async function dispatch(operation,caller,operationId=randomUUID()){
    if(!caller.access.includes('admin'))fail('FORBIDDEN','全局记忆需要当前用户的管理权限');
    const {op}=operation;
    if(op==='memory.result'){
      const job=broker.get(operation.taskId,caller.id);
      if(!job.method.startsWith('memory.'))fail('FORBIDDEN','不是记忆任务');
      if(job.error){
        if(job.method==='memory.list'&&['HOST_UNAVAILABLE','HOST_TIMEOUT','RESULT_UNKNOWN'].includes(job.error.code))return independent();
        fail(job.error.code,job.error.message);
      }
      if(job.state!=='completed')return {ok:true,pending:true,taskId:job.id};
      if(job.method!=='memory.list')return {ok:true,...job.result};
      // Never reuse a snapshot across permission changes or library switches.
      const knowledge=await snapshot();
      return memoryView(job.result,knowledge,true);
    }
    if(!['memory.list','memory.add','memory.remove'].includes(op))fail('BAD_REQUEST','未知记忆操作');
    const args=op==='memory.add'?{text:operation.text,title:operation.title??''}:op==='memory.remove'?{entry_id:operation.entry_id}:{};
    if(op==='memory.add'&&(typeof args.text!=='string'||!args.text.trim()||args.text.length>4000||typeof args.title!=='string'||args.title.length>80))fail('BAD_REQUEST','记忆正文为 1–4000 字，标题不超过 80 字');
    if(op==='memory.remove'&&(typeof args.entry_id!=='string'||!args.entry_id.startsWith('memory-')))fail('BAD_REQUEST','知识库记忆请在原文中维护');
    const host=broker.status().hosts.find(h=>h.capabilities.includes('memory-v1'));
    if(!host){
      if(op==='memory.list')return independent();
      fail('CAPABILITY_UNSUPPORTED','当前为独立知识库模式，全局记忆服务未接入');
    }
    const job=await broker.request(op,{...args,hostInstanceId:host.id},caller.id,operationId);
    return {ok:true,pending:true,taskId:job.id};
  };
}

export async function handleMemoryHost(getStore,method,args={},requestId){
  const store=getStore();
  if(!hasMemoryHost(store))fail('HOST_UNAVAILABLE','记忆插件尚未加载');
  const op=({'memory.list':'list','memory.add':'add','memory.remove':'remove'})[method];
  if(!op)fail('BAD_REQUEST','未知记忆操作');
  if(store.memoryApi?.version===1)return store.memoryApi.request('global.'+op,args,requestId);
  return store.globalRequest(op,args,requestId);
}

export async function handleEmbeddedMemory(ctx,operation){
  if(operation.op==='memory.list'&&!hasMemoryHost(ctx.get('memoryStore')))return memoryView({},await ctx.get('knowledgeMemory').snapshot(),false);
  const value=await handleMemoryHost(()=>ctx.get('memoryStore'),operation.op,operation,operation.requestId);
  if(operation.op!=='memory.list')return value;
  const knowledge=await ctx.get('knowledgeMemory').snapshot();
  return memoryView(value,knowledge,true);
}
