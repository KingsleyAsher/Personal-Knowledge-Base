import path from 'node:path'
import { digest, atomicJson, readJson } from './workbench-state.js'
import { extractReferences, extractHtmlReferences } from './workbench-links.js'

const FORMAT = 1
export function parseRelationDocument(content, file) {
  const text = content.text, lines = text.split('\n')
  const slug = s => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
  return { revision: content.revision, truncated: content.truncated === true,
    refs: (/\.html?$/i.test(file) ? extractHtmlReferences(text) : extractReferences(text)).map(ref => ({ ...ref, context: lines[ref.line - 1]?.slice(0, 1000) || '' })),
    lineCount: lines.length, anchors: [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1])).concat([...text.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1])) }
}

// A profile-local, disposable index. Only references and anchor metadata are persisted.
export function createRelationIndex({ stateDir, readText, now = Date.now, notify = () => {} }) {
  const entries = new Map()
  const keyOf = b => digest(b.key + '\0' + b.root + '\0' + FORMAT)
  function entry(b) {
    const key = keyOf(b)
    if (!entries.has(key)) entries.set(key, { key, documents: null, pending: null, graph: null, status: 'empty', progress: { done: 0, total: 0 }, at: null, error: null })
    return entries.get(key)
  }
  const status = b => { const e = entry(b); return { status: e.status, updatedAt: e.at, progress: e.progress, error: e.error, revision: e.revision || null } }
  async function documents(b, files, { force = false, background = false } = {}) {
    const e = entry(b)
    if (e.pending) { if (background && !force && e.at) return e.documents; await e.pending; if (!force) return e.documents }
    const input = digest(JSON.stringify(files.map(f => [f.path, f.bytes, f.mtimeMs, f.ctimeMs])))
    if (!force && e.input === input && e.status === 'synced') return e.documents
    const file = path.join(stateDir, 'workbench', 'relations', e.key + '.json')
    if (!e.documents) {
      if (!e.loading) e.loading = (async () => {
        let disk
        try { disk = await readJson(file, null) } catch { disk = null }
        e.documents = disk?.format === FORMAT && disk.key === e.key && disk.documents && typeof disk.documents === 'object' && !Array.isArray(disk.documents) && Object.values(disk.documents).every(d => Array.isArray(d?.refs) && Array.isArray(d?.anchors) && typeof d.revision === 'string') ? disk.documents : {}
        e.at = disk?.updatedAt || null
      })()
      await e.loading
      if (e.pending) return documents(b, files, { force, background })
    }
    const previous = e.documents
    e.pending = (async () => {
      const candidates = files.filter(f => /\.(md|html?)$/i.test(f.path)), next = Object.create(null)
      e.status = 'updating'; e.error = null; e.progress = { done: 0, total: candidates.length }
      let reads = 0, changed = Object.keys(e.documents).length !== candidates.length
      try {
        for (const f of candidates) {
          const fingerprint = [f.bytes, f.mtimeMs, f.ctimeMs].join('|'), old = e.documents[f.path]
          if (!force && old?.fingerprint === fingerprint) next[f.path] = old
          else {
            const content = await readText(b, f.path); reads++
            next[f.path] = { fingerprint, ...parseRelationDocument(content, f.path) }
            if (old?.revision !== content.revision) changed = true
          }
          e.progress.done++
          if (e.progress.done % 50 === 0) notify({ type: 'relations-progress', kbId: b.st.kbId, ...status(b) })
        }
        const revision = digest(JSON.stringify(Object.entries(next).map(([p, d]) => [p, d.revision])))
        e.documents = next; e.revision = revision; e.input = input; e.at = new Date(now()).toISOString(); e.status = 'synced'; e.reads = reads
        if (changed || force) e.graph = null
        // Metadata changes are persisted too, avoiding unnecessary reads after restart.
        await atomicJson(file, { format: FORMAT, key: e.key, updatedAt: e.at, documents: next })
        return next
      } catch (error) { e.status = 'error'; e.error = error.message; throw error }
    })()
    const pending = e.pending
    const completed = pending.finally(() => { if (e.pending === completed) e.pending = null })
    e.pending = completed
    if (background && !force && e.at) { void completed.catch(() => {}); return previous }
    return completed
  }
  return { documents, status, entry, invalidate(b) { if (b) entry(b).graph = null; else for (const e of entries.values()) e.graph = null } }
}
