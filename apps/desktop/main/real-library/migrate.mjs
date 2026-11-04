// Explicit, offline handoff. This module is invoked by the local setup launcher,
// never by a renderer or a model tool. Secrets stay in protected local storage.
import path from 'node:path';import {pathToFileURL} from 'node:url';import {readFile,writeFile,mkdir,readdir,cp,stat,realpath,access} from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [configurationFile,action='check']=process.argv.slice(2),config=JSON.parse(await readFile(configurationFile,'utf8'));
const json=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const pluginRoot=path.resolve(config.pluginRoot),installedPackage=await json(path.join(pluginRoot,'package.json'));
if(installedPackage?.version!==config.expected.version)throw Error('请先安装本交付包配套的知识库插件，再完全退出 DSH 后重试。实际安装版本不匹配，真实库未切换。');
const {readCandidateBuild,runtimeBuild}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/build.js')).href);
const build=await readCandidateBuild(pluginRoot),runtimeId=await runtimeBuild();
if(build.version!==config.expected.version||build.buildId!==config.expected.buildId||runtimeId!==config.expected.runtimeBuildId)throw Error('请先安装本交付包配套的知识库插件，再完全退出 DSH 后重试。实际安装构建与配套插件不匹配，真实库未切换。');
const {atomic,hash,native,readJson}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/io.js')).href),{libraryIdentity}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/service.js')).href),{connectService}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/client.js')).href),{launchService}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/launcher.js')).href);
const stateDir=path.join(config.sourceHome,'profiles/desktop/kb-state'),binding=await json(path.join(stateDir,'binding.json')),conf=await json(path.join(stateDir,'config.json'));
if(!binding?.kbPath||!conf||(conf.kbId&&binding.kbId!==conf.kbId)||path.resolve(binding.kbPath).toLowerCase()!==path.resolve(conf?.kbPath??'').toLowerCase())throw Error('原插件没有一致的已绑定知识库，未执行迁移。');
const identity=await libraryIdentity(binding.kbPath);if(identity.kbId!==binding.kbId)throw Error('真实库身份与原插件绑定不一致，未执行迁移。');
const privateDir=path.join(config.sharedHome,identity.instanceId),modeFile=path.join(identity.root,'.kbmeta/service-mode.json');let client,committed=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function inventory(folder){const out=[];async function walk(dir,prefix=''){for(const entry of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())throw Error('状态快照含链接，迁移已停止');const name=prefix+entry.name,file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file,name+'/');else if(entry.isFile())out.push({path:name,bytes:(await stat(file)).size,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});}}await walk(folder);return out;}
function assertStopped(){if(config.processGuard)execFileSync(config.python,['-X','utf8',config.processGuard,'check',configurationFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});}
async function connect(){const ready=await json(path.join(privateDir,'ready.json'));if(!ready)return null;try{return await connectService({pipe:ready.pipe,python:config.python,credentialFile:path.join(privateDir,'bootstrap.dpapi.json'),kind:'desktop'});}catch{return null;}}
try{
 if(action==='check'){console.log(JSON.stringify({compatible:true,installed:build.version,buildId:build.buildId,kbId:identity.kbId,alreadyShared:!!await json(modeFile)}));process.exit(0);}
 if(!['migrate','verify'].includes(action))throw Error('Unknown migration action');
 if(action==='verify'){client=await connect();if(!client)throw Error('共库服务尚未连接');const deadline=Date.now()+35000;let health;do{health=await client.call('service.health');if(health.dsh?.online)break;await sleep(500);}while(Date.now()<deadline);console.log(JSON.stringify({active:health.active,writers:health.writers,indexers:health.indexers,dshOnline:!!health.dsh?.online,library:health.library,providers:health.providers}));process.exit(health.active?0:1);}
 let marker=await json(modeFile),previous=await json(path.join(config.clientData,'migration-result.json'),{});if(previous.library?.instanceId!==identity.instanceId)previous={};let report={...previous,version:build.version,pluginBuildId:build.buildId,runtimeBuildId:runtimeId,library:identity,startedAt:previous.startedAt??new Date().toISOString(),existingSourcesPreserved:true};
 await mkdir(config.sharedHome,{recursive:true});await native(config.python,'private-dir',{path:privateDir});
 if(!marker){
  assertStopped();
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=path.join(config.sourceHome,'backups','knowledge-shared-'+stamp);await mkdir(path.dirname(backup),{recursive:true});await native(config.python,'private-dir',{path:backup});
  const before=await inventory(stateDir),metaBefore=await inventory(path.join(identity.root,'.kbmeta'));
  await cp(stateDir,path.join(backup,'profile-state'),{recursive:true});await cp(path.join(identity.root,'.kbmeta'),path.join(backup,'library-metadata'),{recursive:true});
  for(const name of ['package.json','pnpm-lock.yaml','cordis.patch.yml','compatibility.json']){const source=path.join(config.sourceHome,'profiles/desktop',name);if(await access(source).then(()=>true,()=>false)){await mkdir(path.join(backup,'profile-config'),{recursive:true});await cp(source,path.join(backup,'profile-config',name));}}
  if(hash(await inventory(stateDir))!==hash(before)||hash(await inventory(path.join(backup,'profile-state')))!==hash(before)||hash(await inventory(path.join(backup,'library-metadata')))!==hash(metaBefore))throw Error('备份期间源状态发生变化，未执行迁移');
  await atomic(path.join(backup,'snapshot.json'),{library:identity,profileState:before,libraryMetadata:metaBefore});report.backup=backup;
  const kernel=path.join(privateDir,'kernel');if(await access(kernel).then(()=>true,()=>false))throw Error('已有待核对的服务状态，未覆盖。请保留本机恢复记录。');
  await cp(path.join(backup,'profile-state'),kernel,{recursive:true});
  // Engines and their protected credentials retain their complete state in the
  // service's private kernel. The source facade below contains only reconciled
  // human state; it is not a second running engine or an empty-state migration.
  const key=hash(identity.kbId+'\0'+identity.root.toLowerCase()).slice(0,24),source=path.join(privateDir,'legacy-handoff');
  for(const name of ['config.json','binding.json','workbench/profile.json','workbench/libraries/'+key+'.json']){const from=path.join(backup,'profile-state',name);if(await access(from).then(()=>true,()=>false)){await mkdir(path.dirname(path.join(source,name)),{recursive:true});await cp(from,path.join(source,name));}}
  const registry=await json(path.join(kernel,'workbench/trash-libraries.json'));if(registry?.libraries?.[key]){registry.libraries[key].dataFile=path.join(identity.root,'.kbmeta/shared-state.json');await atomic(path.join(kernel,'workbench/trash-libraries.json'),registry);}
  await atomic(path.join(privateDir,'handoff-snapshot.json'),{backup,sourceDigest:hash(before),stagedKernelDigest:hash(await inventory(kernel)),engineStateCopied:true});
  const launch=path.join(privateDir,'launch.json');await atomic(launch,{library:identity.root,privateDir,python:config.python,sources:{'desktop-reconciled':source},recoverOwner:true,idleMs:30000});
  await launchService({configurationPath:launch,logDirectory:privateDir,node:config.clientExe});const deadline=Date.now()+18000;while(!client&&Date.now()<deadline){client=await connect();if(!client)await sleep(100);}if(!client)throw Error('共库服务未报告就绪，真实库尚未切换');
  const preview=await client.call('migration.preview',{sourceHandles:['desktop-reconciled']});await atomic(path.join(privateDir,'handoff-preview.json'),preview);if(!preview.ready)throw Error('迁移预览仍有冲突，真实库尚未切换');
  assertStopped();if(hash(await inventory(stateDir))!==hash(before))throw Error('原插件状态在预览后发生变化，真实库尚未切换');
  await client.call('migration.commit',{planId:preview.planId,quiescent:true});committed=true;report.counts=preview.counts;report.engineStateCopied=true;marker=await json(modeFile);
 }else{
  if(marker.kbId!==identity.kbId||marker.instanceId!==identity.instanceId||marker.state!=='active')throw Error('现有服务标记与真实库身份不一致，未更改');
  const {connectRuntime}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/runtime.js')).href);const runtime=await connectRuntime({library:identity.root,home:config.sharedHome,python:config.python,node:config.clientExe,kind:'desktop',allowFreshSynthetic:false});client=runtime.client;report.alreadyShared=true;
 }
 let vectorWarning='';try{const {exportPluginVector}=await import(pathToFileURL(path.join(pluginRoot,'packages/kb-service/vector-profiles.js')).href);const vector=await exportPluginVector({stateDir,root:identity.root,kbId:identity.kbId,sourceId:'profile:desktop'});if(vector)await client.call('providers.syncPlugin',vector);}catch{vectorWarning='向量来源需要在共库连接页核对，原配置和原索引已保留';}
 await mkdir(path.dirname(config.clientData),{recursive:true});await native(config.python,'private-dir',{path:config.clientData});await mkdir(path.join(config.clientData,'client'),{recursive:true});
 await atomic(path.join(config.clientData,'real-library-grants.json'),[{mode:'shared-real',root:identity.root,kbId:identity.kbId,instanceId:identity.instanceId,profile:'desktop',serviceHome:config.sharedHome}]);await atomic(path.join(config.clientData,'last-library.json'),{root:identity.root});
 const workspaceFile=path.join(config.clientData,'client/workspaces.json');if(!await json(workspaceFile))await atomic(workspaceFile,{[identity.instanceId]:{panes:[],activePane:'',rightOpen:true,rightTab:'dsh',layoutVersion:3}});
 const health=await client.call('service.health');report={...report,active:health.active,writers:health.writers,vectorSource:health.providers?.effectiveSource,vectorWarning,completedAt:new Date().toISOString()};await atomic(path.join(config.clientData,'migration-result.json'),report);console.log(JSON.stringify({migrated:true,active:health.active,writers:health.writers,backup:report.backup??null,counts:report.counts??null,vectorSource:report.vectorSource,vectorWarning}));
}catch(e){if(client&&!committed&&!await json(modeFile))await client.call('service.shutdown').catch(()=>{});console.error(String(e.code??'MIGRATION_STOPPED')+': '+String(e.message).slice(0,500));process.exitCode=1;}finally{client?.close();}
