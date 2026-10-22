import { watch as fsWatch } from 'node:fs'
import path from 'node:path'

// Independent of page refresh. It observes only the currently bound root and
// excludes generated state; a missed watch event is repaired by the patrol.
export function createIndexMaintenance({ getCore, onChange = () => {}, watch = fsWatch, now = Date.now, timers = globalThis, quietMs = 5000, minimumMs = 30000, patrolMs = 300000 } = {}) {
  let watcher, root = null, revision = null, enabled = false, stopped = false, ticking = false
  let pending = false, lastEvent = 0, lastStart = -Infinity, lastPatrol = 0, failures = 0, running = false, controller
  let excludes = [], state = 'idle'
  const dirty = new Set()
  const relevant = file => {
    const rel = String(file || '').replaceAll('\\', '/')
    const parts = rel.split('/')
    return !parts.some(p => ['.kbmeta', '.kb-state', '索引层', '.git'].includes(p)) && !excludes.some(p => rel === p || rel.startsWith(p + '/')) && !rel.includes('.tmp-') && (rel === '' || !path.extname(rel) || rel.endsWith('.md') && path.basename(rel) !== 'INDEX.md' && !(parts.length === 1 && ['README.md', 'AGENTS.md', '知识库清单.md'].includes(rel)))
  }
  const mark = file => { if (relevant(file) && failures < 3) { if (file) dirty.add(String(file).replaceAll('\\', '/')); pending = true; lastEvent = now(); if (!running) state = 'waiting' } }
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
        root = nextRoot; revision = conf?.revision; enabled = Boolean(root); dirty.clear(); failures = 0
        pending = enabled; lastEvent = now(); state = enabled ? 'waiting' : 'disabled'
        excludes = ['_模板', '_手册', '50-底稿', '90-收件箱', ...(conf?.excludeFromSearch || [])]
        if (root) try { watcher = watch(root, { recursive: true }, (_event, file) => mark(file)); watcher.on?.('error', () => { watcher?.close(); watcher = null; state = 'watch-unavailable' }) } catch { state = 'watch-unavailable' }
      }
      if (!enabled || running || failures >= 3) return
      if (now() - lastPatrol >= patrolMs) { pending = true; lastPatrol = now() }
      if (!pending || now() - lastEvent < quietMs || now() - lastStart < minimumMs) return
      const status = await core.status()
      if (!status.healthy || !status.kbId) { state = 'unhealthy'; return }
      running = true; started = true; pending = false; lastStart = now(); state = 'running'; controller = new AbortController()
      const active = controller, paths = [...dirty]; dirty.clear()
      const r = await core.maintainIndex({ expectedKbId: status.kbId, expectedRevision: revision, paths, automatic: true, signal: active.signal })
      if (stopped || !enabled || active.signal.aborted) return
      if (r.ok) { failures = 0; state = 'synced'; if (r.indexWritten) onChange(r) }
      else { paths.forEach(p => dirty.add(p)); failures++; state = failures >= 3 || ['index-drop-confirmation', 'index-kbid-mismatch'].includes(r.reason) ? 'paused' : 'retrying'; pending = state === 'retrying'; if (state === 'paused') failures = 3; onChange(r) }
    } catch { failures++; state = failures >= 3 ? 'paused' : 'retrying'; pending = failures < 3 }
    finally { if (started) running = false; ticking = false }
  }
  const timer = timers.setInterval(() => { void tick() }, 1000)
  timer?.unref?.()
  return {
    tick, notify: mark,
    resume() { failures = 0; dirty.clear(); pending = false; state = enabled ? 'synced' : 'disabled' },
    status: () => ({ state, enabled, running, failures, pending, lastStartedAt: Number.isFinite(lastStart) ? new Date(lastStart).toISOString() : null }),
    dispose() { stopped = true; timers.clearInterval(timer); watcher?.close(); controller?.abort(); dirty.clear() },
  }
}
