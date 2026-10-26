// Synthetic records only. Run before/after with --baseline or --output=<file>.
import { performance } from 'node:perf_hooks'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRankingPool } from '../src/host/retrieval-pool.js'
import { hash } from '../src/host/retrieval-chunks.js'

const baseline = process.argv.includes('--baseline'), results = []
const root = await mkdtemp(path.join(os.tmpdir(), 'kb-ranking-bench-'))
try {
  for (const count of [500, 5000, 20000]) {
    const dir = path.join(root, String(count)); await mkdir(dir)
    const records = [], shards = new Map(), dimension = 8
    for (let id = 0; id < count; id++) {
      const buf = Buffer.alloc(dimension * 4); buf.writeFloatLE(1, (id % dimension) * 4)
      const shard = Math.floor(id / 4096)
      if (!shards.has(shard)) shards.set(shard, Buffer.alloc(Math.min(4096, count - shard * 4096) * dimension * 4))
      buf.copy(shards.get(shard), (id % 4096) * dimension * 4)
      records.push({ id, key: `sample-${id}`, path: `notes/${id}.md`, title: `Sample ${id}`, section: 0,
        text: `# Sample ${id}\n关键词${id % 23} ocean research blood circulation. 心脏推动血液循环。\n`.repeat(8), slot: id, checksum: hash(buf) })
    }
    for (const [id, buf] of shards) await writeFile(path.join(dir, `vectors-${id}.bin`), buf)
    const catalog = { revision: `synthetic-${count}`, records, bytes: Buffer.byteLength(JSON.stringify(records)) }
    const pool = createRankingPool(), samples = [], modes = ['fulltext', 'hybrid', 'semantic', 'exact']
    let coldMs, cache, transport, fingerprint
    try {
      for (let i = 0; i < 21; i++) {
        const start = performance.now(), mode = modes[i % modes.length]
        const result = await pool.run({ ...(baseline ? { records } : { catalog }), query: i % 2 ? '关键词7' : 'ocean research', mode,
          vector: ['hybrid', 'semantic'].includes(mode) ? [1,0,0,0,0,0,0,0] : undefined, vectorDir: dir, dimension })
        const elapsed = performance.now() - start
        if (i === 0) coldMs = elapsed; else samples.push(elapsed)
        if (i === 20) { cache = result.cache; transport = result.transport; fingerprint = hash(JSON.stringify(result.ranked)) }
      }
      samples.sort((a,b) => a-b)
      results.push({ documents: count, chunks: count, textBytes: records.reduce((n,r)=>n+Buffer.byteLength(r.text),0),
        coldMs, warmP50Ms: samples[9], warmP95Ms: samples[18], memory: process.memoryUsage(), workerMemory: cache?.workerMemory,
        cache, transport, fingerprint, pool: pool.stats })
    } finally { pool.dispose() }
  }
} finally { await rm(root, { recursive: true, force: true }) }
const report = { baseline, runtime: process.version, platform: process.platform, synthetic: true, results }
const output = process.argv.find(a=>a.startsWith('--output='))?.slice(9)
if (output) await writeFile(output, JSON.stringify(report, null, 2)+'\n')
console.log(JSON.stringify(report, null, 2))
