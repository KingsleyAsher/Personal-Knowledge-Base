import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {createHandoffApi} from '../packages/kb-service/handoff-api.js'

const source=readFileSync(new URL('../src/client/index.js',import.meta.url),'utf8')
const start=source.indexOf('    function createApiTransport(')
const factory=vm.runInNewContext(source.slice(start,source.indexOf('    const apiTransport=',start))+'\ncreateApiTransport')

test('live HTTP route remains present during handoff; queued mutation executes once after ready',async t=>{
  const gate=createHandoffApi();let writes=0,polls=0
  const handler=(req,res)=>{writes++;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,saved:true}))}
  const server=http.createServer((req,res)=>{
    if(req.url==='/kb-upgrade/status'){
      if(++polls===3)gate.attach(handler)
      res.setHeader('content-type','application/json');res.end(JSON.stringify(gate.status()));return
    }
    return gate.handle(req,res)
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const base='http://127.0.0.1:'+server.address().port
  const call=factory({fetch:(url,options)=>fetch(base+url,options),delay:async()=>{}})
  const value=await call({op:'capture.create',text:'synthetic'})
  assert.equal(value.saved,true);assert.equal(writes,1);assert.equal(polls,3)
  gate.fail({code:'TEST_FAILURE'}) // An attached real handler remains authoritative.
  assert.equal((await call({op:'status'})).ok,true)
})

test('real HTTP 405, dropped responses and unproven rejection never replay writes',async()=>{
  for(const response of [new Response('{}',{status:405}),new Response(JSON.stringify({code:'SERVICE_STARTING'}),{status:503}),null]){
    let calls=0
    const call=factory({fetch:async()=>{calls++;if(!response)throw Error('transport lost');return response},delay:async()=>{}})
    await assert.rejects(call({op:'document.save'}));assert.equal(calls,1)
  }
})

test('waiting has a deadline and a real handoff failure remains visible',async()=>{
  let clock=0,writes=0
  const call=factory({now:()=>clock,timeoutMs:3,delay:async()=>{clock++},fetch:async url=>{
    if(url==='/kb-upgrade/status')return new Response(JSON.stringify({phase:'starting'}))
    writes++;return new Response(JSON.stringify({code:'SERVICE_STARTING',requestNotExecuted:true}),{status:503})
  }})
  await assert.rejects(call({op:'document.save'}),e=>e.code==='SERVICE_START_TIMEOUT');assert.equal(writes,1)
  const failed=factory({fetch:async url=>url.endsWith('/status')?new Response(JSON.stringify({failed:true,code:'REAL_FAILURE'})):new Response(JSON.stringify({code:'SERVICE_STARTING',requestNotExecuted:true}),{status:503})})
  await assert.rejects(failed({op:'status'}),e=>e.code==='REAL_FAILURE')
})

test('detaching restores the waiting guard; preparation failure is not reported as ready',()=>{
  const gate=createHandoffApi(),detach=gate.attach(()=>{})
  assert.equal(gate.status().phase,'ready');detach();assert.equal(gate.status().phase,'starting')
  gate.fail({code:'PREPARE_FAILED'});assert.equal(gate.status().failed,true)
})
