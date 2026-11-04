import {randomUUID} from 'node:crypto';

import path from 'node:path';
import {mkdir,realpath,readFile,writeFile,readdir,lstat,stat,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import os from 'node:os';
import {createFixture} from './fixture.js';
export async function createManager({dataDir,backendRoot,assetDir,python,node,send}){
 const {connectService}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-service/client.js')));
 const {connectRuntime}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-service/runtime.js')));
 const {detectPluginVectors,exportPluginVector}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-service/vector-profiles.js')));
 const {atomic,readJson,hash,native}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-service/io.js')));
 const sandbox=path.resolve(dataDir);await mkdir(path.join(sandbox,'libraries'),{recursive:true});
 let client,runtime,activeRoot,privateDir,subscription,retryTimer,connectionState='idle',configurationWarning='';
 const linkHome=process.env.KB_DESKTOP_LINK_HOME??path.join(os.homedir(),'.dsh/knowledge-desktop-links'),leaseFile=path.join(linkHome,randomUUID()+'.json');let leaseTimer;
 async function publishDshSelection(){if(!runtime?.identity||!activeRoot)return;await mkdir(path.dirname(linkHome),{recursive:true});await native(python,'private-dir',{path:linkHome});const grant=await grantFor(activeRoot);await atomic(leaseFile,{...runtime.identity,root:activeRoot,dataDir:sandbox,serviceHome:grant?.serviceHome??process.env.KB_SHARED_HOME??path.join(sandbox,'services'),synthetic:!grant,expiresAt:Date.now()+12000});}
 async function protectedRoot(){const profile=process.env.KB_PROFILE_HOME??path.join(os.homedir(),'.dsh/profiles'),binding=await readJson(path.join(profile,'desktop/kb-state/binding.json'),null);return binding?.kbPath?path.resolve(binding.kbPath):(await realGrants()).find(g=>g.profile==='desktop')?.root;}
 const sameRoot=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
 async function removeLibrary(root){root=await realpath(root);if(sameRoot(root,await protectedRoot()))throw Object.assign(Error('插件当前绑定的知识库不可移除'),{code:'FORBIDDEN'});const libraries=await listLibraries();if(!libraries.some(l=>sameRoot(l.root,root)))throw Error('该库不在客户端列表中');const active=sameRoot(root,activeRoot);if(active){const next=libraries.find(l=>!sameRoot(l.root,root));if(!next)throw Error('请先打开另一个知识库，再移除当前库');await openLibrary(next.root);}const grants=await realGrants(),removed=grants.find(g=>sameRoot(g.root,root));await atomic(path.join(sandbox,'real-library-grants.json'),grants.filter(g=>!sameRoot(g.root,root)));const hidden=await readJson(path.join(sandbox,'hidden-libraries.json'),[]);await atomic(path.join(sandbox,'hidden-libraries.json'),[...hidden.filter(p=>!sameRoot(p,root)),root]);if(removed?.instanceId)for(const name of ['workspaces','drafts']){const file=path.join(sandbox,'client',name+'.json'),value=await readJson(file,{});delete value[removed.instanceId];await atomic(file,value);}return {removed:true,active,filesDeleted:false};}
 async function reconnectDsh(){await publishDshSelection();let status;const until=Date.now()+8000;do{status=await call('dsh.status');if(status.online)return status;await new Promise(r=>setTimeout(r,250));}while(Date.now()<until);return {...status,message:'未检测到在线 DSH，请打开 DSH 后重连。'};}
 const notify=()=>send({type:'snapshot.required'});
 const inside=(base,p)=>{const r=path.relative(base,p);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
 const realGrants=()=>readJson(path.join(sandbox,'real-library-grants.json'),[]);
 const grantFor=async root=>(await realGrants()).find(g=>typeof g.root==='string'&&path.resolve(g.root).toLowerCase()===root.toLowerCase());
 async function ensureCandidate(root){
  const canonical=await realpath(root),base=await realpath(sandbox);
  if(!inside(base,canonical)){
   const grant=await grantFor(canonical);if(!grant)throw Object.assign(Error('此真实库尚未获得客户端授权'),{code:'FORBIDDEN'});const meta=await readJson(path.join(canonical,'.kbmeta/kb.json'),null),mode=await readJson(path.join(canonical,'.kbmeta/service-mode.json'),null),s=await stat(canonical,{bigint:true});
   const instance=hash([meta?.kbId,canonical.toLowerCase(),String(s.dev),String(s.ino)]).slice(0,40);
   if(!grant||grant.mode!=='shared-real'||grant.kbId!==meta?.kbId||grant.instanceId!==instance||mode?.instanceId!==instance||mode?.kbId!==meta?.kbId||mode?.state!=='active'||typeof grant.serviceHome!=='string')throw Object.assign(Error('此真实库尚未完成明确授权和共库迁移，未启动其他写入者'),{code:'FORBIDDEN'});
   return canonical;
  }
  const m=await readJson(path.join(canonical,'.desktop-preview.json'),null);
  if(m?.synthetic!==true)throw Object.assign(Error('不是候选虚构库'),{code:'FORBIDDEN'});return canonical;
 }
 async function openLibrary(root){
  root=await ensureCandidate(root);connectionState='connecting';send({type:'connection.changed',state:connectionState});
  clearTimeout(retryTimer);subscription?.();
  const real=await grantFor(root);
  let nextRuntime;try{nextRuntime=await connectRuntime({library:root,home:real?.serviceHome??process.env.KB_SHARED_HOME??path.join(sandbox,'services'),python,node,kind:'desktop',...(real?{allowFreshSynthetic:false}:{candidateRoot:sandbox}),required:['workspace.read','workspace.write','providers.get','host.bridge'],onEvent:event=>{if(event.event==='connection.changed'){connectionState=event.data.state;send({type:'connection.changed',...event.data});}else if(event.event==='dsh.event')send({type:'dsh.event',...event.data});else notify();}});}catch(e){connectionState=runtime?"ready":"offline";send({type:"connection.changed",state:connectionState});throw e;}
  await runtime?.close();runtime=nextRuntime;activeRoot=root;client=runtime.client;privateDir=runtime.privateDir;configurationWarning='';
  await client.call('desktop.restoreState');
  try{const profilesHome=process.env.KB_PROFILE_HOME??path.join(os.homedir(),'.dsh/profiles'),own=real?.profile?await exportPluginVector({stateDir:path.join(profilesHome,real.profile,'kb-state'),root,kbId:runtime.identity.kbId,sourceId:'profile:'+real.profile}):null,candidates=real?.profile?(own?[own]:[]):await detectPluginVectors({profilesHome,root,kbId:runtime.identity.kbId});
   if(candidates.length===1)await client.call('providers.syncPlugin',candidates[0]);else if(candidates.length>1)configurationWarning='检测到多个同库插件向量配置，请在连接设置中明确选择来源。';
  }catch{configurationWarning='插件向量配置未能安全读取；已保留当前配置，可连接 DSH 后共享或单独配置。';}
  connectionState='ready';await atomic(path.join(sandbox,'last-library.json'),{root});const hidden=await readJson(path.join(sandbox,'hidden-libraries.json'),[]);await atomic(path.join(sandbox,'hidden-libraries.json'),hidden.filter(p=>!sameRoot(p,root)));await publishDshSelection();clearInterval(leaseTimer);leaseTimer=setInterval(()=>void publishDshSelection().catch(()=>{}),3000);leaseTimer.unref?.();send({type:'connection.changed',state:connectionState});return status();
 }
 async function call(method,args={},opts={}){
  if(!client)throw Object.assign(Error('知识库服务未连接'),{code:'HOST_UNAVAILABLE'});
  const selectedClient=client,selectedRoot=activeRoot;
  const stillSelected=()=>{if(client!==selectedClient||activeRoot!==selectedRoot)throw Object.assign(Error('知识库已切换，请重新操作'),{code:'BINDING_CHANGED'});};
  try{const result=await selectedClient.call(method,args,opts);stillSelected();return result;}catch(e){
   stillSelected();
   if(e.code==='POLICY_CHANGED'&&['service.health','workspace.read','providers.get','dsh.status','inbox.list','inbox.organizeStatus','desktop.list','desktop.listSorted','desktop.stat','desktop.preview','desktop.trashPreview','desktop.editOriginal','desktop.search','desktop.trash','desktop.backups','document.readForEdit','relations.query','policy.get'].includes(method)){const result=await selectedClient.call(method,args,opts);stillSelected();return result;}
   if(e.transport||e.code==='UNAUTHORIZED'){connectionState='offline';send({type:'connection.changed',state:connectionState});}throw e;
  }
 }
 function status(){return {state:connectionState,configurationWarning,root:activeRoot,synthetic:activeRoot?inside(sandbox,activeRoot):true,library:client?.welcome.library,policyVersion:client?.welcome.policyVersion,capabilities:client?.welcome.capabilities??[],name:activeRoot?path.basename(activeRoot):'未打开知识库'};}
 async function listLibraries(){
  const items=[];
  for(const e of await readdir(path.join(sandbox,'libraries'),{withFileTypes:true})){if(!e.isDirectory()||e.isSymbolicLink())continue;try{const root=await ensureCandidate(path.join(sandbox,'libraries',e.name));items.push({name:e.name,root});}catch{}}
  for(const grant of await realGrants())try{const root=await ensureCandidate(grant.root);if(!items.some(i=>i.root===root))items.unshift({name:path.basename(root),root,synthetic:false});}catch{}
  const hidden=await readJson(path.join(sandbox,'hidden-libraries.json'),[]),protectedPath=await protectedRoot();return items.filter(i=>!hidden.some(p=>sameRoot(p,i.root))).map(i=>({...i,protected:sameRoot(i.root,protectedPath)}));
 }
 async function initialize(){
  const sample=path.join(sandbox,'libraries','示例资料库');await createFixture(sample,backendRoot,assetDir);
  const last=await readJson(path.join(sandbox,'last-library.json'),null);let chosen=sample;
  if(last)try{chosen=await ensureCandidate(last.root);}catch{}
  return openLibrary(chosen);
 }
 async function createLibrary(name){
  if(typeof name!=='string'||!name.trim()||name.length>80||/[<>:"|?*\\/\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name))throw Object.assign(Error('库名称无效'),{code:'BAD_REQUEST'});
  const root=path.join(sandbox,'libraries',name.trim());await mkdir(root);await createFixture(root,backendRoot,assetDir);return openLibrary(root);
 }
 return {initialize,call,status,removeLibrary,reconnectDsh,openLibrary,listLibraries,createLibrary,ensureCandidate,get root(){return activeRoot;},get privateDir(){return privateDir;},get sandbox(){return sandbox;},async close(){clearInterval(leaseTimer);await unlink(leaseFile).catch(()=>{});clearTimeout(retryTimer);subscription?.();await runtime?.close();client=null;connectionState='offline';},async reconnect(){return activeRoot?openLibrary(activeRoot):initialize();}};
}

