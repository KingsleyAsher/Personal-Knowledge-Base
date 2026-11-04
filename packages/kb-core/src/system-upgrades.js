import { readFile } from 'node:fs/promises'
import { digest, safePath, readJson, atomicJson, locked, fail } from './workbench-state.js'
import { atomicText, syncManagedFiles } from './managed-files.js'

export function createSystemUpgrades({ binding, catalog, runtime, retrieval, now = Date.now }) {
  const pending = new Map(), checked = new Set()
  const statePath = b => safePath(b.root, '.kbmeta/system-state.json', { missing: true })
  const checkIdentity = async b => { if ((await binding(b.st.kbId)).key !== b.key) throw fail('SETTINGS_CHANGED', '知识库身份已改变') }
  async function check(b, force = false) {
    const info = await runtime({retry:force}), stamp = b.key + ':' + info.buildId
    if (pending.has(stamp)) return pending.get(stamp)
    if (!force && checked.has(stamp)) return readJson(await statePath(b), {})
    const task = (async () => {
      const file = await statePath(b)
      return locked(file, async () => {
        const old = await readJson(file, { format: 1, migrations: [] })
        if (old.format !== 1) throw fail('UPGRADE_FORMAT', '升级记录格式不兼容，未覆盖')
        const next = { ...old, program: { version: info.version, buildId: info.buildId },runtimeId:info.runtimeId, checkedAt: now(), status: 'checking', protectedFiles: ['AGENTS.md', 'INDEX.md'], errors: [] }
        await atomicJson(file, next)
        try {
          await checkIdentity(b)
          const managed = await syncManagedFiles({ root: b.root, items: await catalog(), manifest: '.kbmeta/managed-files.json', backup: '.kbmeta/backups/upgrades', candidates: '.kbmeta/upgrades/candidates', check: () => checkIdentity(b), now })
          next.managed = managed
          const newlyChanged = managed.files.some(r => (['created', 'updated'].includes(r.status)||r.requiresActivation) && r.needsNewSession)
          next.activation = old.activation || 'current'
          if(old.runtimeId!==info.runtimeId&&old.activation==='restart-required')next.activation='new-session-required'
          if (newlyChanged || info.external?.needsNewSession) next.activation = 'new-session-required'
          if(info.external?.needsRestart)next.activation='restart-required'
          next.external = info.external || null
          next.mechanisms = { fulltext: { format: 2, tokenizer: 'fulltext-v1' }, vector: await retrieval.reconcile(b), templates: info.version, rules: 'preserved-user-content', questionProtocol: 2 }
          const status = await b.core.status()
          if (['index-format-old', 'index-tokenizer-old'].includes(status.index?.reason)) {
            const result = await b.core.maintainIndex({ expectedKbId: b.st.kbId, expectedRevision: b.conf.revision, full: true, automatic: true })
            next.mechanisms.fulltext.migration = { ok: result.ok, reason: result.reason || null }
            if (!result.ok) throw fail('INDEX_UPGRADE_PENDING', '全文索引升级待处理，全文扫描仍可用')
          }
          await checkIdentity(b)
          next.status = managed.conflicts || (info.external?.conflicts || 0) ? 'attention' : next.mechanisms.vector.requiresBuild?(['paused','failed'].includes(next.mechanisms.vector.state)?'index-paused':'index-building'):'current'
          next.checkedBuildId=info.buildId
          if(next.status==='current')next.appliedBuildId=info.buildId
          const migration = 'mechanisms:' + info.buildId
          next.migrations = [...new Set([...(old.migrations || []), migration])]
          next.completedAt = now()
        } catch (error) {
          next.status = 'failed'; next.errors = [{ code: error.code || 'UPGRADE_ERROR', message: error.code ? error.message : '升级未完成，文件与旧索引已保留' }]
        }
        await atomicJson(file, next)
        if (['current','attention'].includes(next.status)&&!next.mechanisms?.vector?.requiresBuild) checked.add(stamp)
        return next
      })
    })()
    pending.set(stamp, task)
    try { return await task } finally { pending.delete(stamp) }
  }
  async function dispatch(b, args, caller) {
    if (caller) throw fail('ADMIN_ONLY', '升级处理仅供知识库设置使用')
    if (['upgrade.get', 'upgrade.check', 'upgrade.retry'].includes(args.op)) return { upgrade: await check(b, args.op !== 'upgrade.get') }
    if(args.op==='upgrade.external-diff'){
      const info=await runtime(),source=info.external?.[args.scope]
      if(!['skills','preset'].includes(args.scope)||!source?.target)throw fail('UPGRADE_FILE_DENIED','未知外部托管范围')
      const record=source.files?.find(r=>r.path===args.path)
      if(!record?.candidate)throw fail('UPGRADE_FILE_DENIED','没有待处理候选')
      const current=await readFile(await safePath(source.target,record.path),'utf8'),candidate=await readFile(await safePath(source.target,record.candidate),'utf8')
      const displayed=args.scope==='preset'?current.replace(/^(\s*(?:-\s*)?(?:api_?key|secret|password|token|authorization|\w+ApiKey|\w+Secret)\s*:).*$/gmi,'$1 [隐藏凭据]'):current
      return {path:record.path,current:displayed,candidate,currentHash:digest(current),external:true,manualMerge:args.scope==='preset'}
    }
    const items = await catalog(), item = items.find(i => i.path === args.path)
    if (!item) throw fail('UPGRADE_FILE_DENIED', '不是可处理的插件托管文件')
    const manifestFile = await safePath(b.root, '.kbmeta/managed-files.json')
    if (args.op === 'upgrade.diff') {
      const file = await safePath(b.root, item.path, { missing: true })
      const current = await readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e })
      return { path: item.path, current, candidate: item.content, currentHash: digest(current) }
    }
    if (!['upgrade.keep-local', 'upgrade.apply'].includes(args.op)) throw fail('BAD_OPERATION', '未知升级操作')
    await locked(manifestFile, async () => {
      await checkIdentity(b)
      const state = await readJson(manifestFile, {}), record = state.files?.[item.path]
      if (!record) throw fail('UPGRADE_FILE_DENIED', '缺少托管文件记录')
      const file = await safePath(b.root, item.path), current = await readFile(file)
      if (digest(current) !== args.currentHash) throw fail('FILE_CHANGED', '文件已改变，请重新查看差异')
      if (args.op === 'upgrade.keep-local') { record.status = 'kept-local'; record.currentHash = digest(current) }
      else {
        // The UI must explicitly confirm replacement of a locally edited file.
        if (args.confirm !== true || item.block) throw fail('CONFIRM_REQUIRED', '请确认差异；区块冲突须手工处理')
        record.backup = '.kbmeta/backups/upgrades/manual-' + now() + '/' + item.path + '.bak'
        await atomicText(await safePath(b.root, record.backup, { missing: true }), current)
        await checkIdentity(b)
        if (digest(await readFile(file)) !== args.currentHash) throw fail('FILE_CHANGED', '文件已改变，未覆盖')
        await atomicText(file, item.content)
        if(digest(await readFile(file))!==digest(item.content))throw fail('UPGRADE_VERIFY','候选写入校验失败')
        record.requiresActivation=Boolean(record.needsNewSession)
        record.appliedHash = digest(item.content); record.currentHash = record.appliedHash; record.status = 'updated'
      }
      await atomicJson(manifestFile, state)
    })
    return { upgrade: await check(b, true) }
  }
  return { check, dispatch }
}
