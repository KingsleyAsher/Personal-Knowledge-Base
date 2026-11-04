import { watch as fsWatch } from 'node:fs'
import { EventEmitter } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'

// One OS watcher per root, but consumer-specific extension/privacy rules remain
// with each consumer. A TXT event must not disappear behind the MD index filter.
export function createRuntimeResources({ watch = fsWatch } = {}) {
  const roots = new Map(), context = new AsyncLocalStorage()
  let foreground = 0, busy = false, disposed = false
  const waiting = new Set()
  const metrics = { watchersOpened: 0, events: 0, backgroundJobs: 0, backgroundWaits: 0 }
  const canceled = () => Object.assign(new Error('任务已取消'), { code: 'CANCELED' })
  const wake = () => { for (const fn of [...waiting]) fn() }
  async function available(signal, lane) {
    while (!disposed && !signal?.aborted && (foreground || lane && busy)) {
      metrics.backgroundWaits++
      await new Promise(resolve => {
        const done = () => { waiting.delete(done); signal?.removeEventListener('abort', done); resolve() }
        waiting.add(done); signal?.addEventListener('abort', done, { once: true })
        if (signal?.aborted) done()
      })
    }
    if (disposed || signal?.aborted) throw canceled()
  }
  return {
    watch(root, options, listener) {
      if (disposed) throw canceled()
      const absolute = path.resolve(root), key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
      let entry = roots.get(key)
      if (!entry) {
        entry = { handles: new Set() }
        entry.native = watch(absolute, options, (event, file) => {
          if (file && String(file).replaceAll('\\', '/').split('/').some(p => ['.kbmeta', '.kb-state', '.kb', '.git', 'node_modules', '索引层'].includes(p))) return
          metrics.events++
          for (const handle of entry.handles) handle.listener(event, file)
        })
        entry.native.unref?.(); roots.set(key, entry); metrics.watchersOpened++
        entry.native.on('error', error => {
          entry.native.close(); if (roots.get(key) === entry) roots.delete(key)
          for (const handle of [...entry.handles]) if (handle.listenerCount('error')) handle.emit('error', error)
        })
      }
      const handle = new EventEmitter(); handle.listener = listener
      handle.unref = () => handle
      handle.close = () => {
        entry.handles.delete(handle)
        if (!entry.handles.size) { entry.native.close(); if (roots.get(key) === entry) roots.delete(key) }
      }
      entry.handles.add(handle)
      return handle
    },
    async foreground(fn) {
      foreground++
      try { return await fn() } finally { foreground--; wake() }
    },
    async background(fn, signal) {
      if (context.getStore()) return fn()
      // Claim the lane synchronously after waiting: another waiter may have won.
      do { await available(signal, true) } while (busy || foreground)
      busy = true; metrics.backgroundJobs++
      try { return await context.run(true, fn) } finally { busy = false; wake() }
    },
    async checkpoint(signal) {
      if (context.getStore()) {
        await new Promise(resolve => setImmediate(resolve))
        await available(signal, false)
      } else if (signal?.aborted || disposed) throw canceled()
    },
    stats: () => ({ ...metrics, watchers: roots.size, foreground, backgroundRunning: busy, waiting: waiting.size }),
    dispose() { disposed = true; for (const entry of roots.values()) entry.native.close(); roots.clear(); wake() },
  }
}
