import {createFeedbackClient} from './feedback.js';
import {createClientUpdater} from './client-updates.js';
import {withLibraryScope} from './library-scope.js';
import {COLOR_THEMES,validPalette,normalizePalette} from './theme-palettes.js';

import {app,BrowserWindow,ipcMain,dialog,shell,clipboard,protocol,nativeTheme,screen} from 'electron';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createManager} from './service-manager.js';
import {enrollPickedLibrary} from './library-enrollment.js';
import {validateShortcuts} from './shortcuts.js';
import os from 'node:os';import {desktopDataPath} from './storage-path.js';

const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backendRoot=app.isPackaged?path.join(process.resourcesPath,'kb-runtime'):path.resolve(appDir,'../..');
const {UPDATE_POLICY}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-contracts/version-policy.js')).href);
const dataDir=desktopDataPath({override:process.env.KB_DESKTOP_DATA,packaged:app.isPackaged,home:os.homedir(),appDir});
app.setName('知识工作台候选版');app.setPath('userData',path.join(dataDir,'client'));app.setAppUserModelId('local.kb.desktop.parity.candidate');
protocol.registerSchemesAsPrivileged([{scheme:'kb-media',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let atomic,readJson,hash,safePath,ipcQueue,ledgerQueue;
let window,manager,allowClose=false,heartbeat,bootError,backendReady=Promise.resolve();
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}});
const resources=new Map();
const send=event=>{if(window&&!window.isDestroyed())window.webContents.send('kb:event',event);};
const appUrl=pathToFileURL(path.join(appDir,'dist/index.html')).href;
const python=process.env.KB_DESKTOP_PYTHON??(app.isPackaged?path.join(process.resourcesPath,'python/python.exe'):'python');
let appearancePalette='default';
const windowBackground=()=>COLOR_THEMES.find(t=>t.id===appearancePalette)[nativeTheme.shouldUseDarkColors?'dark':'light'].chrome;
async function localRead(name,fallback){return readJson(path.join(dataDir,'client',name+'.json'),fallback);}
async function localWrite(name,value){await atomic(path.join(dataDir,'client',name+'.json'),value);}
function checkInput(a){if(a!==undefined&&Buffer.byteLength(JSON.stringify(a))>900000)throw Object.assign(Error('请求过大'),{code:'BAD_REQUEST'});}
async function writeCall(method,args,requestId=randomUUID()){
 const fingerprint=hash({method,args});
 await ledgerQueue(async()=>{const pending=await localRead('pending',{}),prior=pending[requestId];if(prior&&prior.fingerprint!==fingerprint)throw Object.assign(Error('相同请求不能改变参数'),{code:'IDEMPOTENCY_MISMATCH'});pending[requestId]={method,fingerprint,path:args.path,library:clientKey(),at:Date.now()};await localWrite('pending',pending);});
 const remove=()=>ledgerQueue(async()=>{const pending=await localRead('pending',{});delete pending[requestId];await localWrite('pending',pending);});
 try{const value=await manager.call(method,args,{requestId});await remove();return {...value,requestId};}
 catch(e){e.requestId=requestId;if(!['RESULT_UNKNOWN','HOST_UNAVAILABLE'].includes(e.code))await remove();throw e;}
}
function register(name,fn){
 ipcMain.handle('kb:'+name,async(event,args={})=>{
  if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith(appUrl))return {ok:false,error:{code:'FORBIDDEN',message:'拒绝非应用主页面请求'}};
  try{checkInput(args);if(!['window','pointer','preferences','appInfo','clientUpdates','copyFeedback','feedback'].includes(name))await backendReady;return {ok:true,value:await (['search','knowledge','providers','dsh','health','appInfo','clientUpdates','window','pointer','feedback'].includes(name)?fn(args):ipcQueue(()=>fn(args)))};}catch(e){return {ok:false,error:{code:e.code??'BAD_REQUEST',message:String(e.message).slice(0,600),requestId:e.requestId}};}
 });
}
const clientKey=()=>manager.status().library?.instanceId??'none';
let clientUpdater,feedbackClient;
async function feedback(a){
 if(!feedbackClient){const manifest=app.isPackaged?await readJson(path.join(path.dirname(process.execPath),'BUILD-MANIFEST.json'),{}):{};const config=await readJson(path.join(appDir,'main/feedback-config.json'),{});feedbackClient=createFeedbackClient({endpoint:process.env.KB_FEEDBACK_ENDPOINT??config.endpoint,version:manifest.version??app.getVersion(),buildId:manifest.buildId??'development'});}
 if(a.action==='status'){const manifest=app.isPackaged?await readJson(path.join(path.dirname(process.execPath),'BUILD-MANIFEST.json'),{}):{};return {...feedbackClient.status(),version:manifest.version??app.getVersion(),buildId:manifest.buildId??'development'};}
 if(a.action!=='submit')throw Error('未知反馈操作');return feedbackClient.submit(a);
}
async function appInfo(){
 const manifest=app.isPackaged?await readJson(path.join(path.dirname(process.execPath),'BUILD-MANIFEST.json'),{}):{};
 return {version:manifest.version??app.getVersion(),buildId:manifest.buildId??'development',channel:manifest.channel??'desktop-candidate',electron:process.versions.electron,updates:clientUpdater?await clientUpdater.check():{configured:true,policy:UPDATE_POLICY,message:'更新器正在初始化'}};
}
async function initialize(){
 const appManifest=app.isPackaged?await readJson(path.join(path.dirname(process.execPath),'BUILD-MANIFEST.json'),{}):{};clientUpdater=createClientUpdater({version:appManifest.version??app.getVersion(),directory:path.join(dataDir,'client-updates')});
 const preferences=await localRead('preferences',{theme:'system'});nativeTheme.themeSource=['light','dark','system'].includes(preferences.theme)?preferences.theme:'system';appearancePalette=normalizePalette(preferences.palette);
 manager=await createManager({dataDir,backendRoot,assetDir:path.join(appDir,'fixture-assets'),python,node:process.execPath,send:event=>{if(event.type==='connection.changed'&&event.state!=='ready')for(const r of resources.values())r.refreshAt=0;send(event);}});
}
function wire(){
 function resourcePreview(p){if(p.resourceHandle){const token=randomUUID();resources.set(token,{handle:p.resourceHandle,size:p.file.size,mime:p.file.mime,path:p.file.path,revision:p.file.revision,originalKey:p.originalKey,trashId:p.trashId,trashPath:p.trashPath,library:clientKey(),refreshAt:Date.now()+14*60000});p.resourceUrl='kb-media://asset/'+token;}return p;}
 register('clientUpdates',async a=>{
  if(a.action==='check')return clientUpdater.check({force:true});
  if(a.action==='download')return clientUpdater.download();
  if(a.action==='open-installer'){
   const file=await clientUpdater.verifiedInstaller(),failure=await shell.openPath(file);
   if(failure)throw Error('无法启动安装程序：'+failure);
   return {...clientUpdater.status(),message:'已启动经过校验的安装程序。请保存工作后退出本客户端，再按安装程序提示完成更新。'};
  }
  if(a.action==='release-page'){
   const update=await clientUpdater.check();if(!update.manifest)throw Error('尚未取得可用版本信息');
   await shell.openExternal('https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/'+encodeURIComponent(update.manifest.tag));
   return clientUpdater.status();
  }
  throw Error('未知客户端更新操作');
 });
 register('init',async()=>({connection:manager.status(),error:bootError,preferences:await localRead('preferences',{theme:'system',restoreTabs:true,keepDrafts:true}),workspace:(await localRead('workspaces',{}))[clientKey()],drafts:(await localRead('drafts',{}))[clientKey()]??{},pending:await localRead('pending',{})}));
 register('list',a=>manager.call(a.sort?'desktop.listSorted':'desktop.list',a));
 register('inbox',async a=>{
  const r=await manager.call('inbox.list',a),items=[];
  for(const row of r.items){try{const f=await manager.call('desktop.stat',{path:row.path});items.push({...f,indexAllowed:!row.excludedFromIndex,indexPolicyState:row.policyState,pending:true});}catch(e){if(!['NOT_FOUND','ENOENT'].includes(e.code))throw e;}}
  return {...r,items,nextOffset:r.offset+r.limit<r.total?r.offset+r.limit:undefined};
 });
 register('inboxStatus',()=>manager.call('inbox.organizeStatus'));
 register('organizeInbox',a=>writeCall('inbox.organize',{},a.requestId));
 register('stat',a=>manager.call('desktop.stat',a));
 register('preview',async a=>resourcePreview(await manager.call('desktop.preview',a)));
 register('trashPreview',async a=>resourcePreview(await manager.call('desktop.trashPreview',a)));
 register('editOriginal',async a=>resourcePreview(await manager.call('desktop.editOriginal',a)));
 register('fileStage',a=>manager.call('desktop.editStage',a));
 register('fileReplace',a=>writeCall('desktop.fileReplace',{path:a.path,expectedRevision:a.expectedRevision,stageId:a.stageId},a.requestId));
 register('fileSaveCopy',async a=>{const p=await manager.call('desktop.importPlan',{stageId:a.stageId,destination:a.destination});return writeCall('desktop.commit',{planId:p.id},a.requestId);});
 register('read',a=>manager.call('document.readForEdit',a));
 register('save',a=>writeCall('document.save',{path:a.path,expectedRevision:a.expectedRevision,text:a.text},a.requestId));
 register('plan',a=>manager.call('desktop.plan',a));
 register('commit',a=>writeCall('desktop.commit',{planId:a.planId,...(a.text===undefined?{}:{text:a.text})},a.requestId));
 register('search',async a=>{
  if(a.mode==='name')return manager.call('desktop.search',a);
  const r=await manager.call('workspace.read',{operation:{op:'search.list',q:a.query,mode:'body',retrievalMode:a.retrievalMode??'hybrid',limit:100}}),items=[];
  for(const row of r.items??[]){try{const f=await manager.call('desktop.stat',{path:row.path});items.push({...f,snippet:row.snippet,score:row.score});}catch(e){if(!['NOT_FOUND','ENOENT','FORBIDDEN'].includes(e.code))throw e;}}
  return {...r,items};
 });
 register('knowledge',async a=>withLibraryScope(manager,a.expectedLibrary,async()=>{if(a.operation?.op==='atlas.file-action'){const f=await manager.call('desktop.stat',{path:a.operation.path}),absolute=await safePath(manager.root,f.path);if(a.operation.action==='reveal')shell.showItemInFolder(absolute);else if(a.operation.action==='open'){const r=await shell.openPath(absolute);if(r)throw Error(r);}else throw Error('无效文件动作');return {ok:true};}return a.write?writeCall('workspace.write',{operation:a.operation},a.requestId):manager.call('workspace.read',{operation:a.operation});}));
 register('providers',a=>a.source?writeCall('providers.source',{source:a.source,expectedRevision:a.expectedRevision},a.requestId):manager.call('providers.get'));
 register('health',()=>manager.call('service.health'));
 register('dsh',a=>{
  if(a.method==='status')return manager.call('dsh.status');if(a.method==='task')return manager.call('task.get',{taskId:a.taskId});
  if(!['sessions','createSession','history','modelCatalog','selectModel','presets','capabilities','selectPreset','interactions','answerInteraction','follow','prompt','cancel'].includes(a.method))throw Error('未知 DSH 接口');
  return ['createSession','selectModel','selectPreset','answerInteraction','prompt','cancel'].includes(a.method)?writeCall('dsh.'+a.method,a.args??{},a.requestId):manager.call('dsh.'+a.method,a.args??{});
 });
 register('relations',async a=>manager.call('relations.query',a));
 register('trash',()=>manager.call('desktop.trash'));
 register('backups',()=>manager.call('desktop.backups'));
 register('backup',a=>writeCall('desktop.backupCreate',{},a.requestId));
 register('backupDelete',a=>writeCall('desktop.backupDelete',{backupId:a.backupId,expectedDigest:a.expectedDigest},a.requestId));
 register('restorePreview',a=>manager.call('desktop.restorePreview',a));
 register('restoreCommit',async a=>{const r=await writeCall('desktop.restoreCommit',a);return {committed:r.committed,copyRoot:r.copyRoot,files:r.files};});
 register('tasks',async()=>({items:(await localRead('taskHistory',[])).filter(r=>r.library===clientKey()),pending:Object.fromEntries(Object.entries(await localRead('pending',{})).filter(([_id,r])=>r.library===clientKey()))}));
 register('operation',async a=>{const r=await manager.call('operation.status',a);if(r.state==='committed'||r.state==='failed'){const p=await localRead('pending',{});delete p[a.requestId];await localWrite('pending',p);}return r;});
 register('preferences',async a=>{const p=await localRead('preferences',{theme:'system',restoreTabs:true,keepDrafts:true});if(a.theme!==undefined){if(!['light','dark','system'].includes(a.theme))throw Error('无效主题');p.theme=a.theme;}if(a.palette!==undefined){if(!validPalette(a.palette))throw Error('无效配色');p.palette=a.palette;}if(a.fileSort!==undefined){if(!['name-asc','name-desc','modified-desc','modified-asc'].includes(a.fileSort))throw Error('无效排序');p.fileSort=a.fileSort;}if(a.shortcuts!==undefined)p.shortcuts=validateShortcuts(a.shortcuts);if(a.relationWindowSize!==undefined){const {width,height}=a.relationWindowSize??{};if(!Number.isFinite(width)||!Number.isFinite(height)||width<340||height<300||width>4096||height>2160)throw Error('关系窗口尺寸无效');p.relationWindowSize={width:Math.round(width),height:Math.round(height)};}for(const k of ['restoreTabs','keepDrafts'])if(typeof a[k]==='boolean')p[k]=a[k];await localWrite('preferences',p);if(a.palette!==undefined){appearancePalette=p.palette;window?.setBackgroundColor(windowBackground());}if(a.theme!==undefined&&nativeTheme.themeSource!==p.theme)nativeTheme.themeSource=p.theme;return p;});
 register('drafts',async a=>{const all=await localRead('drafts',{}),key=clientKey();all[key]??={};if(a.path&&typeof a.text==='string'){if(Buffer.byteLength(a.text)>524288)throw Error('草稿过大');all[key][a.path]={text:a.text,revision:a.revision,originalKey:typeof a.originalKey==='string'?a.originalKey:undefined,bom:a.bom===true,updatedAt:Date.now()};await localWrite('drafts',all);}if(a.remove){delete all[key][a.remove];await localWrite('drafts',all);}return all[key];});
 register('workspace',async a=>{const all=await localRead('workspaces',{});all[clientKey()]=a;await localWrite('workspaces',all);return true;});
 register('removeLibrary',async a=>{const info=(await manager.listLibraries()).find(l=>l.root===a.root);if(!info)throw Error('未找到知识库');if(info.protected)throw Error('插件当前绑定的知识库不可移除');const choice=await dialog.showMessageBox(window,{type:'question',title:'移除知识库',message:'从客户端移除“'+info.name+'”？',detail:'只移除客户端的登记与工作区。磁盘中的原文件、库元数据、索引和备份均保留。',buttons:['移除','取消'],defaultId:1,cancelId:1});if(choice.response!==0)return {cancelled:true};return manager.removeLibrary(a.root);});
 register('reconnectDsh',()=>manager.reconnectDsh());
 register('libraries',()=>manager.listLibraries());
 register('chooseLibrary',async()=>{const r=await dialog.showOpenDialog(window,{title:'打开知识库文件夹',defaultPath:manager.root??app.getPath('documents'),properties:['openDirectory']});if(r.canceled)return {cancelled:true};const root=r.filePaths[0];try{await manager.ensureCandidate(root);}catch{const enrolled=await enrollPickedLibrary({root,dataDir,backendRoot,python,node:process.execPath,confirm:async selected=>(await dialog.showMessageBox(window,{type:'question',title:'在文件夹中启用知识库',message:'为选中的文件夹启用知识库？',detail:selected+'\n\n将添加 .kbmeta 元数据、知识库目录与缺失的模板；现有文件保留在原位置。此操作不会切换 DSH 插件绑定。',buttons:['启用并打开','取消'],defaultId:0,cancelId:1})).response===0});if(enrolled.cancelled)return enrolled;}resources.clear();return manager.openLibrary(root);});
 register('openLibrary',async a=>{resources.clear();return manager.openLibrary(a.root);});
 register('newLibrary',a=>{resources.clear();return manager.createLibrary(a.name);});
 register('reconnect',async()=>{const c=await manager.reconnect();bootError=undefined;return c;});
 register('path',async a=>{
  const f=await manager.call('desktop.stat',{path:a.path}),absolute=await safePath(manager.root,f.path);
  if(a.action==='copy'){clipboard.writeText(a.relative?f.path:absolute);return true;}
  if(a.action==='reveal'){shell.showItemInFolder(absolute);return true;}
  if(a.action==='open'){if(/\.(exe|com|bat|cmd|ps1|vbs|msi|py|js)$/i.test(f.path))throw Error('此可执行格式请先在系统资源管理器中确认');const r=await shell.openPath(absolute);if(r)throw Error(r);return true;}
  throw Error('无效路径操作');
 });
 register('openExternal',async a=>{const u=new URL(a.url);if(!['http:','https:'].includes(u.protocol))throw Error('链接协议不可打开');await shell.openExternal(u.href);});
 register('policy',async a=>{if(a.paths)return writeCall('policy.setIndexExcluded',a);return manager.call('policy.get');});
 async function stageImports(paths){
  if(!Array.isArray(paths)||paths.length>64)throw Error('单次最多导入64个文件');
  const files=[];for(const file of paths){
   const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>64*1024*1024)throw Error('只接受64MB以内的本机普通文件');
   const bytes=await readFile(file);if(bytes.length>64*1024*1024)throw Error('单文件超过64MB预算');
   let stageId;for(let offset=0;offset<Math.max(1,bytes.length);offset+=220000){const data=bytes.subarray(offset,offset+220000).toString('base64');const part=await manager.call('desktop.importStage',{name:path.basename(file),data,final:offset+220000>=bytes.length,...(stageId?{stageId}:{})});stageId=part.stageId;}
   files.push({stageId,name:path.basename(file),size:bytes.length});
  }return files;
 }
 register('importDrop',a=>stageImports(a.paths));
 register('importChoose',async()=>{
  const r=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],title:'选择要复制到虚构库的资料'});if(r.canceled)return [];
  return stageImports(r.filePaths);
 });
 register('importCommit',async a=>{
  const tasks=await localRead('taskHistory',[]),results=[];
  for(const file of a.files??[]){
   try{const p=await manager.call('desktop.importPlan',{stageId:file.stageId,destination:(a.parent?a.parent+'/':'')+file.name});const value=await writeCall('desktop.commit',{planId:p.id});results.push({name:file.name,state:'completed',value});}
   catch(e){results.push({name:file.name,state:['RESULT_UNKNOWN','HOST_UNAVAILABLE'].includes(e.code)?'unknown':'failed',code:e.code,message:e.message,stageId:file.stageId,requestId:e.requestId});}
  }
  await localWrite('taskHistory',[...results.map(r=>({...r,id:randomUUID(),parent:a.parent,library:clientKey(),at:Date.now()})),...tasks].slice(0,100));return results;
 });
 register('importRetry',async a=>{
  const tasks=await localRead('taskHistory',[]),task=tasks.find(t=>t.id===a.id);
  if(!task||task.library!==clientKey()||task.state!=='failed'||!task.stageId)throw Error('只能重试当前库结果已确认的失败项；未知结果应先查询回执');
  const p=await manager.call('desktop.importPlan',{stageId:task.stageId,destination:(task.parent?task.parent+'/':'')+task.name});
  const result=await writeCall('desktop.commit',{planId:p.id});task.state='completed';task.value=result;delete task.message;await localWrite('taskHistory',tasks);return result;
 });
 register('pointer',()=>{const point=screen.getCursorScreenPoint(),bounds=window.getContentBounds(),zoom=window.webContents.getZoomFactor();return {x:(point.x-bounds.x)/zoom,y:(point.y-bounds.y)/zoom};});
 register('window',async a=>{if(a.action==='minimize')window.minimize();else if(a.action==='maximize')window.isMaximized()?window.unmaximize():window.maximize();else if(a.action==='close'){allowClose=true;window.close();}});
 register('diagnostics',async()=>({candidate:true,dataDir,service:manager.status(),nodeIntegration:false,contextIsolation:true,sandbox:true,dshConnected:(await manager.call('dsh.status')).online}));
 register('appInfo',appInfo);
 register('feedback',feedback);
 register('copyFeedback',async a=>{if(typeof a.text!=='string'||!a.text.trim()||a.text.length>8000)throw Error('反馈内容应为 1–8000 字符');const info=await appInfo();clipboard.writeText('个人知识库 · 桌面候选版\n版本：'+info.version+'\n构建：'+info.buildId+'\n\n'+a.text.trim());return true;});
}
async function launch(){
const io=await import(pathToFileURL(path.join(backendRoot,'packages/kb-service/io.js')));({atomic,readJson,hash}=io);ipcQueue=io.serialQueue();ledgerQueue=io.serialQueue();
({safePath}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-core/src/workbench-state.js'))));
await mkdir(path.join(dataDir,'client'),{recursive:true});
await initialize();
protocol.handle('kb-media',async request=>{
 try{
  const token=new URL(request.url).pathname.slice(1),r=resources.get(token);
  if(!r||r.library!==clientKey())return new Response('Resource expired',{status:403});
  if(Date.now()>r.refreshAt){const p=r.trashId?await manager.call('desktop.trashPreview',{id:r.trashId,path:r.trashPath}):r.originalKey?await manager.call('desktop.editOriginal',{path:r.path,originalKey:r.originalKey}):await manager.call('desktop.preview',{path:r.path});if(!p.resourceHandle||p.file.revision!==r.revision)return new Response('Source changed',{status:409});r.handle=p.resourceHandle;r.refreshAt=Date.now()+14*60000;}
  const range=request.headers.get('range'),m=range?.match(/^bytes=(\d*)-(\d*)$/);
  let begin=0,end=r.size-1;
  if(m){if(m[1])begin=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),r.size-1);if(!m[1]&&m[2]){begin=Math.max(0,r.size-Number(m[2]));end=r.size-1;}}
  if(begin>end||begin<0||end>=r.size)return new Response(null,{status:416});
  let offset=begin;
  const stream=new ReadableStream({async pull(controller){try{if(offset>end){controller.close();return;}const part=await manager.call('desktop.media',{handle:r.handle,offset,length:Math.min(262144,end-offset+1)});const data=Buffer.from(part.data,'base64');if(!data.length){controller.close();return;}offset+=data.length;controller.enqueue(new Uint8Array(data));}catch(e){controller.error(e);}}});
  return new Response(stream,{status:m?206:200,headers:{'Content-Type':r.mime,'Content-Length':String(end-begin+1),'Accept-Ranges':'bytes',...(m?{'Content-Range':'bytes '+begin+'-'+end+'/'+r.size}:{}),'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
 }catch{return new Response('Unavailable',{status:403});}
});
window=new BrowserWindow({width:1440,height:1024,minWidth:1000,minHeight:680,show:false,frame:false,title:'知识工作台 · 候选版',backgroundColor:windowBackground(),webPreferences:{preload:path.join(appDir,'main/preload.cjs'),additionalArguments:['--kb-startup-theme='+(nativeTheme.shouldUseDarkColors?'dark':'light'),'--kb-startup-preference='+nativeTheme.themeSource,'--kb-startup-palette='+appearancePalette],nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}});
// Do not expose an unpainted renderer. The first document already carries the
// saved theme and a small startup shell before the application bundle runs.
window.once('ready-to-show',()=>{if(process.env.KB_DESKTOP_HIDDEN!=='1'&&!window.isDestroyed())window.show();});
nativeTheme.on('updated',()=>{if(window&&!window.isDestroyed())window.setBackgroundColor(windowBackground());});
window.setMenu(null);
wire();
 // Render the shell while the first library/service is prepared. Window controls
 // remain independent of both the startup promise and the service IPC queue.
 backendReady=manager.initialize().catch(e=>{bootError={code:e.code??'HOST_UNAVAILABLE',message:e.message};});
if(app.isPackaged&&process.env.KB_DESKTOP_DISABLE_UPDATES!=='1'){const check=()=>void clientUpdater.check().then(s=>s.ok&&s.updateAvailable?clientUpdater.download():null).catch(()=>{});setTimeout(check,15000).unref();setInterval(check,6*60*60*1000).unref();}
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(appUrl))event.preventDefault();});
window.webContents.session.setPermissionRequestHandler((_wc,_p,callback)=>callback(false));
window.on('close',event=>{if(!allowClose){event.preventDefault();send({type:'close.requested'});}});
await window.loadURL(appUrl);
heartbeat=setInterval(()=>{if(manager.status().state==='ready')manager.call('service.health').catch(()=>{});},5000);
app.on('window-all-closed',()=>{clearInterval(heartbeat);void manager.close();app.quit();});
}
if(primaryInstance)app.whenReady().then(launch).catch(error=>{console.error(error);dialog.showErrorBox('候选客户端启动失败',String(error.message));app.exit(1);});

