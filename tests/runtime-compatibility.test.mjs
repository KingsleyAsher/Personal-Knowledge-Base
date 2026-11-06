import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createCore } from '../packages/kb-core/index.js'
import { startService, libraryIdentity } from '../packages/kb-service/service.js'
import { connectService } from '../packages/kb-service/client.js'
import { connectRuntime } from '../packages/kb-service/runtime.js'
import { canShareRuntime, SERVICE_COMPATIBILITY } from '../packages/kb-service/compatibility.js'

const supported=['service.health','events.subscribe','workspace.read','workspace.write','host.bridge']
const health={serviceBuildId:'different-build',supported,compatibility:{...SERVICE_COMPATIBILITY}}
test('compatible patch builds share by contract, epochs and required methods, not version strings',()=>{
 assert.equal(canShareRuntime(health,'local',['workspace.read']),true)
 assert.equal(canShareRuntime({...health,compatibility:{...health.compatibility,storageEpoch:2}},'local'),false)
 assert.equal(canShareRuntime({...health,compatibility:{...health.compatibility,engineEpoch:2}},'local'),false)
 assert.equal(canShareRuntime({...health,compatibility:{...health.compatibility,contractHash:'unknown'}},'local'),false)
 assert.equal(canShareRuntime({...health,compatibility:{...health.compatibility,protocolMajor:2}},'local'),false)
 assert.equal(canShareRuntime({...health,compatibility:undefined},'local'),false)
 assert.equal(canShareRuntime(health,'local',['missing.method']),false)
 assert.equal(canShareRuntime({...health,serviceBuildId:'local'},'local',['missing.method']),false)
 for(const serviceBuildId of ['2478adb900c3589b','11e75558a7826483'])assert.equal(canShareRuntime({serviceBuildId,supported},'local',['workspace.read']),true)
 assert.equal(canShareRuntime({serviceBuildId:'11e75558a7826483',supported,compatibility:{...SERVICE_COMPATIBILITY,storageEpoch:2}},'local'),false)
})

async function fixture(){
 const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'compat-')),library=path.join(root,'library');await mkdir(library)
 const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true})
 await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}))
 await writeFile(path.join(library,'original.txt'),'SYNTHETIC ORIGINAL')
 await mkdir(path.join(root,'services'))
 return {root,library,core,home:path.join(root,'services')}
}
async function baseline(root,version){
 const target=path.join(root,'baseline-'+version)
 execFileSync('python',['-X','utf8','-c',"import pathlib,tarfile,sys;t=tarfile.open(sys.argv[1]);d=pathlib.Path(sys.argv[2]);[(d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).parent.mkdir(parents=True,exist_ok=True),d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).write_bytes(t.extractfile(m).read())) for m in t if m.isfile() and m.name.startswith('package/packages/')]",path.resolve('dist/local-dsh-knowledge-base-'+version+'.tgz'),target],{windowsHide:true})
 const load=file=>import(pathToFileURL(path.join(target,'packages/kb-service',file)).href)
 return {target,service:await load('service.js'),runtime:await load('runtime.js'),build:await load('build.js')}
}

test('real Windows old strict connector reproduces the conflict; repaired client joins the running 2.5.4 DSH service', {skip:process.platform!=='win32',timeout:30000},async()=>{
 const f=await fixture(),old4=await baseline(f.root,'2.5.4'),old3=await baseline(f.root,'2.5.3')
 assert.equal(await old4.build.runtimeBuild(),'11e75558a7826483')
 const identity=await libraryIdentity(f.library),service=await old4.service.startService({library:f.library,privateDir:path.join(f.home,identity.instanceId),python:'python',desktopRoot:f.root,idleMs:60000})
 await writeFile(path.join(f.home,identity.instanceId,'ready.json'),JSON.stringify({pipe:service.pipe,bootId:service.bootId,pid:process.pid}))
 let host,client
 try{
  host=await connectService({pipe:service.pipe,python:'python',credentialFile:service.bootstrapFile,kind:'dsh-adapter'})
  await host.call('migration.commit',{planId:'fresh',quiescent:true})
  const before=await host.call('service.health')
  await assert.rejects(old3.runtime.connectRuntime({library:f.library,home:f.home,python:'python',kind:'desktop',candidateRoot:f.root}),{code:'SERVICE_UPGRADE_REQUIRED'})
  client=await connectRuntime({library:f.library,home:f.home,python:'python',kind:'desktop',candidateRoot:f.root,required:['workspace.read','workspace.write','host.bridge']})
  const after=await client.client.call('service.health');assert.equal(after.bootId,before.bootId);assert.equal(after.writers,1);assert.ok(after.connections>=2)
  assert.equal((await host.call('service.health')).bootId,before.bootId)
  assert.equal((await readFile(path.join(client.privateDir,'discovery.json'),'utf8')).includes('11e75558a7826483'),true)
  assert.equal(await readFile(path.join(f.library,'original.txt'),'utf8'),'SYNTHETIC ORIGINAL')
 }finally{await client?.close();host?.close();await service.close();f.core.dispose?.()}
})

test('declared-compatible different builds retain one service in either connection order; mismatched epochs fail closed', {skip:process.platform!=='win32',timeout:30000},async()=>{
 const f=await fixture(),identity=await libraryIdentity(f.library)
 const variant=path.join(f.root,'different-client');await cp(path.resolve('packages'),path.join(variant,'packages'),{recursive:true})
 const variantCore=path.join(variant,'packages/kb-core/src/kbcore.js');await writeFile(variantCore,(await readFile(variantCore,'utf8'))+'\n// Different client payload, unchanged compatibility contract.\n')
 const other=await import(pathToFileURL(path.join(variant,'packages/kb-service/runtime.js')).href)
 const otherBuild=await import(pathToFileURL(path.join(variant,'packages/kb-service/build.js')).href)
 const service=await startService({library:f.library,privateDir:path.join(f.home,identity.instanceId),python:'python',desktopRoot:f.root,idleMs:60000})
 await writeFile(path.join(f.home,identity.instanceId,'ready.json'),JSON.stringify({pipe:service.pipe,bootId:service.bootId,pid:process.pid}))
 let first,second
 try{
  first=await connectRuntime({library:f.library,home:f.home,python:'python',kind:'desktop',candidateRoot:f.root})
  const before=await first.client.call('service.health');assert.deepEqual(before.compatibility,SERVICE_COMPATIBILITY)
  second=await other.connectRuntime({library:f.library,home:f.home,python:'python',kind:'dsh-adapter',candidateRoot:f.root})
  const after=await second.client.call('service.health');assert.equal(after.bootId,before.bootId);assert.equal(after.writers,1)
  assert.notEqual(await otherBuild.runtimeBuild(),after.serviceBuildId)
  await second.close();await first.close();first=await other.connectRuntime({library:f.library,home:f.home,python:'python',kind:'desktop',candidateRoot:f.root});second=await connectRuntime({library:f.library,home:f.home,python:'python',kind:'dsh-adapter',candidateRoot:f.root});assert.equal((await second.client.call('service.health')).bootId,before.bootId)
  assert.equal(canShareRuntime({...after,serviceBuildId:'next-patch'},'local',['workspace.read']),true)
  assert.equal(canShareRuntime({...after,serviceBuildId:'next-major',compatibility:{...after.compatibility,storageEpoch:2}},'local'),false)
 }finally{await second?.close();await first?.close();await service.close();f.core.dispose?.()}
})
