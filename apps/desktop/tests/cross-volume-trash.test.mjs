import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import os from 'node:os';
import {mkdir,mkdtemp,writeFile,readFile,rename,cp,lstat,unlink} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {createDesktopFiles} from '../../../packages/kb-service/desktop-files.js';
test('trash on the library volume, legacy cross-volume restore, and unchanged-source recovery',async()=>{
 const parent=path.resolve('.test-runs');await mkdir(parent,{recursive:true});const privateParent=process.platform==='win32'?path.join(os.homedir(),'.codex','visualizations','kb-trash-tests'):os.tmpdir();await mkdir(privateParent,{recursive:true});const run=await mkdtemp(path.join(parent,'cross-trash-')),root=path.join(run,'library'),privateDir=await mkdtemp(path.join(privateParent,'kb-trash-private-'));
 await mkdir(path.join(root,'.kbmeta'),{recursive:true});await writeFile(path.join(root,'.desktop-preview.json'),JSON.stringify({schemaVersion:1,synthetic:true}));
 const files=await createDesktopFiles({root,desktopRoot:run,privateDir,core:{},withLock:fn=>fn()}),caller='test',call=(m,a={})=>files.call(m,a,caller,randomUUID());
 const perform=async(operation,p)=>{const args={operation,path:p};if(operation==='trash')args.revision=(await call('desktop.stat',{path:p})).revision;const plan=await call('desktop.plan',args),id=randomUUID();await files.call('desktop.commit',{planId:plan.id},caller,id);return id;};
 await mkdir(path.join(root,'示例目录','空目录'),{recursive:true});await writeFile(path.join(root,'示例目录','笔记.md'),'SYNTHETIC BYTES\n');
 const id=await perform('trash','示例目录'),local=path.join(root,'.kbmeta','desktop-trash',id);assert.equal(await lstat(path.join(root,'示例目录')).catch(()=>null),null);assert.equal(await readFile(path.join(local,'original-folder','笔记.md'),'utf8'),'SYNTHETIC BYTES\n');
 const preview=await call('desktop.trashPreview',{id,path:'笔记.md'});assert.equal(preview.text,'SYNTHETIC BYTES\n');assert((await call('desktop.trash')).items.some(x=>x.id===id));
 await mkdir(path.join(root,'示例目录'));await assert.rejects(call('desktop.plan',{operation:'restore',path:id}),{code:'CONFLICT'});
 const restore=await call('desktop.plan',{operation:'restore',path:id,destination:'已恢复目录'});await files.call('desktop.commit',{planId:restore.id},caller,randomUUID());assert.equal(await readFile(path.join(root,'已恢复目录','笔记.md'),'utf8'),'SYNTHETIC BYTES\n');assert((await lstat(path.join(root,'已恢复目录','空目录'))).isDirectory());
 const legacyId=await perform('trash','已恢复目录'),newArchive=path.join(root,'.kbmeta','desktop-trash',legacyId),legacy=path.join(privateDir,'desktop','trash',legacyId);await cp(newArchive,legacy,{recursive:true});await rename(newArchive,path.join(run,'held-archive'));
 await perform('restore',legacyId);assert.equal(await readFile(path.join(root,'已恢复目录','笔记.md'),'utf8'),'SYNTHETIC BYTES\n');
 const purgeId=await perform('trash','已恢复目录');await perform('purge',purgeId);assert(!(await call('desktop.trash')).items.some(x=>x.id===purgeId));
 // Reproduce the original primitive failure with isolated C:/D: fixtures.
 await mkdir(path.join(root,'未移动目录'));await writeFile(path.join(root,'未移动目录','内容.md'),'UNMOVED');const source=await call('desktop.stat',{path:'未移动目录'}),child=await call('desktop.stat',{path:'未移动目录/内容.md'}),failedId=randomUUID(),old=path.join(privateDir,'desktop','trash',failedId),proof=path.join(privateDir,'desktop','operations',failedId);await mkdir(old,{recursive:true});await mkdir(proof,{recursive:true});
 await writeFile(path.join(old,'manifest.json'),JSON.stringify({id:failedId,path:'未移动目录',type:'directory',state:'prepared'}));await writeFile(path.join(proof,'intent.json'),JSON.stringify({operation:'trash',source:'未移动目录',revision:source.revision,descendants:[child]}));
 const crossVolume=(await lstat(root,{bigint:true})).dev!==(await lstat(privateDir,{bigint:true})).dev;
 if(crossVolume)await assert.rejects(rename(path.join(root,'未移动目录'),path.join(old,'original-folder')),{code:'EXDEV'});
 assert.equal((await files.recoverReceipt(failedId)).failed,true);await writeFile(path.join(root,'未移动目录','内容.md'),'EXTERNAL EDIT');assert.equal(await files.recoverReceipt(failedId),null);
 console.log(JSON.stringify({crossVolume,libraryVolume:path.parse(root).root,privateVolume:path.parse(privateDir).root,syntheticOnly:true}));
});
