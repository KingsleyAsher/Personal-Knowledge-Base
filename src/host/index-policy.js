import path from 'node:path'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { atomicJson, locked, relativePath, fail } from './workbench-state.js'

export const EXCLUDED_PARTITION = '排除索引分区'
export const policyFile = root => path.join(root, '.kbmeta', 'index-policy.json')
export const emptyPolicy = () => ({ format: 1, revision: 0, groups: {} })
const normalized = p => String(p || '').replaceAll('\\', '/').normalize('NFC').toLowerCase()
export const pathWithin = (p, prefix) => normalized(p) === normalized(prefix) || normalized(p).startsWith(normalized(prefix) + '/')

// Fail closed on damaged policy. Small metadata only; never cache across mutations.
export function readIndexPolicy(root) {
  if (!root) return emptyPolicy()
  let p
  try { p = JSON.parse(readFileSync(policyFile(root), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return emptyPolicy(); throw fail('INDEX_POLICY_CORRUPT', '索引排除策略无法读取，已停止索引操作') }
  if (p?.format !== 1 || !Number.isSafeInteger(p.revision) || !p.groups || typeof p.groups !== 'object' || Array.isArray(p.groups)) throw fail('INDEX_POLICY_CORRUPT', '索引排除策略格式损坏')
  for (const g of Object.values(p.groups)) {
    if (!g || !Array.isArray(g.files) || !['included', 'excluded', 'excluding', 'including', 'failed'].includes(g.state)) throw fail('INDEX_POLICY_CORRUPT', '资料排除记录损坏')
    for (const f of g.files) { relativePath(f.normal); relativePath(f.current); if (f.target) relativePath(f.target) }
  }
  return p
}
export function groupFor(policy, file) {
  return Object.values(policy.groups).find(g => g.files.some(f => [f.normal, f.current, f.target, ...(f.aliases || [])].filter(Boolean).some(p => normalized(p) === normalized(file))))
}
export function policyExcluded(policy, file, pending = true) {
  if (pathWithin(file, EXCLUDED_PARTITION) || pending && pathWithin(file, '90-收件箱')) return true
  return Object.values(policy.groups).some(g => (g.state !== 'included' || pending && g.pending) && g.files.some(f => [f.normal, f.current, f.target, ...(f.aliases || [])].filter(Boolean).some(p => pathWithin(file, p))))
}
export function policyExcludes(root) {
  const p = readIndexPolicy(root)
  return [EXCLUDED_PARTITION, ...Object.values(p.groups).filter(g => g.state !== 'included' || g.pending).flatMap(g => g.files.flatMap(f => [f.normal, f.current, f.target, ...(f.aliases || [])].filter(Boolean)))]
}
export function referenceExcluded(policy, file, target) {
  let name
  try { name = decodeURIComponent(String(target).split('#')[0].split('|')[0]) } catch { return true }
  if (/^[a-z][a-z0-9+.-]*:/i.test(name)) return false
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), name))
  if ([name, relative, name + '.md', relative + '.md'].some(p => policyExcluded(policy, p))) return true
  if (!name.includes('/')) {
    const stem = normalized(name).replace(/\.md$/, '')
    return Object.values(policy.groups).filter(g => g.state !== 'included').some(g => g.files.some(f => [f.normal, f.current].some(p => normalized(path.posix.basename(p)).replace(/\.md$/, '') === stem)))
  }
  return false
}
export function resolveAssetPath(root, file, policy) {
  const p = policy || readIndexPolicy(root), g = groupFor(p, file)
  return g?.files.find(f => [f.normal, f.current, f.target, ...(f.aliases || [])].filter(Boolean).some(p => normalized(p) === normalized(file)))?.current || file
}
export function excludedSource(root, file) {
  const p = readIndexPolicy(root), g = groupFor(p, file)
  return pathWithin(file, EXCLUDED_PARTITION) || Boolean(g && g.state !== 'included')
}
export async function savePolicy(root, policy) {
  policy.revision++
  await atomicJson(policyFile(root), policy)
}
export async function registerDerived(root, source, current, normal) {
  if (!source) return
  await locked(policyFile(root), async () => {
    const p = readIndexPolicy(root)
    let g = groupFor(p, source)
    if (!g && (pathWithin(source, EXCLUDED_PARTITION) || pathWithin(source, '90-收件箱'))) {
      const id = randomUUID()
      const excluded = pathWithin(source, EXCLUDED_PARTITION)
      g = p.groups[id] = { id, state: excluded ? 'excluded' : 'included', excluded, pending: true, files: [{ current: source, normal: excluded ? source.slice(EXCLUDED_PARTITION.length + 1) : source }], savedLinks: [] }
    }
    if (!g) return
    if (!g.files.some(f => normalized(f.current) === normalized(current))) g.files.push({ current, normal, ...(['excluding', 'including', 'failed'].includes(g.state) ? { target: g.excluded ? EXCLUDED_PARTITION + '/' + normal : normal } : {}) })
    await savePolicy(root, p)
  })
}
