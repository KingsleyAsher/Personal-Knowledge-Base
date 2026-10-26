import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRankingPool } from '../src/host/retrieval-pool.js'
import { createRelationIndex } from '../src/host/workbench-relation-index.js'
import { createRetrieval } from '../src/host/retrieval.js'

test('ranking queue rejects overload, releases canceled queued messages and replaces only the canceled active worker',async t=>{
  const pool=createRankingPool({maxQueue:1});t.after(()=>pool.dispose())
  const records=[{id:0,title:'tiny',path:'tiny.md',text:'审批规则'}],controller=new AbortController()
  const canceled=assert.rejects(pool.run({records,query:'审批'},controller.signal),{code:'CANCELED'})
  const queuedController=new AbortController(),queued=assert.rejects(pool.run({records,query:'审批'},queuedController.signal),{code:'CANCELED'})
  await assert.rejects(pool.run({records,query:'审批'}),{code:'SEARCH_BUSY'})
  queuedController.abort();await queued
  const next=pool.run({records,query:'审批'})
  controller.abort();await canceled
  assert.equal((await next).ranked[0].id,0);assert.equal(pool.stats.canceledActive,1);assert.equal(pool.stats.started,2);assert.equal(pool.stats.rejectedBusy,1)
  assert.equal((await pool.run({records,query:'审批'})).ranked[0].id,0)
})

test('relation requests arriving during an old scan recheck the requested snapshot',async t=>{
  const stateDir=await mkdtemp(path.join(os.tmpdir(),'kb-relations-'));t.after(()=>rm(stateDir,{recursive:true,force:true}))
  let release,started
  const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r)
  const b={key:'library',root:'D:/Library',st:{kbId:'kb'}}
  const service=createRelationIndex({stateDir,readText:async(_b,file)=>{if(file==='old.md'){started();await gate};return{text:'# '+file,revision:file}}})
  const old=[{path:'old.md',bytes:10,mtimeMs:1,ctimeMs:1}],first=service.documents(b,old)
  await entered
  const second=service.documents(b,[...old,{path:'new.md',bytes:10,mtimeMs:1,ctimeMs:1}])
  release();await first
  assert.deepEqual(Object.keys(await second),['old.md','new.md']);assert.equal(service.status(b).status,'synced')
})

test('query admission rejects overload before loading the document catalog or calling an API',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kb-query-admission-'));t.after(()=>rm(root,{recursive:true,force:true}))
  let release,loaded,loads=0
  const gate=new Promise(r=>release=r),entered=new Promise(r=>loaded=r),b={root,key:'library',st:{kbId:'kb'}}
  const service=createRetrieval({stateDir:path.join(root,'state'),binding:async()=>b,versionOf:()=>1,visible:()=>true,maxConcurrentQueries:1,
    loadDocuments:async()=>{loads++;loaded();await gate;return{documents:[],names:[],errors:[],nameOnly:0}},fetcher:async()=>{throw Error('Unexpected API call')}})
  t.after(()=>service.dispose())
  const first=service.search(b,{query:'审批'});await entered
  await assert.rejects(service.search(b,{query:'审批'}),{code:'SEARCH_BUSY'});assert.equal(loads,1)
  release();await first
  await service.search(b,{query:'审批'});assert.equal(loads,2)
})
