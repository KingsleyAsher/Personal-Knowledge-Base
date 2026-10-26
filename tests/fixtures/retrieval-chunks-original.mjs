import { createHash } from 'node:crypto'

export const CHUNK_VERSION = 'structure-1'
export const hash = value => createHash('sha256').update(value).digest('hex')
export const bytes = value => Buffer.byteLength(value, 'utf8')
export function byteEnd(text, start, budget) {
  let end = start, used = 0
  for (const c of text.slice(start)) { const n = bytes(c); if (used + n > budget) break; used += n; end += c.length }
  return end
}
export const byteSlice = (text, budget) => text.slice(0, byteEnd(text, 0, budget))

// All offsets point into the unmodified source. Prefixes are retrieval hints,
// never persisted copies of the source or evidence for citations.
export function structureDocument(text, title = '', options = {}) {
  const target = options.target ?? 2400, hard = options.hard ?? 3200, overlap = options.overlap ?? 240
  if (target < 128 || hard < target + 256 || overlap < 0 || overlap >= target / 2) throw new Error('Invalid chunk sizes')
  const sections = [], blocks = [], lines = []
  let offset = 0, fence = null, block = null, hierarchy = [], current
  const section = (start, level, name) => {
    while (hierarchy.length && hierarchy.at(-1).level >= level) hierarchy.pop()
    const s = { id: sections.length, start, end: text.length, level, title: name, parent: hierarchy.at(-1)?.id ?? null, headings: [...hierarchy.map(x => x.title), name].filter(Boolean) }
    sections.push(s); hierarchy.push(s); current = s; return s
  }
  section(0, 0, '')
  const flush = () => { if (block) { blocks.push(block); block = null } }
  let frontmatterEnd = 0
  const fm = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (fm) frontmatterEnd = fm[0].length
  for (const value of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const start = offset; offset += value.length
    lines.push({ start, end: offset })
    if (start < frontmatterEnd) continue
    const marker = value.match(/^\s*(`{3,}|~{3,}|\$\$)/)
    const heading = !fence && value.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flush(); current.end = start; section(start, heading[1].length, heading[2])
    }
    const kind = fence || marker ? 'code' : /^\s*\|.*\|/.test(value) ? 'table' : /^\s*(?:[-*+] |\d+[.)] )/.test(value) ? 'list' : 'paragraph'
    if (!fence && !marker && (!value.trim() || block && (block.kind !== kind || heading))) flush()
    if (!block) block = { start, end: offset, section: current.id, kind, hint: '' }
    else block.end = offset
    if (marker) { if (!fence) { fence = marker[1][0]; block.hint = value.trim() } else if (marker[1][0] === fence) { fence = null; flush() } }
    if (!fence && !value.trim()) flush()
  }
  flush()
  // Each section has a local range; ancestry is maintained separately.
  for (let i = 0; i < sections.length - 1; i++) sections[i].end = sections[i + 1].start
  const chunks = []
  let pending = null
  const emit = () => {
    if (!pending || !text.slice(pending.start, pending.end).trim()) { pending = null; return }
    const s = sections[pending.section]
    const inputPrefix = byteSlice([title, ...s.headings, pending.hint].filter(Boolean).join('\n'), 512)
    const c = { ...pending, id: chunks.length, sectionStart: s.start, sectionEnd: s.end, headings: s.headings, inputPrefix }
    c.line = 1 + (text.slice(0, c.start).match(/\n/g) || []).length
    chunks.push(c); pending = null
  }
  for (const b of blocks) {
    if (pending && (pending.section !== b.section || pending.kind !== b.kind || bytes(text.slice(pending.start, b.end)) > target)) emit()
    if (bytes(text.slice(b.start, b.end)) <= target) {
      if (!pending) pending = { ...b }
      else pending.end = b.end
      continue
    }
    emit()
    let start = b.start
    const raw = text.slice(b.start, b.end)
    const structureHint = b.kind === 'table' ? raw.split('\n').slice(0, 2).join('\n') : b.kind === 'list' ? raw.split('\n')[0] : b.hint
    while (start < b.end) {
      let end = Math.min(b.end, byteEnd(text, start, target))
      if (end < b.end) {
        const part = text.slice(start, end), min = Math.floor(part.length * .55)
        let boundary = part.lastIndexOf('\n') + 1
        if (boundary < min) { const matches = [...part.matchAll(/[.!?。！？؛।]\s*/gu)]; boundary = matches.length ? matches.at(-1).index + matches.at(-1)[0].length : 0 }
        if (boundary >= min) end = start + boundary
      }
      pending = { ...b, start, end, hint: structureHint, continued: start > b.start || end < b.end }; emit()
      if (end === b.end) break
      let next = end, used = 0
      for (const c of [...text.slice(start, end)].reverse()) { if (used + bytes(c) > overlap) break; used += bytes(c); next -= c.length }
      start = Math.max(start + (text.codePointAt(start) > 0xffff ? 2 : 1), next)
    }
  }
  emit()
  return { sections, chunks, frontmatterEnd, version: CHUNK_VERSION }
}

export function embeddingText(text, chunk) {
  return chunk.inputPrefix ? chunk.inputPrefix + '\n\n' + text.slice(chunk.start, chunk.end) : text.slice(chunk.start, chunk.end)
}

export function expandRange(text, chunk, budget = 12 * 1024) {
  let start = chunk.start, end = chunk.end
  if (bytes(text.slice(chunk.sectionStart, chunk.sectionEnd)) <= budget) { start = chunk.sectionStart; end = chunk.sectionEnd }
  else {
    const before = text.lastIndexOf('\n\n', Math.max(chunk.sectionStart, start - 1200))
    start = Math.max(chunk.sectionStart, before < 0 ? start : before + 2)
    const after = text.indexOf('\n\n', end + 500)
    end = after < 0 ? chunk.sectionEnd : Math.min(chunk.sectionEnd, after)
    if (bytes(text.slice(start, end)) > budget) {
      if (byteEnd(text, start, budget) < chunk.end) start = chunk.start
      end = Math.min(end, byteEnd(text, start, budget))
    }
  }
  return { start, end, line: 1 + (text.slice(0, start).match(/\n/g) || []).length, endLine: 1 + (text.slice(0, end).match(/\n/g) || []).length,
    text: text.slice(start, end), headings: chunk.headings, more: start > chunk.sectionStart || end < chunk.sectionEnd }
}

export function terms(text) {
  const out = []
  for (const m of text.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) {
    const word = m[0]; out.push(word)
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) {
      const chars = [...word]; for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1])
    }
  }
  return out
}
