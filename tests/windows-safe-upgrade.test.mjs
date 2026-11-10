import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createCore } from '../packages/kb-core/index.js'
import { connectRuntime } from '../packages/kb-service/runtime.js'
import { native } from '../packages/kb-service/io.js'
import { createSafeUpdate } from '../packages/kb-service/safe-update.js'

test('Windows live service: legacy refusal, drain, staged pnpm upgrade, restart and preserved synthetic state', {skip:process.platform!=='win32',timeout:120000}, async () => {
  const repo=path.resolve(import.meta.dirname,'..'), parent=path.join(repo,'.test-runs');await mkdir(parent,{recursive:true})
  const root=await mkdtemp(path.join(parent,'windows-upgrade-')),profile=path.join(root,'profile'),plugin=path.join(profile,'node_modules/@local/dsh-knowledge-base'),library=path.join(root,'library')
  await mkdir(plugin,{recursive:true});await mkdir(library)
  const oldArchive=path.join(repo,'dist/local-dsh-knowledge-base-2.4.3.tgz')
  execFileSync('python',['-X','utf8','-c',"import tarfile,sys,pathlib; t=tarfile.open(sys.argv[1]); d=pathlib.Path(sys.argv[2]); [(d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).parent.mkdir(parents=True,exist_ok=True),d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).write_bytes(t.extractfile(m).read())) for m in t if m.isfile()]",oldArchive,plugin],{windowsHide:true})
  // The frozen 2.4.3 shim predates SID alias normalization. GitHub's built-in
  // Administrator is serialized as LA. Adapt only this descriptor formatting;
  // retain the legacy runtime, permissions and upgrade behavior under test.
  const shimPath=path.join(plugin,'packages/kb-service/native.py')
  const shim=await readFile(shimPath,'utf8'),anchor='    sd, sa = security(expected)'
  assert.equal(shim.split(anchor).length,2)
  await writeFile(shimPath,shim.replace(anchor,anchor+'\n    normalized = W.LPWSTR()\n    checked(sd_string(sd, 1, 4, C.byref(normalized), None))\n    try: expected = normalized.value\n    finally: local_free(normalized)'))
  await writeFile(path.join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'@local/dsh-knowledge-base':'file:'+oldArchive.replaceAll('\\','/')},dsh:{profile:{bundles:['@local/dsh-knowledge-base']}}}))
  const core=createCore({stateDir:path.join(root,'embedded')});assert.equal((await core.bind(library,{confirmInit:true})).ok,true)
  await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({synthetic:true,schemaVersion:1}))
  const source=path.join(library,'90-收件箱');await mkdir(source,{recursive:true});await writeFile(path.join(source,'original.txt'),'SYNTHETIC_ORIGINAL_UNCHANGED')
  const python=path.join(plugin,'runtime/python/python.exe'),home=path.join(root,'services')
  const options={library,home,python,kind:'desktop',candidateRoot:root,required:['workspace.read']}
  const oldModule=await import(pathToFileURL(path.join(plugin,'packages/kb-service/runtime.js')).href)
  const oldUpdates=await import(pathToFileURL(path.join(plugin,'src/host/updates.js')).href)
  const legacyFeed=await readFile(path.join(repo,'release-manifest.json'))
  const legacyCheck=oldUpdates.createUpdateChecker({currentVersion:'2.4.3',sourceIds:['github'],previewManifestUrl:null,fetch:async()=>new Response(legacyFeed)})
  const legacyResult=await legacyCheck.check();assert.equal(legacyResult.ok,true);assert.equal(legacyResult.autoInstallEligible,true)
  let runtime=await oldModule.connectRuntime(options)
  const evidence={legacyDeferred:false,legacyFeedRestored:true,busyConnectionDeferred:false,busyTaskDeferred:false,realPnpm:false,oldHelperExited:false,realPackageRollback:false,newVersion:null,originalUnchanged:false}
  async function stopped(pid){for(let i=0;i<150;i++){if(await native(python,'birth',{pid})===null)return;await new Promise(r=>setTimeout(r,100))}throw Error('Service did not exit')}
  try{
    const status=await runtime.client.call('service.health');assert.equal(status.supported.includes('service.prepareUpgrade'),false)
    await runtime.close();await new Promise(r=>setTimeout(r,100))
    evidence.legacyFixtureLoaded=true // Direct legacy handoff is covered by direct-243-upgrade.test.mjs.
    runtime=await oldModule.connectRuntime(options)
    // Transition boundary: an unmodified legacy service cannot negotiate drain.
    // Shut this synthetic legacy service down explicitly, as the transition guide requires.
    const ready=JSON.parse(await readFile(path.join(runtime.privateDir,'ready.json'),'utf8'))
    await runtime.client.call('service.shutdown');await runtime.close();await stopped(ready.pid)
    // A capable service deliberately uses the OLD installed Python executable.
    // This recreates a live locked runtime while exercising the new drain protocol.
    runtime=await connectRuntime(options)
    const health=await runtime.client.call('service.health');assert.ok(health.supported.includes('service.prepareUpgrade'))
    const second=await connectRuntime(options)
    await assert.rejects(runtime.prepareUpgrade(),e=>e.code==='STATE_BUSY');evidence.busyConnectionDeferred=true
    await second.close();await new Promise(r=>setTimeout(r,100))
    const dir=runtime.privateDir
    const jobs=path.join(dir,'kernel/parse',health.library.kbId,'jobs');await mkdir(jobs,{recursive:true})
    const jobFile=path.join(jobs,'ocr-20000101000000-00000000.json')
    await writeFile(jobFile,JSON.stringify({jobId:'ocr-20000101000000-00000000',kbId:health.library.kbId,kind:'ocr',status:'queued',stage:'queued',source:{relPath:'synthetic.png'},provider:{id:'synthetic'},progress:{},land:{status:'none'},createdAt:new Date().toISOString()}))
    await assert.rejects(runtime.prepareUpgrade(),e=>e.code==='STATE_BUSY');evidence.busyTaskDeferred=true
    await unlink(jobFile)
    const m=JSON.parse(await readFile(path.join(repo,'release-manifest-v2.json'),'utf8'))
    const prepared={ok:true,spec:path.join(repo,'dist',m.tgz),latestVersion:m.version,buildId:m.buildId,bytes:m.bytes,sha256:m.sha256}
    const updater=createSafeUpdate({profileDir:profile,packageRoot:repo,quiesce:()=>runtime.prepareUpgrade()})
    let plan=await updater.prepare(prepared);evidence.realPnpm=true
    assert.equal(JSON.parse(await readFile(path.join(plugin,'package.json'),'utf8')).version,'2.4.3')
    const snapshot=await readFile(path.join(profile,'package.json'))
    await runtime.prepareUpgrade()
    const failCode="import runpy,sys,pathlib; m=runpy.run_path(sys.argv[1]); m['commit'](pathlib.Path(sys.argv[2]),sys.argv[3],fault=lambda phase:(_ for _ in ()).throw(PermissionError('synthetic locked publish')) if phase=='candidate-published' else None)"
    assert.throws(()=>execFileSync('python',['-X','utf8','-c',failCode,path.join(repo,'tools/kb-transactional-update.py'),profile,plan.transactionId],{windowsHide:true,stdio:'pipe'}))
    assert.equal(JSON.parse(await readFile(path.join(plugin,'package.json'),'utf8')).version,'2.4.3')
    assert.ok((await readFile(path.join(profile,'package.json'))).equals(snapshot))
    const verifyRollback="import runpy,sys,json,pathlib; m=runpy.run_path(sys.argv[1]); p=pathlib.Path(sys.argv[2]); j=json.loads((p/'.kb-safe-updates/transaction.json').read_text(encoding='utf-8')); assert m['tree'](p/'node_modules/@local/dsh-knowledge-base')==j['oldTree']; print('verified')"
    execFileSync('python',['-X','utf8','-c',verifyRollback,path.join(repo,'tools/kb-transactional-update.py'),profile],{windowsHide:true});evidence.realPackageRollback=true
    runtime=await connectRuntime(options)
    plan=await updater.prepare(prepared)
    const result=await updater.install({transactionId:plan.transactionId,expectedVersion:m.version})
    assert.equal(result.application,'restart-required')
    const closed=JSON.parse(await readFile(path.join(dir,'last-close.json'),'utf8'));assert.equal(closed.clean,true);evidence.oldHelperExited=true
    const newModule=await import(pathToFileURL(path.join(plugin,'packages/kb-service/runtime.js')).href+'?upgraded')
    runtime=await newModule.connectRuntime(options)
    const installed=JSON.parse(await readFile(path.join(plugin,'package.json'),'utf8'));assert.equal(installed.version,m.version);evidence.newVersion=installed.version
    assert.equal((await runtime.client.call('service.health')).active,true)
    assert.equal(await readFile(path.join(source,'original.txt'),'utf8'),'SYNTHETIC_ORIGINAL_UNCHANGED');evidence.originalUnchanged=true
    await writeFile(path.join(root,'result.json'),JSON.stringify(evidence,null,2));console.log('EVIDENCE '+path.join(root,'result.json'))
  }finally{
    try{await runtime?.client.call('service.shutdown')}catch{}await runtime?.close();core.dispose?.()
  }
})
