import { randomUUID } from 'node:crypto'
import { fail } from './workbench-state.js'

// The reference carries no evidence. Evidence enters the turn only through tools.
export function createQuestionService({ binding, versionOf, visible, list, textOf, redactReferences, now }) {
  const contexts = new Map()
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
    s.ranges.push({ line, endLine: line + text.split('\n').length - 1 })
    const url = s.url + '#L' + line
    // Angle brackets keep Windows paths with spaces valid as Markdown destinations.
    const citation = `[${s.id}](<${url}>)`
    return { id: s.id, path: s.path, title: s.title, revision: s.revision, line, url, citation, text: redactReferences(b, file.path, text, q.includePrivate) }
  }
  return {
    clear: () => contexts.clear(),
    async dispatch(b, args, caller) {
      if (args.op === 'question.create') {
        if (!args.sessionId || typeof args.sessionId !== 'string') throw fail('SESSION_REQUIRED', '缺少提问会话')
        if (args.policyVersion !== versionOf(b)) throw fail('SETTINGS_CHANGED', '知识库设置已改变，请重新选择')
        if (args.includePrivate && (!b.preferences.showPrivate || !b.preferences.allowPrivateQuestions)) throw fail('PRIVATE_DENIED', '请先在知识库设置中允许隐私提问')
        for (const [id, q] of contexts) if (q.expires < now()) contexts.delete(id)
        if (contexts.size >= 500) throw fail('TOO_MANY_QUESTIONS', '待处理的知识库问题过多，请稍后重试')
        const questionId = randomUUID()
        contexts.set(questionId, { sessionId: args.sessionId, key: b.key, policy: versionOf(b), includePrivate: args.includePrivate === true, sources: [], expires: now() + 24 * 3600000 })
        return { questionId, label: '基于知识库回答（' + (args.includePrivate ? '含隐私' : '不含隐私') + '）' }
      }
      const q = await context(b, args, caller)
      if (args.op === 'question.search') {
        let query = String(args.query || '').trim().slice(0, 1000)
        if (!query) throw fail('QUERY_REQUIRED', '请输入检索词')
        const today = new Date(now() + 8 * 3600000).toISOString().slice(0, 10)
        const yesterday = new Date(now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10)
        query = query.replaceAll('昨天', yesterday).replaceAll('今天', today)
        const dates = query.match(/\d{4}-\d{2}-\d{2}/g) || []
        const results = await list(b, { q: query, mode: 'body', question: true, includePrivate: q.includePrivate, limit: 500 })
        let files = results.items.filter(f => visible(b, f.path, true, q.includePrivate))
        if (dates.length) files = files.filter(f => dates.some(d => f.path.includes(d) || f.title.includes(d)))
        const sources = []; let remaining = 6000
        for (const f of files.slice(0, 5)) {
          const content = await textOf(b, f.path, 8 * 1024 * 1024)
          const words = query.match(/[a-z0-9-]+|[\u4e00-\u9fff]{2,}/gi) || []
          const at = Math.max(0, ...words.map(w => content.text.indexOf(w)).filter(i => i >= 0))
          const start = Math.max(0, content.text.lastIndexOf('\n', Math.max(0, at - 160)) + 1)
          const hit = source(q, b, f, content, start, Math.min(content.text.length, start + Math.min(1200, remaining)))
          remaining -= hit.text.length; sources.push(hit)
        }
        await context(await binding(b.st.kbId), args, caller)
        return { questionId: args.questionId, sources, normalizedQuery: query, currentDate: today, timezone: 'Asia/Shanghai', coverageNote: results.coverageNote, more: files.length > 5 }
      }
      if (args.op === 'question.read') {
        const s = q.sources.find(s => s.id === args.sourceId)
        if (!s || !visible(b, s.path, true, q.includePrivate)) throw fail('SOURCE_DENIED', '请先检索该来源')
        const content = await textOf(b, s.path, 8 * 1024 * 1024)
        if (s.revision !== content.revision) throw fail('FILE_CHANGED', '来源已改变，请重新提问')
        const lines = content.text.split('\n'), line = Math.max(1, Math.floor(Number(args.line) || 1))
        if (line > lines.length) throw fail('LINE_OUT_OF_RANGE', '行号超出来源范围')
        const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
        const out = source(q, b, s, content, start, Math.min(content.text.length, start + 6000))
        await context(await binding(b.st.kbId), args, caller)
        return { questionId: args.questionId, source: out, truncated: start + 6000 < content.text.length }
      }
      if (args.op === 'question.validate') {
        const valid = [], invalid = [], answer = String(args.answer || '')
        for (const id of new Set([...answer.matchAll(/\[(S\d+)\]/g)].map(m => m[1]))) {
          const s = q.sources.find(s => s.id === id)
          const content = s && visible(b, s.path, true, q.includePrivate) ? await textOf(b, s.path, 8 * 1024 * 1024).catch(() => null) : null
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
          else valid.push({ id, path: s.path, url: s.url, ranges: s.ranges })
        }
        await context(await binding(b.st.kbId), args, caller)
        return { valid, invalid, missingCitations: valid.length + invalid.length === 0 }
      }
      throw fail('BAD_QUESTION_OPERATION', '未知问答操作')
    },
  }
}
