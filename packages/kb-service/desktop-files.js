
import path from 'node:path';
import {readFile,readdir,lstat,stat,realpath,mkdir,open,unlink,link,rename,rmdir,access,cp} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {safePath,relativePath,inside,locked} from '../kb-core/src/workbench-state.js';
import {fileRole} from '../kb-core/src/workbench-files.js';
import {DEFAULT_PRIVATE_DIRS} from '../kb-core/src/fsindex.js';
import {readIndexPolicy,policyExcluded,savePolicy,policyFile} from '../kb-core/src/index-policy.js';
import {createEmbeddedKernel} from '../kb-core/index.js';
import {atomic,readJson,hash,error} from './io.js';

const MAX_TEXT=512*1024,MAX_FILE=64*1024*1024,MAX_BACKUP=128*1024*1024;
const MAX_OFFICE=16*1024*1024,OFFICE=/\.(docx|xlsx)$/i,TEXT=/\.(md|mdx|markdown|txt|csv|json|ya?ml|[cm]?js|tsx?|jsx|py|css|s[ac]ss|html?|xml|log|c|cc|cpp|h|hpp|cs|java|rs|go|sh|ps1|toml|ini|sql|vue|svelte)$/i;
const decoder=new TextDecoder('utf-8',{fatal:true});
const mimeOf=p=>OFFICE.test(p)?(/\.docx$/i.test(p)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'):TEXT.test(p)?(/\.md$/i.test(p)?'text/markdown':'text/plain'):({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',wav:'audio/wav',mp3:'audio/mpeg',mp4:'video/mp4',webm:'video/webm'})[p.split('.').at(-1).toLowerCase()]??'application/octet-stream';
const version=s=>'fs:'+hash([String(s.dev),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs)]);
const uuid=/^[a-f0-9-]{32,64}$/;
const osName=n=>{if(typeof n!=='string'||!n||/[<>:"|?*\x00-\x1f\\/]/.test(n)||/[. ]$/.test(n)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(n))throw error('BAD_REQUEST','文件名无效');return n.normalize('NFC');};
export async function createDesktopFiles({root,privateDir,desktopRoot,core,withLock,getPrivateDirs=()=>DEFAULT_PRIVATE_DIRS,candidateOnly=true}){
 const sandbox=await realpath(desktopRoot),base=await realpath(root);
 if(!inside(sandbox,base)||base===sandbox)throw error('FORBIDDEN','候选客户端只能访问隔离的虚构库');
 const marker=await readJson(path.join(base,'.desktop-preview.json'),null);
 if(candidateOnly&&(marker?.synthetic!==true||marker?.schemaVersion!==1))throw error('FORBIDDEN','缺少虚构库标记');
 const storage=path.join(privateDir,'desktop');
 await mkdir(storage,{recursive:true});
 const plans=new Map(),resources=new Map(),stages=new Map();
  const localTrash=await safePath(base,'.kbmeta/desktop-trash',{missing:true});
  async function trashDir(id,{create=false}={}){
   if(!uuid.test(id??''))throw error('BAD_REQUEST','回收项目标识无效');
   const local=await safePath(base,'.kbmeta/desktop-trash/'+id,{missing:true});
   if(create){await mkdir(local,{recursive:true});return safePath(base,'.kbmeta/desktop-trash/'+id);}
   if(await lstat(local).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))return local;
   return safePath(privateDir,'desktop/trash/'+id,{missing:true});
  }

 const privatePath=p=>getPrivateDirs().some(v=>{const a=p.toLowerCase(),b=v.replaceAll('\\','/').toLowerCase();return a===b||a.startsWith(b+'/');});
 async function checked(p,{missing=false,write=false}={}){
  p=relativePath(p);
  if(p.split('/').some(s=>s.startsWith('.')||['node_modules','索引层'].includes(s))||privatePath(p))throw error('FORBIDDEN','资料路径不在当前浏览授权范围内');
  if(write&&(fileRole(p)!=='document'||/^(_模板|_手册)\//.test(p)))throw error('READ_ONLY','系统资料受保护');
  return safePath(base,p,{missing});
 }
 async function info(p){
  const absolute=await checked(p),s=await lstat(absolute,{bigint:true});
  if(!s.isFile()&&!s.isDirectory())throw error('READ_ONLY','仅支持普通文件和目录');
  let writable=Boolean(s.mode&0o222n);
  try{await access(absolute,constants.W_OK);await access(path.dirname(absolute),constants.W_OK);}catch{writable=false;}
  const system=fileRole(p)!=='document'||/^(_模板|_手册)(\/|$)/.test(p);
  const accessInfo={canBrowse:true,canEdit:s.isFile()&&(OFFICE.test(p)?s.size<=BigInt(MAX_OFFICE):TEXT.test(p)&&s.size<=BigInt(MAX_TEXT))&&writable&&!system,
   canRename:writable&&!system,canMove:writable&&!system,canTrash:writable&&!system,canSendToModel:false,
   indexExcluded:policyExcluded(readIndexPolicy(base),p),reasons:system?['系统资料受保护']:!writable?['文件或目录只读']:s.size>BigInt(OFFICE.test(p)?MAX_OFFICE:MAX_TEXT)?['文件超过完整编辑上限']:[]};
  return {id:p,path:p,name:path.posix.basename(p),type:s.isDirectory()?'directory':'file',mime:s.isFile()?mimeOf(p):undefined,size:Number(s.size),modifiedAt:Number(s.mtimeMs),revision:version(s),access:accessInfo,protected:system,hasChildren:s.isDirectory()};
 }
 async function list(parent='',offset=0,limit=500,sort='name-asc'){
  const folder=parent?await checked(parent):base,rows=[];
  for(const e of await readdir(folder,{withFileTypes:true})){
   const p=parent?parent+'/'+e.name:e.name;
   if(e.name.startsWith('.')||e.isSymbolicLink()||privatePath(p)||['node_modules','索引层'].includes(e.name))continue;
   try{rows.push(await info(p));}catch(e){if(!['FORBIDDEN','LINK_DENIED','EACCES','ENOENT'].includes(e.code))throw e;}
  }
  const nameOrder=(a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true});
  rows.sort((a,b)=>(a.type===b.type?0:a.type==='directory'?-1:1)||(sort==='modified-desc'?b.modifiedAt-a.modifiedAt:sort==='modified-asc'?a.modifiedAt-b.modifiedAt:sort==='name-desc'?-nameOrder(a,b):nameOrder(a,b))||nameOrder(a,b));
  return {items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:undefined,total:rows.length};
 }
 async function walk(parent='',out=[],depth=0){
  if(depth>20||out.length>5000)throw error('BAD_REQUEST','目录超过候选版枚举预算');
  const page=await list(parent);
  if(page.nextOffset!==undefined)throw error('BAD_REQUEST','单目录超过500项，缩小范围后操作');
  for(const f of page.items){if(f.type==='directory')await walk(f.path,out,depth+1);else out.push(f);}
  return out;
 }
 async function stable(p,max=MAX_FILE){
  const absolute=await checked(p),before=await stat(absolute,{bigint:true});
  if(!before.isFile()||before.size>BigInt(max))throw error('READ_ONLY','文件超过此次操作预算');
  const data=await readFile(absolute),after=await stat(absolute,{bigint:true});
  if(version(before)!==version(after)||data.length>max)throw error('CONFLICT','文件在读取时发生变化');
  return {data,revision:version(after),absolute};
 }
 async function preview(p,caller){
  const f=await info(p);if(f.type!=='file')return {file:f,kind:'unsupported'};
  if(OFFICE.test(p)){
   if(f.size>MAX_OFFICE)return {file:{...f,access:{...f.access,canEdit:false}},kind:'unsupported',readOnlyReason:'Office 文件超过候选版16MiB编辑预算'};
   const original=await stable(p,MAX_OFFICE),key=hash([caller,p,original.revision]),folder=path.join(storage,'edit-originals');await mkdir(folder,{recursive:true});
   if(!await readJson(path.join(folder,key+'.json'),null)){
    let total=0;for(const name of await readdir(folder))if(name.endsWith('.bin'))total+=(await stat(path.join(folder,name))).size;
    if(total+original.data.length>256*1024*1024)throw error('READ_ONLY','编辑原件缓存已达256MiB预算，请先处理已有草稿');
    await atomic(path.join(folder,key+'.bin'),original.data);await atomic(path.join(folder,key+'.json'),{caller,path:p,file:{...f,size:original.data.length,revision:original.revision},sha256:hash(original.data)});
   }
   return editOriginal(p,key,caller);
  }
  const kind=f.mime==='application/pdf'?'pdf':f.mime?.startsWith('image/')?'image':f.mime?.startsWith('audio/')?'audio':f.mime?.startsWith('video/')?'video':f.mime==='text/markdown'?'markdown':f.mime==='text/plain'?'text':'unsupported';
  if(['markdown','text'].includes(kind)){
   if(f.size>MAX_TEXT)return {file:{...f,access:{...f.access,canEdit:false}},kind:'unsupported',readOnlyReason:'文件过大，未截断为可编辑文本'};
   let data,bom;try{const raw=(await stable(p,MAX_TEXT)).data;data=decoder.decode(raw);bom=raw.subarray(0,3).equals(Buffer.from([239,187,191]));}catch(e){if(e.code)throw e;return {file:{...f,access:{...f.access,canEdit:false}},kind:'unsupported',readOnlyReason:'编码不是无损UTF-8'};}
   return {file:f,kind:/\.csv$/i.test(p)?'csv':kind,text:data,bom,complete:true};
  }
  if(kind==='unsupported'||f.size>256*1024*1024)return {file:f,kind:'unsupported',readOnlyReason:'此格式使用默认应用查看'};
  const handle=randomUUID();resources.set(handle,{path:p,revision:f.revision,caller,expires:Date.now()+15*60000});
  return {file:f,kind,resourceHandle:handle};
 }
 async function editOriginal(p,key,caller){
  await info(p);if(!/^[a-f0-9]{64}$/.test(key))throw error('BAD_REQUEST');const folder=path.join(storage,'edit-originals'),m=await readJson(path.join(folder,key+'.json'),null);
  if(!m||m.path!==p||m.caller!==caller)throw error('FORBIDDEN','编辑原件不属于当前文件与授权');
  const file=path.join(folder,key+'.bin');if(hash(await readFile(file))!==m.sha256)throw error('RECOVERY_REQUIRED','编辑原件校验失败');
  const handle=randomUUID();resources.set(handle,{path:p,revision:m.file.revision,caller,snapshot:file,expires:Date.now()+15*60000});return {file:m.file,kind:/\.docx$/i.test(p)?'docx':'xlsx',originalKey:key,resourceHandle:handle};
 }
 async function trashObject(id,relative=''){
  if(!uuid.test(id??''))throw error('BAD_REQUEST','回收项目标识无效');
  const dir=await trashDir(id),item=await readJson(await safePath(dir,'manifest.json'),null);
  if(item?.state!=='trashed')throw error('NOT_FOUND','回收项目已恢复或删除');
  if(relative)relative=relativePath(relative);
  if(relative&&item.type!=='directory')throw error('BAD_REQUEST');
  const entry=relative?item.entries?.find(e=>e.path===relative):item;
  if(!entry)throw error('NOT_FOUND','回收项目内没有该资料');
  const absolute=await safePath(dir,(item.type==='directory'?'original-folder':'original')+(relative?'/'+relative:'')),s=await lstat(absolute,{bigint:true});
  if((entry.type==='directory')!==s.isDirectory()||!s.isFile()&&!s.isDirectory())throw error('RECOVERY_REQUIRED','回收原件类型不一致');
  const p=item.path+(relative?'/'+relative:''),file={id:p,path:p,name:path.posix.basename(p),type:s.isDirectory()?'directory':'file',mime:s.isFile()?mimeOf(p):undefined,size:Number(s.size),modifiedAt:Number(s.mtimeMs),revision:version(s),access:{canEdit:false,canRename:false,canMove:false,canTrash:false,indexExcluded:!!entry.excluded,reasons:['回收站原件只读']}};
  return {dir,item,entry,absolute,file,relative};
 }
 async function trashPreview(id,relative,caller){
  const o=await trashObject(id,relative),{file,item}=o,baseReply={file,trashId:id,trashPath:o.relative};
  if(file.type==='directory')return {...baseReply,kind:'unsupported',items:item.entries.filter(e=>path.posix.dirname(e.path)===(o.relative||'.')).map(e=>({path:e.path,name:path.posix.basename(e.path),type:e.type,size:e.size??0}))};
  if(file.size>MAX_FILE)return {...baseReply,kind:'unsupported',readOnlyReason:'文件超过预览预算'};
  const data=await readFile(o.absolute);if(hash(data)!==o.entry.sha256)throw error('RECOVERY_REQUIRED','回收原件校验失败');
  const kind=OFFICE.test(file.path)?(/\.docx$/i.test(file.path)?'docx':'xlsx'):file.mime==='application/pdf'?'pdf':file.mime?.startsWith('image/')?'image':file.mime?.startsWith('audio/')?'audio':file.mime?.startsWith('video/')?'video':TEXT.test(file.path)?(/\.(md|mdx|markdown)$/i.test(file.path)?'markdown':/\.csv$/i.test(file.path)?'csv':'text'):'unsupported';
  if(['markdown','text','csv'].includes(kind)){if(file.size>MAX_TEXT)return {...baseReply,kind:'unsupported',readOnlyReason:'文本超过完整预览上限'};try{return {...baseReply,kind,text:decoder.decode(data)};}catch{return {...baseReply,kind:'unsupported',readOnlyReason:'编码不是 UTF-8'};}}
  if(kind==='unsupported'||OFFICE.test(file.path)&&file.size>MAX_OFFICE)return {...baseReply,kind:'unsupported',readOnlyReason:'此格式暂不支持内置预览'};
  const handle=randomUUID();resources.set(handle,{caller,trashId:id,trashPath:o.relative,revision:file.revision,expires:Date.now()+15*60000});return {...baseReply,kind,resourceHandle:handle};
 }
 async function media(a,caller){
  const r=resources.get(a.handle);
  if(!r||r.caller!==caller||r.expires<Date.now())throw error('UNAUTHORIZED','媒体读取授权已失效');
  const archived=r.trashId?await trashObject(r.trashId,r.trashPath):null,current=archived?.file??await info(r.path),f=r.snapshot?{...current,size:(await stat(r.snapshot)).size}:current;if(!r.snapshot&&f.revision!==r.revision)throw error('CONFLICT','原件已更新，请重新打开');
  if(a.offset>f.size)throw error('BAD_REQUEST','媒体读取范围无效');
  const h=await open(r.snapshot??archived?.absolute??await checked(r.path),'r'),buf=Buffer.alloc(Math.min(a.length,f.size-a.offset));
  try{const {bytesRead}=await h.read(buf,0,buf.length,a.offset);if(!r.snapshot&&(archived?(await trashObject(r.trashId,r.trashPath)).file:await info(r.path)).revision!==r.revision)throw error('CONFLICT');return {data:buf.subarray(0,bytesRead).toString('base64'),size:f.size,mime:f.mime};}finally{await h.close();}
 }
 async function replaceFile(a,caller,operationId){
  const s=stages.get(a.stageId);if(!s||s.caller!==caller||!s.final)throw error('FORBIDDEN');
  return withLock(async()=>{
   const f=await info(a.path);if(!f.access.canEdit||/\.md$/i.test(a.path))throw error('READ_ONLY','此文件不支持该保存方式');
   const before=await stable(a.path,OFFICE.test(a.path)?MAX_OFFICE:MAX_TEXT);if(before.revision!==a.expectedRevision)throw error('CONFLICT','文件已在另一入口修改，草稿未覆盖原件');
   const data=await readFile(s.file);if(data.length>(OFFICE.test(a.path)?MAX_OFFICE:MAX_TEXT)||hash(data)!==s.hash)throw error('BAD_REQUEST');
   if(!OFFICE.test(a.path))try{decoder.decode(data);}catch{throw error('BAD_REQUEST','文本须为完整UTF-8');}
   const proof=path.join(storage,'operations',operationId);await mkdir(proof,{recursive:true});await atomic(path.join(proof,'original.bin'),before.data);await atomic(path.join(proof,'intent.json'),{path:a.path,before:hash(before.data),after:hash(data)});
   if((await info(a.path)).revision!==a.expectedRevision)throw error('CONFLICT');await atomic(before.absolute,data);const result={committed:true,path:a.path,revision:(await info(a.path)).revision};await atomic(path.join(proof,'committed.json'),result);return result;
  });
 }
 async function retainExclusion(source,destination,force=false){
  await locked(policyFile(base),async()=>{
   const p=readIndexPolicy(base);
   if(!force&&!policyExcluded(p,source))return;
   const id=randomUUID();
   p.groups[id]={id,state:'excluded',excluded:true,pending:false,files:[{current:destination,normal:destination,aliases:[source]}],savedLinks:[]};
   await savePolicy(base,p);
  });
 }
 async function moveInventory(parent,out=[],depth=0){
  if(depth>20)throw error('BAD_REQUEST','目录层级超过此次操作预算');
  for(const e of await readdir(await checked(parent),{withFileTypes:true})){
   const p=parent+'/'+e.name;
   if(e.name.startsWith('.')||e.isSymbolicLink()||privatePath(p)||['node_modules','索引层'].includes(e.name))throw error('READ_ONLY','目录内有未授权、内部或链接资料，请单独移动可见文件');
   const f=await info(p);if(f.protected)throw error('READ_ONLY','目录内有受保护资料');out.push(f);
   if(out.length>5000)throw error('BAD_REQUEST','目录超过候选版移动预算');
   if(f.type==='directory')await moveInventory(p,out,depth+1);
  }return out;
 }
 async function referencePlan(source,destination){
  const rewrites=[],unresolved=[];
  const mapped=p=>p===source?destination:p.startsWith(source+'/')?destination+p.slice(source.length):p;
  for(const file of await walk()){
   if(!/\.md$/i.test(file.path)||file.size>MAX_TEXT)continue;
   const before=await stable(file.path,MAX_TEXT);let text;try{text=decoder.decode(before.data);}catch{continue;}
   const destinationPath=mapped(file.path);
   let next=text.replace(/\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g,(whole,target,anchor='',label='')=>{
    const explicit=target.endsWith('.md')?target:target+'.md',changed=mapped(explicit);
    if(changed!==explicit)return '[['+(target.endsWith('.md')?changed:changed.replace(/\.md$/i,''))+anchor+label+']]';
    if(!target.includes('/')&&target===path.posix.basename(source).replace(/\.md$/i,''))unresolved.push(file.path);
    return whole;
   });
   next=next.replace(/\]\(([^)]+)\)/g,(whole,target)=>{
    if(target.startsWith('#')||/^[a-z]+:/i.test(target))return whole;
    let decoded;try{decoded=decodeURIComponent(target.split('#')[0]);}catch{return whole;}
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),decoded));
    const targetPath=mapped(resolved);
    if(targetPath===resolved&&destinationPath===file.path)return whole;
    const rel=path.posix.relative(path.posix.dirname(destinationPath),targetPath);
    return ']('+encodeURI(rel)+(target.includes('#')?'#'+target.split('#').slice(1).join('#'):'')+')';
   });
   if(next!==text){if(file.protected){unresolved.push(file.path);continue;}rewrites.push({path:file.path,destinationPath,revision:before.revision,before:before.data.toString('base64'),after:Buffer.concat([before.data.subarray(0,3).equals(Buffer.from([239,187,191]))?Buffer.from([239,187,191]):Buffer.alloc(0),Buffer.from(next)]).toString('base64')});}
  }
  return {rewrites,unresolved:[...new Set(unresolved)]};
 }
 async function plan(a,caller){
  const {operation}=a,id=randomUUID(),p={id,caller,expires:Date.now()+5*60000,operation,source:a.path??'',destination:a.destination??'',revision:a.revision,rewrites:[],unresolved:[]};
  if(['create','mkdir'].includes(operation)){
   p.destination=relativePath(a.destination);osName(path.posix.basename(p.destination));await checked(p.destination,{missing:true,write:true});
   if(await lstat(path.join(base,p.destination)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('CONFLICT','目标已存在');
   await stat(path.dirname(path.join(base,p.destination)));
  }else if(['move','trash'].includes(operation)){
   p.source=relativePath(a.path);const f=await info(p.source);
   if(!f.access.canMove||!f.access.canTrash)throw error('READ_ONLY',f.access.reasons.join('；'));
   if(f.revision!==a.revision)throw error('CONFLICT','原件已更新，请重新预览');
   p.revision=f.revision;p.isDirectory=f.type==='directory';
   if(p.isDirectory&&operation==='trash'){p.descendants=await moveInventory(p.source);if(p.descendants.some(f=>!f.access.canTrash))throw error('READ_ONLY','目录内有只读或受保护资料');}
   if(operation==='move'){
    p.destination=relativePath(a.destination);osName(path.posix.basename(p.destination));await checked(p.destination,{missing:true,write:true});
    if(p.destination===p.source||p.destination.startsWith(p.source+'/'))throw error('BAD_REQUEST','目标目录不能位于源目录内');
    if(await lstat(path.join(base,p.destination)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('CONFLICT','目标已存在，不覆盖同名资料');
    await stat(path.dirname(path.join(base,p.destination)));
    if(p.isDirectory)p.descendants=await moveInventory(p.source);
    Object.assign(p,await referencePlan(p.source,p.destination));
   }
  }else if(['restore','purge'].includes(operation)){
   if(!uuid.test(a.path??''))throw error('BAD_REQUEST');
   p.item=await readJson(path.join(await trashDir(a.path),'manifest.json'),null);
   if(!p.item||p.item.state!=='trashed')throw error('NOT_FOUND');
   p.trashId=a.path;
   if(operation==='restore'){p.destination=relativePath(a.destination||p.item.path);await checked(p.destination,{missing:true,write:true});if(await lstat(path.join(base,p.destination)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('CONFLICT','恢复目标已存在，请选择新名称');}
  }else throw error('BAD_REQUEST','不支持该计划');
  plans.set(id,p);
  return {id,operation,expiresAt:p.expires,source:p.source,destination:p.destination,linkUpdates:p.rewrites.length,unresolvedLinks:p.unresolved,canCommit:true};
 }
 async function publishNew(file,data){
  const h=await open(file,'wx');try{await h.writeFile(data);await h.sync();}finally{await h.close();}
 }
 async function validateTrashedDirectory(dir,item,relative='original-folder'){
  const folder=await safePath(dir,relative),found=[];
  async function visit(relative='',depth=0){
   if(depth>20||found.length>5000)throw error('RECOVERY_REQUIRED','回收目录超过校验预算');
   const current=relative?await safePath(folder,relative):folder;
   for(const e of await readdir(current,{withFileTypes:true})){
    if(e.isSymbolicLink())throw error('RECOVERY_REQUIRED','回收目录含链接');
    const p=relative?relative+'/'+e.name:e.name,expected=item.entries.find(v=>v.path===p);if(!expected||expected.type!==(e.isDirectory()?'directory':'file'))throw error('RECOVERY_REQUIRED','回收目录内容已改变');
    found.push(p);if(e.isDirectory())await visit(p,depth+1);else if(hash(await readFile(await safePath(folder,p)))!==expected.sha256)throw error('RECOVERY_REQUIRED','回收原件校验失败');
   }
  }
  await visit();if(found.length!==item.entries.length)throw error('RECOVERY_REQUIRED','回收目录内容不完整');return folder;
 }
 async function finishDirectoryTrash(operationId,item){
  const dir=await trashDir(operationId);await validateTrashedDirectory(dir,item);
  await atomic(path.join(dir,'manifest.json'),{...item,state:'trashed'});
  const result={committed:true,path:item.path,operation:'trash',unresolvedLinks:[],requestState:'committed'};
  await atomic(path.join(storage,'operations',operationId,'committed.json'),result);return result;
 }
 async function commit(a,caller,operationId){
  const p=plans.get(a.planId);if(!p||p.caller!==caller||p.expires<Date.now())throw error('CONFLICT','操作计划已失效，请重新预览');
  const proofDir=path.join(storage,'operations',operationId);await mkdir(proofDir,{recursive:true});
  return withLock(async()=>{
   await atomic(path.join(proofDir,'intent.json'),p);
   if(p.operation==='create'||p.operation==='mkdir'){
    const dst=await checked(p.destination,{missing:true,write:true});
    if(p.operation==='mkdir')await mkdir(dst);
    else {if(typeof a.text!=='string'||Buffer.byteLength(a.text)>MAX_TEXT||a.text.startsWith('\ufeff'))throw error('BAD_REQUEST');await publishNew(dst,Buffer.from(a.text));}
   }else if(p.operation==='move'){
    const src=await checked(p.source,{write:true}),dst=await checked(p.destination,{missing:true,write:true});
    if((await info(p.source)).revision!==p.revision)throw error('CONFLICT','原件已改变');
    for(const f of p.descendants??[])if((await info(f.path)).revision!==f.revision)throw error('CONFLICT','目录内资料已改变');
    for(const r of p.rewrites)if((await info(r.path)).revision!==r.revision)throw error('CONFLICT','引用文件已改变');
    await retainExclusion(p.source,p.destination);
    for(const f of p.descendants??[])if(f.access.indexExcluded)await retainExclusion(f.path,p.destination+f.path.slice(p.source.length));
    const done=[];
    try{
     if(p.isDirectory)await rename(src,dst);else{await link(src,dst);await unlink(src);}
     done.push({kind:'move'});
     for(const r of p.rewrites){
      await atomic(path.join(proofDir,hash(r.path)+'.original'),Buffer.from(r.before,'base64'));
      const file=await checked(r.destinationPath,{write:true});if(hash((await stable(r.destinationPath)).data)!==hash(Buffer.from(r.before,'base64')))throw error('CONFLICT');
      await atomic(file,Buffer.from(r.after,'base64'));done.push(r);
     }
    }catch(e){
     // Restore only bytes still matching our published rewrite; preserve external edits.
     for(const r of done.filter(x=>x.path).reverse()){
      const now=await readFile(path.join(base,r.destinationPath));
      if(hash(now)===hash(Buffer.from(r.after,'base64')))await atomic(path.join(base,r.destinationPath),Buffer.from(r.before,'base64'));
     }
     if(done.some(x=>x.kind==='move')&&!await lstat(src).catch(()=>null))await rename(dst,src).catch(()=>{});
     throw e;
    }
   }else if(p.operation==='trash'){
    const src=await checked(p.source,{write:true});if((await info(p.source)).revision!==p.revision)throw error('CONFLICT');
    const dir=await trashDir(operationId,{create:true});
    if(p.isDirectory){
     const now=await moveInventory(p.source);if(hash(now.map(f=>[f.path,f.revision]))!==hash(p.descendants.map(f=>[f.path,f.revision])))throw error('CONFLICT','目录内资料已改变');
     const entries=[];let size=0;
     for(const f of now){const data=f.type==='file'?await stable(f.path):null;size+=data?.data.length??0;if(size>MAX_BACKUP)throw error('BAD_REQUEST','目录超过128MiB回收预算');entries.push({path:f.path.slice(p.source.length+1),type:f.type,size:f.size,excluded:f.access.indexExcluded,...(data?{sha256:hash(data.data)}:{})});}
     const latest=await moveInventory(p.source);if((await info(p.source)).revision!==p.revision||hash(latest.map(f=>[f.path,f.revision]))!==hash(now.map(f=>[f.path,f.revision])))throw error('CONFLICT','目录内资料已改变');
     const item={id:operationId,path:p.source,type:'directory',entries,size,state:'prepared',deletedAt:Date.now(),excluded:policyExcluded(readIndexPolicy(base),p.source)};
     await atomic(path.join(dir,'manifest.json'),item);await rename(src,path.join(dir,'original-folder'));await finishDirectoryTrash(operationId,item);
    }else{
     const data=(await stable(p.source)).data;await publishNew(path.join(dir,'original'),data);
     const item={id:operationId,path:p.source,type:'file',size:data.length,state:'prepared',sha256:hash(data),deletedAt:Date.now(),excluded:policyExcluded(readIndexPolicy(base),p.source)};
     await atomic(path.join(dir,'manifest.json'),item);if((await info(p.source)).revision!==p.revision)throw error('CONFLICT');
     await unlink(src);await atomic(path.join(dir,'manifest.json'),{...item,state:'trashed'});
    }
   }else if(p.operation==='restore'){
    const {dir,item}=await trashObject(p.trashId);if(hash(item)!==hash(p.item))throw error('CONFLICT','回收项目已改变');
    const dst=await checked(p.destination,{missing:true,write:true});if(await lstat(dst).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('CONFLICT','恢复目标已存在，请选择新名称');
    if(item.excluded)await retainExclusion(item.path,p.destination,true);
    if(item.type==='directory'){
     const original=await validateTrashedDirectory(dir,item);
     for(const e of item.entries)if(e.excluded)await retainExclusion(item.path+'/'+e.path,p.destination+'/'+e.path,true);
     try{await rename(original,dst);}catch(e){
      if(e.code!=='EXDEV')throw e;
      // Legacy archives can live on another volume. Copy into a private stage
      // beside the library, verify every entry, then publish on that volume.
      // Retain the legacy original, as for restored single-file archives.
      const staging=await trashDir(operationId,{create:true}),name='restore-copy';
      await cp(original,path.join(staging,name),{recursive:true,force:false,errorOnExist:true,preserveTimestamps:true});
      await validateTrashedDirectory(staging,item,name);
      if(await lstat(dst).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('CONFLICT','恢复目标已存在');
      await rename(path.join(staging,name),dst);
     }
    }else{const data=await readFile(await safePath(dir,'original'));if(hash(data)!==item.sha256)throw error('RECOVERY_REQUIRED','回收原件校验失败');await publishNew(dst,data);}
    await atomic(path.join(dir,'manifest.json'),{...item,state:'restored',restoredTo:p.destination});
   }else if(p.operation==='purge'){
    const {dir,item,absolute}=await trashObject(p.trashId);if(hash(item)!==hash(p.item))throw error('CONFLICT','回收项目已改变');
    if(item.type==='directory')await deleteTree(dir,absolute);else await unlink(absolute);
    await atomic(path.join(dir,'manifest.json'),{...item,state:'purged'});
   }else if(p.operation==='import'){
    const stage=stages.get(p.stageId);if(!stage||stage.caller!==caller||!stage.final)throw error('UNAUTHORIZED');
    const data=await readFile(stage.file);if(hash(data)!==stage.hash)throw error('CONFLICT');
    await publishNew(await checked(p.destination,{missing:true,write:true}),data);
   }
   const result={committed:true,path:p.destination||p.source,operation:p.operation,unresolvedLinks:p.unresolved,requestState:'committed'};
   await atomic(path.join(proofDir,'committed.json'),result);plans.delete(p.id);return result;
  });
 }
 async function manifests(kind){
  const rows=[],seen=new Set(),dirs=kind==='trash'?[localTrash,path.join(storage,kind)]:[path.join(storage,kind)];
  for(const dir of dirs)for(const item of await readdir(dir).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))){
   if(!uuid.test(item)||seen.has(item))continue;seen.add(item);
   if((await lstat(path.join(dir,item))).isSymbolicLink())continue;
   const entry=kind==='trash'?await trashDir(item):await safePath(privateDir,'desktop/'+kind+'/'+item);
   let m=await readJson(await safePath(entry,'manifest.json',{missing:true}),null);
   if(kind==='trash'&&m?.state==='prepared'&&m.type==='directory'&&await lstat(path.join(entry,'original-folder')).catch(()=>null)){await finishDirectoryTrash(item,m);m={...m,state:'trashed'};}
   if(m)rows.push(kind==='backups'?{...m,id:item,digest:hash(m)}:m);
  }
  return rows.sort((a,b)=>(b.createdAt??b.deletedAt??0)-(a.createdAt??a.deletedAt??0));
 }
 async function backupPath(id,{missing=false}={}){
  if(!uuid.test(id??''))throw error('BAD_REQUEST','备份标识无效');
  return safePath(privateDir,'desktop/backups/'+id,{missing});
 }
 async function deleteTree(parent,target){
  // Verify every directory before descending. Links are unlinked, never followed.
  const canonicalParent=await realpath(parent),s=await lstat(target);
  if(!inside(canonicalParent,target)||target===canonicalParent)throw error('FORBIDDEN','删除路径超出备份目录');
  if(s.isSymbolicLink()||!s.isDirectory()){await unlink(target);return;}
  const canonicalTarget=await realpath(target);
  if(!inside(canonicalParent,canonicalTarget)||canonicalTarget===canonicalParent)throw error('FORBIDDEN','删除路径超出备份目录');
  for(const name of await readdir(target))await deleteTree(canonicalParent,path.join(target,name));
  await rmdir(target);
 }
 async function finishBackupDelete(operationId,intent){
  const parent=await safePath(privateDir,'desktop/backups'),tomb=await safePath(parent,'.deleting-'+operationId,{missing:true});
  let receipt=await readJson(path.join(storage,'operations',operationId,'committed.json'),null);
  const staged=await lstat(tomb).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(!receipt){
   if(!staged)return null;
   const manifest=await readJson(await safePath(tomb,'manifest.json'),null);
   if(hash(manifest)!==intent.expectedDigest)throw error('RECOVERY_REQUIRED','待删除备份校验失败');
   receipt={committed:true,deleted:true,backupId:intent.backupId,cleanupPending:true};
   await atomic(path.join(storage,'operations',operationId,'committed.json'),receipt);
  }
  if(receipt.cleanupPending){
   try{if(staged)await deleteTree(parent,tomb);receipt={...receipt,cleanupPending:false};await atomic(path.join(storage,'operations',operationId,'committed.json'),receipt);}
   catch{ /* Logical removal is durable; startup recovery retries private-file cleanup. */ }
  }
  return receipt;
 }
 async function backupDelete(a,operationId){
  const source=await backupPath(a.backupId,{missing:true});
  if(!await lstat(source).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('CONFLICT','备份已不存在，请刷新列表');
  const manifest=await readJson(await safePath(source,'manifest.json'),null);
  if(hash(manifest)!==a.expectedDigest)throw error('CONFLICT','备份已发生变化，请刷新后重新确认');
  const parent=await safePath(privateDir,'desktop/backups'),tomb=await safePath(parent,'.deleting-'+operationId,{missing:true});
  const intent={operation:'backupDelete',backupId:a.backupId,expectedDigest:a.expectedDigest};
  await atomic(path.join(storage,'operations',operationId,'intent.json'),intent);
  await rename(source,tomb);
  for(const [id,p] of plans)if(p.backupId===a.backupId)plans.delete(id);
  return finishBackupDelete(operationId,intent);
 }
 async function backup(operationId){
  const dir=path.join(storage,'backups',operationId);await mkdir(path.join(dir,'files'),{recursive:true});
  const files=await walk();let total=0;const manifest=[];
  for(const f of files){const b=await stable(f.path);total+=b.data.length;if(total>MAX_BACKUP)throw error('BAD_REQUEST','备份超过候选版128MB预算');
   await mkdir(path.dirname(path.join(dir,'files',f.path)),{recursive:true});await publishNew(path.join(dir,'files',f.path),b.data);manifest.push({path:f.path,sha256:hash(b.data),size:b.data.length});}
  const shared=await readJson(path.join(base,'.kbmeta/shared-state.json'),null),policy=readIndexPolicy(base);
  await atomic(path.join(dir,'state.json'),{shared,policy});
  const result={id:operationId,createdAt:Date.now(),files:manifest,size:total,verified:true,scope:'authorized-public-files-and-shared-state'};
  await atomic(path.join(dir,'manifest.json'),result);const receipt={id:operationId,files:manifest.length,size:total,createdAt:result.createdAt,verified:true};await atomic(path.join(storage,'operations',operationId,'committed.json'),receipt);return receipt;
 }
 async function restorePreview(backupId,caller){
  const dir=await backupPath(backupId,{missing:true});
  if(!await lstat(dir).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))throw error('NOT_FOUND');
  const manifest=await readJson(await safePath(dir,'manifest.json',{missing:true}),null);if(!manifest?.verified)throw error('NOT_FOUND');
  const id=randomUUID();plans.set(id,{id,caller,backupId,manifest,expires:Date.now()+300000,operation:'backupRestore'});
  return {id,files:manifest.files.length,size:manifest.size,mode:'new-copy',canCommit:true};
 }
 async function restoreCopy(planId,caller,operationId){
  const p=plans.get(planId);if(!p||p.caller!==caller||p.operation!=='backupRestore'||p.expires<Date.now())throw error('CONFLICT');
  const dst=path.join(sandbox,'libraries','恢复副本-'+operationId.slice(0,8));await mkdir(dst,{recursive:false});
  const kernel=createEmbeddedKernel({stateDir:path.join(storage,'restore-init',operationId)});
  try{const result=await kernel.openCore().bind(dst,{confirmInit:true});if(!result.ok)throw error('BINDING_CHANGED');}finally{kernel.dispose();}
  await atomic(path.join(dst,'.desktop-preview.json'),{schemaVersion:1,synthetic:true,restoredAt:Date.now()});
  for(const f of p.manifest.files){
   const data=await readFile(path.join(storage,'backups',p.backupId,'files',f.path));if(hash(data)!==f.sha256)throw error('RECOVERY_REQUIRED','备份文件校验失败');
   const target=await safePath(dst,f.path,{missing:true});await mkdir(path.dirname(target),{recursive:true});await atomic(target,data);
  }
  const state=await readJson(path.join(storage,'backups',p.backupId,'state.json'));
  await atomic(path.join(dst,'.desktop-restore-state.json'),state);
  const result={committed:true,copyRoot:dst,files:p.manifest.files.length,restoreStatePending:true};await atomic(path.join(storage,'operations',operationId,'committed.json'),result);plans.delete(planId);return result;
 }
 async function restoreState(){
  const pending=path.join(base,'.desktop-restore-state.json'),state=await readJson(pending,null);if(!state)return {committed:true,alreadyApplied:true};
  return withLock(async()=>{if(state.shared?.schemaVersion===1||state.shared?.format===1)await atomic(path.join(base,'.kbmeta/shared-state.json'),state.shared);if(state.policy?.format===1)await atomic(path.join(base,'.kbmeta/index-policy.json'),state.policy);await unlink(pending);return {committed:true};});
 }
 // Retry only cleanup of already staged deletions, including after a crash between
 // the atomic rename and receipt publication. Never infer deletion from absence.
 for(const name of await readdir(path.join(storage,'backups')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e))){
  const match=/^\.deleting-([a-f0-9]{64})$/.exec(name);if(!match)continue;
  const intent=await readJson(path.join(storage,'operations',match[1],'intent.json'),null);
  if(intent?.operation==='backupDelete')await finishBackupDelete(match[1],intent);
 }
 return {
  async sourceFromStage(id,caller){const s=stages.get(id);if(!s||s.caller!==caller||!s.final)throw error('FORBIDDEN');const data=await readFile(s.file);if(hash(data)!==s.hash)throw error('CONFLICT','暂存原件已变化');return {data,name:s.name,bytes:data.length,external:true};},
  async recoverReceipt(operationId){const intent=await readJson(path.join(storage,'operations',operationId,'intent.json'),null);if(intent?.operation==='backupDelete')return finishBackupDelete(operationId,intent);const receipt=await readJson(path.join(storage,'operations',operationId,'committed.json'),null);if(receipt)return receipt;if(intent?.operation==='trash'){
   const dir=await trashDir(operationId),item=await readJson(path.join(dir,'manifest.json'),null);
   if(item?.type==='directory'&&item.state==='prepared'){
    if(await lstat(path.join(dir,'original-folder')).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))return finishDirectoryTrash(operationId,item);
    try{const current=await info(intent.source),entries=await moveInventory(intent.source);if(current.revision===intent.revision&&hash(entries.map(f=>[f.path,f.revision]))===hash(intent.descendants.map(f=>[f.path,f.revision])))return {failed:true,error:{code:'CONFLICT',message:'上次回收未移动原目录，操作已确认失败。请重新预览后提交。'}};}catch{}
   }
  }return null;},
  async call(method,a,caller,operationId){
   if(method==='desktop.list')return list(a.parent??'',a.offset??0,a.limit??500);
   if(method==='desktop.listSorted')return list(a.parent??'',a.offset??0,a.limit??500,a.sort??'name-asc');
   if(method==='desktop.stat')return info(a.path);
   if(method==='desktop.preview')return preview(a.path,caller);
   if(method==='desktop.trashPreview')return trashPreview(a.id,a.path??'',caller);
   if(method==='desktop.editOriginal')return editOriginal(a.path,a.originalKey,caller);
   if(method==='desktop.fileReplace')return replaceFile(a,caller,operationId);
   if(method==='desktop.media')return media(a,caller);
   if(method==='desktop.plan')return plan(a,caller);
   if(method==='desktop.commit')return commit(a,caller,operationId);
   if(method==='desktop.trash')return {items:(await manifests('trash')).filter(m=>m.state==='trashed')};
   if(method==='desktop.backups')return {items:(await manifests('backups')).map(({files,...m})=>({...m,fileCount:Array.isArray(files)?files.length:0}))};
   if(method==='desktop.backupCreate')return backup(operationId);
   if(method==='desktop.backupDelete')return backupDelete(a,operationId);
   if(method==='desktop.restorePreview')return restorePreview(a.backupId,caller);
   if(method==='desktop.restoreCommit')return restoreCopy(a.planId,caller,operationId);
   if(method==='desktop.restoreState')return restoreState();
   if(method==='desktop.tasks')return {items:[]};
   if(method==='desktop.search'){
    const all=await walk(),q=a.query.toLowerCase(),items=[];
    for(const f of all){
     if(a.mode==='name'&&(f.path.toLowerCase().includes(q)))items.push({...f,snippet:f.path});
     if(a.mode==='fulltext'&&!f.access.indexExcluded&&/\.(md|txt)$/i.test(f.path)&&f.size<MAX_TEXT){const b=await stable(f.path,MAX_TEXT);let text;try{text=decoder.decode(b.data);}catch{continue;}const i=text.toLowerCase().indexOf(q);if(i>=0)items.push({...f,snippet:text.slice(Math.max(0,i-36),i+120)});}
     if(items.length>=100)break;
    }return {items};
   }
   if(method==='desktop.importStage'||method==='desktop.editStage'){
    osName(a.name);let s=a.stageId?stages.get(a.stageId):null;
    if(a.stageId&&(!s||s.caller!==caller))throw error('UNAUTHORIZED');
    if(!s){const id=randomUUID(),file=path.join(storage,'imports',id);await mkdir(path.dirname(file),{recursive:true});await publishNew(file,Buffer.alloc(0));s={id,file,caller,size:0,name:a.name,final:false};stages.set(id,s);}
    if(s.final||s.name!==a.name)throw error('CONFLICT');
    const data=Buffer.from(a.data,'base64');s.size+=data.length;if(s.size>MAX_FILE)throw error('BAD_REQUEST','导入超过64MB预算');
    const h=await open(s.file,'a');try{await h.writeFile(data);}finally{await h.close();}s.final=a.final;if(s.final)s.hash=hash(await readFile(s.file));return {stageId:s.id,size:s.size,final:s.final};
   }
   if(method==='desktop.importPlan'){
    const s=stages.get(a.stageId);if(!s||s.caller!==caller||!s.final)throw error('UNAUTHORIZED');
    const p=await plan({operation:'create',destination:a.destination},caller),stored=plans.get(p.id);stored.operation='import';stored.stageId=s.id;return {...p,operation:'import'};
   }
   throw error('CAPABILITY_UNSUPPORTED');
  }
 };
}

