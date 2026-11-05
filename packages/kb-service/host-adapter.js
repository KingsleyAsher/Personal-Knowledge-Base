import {createHostUpdates} from './host-updates.js';
import {publishKnowledgeMemory} from './memory-sync.js';
import {atomic,readJson,serialQueue} from './io.js';
import os from 'node:os';
import {AsyncLocalStorage} from "node:async_hooks";
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { connectService } from './client.js'
import { randomUUID } from 'node:crypto'
import {createInboxHost} from './inbox-host.js'
import {connectRuntime,defaultServiceHome} from './runtime.js'
import {exportPluginVector} from './vector-profiles.js'
import {startDshHostBridge} from './dsh-host.js'
import {startDesktopHostLinks} from './desktop-host-links.js'
import {createParseSourceAuthority} from '../kb-core/src/parse-source-authority.js'
import {createFlowWorkspaceManager} from '../kb-core/src/flow-workspace.js'
import {registerHostAssets} from './host-assets.js'
// Called only by an explicitly configured Host. It never starts an embedded writer.
export async function mountServiceHost(ctx, config, { isLiveKnowledgeGrant, gatewayApply, createCitationGuard, build, getFlowWorkspace,legacyStateDir,profileDir,library,python='python' }) {
  const definitions = JSON.parse(await readFile(new URL('./tool-definitions.json', import.meta.url),'utf8'))
  const runtime=config.serviceConnection?null:await connectRuntime({library,home:config.shared?.home??defaultServiceHome(),python:config.shared?.python??python,kind:'dsh-adapter',candidateRoot:config.shared?.candidateRoot??process.env.KB_SHARED_CANDIDATE_ROOT,required:['workspace.read','providers.get','host.bridge']})
  const primaryClient=runtime?.client??await connectService({...config.serviceConnection,kind:'dsh-adapter'}),routing=new AsyncLocalStorage();const client=new Proxy(primaryClient,{get(target,key){const source=routing.getStore()??target,value=Reflect.get(source,key);return typeof value==='function'?value.bind(source):value}})
  if(createCitationGuard){const guard=createCitationGuard({validate:(operation,agentId)=>{const target=desktopLinks?.clientForAgent(ctx.get('agents')?.get(agentId));if(target===null)throw Error('该会话知识库已断开');return (target??primaryClient).call('workspace.read',{operation});},log:message=>console.warn('[kb-citations] '+message)});ctx.effect(()=>ctx.on('agent/turn-stopping',guard),'kb-service: final citation check')}
  if(legacyStateDir)try{const s=await client.call('host.tool',{name:'kb_status',input:{}}),provider=await exportPluginVector({stateDir:legacyStateDir,root:s.kbPath,kbId:s.kbId,sourceId:'profile:'+path.basename(profileDir??legacyStateDir)});if(provider)await client.call('providers.syncPlugin',provider)}catch{/* Existing shared settings remain authoritative. */}
  const inboxHost=createInboxHost({client,getLLM:()=>ctx.get('llm'),getWorkspace:getFlowWorkspace})
  const routeFile=path.join(legacyStateDir??profileDir??path.join(os.homedir(),'.dsh/knowledge-desktop-client'),'desktop-session-libraries.json'),sessionOwners=await readJson(routeFile,{}),saveRoute=serialQueue();
  const primaryId=primaryClient.welcome.library.instanceId;
  const recordSession=(instanceId,id)=>saveRoute(async()=>{sessionOwners[id]=instanceId;await atomic(routeFile,sessionOwners);});
  const ownerFor=id=>sessionOwners[id]&&sessionOwners[id]!==primaryId?sessionOwners[id]:undefined;
  const workspaceManager=createFlowWorkspaceManager({getRegistry:()=>controllerScope.get('workspaceRegistry'),isolated:true,displayName:'知识库客户端',singleName:true});
  let nativeBridge,desktopLinks,bridgeTimer,bridgeError='',controllerScope
  const memoryListeners=new Set();
  const sharedStatus=async()=>({...await client.call('host.tool',{name:'kb_status',input:{}}),runtimeMode:'service',inboxServerManaged:!!nativeBridge,dshConnection:{controller:!!controllerScope,error:bridgeError}})
  let starting=false
  async function ensureBridge(){if(starting||nativeBridge||!controllerScope)return;starting=true;try{const s=await sharedStatus(),workspace=await workspaceManager.ensure(library);nativeBridge=startDshHostBridge({client,ctx:controllerScope,workspace,ensureWorkspace:()=>workspaceManager.ensure(library),ownsSession:id=>!sessionOwners[id]||sessionOwners[id]===primaryId,onSessionCreated:id=>recordSession(primaryId,id),libraryRoot:s.kbPath,label:'DSH · '+path.basename(profileDir??'当前 Host'),onError:e=>{bridgeError=e.code??e.message;}});bridgeError=''}catch(e){if(bridgeError!==e.message)console.warn('[kb-service] DSH bridge pending:',e.message);bridgeError=e.message;}finally{starting=false}}
  ctx.inject(['sessionController','workspaceRegistry','llm'],scope=>{controllerScope=scope;void ensureBridge();desktopLinks=startDesktopHostLinks({ctx:scope,python,connectRuntime,startBridge:startDshHostBridge,primaryRoot:library,ownerFor,recordSession,workspaceFor:()=>workspaceManager.ensure(library),onLibraryEvent:event=>{if(event.event!=='memory.changed')for(const listener of memoryListeners)listener(event)},onError:e=>{bridgeError=e.code??e.message;}});scope.effect(()=>()=>{void desktopLinks?.dispose();nativeBridge?.dispose();nativeBridge=null;controllerScope=null},'kb-service: detach native Host')})
  bridgeTimer=setInterval(()=>void ensureBridge(),1000);bridgeTimer.unref?.();void ensureBridge()
  ctx.effect(()=>()=>{clearInterval(bridgeTimer);nativeBridge?.dispose()},'kb-service: native DSH bridge')
  publishKnowledgeMemory(ctx,(operation,context)=>{
    const agent=context?.session?ctx.get('agents')?.get(context.session):null;
    if(context?.session&&!agent)throw Error('knowledge_memory_session_unavailable');
    if(agent&&ownerFor(agent.id)&&!desktopLinks)throw Error('knowledge_memory_library_disconnected');
    const target=agent?desktopLinks?.clientForAgent(agent):undefined;
    if(target===null)throw Error('knowledge_memory_library_disconnected');
    return (target??primaryClient).call('workspace.read',{operation});
  },listener=>{memoryListeners.add(listener);const off=primaryClient.subscribe(ev=>{if(ev.event!=='memory.changed')listener(ev)});return()=>{off();memoryListeners.delete(listener)}});
  let connected = true
  ctx.effect(() => () => { connected=false;nativeBridge?.dispose();void runtime?.close();client.close() }, 'kb-service: close Host connection')
  function trusted(exec,name,input) {
    if (!exec) return true // direct trusted Host/UI invocation, no wire caller claims
    const agent = exec.agent, agents = ctx.get('agents')
    if (!agent || agents?.get(agent.id)!==agent) return false
    const header=agent.session?.header??{}
    if(!(name==='kb_import'&&input?.action==='parse'))return true
    return isLiveKnowledgeGrant(agent,agents) || header.agentPreset==='knowledge' && header.origin!=='subagent' && !header.parentSession
  }
  function knowledge(exec){const agent=exec?.agent;if(!agent||ctx.get('agents')?.get(agent.id)!==agent)return false;const h=agent.session?.header??{};return isLiveKnowledgeGrant(agent,ctx.get('agents'))||h.agentPreset==='knowledge'&&h.origin!=='subagent'&&!h.parentSession}
  const parseSources=createParseSourceAuthority({getAgents:()=>ctx.get('agents'),getBinding:()=>client.call('host.tool',{name:'kb_status',input:{}}),getController:()=>ctx.get('sessionController'),knowledgeCaller:exec=>knowledge(exec)?{ok:true}:{ok:false,reason:'FORBIDDEN',detail:'库内资料需要知识库会话授权'}})
  async function parseInput(input,exec){
    const a={...input};if(!['source','submit','test-parse'].includes(a.action))return {input:a};
    if([a.sourcePath,a.sourceRef,a.sourceRel,a.attachmentId].filter(Boolean).length>1)throw Error('请选择一种解析来源');
    let ref;if(a.attachmentId)ref=await parseSources.issueAttachment(a.attachmentId,exec);else if(a.sourcePath)ref=await parseSources.issue(a.sourcePath,exec);
    if(ref&&a.action==='source')return {immediate:{ok:true,action:'source',...ref}};
    if(ref?.sourceRel)a.sourceRel=ref.sourceRel;
    const token=a.sourceRef??ref?.sourceRef;delete a.attachmentId;delete a.sourcePath;delete a.sourceRef;
    if(!token)return {input:a};
    const source=await parseSources.resolve(token,exec),data=source.data??await readFile(source.abs);if(data.length>64*1024*1024)throw Error('外部解析原件超过 64 MiB，请分段导入');
    let stageId;for(let at=0;at<Math.max(1,data.length);at+=220000){const r=await client.call('desktop.importStage',{name:source.name,data:data.subarray(at,at+220000).toString('base64'),final:at+220000>=data.length,...(stageId?{stageId}:{})});stageId=r.stageId;}
    return {input:a,sourceStage:stageId};
  }
  const tools = ctx.get('tools')
  if (!tools) throw Error('Host tools service is required')
  for (const definition of definitions) {
    const entry = { name:definition.name, description:'共享知识库服务：'+definition.name, parameters:definition.parameters,
      output:{schema:definition.outputSchema,render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      isConcurrencySafe:()=>false,
      async execute(input,exec) {const target=desktopLinks?.clientForAgent(exec?.agent);if(target===null)return {ok:false,reason:'HOST_UNAVAILABLE'};return routing.run(target??primaryClient,async()=>{
        if (!trusted(exec,definition.name,input)) return {ok:false,reason:'CALLER_UNVERIFIED'}
        try {
          if (!connected) return {ok:false,reason:'HOST_UNAVAILABLE'}
          const requestId = input?.requestId ? 'host-'+definition.name+'-'+input.requestId : randomUUID()
          const parsed=definition.name==='kb_parse'?await parseInput(input??{},exec):{input:input??{}};if(parsed.immediate)return parsed.immediate
          const value = await client.call('host.tool',{name:definition.name,input:parsed.input,hostAuthority:knowledge(exec)?'knowledge':'workspace',...(parsed.sourceStage?{sourceStage:parsed.sourceStage}:{}),...(exec?.agent?.id?{hostSession:String(exec.agent.id)}:{})},{requestId})
          if (definition.name==='kb_status') return {...value,build,service:{connected:true,...client.welcome.library}}
          return value
        } catch(e) {return {ok:false,reason:e.code??'HOST_UNAVAILABLE',error:e.message}}
      });},
    }
    ctx.effect(()=>tools.register(entry),'kb-service: '+entry.name)
  }
  if (gatewayApply && !ctx.get('tools').get('knowledge_request')) {
    const gateway={...(config.gateway??{})}
    gateway.targets ??= [{id:'knowledge',preset:'knowledge',cwd:'',describe:'知识库管家',toolName:'knowledge_request'}]
    gateway.resolveTarget=async target=>{if(target.id!=='knowledge')return target;const status=await client.call('host.tool',{name:'kb_status',input:{}});if(!status.bound||!status.kbPath)throw Error('Shared library unavailable');return {...target,preset:'knowledge',cwd:status.kbPath}}
    gatewayApply(ctx,gateway)
  }
  const send=(res,status,value)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(value))}
  const sameOrigin=req=>req.headers['sec-fetch-site']!=='cross-site' && (!req.headers.origin || (()=>{try{return new URL(req.headers.origin).host===req.headers.host}catch{return false}})())
  const updates=createHostUpdates({ctx,build,profileDir,quiesce:runtime?()=>runtime.prepareUpgrade():null,resume:runtime?()=>runtime.resume():null});
  const server=ctx.get('webServer')
  if(server?.register) {
    await registerHostAssets({ctx,server,root:path.resolve(import.meta.dirname,'../..'),client,send,sameOrigin})
    ctx.effect(()=>server.register({kind:'exact',path:'/kb-core/api',handler:async(req,res)=>{
      if(!sameOrigin(req)) return send(res,403,{ok:false,code:'FORBIDDEN'})
      try {
        if(req.method==='GET') return send(res,200,{ok:true,status:{...await sharedStatus(),build}})
        if(req.method!=='POST'||String(req.headers['content-type']??'').split(';')[0].trim()!=='application/json') return send(res,403,{ok:false,code:'FORBIDDEN'})
        let size=0;const chunks=[]
        for await (const chunk of req){size+=chunk.length;if(size>900000) return send(res,413,{ok:false,code:'BAD_REQUEST'});chunks.push(chunk)}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const aliases={'import-plan':'import.plan','import-run':'import.run','import-status':'import.status','import-cancel':'import.cancel','import-waiting':'import.waiting','import-parse':'import.parse'};body.op=aliases[body.op]??body.op
        if(body.op==='updates.check')return send(res,200,await updates.check(body))
        if(body.op==='updates.install')return send(res,200,await updates.install(body))
        if(body.op==='updates.status')return send(res,200,await updates.status())
        if(body.op==='updates.prepare')return send(res,200,await updates.prepare(body))
        if(body.op==='pick-dir'){const cap=ctx.get('directoryPicker')?.capability();if(cap?.kind!=='native'||!cap.pick)return send(res,200,{ok:false,reason:'no-directory-picker'});const path=await cap.pick(AbortSignal.timeout(300000));return send(res,200,{ok:true,path,canceled:!path});}
        if(body.op==='atlas.file-action'){const f=await client.call('desktop.stat',{path:body.path}),s=await sharedStatus(),c=controllerScope?.get('sessionController');if(!c?.openWorkspacePath)throw Error('DSH 本机文件操作未连接');return send(res,200,{ok:true,...await c.openWorkspacePath({path:path.join(s.kbPath,f.path),action:body.action},AbortSignal.timeout(15000))});}
        if(body.op==='status') return send(res,200,{ok:true,status:await sharedStatus()})
        const inbox=await inboxHost(body);if(inbox)return send(res,200,inbox)
        if(body.op==='index.policy.set')return send(res,200,await client.call('policy.setIndexExcluded',{paths:body.paths??[body.path],excluded:body.excluded,expectedRevision:body.expectedPolicyRevision},{requestId:body.requestId??randomUUID()}))
        return send(res,200,await client.call('adapter.dispatch',{operation:body},{requestId:body.requestId??randomUUID()}))
      }catch(e){send(res,200,{ok:false,code:e.code??'HOST_UNAVAILABLE',error:e.message})}
    }}),'kb-service: existing workbench API')
    ctx.effect(()=>server.register({kind:'exact',path:'/kb-core/workbench-events',handler:async(req,res)=>{
      if(req.method!=='GET'||!sameOrigin(req))return send(res,403,{ok:false})
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'})
      res.write(': shared-service\n\n')
      const off=client.subscribe(event=>res.write('data: '+JSON.stringify(event)+'\n\n'))
      try{await client.call('events.subscribe')}catch(e){res.write('data: '+JSON.stringify({type:'service-unavailable',code:e.code})+'\n\n')}
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.once('close',()=>{off();clearInterval(heartbeat)})
    }}),'kb-service: existing workbench events')
  }
  return {mode:'service',tools:definitions.map(x=>x.name),client}
}
