import path from 'node:path';
import os from 'node:os';
import {mkdir,open,unlink,realpath,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {atomic,readJson,native,error} from './io.js';
import {libraryIdentity} from './service.js';
import {connectService} from './client.js';
import {launchService} from './launcher.js';
import {runtimeBuild} from './build.js';

export const defaultServiceHome=()=>process.env.KB_SHARED_HOME||path.join(os.homedir(),'.dsh','shared-knowledge-services');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Both applications use this owner election and the same SID-protected home.
// Discovery is never authorization: every connection authenticates the library.
async function bootstrapRuntime({library,home=defaultServiceHome(),python='python',node=process.execPath,kind='desktop',candidateRoot,allowFreshSynthetic=true,required=[],sources={},onEvent=()=>{}}){
 const identity=await libraryIdentity(library),base=path.resolve(home),privateDir=path.join(base,identity.instanceId),readyFile=path.join(privateDir,'ready.json');
 await mkdir(base,{recursive:true});await native(python,'private-dir',{path:privateDir});
 const build=await runtimeBuild(),lockFile=path.join(privateDir,'launch.lock'),owner=randomUUID();
 let lock,client,off;
 async function connect(){const ready=await readJson(readyFile,null);if(!ready)return null;let c;try{c=await connectService({pipe:ready.pipe,python,credentialFile:path.join(privateDir,'bootstrap.dpapi.json'),kind});const h=await c.call('service.health');if(h.library.instanceId!==identity.instanceId)throw error('BINDING_CHANGED');return {client:c,health:h};}catch(e){c?.close();if(['BINDING_CHANGED','UNAUTHORIZED'].includes(e.code))throw e;return null;}}
 const until=Date.now()+20000;
 try{
  while(Date.now()<until){
   const live=await connect();
   if(live&&required.every(m=>live.health.supported.includes(m))&&live.health.serviceBuildId===build){client=live.client;break;}
   if(live){if(live.health.connections>1){live.client.close();throw error('SERVICE_UPGRADE_REQUIRED','同库仍有其他版本在线，请先退出旧候选版本，原窗口与原件未改动。');}await live.client.call('service.shutdown');live.client.close();await pause(250);continue;}
   try{lock=await open(lockFile,'wx');await lock.writeFile(JSON.stringify({owner,pid:process.pid,birth:await native(python,'birth',{pid:process.pid})}));await lock.sync();break;}
   catch(e){if(e.code!=='EEXIST')throw e;const held=await readJson(lockFile,null).catch(e=>{if(e instanceof SyntaxError)return null;throw e});if(held&&await native(python,'birth',{pid:held.pid})!==held.birth){const latest=await readJson(lockFile,null);if(latest?.owner===held.owner)await unlink(lockFile).catch(()=>{});}await pause(100);}
  }
  if(!client&&lock){
   const marker=await readJson(path.join(identity.root,'.desktop-preview.json'),null),managed=await readJson(path.join(identity.root,'.kbmeta/service-mode.json'),null);
   if(!managed&&!(allowFreshSynthetic&&marker?.synthetic===true))throw error('RECOVERY_REQUIRED','已有知识库需先完成可审阅的共库迁移；未自动切换旧插件写入者。');
   const configurationPath=path.join(privateDir,'launch.json');await atomic(configurationPath,{library:identity.root,privateDir,python,sources,recoverOwner:true,idleMs:30000,...(candidateRoot?{desktopRoot:await realpath(candidateRoot)}:{})});
   await launchService({configurationPath,logDirectory:privateDir,node});
   while(Date.now()<until){const live=await connect();if(live){client=live.client;break;}await pause(100);}
  }
  if(!client)throw error('HOST_UNAVAILABLE','本地知识库服务启动超时，未启用第二个写入者');
  if(!(await client.call('service.health')).active)await client.call('migration.commit',{planId:'fresh',quiescent:true});
  await client.call('events.subscribe');off=client.subscribe(onEvent);
  await mkdir(base,{recursive:true});await atomic(path.join(privateDir,'discovery.json'),{schemaVersion:1,...identity,buildId:build,privateDir,kind,updatedAt:Date.now()});
  return {client,privateDir,identity,async close(){off?.();client.close();}};
 }catch(e){off?.();client?.close();throw e;}
 finally{await lock?.close();if(lock&&(await readJson(lockFile,null))?.owner===owner)await unlink(lockFile).catch(()=>{});}
}

export async function connectRuntime(options){
 const listeners=new Set(),notify=frame=>{options.onEvent?.(frame);for(const fn of listeners)try{fn(frame)}catch{}},opts={...options,onEvent:notify};
 let link=await bootstrapRuntime(opts),lastWelcome=link.client.welcome,reconnecting,closed=false;
 const signal=(state,code)=>notify({event:'connection.changed',data:{state,...(code?{code}:{})}});
 async function reconnect(){
  if(closed||reconnecting)return reconnecting;
  reconnecting=(async()=>{await link?.close().catch(()=>{});link=null;signal('offline');try{const next=await bootstrapRuntime(opts);if(closed){await next.close();return;}link=next;lastWelcome=next.client.welcome;signal('ready');notify({event:'snapshot.required',data:{}});}catch(e){signal('offline',e.code);}finally{reconnecting=null;}})();return reconnecting;
 }
 const timer=setInterval(()=>{if(closed)return;if(!link){void reconnect();return;}void link.client.call('service.health').catch(()=>void reconnect());},2000);timer.unref?.();
 const runtime={
  get privateDir(){return link?.privateDir??path.join(path.resolve(options.home??defaultServiceHome()),lastWelcome.library.instanceId)},
  get identity(){return lastWelcome.library},
  client:{get welcome(){return link?.client.welcome??structuredClone(lastWelcome)},async call(method,args={},opts={}){if(!link||closed){if(!closed)void reconnect();throw Object.assign(error('HOST_UNAVAILABLE','本地服务正在重新连接，原文与草稿已保留'),{transport:true});}try{return await link.client.call(method,args,opts);}catch(e){if(e.transport||e.code==='UNAUTHORIZED')void reconnect();throw e;}},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){void runtime.close();}},
  async close(){closed=true;clearInterval(timer);listeners.clear();await link?.close();link=null;},
 };return runtime;
}
