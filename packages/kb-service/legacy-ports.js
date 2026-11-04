import path from 'node:path';import {error} from './io.js';
export function createLegacyPorts({kernel,kbId,root,maintenance,changeMaintenance}){
 const wb=op=>kernel.dispatch({...op,expectedKbId:kbId});
 return async function legacy(a){
  if(a.op==='overview'){
   const [st,snap]=await Promise.all([kernel.core.status(),wb({op:'atlas.snapshot',fresh:a.fresh})]);
   return {ok:true,overview:{at:new Date().toISOString(),version:snap.version,identity:{bound:true,kbPath:root,name:path.basename(root),kbId,kbIdShort:kbId.slice(0,8),mode:'read-write',stateDir:st.stateDir},run:{config:st.config,kb:{healthy:st.healthy,reason:st.healthReason},index:st.index,lastCheck:{known:false},scan:{status:snap.coverage.truncated?'partial':'ok',at:new Date().toISOString(),errors:snap.coverage.errors,coverage:snap.coverage}},layers:{entries:snap.totals.knowledge,entriesInIndex:st.counts?.entries,originals:snap.sections.find(s=>s.name==='90-收件箱')?.files??0,drafts:snap.sections.find(s=>s.name==='50-底稿')?.files??0,filesAll:snap.totals.files,physicalEntries:null,foldedSources:null,bytesAll:null,coverage:snap.coverage},issues:st.index?.fresh?[]:[{kind:'index-stale',label:'索引待同步',detail:st.index?.reasonLabel??st.index?.reason??'正在核对原件'}],sections:snap.sections,recent:snap.recent,privacy:{masked:snap.totals.private>0}}};
  }
  if(a.op==='files'){const r=await wb({...a,op:'atlas.list',mode:'name',direct:false});return {ok:true,...r,root,files:r.items};}
  if(a.op==='dirs')return {ok:true,dirs:{current:root,candidate:root,defaultCandidate:root,canWrite:true}};
  if(a.op==='index-maintenance.status'){const s=await kernel.core.status();return {ok:true,enabled:(await kernel.core.getConfig()).autoIndex!==false,scheduler:maintenance()?.status(),maintenance:kernel.core.maintenanceStatus(),kbId,index:s.index};}
  if(a.op==='index-maintenance.configure'){const r=await kernel.core.setConfig({autoIndex:a.enabled===true});changeMaintenance(a.enabled===true);return r;}
  if(a.op==='index-snapshots')return kernel.core.indexSnapshots({restore:a.restore,expectedKbId:kbId});
  if(a.op==='index-rebuild'){const result=await kernel.core.maintainIndex({full:true,expectedKbId:kbId,expectedRevision:a.expectedRevision,confirmDrop:a.confirmDrop});return {ok:result.ok,result,error:result.ok?undefined:result.detail??result.reason};}
  if(['setup','bind','probe-folder'].includes(a.op)){if(path.resolve(a.path??a.kbPath??root).toLowerCase()!==root.toLowerCase())throw error('BINDING_CHANGED','共库连接绑定当前库；切换库需重新建立该库连接，未切换或改动其他库');return {ok:true,result:{ok:true,bound:true,kbId,kbPath:root,action:'already-bound'},folder:{path:root,kind:'knowledge-base'}};}
  throw error('CAPABILITY_UNSUPPORTED');
 };
}
