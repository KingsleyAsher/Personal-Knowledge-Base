import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {CLIENT_SOURCES,createClientUpdater,trustedUpdateUrl,validateClientManifest} from '../main/client-updates.js';
const raw=Buffer.from('fixture-installer');const manifest={product:'knowledge-workbench-client',platform:'win32-x64',version:'1.1.0',tag:'client-v1.1.0',buildId:'a'.repeat(16),asset:'KnowledgeWorkbench-1.1.0-fixture-Setup.exe',bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
test('domestic sources are configured and an unavailable primary falls back without reporting false up-to-date',async()=>{const updater=createClientUpdater({version:'1.0.0',directory:'unused',fetch:async url=>{if(url.includes('gitee'))throw Error('offline');return Response.json(manifest)}});const s=await updater.check();assert.equal(s.updateAvailable,true);assert.equal(s.source,'GitCode');assert.equal(s.sourceStatus[0].ok,false);assert.equal(CLIENT_SOURCES[0].id,'gitee');});
test('conflicting same-version digests and wrong product manifests fail closed',async()=>{const updater=createClientUpdater({version:'1.0.0',directory:'unused',fetch:async url=>Response.json({...manifest,sha256:url.includes('gitee')?'b'.repeat(64):manifest.sha256})});assert.equal((await updater.check()).ok,false);assert.throws(()=>validateClientManifest({...manifest,product:'plugin'}));assert.throws(()=>trustedUpdateUrl('https://attacker.example/update.exe'));});
test('verified download is atomic and repeated attempts do not redownload the same build',async()=>{const directory=await mkdtemp(path.join(os.tmpdir(),'kb-update-unit-'));let downloads=0;try{const updater=createClientUpdater({version:'1.0.0',directory,sources:[CLIENT_SOURCES[2]],fetch:async url=>{if(url.endsWith('.json'))return Response.json(manifest);downloads++;return new Response(raw)}});const result=await updater.download();assert.equal(result.downloaded,true);assert.deepEqual(await readFile(path.join(directory,manifest.asset)),raw);await updater.download();assert.equal(downloads,1);}finally{await rm(directory,{recursive:true,force:true});}});
test('corrupt downloads are rejected and do not leave a ready installer',async()=>{const directory=await mkdtemp(path.join(os.tmpdir(),'kb-update-unit-'));try{const updater=createClientUpdater({version:'1.0.0',directory,sources:[CLIENT_SOURCES[2]],fetch:async url=>url.endsWith('.json')?Response.json(manifest):new Response('corrupted')});assert.equal((await updater.download()).downloaded,false);await assert.rejects(readFile(path.join(directory,manifest.asset)));}finally{await rm(directory,{recursive:true,force:true});}});


test('manual update reuses a fully verified cached installer and verifies again before launch',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'kb-manual-update-'));let downloads=0;
 try{
  await writeFile(path.join(directory,manifest.asset),raw);
  const updater=createClientUpdater({version:'1.0.0',directory,sources:[CLIENT_SOURCES[2]],fetch:async url=>{if(url.endsWith('.json'))return Response.json(manifest);downloads++;throw Error('offline')}});
  await assert.rejects(updater.verifiedInstaller(),/请先检查/);
  assert.equal((await updater.download()).downloaded,true);assert.equal(downloads,0);
  assert.equal(await updater.verifiedInstaller(),path.join(directory,manifest.asset));
  await writeFile(path.join(directory,manifest.asset),Buffer.alloc(raw.length));
  await assert.rejects(updater.verifiedInstaller(),/摘要不符/);assert.equal(updater.status().downloaded,false);
 }finally{await rm(directory,{recursive:true,force:true})}
});
