// Isolated 2.1.5/current processes; synthetic sources only, no cloud requests.
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const args = Object.fromEntries(process.argv.slice(2).map(v => { const at = v.indexOf('='); return [v.slice(2, at), v.slice(at + 1)] }))
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
if (args.probe) {
  const { createCore } = await import(pathToFileURL(path.join(args.probe, 'src/host/kbcore.js')))
  const { createWorkbench } = await import(pathToFileURL(path.join(args.probe, 'src/host/workbench.js')))
  const base = await mkdtemp(path.join(os.tmpdir(), 'kb-runtime-bench-'))
  let wb
  try {
    const library = path.join(base, 'library'), stateDir = path.join(base, 'state')
    await mkdir(library); const root = await realpath(library)
    let core = createCore({ stateDir }, () => {})
    await core.bind(root, { confirmInit: true })
    const count = 300
    for (let i = 0; i < count; i++) await writeFile(path.join(root, `note-${String(i).padStart(4, '0')}.md`), `# 项目 ${i}\n\n` + '审批后才能报销；不符合条件时禁止。\n'.repeat(160) + `\n例外编号 ZX-${i}。\n`)
    const indexed = await core.maintainIndex(); if (!indexed.ok) throw Error(JSON.stringify(indexed))
    core = createCore({ stateDir }, () => {}); wb = createWorkbench({ stateDir, getCore: () => core })
    const queries = ['审批', '报销', 'ZX-17', '不符合条件', '禁止'], rows = [], signatures = []
    const run = async query => {
      const at = performance.now(), result = await wb.dispatch({ op: 'search.list', mode: 'fulltext', q: query })
      return { ms: performance.now() - at, signature: hash({ total: result.total, items: result.items.map(({ path, title, snippet, revision, ranges, channels }) => ({ path, title, snippet, revision, ranges, channels })) }) }
    }
    const cold = await run(queries[0])
    for (const q of queries) signatures.push((await run(q)).signature)
    for (let i = 0; i < 20; i++) { const r = await run(queries[i % queries.length]); if (r.signature !== signatures[i % queries.length]) throw Error('Warm ranking changed'); rows.push(r.ms) }
    const beforeUpdate = core._internal.ioStats?.()
    await writeFile(path.join(root, 'note-0000.md'), '# Changed\n审批后报销，新增例外。')
    const updateAt = performance.now(), update = await core.maintainIndex({ paths: ['note-0000.md'] })
    if (!update.ok) throw Error(JSON.stringify(update))
    rows.sort((a, b) => a - b)
    console.log(JSON.stringify({ synthetic: true, documents: count, iterations: 20, mode: 'fulltext', coldMs: cold.ms, p50Ms: rows[10], p95Ms: rows[18], peakRssBytes: process.resourceUsage().maxRSS * 1024, signatures, updateMs: performance.now() - updateAt, beforeUpdate, indexIO: core._internal.ioStats?.(), runtime: wb.runtimeStats?.(), limits: ['Local sample, not a long-term latency SLA', 'No real embedding API or model answers', 'No claim of physical SSD byte measurement'] }))
  } finally { wb?.dispose(); await rm(base, { recursive: true, force: true }) }
} else {
  if (!args['baseline-root'] || !args.output) throw Error('Use --baseline-root=<2.1.5 source> --output=<report.json>')
  const current = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
  const probe = root => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe=' + root], { encoding: 'utf8', timeout: 180000 })
    if (r.status !== 0) throw Error(r.stderr || r.stdout)
    return JSON.parse(r.stdout.trim().split('\n').at(-1))
  }
  const baseline = probe(path.resolve(args['baseline-root'])), optimized = probe(current)
  const qualityMatched = hash(baseline.signatures) === hash(optimized.signatures)
  const passed = qualityMatched && optimized.p50Ms <= baseline.p50Ms * 1.1 && optimized.p95Ms <= baseline.p95Ms * 1.1 && optimized.peakRssBytes <= baseline.peakRssBytes
  const report = { baselineVersion: '2.1.5', baseline, optimized, qualityMatched, passed }
  await writeFile(args.output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2)); if (!passed) process.exitCode = 1
}
