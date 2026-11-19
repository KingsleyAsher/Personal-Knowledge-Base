import path from 'node:path';
import {waitForLegacy243,LEGACY_243_BUILD} from './legacy-handoff.js';
import os from 'node:os';
import {mkdir,open,unlink,realpath,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {atomic,readJson,native,error} from './io.js';
import {libraryIdentity} from './service.js';
import {connectService} from './client.js';
import {launchService} from './launcher.js';
import {runtimeBuild} from './build.js';
import {canShareRuntime} from './compatibility.js';
import {compareKnowledgeVersions,parseKnowledgeVersion} from '../kb-contracts/version-policy.js';

export const defaultServiceHome=()=>process.env.KB_SHARED_HOME||path.join(os.homedir(),'.dsh','shared-knowledge-services');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const olderWorker=(health,preferredVersion)=>Boolean(parseKnowledgeVersion(preferredVersion)&&
 parseKnowledgeVersion(health.coreVersion,{allowLegacyPreview:true})&&compareKnowledgeVersions(preferredVersion,health.coreVersion)>0);

async function waitForClose(dir,python,receipt){
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  const done=await readJson(path.join(dir,'last-close.json'),null);
  if(done?.bootId===receipt.bootId&&done.clean&&await native(python,'birth',{pid:receipt.pid})===null)return receipt;
  await pause(150);
 }
 throw error('STATE_BUSY','旧知识库服务尚未确认安全退出，未启动第二个服务');
}
// Both applications use this owner election and the same SID-protected home.
// Discovery is never authorization: every connection authenticates the library.
async function bootstrapRuntime({library,home=defaultServiceHome(),python='python',node=process.execPath,kind='desktop',candidateRoot,allowFreshSynthetic=true,allowFreshShared=false,freshPolicy,required=[],sources={},preferredVersion,onEvent=()=>{}}){
 const identity=await libraryIdentity(library),base=path.resolve(home),privateDir=path.join(base,identity.instanceId),readyFile=path.join(privateDir,'ready.json');
 await mkdir(base,{recursive:true});await native(python,'private-dir',{path:privateDir});
 const build=await runtimeBuild(),ownerFile=path.join(identity.root,'.kbmeta/service-owner.json'),lockFile=path.join(privateDir,'launch.lock'),owner=randomUUID();
 let lock,client,off;
 async function connect(){const ready=await readJson(readyFile,null);if(!ready)return null;let c;try{c=await connectService({pipe:ready.pipe,python,credentialFile:path.join(privateDir,'bootstrap.dpapi.json'),kind});const h=await c.call('service.health');if(h.library.instanceId!==identity.instanceId)throw error('BINDING_CHANGED');return {client:c,health:h};}catch(e){c?.close();if(['BINDING_CHANGED','UNAUTHORIZED'].includes(e.code))throw e;return null;}}
 const freshShared=async()=>{
  if(!allowFreshShared)return false;
  const meta=await readJson(path.join(identity.root,'.kbmeta/kb.json'),null);
  return meta?.kbId===identity.kbId&&meta.installState==='complete'&&meta.freshSharedSetup===true;
 };
 const until=Date.now()+90000;
 let occupied=false;
 async function releaseLock(){
   if(!lock)return;
   const handle=lock;lock=null;
   await handle.close();
   if((await readJson(lockFile,null))?.owner===owner)await unlink(lockFile).catch(()=>{});
 }
 async function claimLock(){
   const birth=await native(python,'birth',{pid:process.pid});
   try{lock=await open(lockFile,'wx');await lock.writeFile(JSON.stringify({owner,pid:process.pid,birth}));await lock.sync();return true;}
   catch(e){
     if(e.code!=='EEXIST')throw e;
     const held=await readJson(lockFile,null).catch(e=>{if(e instanceof SyntaxError)return null;throw e});
     if(held&&await native(python,'birth',{pid:held.pid})!==held.birth){
       const latest=await readJson(lockFile,null);
       if(latest?.owner===held.owner)await unlink(lockFile).catch(()=>{});
     }
     return false;
   }
 }
 try{
  while(Date.now()<until){
   const live=await connect();
   if(live&&!live.health.active){
     const held=await readJson(lockFile,null);
     // Let the elected legacy launcher finish its first activation. It cannot
     // recognize a duplicate commit if a newer peer activates its service first.
     if(held&&held.owner!==owner&&await native(python,'birth',{pid:held.pid})===held.birth){
       live.client.close();await pause(150);continue;
     }
   }
   if(live&&canShareRuntime(live.health,build,required)&&!olderWorker(live.health,preferredVersion)){client=live.client;break;}
   if(live&&!live.health.supported.includes('service.prepareUpgrade')&&live.health.serviceBuildId===LEGACY_243_BUILD){await waitForLegacy243({health:live.health,client:live.client,privateDir,python});continue;}
   if(live){
     const preferred=olderWorker(live.health,preferredVersion);
     let receipt;
     try {
       if(live.health.connections>1&&!(kind==='dsh-adapter'&&live.health.upgradeHandoff===1)){
         if(!preferred)throw error('SERVICE_UPGRADE_REQUIRED','当前共享服务与本程序不兼容，其他连接仍在使用旧服务');
       }else if(!live.health.supported.includes('service.prepareUpgrade')){
         throw error('CAPABILITY_UNSUPPORTED','旧服务没有安全停服协议，请使用过渡安装入口');
       }else if(await claimLock()){
         try{receipt=await live.client.call('service.prepareUpgrade')}catch(e){
           if(e.code!=='STATE_BUSY'||!preferred)throw e;
         }
       }
     }finally{live.client.close()}
     if(receipt){await waitForClose(privateDir,python,receipt);break;}
     await releaseLock();occupied=true;await pause(750);continue;
   }
   const heldOwner=await readJson(ownerFile,null);
   if(heldOwner&&await native(python,'birth',{pid:heldOwner.pid})===heldOwner.birth){occupied=true;await pause(500);continue;}
   if(await claimLock())break;
   await pause(150);
  }
  if(!client&&lock){
   const marker=await readJson(path.join(identity.root,'.desktop-preview.json'),null),managed=await readJson(path.join(identity.root,'.kbmeta/service-mode.json'),null);
   if(!managed&&!(allowFreshSynthetic&&marker?.synthetic===true)&&!await freshShared())throw error('RECOVERY_REQUIRED','已有知识库需先完成可审阅的共库迁移；未自动切换旧插件写入者。');
   const configurationPath=path.join(privateDir,'launch.json');await atomic(configurationPath,{library:identity.root,privateDir,python,sources,recoverOwner:true,idleMs:30000,...(await freshShared()&&freshPolicy?{freshPolicy}:{}),...(candidateRoot?{desktopRoot:await realpath(candidateRoot)}:{})});
   await launchService({configurationPath,logDirectory:privateDir,node});
   while(Date.now()<until){const live=await connect();if(live){client=live.client;break;}await pause(100);}
  }
  if(!client)throw occupied?error('STATE_BUSY','旧知识库服务仍在处理任务或退出中，暂未接管'):error('HOST_UNAVAILABLE','本地知识库服务启动超时，未启用第二个写入者');
  if(!(await client.call('service.health')).active){
   const marker=await readJson(path.join(identity.root,'.desktop-preview.json'),null);
   if(!(allowFreshSynthetic&&marker?.synthetic===true)&&!await freshShared())throw error('RECOVERY_REQUIRED','未完成的共库交接需要从原入口继续');
   try{await client.call('migration.commit',{planId:'fresh',quiescent:true});}
   catch(e){
     // A compatible older service can reject the second fresh activation after
     // another connector has already committed. Verify the authenticated owner;
     // do not replay migration or suppress other failures.
     if(e.code!=='CONFLICT')throw e;
     const health=await client.call('service.health');
     if(!health.active||health.library.instanceId!==identity.instanceId)throw e;
   }
  }
  await client.call('events.subscribe');off=client.subscribe(onEvent);
  const serviceHealth=await client.call('service.health');
  await mkdir(base,{recursive:true});await atomic(path.join(privateDir,'discovery.json'),{schemaVersion:1,...identity,buildId:serviceHealth.serviceBuildId,clientBuildId:build,privateDir,kind,updatedAt:Date.now()});
  return {client,privateDir,identity,async close(){off?.();client.close();}};
 }catch(e){off?.();client?.close();throw e;}
 finally{await releaseLock();}
}

