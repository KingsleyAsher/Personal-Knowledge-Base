import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,mkdtemp,writeFile,readFile,unlink,access} from 'node:fs/promises'
import {createCore} from '../packages/kb-core/index.js'
import {connectRuntime} from '../packages/kb-service/runtime.js'
import {connectService} from '../packages/kb-service/client.js'

test('a quiesced runtime resumes the retained package after a failed update', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'resume-')),library=path.join(root,'library');await mkdir(library)
  const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true});await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
  const runtime=await connectRuntime({library,home:path.join(root,'services'),python:'python',kind:'desktop',candidateRoot:root})
  try{
    const before=await runtime.client.call('service.health');await runtime.prepareUpgrade();await runtime.resume()
    const after=await runtime.client.call('service.health');assert.equal(after.active,true);assert.notEqual(after.bootId,before.bootId)
  }finally{try{await runtime.client.call('service.shutdown')}catch{}await runtime.close();core.dispose?.()}
})

test('DSH handoff waits for a queued job, then drains with an idle desktop connection', {skip:process.platform!=='win32',timeout:30000},async()=>{
  const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true})
  const root=await mkdtemp(path.join(parent,'handoff-')),library=path.join(root,'library');await mkdir(library)
  const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true})
  await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
  const options={library,home:path.join(root,'services'),python:'python',kind:'dsh-adapter',candidateRoot:root}
  const old=await connectRuntime(options),dir=old.privateDir
  const {pipe,bootId}=JSON.parse(await readFile(path.join(dir,'ready.json'),'utf8'))
  const peer=await connectService({pipe,python:'python',credentialFile:path.join(dir,'bootstrap.dpapi.json'),kind:'desktop'})
  let replacement
  try{
    const health=await peer.call('service.health')
    const jobs=path.join(dir,'kernel/parse',health.library.kbId,'jobs')
    await mkdir(jobs,{recursive:true})
    const job=path.join(jobs,'ocr-20000101000000-00000000.json')
    await writeFile(job,JSON.stringify({jobId:'ocr-20000101000000-00000000',kbId:health.library.kbId,kind:'ocr',status:'queued',stage:'queued',source:{relPath:'synthetic.png'},provider:{id:'synthetic'},progress:{},land:{status:'none'},createdAt:new Date().toISOString()}))
    await assert.rejects(old.withUpdateLock(()=>old.prepareUpgrade()),{code:'STATE_BUSY'})
    assert.equal((await peer.call('service.health')).bootId,bootId)
    await unlink(job)
    await old.withUpdateLock(async()=>{
      await old.prepareUpgrade()
      await access(path.join(dir,'launch.lock'))
      assert.equal(JSON.parse(await readFile(path.join(dir,'last-close.json'),'utf8')).clean,true)
      await assert.rejects(access(path.join(library,'.kbmeta/service-owner.json')),{code:'ENOENT'})
    })
    replacement=await connectRuntime(options)
    const ready=await replacement.client.call('service.health')
    assert.equal(ready.active,true)
    assert.equal(ready.writers,1)
    assert.notEqual(ready.bootId,bootId)
  }finally{
    peer.close()
    try{await (replacement??old).client.call('service.shutdown')}catch{}
    await replacement?.close();await old.close();core.dispose?.()
  }
})
