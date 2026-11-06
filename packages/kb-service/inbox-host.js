import {INBOX_FLOW} from '../kb-core/src/inbox-flow.js';
import {prepareFlowConversation} from '../kb-core/src/flow-workspace.js';
export function createInboxHost({client,getLLM,getWorkspace}){
 let catalog,expires=0;
 async function directory(){
  if(catalog&&Date.now()<expires)return catalog;
  const llm=getLLM(),groups=[],failures=[];if(!llm?.listProviders||!llm?.listModels||!llm?.resolveModelInfo)throw Error('DSH 模型目录尚未就绪');
  for(const p of llm.listProviders())try{const items=[];for(const m of await llm.listModels(p.id))try{const info=await llm.resolveModelInfo(p.id,m.id);items.push({id:m.id,name:info.name||m.name||m.id,reasoning:info.reasoning});}catch{failures.push({name:(p.name||p.id)+' / '+m.id});}groups.push({id:p.id,name:p.name||p.id,models:items});}catch{failures.push({name:p.name||p.id});}
  catalog={ok:true,groups,failures};expires=Date.now()+10000;return catalog;
 }
 async function models(){
  const rows=(await directory()).groups.flatMap(p=>p.models.filter(m=>m.reasoning?.efforts?.some(e=>e.id==='high')).map(m=>({provider:p.id,model:m.id,reasoningEffort:'high'})));
  if(!rows.length)throw Error('没有支持 High 的可用模型');return rows;
 }
 async function status(){return {...await client.call('host.tool',{name:'kb_status',input:{}}),runtimeMode:'service'};}
 return async function handle(body){
  if(body.op==='inbox.organize-context'){const s=await status();return {ok:true,kbId:s.kbId,execution:(await models())[0]};}
  if(body.op==='inbox.organize-bridge'){
   const a={...body};delete a.op;
   if(a.action==='heartbeat'&&!(await models()).some(m=>m.provider===a.execution?.provider&&m.model===a.execution?.model))throw Error('所选模型不可用或不支持 High');
   return {ok:true,...await client.call('inbox.organizeBridge',a)};
  }
  if(body.op==='flows.prepare-conversation'){
   // Custom definitions belong to the shared engine, not the builtin inbox gate.
   if(body.id!==INBOX_FLOW.id){
    return prepareFlowConversation({prepareConversation:input=>client.call('adapter.dispatch',{operation:input})},
     {ensure:async root=>{if(!getWorkspace)throw Error('DSH 流程工作区尚未就绪');return getWorkspace(root);}},body);
   }
   const s=await status();if(body.kbId!==s.kbId)throw Error('整理流程或知识库身份已变化');
   const saved=await client.call('adapter.dispatch',{operation:{op:'flows.get',id:INBOX_FLOW.id}});
   if(!saved?.ok||saved.kbId!==s.kbId||body.expectedRevision!==saved.flow.revision)throw Error('整理流程或知识库身份已变化');
   const selected=body.execution===undefined?saved.flow.execution:body.execution;
   const execution=(await models()).find(m=>m.provider===selected?.provider&&m.model===selected?.model);if(!execution||!(await getLLM().resolveModelInfo(execution.provider,execution.model)).reasoning?.efforts?.some(e=>e.id==='high'))throw Error('请先在流程卡中保存支持 High 的可用模型');
   if(!getWorkspace)throw Error('DSH 流程工作区尚未就绪');const workspace=await getWorkspace(s.kbPath);
   return {ok:true,kbId:s.kbId,kbPath:s.kbPath,...workspace,cwd:workspace.workspacePath,flowId:INBOX_FLOW.id,flowRevision:saved.flow.revision,prompt:INBOX_FLOW.prompt,requiredReasoningEffort:'high',execution};
  }
  if(body.op==='flows.models'){
   return directory();
  }
  return null;
 };
}
