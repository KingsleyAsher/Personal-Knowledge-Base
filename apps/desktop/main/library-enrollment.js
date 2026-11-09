import path from 'node:path';import os from 'node:os';import {realpath,readdir,open,unlink,mkdir} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
// Called only after the native directory picker has supplied the selected path.
export async function enrollPickedLibrary({root,dataDir,backendRoot,python,node,confirm,serviceHome=process.env.KB_SHARED_HOME??path.join(os.homedir(),'.dsh/shared-knowledge-services')}){
 const load=name=>import(pathToFileURL(path.join(backendRoot,'packages/kb-service',name)).href);
 const {atomic,readJson,hash,native}=await load('io.js'),{libraryIdentity}=await load('service.js');
 root=await realpath(root);const metaFile=path.join(root,'.kbmeta/kb.json'),modeFile=path.join(root,'.kbmeta/service-mode.json'),grantsFile=path.join(dataDir,'real-library-grants.json');
 const pendingFile=path.join(dataDir,'library-enrollments',hash(root.toLowerCase())+'.json');
 let meta=await readJson(metaFile,null),mode=await readJson(modeFile,null),pending=await readJson(pendingFile,null);
 if(!mode){
  const profiles=process.env.KB_PROFILE_HOME??path.join(os.homedir(),'.dsh/profiles');
  for(const profile of await readdir(profiles,{withFileTypes:true}).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))){if(!profile.isDirectory())continue;const b=await readJson(path.join(profiles,profile.name,'kb-state/binding.json'),null);if(b?.kbPath&&path.resolve(b.kbPath).toLowerCase()===root.toLowerCase())throw Error('此库仍由插件 profile '+profile.name+' 管理，需要先完成共库迁移；当前库保持打开。');}
  if(meta&&(!pending||pending.root!==root||pending.kbId&&pending.kbId!==meta.kbId))throw Error('这是尚未迁移的旧版知识库。为保留原来的阅读、摘录和任务状态，请先迁移，再从这里打开；当前库保持打开。');
  if(!pending){if(!await confirm(root))return {cancelled:true};await atomic(pendingFile,{root,approvedAt:new Date().toISOString()});}
  if(!meta){
   const {createEmbeddedKernel}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-core/index.js')).href),kernel=createEmbeddedKernel({stateDir:path.join(dataDir,'library-enrollments',hash(root)+'-init')});
   try{const r=await kernel.openCore().bind(root,{confirmInit:true,originalIndex:true});if(!r.ok)throw Error(r.note??'文件夹初始化未完成');}finally{kernel.dispose();}
   meta=await readJson(metaFile,null);
  }
  await atomic(pendingFile,{root,kbId:meta.kbId,approvedAt:pending?.approvedAt??new Date().toISOString()});
  const identity=await libraryIdentity(root),privateDir=path.join(serviceHome,identity.instanceId);await mkdir(serviceHome,{recursive:true});await native(python,'private-dir',{path:privateDir});
  const lockFile=path.join(privateDir,'launch.lock');let lock,client;
  try{
   lock=await open(lockFile,'wx');
   await lock.writeFile(JSON.stringify({owner:'desktop-enrollment',pid:process.pid,birth:await native(python,'birth',{pid:process.pid})}));
   const {launchService}=await load('launcher.js'),{connectService}=await load('client.js');
   const config=path.join(privateDir,'launch.json');await atomic(config,{library:root,privateDir,python,sources:{},recoverOwner:true,idleMs:30000});
   // A prior interrupted enrollment may already have a service waiting to commit.
   async function connect(){const ready=await readJson(path.join(privateDir,'ready.json'),null);if(!ready)return null;try{return await connectService({pipe:ready.pipe,python,credentialFile:path.join(privateDir,'bootstrap.dpapi.json'),kind:'desktop'});}catch{return null;}}
   client=await connect();if(!client){await launchService({configurationPath:config,logDirectory:privateDir,node});const until=Date.now()+20000;while(!client&&Date.now()<until){await new Promise(r=>setTimeout(r,100));client=await connect();}}
   if(!client)throw Error('新资料库服务尚未就绪，可再次打开该文件夹重试；原库未切换。');
   const health=await client.call('service.health');if(health.library.instanceId!==identity.instanceId)throw Error('资料库实例身份不匹配');
   if(!health.active)await client.call('migration.commit',{planId:'fresh',quiescent:true});
  }finally{client?.close();await lock?.close();if(lock)await unlink(lockFile);}
  mode=await readJson(modeFile,null);
 }
 const identity=await libraryIdentity(root);if(mode?.state!=='active'||mode.kbId!==identity.kbId||mode.instanceId!==identity.instanceId)throw Error('资料库服务身份不匹配，未切换当前库');
 const grant={mode:'shared-real',root,kbId:identity.kbId,instanceId:identity.instanceId,serviceHome};
 const grants=await readJson(grantsFile,[]);await atomic(grantsFile,[...grants.filter(g=>path.resolve(g.root).toLowerCase()!==root.toLowerCase()),grant]);
 return {root};
}
