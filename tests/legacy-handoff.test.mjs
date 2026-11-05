import test from 'node:test'
import assert from 'node:assert/strict'
import {waitForLegacy243,LEGACY_243_BUILD} from '../packages/kb-service/legacy-handoff.js'

test('2.4.3 handoff requires exact identity, matching clean receipt and exited process; sends no shutdown',async()=>{
  let closed=0,checks=0
  const health={serviceBuildId:LEGACY_243_BUILD,bootId:'old-boot'}
  const result=await waitForLegacy243({health,client:{close(){closed++},call(){assert.fail('legacy shutdown must never be called')}},privateDir:'.',python:'python',pause:async()=>{},
    read:async file=>file.endsWith('ready.json')?{pid:123,bootId:'old-boot'}:{bootId:'old-boot',clean:true},birth:async()=>++checks<3?'birth':null})
  assert.equal(result.legacy,true);assert.ok(closed>=1)
})
test('unknown legacy versions, changed identities and live processes never permit takeover',async()=>{
  const common={client:{close(){}},privateDir:'.',python:'python',pause:async()=>{},timeoutMs:5,read:async file=>file.endsWith('ready.json')?{pid:123,bootId:'old-boot'}:{bootId:'old-boot',clean:true},birth:async()=>'still-alive'}
  await assert.rejects(waitForLegacy243({...common,health:{serviceBuildId:'unknown'}}),e=>e.code==='CAPABILITY_UNSUPPORTED')
  await assert.rejects(waitForLegacy243({...common,health:{serviceBuildId:LEGACY_243_BUILD,bootId:'wrong'}}),e=>e.code==='BINDING_CHANGED')
  await assert.rejects(waitForLegacy243({...common,health:{serviceBuildId:LEGACY_243_BUILD,bootId:'old-boot'}}),e=>e.code==='SERVICE_UPGRADE_REQUIRED')
})
