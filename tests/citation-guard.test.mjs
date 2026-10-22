import test from 'node:test'
import assert from 'node:assert/strict'
import {createCitationGuard} from '../src/host/citation-guard.js'
const id='12345678-1234-4234-8234-123456789abc'
function fixture(){const events=[{type:'turn/start',data:{turn:1}},{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:`@[基于知识库回答（含隐私）](dsh-kb:${id}) question`}] }},{type:'assistant/message',data:{message:{content:[{type:'text',text:'answer'}]}}}],injected=[];return {events,injected,agent:{id:'s',session:{snapshotEvents:()=>events},inject:m=>{injected.push(m);events.push({type:'user/message',data:m})}}}}
test('final citation check requests exactly one repair and leaves normal questions alone',async()=>{
 const f=fixture(),guard=createCitationGuard({validate:async()=>({missingCitations:true,invalid:[]})})
 await guard({agent:f.agent,turn:1});await guard({agent:f.agent,turn:1});assert.equal(f.injected.length,1)
 assert(f.injected[0].content[0].text.includes('不要重新全库检索'))
 const normal=fixture();normal.events[1].data.content[0].text='ordinary question';await guard({agent:normal.agent,turn:1});assert.equal(normal.injected.length,0)
})
test('valid reviewed citations avoid extra step; revoked context never bypasses permissions',async()=>{
 const f=fixture();f.events.push({type:'tool/call',data:{name:'kb_validate_citations',arguments:{questionId:id}}})
 await createCitationGuard({validate:async()=>({missingCitations:false,invalid:[]})})({agent:f.agent,turn:1});assert.equal(f.injected.length,0)
 let logs=0;await createCitationGuard({validate:async()=>{throw Object.assign(new Error(),{code:'PRIVATE_DENIED'})},log:()=>logs++})({agent:f.agent,turn:1});assert.equal(f.injected.length,0);assert.equal(logs,1)
})
