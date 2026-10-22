// Frozen comparison fixture from build 03bcde504978f416.
import { parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { terms, hash } from '../../src/host/retrieval-chunks.js'

export async function rank({ records, query, vector, vectorDir, dimension, mode = 'hybrid', focused = false }) {
  const q = query.toLowerCase(), quoted = [...query.matchAll(/["“]([^"”]+)["”]/gu)].map(m => m[1].toLowerCase()), qt = [...new Set(terms(query))]
  const documents = records.map(r => { const tf = new Map(); for (const t of terms(r.text + '\n' + r.title)) tf.set(t, (tf.get(t) || 0) + 1); return { ...r, tf, length: [...tf.values()].reduce((a,b) => a+b,0) } })
  const average = documents.reduce((a, d) => a + d.length, 0) / (documents.length || 1) || 1
  const df = new Map(qt.map(t => [t, documents.reduce((n, d) => n + (d.tf.has(t) ? 1 : 0), 0)]))
  const lexical = []
  for (const r of documents) {
    const lower = r.text.toLowerCase(), exact = r.title.toLowerCase() === q || r.path.toLowerCase() === q || quoted.some(s => lower.includes(s))
    const substring = lower.includes(q) || (r.path + '\n' + r.title + '\n' + (r.tags || []).join(' ')).toLowerCase().includes(q)
    let score = substring ? 4 : 0
    for (const t of qt) {
      const f = r.tf.get(t) || 0
      if (f) score += Math.log(1 + (documents.length - df.get(t) + .5) / (df.get(t) + .5)) * f * 2.2 / (f + 1.2 * (.25 + .75 * r.length / average))
    }
    if ((mode === 'exact' ? substring || exact : score > 0) || exact) lexical.push({ id: r.id, score, exact, path: r.path, section: r.section })
  }
  lexical.sort((a,b) => Number(b.exact)-Number(a.exact) || b.score-a.score || a.id-b.id)
  const semantic = [], byShard = new Map(), vectorErrors = []
  if (vector && dimension) {
    for (const r of records) if (r.slot != null) {
      const shard = Math.floor(r.slot / 4096)
      if (!byShard.has(shard)) byShard.set(shard, [])
      byShard.get(shard).push(r)
    }
    for (const [shard, rows] of byShard) {
      let buf
      try { buf = await readFile(path.join(vectorDir, 'vectors-' + shard + '.bin')) }
      catch { vectorErrors.push(shard); continue }
      for (const r of rows) {
        const base = (r.slot % 4096) * dimension * 4
        if (base + dimension * 4 > buf.length) { vectorErrors.push(shard); continue }
        if (r.checksum && hash(buf.subarray(base,base+dimension*4))!==r.checksum) {vectorErrors.push(shard);continue}
        let score = 0, valid = true
        for (let i = 0; i < dimension; i++) { const x = buf.readFloatLE(base + i * 4); if (!Number.isFinite(x)) { valid = false; break }; score += vector[i] * x }
        if (valid) semantic.push({ id: r.id, score, path: r.path, section: r.section })
      }
    }
    semantic.sort((a,b) => b.score-a.score || a.id-b.id)
  }
  const l = lexical.slice(0,80), s = semantic.slice(0,80)
  // Exactly one cross supplement: search lexically within semantic sections;
  // search semantically within lexical documents. No generated queries.
  const sections = new Set(s.slice(0,10).map(r => r.path + '\0' + r.section)), paths = new Set(l.slice(0,10).map(r => r.path))
  const localLexical = lexical.filter(r => sections.has(r.path + '\0' + r.section)).slice(0,20)
  const localSemantic = semantic.filter(r => paths.has(r.path)).slice(0,20)
  const fused = new Map()
  const add = (rows, channel) => rows.forEach((r, i) => {
    let x = fused.get(r.id)
    if (!x) { x = { id: r.id, path: r.path, score: 0, exact: false, channels: [], families: [] }; fused.set(r.id, x) }
    if (!x.channels.includes(channel)) x.channels.push(channel)
    const family = channel.endsWith('fulltext') ? 'fulltext' : 'semantic'
    if (!x.families.includes(family)) { x.families.push(family); x.score += 1 / (60+i+1) }
    x.exact ||= Boolean(r.exact)
  })
  if (mode !== 'semantic' || !vector || !semantic.length) add(l,'fulltext')
  if (mode !== 'fulltext' && mode !== 'exact') add(s,'semantic')
  if (mode === 'hybrid') { add(localLexical, 'semantic→fulltext'); add(localSemantic, 'fulltext→semantic') }
  const ranked = [...fused.values()].sort((a,b) => Number(b.exact)-Number(a.exact) || b.score-a.score || a.id-b.id)
  return { ranked, crossFulltext:mode==='hybrid'&&vector?localLexical.length:0,crossSemantic:mode==='hybrid'&&vector?localSemantic.length:0, vectorErrors: [...new Set(vectorErrors)], crossRounds: mode === 'hybrid' && vector ? 1 : 0, lexical: lexical.length, semantic: semantic.length }
}
if (parentPort) parentPort.on('message', async message => {
  try { parentPort.postMessage({ result: await rank(message) }) }
  catch { parentPort.postMessage({ error: '检索计算未完成' }) }
})
