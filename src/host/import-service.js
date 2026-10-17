// 导入服务（R1）：UI（设置页 /kb-core/api）与模型工具（kb_import）共用的**唯一**执行入口。
//
// 关键不变量（对应审查意见 R1 与复核意见第 1 点）：
//   1. 任务清单自带目标身份：{target, targetKbId, taskStateDir}；执行方用**独立 core** 写到目标库，
//      不读、不改共享的「当前绑定」。
//   2. 独立 core 不等于目标已固定：它的状态目录里可能残留旧 config.json（kbPath 指向别的库），
//      所以创建后必须 loadConfig + status，核对**实际根目录**与 kbId；不一致立即拒绝（不写一个字节）。
//   3. 切库（commit）放在导入完成且核验通过之后；且只在「当前绑定仍是开始时那一个」时提交，
//      用户中途换库不会被覆盖。
//   4. 失败 / 取消 / 异常一律不碰当前绑定（没有"先切再恢复"这一步）。
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createCore } from './kbcore.js'
import { inspectFolder, planImport, runImport, readManifest, saveManifest, cancelImport, listImports, isValidImportId, resolveImportDir } from './importer.js'

export const TERMINAL_STAGES = new Set(['done', 'partial', 'failed', 'canceled', 'conflict'])
const norm = (p) => String(p ?? '').replace(/\\/g, '/').toLowerCase()

