import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createRetrieval} from '../src/host/retrieval.js'
import {createParseCredentials} from '../src/host/parse-credentials.js'
import {initialRetrievalConfig} from '../src/host/retrieval-api.js'
import {META_DIRS} from '../src/host/fsindex.js'

test('library index migration and encrypted provider references survive service replacement',async t=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'kb-storage-'))
 t.after(()=>rm(base,{recursive:true,force:true}))
 const stateDir=path.join(base,'profile','kb-state'),root=path.join(base,'library')
 await mkdir(root,{recursive:true})
 const b={root,key:'stable-library',st:{kbId:'specimen'}}
 const credentialStore=()=>createParseCredentials(path.join(stateDir,'retrieval'),{protect:b=>Buffer.from(b).map(n=>n^123),unprotect:b=>Buffer.from(b).map(n=>n^123)})
 const credentials=credentialStore(),ref=await credentials.save({apiKey:'synthetic-test-key'})
 const old=path.join(stateDir,'retrieval',b.key),generation='a'.repeat(32)
 await mkdir(path.join(old,generation),{recursive:true})
 await writeFile(path.join(old,generation,'vectors-0.bin'),Buffer.from([1,2,3,4]))
 await writeFile(path.join(old,'progress.json'),JSON.stringify({state:'paused'}))
 const config=initialRetrievalConfig();config.embedding.credentialRef=ref
 await writeFile(path.join(old,'config.json'),JSON.stringify({revision:1,...config}))
 const nested=path.join(root,'索引层','向量检索');await mkdir(path.join(nested,'b'.repeat(32)),{recursive:true});await writeFile(path.join(nested,'b'.repeat(32),'test.bin'),Buffer.from([5,6]))
 const options={stateDir,binding:async()=>b,versionOf:()=>1,visible:()=>true,loadDocuments:async()=>({documents:[],names:[],errors:[],nameOnly:0}),fetcher:async()=>{throw Error('No network expected')}}
 const first=createRetrieval({...options,credentials})
 let status
 try{status=await first.dispatch(b,{op:'retrieval.get'});assert.equal(status.progress.state,'paused');assert.equal(status.credentialStatus.embedding,true)
 assert.equal(status.estimate.storagePath,path.join(root,'索引层'))
 assert.deepEqual(await readFile(path.join(status.estimate.storagePath,generation,'vectors-0.bin')),Buffer.from([1,2,3,4]))
 await assert.rejects(access(path.join(old,generation)));await assert.rejects(access(nested));assert.deepEqual(await readFile(path.join(root,'索引层','b'.repeat(32),'test.bin')),Buffer.from([5,6]))
 assert.equal((await credentials.read(ref)).apiKey,'synthetic-test-key')
 await first.dispatch(b,{op:'retrieval.save',config:status.config})
 }finally{first.dispose()}
 const replacement=createRetrieval({...options,credentials:credentialStore()})
 try{status=await replacement.dispatch(b,{op:'retrieval.get'});assert.equal(status.config.embedding.credentialRef,ref);assert.equal(status.credentialStatus.embedding,true)
 const onDisk=await readFile(path.join(stateDir,'retrieval','parse-credentials',ref));assert(!onDisk.includes(Buffer.from('synthetic-test-key')))
 const saved=JSON.parse(await readFile(path.join(old,'config.json'),'utf8'));delete saved.embedding.credentialRef
 await writeFile(path.join(old,'config.json'),JSON.stringify(saved))
 assert.equal((await replacement.dispatch(b,{op:'retrieval.get'})).config.embedding.credentialRef,ref)
 assert(META_DIRS.has('索引层'))
 }finally{replacement.dispose()}
})
