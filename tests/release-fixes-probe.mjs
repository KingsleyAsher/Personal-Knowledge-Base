import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const repo = path.resolve(process.argv[2] || fileURLToPath(new URL('..', import.meta.url)))
const baseline = process.argv.includes('--baseline')
const { createFlowEngine, validateFlow, resolveParams } = await import(pathToFileURL(path.join(repo, 'src/host/flows.js')))
const { createImportService } = await import(pathToFileURL(path.join(repo, 'src/host/import-service.js')))
const root = await mkdtemp(path.resolve('fixes-probe-'))
const checks = []
const check = (name, fixed, detail = {}) => { checks.push({ name, fixed: Boolean(fixed), ...detail }) }
const client = await readFile(path.join(repo, 'src/client/index.js'), 'utf8')
// Exercise the actual editor conversion functions, including their former fixed empty fields.
const editor = vm.runInNewContext(client.slice(client.indexOf('    const FLOW_TERMINAL'), client.indexOf('    let flowClientContext')) + ';({draftOf,payloadOf})')
const kbPath = path.join(root, 'synthetic-library')
await mkdir(kbPath)
const engine = createFlowEngine({ stateDir: path.join(root, 'flow-state'), core: { status: async () => ({bound:true,kbId:'audit-library',kbPath}) } })
const base = {name:'Synthetic release regression',triggers:['synthetic'],steps:[{title:'Step',instruction:'Synthetic only'}]}
let nullResult
try { nullResult = validateFlow({...base,params:[null,2,'invalid']}) } catch(e) { nullResult = {exception:e.message} }
check('null-param', Array.isArray(nullResult) && nullResult.length === 3, {observed:nullResult})
const inherited = resolveParams({params:[{name:'constructor',default:'',required:true}]},{})
check('inherited-param-value', !inherited.ok && inherited.missing.includes('constructor'), {observed:inherited})
const proto = resolveParams({params:[{name:'__proto__',default:'own-default',required:true}]},JSON.parse('{"extra":"value"}'))
check('prototype-param-roundtrip', JSON.parse(JSON.stringify(proto.values)).__proto__ === 'own-default')
const valid = resolveParams({params:[{name:'constructor',default:'fallback',required:true}]},JSON.parse('{"constructor":"provided"}'))
assert.equal(valid.ok,true);assert.equal(valid.values.constructor,'provided')
assert.equal(resolveParams({params:[{name:'topic',default:'fallback',required:true}]},{}).values.topic,'fallback')

const saved = await engine.save({flow:{...base,capabilities:['read'],outputRules:{status:'已归档'}}})
assert.equal(saved.ok,true)
const roundtrip = await engine.save({flow:editor.payloadOf(editor.draftOf(saved.flow)),expectedRevision:saved.flow.revision})
check('editor-metadata-loss', roundtrip.flow.capabilities.join(',') === 'read' && roundtrip.flow.outputRules.status === '已归档', {observed:{capabilities:roundtrip.flow.capabilities,status:roundtrip.flow.outputRules.status}})
await engine.archive(saved.flow.id,false)
const archived = (await engine.get(saved.flow.id)).flow
const edited = await engine.save({flow:editor.payloadOf(editor.draftOf(archived)),expectedRevision:archived.revision})
check('edit-restores-archive',edited.flow.archived === true && edited.flow.enabled === false,{observed:{archived:edited.flow.archived,enabled:edited.flow.enabled}})
const enable = await engine.setEnabled(saved.flow.id,true)
check('archived-enable-denied',enable.reason === 'archived')
await engine.archive(saved.flow.id,true)
check('restore-preserves-prior-enable',(await engine.get(saved.flow.id)).flow.enabled === true)
const conflict = await engine.save({flow:{...base,id:saved.flow.id},expectedRevision:1})
assert.equal(conflict.conflict,true)
const disabled = await engine.save({flow:{...base,enabled:false}})
await engine.archive(disabled.flow.id,false)
const disabledArchived=(await engine.get(disabled.flow.id)).flow
await engine.save({flow:editor.payloadOf(editor.draftOf(disabledArchived)),expectedRevision:disabledArchived.revision})
await engine.archive(disabled.flow.id,true)
assert.equal((await engine.get(disabled.flow.id)).flow.enabled,false)
if(!baseline) {
  const before = await readFile(path.join(root,'flow-state','flows','audit-library','flows.json'),'utf8')
  assert.equal((await engine.save({flow:{...base,params:[null]}})).reason,'invalid-flow')
  assert.equal(await readFile(path.join(root,'flow-state','flows','audit-library','flows.json'),'utf8'),before)
}
const required = await engine.save({flow:{...base,params:[{name:'topic',default:'',required:true}]}})
const request = {id:required.flow.id,kbId:'audit-library',expectedRevision:required.flow.revision}
assert.equal((await engine.prepareConversation(request)).reason,'missing-param')
const prepared = await engine.prepareConversation({...request,params:{topic:'one-time-value'}})
assert.equal(prepared.ok,true);assert.ok(prepared.prompt.includes('one-time-value'))
assert.equal((await engine.get(required.flow.id)).flow.params[0].default,'')

