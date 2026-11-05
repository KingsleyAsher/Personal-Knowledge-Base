import path from 'node:path';import {error} from './io.js';
import {toolWrites} from './operations.js';
// The shared engine returns domain data; the Host tool contract also requires
// the requested action on kb_flow successes and structured failures.
export function normalizeToolResult(name,input,value){
 return name==='kb_flow'?{...value,action:String(input?.action??'')}:value;
}
export function createToolRouter({kernel,engines,wb,write,online,root,kbId,sourceFromStage}){
 return async function route({name,input,hostSession,hostAuthority,sourceStage},caller){
  const session=hostSession??'host-ui',a=input??{};
  if(name==='kb_status')return kernel.core.status();
  if(name==='kb_bind'){if(path.resolve(a.path??'').toLowerCase()!==root.toLowerCase())throw error('BINDING_CHANGED','一个共库连接只能绑定一个库；请从库切换入口重新连接');return {ok:true,kbPath:root,kbId,initialized:true,alreadyInitialized:true,needsConfirm:false,willCreate:[],willModify:[]};}
  if(name==='kb_init')return {ok:true,kbPath:root,kbId,alreadyInitialized:true,installState:'complete',steps:[]};
  if(name==='kb_search'){const found=await wb({op:'search.list',mode:'body',q:a.query,retrievalMode:a.retrievalMode,limit:Math.max(1,Math.min(20,a.limit||5))});return {...found,ok:true,hits:found.items.map(h=>({...h,revision:h.revision?.slice(0,12)||null}))};}
  if(name==='kb_check'){write(caller);return kernel.core.check(a);}
  if(name==='kb_inbox'){
   if(a.action==='list')return wb({op:'inbox.list',limit:a.limit,offset:a.offset});write(caller);
   if(a.action==='complete')return wb({op:'inbox.complete',path:a.path,entryPath:a.entryPath});throw error('BAD_REQUEST');
  }
  if(name==='kb_record'){
   write(caller);if(a.action==='create'&&['知识','项目','素材','人物','画像'].includes(a.kind))return kernel.core.createEntry({...a,requestId:a.requestId??caller.operationId});
   if(a.action==='update'){const snapshot=await kernel.core._internal.indexSnapshot(await kernel.core.getConfig()),hit=snapshot.entries?.find(e=>e.entryId===a.entryId);if(!hit)throw error('NOT_FOUND');await kernel.workbench.assertDisplay(hit.path);return kernel.core.updateEntry({...a,requestId:a.requestId??caller.operationId});}
   throw error('BAD_REQUEST','知识条目动作无效');
  }
  const map={kb_question_search:'question.search',kb_question_read:'question.read',kb_validate_citations:'question.validate',kb_relation_review:'links.ai.'+(a.action??'inspect'),kb_deliverable:'deliverables.'+(a.action??'prepare')};
  if(map[name]){if(toolWrites(name,a))write(caller);return kernel.dispatch({...a,op:map[name],expectedKbId:kbId},session);}
  if(name==='kb_flow_resolve')return engines.dispatch({...a,op:'flows.resolve'},{session});
  if(name==='kb_flow'){
   if(!['list','get','resolve','runs'].includes(a.action))write(caller);return normalizeToolResult(name,a,await engines.dispatch({...a,op:'flows.'+a.action},{session}));
  }
  if(name==='kb_parse'){
   if(!['source','requests','providers','jobs','job','result','submit','cancel','retry','land','test-connection','test-parse'].includes(a.action))throw error('FORBIDDEN','提供方程序、地址、凭据与外发策略只能由用户在设置页配置');
   if(a.sourcePath||a.attachmentId||a.sourceRef)throw error('FORBIDDEN','外部来源必须先由 DSH 验证当前会话权限');
   if(a.sourceRel&&hostAuthority!=='knowledge')throw error('FORBIDDEN','库内解析需要知识库会话授权');
   if(!['source','requests','providers','jobs','job','result'].includes(a.action))write(caller);if(a.sourceRel)await kernel.workbench.assertDisplay(a.sourceRel);
   if(a.action==='source')return {ok:true,sourceRel:a.sourceRel,external:false};
   const authorizedSource=sourceStage?await sourceFromStage(sourceStage,caller.id):undefined;
   return engines.dispatch({...a,op:'parse.'+a.action},{session,knowledge:hostAuthority==='knowledge',authorizedSource});
  }
  if(name==='kb_import'){
   if(a.action!=='status')write(caller);return engines.dispatch({...a,op:'import.'+a.action},{session});
  }
  throw error('CAPABILITY_UNSUPPORTED');
 };
}
