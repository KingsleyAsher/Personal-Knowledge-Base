import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,rm,open,mkdir,stat,utimes } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { structureDocument,byteEnd,expandRange,hash,embeddingText } from '../src/host/retrieval-chunks.js'
import * as original from './fixtures/retrieval-chunks-original.mjs'
import { rank } from '../src/host/retrieval-worker.js'
import { rank as baseline } from './fixtures/retrieval-worker-original.mjs'
import { createByteCache } from '../src/host/retrieval-cache.js'
import { createNameLookup } from '../src/host/relation-name-lookup.js'
import { createRetrieval } from '../src/host/retrieval.js'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'

test('linear chunking preserves every offset, heading, hint, embedding input and UTF-8 budget',()=>{
  const texts=['','\ufeff---\r\ntitle: 示例\r\n---\r\n# 标题\r\n审批后才允许，未审批不得使用。\r\n','\ud800a\udc00🌏é 中文\n'.repeat(900),'# A\n'+('前提与否定条件。'.repeat(300)+'\n\n').repeat(40),'# 表格\n|项目|条件|\n|---|---|\n'+('|甲|仅审批后允许，例外需要记录|\n').repeat(1200),'# 列表\n'+('- 审批事项：'+('x'.repeat(300))+'\n').repeat(70),'# Code\n```js\n'+('console.log("hello");\n').repeat(200)+'```\n']
  for(const text of texts){
    const actual=structureDocument(text,'同一标题'),expected=original.structureDocument(text,'同一标题')
    assert.deepEqual(actual,expected)
    for(const c of actual.chunks){assert.equal(embeddingText(text,c),original.embeddingText(text,expected.chunks[c.id]));assert.deepEqual(expandRange(text,c),original.expandRange(text,c))}
  }
  const sample='a中🌏\ud800\udc00\ud800x\udc00\n'
  for(let start=0;start<=sample.length;start++)for(const budget of [0,1,2,3,4,5,12,100])assert.equal(byteEnd(sample,start,budget),original.byteEnd(sample,start,budget))
})

test('bounded name lookup gives identical ordered suggestions, including budget fallback and short names',()=>{
  const names=new Map(Array.from({length:3000},(_,i)=>['document-'+i+'审批🌏',[`notes/${i}.md`,...(i%7===0?['shared.md']:[])]]))
  names.set('', ['empty.md'])
  for(const budget of [0,180,16*1024*1024]){
    const index=createNameLookup(names,budget)
    for(const needle of ['','d','中','审批','🌏','ment-29','document-2999','no-match','-1','ent-3审']){
      const expected=[...new Set([...names].filter(([key])=>key.includes(needle)).flatMap(([,v])=>v))].slice(0,12)
      assert.deepEqual(index.find(needle),expected)
      const mutable=index.find(needle);mutable.push('unrelated');assert.deepEqual(index.find(needle),expected)
    }
    assert(index.stats().estimatedBytes<=budget)
  }
})

test('byte cache bounds retention, bypasses oversized values and never returns stale replacements',()=>{
  const cache=createByteCache({maxBytes:1024,maxEntries:3,sizeOf:v=>Buffer.byteLength(v.text)})
  cache.set('a',{text:'old'});cache.set('b',{text:'B'});cache.set('c',{text:'C'});cache.get('a');cache.set('d',{text:'D'})
  assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a').text,'old')
  cache.set('a',{text:'new'});assert.equal(cache.get('a').text,'new')
  cache.set('a',{text:'x'.repeat(5000)});assert.equal(cache.get('a'),undefined);assert(cache.stats().bypasses)
  for(let i=0;i<100;i++)cache.set(String(i),{text:'缓存'.repeat(30)})
  assert(cache.stats().estimatedBytes<=1024);assert(cache.size<=3);cache.clear();assert.equal(cache.stats().estimatedBytes,0)
})

