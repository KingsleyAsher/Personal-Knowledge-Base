const {app,BrowserWindow,ipcMain,dialog,shell,screen}=require('electron');
const fs=require('original-fs'),fsp=fs.promises,path=require('path'),os=require('os'),crypto=require('crypto');
const {spawn,execFile}=require('child_process');const {promisify}=require('util');const exec=promisify(execFile);
const APPID='KnowledgeWorkbench.PaperGreen',EXE='KnowledgeWorkbench-Candidate.exe';
const testRoot=process.env.KB_SETUP_TEST_ROOT?path.resolve(process.env.KB_SETUP_TEST_ROOT):null;
const registry='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+APPID+(testRoot?'.Test':'');
const source=path.dirname(process.execPath),uiRoot=__dirname;
const uninstallArg=process.argv.find(x=>x.startsWith('--uninstall-target='));
const uninstallTarget=uninstallArg?path.resolve(uninstallArg.slice('--uninstall-target='.length)):null;
let win,busy=false,canceled=false,committing=false,installed=null,allowClose=false,selected=null;
app.setName('知识工作台安装程序');app.setPath('userData',path.join(process.env.KB_SETUP_SESSION||os.tmpdir(),'installer-profile'));
const defaultTarget=testRoot?path.join(testRoot,'KnowledgeWorkbench'):path.join(process.env.LOCALAPPDATA,'Programs','KnowledgeWorkbench');
function inside(root,rel){if(typeof rel!=='string'||path.isAbsolute(rel)||rel.split(/[\\/]/).some(x=>x==='..'||x===''))throw Error('安装清单路径无效');const full=path.resolve(root,rel);if(!full.toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep))throw Error('路径越界');return full;}
async function readJSON(file){return JSON.parse(await fsp.readFile(file,'utf8'));}
async function exists(p){try{await fsp.stat(p);return true;}catch{return false;}}
async function noLinks(p){let current=path.resolve(p);while(current!==path.dirname(current)){try{if((await fsp.lstat(current)).isSymbolicLink())throw Error('安装目录不能经过符号链接或目录联接。');}catch(e){if(e.code!=='ENOENT')throw e;}current=path.dirname(current);}}
async function validateTarget(target){
 if(typeof target!=='string'||!path.isAbsolute(target)||target.startsWith('\\\\')||target.includes('"'))throw Error('请选择本机磁盘上的有效安装目录。');
 target=path.resolve(target);if(path.basename(target).toLowerCase()!=='knowledgeworkbench')throw Error('安装文件夹名称应为 KnowledgeWorkbench。');
 await noLinks(target);
 if(await exists(target)){const entries=await fsp.readdir(target);if(entries.length)throw Error('此位置已有文件。请先卸载已有版本，或选择另一个安装位置。');}
 await fsp.mkdir(path.dirname(target),{recursive:true});const probe=path.join(path.dirname(target),'.kb-write-'+crypto.randomUUID());await fsp.writeFile(probe,'');await fsp.unlink(probe);return target;
}
function progress(percent,label){win?.webContents.send('setup:progress',{percent,label});win?.setProgressBar(percent/100);}
function checkCancel(){if(canceled&&!committing){const e=Error('安装已取消');e.code='CANCELED';throw e;}}
async function hash(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function copyVerified(from,to,row,onBytes){await fsp.mkdir(path.dirname(to),{recursive:true});const input=await fsp.open(from,'r'),out=await fsp.open(to,'wx');const h=crypto.createHash('sha256');let total=0;try{const buffer=Buffer.allocUnsafe(1024*1024);for(;;){checkCancel();const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break;const chunk=buffer.subarray(0,bytesRead);h.update(chunk);let offset=0;while(offset<bytesRead){const r=await out.write(chunk,offset,bytesRead-offset,null);offset+=r.bytesWritten;}total+=bytesRead;onBytes(bytesRead);}}finally{await input.close();await out.close();}if(total!==row.size||h.digest('hex')!==row.sha256)throw Error('文件校验失败：'+row.path);}
async function regAdd(name,value,type='REG_SZ'){await exec('reg.exe',['add',registry,'/v',name,'/t',type,'/d',String(value),'/f'],{windowsHide:true});}
function shortcutPaths(){if(testRoot)return {desktop:path.join(testRoot,'desktop','知识工作台.lnk'),start:path.join(testRoot,'start','知识工作台.lnk')};return {desktop:path.join(app.getPath('desktop'),'知识工作台.lnk'),start:path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','知识工作台.lnk')};}
async function register(target,manifest,desktop){
 const links=[];const paths=shortcutPaths();for(const file of [paths.start,...(desktop?[paths.desktop]:[])]){await fsp.mkdir(path.dirname(file),{recursive:true});if(await exists(file)){try{if(shell.readShortcutLink(file).target.toLowerCase()!==path.join(target,EXE).toLowerCase())continue;}catch{continue;}}
 if(!shell.writeShortcutLink(file,'create',{target:path.join(target,EXE),cwd:target,description:'知识工作台',appUserModelId:'local.kb.desktop.parity.candidate',icon:path.join(target,EXE),iconIndex:0}))throw Error('创建快捷方式失败');links.push(file);}
 const values={DisplayName:'知识工作台',DisplayVersion:manifest.version,Publisher:'KnowledgeWorkbench',InstallLocation:target,DisplayIcon:path.join(target,EXE),UninstallString:'"'+path.join(target,'Uninstall.exe')+'"',InstallDate:new Date().toISOString().slice(0,10).replace(/-/g,'')};
 for(const [k,v]of Object.entries(values))await regAdd(k,v);for(const [k,v]of Object.entries({NoModify:1,NoRepair:1,EstimatedSize:Math.ceil(manifest.totalBytes/1024)}))await regAdd(k,v,'REG_DWORD');return links;
}
async function install(options){
 if(busy)throw Error('安装正在进行');busy=true;canceled=false;committing=false;let stage,finalTarget,committed=false,links=[];
 try{
 finalTarget=await validateTarget(options.target);selected=finalTarget;const manifest=await readJSON(path.join(source,'setup-payload.json'));
 const disk=await fsp.statfs(path.dirname(finalTarget));if(Number(disk.bavail)*Number(disk.bsize)<manifest.totalBytes+64*1024*1024)throw Error('所选磁盘剩余空间不足。');
 stage=path.join(path.dirname(finalTarget),'.kb-setup-'+crypto.randomUUID());await fsp.mkdir(stage);let bytes=0,last=0;progress(0,'正在准备安装');
 for(const row of manifest.files){checkCancel();await copyVerified(inside(source,row.source),inside(stage,row.path),row,n=>{bytes+=n;const now=Date.now();if(now-last>70){last=now;progress(Math.min(94,bytes/manifest.totalBytes*94),'正在复制并校验应用文件');}});}
 checkCancel();committing=true;progress(95,'正在完成安装');
 const record={product:APPID,version:manifest.version,buildId:manifest.buildId,root:finalTarget,files:manifest.files.map(r=>({path:r.path,sha256:r.sha256})),shortcuts:[]};
 await fsp.writeFile(path.join(stage,'INSTALL-MANIFEST.json'),JSON.stringify(record,null,2));
 if(await exists(finalTarget)){if((await fsp.readdir(finalTarget)).length)throw Error('安装目录在安装期间被其他程序使用。');await fsp.rmdir(finalTarget);}await fsp.rename(stage,finalTarget);stage=null;committed=true;
 try{links=await register(finalTarget,manifest,options.desktop!==false);}catch(e){throw Error('程序文件已安装，但快捷方式或系统注册未完成：'+e.message);}
 record.shortcuts=links;await fsp.writeFile(path.join(finalTarget,'INSTALL-MANIFEST.json'),JSON.stringify(record,null,2));installed=finalTarget;progress(100,'安装完成');return {ok:true,target:finalTarget};
 }catch(e){if(stage){const parent=path.dirname(finalTarget);if(stage.startsWith(parent+path.sep+'.kb-setup-'))await fsp.rm(stage,{recursive:true,force:true});}return {ok:false,error:e.message,canceled:e.code==='CANCELED',installedFiles:committed,target:finalTarget};}finally{busy=false;committing=false;win?.setProgressBar(-1);}
}
async function uninstall(){
 if(busy)throw Error('操作正在进行');if(!uninstallTarget)throw Error('不是卸载模式');busy=true;try{
 const root=uninstallTarget;await noLinks(root);const m=await readJSON(path.join(root,'INSTALL-MANIFEST.json'));if(m.product!==APPID||path.resolve(m.root).toLowerCase()!==root.toLowerCase())throw Error('安装记录不匹配，已停止卸载。');
 // Refuse while this exact installed executable or its bundled service is running.
 progress(0,'正在等待应用后台服务安全退出');
 const script='$ErrorActionPreference="Stop"; $r=$env:KB_UNINSTALL_ROOT; $until=(Get-Date).AddSeconds(35); do { $p=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) }; if(-not $p){exit 0}; Start-Sleep -Milliseconds 1000 } while((Get-Date) -lt $until); exit 42';
 try{await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,KB_UNINSTALL_ROOT:root}});}catch(e){if(e.code===42)throw Error('请先关闭知识工作台及使用它的后台服务，再重新卸载。');throw Error('无法确认程序是否关闭，未执行卸载。');}
 const remaining=[];for(let i=0;i<m.files.length;i++){const row=m.files[i],p=inside(root,row.path);await noLinks(p);if(await exists(p)){if(await hash(p)!==row.sha256){remaining.push(row.path);continue;}await fsp.unlink(p);}progress((i+1)/m.files.length*98,'正在移除应用文件');}
 for(const file of m.shortcuts||[]){if(!Object.values(shortcutPaths()).includes(file))continue;try{if(shell.readShortcutLink(file).target.toLowerCase()===path.join(root,EXE).toLowerCase())await fsp.unlink(file);}catch{}}
 try{const q=await exec('reg.exe',['query',registry,'/v','InstallLocation'],{windowsHide:true});if(q.stdout.toLowerCase().includes(root.toLowerCase()))await exec('reg.exe',['delete',registry,'/f'],{windowsHide:true});}catch{}
 await fsp.unlink(path.join(root,'INSTALL-MANIFEST.json'));
 const dirs=[...new Set(m.files.map(r=>path.dirname(inside(root,r.path))))].sort((a,b)=>b.length-a.length);for(const dir of dirs){let d=dir;while(d.toLowerCase().startsWith(root.toLowerCase()+path.sep)){try{await fsp.rmdir(d);}catch{break;}d=path.dirname(d);}}try{await fsp.rmdir(root);}catch{}
 progress(100,'卸载完成');return {ok:true,preserved:remaining.length};
 }catch(e){return {ok:false,error:e.message};}finally{busy=false;win?.setProgressBar(-1);}
}
app.whenReady().then(async()=>{
 const existing=await exists(path.join(defaultTarget,'INSTALL-MANIFEST.json'));if(existing)installed=defaultTarget;
 win=new BrowserWindow({width:1040,height:780,useContentSize:true,frame:false,resizable:false,show:false,backgroundColor:'#faf8f2',webPreferences:{preload:path.join(uiRoot,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const area=screen.getPrimaryDisplay().workAreaSize;const scale=Math.min(1,(area.width-40)/1040,(area.height-40)/780);if(scale<1){win.setContentSize(Math.round(1040*scale),Math.round(780*scale));win.webContents.setZoomFactor(scale);}win.center();
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 const handle=(name,fn)=>ipcMain.handle('setup:'+name,async(e,a)=>{if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('拒绝请求');return fn(a);});
 handle('info',()=>({target:uninstallTarget||defaultTarget,existing,uninstall:!!uninstallTarget}));
 handle('pick',async()=>{if(busy)return null;const r=await dialog.showOpenDialog(win,{title:'选择安装位置的上级文件夹',properties:['openDirectory','createDirectory']});return r.canceled?null:path.join(r.filePaths[0],'KnowledgeWorkbench');});
 handle('install',install);handle('uninstall',uninstall);handle('cancel',()=>{if(committing)return {accepted:false};canceled=true;return {accepted:true};});
 handle('launch',()=>{if(!installed)throw Error('程序尚未安装');const child=spawn(path.join(installed,EXE),[],{cwd:installed,detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.unref();allowClose=true;app.quit();});
 handle('close',()=>{if(busy)return false;allowClose=true;app.quit();return true;});
 win.on('close',e=>{if(!allowClose){e.preventDefault();win.webContents.send('setup:close-request');}});
 await win.loadFile(path.join(uiRoot,'index.html'));win.show();
});
app.on('window-all-closed',()=>app.quit());
