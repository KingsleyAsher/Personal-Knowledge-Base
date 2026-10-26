import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'
import { extractReferences } from '../src/host/workbench-links.js'
import vm from 'node:vm'

async function fixture() {
  const base = await mkdtemp(path.resolve('..','beta4-qa-')), root = path.join(base,'library'), stateDir = path.join(base,'state')
  await mkdir(root)
  const core = createCore({ stateDir }, () => {})
  assert((await core.bind(root,{confirmInit:true})).ok)
  await writeFile(path.join(root,'20-知识笔记','2026-10-19-虚构课堂.md'), '---\ntitle: 虚构课堂\ntype: 知识\nupdated: 2026-10-19\n---\n# 函数性质\n蓝鲸课堂讲了有界性。\n[另一个](beta.md)\n[隐私](../00-画像/secret.md)\n')
  await writeFile(path.join(root,'20-知识笔记','beta.md'),'# Beta\n公开蓝鲸资料。\n[坏链接](gone.md)\n')
  await writeFile(path.join(root,'00-画像','secret.md'),'# 虚构隐私\n私密蓝鲸资料。')
  await core.maintainIndex()
  const wb = createWorkbench({ stateDir,getCore:()=>core,now:()=>Date.parse('2026-10-20T12:00:00Z') })
  const kbId=(await core.status()).kbId
  const call=(args,caller)=>wb.dispatch({expectedKbId:kbId,...args},caller)
  const prefs=async patch=>{const p=await call({op:'preferences.get'});return call({op:'preferences.save',expectedRevision:p.revision,preferences:{...p.preferences,...patch}})}
  return {base,root,stateDir,core,wb,kbId,call,prefs}
}

test('beta4 reference is short, session-bound and read incrementally; relative date resolves to exact date',async()=>{
  const f=await fixture(), snap=await f.call({op:'atlas.snapshot'})
  const q=await f.call({op:'question.create',sessionId:'session-a',includePrivate:false,policyVersion:snap.policyVersion})
  assert(!JSON.stringify(q).includes('蓝鲸')); assert(JSON.stringify(q).length<200)
  await assert.rejects(f.call({op:'question.search',questionId:q.questionId,query:'蓝鲸'},'other'),{code:'SESSION_MISMATCH'})
  const result=await f.call({op:'question.search',questionId:q.questionId,query:'昨天课堂'},'session-a')
  assert.equal(result.sources.length,1);assert(result.normalizedQuery.includes('2026-10-19'))
  assert(!JSON.stringify(result).includes('secret.md'));assert(result.sources.reduce((n,s)=>n+s.text.length,0)<=6000)
  const read=await f.call({op:'question.read',questionId:q.questionId,sourceId:'S1',line:7},'session-a');assert(read.source.text.includes('有界性'))
  const valid=await f.call({op:'question.validate',questionId:q.questionId,answer:'有界性 '+read.source.citation},'session-a');assert.equal(valid.invalid.length,0)
  const bare=await f.call({op:'question.validate',questionId:q.questionId,answer:'有界性 [S1]'},'session-a');assert.deepEqual(bare.invalid,['S1'])
  const forged=await f.call({op:'question.validate',questionId:q.questionId,answer:'[S1](https://invalid.example/#L2)'},'session-a');assert.deepEqual(forged.invalid,['S1'])
  await assert.rejects(f.call({op:'question.read',questionId:q.questionId,sourceId:'S1',line:999999},'session-a'),{code:'LINE_OUT_OF_RANGE'})
  await writeFile(path.join(f.root,result.sources[0].path),'changed')
  const changed=await f.call({op:'question.validate',questionId:q.questionId,answer:read.source.citation},'session-a');assert.deepEqual(changed.invalid,['S1'])
})

test('beta4 private reference revokes after privacy policy changes',async()=>{
  const f=await fixture();await f.prefs({showPrivate:true,allowPrivateQuestions:true})
  const snap=await f.call({op:'atlas.snapshot'}),q=await f.call({op:'question.create',sessionId:'s',includePrivate:true,policyVersion:snap.policyVersion})
  const result=await f.call({op:'question.search',questionId:q.questionId,query:'蓝鲸'},'s');assert(result.sources.some(s=>s.path.includes('secret')))
  await f.prefs({showPrivate:false})
  await assert.rejects(f.call({op:'question.search',questionId:q.questionId,query:'蓝鲸'},'s'),{code:'CONTEXT_EXPIRED'})
})