const source = path.join(root,'synthetic-source'), target = path.join(root,'synthetic-target')
await mkdir(source);await mkdir(path.join(target,'.kbmeta'),{recursive:true})
await writeFile(path.join(source,'sample.txt'),'Synthetic release regression content.','utf8')
await writeFile(path.join(target,'.kbmeta','kb.json'),JSON.stringify({kbId:'audit-import'}))
const status={bound:true,kbId:'audit-import',kbPath:target,config:{revision:1}}
let creations=0, rejectPreparation=false
const core={loadConfig:async()=>{await new Promise(r=>setTimeout(r,40));if(rejectPreparation)throw Error('synthetic preparation failure')},status:async()=>status,getConfig:async()=>({}),createEntry:async()=>{
  creations++;await new Promise(r=>setTimeout(r,100));return {ok:true,entryId:'audit-entry',path:'10-知识/audit.md',revision:1}
}}
const logs=[]
const options={stateDir:path.join(root,'import-state'),getBaseConfig:async()=>({}),getCurrentCore:()=>core,coreFactory:()=>core,log:(level,message)=>logs.push({level,message})}
const service=createImportService(options), otherService=createImportService(options)
const plan=await service.plan({source,mode:'copy',current:status})
assert.equal(plan.ok,true)
const starts=await Promise.all([service.start({importId:plan.importId}),service.start({importId:plan.importId}),otherService.start({importId:plan.importId})])
let final
for(let i=0;i<100;i++) {final=await service.status({importId:plan.importId});if(!final.running && ['done','partial','failed'].includes(final.stage))break;await new Promise(r=>setTimeout(r,20))}
check('concurrent-import',starts.filter(x=>x.started).length === 1 && creations === 1 && final.stage === 'done' && !logs.some(x=>x.level==='error'),{observed:{starts,creations,logs,status:final}})
if(!baseline) {
  const source2=path.join(root,'preparation-source');await mkdir(source2);await writeFile(path.join(source2,'sample.txt'),'retry fixture','utf8')
  const retryPlan=await service.plan({source:source2,mode:'copy',current:status})
  rejectPreparation=true
  const failed=await Promise.allSettled([service.start({importId:retryPlan.importId}),otherService.start({importId:retryPlan.importId})])
  assert.ok(failed.every(x=>x.status==='rejected'))
  rejectPreparation=false
  assert.equal((await service.start({importId:retryPlan.importId})).started,true)
  for(let i=0;i<100;i++){const result=await service.status({importId:retryPlan.importId});if(!result.running){assert.equal(result.stage,'done');break}await new Promise(r=>setTimeout(r,20))}
}
const report={repo,root,baseline,checks,allFlipsAsExpected:checks.every(x=>x.fixed),positiveCases:['explicit/default parameters','revision conflict','disabled restoration','one-time params preserve defaults',...(!baseline?['no write on invalid input','preparation failure releases reservation']:[])]}
await writeFile(path.join(root,baseline?'before.json':'after.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
if(!baseline) assert.equal(report.allFlipsAsExpected,true)
