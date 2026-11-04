import { watch as fsWatch } from 'node:fs'
import path from 'node:path'

// Independent of page refresh. It observes only the currently bound root and
// excludes generated state; a missed watch event is repaired by the patrol.
export function createIndexMaintenance({ getCore, onChange = () => {}, watch = fsWatch, resources, now = Date.now, timers = globalThis, quietMs = 5000, minimumMs = 30000, patrolMs = 300000 } = {}) {
  let watcher, root = null, revision = null, enabled = false, stopped = false, ticking = false
  let pending = false, lastEvent = 0, lastStart = -Infinity, lastPatrol = 0, failures = 0, running = false, controller
  let excludes = [], state = 'idle'
  let lastWatchTry = -Infinity, retryAt = 0, transient = false
  const dirty = new Set()
  const relevant = file => {
    const rel = String(file || '').replaceAll('\\', '/')
    const parts = rel.split('/')
    return !parts.some(p => ['.kbmeta', '.kb-state', '索引层', '.git'].includes(p)) && !excludes.some(p => rel === p || rel.startsWith(p + '/')) && !rel.includes('.tmp-') && (rel === '' || !path.extname(rel) || rel.endsWith('.md') && path.basename(rel) !== 'INDEX.md' && !(parts.length === 1 && ['README.md', 'AGENTS.md', '知识库清单.md'].includes(rel)))
  }
  const mark = file => { if (relevant(file) && (failures < 3 || transient)) { if (transient) { failures = 0; retryAt = 0 }; if (file) dirty.add(String(file).replaceAll('\\', '/')); pending = true; lastEvent = now(); if (!running) state = 'waiting' } }
  function connect() {
    lastWatchTry = now()
    try {
      const current = watch(root, { recursive: true }, (_event, file) => mark(file))
      watcher = current; watcher.unref?.()
      current.on?.('error', () => {
        if (watcher !== current) return
        current.close(); watcher = null; pending = true; state = 'watch-unavailable'
      })
    } catch { watcher = null; pending = true; state = 'watch-unavailable' }
  }
  function failure(reason) {
    failures++
    transient = ['ENOSPC', 'EACCES', 'EPERM', 'EBUSY', 'source-unstable', 'maintenance-failed'].includes(reason)
    const hard = ['index-drop-confirmation', 'index-kbid-mismatch'].includes(reason)
    state = hard || failures >= 3 && !transient ? 'paused' : 'retrying'
    if (hard) failures = 3
    retryAt = now() + (failures >= 3 ? patrolMs : Math.min(patrolMs, minimumMs * 2 ** (failures - 1)))
    pending = state === 'retrying'
  }
  async function tick() {
    let started = false
    if (stopped || ticking) return
    const core = getCore()
    if (!core) return
    ticking = true
    try {
      const gate = await core.configGate()
      const conf = gate.conf
      const nextRoot = gate.ok && conf.autoIndex !== false ? conf.kbPath : null
      if (nextRoot !== root || conf?.revision !== revision) {
        watcher?.close(); watcher = null; controller?.abort()
        root = nextRoot; revision = conf?.revision; enabled = Boolean(root); dirty.clear(); failures = 0; transient = false; retryAt = 0
        pending = enabled; lastEvent = now(); state = enabled ? 'waiting' : 'disabled'
        excludes = ['_模板', '_手册', '50-底稿', '90-收件箱', ...(conf?.excludeFromSearch || [])]
        if (root) connect()
      }
      if (enabled && !watcher && now() - lastWatchTry >= minimumMs) connect()
      if (!enabled || running || failures >= 3 && !transient || now() < retryAt) return
      if (now() - lastPatrol >= patrolMs) { pending = true; lastPatrol = now() }
      if (!pending || now() - lastEvent < quietMs || now() - lastStart < minimumMs) return
      const status = await core.status()
      if (!status.healthy || !status.kbId) { state = 'unhealthy'; return }
      running = true; started = true; pending = false; lastStart = now(); state = 'running'; controller = new AbortController()
      const active = controller, paths = [...dirty]; dirty.clear()
      const run = () => core.maintainIndex({ expectedKbId: status.kbId, expectedRevision: revision, paths, automatic: true, signal: active.signal })
      const r = await (resources ? resources.background(run, active.signal) : run())
      if (stopped || !enabled || active.signal.aborted) return
      if (r.ok) { failures = 0; transient = false; retryAt = 0; state = 'synced'; if (r.indexWritten) onChange(r) }
      else { paths.forEach(p => dirty.add(p)); failure(r.reason); onChange(r) }
    } catch (error) { failure(error.code || 'maintenance-failed') }
    finally { if (started) running = false; ticking = false }
  }
  const timer = timers.setInterval(() => { void tick() }, 1000)
  timer?.unref?.()
  return {
    tick, notify: mark,
    resume() { failures = 0; transient = false; retryAt = 0; pending = enabled; lastEvent = now() - quietMs; state = enabled ? 'waiting' : 'disabled' },
    status: () => ({ state, enabled, running, failures, pending, retryAt: retryAt || null, lastStartedAt: Number.isFinite(lastStart) ? new Date(lastStart).toISOString() : null }),
    dispose() { stopped = true; timers.clearInterval(timer); watcher?.close(); controller?.abort(); dirty.clear() },
  }
}
