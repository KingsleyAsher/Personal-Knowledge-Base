import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,writeFile,readFile,stat,access} from 'node:fs/promises';
import {createCore} from '../packages/kb-core/index.js';
import {createManager} from '../apps/desktop/main/service-manager.js';
const repo=path.resolve(import.meta.dirname,'..'),parent=path.join(repo,'.test-runs');await mkdir(parent,{recursive:true});
test('identical validated config preserves bytes and revision; concurrent maintenance and real changes finish', {timeout:30000},async()=>{
 const base=await mkdtemp(path.join(parent,'startup-config-')),library=path.join(base,'library'),stateDir=path.join(base,'state');await mkdir(library);
 const core=createCore({stateDir});assert.equal((await core.bind(library,{confirmInit:true})).ok,true);await writeFile(path.join(library,'note.md'),'# retained original');assert.equal((await core.maintainIndex()).ok,true);
 const conf=await core.getConfig(),file=path.join(stateDir,'config.json'),before=await readFile(file),mtime=(await stat(file)).mtimeMs,index=path.join(library,'.kbmeta/index/entries.json'),indexed=await readFile(index);
 const results=await Promise.all(Array.from({length:6},()=>core.setConfig({categories:[...conf.categories],autoIndex:conf.autoIndex})));
 assert.ok(results.every(r=>r.ok&&r.unchanged&&r.revision===conf.revision));assert.deepEqual(await readFile(file),before);assert.equal((await stat(file)).mtimeMs,mtime);
 assert.equal((await core.maintainIndex()).mode,'unchanged');assert.deepEqual(await readFile(index),indexed);
 const changed=await Promise.all([core.maintainIndex(),core.setConfig({autoIndex:!conf.autoIndex})]);assert.equal(changed[1].ok,true);assert.ok(changed[0].ok||changed[0].reason==='binding-changed',JSON.stringify(changed));assert.equal((await core.maintainIndex()).mode,'unchanged');assert.equal((await core.getConfig()).revision,conf.revision+1);
 assert.equal((await core.setConfig({autoIndex:'invalid'})).ok,false);
 await writeFile(file,'broken');assert.equal((await core.setConfig({autoIndex:true})).reason,'config-degraded');
});
test('reopening an existing library skips sample creation, restore writes and index replacement', {skip:process.platform!=='win32',timeout:45000},async()=>{
 const base=await mkdtemp(path.join(parent,'startup-manager-')),library=path.join(base,'libraries/existing');await mkdir(library,{recursive:true});
 const core=createCore({stateDir:path.join(base,'initial')});assert.equal((await core.bind(library,{confirmInit:true})).ok,true);await writeFile(path.join(library,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}));await writeFile(path.join(library,'note.md'),'# unchanged');await core.maintainIndex();await writeFile(path.join(base,'last-library.json'),JSON.stringify({root:library}));
 const oldLink=process.env.KB_DESKTOP_LINK_HOME,oldProfile=process.env.KB_PROFILE_HOME;process.env.KB_DESKTOP_LINK_HOME=path.join(base,'links');process.env.KB_PROFILE_HOME=path.join(base,'profiles');
 let manager;try{manager=await createManager({dataDir:base,backendRoot:repo,assetDir:path.join(repo,'apps/desktop/fixture-assets'),python:'python',send:()=>{}});await manager.initialize();
 const config=path.join(manager.privateDir,'kernel/config.json'),before=await readFile(config),index=path.join(library,'.kbmeta/index/entries.json'),indexed=await readFile(index),health=await manager.call('service.health'),sequence=await readFile(path.join(manager.privateDir,'sequence.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 await manager.reconnect();const after=await manager.call('service.health');assert.equal(after.bootId,health.bootId);assert.equal(after.writers,1);assert.equal(await readFile(path.join(manager.privateDir,'sequence.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;}),sequence);assert.deepEqual(await readFile(config),before);assert.deepEqual(await readFile(index),indexed);await assert.rejects(access(path.join(base,'libraries/示例资料库')),{code:'ENOENT'});
 assert.equal((await manager.call('document.readForEdit',{path:'note.md'})).text,'# unchanged');
 }finally{try{await manager?.call('service.shutdown');}catch{}await manager?.close();if(oldLink===undefined)delete process.env.KB_DESKTOP_LINK_HOME;else process.env.KB_DESKTOP_LINK_HOME=oldLink;if(oldProfile===undefined)delete process.env.KB_PROFILE_HOME;else process.env.KB_PROFILE_HOME=oldProfile;}
});