export function createImportService({ stateDir, getBaseConfig, getCurrentCore = null, log = () => {}, coreFactory = createCore, commitBinding = null }) {
  const jobs = new Map()
  const taskStateDirOf = (importId) => path.join(stateDir, 'imports', importId, 'core-state')
  const isActive = (importId) => Boolean(jobs.get(importId) && jobs.get(importId).running)

  const currentCoreSafe = async () => (typeof getCurrentCore === 'function' ? await getCurrentCore() : null)
  const currentStatus = async () => {
    const c = await currentCoreSafe().catch(() => null)
    if (!c) return null
    return await c.status().catch(() => null)
  }

  /** R2：任务目录在解析阶段就要判（读清单会把"越界"错报成 not-found） */
  async function taskDirError(importId) {
    if (!isValidImportId(importId)) return { reason: 'bad-import-id', error: 'importId 非法（必须形如 imp-xxxxxxxxxx）' }
    const r = await resolveImportDir(stateDir, importId)
    if (!r.ok) return { reason: r.reason, error: '导入任务目录非法：' + r.reason }
    return null
  }

  async function baseConf() {
    try {
      return (await getBaseConfig()) ?? {}
    } catch {
      return {}
    }
  }

  /** 为任务创建一个**只指向 manifest.target** 的独立 core，并核对它真实落到的位置。 */
  async function makeTaskCore(manifest) {
    const base = await baseConf()
    const taskStateDir = manifest.taskStateDir || taskStateDirOf(manifest.importId)
    const cfg = { ...base, kbPath: manifest.target, stateDir: taskStateDir }
    const core = coreFactory(cfg, log)
    if (typeof core.loadConfig === 'function') await core.loadConfig()
    const st = await core.status()
    const gotRoot = st && st.kbPath ? path.resolve(st.kbPath) : null
    if (!gotRoot || norm(gotRoot) !== norm(manifest.target)) {
      return {
        ok: false,
        reason: 'target-root-mismatch',
        error: `任务目标的独立 core 实际绑定在 ${st && st.kbPath ? st.kbPath : '(未绑定)'}，与清单目标 ${manifest.target} 不一致；已拒绝执行（任务状态目录里可能有旧配置）`,
        actualRoot: st && st.kbPath ? st.kbPath : null,
        taskStateDir,
      }
    }
    if (manifest.targetKbId && st.kbId && manifest.targetKbId !== st.kbId) {
      return {
        ok: false,
        reason: 'target-kbid-mismatch',
        error: `任务目标 kbId=${manifest.targetKbId}，独立 core 读到的 kbId=${st.kbId}；已拒绝执行（目标库被替换过）`,
        actualKbId: st.kbId,
        taskStateDir,
      }
    }
    return { ok: true, core, status: st, taskStateDir }
  }

  async function stampTarget(manifest) {
    let changed = false
    if (!manifest.taskStateDir) {
      manifest.taskStateDir = taskStateDirOf(manifest.importId)
      changed = true
    }
    if (!manifest.targetKbId) {
      const base = await baseConf()
      const probe = coreFactory({ ...base, kbPath: manifest.target, stateDir: taskStateDirOf(manifest.importId) }, log)
      if (typeof probe.loadConfig === 'function') await probe.loadConfig()
      const st = await probe.status().catch(() => null)
      const sameRoot = st && st.kbPath && norm(st.kbPath) === norm(manifest.target)
      if (sameRoot && st.kbId) {
        manifest.targetKbId = st.kbId
        changed = true
      }
    }
    if (changed) await saveManifest(stateDir, manifest)
    return manifest
  }

  /** 冻结清单（只读；R3：必须在建标准结构之前调用）。 */
  async function plan({ source, mode: modeIn, current }) {
    const srcRaw = String(source ?? '').trim()
    if (srcRaw === '') return { ok: false, reason: 'empty-source', error: 'plan 需要 source（绝对路径）' }
    const mode = modeIn === 'copy' ? 'copy' : 'attach'
    const cur = current ?? (await currentStatus())
    if (mode === 'copy' && !(cur && cur.kbPath)) return { ok: false, reason: 'unbound', error: '复制导入需要先绑定目标知识库' }
    const target = mode === 'copy' ? cur.kbPath : path.resolve(srcRaw)
    const manifest = await planImport({ stateDir, source: srcRaw, target, mode, log, isActive })
    if (manifest && manifest.error) return { ok: false, reason: manifest.reason ?? 'plan-failed', error: manifest.error }
    if (manifest.running) {
      return { ok: true, running: true, importId: manifest.importId, mode: manifest.mode, source: manifest.source, target: manifest.target, stage: manifest.stage, counts: manifest.counts, note: manifest.note }
    }
    await stampTarget(manifest)
    return {
      ok: true,
      importId: manifest.importId,
      mode: manifest.mode,
      source: manifest.source,
      target: manifest.target,
      targetKbId: manifest.targetKbId ?? null,
      stage: manifest.stage,
      taskStateDir: manifest.taskStateDir ?? null,
      counts: manifest.counts,
      scan: manifest.scan,
      skippedDirs: manifest.skippedDirs,
      skippedFiles: (manifest.skippedFiles ?? []).length,
    }
  }

  /** 启动（后台执行）。校验顺序：id → 清单 → 目标初始化 → 独立 core 实际身份 → 运行。 */
  async function start({ importId }) {
    const dirError = await taskDirError(importId)
    if (dirError) return { ok: false, ...dirError }
    const manifest = await readManifest(stateDir, importId)
    if (manifest === null) return { ok: false, reason: 'not-found', error: '找不到导入任务：' + importId }
    if (isActive(importId)) return { ok: true, started: false, running: true, reason: 'already-running', importId, stage: manifest.stage }
    if (manifest.stage === 'done') return { ok: true, started: false, alreadyDone: true, importId, stage: 'done', counts: manifest.counts }
    if (manifest.stage === 'conflict') return { ok: false, reason: 'conflict', error: '上次执行发现源文件在计划后发生变化：请重新 plan 再 run', conflicts: manifest.conflicts ?? [] }

    // 目标库必须已初始化：没有 kbId 就在目标处初始化（**不切换当前绑定**）
    if (!manifest.targetKbId) {
      const initCore = await currentCoreSafe()
      if (!initCore || typeof initCore.initializeLibrary !== 'function') return { ok: false, reason: 'no-current-core', error: '缺少当前 core，无法初始化任务目标' }
      const init = await initCore.initializeLibrary(manifest.target, { rebuildIndex: true })
      if (!init.ok) return { ok: false, reason: 'target-init-failed', error: '任务目标初始化失败：' + (init.error ?? init.reason ?? 'unknown'), init }
      manifest.targetKbId = init.kbId
      await saveManifest(stateDir, manifest)
    }
    if (!manifest.taskStateDir) {
      manifest.taskStateDir = taskStateDirOf(importId)
      await saveManifest(stateDir, manifest)
    }

    const made = await makeTaskCore(manifest)
    if (!made.ok) {
      log('error', `导入 ${importId} 拒绝执行：${made.error}`)
      return { ok: false, reason: made.reason, error: made.error, actualRoot: made.actualRoot ?? null, target: manifest.target }
    }

    const before = await currentStatus()
    const job = { running: true, lastError: null, result: null, target: manifest.target, targetKbId: manifest.targetKbId, startedAt: new Date().toISOString() }
    jobs.set(importId, job)
    job.promise = (async () => {
      let r = null
      try {
        r = await runImport({ core: made.core, stateDir, importId, log })
      } catch (error) {
        job.running = false
        job.lastError = String((error && error.message) ?? error)
        log('error', `导入任务异常：${job.lastError}`)
        // 异常不能让任务永远停在 importing：落一个明确的终态，并把原因写进清单
        try {
          const m = await readManifest(stateDir, importId)
          if (m && !TERMINAL_STAGES.has(m.stage)) {
            m.stage = 'partial'
            m.terminalReasons = [...(m.terminalReasons ?? []), '执行异常：' + job.lastError.slice(0, 160)]
            await saveManifest(stateDir, m)
          }
        } catch {
          /* 清单也写不了时，status() 会用 job.lastError 报 failed（不假装 done） */
        }
        return
      }
      job.result = {
        ok: r.ok === true,
        stage: r.manifest ? r.manifest.stage : null,
        counts: r.manifest ? r.manifest.counts : null,
        canceled: Boolean(r.canceled),
        conflict: Boolean(r.conflict),
        reasons: (r.manifest && r.manifest.terminalReasons) || [],
      }
      if (r.ok !== true) {
        job.running = false
        return
      }
      // running 覆盖到"提交切库"完成：否则轮询会看到 running=false 而 committed 还没写（可观察的竞态）
      try {
        // R1：提交切库只在导入完成且核验通过之后；且当前绑定必须仍是开始时那一个
        const now = await currentStatus()
        if (!now) {
          job.committed = false
          job.commitReason = 'no-status'
          return
        }
        if (norm(now.kbPath) === norm(manifest.target)) {
          job.committed = true
          job.commitReason = 'already-bound'
          return
        }
        const samePath = Boolean(before) && norm(before.kbPath) === norm(now.kbPath)
        const sameKb = Boolean(before) && String(before.kbId ?? '') === String(now.kbId ?? '')
        const beforeRev = before && before.config ? before.config.revision ?? null : null
        const nowRev = now.config ? now.config.revision ?? null : null
        const sameRev = beforeRev === nowRev
        if (!samePath || !sameKb || !sameRev) {
          job.committed = false
          job.commitReason = samePath && sameKb ? 'config-changed' : 'binding-changed'
          log('warn', `导入完成但当前绑定/配置已被用户改动（path=${now.kbPath} rev=${String(beforeRev)}→${String(nowRev)}）：不覆盖，保留为待提交（目标 ${manifest.target}）`)
          return
        }
        if (typeof commitBinding !== 'function') {
          job.committed = false
          job.commitReason = 'no-commit-hook'
          return
        }
        try {
          const c = await commitBinding(manifest.target, {
            expectedConfigRevision: beforeRev,
            expectedCurrentKbPath: before ? before.kbPath : null,
            expectedCurrentKbId: before ? before.kbId ?? null : null,
            expectedTargetKbId: manifest.targetKbId ?? null,
          })
          job.committed = c && c.ok === true
          job.commitReason = job.committed ? 'committed' : String((c && (c.reason || c.note)) || 'commit-failed')
          job.commit = c
          if (!job.committed) log('warn', `导入完成但切库未成功：${job.commitReason}`)
        } catch (error) {
          job.committed = false
          job.commitReason = 'commit-threw'
          job.commitError = String((error && error.message) ?? error)
        }
      } finally {
        job.running = false
      }
    })()
    return { ok: true, started: true, importId, stage: 'running', mode: manifest.mode, source: manifest.source, target: manifest.target, targetKbId: manifest.targetKbId, taskStateDir: made.taskStateDir }
  }

  async function status({ importId } = {}) {
    if (importId === undefined || importId === null || String(importId) === '') {
      const imports = await listImports(stateDir)
      return { ok: true, imports: imports.map((m) => ({ ...m, running: isActive(m.importId), terminal: TERMINAL_STAGES.has(m.stage) })) }
    }
    const dirError = await taskDirError(importId)
    if (dirError) return { ok: false, ...dirError }
    const manifest = await readManifest(stateDir, importId)
    if (manifest === null) return { ok: false, reason: 'not-found', error: '找不到导入任务：' + importId }
    const job = jobs.get(importId) ?? null
    const counts = manifest.counts
    // 异常中断（job 已停但清单还写着 importing）→ 如实报 failed，不冒充"仍在跑"也不冒充 done
    const endedByError = Boolean(job && !job.running && job.lastError && manifest.stage === 'importing')
    const stage = endedByError ? 'failed' : manifest.stage
    const terminalReasons = endedByError ? [...(manifest.terminalReasons ?? []), '执行异常：' + String(job.lastError).slice(0, 160)] : manifest.terminalReasons ?? []
    return {
      ok: true,
      importId,
      running: Boolean(job && job.running),
      stage,
      manifestStage: manifest.stage,
      mode: manifest.mode,
      source: manifest.source,
      target: manifest.target,
      targetKbId: manifest.targetKbId ?? null,
      taskStateDir: manifest.taskStateDir ?? null,
      counts,
      scan: manifest.scan,
      verify: manifest.verify ?? null,
      terminalReasons: manifest.terminalReasons ?? [],
      conflicts: (manifest.conflicts ?? []).slice(0, 20),
      lastError: job ? job.lastError : null,
      committed: job ? job.committed === true : false,
      commitReason: job ? job.commitReason ?? null : null,
      recent: manifest.items.filter((it) => it.status === 'failed').slice(0, 10).map((it) => ({ rel: it.rel, error: it.error })),
      samples: manifest.items.filter((it) => it.status === 'done').slice(0, 8).map((it) => ({ rel: it.rel, entryPath: it.entryPath })),
    }
  }

  async function cancel({ importId } = {}) {
    const dirError = await taskDirError(importId)
    if (dirError) return { ok: false, ...dirError }
    return await cancelImport(stateDir, importId)
  }

  /**
   * 「自动建库 / 识别」一次点击（S4 的两个主动作之二）。
   * R3 的关键顺序：**先冻结清单，再建标准结构**；R1：导入完成并通过核验后才切换当前库。
   */
  async function setupFolder(folderRaw, modeIn) {
    const raw = String(folderRaw ?? '').trim()
    if (raw === '') return { ok: false, blocked: true, action: 'blocked', note: '路径为空：请先选择或粘贴一个文件夹绝对路径' }
    const mode = modeIn === 'copy' ? 'copy' : 'attach'
    let info = await inspectFolder(raw)
    const base = { ok: false, folder: info.path, kind: info.kind, reasons: info.reasons, info }
    if (info.kind === 'missing') {
      if (info.creatable !== true) return { ...base, blocked: true, action: 'blocked', note: info.reasons.join('；') || '目录不存在且上级不可写' }
      try {
        await mkdir(path.resolve(raw), { recursive: true })
      } catch (error) {
        return { ...base, blocked: true, action: 'create-failed', note: '创建目录失败：' + String((error && (error.code || error.message)) ?? error) }
      }
      info = await inspectFolder(raw)
      if (!info.exists) return { ...base, blocked: true, action: 'create-failed', note: '创建后仍无法识别目录' }
    }
    const base2 = { ok: false, folder: info.path, kind: info.kind, reasons: info.reasons, info }
    if (['not-a-directory', 'incompatible', 'corrupt'].includes(info.kind)) {
      return { ...base2, blocked: true, action: 'blocked', note: info.kind === 'incompatible' || info.kind === 'corrupt' ? '元数据不兼容或已损坏：已拒绝初始化，未改动任何文件' : info.reasons.join('；') }
    }
    if (!info.writable) return { ...base2, blocked: true, action: 'blocked', note: info.reasons.join('；') || '目录不可写' }

    const cur = await currentStatus()
    const prev = cur && cur.kbPath && norm(cur.kbPath) !== norm(info.path) ? cur : null
    const restore = async () => {
      if (!prev || typeof commitBinding !== 'function') return false
      const now = await currentStatus()
      // 只在「当前绑定仍是那次失败的候选」时回退，不覆盖用户后来的选择
      if (!now || norm(now.kbPath) !== norm(info.path)) return false
      const r = await commitBinding(prev.kbPath, { expectedKbId: prev.kbId ?? null })
      return Boolean(r && r.ok)
    }

    if (info.kind === 'ours' || info.kind === 'ours-partial') {
      let init = null
      if (info.kind === 'ours-partial') {
        init = await (await currentCoreSafe()).initializeLibrary(info.path, { rebuildIndex: true }).catch((error) => ({ ok: false, reason: 'init-threw', error: String((error && error.message) ?? error) }))
        if (!init.ok) return { ...base2, ok: false, action: 'attach-failed', failed: '初始化未完成：' + (init.error ?? init.reason ?? '') }
      }
      const bound = await (await currentCoreSafe()).bind(info.path, { confirmInit: false })
      if (!bound || bound.ok !== true) return { ...base2, ok: false, action: 'attach-failed', failed: (bound && (bound.note || bound.reason)) || '绑定失败' }
      const after = await currentStatus()
      if (!after || after.healthy !== true) {
        const restored = await restore()
        return { ...base2, ok: false, action: 'attach-failed', failed: '库结构仍不健康：' + ((after && after.healthReason) || 'unknown'), init, bindingRestored: restored }
      }
      return { ...base2, ok: true, action: info.kind === 'ours' ? 'attached' : 'attached-repaired', kbId: after.kbId ?? null, init, after: { kbPath: after.kbPath, kbId: after.kbId ?? null, healthy: after.healthy } }
    }

    if (info.kind === 'empty') {
      const currentCore = await currentCoreSafe()
      const init = await currentCore.initializeLibrary(info.path, { rebuildIndex: true })
      if (!init.ok) return { ...base2, ok: false, action: 'create-failed', failed: '建库失败：' + (init.error ?? init.reason ?? '') }
      const bound = await currentCore.bind(info.path, { confirmInit: false })
      if (!bound || bound.ok !== true) {
        const restored = await restore()
        return { ...base2, ok: false, action: 'create-failed', failed: (bound && (bound.note || bound.reason)) || '绑定失败', bindingRestored: restored }
      }
      const after = await currentCore.status()
      if (after.healthy !== true) {
        const restored = await restore()
        return { ...base2, ok: false, action: 'create-failed', failed: '建库后库结构仍不健康：' + (after.healthReason || 'unknown'), bindingRestored: restored }
      }
      return { ...base2, ok: true, action: 'created', kbId: init.kbId ?? null, index: { rebuilt: true, entries: after.counts ? after.counts.entries : 0 }, after: { kbPath: after.kbPath, kbId: after.kbId ?? null, healthy: after.healthy } }
    }

    // foreign：先冻结清单（此时还没有标准结构），再建库结构，再后台导入
    if (mode === 'copy') {
      if (!cur || !cur.kbPath) return { ...base2, blocked: true, action: 'blocked', note: '复制导入需要先绑定目标知识库' }
      const planned = await plan({ source: info.path, mode, current: cur })
      if (!planned.ok) return { ...base2, ok: false, action: 'plan-failed', failed: planned.error ?? planned.reason }
      const started = await start({ importId: planned.importId })
      return { ...base2, ok: started.ok === true, action: started.ok ? 'import-started' : 'import-failed', importId: planned.importId, mode, counts: planned.counts, scan: planned.scan, skippedDirs: planned.skippedDirs, started, note: started.ok ? '复制导入已开始（目标 = 当前库）；完成后按状态查看' : started.error }
    }
    const planned = await plan({ source: info.path, mode: 'attach', current: cur })
    if (!planned.ok) return { ...base2, ok: false, action: 'plan-failed', failed: planned.error ?? planned.reason }
    const currentCore = await currentCoreSafe()
    const init = await currentCore.initializeLibrary(info.path, { rebuildIndex: false })
    if (!init.ok) return { ...base2, ok: false, action: 'create-failed', failed: '建标准结构失败：' + (init.error ?? init.reason ?? '') }
    const manifest = await readManifest(stateDir, planned.importId)
    manifest.targetKbId = init.kbId
    await saveManifest(stateDir, manifest)
    const started = await start({ importId: planned.importId })
    return {
      ...base2,
      ok: started.ok === true,
      action: started.ok ? 'import-started' : 'import-failed',
      importId: planned.importId,
      mode,
      targetKbId: init.kbId,
      counts: planned.counts,
      scan: planned.scan,
      skippedDirs: planned.skippedDirs,
      started,
      note: started.ok ? '已建标准结构并开始导入；导入完成且核验通过后才切换当前库' : started.error,
    }
  }

  return { plan, start, status, cancel, setupFolder, isActive, jobs }
}
