import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createUpdateDownloader, UPDATE_PART_BYTES } from '../src/host/updates.js'

const m=JSON.parse(await readFile(new URL('../release-manifest-v2.json',import.meta.url),'utf8'))
const raw=await readFile(new URL('../dist/'+m.tgz,import.meta.url))
const release={...m,ok:true,updateAvailable:true,latestVersion:m.version,sourceIds:['gitee']}
async function cache(t){const dir=await mkdtemp(path.join(os.tmpdir(),'kb-download-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}

test('a new mirror manifest and forbidden large binary can recover through bounded text parts',async t=>{
 const dir=await cache(t);let active=0,peak=0,parts=0
 const d=createUpdateDownloader({checker:{check:async()=>release},cacheDir:dir,fetch:async url=>{
  if(!url.includes('/update-parts/'))return new Response('',{status:403})
  assert.ok(url.startsWith('https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/update-parts/'+m.sha256+'/'))
  const index=Number(url.match(/(\d+)\.b64$/)[1]);active++;peak=Math.max(peak,active);parts++
  await new Promise(r=>setTimeout(r,2));active--
  return new Response(raw.subarray(index*UPDATE_PART_BYTES,(index+1)*UPDATE_PART_BYTES).toString('base64'))
 }})
 const result=await d.prepare({expectedVersion:m.version})
 assert.equal(result.downloadSource,'gitee-parts');assert.equal(parts,Math.ceil(raw.length/UPDATE_PART_BYTES));assert.ok(peak<=3)
 assert.deepEqual(await readFile(result.spec),raw)
})

test('same-size corrupted parts fail the complete archive digest without an installable cache',async t=>{
 const dir=await cache(t)
 const d=createUpdateDownloader({checker:{check:async()=>release},cacheDir:dir,fetch:async url=>{
  if(!url.includes('/update-parts/'))return new Response('',{status:403})
  const i=Number(url.match(/(\d+)\.b64$/)[1]),part=Buffer.from(raw.subarray(i*UPDATE_PART_BYTES,(i+1)*UPDATE_PART_BYTES));if(i===0)part[0]^=1
  return new Response(part.toString('base64'))
 }})
 await assert.rejects(d.prepare({expectedVersion:m.version}),/摘要或大小不符/)
 assert.deepEqual(await readdir(path.join(dir,m.sha256)),[])
})

test('parts cannot redirect to arbitrary services or accept invalid base64',async t=>{
 for(const bad of ['redirect','encoding']){
  const dir=await cache(t)
  const d=createUpdateDownloader({checker:{check:async()=>release},cacheDir:dir,fetch:async url=>{
   if(!url.includes('/update-parts/'))return new Response('',{status:403})
   return bad==='redirect'?new Response(null,{status:302,headers:{location:'https://example.com/part'}}):new Response('not valid base64!')
  }})
  await assert.rejects(d.prepare({expectedVersion:m.version}),bad==='redirect'?/跳转不受信任/:/分片编码无效/)
  assert.deepEqual(await readdir(path.join(dir,m.sha256)),[])
 }
})

test('a progressing large archive is not aborted by a total metadata-length timeout',async t=>{
 const dir=await cache(t),chunk=Math.ceil(raw.length/4)
 const d=createUpdateDownloader({checker:{check:async()=>({...release,sourceIds:['github']})},cacheDir:dir,timeoutMs:150,fetch:async()=>new Response(new ReadableStream({
  async start(controller){for(let i=0;i<raw.length;i+=chunk){await new Promise(r=>setTimeout(r,65));controller.enqueue(raw.subarray(i,i+chunk))}controller.close()},
 }))})
 assert.equal((await d.prepare({expectedVersion:m.version})).downloadSource,'github')
})

test('closing a failure survives component and module remount; a new retry failure remains visible',async()=>{
 const source=await readFile(new URL('../src/client/index.js',import.meta.url),'utf8')
 const start=source.indexOf('    function createUpdateFailureMemory('),end=source.indexOf('    const updateFailureMemory =',start)
 const create=()=>vm.runInNewContext(source.slice(start,end)+'\ncreateUpdateFailureMemory')
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}
 const first=create()(storage);assert.equal(first.has('update:failure-1'),false);first.dismiss('update:failure-1')
 const remounted=create()(storage);assert.equal(remounted.has('update:failure-1'),true);assert.equal(remounted.has('update:failure-2'),false)
 const blocked=create()({getItem(){throw Error('disabled')},setItem(){throw Error('disabled')}});blocked.dismiss('failure');assert.equal(blocked.has('failure'),true)
 assert.ok(source.includes('react.useState(()=>updateFailureMemory.has(failureKey))'))
})
