import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import {mkdtemp,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises'
import {createCore} from '../packages/kb-core/index.js'
import {createWorkbench} from '../packages/kb-core/src/workbench.js'
import {enrollPickedLibrary} from '../apps/desktop/main/library-enrollment.js'
import {connectRuntime,selectFirstSharedLibrary} from '../packages/kb-service/runtime.js'
import {fileURLToPath} from 'node:url'

test('empty new library starts with original-file catalog; nonempty folders retain explicit migration',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'kb-fresh-original-'))
  t.after(()=>rm(base,{recursive:true,force:true}))
  const root=path.join(base,'empty'),foreign=path.join(base,'existing'),stateDir=path.join(base,'state')
  await mkdir(root);await mkdir(foreign);await writeFile(path.join(foreign,'existing.md'),'original')
  const core=createCore({stateDir},()=>{}),wb=createWorkbench({stateDir,getCore:()=>core})
  t.after(()=>wb.dispose())
  const created=await core.bind(root,{confirmInit:true,originalIndex:true});assert.equal(created.ok,true)
  const catalog=JSON.parse(await readFile(path.join(root,'索引层/文件目录.json'),'utf8'))
  assert.equal(catalog.kbId,created.kbId);assert.deepEqual(catalog.files,[])
  assert.equal((await wb.dispatch({op:'architecture.status',expectedKbId:created.kbId})).architecture.active,true)
  const catalogFile=path.join(root,'索引层/文件目录.json')
  await rename(catalogFile,catalogFile+'.backup')
  const blocked=await core.init()
  assert.equal(blocked.ok,false);assert.equal(blocked.reason,'catalog-missing')
  await assert.rejects(readFile(catalogFile),{code:'ENOENT'})
  await rename(catalogFile+'.backup',catalogFile)
  const init=await core.initializeLibrary(foreign);assert.equal(init.ok,true)
  await assert.rejects(readFile(path.join(foreign,'索引层/文件目录.json')),{code:'ENOENT'})
  assert.equal(await readFile(path.join(foreign,'existing.md'),'utf8'),'original')
})

for(const pluginFirst of [false,true])test((pluginFirst?'plugin':'client')+' first: both clients share one original-file library', {skip:process.platform!=='win32',timeout:30000},async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'kb-fresh-shared-'))
  const root=path.join(base,'library'),dataDir=path.join(base,'desktop'),home=path.join(base,'services'),profiles=path.join(base,'profiles')
  const previous=process.env.KB_PROFILE_HOME;process.env.KB_PROFILE_HOME=profiles
  const backendRoot=fileURLToPath(new URL('..',import.meta.url));await mkdir(root);await mkdir(dataDir)
  const node=process.env.KB_TEST_ELECTRON??process.execPath
  const connect=kind=>connectRuntime({library:root,home,python:'python',node,kind,allowFreshSynthetic:false})
  let desktop,plugin
  try{
    const stateDir=path.join(profiles,'desktop','kb-state');await mkdir(stateDir,{recursive:true})
    const core=createCore({stateDir,excludeFromSearch:['private-test']},()=>{})
    const select=()=>selectFirstSharedLibrary({core,library:root,home,python:'python',node})
    if(pluginFirst){
      const old=path.join(base,'old-library');await mkdir(old)
      await writeFile(path.join(old,'kept.md'),'# Existing note')
      const legacy=createCore({stateDir:path.join(base,'legacy')},()=>{})
      await legacy.bind(old,{confirmInit:true})
      await assert.rejects(selectFirstSharedLibrary({core,library:old,home,python:'python'}),{code:'RECOVERY_REQUIRED'})
      await assert.rejects(readFile(path.join(old,'.kbmeta/service-mode.json')),{code:'ENOENT'})
      assert.equal(await readFile(path.join(old,'kept.md'),'utf8'),'# Existing note')
      const pending=path.join(base,'pending');await mkdir(pending)
      const initialized=await core.initializeLibrary(pending,{freshSetup:true});assert.equal(initialized.ok,true)
      const embedded=createCore({stateDir:path.join(base,'other')},()=>{})
      await assert.rejects(embedded.bind(pending,{confirmInit:true}),{code:'SERVICE_REQUIRED'})
      const result=await select();assert.equal(result.restartRequired,true);assert.equal(result.action,'created')
      plugin=await connect('dsh-adapter')
      assert.equal((await plugin.client.call('service.health')).connections,1)
    }
    await enrollPickedLibrary({root,dataDir,backendRoot,python:'python',node,serviceHome:home,confirm:async()=>true})
    desktop=await connect('desktop')
    if(!pluginFirst){
      assert.equal((await desktop.client.call('service.health')).connections,1)
      assert.equal((await select()).action,'attached')
      plugin=await connect('dsh-adapter')
    }else assert.deepEqual(JSON.parse(await readFile(path.join(root,'.kbmeta/shared-policy.json'),'utf8')).excludeFromSearch,['private-test'])
    const kbId=desktop.identity.kbId
    assert.equal(JSON.parse(await readFile(path.join(stateDir,'binding.json'),'utf8')).kbId,kbId)
    const call=(c,op,write=false)=>c.call(write?'workspace.write':'workspace.read',{operation:{expectedKbId:kbId,...op}})
    assert.equal((await call(desktop.client,{op:'architecture.status'})).architecture.active,true)
    await mkdir(path.join(root,'原件归档'));await writeFile(path.join(root,'原件归档','原件.md'),'# 虚构原件')
    await call(desktop.client,{op:'architecture.refresh'},true)
    await call(plugin.client,{op:'architecture.classify',path:'原件归档/原件.md',category:'测试/课程'},true)
    const preview=await desktop.client.call('desktop.preview',{path:'原件归档/原件.md'})
    assert.equal(preview.text,'# 虚构原件');assert.equal(preview.file.category,'测试/课程')
    assert.equal((await desktop.client.call('service.health')).writers,1)
    await desktop.close();desktop=null
    await call(plugin.client,{op:'architecture.classify',path:'原件归档/原件.md',category:'插件/独立'},true)
    desktop=await connect('desktop')
    assert.equal((await desktop.client.call('desktop.preview',{path:'原件归档/原件.md'})).file.category,'插件/独立')
    await plugin.close();plugin=null
    await call(desktop.client,{op:'architecture.classify',path:'原件归档/原件.md',category:'客户端/独立'},true)
    assert.equal((await desktop.client.call('desktop.preview',{path:'原件归档/原件.md'})).file.category,'客户端/独立')
    for(let i=0;i<40&&(await desktop.client.call('service.health')).connections>1;i++)await new Promise(r=>setTimeout(r,50))
    const receipt=await desktop.client.call('service.prepareUpgrade')
    for(let i=0;i<100;i++){
      try{process.kill(receipt.pid,0)}catch(e){if(e.code==='ESRCH')break;throw e}
      if(i===99)throw Error('isolated service did not exit before cleanup')
      await new Promise(r=>setTimeout(r,50))
    }
  }finally{
    await plugin?.close();await desktop?.close()
    if(previous===undefined)delete process.env.KB_PROFILE_HOME;else process.env.KB_PROFILE_HOME=previous
    await rm(base,{recursive:true,force:true,maxRetries:8,retryDelay:250})
  }
})