test('streamed exact search matches the old full scan above the shard budget, including cross supplements and corruption',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'kb-large-exact-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const count=20000,dimension=1024,records=[]
  for(let shard=0;shard<Math.ceil(count/4096);shard++){
    const size=Math.min(4096,count-shard*4096),buffer=Buffer.alloc(size*dimension*4)
    for(let slot=0;slot<size;slot++){
      const id=shard*4096+slot,x=(id+1)/(count+1),at=slot*dimension*4
      buffer.writeFloatLE(x,at);buffer.writeFloatLE(Math.sqrt(1-x*x),at+4)
      records.push({id,path:`notes/${id%251}.md`,title:`Title ${id%37}`,section:id%7,text:`审批条件 ${id%13} only after approval, otherwise forbidden`,slot:id,checksum:hash(buffer.subarray(at,at+dimension*4))})
    }
    await writeFile(path.join(dir,`vectors-${shard}.bin`),buffer)
  }
  const vector=Array.from({length:dimension},(_,i)=>i===0?1:0),message={records,vector,vectorDir:dir,dimension,query:'审批条件 7',mode:'hybrid',useCache:false}
  for(const mode of ['hybrid','semantic']){
    const expected=await baseline({...message,mode}),actual=await rank({...message,mode})
    assert.deepEqual(actual.ranked,expected.ranked);assert.equal(actual.lexical,expected.lexical);assert.equal(actual.semantic,count)
    assert.equal(actual.crossFulltext,expected.crossFulltext);assert.equal(actual.crossSemantic,expected.crossSemantic)
    assert.equal(actual.cache.streamedShards,5);assert(actual.cache.vectorWindowPeakBytes<=1024*1024)
    assert(actual.cache.retainedSemanticScores<=100);assert(actual.cache.retainedLexicalScores<=100)
    assert.equal(actual.cache.vectorBytesRead,count*dimension*4)
  }
  const fh=await open(path.join(dir,'vectors-4.bin'),'r+')
  try{await fh.write(Buffer.from([123]),0,1,((count-1)%4096)*dimension*4);await fh.sync()}finally{await fh.close()}
  const expected=await baseline(message),actual=await rank(message)
  assert.deepEqual(actual.ranked,expected.ranked);assert.deepEqual(actual.vectorErrors,[4]);assert.equal(actual.semantic,count-1)
})

test('manifest reuse still reloads same-size changes, rejects corruption and recovers after repair',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kb-manifest-cache-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const b={root,key:'library',st:{kbId:'library'}},text='# Evidence\n审批后使用，否则禁止。'
  const service=createRetrieval({stateDir:path.join(root,'state'),binding:async()=>b,versionOf:()=>1,visible:()=>true,
    loadDocuments:async()=>({documents:[{path:'source.md',title:'Evidence',text,revision:hash(text),tags:[]}],names:[],errors:[],nameOnly:0})})
  t.after(()=>service.dispose())
  const model=(await service.reconcile(b)).modelFingerprint,dir=path.join(root,'索引层',model);await mkdir(dir,{recursive:true})
  const file=path.join(dir,'manifest.json'),manifest={format:1,dimension:8,nextSlot:0,vectors:{}}
  await writeFile(file,JSON.stringify(manifest))
  const args={query:'审批',retrievalMode:'fulltext'},first=await service.search(b,args),second=await service.search(b,args)
  assert.equal(first.cache.manifest.loads,second.cache.manifest.loads);assert(second.cache.manifest.hits>first.cache.manifest.hits)
  const before=await stat(file);manifest.dimension=9;await writeFile(file,JSON.stringify(manifest));await utimes(file,before.atime,before.mtime)
  const changed=await service.search(b,args);assert(changed.cache.manifest.loads>second.cache.manifest.loads)
  await writeFile(file,'broken');const damaged=await service.search(b,args);assert.equal(damaged.items.length,1)
  await writeFile(file,JSON.stringify(manifest));const repaired=await service.search(b,args);assert.equal(repaired.items.length,1);assert(repaired.cache.manifest.loads>changed.cache.manifest.loads)
})

test('scoped searches avoid out-of-scope chunking and preserve attached-source folding',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'kb-scoped-')),root=path.join(base,'library');await mkdir(root)
  t.after(()=>rm(base,{recursive:true,force:true}))
  const stateDir=path.join(base,'state'),core=createCore({stateDir},()=>{});await core.bind(root,{confirmInit:true})
  const text='# Scope\n审批后使用，否则禁止。'
  await mkdir(path.join(root,'20-知识笔记','target'),{recursive:true})
  for(const file of ['target/selected.md','outside.md','original.md'])await writeFile(path.join(root,'20-知识笔记',file),text)
  const wb=createWorkbench({stateDir,getCore:()=>core});t.after(()=>wb.dispose())
  const b=await wb.binding(),args={query:'审批',retrievalMode:'fulltext',prefix:'20-知识笔记/target'}
  const scoped=await wb.retrieval.search(b,args)
  assert.deepEqual(scoped.items.map(r=>r.path),['20-知识笔记/target/selected.md'])
  assert.equal(scoped.retrievalTrace.timings.chunkCacheMisses,1)
  const all=await wb.retrieval.search(b,{query:'审批',retrievalMode:'fulltext'})
  assert.equal(all.items.length,3)
  await writeFile(path.join(root,'.kbmeta','import-sources.json'),JSON.stringify({entries:{attached:{mode:'attach',sourceRoot:root,kbId:b.st.kbId,originalPath:'20-知识笔记/original.md',entryPath:'20-知识笔记/target/selected.md'}}}))
  wb.invalidate()
  const attached=await wb.binding(),folded=await wb.retrieval.search(attached,args)
  assert.equal(folded.items.length,0)
})