test('beta4 links have correct replacement offsets, directory links resolve, issue pagination exceeds 100',async()=>{
  const refs=extractReferences('[same.md](same.md)\nsource_2: old.m4a\n`[skip](gone.md)`')
  assert.equal(refs.length,2);assert.equal('[same.md](same.md)'.slice(refs[0].start,refs[0].end),'same.md');assert.equal(refs[0].start,10)
  const f=await fixture(), baseline=(await f.call({op:'links.issues'})).total;await writeFile(path.join(f.root,'20-知识笔记','broken.md'),'[folder](../40-素材资源/)\n'+Array.from({length:125},(_,i)=>`[bad ${i}](lost-${i}.md)`).join('\n'));f.wb.invalidate()
  const first=await f.call({op:'links.issues'}), last=await f.call({op:'links.issues',offset:120})
  assert.equal(first.total,baseline+125);assert.equal(first.items.length,30);assert.equal(last.items.length,Math.min(30,first.total-120))
  assert(!JSON.stringify(first).includes('secret.md'));assert(!first.items.some(i=>i.rawTarget==='../40-素材资源/'))
})

test('beta4 link repair previews, detects conflicts, applies exact link only and undoes',async()=>{
  const f=await fixture(), target='20-知识笔记/beta.md', issue=(await f.call({op:'links.issues'})).items[0]
  const before=await readFile(path.join(f.root,target),'utf8')
  const preview=await f.call({op:'links.preview',changes:[{id:issue.id,target:'20-知识笔记/2026-10-19-虚构课堂.md'}]})
  assert.equal(await readFile(path.join(f.root,target),'utf8'),before)
  await writeFile(path.join(f.root,target),before+'external')
  await assert.rejects(f.call({op:'links.apply',previewId:preview.previewId}),{code:'FILE_CHANGED'})
  await writeFile(path.join(f.root,target),before)
  const fresh=await f.call({op:'links.preview',changes:[{id:issue.id,target:'20-知识笔记/2026-10-19-虚构课堂.md'}]})
  const applied=await f.call({op:'links.apply',previewId:fresh.previewId})
  assert((await readFile(path.join(f.root,target),'utf8')).includes('[坏链接](2026-10-19-虚构课堂.md)'))
  await f.call({op:'links.undo',repairId:applied.repairId})
  assert.equal(await readFile(path.join(f.root,target),'utf8'),before)
})

test('beta4 AI repair proposals are session-bound and never apply themselves',async()=>{
  const f=await fixture(), issue=(await f.call({op:'links.issues'})).items[0]
  const r=await f.call({op:'links.ai.create',ids:[issue.id],sessionId:'repair-session'})
  await assert.rejects(f.call({op:'links.ai.inspect',requestId:r.requestId},'other'),{code:'SESSION_MISMATCH'})
  await f.call({op:'links.ai.propose',requestId:r.requestId,proposals:[{id:issue.id,target:'20-知识笔记/2026-10-19-虚构课堂.md',reason:'虚构样本关联依据'}]},'repair-session')
  assert.equal((await f.call({op:'links.ai.status',requestId:r.requestId})).proposals.length,1)
  assert((await readFile(path.join(f.root,'20-知识笔记/beta.md'),'utf8')).includes('gone.md'))
})

test('beta4 task outputs live under bound library; text and PDF generation text are searchable; private derivation stays private',async()=>{
  const f=await fixture();await f.prefs({showPrivate:true,allowPrivateQuestions:true})
  const prepare=await f.call({op:'deliverables.prepare',task:'公开成品',private:false,sources:['20-知识笔记/beta.md']})
  assert.equal(prepare.relativeDirectory,'任务成品/公开成品')
  await writeFile(path.join(prepare.directory,'notes.txt'),'海豚成品正文')
  await f.call({op:'deliverables.register',task:'公开成品',path:'任务成品/公开成品/notes.txt',private:false,sources:['20-知识笔记/beta.md']})
  await writeFile(path.join(prepare.directory,'report.pdf'),'%PDF synthetic fixture')
  await f.call({op:'deliverables.register',task:'公开成品',path:'任务成品/公开成品/report.pdf',text:'海豚报告生成原文',private:false,sources:[]})
  const hidden=await f.call({op:'deliverables.prepare',task:'隐私成品',private:false,sources:['00-画像/secret.md']})
  assert(hidden.private);await writeFile(path.join(hidden.directory,'secret.txt'),'海豚私密成品')
  await f.call({op:'deliverables.register',task:'隐私成品',path:'任务成品/隐私成品/secret.txt',private:false,sources:['00-画像/secret.md']})
  await f.prefs({showPrivate:false})
  const result=await f.call({op:'search.list',mode:'body',q:'海豚'});assert.equal(result.total,2);assert(!JSON.stringify(result).includes('secret.txt'))
})

