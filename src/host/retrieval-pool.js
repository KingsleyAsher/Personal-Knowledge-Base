import { Worker } from 'node:worker_threads'
import { fail } from './workbench-state.js'

// One active job per worker: request failures/cancellation never terminate a
// worker underneath another request. Idle workers do not keep the host alive.
export function createRankingPool() {
  let worker, active, sequence = 0, stopped = false
  const queue = [], stats = { started: 0, completed: 0 }
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
      current.on('message', message => {
        if (worker !== current || message.requestId !== active?.id) return
        const job = active; active = null; stats.completed++
        finish(job, message.error ? fail('SEARCH_ERROR', message.error) : null, message.result)
        pump()
      })
      const exited = () => {
        if (worker !== current) return
        worker = null
        if (active) { finish(active, fail('SEARCH_ERROR', '检索 worker 已退出，可重试')); active = null }
        pump()
      }
      current.on('error', () => { void current.terminate(); exited() })
      current.on('exit', exited)
    }
    active = queue.shift(); worker.ref()
    try { worker.postMessage({ ...active.message, requestId: active.id }) }
    catch { const job = active; active = null; finish(job, fail('SEARCH_ERROR', '检索请求无法发送')); pump() }
  }
  return {
    stats,
    run(message, signal) {
      if (stopped || signal?.aborted) return Promise.reject(fail('CANCELED', '检索已取消'))
      return new Promise((resolve, reject) => {
        const job = { id: ++sequence, message, signal, resolve, reject, settled: false }
        job.abort = () => { finish(job, fail('CANCELED', '检索已取消')); pump() }
        signal?.addEventListener('abort', job.abort, { once: true })
        queue.push(job); pump()
      })
    },
    dispose() {
      stopped = true
      for (const job of queue.splice(0)) finish(job, fail('CANCELED', '检索已关闭'))
      if (active) { finish(active, fail('CANCELED', '检索已关闭')); active = null }
      const current = worker; worker = null; void current?.terminate()
    },
  }
}
