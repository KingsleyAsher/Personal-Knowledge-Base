import {randomUUID} from 'node:crypto'
import {safePath,atomicJson,locked,digest,fail} from './workbench-state.js'
import {CATALOG_PATH,CATALOG_FORMAT,readCatalog,inspectOriginals,refreshCatalog,classifyOriginal,repairClassifications} from './file-catalog.js'

export function createIndexArchitecture({binding,now=Date.now}){
  const plans=new Map(),fingerprint=scan=>digest(JSON.stringify({files:scan.files,references:scan.references}))
  const check=async b=>{if((await binding(b.st.kbId)).key!==b.key)throw fail('BINDING_CHANGED','资料库已改变，请重新预览')}
  async function preview(b){
    await check(b);const previous=await readCatalog(b.root,b.st.kbId),scan=await inspectOriginals(b,{previous})
    const planId=randomUUID(),revision=fingerprint(scan);plans.set(planId,{key:b.key,revision,expiresAt:now()+600000,previousRevision:previous?.revision??null,files:scan.files})
    for(const [id,p]of plans)if(p.expiresAt<now())plans.delete(id)
    while(plans.size>10)plans.delete(plans.keys().next().value)
    return {planId,revision,kbId:b.st.kbId,root:b.root,active:!!previous,canApply:true,coverage:scan.coverage,
      files:scan.files.map(({identity,sha256,...f})=>f),references:scan.references,storage:CATALOG_PATH,movesExistingFiles:false}
  }
  async function apply(b,args){
    if(args.confirm!==true||args.expectedKbId!==b.st.kbId)throw fail('CONFIRM_REQUIRED','请先预览并确认当前资料库')
    const p=plans.get(args.planId);if(!p||p.key!==b.key||p.revision!==args.revision||p.expiresAt<now())throw fail('MIGRATION_STALE','预览已失效，请重新预览')
    const file=await safePath(b.root,CATALOG_PATH,{missing:true})
    const published=await b.core._internal.withMutationLock(b.root,()=>locked(file,async()=>{
      await check(b);const previous=await readCatalog(b.root,b.st.kbId)
      if((previous?.revision??null)!==p.previousRevision)throw fail('CONFLICT','另一个窗口已迁移或修改分类，请重新预览')
      const scan=await inspectOriginals(b,{previous});if(fingerprint(scan)!==p.revision)throw fail('FILE_CHANGED','预览后原文件已改变，请重新预览')
      const c={format:CATALOG_FORMAT,kbId:b.st.kbId,key:b.key,revision:(previous?.revision??0)+1,policyRevision:(previous?.policyRevision??0)+1,createdAt:previous?.createdAt??now(),updatedAt:now(),migrationId:args.planId,...scan}
      await check(b);await atomicJson(file,c);plans.delete(args.planId);return c
    }))
    // The catalog is the atomic activation point. A failed index rebuild is
    // explicitly pending; originals and the previous fulltext index are retained.
    const result=await b.core.maintainIndex({expectedKbId:b.st.kbId,full:true,knownRemovedPaths:published.references.map(r=>r.path)})
    return {active:true,phase:result.ok?'completed':'index-pending',catalogRevision:published.revision,coverage:published.coverage,index:{ok:result.ok,reason:result.reason??null},storage:CATALOG_PATH}
  }
  async function dispatch(b,args){
    if(args.op==='architecture.preview')return {architecture:await preview(b)}
    if(args.op==='architecture.preview-files'){
      const p=plans.get(args.planId);if(!p||p.key!==b.key||p.expiresAt<now())throw fail('MIGRATION_STALE','预览已失效，请重新预览')
      return {architecture:{planId:args.planId,revision:p.revision,files:p.files}}
    }
    if(args.op==='architecture.apply')return {architecture:await apply(b,args)}
    if(args.op==='architecture.refresh'){await check(b);if(!await readCatalog(b.root,b.st.kbId))throw fail('ARCHITECTURE_REQUIRED','请先预览并确认迁移');await refreshCatalog(b);const result=await b.core.maintainIndex({expectedKbId:b.st.kbId,full:true});return {architecture:{active:true,phase:result.ok?'completed':'index-pending',index:result}}}
    if(args.op==='architecture.classify'){await check(b);return classifyOriginal(b,args)}
    if(args.op==='architecture.reclassify'){await check(b);return {classification:await repairClassifications(b)}}
    const catalog=await readCatalog(b.root,b.st.kbId)
    if(args.op==='architecture.status')return {architecture:{active:!!catalog,root:b.root,kbId:b.st.kbId,format:catalog?.format,revision:catalog?.revision,coverage:catalog?.coverage,storage:CATALOG_PATH}}
    if(['architecture.files','architecture.categories'].includes(args.op))return {architecture:{active:!!catalog,revision:catalog?.revision,files:catalog?.files??[]}}
    throw fail('BAD_OPERATION','未知索引架构操作')
  }
  return {dispatch}
}
