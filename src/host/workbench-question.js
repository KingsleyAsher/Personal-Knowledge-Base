import { randomUUID } from 'node:crypto'
import { fail } from './workbench-state.js'
import { retrievalDisclosure } from './retrieval.js'
import { byteSlice, bytes } from './retrieval-chunks.js'

// The reference carries no evidence. Evidence enters the turn only through tools.
export function createQuestionService({ binding, versionOf, visible, list, textOf, redactReferences, now, search }) {
  const contexts = new Map()
  const reviewOf=input=>{
    if(input===undefined)return null
    if(!input||!['sufficient','insufficient','uncertain'].includes(input.coverage)||!Array.isArray(input.gaps)||!Array.isArray(input.conflicts)||[...input.gaps,...input.conflicts].some(x=>typeof x!=='string'||x.length>2000))throw fail('BAD_REVIEW','证据审查必须包含 coverage、gaps 与 conflicts')
    return {coverage:input.coverage,gaps:input.gaps,conflicts:input.conflicts}
  }
  async function context(b, args, caller) {
    const q = contexts.get(args.questionId)
    if (!q || q.key !== b.key || q.policy !== versionOf(b) || q.expires < now()) throw fail('CONTEXT_EXPIRED', '知识库引用已过期或设置已改变，请重新选择')
    if (!caller || caller !== q.sessionId) throw fail('SESSION_MISMATCH', '知识库引用只能在原会话使用')
    if (q.includePrivate && (!b.preferences.showPrivate || !b.preferences.allowPrivateQuestions)) throw fail('PRIVATE_DENIED', '隐私提问权限已关闭')
    return q
  }
  function source(q, b, file, content, start, end) {
    let s = q.sources.find(s => s.path === file.path)
    if (s && s.revision !== content.revision) throw fail('FILE_CHANGED', '来源已改变，请重新选择知识库提问')
    if (!s) { s = { id: 'S' + (q.sources.length + 1), path: file.path, title: file.title, revision: content.revision, url: b.root.replaceAll('\\', '/') + '/' + file.path, ranges: [] }; q.sources.push(s) }
    const text = content.text.slice(start, end)
    const line = content.text.slice(0, start).split('\n').length
    const endLine=line+text.split('\n').length-1
    if(!s.ranges.some(r=>r.line===line&&r.endLine===endLine))s.ranges.push({line,endLine})
    const url = s.url + '#L' + line
    // Angle brackets keep Windows paths with spaces valid as Markdown destinations.
    const citation = `[${s.id}](<${url}>)`
    return { id: s.id, path: s.path, title: s.title, revision: s.revision, line, url, citation, text: redactReferences(b, file.path, text, q.includePrivate) }
  }
  const lanes = new Map()
  async function dispatch(b, args, caller) {
      if (args.op === 'question.create') {
        if (!args.sessionId || typeof args.sessionId !== 'string') throw fail('SESSION_REQUIRED', '缺少提问会话')
        if (args.policyVersion !== versionOf(b)) throw fail('SETTINGS_CHANGED', '知识库设置已改变，请重新选择')
        if (args.includePrivate && (!b.preferences.showPrivate || !b.preferences.allowPrivateQuestions)) throw fail('PRIVATE_DENIED', '请先在知识库设置中允许隐私提问')
        for (const [id, q] of contexts) if (q.expires < now()) contexts.delete(id)
        if (contexts.size >= 500) throw fail('TOO_MANY_QUESTIONS', '待处理的知识库问题过多，请稍后重试')
        if(args.protocolVersion!==undefined&&![1,2].includes(args.protocolVersion))throw fail('BAD_PROTOCOL','不支持的问答协议')
        const questionId = randomUUID()
        contexts.set(questionId, { sessionId: args.sessionId,protocolVersion:args.protocolVersion||1, key: b.key, policy: versionOf(b), includePrivate: args.includePrivate === true, sources: [], retrievalRuns: [], expires: now() + 24 * 3600000 })
        return { questionId,protocolVersion:args.protocolVersion||1, label: '基于知识库回答（' + (args.includePrivate ? '含隐私' : '不含隐私') + '）' }
      }
      const q = await context(b, args, caller)
      if (args.op === 'question.search') {
        let query = String(args.query || '').trim().slice(0, 1000)
        if (!query) throw fail('QUERY_REQUIRED', '请输入检索词')
        const today = new Date(now() + 8 * 3600000).toISOString().slice(0, 10)
        const yesterday = new Date(now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10)
        query = query.replaceAll('昨天', yesterday).replaceAll('今天', today)
        const results = search ? await search(b, { query, question: true, includePrivate: q.includePrivate, limit: 5,signal:args.signal }) : await list(b, { q: query, mode: 'body', question: true, includePrivate: q.includePrivate, limit: 500 })
        if(results.retrievalTrace)q.retrievalRuns.push(results.retrievalTrace)
        let files = results.items.filter(f => visible(b, f.path, true, q.includePrivate))
        const sources = [],contents=new Map(); let remaining = 48 * 1024
        for (const f of files.slice(0, 5)) {
          if(!contents.has(f.path))contents.set(f.path,textOf(b,f.path,Number.MAX_SAFE_INTEGER))
          const content = await contents.get(f.path)
          if (f.revision && f.revision !== content.revision) throw fail('FILE_CHANGED', '来源已改变，请重新检索')
          const words = query.match(/[a-z0-9-]+|[\u4e00-\u9fff]{2,}/gi) || []
          const at = Math.max(0, ...words.map(w => content.text.indexOf(w)).filter(i => i >= 0))
          const start = f.start ?? Math.max(0, content.text.lastIndexOf('\n', Math.max(0, at - 160)) + 1)
          const excerpt = byteSlice(content.text.slice(start, f.end ?? start + 1200), Math.min(12 * 1024, remaining))
          if (!excerpt) break
          const hit = source(q, b, f, content, start, start + excerpt.length)
          remaining -= bytes(excerpt); sources.push({ ...hit, headings: f.headings || [], more: f.more ?? true, channels: f.channels || ['fulltext'] })
        }
        for(const s of new Map(sources.map(s=>[s.path,s])).values()){const live=await textOf(b,s.path,Number.MAX_SAFE_INTEGER);if(live.revision!==s.revision)throw fail('FILE_CHANGED','来源已改变，请重新检索')}
        await context(await binding(b.st.kbId), args, caller)
        return { questionId: args.questionId, sources,hint:'最终回答中的知识库事实必须附上对应来源的 citation 可点击链接，原样复制，不用纯路径或检索流程说明代替。先在答案草稿中写入引用，再调用 kb_validate_citations；通过后保留这些链接输出。证据覆盖关键条件且无冲突时完成一次审查即可回答；有具体缺口或冲突才补查。不以相似度或缓存命中证明答案正确。', normalizedQuery: query, currentDate: today, timezone: 'Asia/Shanghai', retrievalTrace:results.retrievalTrace,retrievalDisclosure:results.retrievalDisclosure,coverageNote: results.coverageNote, more: results.more ?? files.length > 5 }
      }
      if (args.op === 'question.read') {
        const s = q.sources.find(s => s.id === args.sourceId)
        if (!s || !visible(b, s.path, true, q.includePrivate)) throw fail('SOURCE_DENIED', '请先检索该来源')
        const content = await textOf(b, s.path, Number.MAX_SAFE_INTEGER)
        if (s.revision !== content.revision) throw fail('FILE_CHANGED', '来源已改变，请重新提问')
        const lines = content.text.split('\n'), line = Math.max(1, Math.floor(Number(args.line) || 1))
        if (line > lines.length) throw fail('LINE_OUT_OF_RANGE', '行号超出来源范围')
        const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
        const out = source(q, b, s, content, start, Math.min(content.text.length, start + 6000))
        await context(await binding(b.st.kbId), args, caller)
        q.readOriginal=true
        return { questionId: args.questionId, source: out, truncated: start + 6000 < content.text.length }
      }
      if (args.op === 'question.validate') {
        const valid = [], invalid = [], answer = String(args.answer || ''),review=reviewOf(args.review),contents=new Map()
        for (const id of new Set([...answer.matchAll(/\[(S\d+)\]/g)].map(m => m[1]))) {
          const s = q.sources.find(s => s.id === id)
          if(s&&visible(b,s.path,true,q.includePrivate)&&!contents.has(s.path))contents.set(s.path,textOf(b,s.path,Number.MAX_SAFE_INTEGER).catch(()=>null))
          const content=s&&visible(b,s.path,true,q.includePrivate)?await contents.get(s.path):null
          const links = [...answer.matchAll(new RegExp('\\[' + id + '\\]\\((<[^>\\r\\n]*>|[^)]*)\\)', 'g'))].map(m => {
            const destination = m[1]
            const bracketed = destination.startsWith('<') && destination.endsWith('>')
            return { url: bracketed ? destination.slice(1, -1) : destination, bracketed }
          })
          const badLink = s && (links.length === 0 || links.some(({ url: link, bracketed }) => {
            const at=link.lastIndexOf('#L'), url=at<0?link:link.slice(0,at), line=at<0?NaN:Number(link.slice(at+2))
            return !bracketed || url!==s.url || !s.ranges.some(r=>line>=r.line && line<=r.endLine)
          }))
          if (!content || content.revision !== s.revision || badLink) invalid.push(id)
          else valid.push({ id, path: s.path, url: s.url, ranges: s.ranges, citations:links.map(link=>`[${id}](<${link.url}>)`) })
        }
        await context(await binding(b.st.kbId), args, caller)
        const steps=[...new Set((q.retrievalRuns||[]).flatMap(r=>r.steps))]
        if(q.readOriginal)steps.push('按需继续读取原文')
        const disclosure=retrievalDisclosure(q.retrievalRuns?.length?{runs:q.retrievalRuns,readOriginal:q.readOriginal,steps,warning:[...new Set(q.retrievalRuns.map(r=>r.warning).filter(Boolean))].join('；')}:null,b.preferences.showRetrievalProcess!==false)
        const answerWithRetrievalFooter=disclosure&&!answer.includes(disclosure.footer)?answer+'\n\n'+disclosure.footer:answer
        const missingCitations=valid.length+invalid.length===0
        const decision=invalid.length?'repair-citations':missingCitations?'insufficient-evidence':!review?'unassessed':review.coverage==='sufficient'&&!review.gaps.length&&!review.conflicts.length?'ready':'supplement-needed'
        const nextAction=missingCitations?'答案未包含来源引用。若根据知识库作答，先把实际支持该事实的 source.citation 原样写入草稿再校验；资料不足则明确说明，不能编造引用。':invalid.length?'修复 invalid 引用并重新校验；不能删除全部引用来绕过。':'最终回答保留已校验草稿中的全部有效来源链接（valid[].citations），不得只输出检索流程。新版协议不回传完整答案，使用你提交的草稿；如有 retrievalDisclosure.footer，只追加一次，不替换正文和来源链接。'
        return {valid,invalid,missingCitations,nextAction,review:{decision,assessment:review,semanticJudgment:review?'agent-reported':'not-provided',citationCheck:'program-verified'},retrievalDisclosure:disclosure,...(args.returnAnswer===true||(args.returnAnswer!==false&&q.protocolVersion===1))?{answerWithRetrievalFooter}:{}}

      }
      throw fail('BAD_QUESTION_OPERATION', '未知问答操作')
  }
  return {
    clear: () => contexts.clear(),
    dispatch(b, args, caller) {
      if (!args.questionId) return dispatch(b, args, caller)
      const key = args.questionId, previous = lanes.get(key)
      if ((previous?.count || 0) >= 8) return Promise.reject(fail('QUESTION_BUSY', '本次问题取证队列已满'))
      const entry = { count: (previous?.count || 0) + 1 }
      const pending = (previous?.pending || Promise.resolve()).catch(() => {}).then(() => dispatch(b, args, caller))
      entry.pending = pending.finally(() => { const live = lanes.get(key); if (live === entry) lanes.delete(key); else if (live) live.count-- })
      lanes.set(key, entry)
      return entry.pending
    },
  }
}