export async function connectRuntime(options){
 const listeners=new Set(),notify=frame=>{options.onEvent?.(frame);for(const fn of listeners)try{fn(frame)}catch{}},opts={...options,onEvent:notify};
 let link=await bootstrapRuntime(opts),lastWelcome=link.client.welcome,reconnecting,closed=false,disposed=false,probing=false,draining=false,reconnectError;
 const signal=(state,code)=>notify({event:'connection.changed',data:{state,...(code?{code}:{})}});
 async function reconnect(){
  if(closed||reconnecting)return reconnecting;
  reconnecting=(async()=>{await link?.close().catch(()=>{});link=null;signal('offline');try{const next=await bootstrapRuntime(opts);if(closed){await next.close();return;}link=next;lastWelcome=next.client.welcome;reconnectError=undefined;signal('ready');notify({event:'snapshot.required',data:{}});}catch(e){reconnectError=e;signal('offline',e.code);}finally{reconnecting=null;}})();return reconnecting;
 }
 const tick=()=>{if(closed||probing||draining)return;if(!link){void reconnect();return;}probing=true;void link.client.call('service.health').catch(e=>{if(e.transport)void reconnect()}).finally(()=>{probing=false});};let timer=setInterval(tick,5000);timer.unref?.();
 const runtime={
  async resume(){if(disposed||!closed)return;closed=false;await reconnect();timer=setInterval(tick,5000);timer.unref?.();},
   async withUpdateLock(task){
     if(!link||closed)throw error('HOST_UNAVAILABLE','知识库连接尚未就绪');
     const file=path.join(link.privateDir,'launch.lock'),owner=randomUUID(),python=options.python??'python';
     const birth=await native(python,'birth',{pid:process.pid});
     let handle;
     try{
       try{handle=await open(file,'wx')}catch(e){if(e.code==='EEXIST')throw error('STATE_BUSY','另一个客户端正在交接知识库服务');throw e}
       await handle.writeFile(JSON.stringify({owner,pid:process.pid,birth}));await handle.sync();
       return await task();
     }finally{
       if(handle){await handle.close();if((await readJson(file,null))?.owner===owner)await unlink(file)}
     }
   },
   async prepareUpgrade(){
     if(!link||closed)throw error('HOST_UNAVAILABLE');
     if(draining)throw error('STATE_BUSY','知识库服务正在安全交接');
     draining=true;
     try{
       const health=await link.client.call('service.health');
       if(!health.supported.includes('service.prepareUpgrade'))throw error('CAPABILITY_UNSUPPORTED','旧服务不支持安全停服，请使用过渡安装入口');
       const receipt=await link.client.call('service.prepareUpgrade');
       const dir=link.privateDir;closed=true;clearInterval(timer);signal('offline');await link.close();link=null;
       return await waitForClose(dir,options.python??'python',receipt);
     }finally{draining=false;}
   },
   get privateDir(){return link?.privateDir??path.join(path.resolve(options.home??defaultServiceHome()),lastWelcome.library.instanceId)},
  get identity(){return lastWelcome.library},
  client:{get welcome(){return link?.client.welcome??structuredClone(lastWelcome)},async call(method,args={},opts={}){if(!link||closed){if(!closed)void reconnect();throw Object.assign(error(reconnectError?.code??'SERVICE_STARTING',reconnectError?.message??(closed?'知识库正在安全更新，正在等待新版接管':'知识库服务正在建立连接')),{transport:true});}try{return await link.client.call(method,args,opts);}catch(e){if(!draining&&(e.transport||e.code==='UNAUTHORIZED'))void reconnect();throw e;}},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){void runtime.close();}},
  async close(){disposed=true;closed=true;clearInterval(timer);listeners.clear();await link?.close();link=null;},
 };return runtime;
}

