import path from 'node:path'
import { stat, realpath } from 'node:fs/promises'
import { effectivePrivateDirs, derivedPrivatePartitions, readImportSources } from './fsindex.js'
import { deliverablesOf } from './workbench-deliverables.js'
import {readCatalog} from './file-catalog.js'
import { readIndexPolicy, resolveAssetPath } from './index-policy.js'
import { digest, fail, safePath, readJson, atomicJson, locked, DEFAULT_PREFERENCES, validatePreferences } from './workbench-state.js'

const INITIAL = { format: 1, revision: 0, defaults: DEFAULT_PREFERENCES, libraries: {}, onboarding: {}, pairs: {} }
const LIBRARY = { format: 1, revision: 0, links: [], captures: [], annotations: [], reading: {}, reviews: {}, tasks: [] }

export function createLibraryState({ stateDir, getCore, onMutation = () => {}, sharedState = false, restrictPreferences = x => x, policyScope = () => "" }) {
  const profileFile = path.join(stateDir, 'workbench', 'profile.json')
  const profile = () => readJson(profileFile, INITIAL)
  async function binding(expected) {
    const core = getCore()
    if (!core) throw fail('NOT_READY', '知识库服务尚未就绪')
    const st = await core.status()
    if (!st.kbPath || !st.kbId) throw fail('UNBOUND', '请先绑定并初始化知识库')
    if (expected != null && expected !== st.kbId) throw fail('BINDING_CHANGED', '知识库已切换，请刷新')
    const root = await realpath(st.kbPath)
    await core._internal.assertRuntimeOwner?.(root)
    const key = digest(st.kbId + '\0' + root.toLowerCase()).slice(0, 24)
    const prefs = await profile()
    if (sharedState) { const policy = await readJson(path.join(root, ".kbmeta/shared-policy.json"), null); if (policy?.preferences) prefs.libraries[key] = { value: policy.preferences, revision: policy.revision } }
    const stored = prefs.libraries[key]
    const preferences = restrictPreferences(validatePreferences(stored?.value ?? DEFAULT_PREFERENCES))
    const conf = await core.getConfig()
    const sources = await readImportSources(root)
    const deliverables = await deliverablesOf(root)
    const privateDirs = effectivePrivateDirs(conf.privateDirs, derivedPrivatePartitions(sources))
    const needsConfirmation = !stored && JSON.stringify(validatePreferences(prefs.defaults)) !== JSON.stringify(validatePreferences(DEFAULT_PREFERENCES))
    const fileCatalog=await readCatalog(root,st.kbId)
    return { core, st, root, key, preferences, needsConfirmation, preferencesRevision: stored?.revision ?? 0, profile: prefs, conf, sources, privateDirs,fileCatalog,
      deliverables, indexPolicy: readIndexPolicy(root), dataFile: sharedState ? path.join(root, '.kbmeta/shared-state.json') : path.join(stateDir, 'workbench', 'libraries', key + '.json') }
  }
  const versionOf = b => digest([b.key, b.preferencesRevision, b.conf.revision, b.indexPolicy?.revision || 0, b.fileCatalog?.policyRevision || 0, ...(policyScope() ? [policyScope()] : [])].join('|')).slice(0, 20)
  const userData = async b => {
    try { await stat(b.dataFile); const data = await readJson(b.dataFile, LIBRARY), policy = readIndexPolicy(b.root); for (const c of data.captures) { c.path = resolveAssetPath(b.root, c.path, policy); if (c.entryPath) c.entryPath = resolveAssetPath(b.root, c.entryPath, policy) }; return data }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    let restored
    try { restored = await readJson(await safePath(b.root, '.kbmeta/workbench-user-data.json'), LIBRARY) }
    catch (error) { if (error.code !== 'ENOENT') throw error; return structuredClone(LIBRARY) }
    if (restored.format !== 1 || !Array.isArray(restored.links) || !Array.isArray(restored.annotations) || !Array.isArray(restored.captures)) throw fail('STATE_CORRUPT', '恢复的用户数据格式不兼容')
    const result = { ...structuredClone(LIBRARY), ...restored }
    const policy = readIndexPolicy(b.root)
    for (const c of result.captures) { c.path = resolveAssetPath(b.root, c.path, policy); if (c.entryPath) c.entryPath = resolveAssetPath(b.root, c.entryPath, policy) }
    return result
  }
  async function mutate(b, args, fn) {
    if (args.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', '写入必须绑定当前知识库身份')
    return locked(b.dataFile, async () => {
      const current = await binding(b.st.kbId)
      if (versionOf(current) !== versionOf(b)) throw fail('SETTINGS_CHANGED', '设置已改变，请刷新')
      const data = await userData(b)
      if (args.expectedRevision !== data.revision) throw fail('CONFLICT', '内容已被其他窗口修改，请刷新后重试')
      const result = await fn(data)
      await binding(b.st.kbId)
      if (sharedState && args.operationId) data.lastOperationId = args.operationId
      data.revision++
      await atomicJson(b.dataFile, data)
      onMutation(args)
      return { ...result, revision: data.revision }
    })
  }
  return { profileFile, profile, binding, versionOf, userData, mutate,
    policySnapshot: b => ({ kbId: b.st.kbId, key: b.key, policyVersion: versionOf(b), configurationRevision: b.conf.revision, preferencesRevision: b.preferencesRevision, indexPolicyRevision: b.indexPolicy?.revision || 0 }) }
}