test('beta4 AI new relationship proposals require explicit preview/apply and can be undone',async()=>{
  const f=await fixture(),focus='20-知识笔记/beta.md',target='20-知识笔记/2026-10-19-虚构课堂.md'
  const r=await f.call({op:'links.ai.create',focus,sessionId:'new-rel'})
  const info=await f.call({op:'links.ai.inspect',requestId:r.requestId},'new-rel'),id=info.issues[0].id
  const read=await f.call({op:'links.ai.read',requestId:r.requestId,path:focus},'new-rel');assert(read.text.includes('蓝鲸'))
  await f.call({op:'links.ai.propose',requestId:r.requestId,proposals:[{id,target,reason:'两份资料对同一概念补充说明'}]},'new-rel')
  assert.equal((await f.call({op:'links.ai.latest'})).requestId,r.requestId)
  const before=await f.call({op:'atlas.relations',path:focus,type:'manual'});assert.equal(before.total,0)
  const p=await f.call({op:'links.preview',changes:[{id,target}]}),applied=await f.call({op:'links.apply',previewId:p.previewId})
  assert.equal((await f.call({op:'atlas.relations',path:focus,type:'manual'})).total,1)
  await f.call({op:'links.undo',repairId:applied.repairId})
  assert.equal((await f.call({op:'atlas.relations',path:focus,type:'manual'})).total,0)
})

test('beta4 importing existing outputs requires a stable preview and keeps originals',async()=>{
  const f=await fixture(), old=path.join(f.base,'old');await mkdir(old);await writeFile(path.join(old,'a.txt'),'import text')
  const p=await f.call({op:'deliverables.import-preview',directory:old,task:'既有成品'})
  assert.equal(p.files.length,1)
  await writeFile(path.join(old,'a.txt'),'changed')
  await assert.rejects(f.call({op:'deliverables.import-confirm',previewId:p.previewId}),{code:'FILE_CHANGED'})
  const p2=await f.call({op:'deliverables.import-preview',directory:old,task:'既有成品'})
  await f.call({op:'deliverables.import-confirm',previewId:p2.previewId})
  assert.equal(await readFile(path.join(old,'a.txt'),'utf8'),'changed')
  assert.equal(await readFile(path.join(f.root,'任务成品/既有成品/a.txt'),'utf8'),'changed')
})

test('beta4 native @ codec exposes exactly two choices and never serializes source text or a duplicate question',async()=>{
  const code=await readFile(new URL('../src/client/workbench-ui.js',import.meta.url),'utf8'), calls=[]
  const factory=vm.runInNewContext(code+'\ncreateWorkbenchUI', {window:{dispatchEvent(){}},CustomEvent:class{constructor(name,detail){this.name=name;this.detail=detail}},URL,Blob,AbortController,crypto:globalThis.crypto})
  let source
  const matchers=[],renderers=[]
  const ctx={inject:(_names,fn)=>fn(ctx),effect:fn=>fn(),get:name=>({
    inputTriggers:{registerSource:s=>{source=s;return()=>{}}},
    uiConversation:{userText:{register:rule=>{matchers.push(rule);return()=>{}}}},
    slots:{inject:(_slot,fn)=>fn(),register:(slot,component)=>{renderers.push({slot,component});return()=>{}}},
  })[name]}
  const ui=factory({react:{},e:()=>null,api:async args=>{calls.push(args);return args.op==='atlas.snapshot'?{ok:true,kbId:'k',policyVersion:'p',preferences:{allowPrivateQuestions:false},sections:[{name:'项目'}]}:{ok:true,questionId:'short-reference-id',label:'基于知识库回答（不含隐私）'}},ctx:()=>ctx})
  ui.registerReferences(ctx)
  assert.equal(matchers.length,1);assert.equal(renderers.length,1)
  const rows=await source.candidates({sessionId:'s'},{query:'',signal:new AbortController().signal})
  assert.deepEqual(Array.from(rows,r=>r.label),['基于知识库回答（含隐私）','基于知识库回答（不含隐私）'])
  assert.throws(()=>source.onPick({candidate:rows[0]}),/允许隐私提问/)
  const picked=source.onPick({candidate:rows[1]}), sent=await source.codec.serialize(picked.insert.ref,new AbortController().signal)
  assert(sent.length<300);assert(!sent.includes('knowledge_sources'));assert(!sent.includes('问题：'));assert.equal(calls.at(-1).op,'question.create');assert.equal(calls.at(-1).sessionId,'s')
})

test('beta4 multiline source metadata and anchor repair preserve real offsets and unrelated text',async()=>{
  const text='---\nsource_2:\n  - "source-two.m4a"\nsee_also:\n  - beta.md#heading\n---\n[same.md](same.md)\n'
  const refs=extractReferences(text)
  assert(refs.some(r=>r.type==='source' && text.slice(r.start,r.end)==='source-two.m4a'))
  assert(refs.some(r=>r.anchor==='#heading' && text.slice(r.start,r.end)==='beta.md#heading'))
  const f=await fixture();await writeFile(path.join(f.root,'20-知识笔记/anchor.md'),'# Test\n[doc](beta.md#absent)\n');f.wb.invalidate()
  const issue=(await f.call({op:'links.issues'})).items.find(i=>i.reason==='anchor-missing')
  assert(issue)
  const p=await f.call({op:'links.preview',changes:[{id:issue.id,target:'20-知识笔记/beta.md'}]})
  assert(p.files[0].after.includes('[doc](beta.md)'));assert(p.files[0].after.startsWith('# Test'))
})
