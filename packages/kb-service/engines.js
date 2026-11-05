import path from 'node:path';
import {createParsingService,createImportService,createFlowEngine} from '../kb-core/index.js';
import {error} from './io.js';

export function createEngines({kernel,stateDir,root,resourceRoot,online,invoke,notify,getWorkspace}){
 const parsing=createParsingService({stateDir,getCore:()=>kernel.core,getBinding:()=>kernel.core.status(),resourceRoot,onEvent:notify});
 const imports=createImportService({stateDir,getBaseConfig:()=>kernel.core.getConfig(),getCurrentCore:()=>kernel.core,getParsingService:()=>parsing,
  coreFactory:options=>{if(options.kbPath&&path.resolve(options.kbPath)!==path.resolve(root))throw error('FORBIDDEN','共库导入不能改变目标库');return kernel.core;},commitBinding:async()=>({ok:true,unchanged:true})});
 const flows=createFlowEngine({stateDir,core:kernel.core,targetId:'knowledge',delegate:async req=>{if(!online())throw error('HOST_UNAVAILABLE','DSH 离线，不能执行需要模型的流程');return invoke('flow.delegate',{task:req.task,kind:req.kind,context:req.context,execution:req.execution,label:req.label},{signal:req.signal});},parseStep:async req=>{if(!online())throw error('HOST_UNAVAILABLE','DSH 离线，不能执行解析流程');return parsing.submit(req,{requestedBy:{via:'flow'}});}});
 async function dispatch(a,{admin=false,session='host-ui',knowledge=false,authorizedSource}={}){
  const op=a.op;
  if(op.startsWith('flows.')){
   const action=op.slice(6)==='set-enabled'?'enable':op.slice(6);if(['run','prepare-conversation'].includes(action)&&!online())throw error('HOST_UNAVAILABLE','DSH 离线，模型流程暂不可用');
   if(action==='list')return flows.list({includeArchived:a.includeArchived});if(action==='get')return flows.get(a.id);if(action==='resolve')return flows.resolve(a.text);if(action==='save')return flows.save(a);if(action==='enable')return flows.setEnabled(a.id,a.enabled);if(action==='archive')return flows.archive(a.id,a.restored);if(action==='delete')return flows.archive(a.id);if(action==='run'){const r=await flows.start(a);if(r.run){r.run={...r.run};delete r.run.promise;}return r;}if(action==='cancel')return flows.cancel(a.runId??a.id);if(action==='runs')return flows.runs({flowId:a.flowId??a.id,runId:a.runId,limit:a.limit});if(action==='prepare-conversation'){const r=await flows.prepareConversation(a);return r.ok?{...r,...getWorkspace()}:r;}if(action==='models')return online()?invoke('models',{}):{ok:false,groups:[],reason:'HOST_UNAVAILABLE'};
  }
  if(op.startsWith('parse.')){
   const action=op.slice(6),manage={viaAdmin:admin},requestedBy={via:admin?'ui':'tool',session},owns=j=>admin||knowledge&&!j.source?.external||j.requestedBy?.session===session;
   const filter=async jobs=>kernel.workbench.filterJobs(jobs.filter(owns));
   if(a.jobId&&!admin){const j=await parsing.readJob(a.jobId);if(!j||!owns(j))throw error('FORBIDDEN','解析任务不属于当前会话');}
   if(['submit','retry','test-parse'].includes(action)&&!online())throw error('HOST_UNAVAILABLE','DSH 离线，模型解析暂不可用');
   if(action==='providers')return parsing.providersPublic();if(action==='provider.save')return parsing.saveProvider(a.provider,{...manage,credentialInput:a.credentials,clearCredential:a.clearCredential===true});if(action==='provider.delete')return parsing.deleteProvider(a.providerId,manage);if(action==='default')return parsing.setDefaults({kind:a.kind,id:a.providerId},manage);if(action==='policy')return parsing.setPolicy(a.externalPolicy,manage);
   if(action==='scan.start')return parsing.scanStart({mode:a.mode,directory:a.directory},manage);if(action==='scan.status')return parsing.scanStatus(a.scanId,manage);if(action==='scan.cancel')return parsing.scanCancel(a.scanId,manage);if(action==='scan.add')return parsing.scanAdd(a.scanId,a.resultId,manage);
   if(action==='test-connection')return parsing.testConnection(a.providerId);if(action==='test-parse')return parsing.testParse(a,{requestedBy,authorizedSource});if(action==='submit')return parsing.submit(a,{requestedBy,authorizedSource});if(action==='jobs')return parsing.listJobs({...a,filter});if(action==='requests')return parsing.listRequests({...a,filter:async rows=>rows.filter(owns)});if(action==='job')return {ok:true,job:await parsing.publicJob(await parsing.readJob(a.jobId))};if(action==='result')return parsing.readResult(a.jobId,a);if(action==='cancel')return parsing.cancel(a.jobId,{by:requestedBy});if(action==='retry')return parsing.retry(a.jobId,{reason:'共享界面重试'});if(action==='land')return parsing.land(a.jobId,a);
  }
  if(op.startsWith('import.')){
   const action=op.slice(7);if(action==='status')return imports.status(a);if(action==='waiting')return imports.waiting(a);if(action==='plan'){if(a.mode!=='copy'&&path.resolve(a.source??'')!==path.resolve(root))throw error('BINDING_CHANGED','请使用复制导入，原位置挂载需要先连接目标库');return imports.plan({...a,current:await kernel.core.status()});}if(action==='start'||action==='run')return imports.start(a);if(action==='cancel')return imports.cancel(a);if(action==='parse'){if(!online())throw error('HOST_UNAVAILABLE');return imports.parseItem(a,{requestedBy:{via:admin?'ui':'tool',session}});}
  }
  throw error('BAD_REQUEST','未知引擎接口');
 }
 const gatedParsing=new Proxy(parsing,{get(target,key){const value=Reflect.get(target,key);if(['submit','testParse','retry'].includes(key))return (...args)=>{if(!online())throw error('HOST_UNAVAILABLE','DSH 离线，模型解析暂不可用');return value.apply(target,args)};return typeof value==='function'?value.bind(target):value;}});
 return {async upgradeBusy(){const [running,queued,imported]=await Promise.all([parsing.listJobs({status:'running',limit:1}),parsing.listJobs({status:'queued',limit:1}),imports.status()]);return !!(running.warning||queued.warning||running.total>0||queued.total>0||imported.imports?.some(x=>x.running)||flows.activeRuns().length);},parsing:gatedParsing,imports,flows,dispatch,async recover(){await parsing.recover();},dispose(){flows.dispose?.();parsing.dispose?.();}};
}
