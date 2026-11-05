import path from 'node:path';import {pathToFileURL} from 'node:url';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createCore} from '../packages/kb-core/index.js';
import test from 'node:test';import assert from 'node:assert/strict';
test('Windows 2.4.3 direct pnpm upgrade, natural service handoff and legacy repair', {skip:process.platform!=='win32',timeout:120000},async()=>{
const repo=path.resolve(import.meta.dirname,'..'),parent=path.join(repo,'.test-runs');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'direct243-'));
const profile=path.join(root,'profile'),plugin=path.join(profile,'node_modules/@local/dsh-knowledge-base'),library=path.join(root,'library');await mkdir(plugin,{recursive:true});await mkdir(library);
const old=path.join(repo,'dist/local-dsh-knowledge-base-2.4.3.tgz'),next=path.join(repo,'dist/local-dsh-knowledge-base-2.4.5.tgz');
execFileSync('python',['-X','utf8','-c',"import tarfile,sys,pathlib;t=tarfile.open(sys.argv[1]);d=pathlib.Path(sys.argv[2]);[(d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).parent.mkdir(parents=True,exist_ok=True),d.joinpath(*pathlib.PurePosixPath(m.name).parts[1:]).write_bytes(t.extractfile(m).read())) for m in t if m.isfile()]",old,plugin],{windowsHide:true});
await writeFile(path.join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'@local/dsh-knowledge-base':'file:'+old.replaceAll('\\','/')},dsh:{profile:{bundles:['@local/dsh-knowledge-base']}}}));await writeFile(path.join(profile,'.npmrc'),'node-linker=hoisted\n');
const recovery=path.join(root,'recovery');await mkdir(recovery);await writeFile(path.join(recovery,'kb-transactional-update.py'),await readFile(path.join(repo,'tools/kb-transactional-update.py')));await writeFile(path.join(recovery,'local-dsh-knowledge-base-2.4.3.tgz'),await readFile(old));await writeFile(path.join(recovery,'legacy-243-manifest.json'),execFileSync('git',['show','v2.4.3:release-manifest.json'],{cwd:repo}));
const originalMetadata=await readFile(path.join(profile,'package.json'));
execFileSync('python',['-X','utf8','-c',"from pathlib import Path;import sys; p=Path(sys.argv[1]);(p/'package.json').unlink();(p/'src/host/index.js').unlink()",plugin],{windowsHide:true});
execFileSync('python',['-X','utf8','-c',"import runpy,sys,pathlib;m=runpy.run_path(sys.argv[1]);print(m['repair'](pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3])))",path.join(repo,'tools/repair-legacy-243.py'),profile,recovery],{windowsHide:true});assert.ok((await readFile(path.join(profile,'package.json'))).equals(originalMetadata));
const core=createCore({stateDir:path.join(root,'embedded')});await core.bind(library,{confirmInit:true});await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({synthetic:true,schemaVersion:1}));await writeFile(path.join(library,'original.txt'),'SYNTHETIC_ORIGINAL');
const pythonModule=await import(pathToFileURL(path.join(plugin,'packages/kb-service/host-python.js')).href);const python=await pythonModule.resolveHostPython(plugin,{home:path.join(root,'external-python')});
const oldUpdates=await import(pathToFileURL(path.join(plugin,'src/host/updates.js')).href);const feed=await readFile(path.join(repo,'release-manifest.json'));const check=await oldUpdates.createUpdateChecker({currentVersion:'2.4.3',sourceIds:['github'],previewManifestUrl:null,fetch:async()=>new Response(feed)}).check();assert.equal(check.autoInstallEligible,true);assert.equal(check.latestVersion,'2.4.5');
const runtimeModule=await import(pathToFileURL(path.join(plugin,'packages/kb-service/runtime.js')).href);const runtime=await runtimeModule.connectRuntime({library,home:path.join(root,'services'),python,kind:'desktop',candidateRoot:root});
let active=runtime;const oldHealth=await runtime.client.call('service.health');
const result={legacyPartialRepair:true,oldVersion:'2.4.3',pythonOutsidePlugin:!python.startsWith(plugin),serviceRunningBefore:false,pnpmSucceeded:false,newPackageVersion:null,oldServiceRespondsAfter:false,originalUnchanged:false};
try{
 result.serviceRunningBefore=(await runtime.client.call('service.health')).active;
 const pnpm=path.join(process.env.APPDATA,'npm/node_modules/pnpm/bin/pnpm.mjs');
 const run=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[pnpm,'add',next,'--offline','--ignore-scripts'],{cwd:profile,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('exit',code=>resolve({code,output}));});
 await writeFile(path.join(root,'pnpm.log'),run.output);result.pnpmSucceeded=run.code===0;
 result.newPackageVersion=JSON.parse(await readFile(path.join(plugin,'package.json'),'utf8')).version;
 result.oldServiceRespondsAfter=(await runtime.client.call('service.health')).active;
 assert.equal(result.pnpmSucceeded,true);assert.equal(result.newPackageVersion,'2.4.5');
 await runtime.close();
 const upgraded=await import('../packages/kb-service/runtime.js');
 active=await upgraded.connectRuntime({library,home:path.join(root,'services'),python,kind:'desktop',candidateRoot:root});
 const newHealth=await active.client.call('service.health');assert.notEqual(newHealth.bootId,oldHealth.bootId);assert.ok(newHealth.supported.includes('service.prepareUpgrade'));result.handoffToNewService=true;
 result.originalUnchanged=await readFile(path.join(library,'original.txt'),'utf8')==='SYNTHETIC_ORIGINAL';
}finally{try{await active.client.call('service.shutdown')}catch{}await active.close();core.dispose?.();await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));console.log('EVIDENCE '+path.join(root,'result.json'));}

});
