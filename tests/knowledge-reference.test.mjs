import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

test('knowledge mention stays compact on send and renders through native sent-user-text slot',async()=>{
 const code=await readFile(new URL('../src/client/workbench-ui.js',import.meta.url),'utf8')
 const e=(type,props,...children)=>({type,props,children}),factory=vm.runInNewContext(code+'\ncreateWorkbenchUI',{console,window:{},document:{},setTimeout,clearTimeout})
 const id='12345678-1234-4234-8234-123456789abc',registered=[],rules=[],calls=[]
 const ui=factory({react:{},e,api:async a=>{calls.push(a);return {ok:true,label:'基于知识库回答（不含隐私）',questionId:id}}})
 let source
 const services={uiConversation:{userText:{register:r=>{rules.push(r);return ()=>{}}}},slots:{inject:(name,fn)=>fn(),register:(spec,C)=>registered.push({spec,C})},inputTriggers:{registerSource:s=>{source=s;return ()=>{}}}}
 const ctx={get:name=>services[name],inject:(deps,fn)=>deps.every(d=>services[d])?fn(ctx):undefined,effect:fn=>fn()}
 ui.registerReferences(ctx)
 const pick=source.onPick({candidate:{value:JSON.stringify({sessionId:'session',kbId:'kb',policyVersion:'p',includePrivate:false,allowed:true})}})
 const text=await source.codec.serialize(pick.insert.ref,new AbortController().signal)
 assert.equal(text,`@[基于知识库回答（不含隐私）](dsh-kb:${id})`);assert(!text.includes('请用'));assert.equal(calls[0].sessionId,'session')
 assert.equal(rules.length,1);assert.equal(registered[0].spec.name,'conversation.user.text.node')
 const original='前面的问题 '+text+' 后面的内容',node=rules[0].match(original,0)
 assert.equal(original.slice(0,node.start),'前面的问题 ');assert.equal(original.slice(node.end),' 后面的内容');assert.equal(node.data.questionId,id)
 assert.equal(rules[0].match(original,node.end),undefined)
 const chip=registered[0].C({node});assert.equal(chip.props['data-kb-reference'],true);assert(!JSON.stringify(chip).includes(id));assert(!JSON.stringify(chip).includes('kb_question_search'))
 const tail='请用 kb_question_search 检索、kb_question_read 按需读取；引用时原样复制来源的 citation 字段（[S编号](<来源链接>)），不要自行拼接路径，并用 kb_validate_citations 校验。若有 invalid，修正引用后再回答。'
 const legacy=`基于知识库回答（不含隐私），引用 ${id}。`+tail
 const old=rules[0].match(legacy+'\n我的问题',0);assert(old);assert.equal(old.end,legacy.length)
 assert.equal(rules[0].match('讨论基于知识库回答，没有任何内部引用参数。',0),undefined)
 assert.equal(rules[0].match('@[基于知识库回答（不含隐私）](dsh-kb:bad-id)',0),undefined)
})