// First binding reserves an empty library before any embedded writer can use it.
export async function selectFirstSharedLibrary({core,library,python,home,node}){
 const config=await core.getConfigFresh();
 if(config.kbPath)throw error('BINDING_CHANGED','当前已有知识库绑定，请刷新后重试');
 const marker=await readJson(path.join(library,'.kbmeta/service-mode.json'),null);
 if(!marker){
  const init=await core.initializeLibrary(library,{freshSetup:true});
  if(!init.ok)throw error('RECOVERY_REQUIRED',init.error??init.detail??'无法建立新共享库');
 }
 const freshPolicy={categories:config.categories,privateDirs:config.privateDirs,excludeFromSearch:config.excludeFromSearch};
 const runtime=await connectRuntime({library,python,home,node,kind:'dsh-adapter',allowFreshSynthetic:false,allowFreshShared:true,freshPolicy});
 try{
  const bound=await core.bindSharedLibrary(library,runtime.identity,config.revision);
  if(!bound.ok)throw error('BINDING_CHANGED',bound.note??bound.detail??'绑定发生变化，请刷新后重试');
  return {...bound,action:marker?'attached':'created',restartRequired:true,note:'共享知识库已就绪。请完全退出并重新打开 DSH，以连接同一个库。'};
 }finally{await runtime.close()}
}
