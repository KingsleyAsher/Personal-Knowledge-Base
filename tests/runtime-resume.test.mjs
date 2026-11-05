import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {createCore} from '../packages/kb-core/index.js'
import {connectRuntime} from '../packages/kb-service/runtime.js'

test('a quiesced runtime resumes the retained package after a failed update', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'resume-')),library=path.join(root,'library');await mkdir(library)
  const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true});await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
  const runtime=await connectRuntime({library,home:path.join(root,'services'),python:'python',kind:'desktop',candidateRoot:root})
  try{
    const before=await runtime.client.call('service.health');await runtime.prepareUpgrade();await runtime.resume()
    const after=await runtime.client.call('service.health');assert.equal(after.active,true);assert.notEqual(after.bootId,before.bootId)
  }finally{try{await runtime.client.call('service.shutdown')}catch{}await runtime.close();core.dispose?.()}
})
