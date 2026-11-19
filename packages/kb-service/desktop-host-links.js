import path from 'node:path';import os from 'node:os';import {readdir,realpath} from 'node:fs/promises';
import {readJson} from './io.js';import {libraryIdentity} from './service.js';
// Only time-limited selections published by a desktop main process are followed.
export async function desktopHostSelections(home=path.join(os.homedir(),'.dsh/knowledge-desktop-links'),now=Date.now()){
 const rows=[];
 for(const name of await readdir(home).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))){
  if(!/^[a-f0-9-]{36}\.json$/i.test(name))continue;
  try{const lease=await readJson(path.join(home,name),null);if(!lease||lease.expiresAt<now||lease.expiresAt>now+30000)continue;
   const root=await realpath(lease.root),data=await realpath(lease.dataDir),identity=await libraryIdentity(root);if(identity.instanceId!==lease.instanceId||identity.kbId!==lease.kbId)continue;
   const grants=await readJson(path.join(data,'real-library-grants.json'),[]),grant=grants.find(g=>g.instanceId===identity.instanceId&&g.kbId===identity.kbId&&path.resolve(g.root).toLowerCase()===root.toLowerCase()&&g.serviceHome===lease.serviceHome);
   const rel=path.relative(path.join(data,'libraries'),root),sample=lease.synthetic===true&&rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&(await readJson(path.join(root,'.desktop-preview.json'),null))?.synthetic===true;
   if(!grant&&!sample)continue;rows.push({...identity,serviceHome:lease.serviceHome});
  }catch{/* A stale or mismatched request never grants a new library. */}
 }
 return [...new Map(rows.map(r=>[r.instanceId,r])).values()];
}
export function startDesktopHostLinks({ctx,python,connectRuntime,startBridge,workspaceFor,primaryRoot,ownerFor,recordSession,home,onLibraryEvent=()=>{},onError=()=>{}}){
 const links=new Map(),knownWorkspaces=new Map();let disposed=false,busy=false;
 async function refresh(){if(disposed||busy)return;busy=true;try{
  const rows=(await desktopHostSelections(home)).filter(r=>path.resolve(r.root).toLowerCase()!==path.resolve(primaryRoot).toLowerCase()),wanted=new Set(rows.map(r=>r.instanceId));
  for(const [id,link]of links)if(!wanted.has(id)){
    links.delete(id);
    onLibraryEvent({event:'connection.changed',data:{state:'offline'}});
    link.bridge.dispose();await link.runtime.close();
  }
  for(const row of rows){if(links.has(row.instanceId)||disposed)continue;let runtime;try{runtime=await connectRuntime({library:row.root,home:row.serviceHome,python,onEvent:onLibraryEvent,kind:'dsh-adapter',allowFreshSynthetic:false,required:['host.bridge']});const workspace=await workspaceFor(row.root);if(disposed){await runtime.close();continue;}knownWorkspaces.set(path.resolve(workspace.workspacePath).toLowerCase(),row.instanceId);const bridge=startBridge({client:runtime.client,ctx,workspace,ensureWorkspace:()=>workspaceFor(row.root),libraryRoot:row.root,ownsSession:ownerFor?(id=>ownerFor(id)===row.instanceId):undefined,onSessionCreated:recordSession?(id=>recordSession(row.instanceId,id)):undefined,label:'DSH · '+path.basename(row.root),onError});links.set(row.instanceId,{runtime,bridge});onLibraryEvent({event:'connection.changed',data:{state:'ready'}});}catch(e){await runtime?.close();onError(e);}}
 }finally{busy=false;}}
 const timer=setInterval(()=>void refresh().catch(onError),1000);timer.unref?.();void refresh().catch(onError);
 return {
  clientForLibrary(instanceId){return links.get(instanceId)?.runtime.client??null;},
  clientForAgent(agent){if(!agent||ctx.get('agents')?.get(agent.id)!==agent)return undefined;if(ownerFor){const owner=ownerFor(agent.id);return owner?links.get(owner)?.runtime.client??null:undefined;}const cwd=agent.session?.header?.cwd;if(!cwd)return undefined;const id=knownWorkspaces.get(path.resolve(cwd).toLowerCase());return id?links.get(id)?.runtime.client??null:undefined;},
  async dispose(){
   disposed=true;clearInterval(timer);
   const detached=[...links.values()];links.clear();
   if(detached.length)onLibraryEvent({event:'connection.changed',data:{state:'offline'}});
   for(const link of detached){link.bridge.dispose();await link.runtime.close();}
  }
 };
}
