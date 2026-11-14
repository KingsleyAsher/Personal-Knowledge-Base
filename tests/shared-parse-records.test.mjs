import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import http from 'node:http'
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {createCore} from '../packages/kb-core/index.js'
import {connectRuntime} from '../packages/kb-service/runtime.js'
import {connectService} from '../packages/kb-service/client.js'

test('global shared settings see knowledge and ordinary Agent OCR/ASR records without elevating model tools', {skip:process.platform!=='win32',timeout:30000}, async t => {
  const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true})
  const root=await mkdtemp(path.join(parent,'parse-records-')),library=path.join(root,'library')
  await mkdir(library)
  const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true})
  await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
  await mkdir(path.join(library,'40-素材资源'),{recursive:true})
  let release,started
  const server=http.createServer(async(req,res)=>{
    for await(const chunk of req){}
    await new Promise(resolve=>{release=resolve;started?.()})
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify(req.url.endsWith('/chat/completions')?{choices:[{message:{content:'synthetic OCR'}}]}:{text:'synthetic ASR'}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>{release?.();server.close(resolve)}))
  const runtime=await connectRuntime({library,home:path.join(root,'services'),python:'python',kind:'dsh-adapter',candidateRoot:root})
  let reader
  t.after(async()=>{release?.();reader?.close();try{await runtime.client.call('service.shutdown')}catch{}await runtime.close();core.dispose?.()})
  const client=runtime.client,ui=operation=>client.call('adapter.dispatch',{operation})
  const ready=JSON.parse(await readFile(path.join(runtime.privateDir,'ready.json'),'utf8'))
  const grant=await client.call('connection.grant',{label:'synthetic read-only UI',access:['read'],expiresAt:Date.now()+60000})
  reader=await connectService({pipe:ready.pipe,python:'python',credential:grant.credential,kind:'desktop'})
  for(const [authority,kind] of [['knowledge','ocr'],['knowledge','asr'],['workspace','ocr'],['workspace','asr']]){
    await client.call('host.bridge',{action:'register',hostInstanceId:'synthetic-host',label:'synthetic',workspaceId:'synthetic-workspace',capabilities:[]})
    const sourceRel='40-素材资源/synthetic-'+authority+'.'+(kind==='ocr'?'png':'wav')
    await writeFile(path.join(library,sourceRel),'synthetic original')
    const provider=await ui({op:'parse.provider.save',provider:{id:'synthetic-'+kind,kind,protocol:kind==='ocr'?'openai-vision':'openai-audio-transcriptions',locality:'local',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1'}})
    assert.equal(provider.ok,true,JSON.stringify(provider))
    assert.equal((await ui({op:'parse.default',kind,providerId:'synthetic-'+kind})).ok,true)
    const called=new Promise(resolve=>{started=resolve})
    const stage=authority==='workspace'?await client.call('desktop.importStage',{name:path.basename(sourceRel),data:Buffer.from('synthetic ordinary Agent '+kind).toString('base64'),final:true}):null
    const session='synthetic-'+authority+'-'+kind+'-session'
    const submitted=await client.call('host.tool',{name:'kb_parse',input:{action:'submit',kind,...(stage?{}:{sourceRel}),providerId:'synthetic-'+kind},hostSession:session,hostAuthority:authority,...(stage?{sourceStage:stage.stageId}:{})})
    assert.equal(submitted.ok,true,JSON.stringify(submitted));await called
    for(const method of ['adapter.dispatch','workspace.read']){
      const running=await client.call(method,{operation:{op:'parse.jobs',kind,status:'running'}})
      assert(running.jobs.some(j=>j.jobId===submitted.jobId&&j.requestedBy.session===session),'admin settings must see '+authority+' Agent running job via '+method)
      const requests=await client.call(method,{operation:{op:'parse.requests',kind}})
      assert(requests.requests.some(r=>r.requestId===submitted.requestId),'admin settings must see Agent submissions')
    }
    for(const method of ['adapter.dispatch','workspace.read']){
      const hidden=await reader.call(method,{operation:{op:'parse.jobs',kind,admin:true,session}},{policyVersion:client.welcome.policyVersion})
      assert.equal(hidden.total,0,'read-only caller cannot claim management or another session')
      const requests=await reader.call(method,{operation:{op:'parse.requests',kind}},{policyVersion:client.welcome.policyVersion})
      assert.equal(requests.total,0)
    }
    const ordinary=await client.call('host.tool',{name:'kb_parse',input:{action:'jobs',kind},hostSession:'another-agent-session',hostAuthority:'workspace'})
    assert.equal(ordinary.total,0,'Host admin credential must not elevate ordinary model tools')
    release();release=null
    for(let i=0;i<200;i++){
      const history=await ui({op:'parse.jobs',kind,status:'completed'})
      if(history.jobs.some(j=>j.jobId===submitted.jobId&&j.status==='succeeded'))break
      if(i===199)assert.fail('completed Agent task is missing from settings history')
      await new Promise(resolve=>setTimeout(resolve,10))
    }
    await assert.rejects(reader.call('workspace.write',{operation:{op:'parse.cancel',jobId:submitted.jobId}},{policyVersion:client.welcome.policyVersion}),{code:'FORBIDDEN'})
  }
})
