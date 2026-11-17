import path from 'node:path'
import { readdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { atomic, bytes, hash, readJson, error } from './io.js'
const blank = kbId => ({ schemaVersion: 1, format: 1, kbId, revision: 0, links: [], captures: [], annotations: [], reading: {}, reviews: {}, trashOperations: {}, tasks: [] })
const arrays = ['links', 'captures', 'annotations', 'tasks'], maps = ['reading', 'reviews', 'trashOperations']
const equal = (a, b) => hash(a) === hash(b)
export function createMigration({ root, privateDir, identity, sources, getWriteSequence, fault = async () => {} }) {
  const plans = new Map(), journalFile = path.join(privateDir, 'migration.json')
  async function assertReconciled() {
    for(const name of ['workbench-user-data.json','workbench-flows.json']) if(await bytes(path.join(root,'.kbmeta',name))) throw error('RECOVERY_REQUIRED','Library recovery copy must be reconciled as an explicit source: '+name)
    const trash=await readdir(path.join(root,'.kbmeta/trash')).catch(e=>{if(e.code==='ENOENT')return [];throw e})
    // Settled legacy recycle-bin entries remain in place. Only an unfinished
    // transaction blocks the handoff; historical trash is not discarded.
    for(const id of trash){
      if(!/^[a-f0-9-]{36}$/i.test(id))throw error('RECOVERY_REQUIRED','Unknown legacy recycle-bin entry')
      const item=await readJson(path.join(root,'.kbmeta/trash',id,'manifest.json'),null)
      if(item?.id!==id||item.kbId!==identity.kbId||item.format!==1||!['stored','restored','purged'].includes(item.state))throw error('RECOVERY_REQUIRED','Finish the legacy recycle-bin transaction before switching writers')
      if(item.state==='stored'){const payload=await bytes(path.join(root,'.kbmeta/trash',id,'payload'));if(!payload||hash(payload)!==item.sha256)throw error('RECOVERY_REQUIRED','Legacy recycle-bin payload did not verify')}
    }
  }
  async function collect(ids) {
    await assertReconciled()
    const found = []
    for (const id of ids) {
      const stateDir = sources[id]
      if (!stateDir) throw error('BAD_REQUEST', 'Unknown configured source handle')
      const key = hash(identity.kbId + '\0' + root.toLowerCase()).slice(0, 24)
      const files = ['config.json', 'binding.json', 'workbench/profile.json', 'workbench/libraries/' + key + '.json']
      const raw = await Promise.all(files.map(f => bytes(path.join(stateDir, f))))
      const values = raw.map(b => b ? JSON.parse(b) : null), [config, binding, profile, data] = values
      if (!config || !binding || binding.kbId !== identity.kbId || path.resolve(binding.kbPath).toLowerCase() !== root.toLowerCase()) throw error('BINDING_CHANGED', 'Source binding does not match this library')
      // In-flight engines are outside this phase's handoff scope. Never silently discard.
      for (const dir of ['parse', 'imports', 'flows']) {
        const entries = await readdir(path.join(stateDir, dir)).catch(e => { if (e.code === 'ENOENT') return []; throw e })
        if (entries.length) throw error('RECOVERY_REQUIRED', 'Engine state requires explicit reconciliation before migration: ' + dir)
      }
      found.push({ id, stateDir, files, raw, config, binding, profile, data: data ?? blank(identity.kbId), key })
    }
    return found
  }
  async function preview(ids) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw error('BAD_REQUEST', 'Choose distinct source handles')
    const rows = await collect(ids), candidate = blank(identity.kbId), conflicts = []
    let policy = null
    for (const row of rows) {
      const data = row.data
      if (data.format !== 1 || !Number.isSafeInteger(data.revision)) conflicts.push({ sourceId: row.id, reason: 'UNSUPPORTED_FORMAT' })
      for (const field of Object.keys(data)) if (!['schemaVersion', 'kbId', 'format', 'revision', ...arrays, ...maps].includes(field)) conflicts.push({ sourceId: row.id, field, reason: 'UNMAPPED_STATE' })
      for (const field of arrays) {
        if (!Array.isArray(data[field] ?? [])) throw error('RECOVERY_REQUIRED', 'Invalid source array')
        for (const item of data[field] ?? []) {
          if (!item.id) { conflicts.push({ sourceId: row.id, field, reason: 'MISSING_ID' }); continue }
          if (field === 'tasks' && !['done', 'completed', 'failed', 'cancelled'].includes(item.status)) conflicts.push({ sourceId: row.id, field, reason: 'IN_FLIGHT_TASK' })
          const old = candidate[field].find(x => x.id === item.id)
          if (!old) candidate[field].push(item)
          else if (!equal(old, item)) conflicts.push({ sourceId: row.id, field, id: item.id, reason: 'VALUE_CONFLICT' })
        }
      }
      for(const field of maps)if(data[field]!==undefined&&(!data[field]||Array.isArray(data[field])||typeof data[field]!=='object'))conflicts.push({sourceId:row.id,field,reason:'INVALID_MAP'})
      for (const field of maps) for (const [key, value] of Object.entries(data[field] && !Array.isArray(data[field]) ? data[field] : {})) {
        if(field==='trashOperations'&&!['moved','restored'].includes(value)){conflicts.push({sourceId:row.id,field,reason:'IN_FLIGHT_TRASH'});continue}
        if (!Object.hasOwn(candidate[field], key)) candidate[field][key] = value
        else if (!equal(candidate[field][key], value)) conflicts.push({ sourceId: row.id, field, reason: 'VALUE_CONFLICT' })
      }
      const next = { schemaVersion: 1, revision: 0, categories: row.config.categories, privateDirs: row.config.privateDirs, excludeFromSearch: row.config.excludeFromSearch, autoIndex:row.config.autoIndex!==false, preferences: row.profile?.libraries?.[row.key]?.value ?? row.profile?.defaults }
      // Conflicting policies block switching, including different privacy/backup settings.
      if (policy && !equal(policy, next)) conflicts.push({ sourceId: row.id, reason: 'POLICY_CONFLICT' })
      policy ??= next
    }
    const id = randomUUID(), sourceDigests = rows.map(row => ({ id: row.id, digest: hash(row.raw.map(b => b ? hash(b) : null)) }))
    const result = { planId: id, ready: !conflicts.length, conflicts, sourceDigests, counts: Object.fromEntries([...arrays, ...maps].map(k => [k, Array.isArray(candidate[k]) ? candidate[k].length : Object.keys(candidate[k]).length])), committed: false }
    plans.set(id, { result, ids, candidate, policy })
    return result
  }
  const targetNames = ['shared-state.json', 'shared-policy.json', 'service-mode.json']
  async function recover(direction = 'rollback') {
    if (!['rollback', 'complete'].includes(direction)) throw error('BAD_REQUEST')
    const journal = await readJson(journalFile, null)
    if (!journal) return { state: 'clean' }
    if (journal.state === 'rolled-back') return { state: journal.state }
    if (journal.state === 'committed' && getWriteSequence() !== journal.writeSequence) throw error('CONFLICT', 'New shared writes exist; export and reconcile before rollback')
    // Validate ALL targets before changing any. Preserve outside edits.
    for (const row of journal.targets) {
      const current = await bytes(path.join(root, '.kbmeta', row.name)), digest = current ? hash(current) : null
      if (digest !== row.beforeHash && digest !== row.afterHash) throw error('RECOVERY_REQUIRED', 'Target changed outside migration; no recovery target was overwritten')
    }
    for (const row of [...journal.targets].reverse()) {
      const data = direction === 'complete' ? row.after : row.before, file = path.join(root, '.kbmeta', row.name)
      if (data === null) await unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e })
      else await atomic(file, Buffer.from(data, 'base64'))
    }
    journal.state = direction === 'complete' ? 'committed' : 'rolled-back'; await atomic(journalFile, journal)
    return { state: journal.state }
  }
  async function commit({ planId, quiescent, ownerToken, instanceId, freshPolicy }) {
    await assertReconciled()
    if (quiescent !== true) throw error('STATE_BUSY', 'A stopped legacy-writer window must be explicitly confirmed')
    const oldJournal = await readJson(journalFile, null)
    if (oldJournal && !['committed', 'rolled-back'].includes(oldJournal.state)) throw error('RECOVERY_REQUIRED')
    if (await bytes(path.join(root, '.kbmeta/service-mode.json'))) throw error('CONFLICT', 'Already in service mode')
    let candidate, policy
    if (planId === 'fresh') {
      if (Object.keys(sources).length || await bytes(path.join(root, '.kbmeta/workbench-user-data.json'))) throw error('CONFLICT', 'Existing state requires a migration preview')
      candidate = blank(identity.kbId); policy = freshPolicy
    } else {
      const plan = plans.get(planId)
      if (!plan?.result.ready) throw error('CONFLICT', 'Resolve preview conflicts first')
      const rows = await collect(plan.ids)
      if (!equal(rows.map(row => ({ id: row.id, digest: hash(row.raw.map(b => b ? hash(b) : null)) })), plan.result.sourceDigests)) throw error('CONFLICT', 'Source changed after preview')
      candidate = plan.candidate; policy = plan.policy
    }
    const values = [candidate, policy, { schemaVersion: 1, kbId: identity.kbId, instanceId, ownerToken, state: 'active' }], targets = []
    for (let i = 0; i < targetNames.length; i++) {
      const name = targetNames[i], before = await bytes(path.join(root, '.kbmeta', name)), after = Buffer.from(JSON.stringify(values[i], null, 2) + '\n')
      if (before) throw error('CONFLICT', 'Existing shared state requires explicit reconciliation')
      targets.push({ name, before: before?.toString('base64') ?? null, beforeHash: before ? hash(before) : null, after: after.toString('base64'), afterHash: hash(after) })
    }
    const journal = { schemaVersion: 1, id: randomUUID(), state: 'prepared', writeSequence: getWriteSequence(), targets }
    await atomic(journalFile, journal)
    // Install barrier FIRST; all compatible old embedded writers now fail closed.
    const order = [targets[2], targets[0], targets[1]]
    try {
      journal.state = 'applying'; await atomic(journalFile, journal)
      for (const row of order) { await atomic(path.join(root, '.kbmeta', row.name), Buffer.from(row.after, 'base64')); await fault('migration:' + row.name) }
      journal.state = 'committed'; await atomic(journalFile, journal)
      return { committed: true, transactionId: journal.id, sourcesPreserved: true }
    } catch (e) { await recover('rollback'); throw e }
  }
  return { preview, commit, recover, journal: () => readJson(journalFile, null) }
}
