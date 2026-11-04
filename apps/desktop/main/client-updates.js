import {createHash} from 'node:crypto';
import {mkdir,rename,unlink,open} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {compareKnowledgeVersions,parseKnowledgeVersion,UPDATE_POLICY}=await import(new URL('../../../packages/kb-contracts/version-policy.js',import.meta.url).href).catch(()=>import(pathToFileURL(path.join(process.resourcesPath,'kb-runtime/packages/kb-contracts/version-policy.js')).href));
const repo='KingsleyAsher/Personal-Knowledge-Base';
export const CLIENT_SOURCES=Object.freeze([
 {id:'gitee',name:'Gitee',manifest:`https://gitee.com/${repo}/raw/main/client-update.json`,release:tag=>`https://gitee.com/api/v5/repos/${repo}/releases/tags/${tag}`},
 {id:'gitcode',name:'GitCode',manifest:`https://api.gitcode.com/api/v5/repos/${repo}/raw/client-update.json?ref=main`,release:tag=>`https://api.gitcode.com/api/v5/repos/${repo}/releases/tags/${tag}`},
 {id:'github',name:'GitHub',manifest:`https://raw.githubusercontent.com/${repo}/main/client-update.json`,release:tag=>`https://api.github.com/repos/${repo}/releases/tags/${tag}`}
]);
const domains=['gitee.com','giteeusercontent.com','gitcode.com','myhuaweicloud.com','huaweicloud.com','github.com','githubusercontent.com'];
export function trustedUpdateUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw Error('更新源跳转不受信任');return u.href;}
export function validateClientManifest(m){if(m?.product!=='knowledge-workbench-client'||m.platform!=='win32-x64'||!parseKnowledgeVersion(m.version)||m.tag!=='client-v'+m.version||!/^[a-f0-9]{16}$/.test(m.buildId)||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>512*1024*1024||!/^[A-Za-z0-9._-]+-Setup\.exe$/.test(m.asset))throw Error('客户端更新清单身份或格式无效');return m;}
async function response(fetchFn,url,signal){for(let n=0;n<6;n++){const res=await fetchFn(trustedUpdateUrl(url),{redirect:'manual',signal,cache:'no-store',headers:{accept:'application/json,application/octet-stream', 'user-agent':'knowledge-workbench-client'}});if([301,302,303,307,308].includes(res.status)){const loc=res.headers.get('location');await res.body?.cancel();if(!loc)throw Error('更新源跳转缺失');url=new URL(loc,url).href;continue;}if(!res.ok)throw Error('HTTP '+res.status);return res;}throw Error('更新源跳转过多');}
async function json(fetchFn,url,timeout=5000){const signal=AbortSignal.timeout(timeout),res=await response(fetchFn,url,signal);const reader=res.body.getReader();let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw Error('更新元数据过大');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export function createClientUpdater({version,directory,fetch:fetchFn=globalThis.fetch,sources=CLIENT_SOURCES}){
 let cached=null,expires=0,inflight=null,downloadFlight=null;
 let state={configured:true,policy:UPDATE_POLICY,sources:sources.map(({id,name})=>({id,name})),installSupported:false,message:'正在等待检查客户端更新'};
 async function check({force=false}={}){if(inflight)return inflight;if(!force&&cached&&Date.now()<expires)return state;
 inflight=(async()=>{const rows=await Promise.all(sources.map(async source=>{try{return {source,manifest:validateClientManifest(await json(fetchFn,source.manifest))};}catch{return {source,error:'更新源暂不可用或清单校验失败'};}}));
 const valid=rows.filter(r=>r.manifest);state.sourceStatus=rows.map(r=>({id:r.source.id,name:r.source.name,ok:!!r.manifest,message:r.error}));
 if(!valid.length){state={...state,ok:false,message:'无法检查更新：所有更新源暂不可用；保留当前版本。'};return state;}
 valid.sort((a,b)=>compareKnowledgeVersions(b.manifest.version,a.manifest.version));const chosen=valid[0];
 if(valid.some(r=>r.manifest.version===chosen.manifest.version&&(r.manifest.sha256!==chosen.manifest.sha256||r.manifest.bytes!==chosen.manifest.bytes||r.manifest.buildId!==chosen.manifest.buildId))){state={...state,ok:false,message:'相同版本的更新源摘要冲突，已阻止下载。'};return state;}
 if(state.manifest?.sha256!==chosen.manifest.sha256)state.downloaded=false;
 const updateAvailable=compareKnowledgeVersions(chosen.manifest.version,version)>0;state={...state,ok:true,version,latestVersion:chosen.manifest.version,updateAvailable,manifest:chosen.manifest,source:chosen.source.name,message:updateAvailable?'发现新版本，将自动下载并校验；自动安装尚未接入。':'当前版本已是最新可用客户端版本。'};cached=chosen.manifest;expires=Date.now()+6*60*60*1000;return state;
 })().finally(()=>{inflight=null;});return inflight;}
 async function download(){if(downloadFlight)return downloadFlight;downloadFlight=(async()=>{await check();if(!state.ok||!state.updateAvailable||state.downloaded)return state;const expected=state.manifest;await mkdir(directory,{recursive:true});const target=path.join(directory,expected.asset),temp=target+'.part';
 for(const source of sources){let handle;try{let url;if(source.id==='github'){url=`https://github.com/${repo}/releases/download/${expected.tag}/${expected.asset}`;}else{const meta=await json(fetchFn,source.release(expected.tag));const listed=source.id==='gitee'?await json(fetchFn,`https://gitee.com/api/v5/repos/${repo}/releases/${meta.id}/attach_files`):null;const rows=listed??(Array.isArray(meta.assets)?meta.assets:[...(meta.assets?.links??[]),...(meta.assets?.sources??[]),...(meta.attach_files??[])]);const asset=rows.find(a=>(a.name??a.filename)===expected.asset);if(!asset)throw Error('缺少安装附件');url=asset.browser_download_url??asset.direct_asset_url??asset.download_url??asset.url;}const res=await response(fetchFn,url,AbortSignal.timeout(10*60*1000));if(Number(res.headers.get('content-length')||0)>expected.bytes)throw Error('安装包过大');handle=await open(temp,'w');const h=createHash('sha256');let bytes=0;try{for await(const chunk of res.body){bytes+=chunk.length;if(bytes>expected.bytes)throw Error('安装包过大');h.update(chunk);let offset=0;while(offset<chunk.length){const result=await handle.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)throw Error('写入安装包失败');offset+=result.bytesWritten;}}}finally{await handle.close();handle=null;}if(bytes!==expected.bytes||h.digest('hex')!==expected.sha256)throw Error('安装包校验失败');await rename(temp,target);state={...state,downloaded:true,downloadSource:source.name,message:'新版已自动下载并通过 SHA-256 校验；自动安装能力尚未接入。'};return state;}catch{await handle?.close().catch(()=>{});await unlink(temp).catch(()=>{});}}
 state={...state,downloaded:false,message:'新版下载失败或校验不符，保留当前版本，稍后重试。'};return state;
 })().finally(()=>{downloadFlight=null;});return downloadFlight;}
 return {check,download,status:()=>state};
}
