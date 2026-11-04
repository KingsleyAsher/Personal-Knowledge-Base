import {INBOX_FLOW} from '../kb-core/src/inbox-flow.js';
export function createInboxHost({client,getLLM,getWorkspace}){
 let catalog,expires=0;
 async function models(){
  if(catalog&&Date.now()<expires)return catalog;
  const llm=getLLM(),items=[];if(!llm?.listProviders||!llm?.listModels||!llm?.resolveModelInfo)throw Error('DSH 模型目录尚未就绪');
  for(const p of llm.listProviders())try{for(const m of await llm.listModels(p.id))try{const info=await llm.resolveModelInfo(p.id,m.id);if(info.reasoning?.efforts?.some(e=>e.id==='high'))items.push({provider:p.id,model:m.id,reasoningEffort:'high'});}catch{}}catch{}
  if(!items.length)throw Error('没有支持 High 的可用模型');catalog=items;expires=Date.now()+10000;return items;
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
   const s=await status();if(body.id!==INBOX_FLOW.id||body.expectedRevision!==INBOX_FLOW.revision||body.kbId!==s.kbId)throw Error('整理流程或知识库身份已变化');
   const execution=(await models()).find(m=>m.provider===body.execution?.provider&&m.model===body.execution?.model);if(!execution||!(await getLLM().resolveModelInfo(execution.provider,execution.model)).reasoning?.efforts?.some(e=>e.id==='high'))throw Error('请选择支持 High 的可用模型');
   if(!getWorkspace)throw Error('DSH 流程工作区尚未就绪');const workspace=await getWorkspace(s.kbPath);
   return {ok:true,kbId:s.kbId,kbPath:s.kbPath,...workspace,cwd:workspace.workspacePath,flowId:INBOX_FLOW.id,flowRevision:INBOX_FLOW.revision,prompt:INBOX_FLOW.prompt,requiredReasoningEffort:'high',execution};
  }
  if(body.op==='flows.models'){
   const rows=await models(),groups=[];for(const m of rows){let g=groups.find(g=>g.id===m.provider);if(!g){g={id:m.provider,name:m.provider,models:[]};groups.push(g);}g.models.push({id:m.model,name:m.model,reasoning:{efforts:[{id:'high'}]}});}return {ok:true,groups,failures:[]};
  }
  return null;
 };
}
