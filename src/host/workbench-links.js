import path from 'node:path'
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { digest, fail, safePath, atomicJson, readJson, locked } from './workbench-state.js'

export function extractReferences(text) {
  const clean = text.replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3[^\n]*(?=\n|$)/g, m => m.replace(/[^\n]/g, ' ')).replace(/`+[^`\n]*`+/g, m => ' '.repeat(m.length))
  const refs = []
  const pattern = /\[\[([^\]\n]+)\]\]|\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)|^(source(?:_\d+)?|see_also|related_notes):[ \t]*(.+)$/gm
  for (const m of clean.matchAll(pattern)) {
    const raw = m[1] ?? m[2] ?? m[4]
    const values = m[4] ? [...raw.matchAll(/[^,\[\]]+/g)].map(x => ({ raw: x[0], at: x.index })) : [{ raw, at: 0 }]
    for (const value of values) {
      const target = value.raw.trim().replace(/\s+["'].*["']$/, '').replace(/^['"<]|['">]$/g, '').split('|')[0].trim()
      if (!target || target.startsWith('#') || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const rawAt = m[1] ? 2 : m[2] ? m[0].lastIndexOf('](') + 2 : m[0].indexOf(':') + 1 + m[0].slice(m[0].indexOf(':') + 1).indexOf(raw)
      const start = m.index + rawAt + value.at + value.raw.indexOf(target)
      refs.push({ target: target.split('#')[0], rawTarget: target, anchor: target.includes('#') ? target.slice(target.indexOf('#')) : '', wiki: Boolean(m[1]), type: m[3]?.startsWith('source') ? 'source' : 'reference', line: clean.slice(0, start).split('\n').length, start, end: start + target.length })
    }
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(clean)
  if (frontmatter) {
    let active = '', offset = clean.indexOf('\n') + 1
    for (const line of frontmatter[1].split('\n')) {
      const key = /^([a-z_\d]+):/.exec(line)
      if (key) active = /^(source(?:_\d+)?|see_also|related_notes)$/.test(key[1]) ? key[1] : ''
      const item = active && /^\s+-\s+(.+?)\s*$/.exec(line)
      if (item) {
        const target = item[1].replace(/^['"]|['"]$/g, '')
        if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target)) { const start=offset+line.indexOf(target); refs.push({target:target.split('#')[0],rawTarget:target,anchor:target.includes('#')?target.slice(target.indexOf('#')):'',wiki:false,type:active.startsWith('source')?'source':'reference',line:clean.slice(0,start).split('\n').length,start,end:start+target.length}) }
      }
      offset += line.length + 1
    }
  }
  return refs
}

// Parse local HTML anchors without executing markup; retain exact edit offsets.
export function extractHtmlReferences(text) {
  const clean = text.replace(/<!--[\s\S]*?-->|<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, m => m.replace(/[^\n]/g, ' '))
  const refs = []
  for (const tag of clean.matchAll(/<a\b[^>]*>/gi)) {
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0])
    if (!href) continue
    const target = href[1] ?? href[2] ?? href[3]
    if (!target || target.startsWith('#') || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    const start = tag.index + href.index + href[0].indexOf('=') + 1 + href[0].slice(href[0].indexOf('=') + 1).indexOf(target)
    refs.push({ target: target.split('#')[0], rawTarget: target, anchor: target.includes('#') ? target.slice(target.indexOf('#')) : '', wiki: false, type: 'reference', line: text.slice(0, start).split('\n').length, start, end: start + target.length })
  }
  return refs
}

export async function collectRelations({ files, readText, visible, links, type }) {
  const paths = new Set(files.map(f => f.path)), names = new Map(), edges = [], issues = [], seen = new Set()
  for (const f of files) for (const n of new Set([path.posix.basename(f.path), path.posix.basename(f.path, path.posix.extname(f.path)), f.title])) {
    const k = n.toLowerCase(); names.set(k, [...(names.get(k) || []), f.path])
  }
  const add = e => { const k = [e.from, e.to, e.type].join('|'); if (!seen.has(k)) { seen.add(k); edges.push({ ...e, id: e.id || digest(k).slice(0, 20) }) } }
  if (type === 'directory') for (const f of files) { const parent = path.posix.dirname(f.path); if (parent !== '.') add({ from: parent, to: f.path, type: 'directory', evidence: '实际目录' }) }
  for (const f of files.filter(f => /\.(md|html?)$/i.test(f.path))) {
    const content = await readText(f.path).catch(() => null)
    if (!content) continue
    for (const ref of (/\.html?$/i.test(f.path) ? extractHtmlReferences(content.text) : extractReferences(content.text))) {
      let decoded
      try { decoded = decodeURIComponent(ref.target).replaceAll('\\', '/') } catch { decoded = ref.target }
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), decoded)).replace(/\/$/, ''), root = path.posix.normalize(decoded).replace(/\/$/, '')
      const exact = [relative, relative + '.md'].filter(p => paths.has(p))
      const roots = [root, root + '.md'].filter(p => paths.has(p))
      const candidates = [...new Set(exact.length ? exact : roots.length ? roots : (names.get(decoded.toLowerCase()) || []))]
      if (!visible(relative) || !visible(root) || candidates.some(p => !visible(p))) continue
      let anchorMissing = false
      if (candidates.length === 1 && ref.anchor && candidates[0].endsWith('.md')) {
        const target = await readText(candidates[0]).catch(()=>null)
        if (target) {
          let anchor=ref.anchor.slice(1);try{anchor=decodeURIComponent(anchor)}catch{}
          const slug = s => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-')
          const ids=[...target.text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m=>slug(m[1]))
          anchorMissing = /^L\d+(?:-L\d+)?$/.test(anchor) ? Number(anchor.slice(1).split('-')[0])>target.text.split('\n').length : !ids.includes(anchor.toLowerCase()) && !target.text.includes('id="'+anchor+'"') && !target.text.includes("id='"+anchor+"'")
        }
      }
      if (candidates.length === 1 && !anchorMissing) add({ from: f.path, to: candidates[0], type: ref.type, line: ref.line, evidence: '第 ' + ref.line + ' 行' })
      else {
        const id = digest([f.path, ref.start, ref.rawTarget].join('|')).slice(0, 24)
        const hints = [...names.entries()].filter(([k]) => k.includes(path.posix.basename(decoded).replace(/\.md$/, '').toLowerCase())).flatMap(([, v]) => v)
        issues.push({ ...ref, id, path: f.path, revision: content.revision, context: content.text.split('\n')[ref.line - 1]?.slice(0, 1000), candidates: candidates.length ? candidates : [...new Set(hints)].slice(0, 12), reason: anchorMissing ? 'anchor-missing' : candidates.length > 1 ? 'ambiguous' : 'unresolved' })
      }
    }
  }
  for (const link of links) {
    if (!visible(link.from) || !visible(link.to)) continue
    if (paths.has(link.from) && paths.has(link.to)) add({ ...link, type: 'manual', evidence: link.note || '手动关联' })
    else issues.push({ id: link.id, manual: true, path: paths.has(link.from) ? link.from : link.to, missing: paths.has(link.from) ? 'to' : 'from', rawTarget: paths.has(link.from) ? link.to : link.from, reason: 'manual-target-missing', candidates: [], context: link.note || '', revision: digest(JSON.stringify(link)) })
  }
  return { edges, issues }
}

export function createRepairService({ binding, versionOf, relations, userData, mutate, assertVisible, redactReferences, textOf, stateDir, now }) {
  const previews = new Map(), requests = new Map()
  async function graph(b) {
    const g = await relations(b, { allIssues: true, includeArchive: true, includeNavigation: true }), data = await userData(b)
    for (const r of requests.values()) if (r.key === b.key && r.version === versionOf(b) && r.expires > now()) for (const issue of r.issues.filter(i => i.newRelation && r.proposals.some(p => p.id === i.id))) {
      if (!data.links.some(l => l.id === issue.id)) g.issues.push({ ...issue, candidates: [...new Set([...issue.candidates, ...r.proposals.filter(p => p.id === issue.id).map(p => p.target)])] })
    }
    return g
  }
  const stateFile = b => path.join(stateDir, 'workbench', 'repair-' + b.key + '.json')
  async function replace(b, item, from, to) {
    const file = await safePath(b.root, item.path), bytes = await readFile(file)
    if (digest(bytes) !== from) throw fail('FILE_CHANGED', '原文件已改变，请重新生成预览')
    const tmp = file + '.repair-' + randomUUID()
    try { await writeFile(tmp, to, { encoding: 'utf8', flag: 'wx' }); await binding(b.st.kbId); await rename(tmp, file) } finally { await unlink(tmp).catch(() => {}) }
  }
  return { async dispatch(b, args, caller) {
    if (args.op === 'links.issues') {
      const data = await graph(b), offset = Math.max(0, Number(args.offset) || 0), limit = 30
      return { items: data.issues.slice(offset, offset + limit), total: data.issues.length, offset, limit, counts: Object.fromEntries(['unresolved', 'ambiguous', 'manual-target-missing','new-relation','anchor-missing'].map(r => [r, data.issues.filter(i => i.reason === r).length])), revision: data.revision }
    }
    if (args.op === 'links.targets') {
      const data = await graph(b), q = String(args.query || '').toLowerCase()
      return { items: data.allFiles.filter(f => f.path.toLowerCase().includes(q) || f.title.toLowerCase().includes(q)).slice(0, 30).map(f => ({ path: f.path, title: f.title })) }
    }
    if (args.op === 'links.ai.create') {
      const g = await graph(b), selected = g.issues.filter(i => (args.ids || []).includes(i.id)).slice(0, 20)
      if (args.focus) {
        assertVisible(b, args.focus)
        const file = g.allFiles.find(f => f.path === args.focus && f.layer !== 'directory')
        if (!file) throw fail('NOT_FOUND', '中心资料不存在')
        const words = [...new Set((file.title.match(/[\u4e00-\u9fff]{2,}|[a-z]{3,}/gi) || []).flatMap(w => w.length > 2 ? Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)) : [w]))]
        const candidates = g.allFiles.filter(f => f.path !== args.focus && f.layer !== 'directory' && !/(^|\/)(_archive|INDEX\.md|AGENTS\.md)/.test(f.path)).map(f => ({path:f.path,score:words.filter(w => f.title.includes(w) || f.path.includes(w)).length})).sort((a,b)=>b.score-a.score).slice(0,20).map(f=>f.path)
        selected.push({id:'new-'+randomUUID(),path:args.focus,newRelation:true,manual:true,reason:'new-relation',rawTarget:'尚未建立关联',context:'比较原文，只建议有依据的新关联；没有合适目标时不要提交。',candidates})
      }
      if (!selected.length || !args.sessionId) throw fail('BAD_REQUEST', '请选择问题链接及接收会话')
      const requestId = randomUUID()
      requests.set(requestId, { key: b.key, version: versionOf(b), sessionId: args.sessionId, expires: now() + 3600000, issues: selected, proposals: [] })
      return { requestId }
    }
    if (args.op === 'links.ai.latest') {
      const entries = [...requests.entries()].filter(([,r])=>r.key===b.key && r.version===versionOf(b) && r.expires>now())
      return { requestId: entries.at(-1)?.[0] || '' }
    }
    if (args.op === 'links.ai.status' || args.op === 'links.ai.inspect' || args.op === 'links.ai.propose' || args.op === 'links.ai.read') {
      const r = requests.get(args.requestId)
      if (!r || r.key !== b.key || r.version !== versionOf(b) || r.expires < now()) throw fail('REQUEST_EXPIRED', '修复讨论已过期')
      if (args.op !== 'links.ai.status' && (!caller || r.sessionId !== caller)) throw fail('SESSION_MISMATCH', '修复请求只能由指定会话读取')
      for (const issue of r.issues) assertVisible(b, issue.path)
      if (args.op === 'links.ai.read') {
        if (!r.issues.some(i => i.path === args.path || i.candidates.includes(args.path))) throw fail('SOURCE_DENIED', '只允许读取本次讨论的资料与候选')
        assertVisible(b, args.path)
        const content = await textOf(b, args.path)
        return {path:args.path,revision:content.revision,text:redactReferences(b,args.path,content.text).slice(0,6000),truncated:content.text.length>6000}
      }
      if (args.op === 'links.ai.propose') {
        const g = await graph(b)
        r.proposals = (args.proposals || []).slice(0, 20).map(p => {
          if (!r.issues.some(i => i.id === p.id && i.path !== p.target) || !g.allFiles.some(f => f.path === p.target)) throw fail('INVALID_PROPOSAL', '建议目标不存在或超出本次请求')
          return { id: p.id, target: p.target, reason: String(p.reason || '').slice(0, 1000) }
        })
      }
      return { issues: r.issues, proposals: r.proposals, readOnly: true }
    }
    if (args.op === 'links.preview') {
      const g = await graph(b), selected = args.changes || []
      if (!selected.length || selected.length > 100) throw fail('BAD_CHANGES', '请选择 1–100 项修复')
      const groups = new Map(), manual = [], ids = new Set()
      for (const change of selected) {
        if (ids.has(change.id)) throw fail('DUPLICATE_CHANGE', '同一问题不能重复修复'); ids.add(change.id)
        const issue = g.issues.find(i => i.id === change.id)
        if (!issue || !g.allFiles.some(f => f.path === change.target)) throw fail('ISSUE_CHANGED', '问题或目标已改变，请刷新')
        assertVisible(b, issue.path); assertVisible(b, change.target)
        if (issue.manual) { manual.push({ issue, target: change.target }); continue }
        const content = await readFile(await safePath(b.root, issue.path), 'utf8')
        let group = groups.get(issue.path)
        if (!group) { group = { path: issue.path, before: content, revision: digest(content), edits: [] }; groups.set(issue.path, group) }
        const target = path.posix.relative(path.posix.dirname(issue.path), change.target) + (issue.reason === 'anchor-missing' ? '' : issue.anchor)
        group.edits.push({ ...issue, target, targetPath: change.target })
      }
      const files = [...groups.values()].map(g => { let after = g.before; for (const edit of g.edits.sort((a, z) => z.start - a.start)) after = after.slice(0, edit.start) + edit.target + after.slice(edit.end); return { ...g, after } })
      const changes = files.flatMap(file => file.edits.map(edit => ({ id: edit.id, kind: 'file-link', sourcePath: file.path, targetPath: edit.targetPath, line: edit.line, type: edit.type, reason: edit.reason, rawTarget: edit.rawTarget, target: edit.target, context: redactReferences(b, file.path, edit.context || '') }))).concat(manual.map(({ issue, target }) => ({
        id: issue.id, kind: issue.newRelation ? 'new-relation' : 'manual-link', sourcePath: issue.path, targetPath: target, line: issue.line || null,
        type: 'manual', reason: issue.reason, rawTarget: issue.rawTarget || '', target,
        beforeFrom: issue.newRelation ? '' : issue.missing === 'from' ? issue.rawTarget : issue.path,
        beforeTo: issue.newRelation ? '' : issue.missing === 'to' ? issue.rawTarget : issue.path,
        afterFrom: issue.newRelation ? issue.path : issue.missing === 'from' ? target : issue.path,
        afterTo: issue.newRelation ? target : issue.missing === 'to' ? target : issue.path,
        context: redactReferences(b, issue.path, issue.context || '')
      })))
      const previewId = randomUUID(), data = await userData(b)
      previews.set(previewId, { key: b.key, version: versionOf(b), expires: now() + 600000, files, manual, changes, revision: data.revision })
      return { previewId, revision: data.revision, files: files.map(f => ({ path: f.path, before: redactReferences(b, f.path, f.before), after: redactReferences(b, f.path, f.after) })), manual, changes, count: selected.length }
    }
    if (args.op === 'links.apply' || args.op === 'links.undo' || args.op === 'links.history') return locked(stateFile(b), async () => {
      const history = await readJson(stateFile(b), { items: [] })
      if (args.op === 'links.history') return { items: history.items.filter(i => !i.failed && [...i.files.map(f=>f.path), ...(i.manual||[]).flatMap(m=>[m.issue.path,m.target]), ...(i.changes||[]).flatMap(c=>[c.sourcePath,c.targetPath,c.beforeFrom,c.beforeTo,c.afterFrom,c.afterTo])].filter(Boolean).every(p => { try { assertVisible(b, p); return true } catch { return false } })).map(i => ({ id: i.id, at: i.at, undone: i.undone, pending: i.pending, paths: [...new Set([...i.files.map(f => f.path), ...(i.manual||[]).flatMap(m => [m.issue.path,m.target]), ...(i.changes||[]).flatMap(c => [c.sourcePath,c.targetPath,c.beforeFrom,c.beforeTo,c.afterFrom,c.afterTo])].filter(Boolean))], changes: i.changes || [], count: i.changes?.length || i.manual?.length || 0, fileCount: i.files.length, relationCount: i.manual?.length || 0 })) }
      if (args.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', '请确认目标知识库')
      if (args.op === 'links.apply') {
        const p = previews.get(args.previewId)
        if (!p || p.key !== b.key || p.version !== versionOf(b) || p.expires < now()) throw fail('PREVIEW_EXPIRED', '修复预览已过期，请重新生成')
        const data = await userData(b)
        if (data.revision !== p.revision) throw fail('CONFLICT', '关联记录已改变，请重新预览')
        for (const f of p.files) { assertVisible(b, f.path); if (digest(await readFile(await safePath(b.root, f.path))) !== f.revision) throw fail('FILE_CHANGED', '文件已改变，未应用修复') }
        const record = { id: randomUUID(), at: new Date(now()).toISOString(), files: p.files.map(f => ({ path: f.path, before: f.before, after: f.after })), manual: p.manual, changes: p.changes, pending: true }
        history.items.push(record); await atomicJson(stateFile(b), history)
        const written = []
        try {
          for (const f of p.files) { await replace(b, f, f.revision, f.after); written.push(f) }
          if (p.manual.length) await mutate(b, { ...args, expectedRevision: p.revision }, async d => {
            for (const { issue, target } of p.manual) {
              if (issue.newRelation) { if (d.links.some(l=>l.id===issue.id)) throw fail('CONFLICT','关联已建立'); d.links.push({id:issue.id,from:issue.path,to:target,note:'AI 建议，经用户预览确认',createdAt:new Date(now()).toISOString()}); continue }
              const link = d.links.find(l => l.id === issue.id); if (!link || digest(JSON.stringify(link)) !== issue.revision) throw fail('CONFLICT', '手动关联已改变'); link[issue.missing] = target
            }
            return {}
          })
        } catch (error) { for (const f of written.reverse()) await replace(b, f, digest(f.after), f.before); record.failed = true; record.pending = false; await atomicJson(stateFile(b), history); throw error }
        record.pending = false; await atomicJson(stateFile(b), history); previews.delete(args.previewId)
        return { repairId: record.id, applied: p.changes.length, fileCount: p.files.length, relationCount: p.manual.length, affectedPaths: [...new Set(p.changes.flatMap(c => [c.sourcePath, c.targetPath, c.beforeFrom, c.beforeTo, c.afterFrom, c.afterTo]).filter(Boolean))] }
      }
      const item = history.items.find(i => i.id === args.repairId && !i.undone && !i.failed)
      if (!item) throw fail('NOT_FOUND', '可撤销记录不存在')
      for (const f of item.files) { assertVisible(b, f.path); const current = digest(await readFile(await safePath(b.root, f.path))); if (current !== digest(f.after) && !(item.pending && current === digest(f.before))) throw fail('FILE_CHANGED', '修复后文件又被修改，请手动比较恢复') }
      const data = await userData(b)
      for (const { issue, target } of item.manual) { const link=data.links.find(l=>l.id===issue.id); if (issue.newRelation ? !link || link.from!==issue.path || link.to!==target : link?.[issue.missing] !== target) throw fail('CONFLICT', '手动关联已再次改变') }
      for (const f of item.files) if (digest(await readFile(await safePath(b.root, f.path))) !== digest(f.before)) await replace(b, f, digest(f.after), f.before)
      if (item.manual.length) await mutate(b, { ...args, expectedRevision: data.revision }, async d => { for (const { issue } of item.manual) { if(issue.newRelation) d.links=d.links.filter(l=>l.id!==issue.id); else d.links.find(l => l.id === issue.id)[issue.missing] = issue.rawTarget }; return {} })
      item.undone = true; await atomicJson(stateFile(b), history)
      return { undone: item.id }
    })
    throw fail('UNKNOWN_REPAIR', '未知修复操作')
  } }
}
