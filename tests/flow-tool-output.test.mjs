import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import {createToolRouter,normalizeToolResult} from '../packages/kb-service/tool-router.js'
import {createCore} from '../packages/kb-core/index.js'
import {connectRuntime} from '../packages/kb-service/runtime.js'

const definitions=JSON.parse(await readFile(new URL('../packages/kb-service/tool-definitions.json',import.meta.url),'utf8'))
const definition=definitions.find(d=>d.name==='kb_flow')
function validate(value,action){
  for(const key of definition.outputSchema.required)assert(Object.hasOwn(value,key),'value.'+key+' is required')
  assert.equal(typeof value.ok,'boolean');assert.equal(typeof value.action,'string');assert.equal(value.action,action)
}

test('all kb_flow actions preserve their output contract and requested action',async()=>{
  assert.throws(()=>validate({ok:true},'list'),/value.action is required/)
  const calls=[]
  const route=createToolRouter({engines:{dispatch:async input=>{calls.push(input);return {ok:true,action:'engine-internal-alias',marker:42}}},write:()=>{},root:'.'})
  for(const action of definition.parameters.properties.action.enum){
    const result=await route({name:'kb_flow',input:{action,id:'fixture',runId:'run-fixture'}},{})
    validate(result,action);assert.equal(result.marker,42);assert.equal(calls.at(-1).op,'flows.'+action)
  }
  const failed=createToolRouter({engines:{dispatch:async()=>({ok:false,reason:'not-found',error:'synthetic missing flow'})},write:()=>{},root:'.'})
  const result=await failed({name:'kb_flow',input:{action:'get',id:'missing'}},{})
  validate(result,'get');assert.equal(result.ok,false);assert.equal(result.reason,'not-found')
})

test('registered shared Host tool retains action on disconnect, unverified caller and service errors',async()=>{
  const source=await readFile(new URL('../packages/kb-service/host-adapter.js',import.meta.url),'utf8')
  const loop=source.slice(source.indexOf('  for (const definition of definitions)'),source.indexOf('  if (gatewayApply'))
  let tool,response={ok:true,flows:[]},verified=true,target,connected=true
  const client={call:async()=>{if(response instanceof Error)throw response;return response}}
  const context={definitions:[definition],normalizeToolResult,tools:{register:value=>{tool=value}},ctx:{effect:fn=>fn()},
    desktopLinks:{clientForAgent:()=>target},routing:{run:(_client,run)=>run()},primaryClient:client,client,randomUUID:()=> 'request-fixture',
    trusted:()=>verified,knowledge:()=>false,get connected(){return connected}}
  vm.runInNewContext(loop,context)
  validate(await tool.execute({action:'list'},{}),'list')
  target=null;validate(await tool.execute({action:'list'},{}),'list');assert.equal((await tool.execute({action:'list'},{})).reason,'HOST_UNAVAILABLE')
  target=undefined;verified=false;validate(await tool.execute({action:'get'},{}),'get');assert.equal((await tool.execute({action:'get'},{})).reason,'CALLER_UNVERIFIED')
  verified=true;connected=false;validate(await tool.execute({action:'runs'},{}),'runs')
  connected=true;response=Object.assign(Error('synthetic unavailable'),{code:'HOST_UNAVAILABLE'})
  const failed=await tool.execute({action:'run'},{});validate(failed,'run');assert.equal(failed.ok,false);assert.equal(failed.error,'synthetic unavailable')
})

test('real Windows shared service kb_flow reads and failures satisfy the shipped schema', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'flow-output-')),library=path.join(root,'library');await mkdir(library)
  const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true});await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
  const runtime=await connectRuntime({library,home:path.join(root,'services'),python:'python',kind:'dsh-adapter',candidateRoot:root})
  try{
    for(const action of ['list','get','runs','cancel']){
      const value=await runtime.client.call('host.tool',{name:'kb_flow',input:{action,id:'missing',runId:'missing'},hostSession:'ordinary-agent'})
      validate(value,action)
      if(action==='get')assert.equal(value.ok,false)
    }
  }finally{try{await runtime.client.call('service.shutdown')}catch{}await runtime.close();core.dispose?.()}
})
