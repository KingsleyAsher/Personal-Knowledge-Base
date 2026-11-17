import { randomUUID } from 'node:crypto'

const SOURCE = 'kb:citation-repair'
const body = message => (message?.content || []).filter(b=>b.type==='text').map(b=>b.text).join('\n')

// This hook runs after streamed text is committed. It requests one correction,
// never rewrites the answer or fabricates claim-to-source associations.
export function createCitationGuard({ validate, log = () => {} }) {
  const running = new WeakSet()
  return async function guard(payload) {
    const agent = payload?.agent
    if (!agent?.session || typeof agent.inject !== 'function' || running.has(agent)) return
    const session=agent.session,events=session.snapshotEvents?.()||[]
    const start=events.findLastIndex(e=>e.type==='turn/start'&&e.data?.turn===payload.turn)
    if(start<0)return
    const turn=events.slice(start+1)
    if(turn.some(e=>e.type==='user/message'&&e.data?.source?.kind===SOURCE))return
    const user=turn.filter(e=>e.type==='user/message'&&e.data?.source?.kind==='user').at(-1)
    const match=body(user?.data).match(/@\[基于知识库回答（(?:含隐私|不含隐私)）\]\(dsh-kb:([a-f0-9-]{36})\)/u)
    if(!match)return
    const last=turn.filter(e=>e.type==='assistant/message').at(-1)
    if(!last||last.data?.message?.interrupted)return
    const answer=body(last.data.message)
    if(!answer.trim())return
    running.add(agent)
    try {
      payload.signal?.throwIfAborted()
      const result=await validate({op:'question.validate',questionId:match[1],answer,returnAnswer:false},agent.id)
      payload.signal?.throwIfAborted()
      const called=turn.some(e=>e.type==='tool/call'&&e.data?.name==='kb_validate_citations'&&e.data?.arguments?.questionId===match[1])
      if(!result.missingCitations&&!result.invalid?.length&&called)return
      const reason=result.missingCitations?'最终回答缺少可点击来源链接':result.invalid?.length?'最终回答有无效或过期来源链接':'本轮未执行引用和证据审查'
      agent.inject({id:randomUUID(),role:'user',source:{kind:SOURCE,form:'repair',turn:payload.turn},content:[{type:'text',text:`知识库输出检查：${reason}。questionId=${match[1]}。请针对本次答案修正：将实际支撑事实的 source.citation 原样加入草稿，并调用 kb_validate_citations 审查后输出保留链接的更正版。已有证据充分时不要重新全库检索；上下文丢失或来源过期才定向补取。没有足够证据则明确说明，不能编造来源。检索流程不能代替来源引用。本轮只自动请求这一次修正。`}]})
    } catch(error) {
      if(payload.signal?.aborted)return
      // Context expired / revoked permissions must not be bypassed by a guard.
      log('知识库最终引用检查未完成：'+(error.code||'CHECK_FAILED'))
    } finally { running.delete(agent) }
  }
}
