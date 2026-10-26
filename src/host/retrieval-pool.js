import { Worker } from 'node:worker_threads'
import { fail } from './workbench-state.js'
import { performance } from 'node:perf_hooks'

// One active job per worker: request failures/cancellation never terminate a
// worker underneath another request. Idle workers do not keep the host alive.
export function createRankingPool() {
  let worker, active, sequence = 0, stopped = false
  let resident = null, epoch = 0, workerEpoch = -1
  const queue = [], stats = { started: 0, completed: 0, catalogLoads: 0, catalogRecordsSent: 0, catalogBytesSent: 0 }
  function finish(job, error, result) {
    job.signal?.removeEventListener('abort', job.abort)
    if (!job.settled) { job.settled = true; error ? job.reject(error) : job.resolve(result) }
  }
  function pump() {
    if (stopped || active) return
    while (queue.length && queue[0].settled) queue.shift()
    if (!queue.length) { worker?.unref(); return }
    if (!worker) {
      const current = new Worker(new URL('./retrieval-worker.js', import.meta.url), { type: 'module' })
      worker = current; stats.started++
      resident = null; workerEpoch = -1
      current.on('message', message => {
        if (worker !== current || message.requestId !== active?.id) return
        const job = active; active = null; stats.completed++
        if (!message.error && job.epoch === epoch && message.result?.catalogResident) resident = job.catalog
        else resident = null
        if (message.result) message.result.transport = { ...job.transport, queueWaitMs: job.startedAt - job.queuedAt }
        finish(job, message.error ? fail('SEARCH_ERROR', message.error) : null, message.result)
        pump()
      })
      const exited = () => {
        if (worker !== current) return
        worker = null
        resident = null; workerEpoch = -1
        if (active) { finish(active, fail('SEARCH_ERROR', '检索 worker 已退出，可重试')); active = null }
        pump()
      }
      current.on('error', () => { void current.terminate(); exited() })
      current.on('exit', exited)
    }
    active = queue.shift(); worker.ref()
    active.startedAt = performance.now(); active.epoch = epoch
    const { catalog, ...message } = active.message
    active.catalog = catalog
    active.transport = { catalogRecordsSent: 0, catalogBytesSent: 0, catalogReused: false }
    if (workerEpoch !== epoch) { message.clearCaches = true; resident = null; workerEpoch = epoch }
    if (catalog && message.useCache !== false && catalog.bytes <= 128 * 1024 * 1024) {
      message.catalogRevision = catalog.revision
      if (resident?.revision !== catalog.revision || resident?.scope !== catalog.scope) {
        const previous = resident && resident.scope === catalog.scope ? new Set(resident.records.map(r => r.key)) : new Set()
        const keys = new Set(catalog.records.map(r => r.key))
        const upsert = catalog.records.filter(r => !previous.has(r.key))
        message.catalogUpdate = { revision: catalog.revision, scope: catalog.scope, reset: !resident || resident.scope !== catalog.scope,
          remove: [...previous].filter(key => !keys.has(key)), upsert, order: catalog.records.map(r => r.key) }
        active.transport.catalogRecordsSent = upsert.length
        active.transport.catalogBytesSent = upsert.reduce((n,r)=>n+Buffer.byteLength(r.text)+Buffer.byteLength(r.title||'')+Buffer.byteLength(r.path),0)
        stats.catalogLoads++; stats.catalogRecordsSent += upsert.length; stats.catalogBytesSent += active.transport.catalogBytesSent
      } else active.transport.catalogReused = true
    } else if (catalog) {
      const allowed=message.allowedIds?new Set(message.allowedIds):null
      message.records = [...catalog.records.filter(r=>!allowed||allowed.has(r.id)), ...(message.records || [])]
      active.transport.catalogRecordsSent = catalog.records.length; active.transport.catalogBytesSent = catalog.bytes
      // Oversized catalogs use the uncached correctness path.
      message.useCache = false
    }
    try { worker.postMessage({ ...message, requestId: active.id }) }
    catch { const job = active; active = null;resident=null;workerEpoch=-1; finish(job, fail('SEARCH_ERROR', '检索请求无法发送')); pump() }
  }
  return {
    stats,
    run(message, signal) {
      if (stopped || signal?.aborted) return Promise.reject(fail('CANCELED', '检索已取消'))
      return new Promise((resolve, reject) => {
        const job = { id: ++sequence, message, signal, resolve, reject, settled: false, queuedAt: performance.now() }
        job.abort = () => { finish(job, fail('CANCELED', '检索已取消')); pump() }
        signal?.addEventListener('abort', job.abort, { once: true })
        queue.push(job); pump()
      })
    },
    invalidate() { epoch++; resident = null },
    dispose() {
      stopped = true
      for (const job of queue.splice(0)) finish(job, fail('CANCELED', '检索已关闭'))
      if (active) { finish(active, fail('CANCELED', '检索已关闭')); active = null }
      const current = worker; worker = null; void current?.terminate()
      resident = null
    },
  }
}
