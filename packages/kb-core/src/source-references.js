import { realpath, stat } from 'node:fs/promises'
import { readJson, safePath, relativePath, locked } from './workbench-state.js'
import { resolveAssetPath, readIndexPolicy, groupFor, policyFile, savePolicy } from './index-policy.js'

export const SOURCE_REFERENCE_MARKER = '<!-- kb:source-reference -->'
export const SOURCE_TEXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|log|ya?ml|html?|xml|js|mjs|cjs|ts|tsx|jsx|py|css|sql)$/i
export const isOriginalArchive = file => /(^|\/)(原件归档|_archive)(\/|$)/i.test(String(file).replaceAll('\\', '/'))

export function sourceReferenceBody(source) {
  const prefix = source.startsWith('排除索引分区/') ? '../../' : '../'
  const link = (prefix + source).split('/').map(part => encodeURIComponent(part).replaceAll('(', '%28').replaceAll(')', '%29')).join('/')
  return `${SOURCE_REFERENCE_MARKER}\n\n## 原件索引\n\n[查看原件](${link})\n\n正文和检索位置以原件的当前版本为准。\n`
}

// Only generated mirrors are redirected. A user's summary/note with a source
// declaration remains independently searchable. Legacy captures and imports
// are recognized from their durable creation records, not from filenames.
export async function sourceReferences(root, entries, parseFrontmatter, kbId) {
  const generated = new Set()
  const requests = await readJson(await safePath(root, '.kbmeta/requests.json', { missing: true }), {})
  for (const [id, item] of Object.entries(requests.items || {})) if (id.startsWith('capture-') && item?.op === 'create' && item.path) generated.add(item.path)
  const imports = await readJson(await safePath(root, '.kbmeta/import-sources.json', { missing: true }), {})
  const actualRoot = await realpath(root), roots = new Map()
  for (const item of Object.values(imports.entries || {})) {
    if (item?.kbId && kbId && item.kbId !== kbId) continue
    if (item?.mode === 'attach' && typeof item.sourceRoot === 'string' && !roots.has(item.sourceRoot)) roots.set(item.sourceRoot, await realpath(item.sourceRoot).catch(() => null))
    if (item?.entryPath && (item.mode === 'copy' || item.mode === 'attach' && roots.get(item.sourceRoot) === actualRoot)) generated.add(item.entryPath)
  }
  const result = new Map()
  for (const entry of entries) {
    if (!generated.has(entry.path) && !String(entry.text).includes(SOURCE_REFERENCE_MARKER)) continue
    const source = parseFrontmatter(entry.text || '').data.source
    if (typeof source !== 'string' || !SOURCE_TEXT.test(source)) continue
    try {
      const target = resolveAssetPath(root, relativePath(source))
      if (target !== entry.path) result.set(entry.path, target)
    } catch { /* Invalid source declarations never grant file access. */ }
  }
  return result
}

// Older completed imports left their policy groups marked pending. Repair only
// groups backed by a same-library completion record and two existing files.
export async function reconcileImportedSources(root, kbId) {
  const imports = await readJson(await safePath(root, '.kbmeta/import-sources.json', { missing: true }), {})
  if (!Object.keys(imports.entries || {}).length) return
  await locked(policyFile(root), async () => {
    const policy = readIndexPolicy(root); let changed = false
    for (const item of Object.values(imports.entries)) {
      if (item?.kbId !== kbId || !item.entryId || !item.originalPath || !item.entryPath) continue
      try {
        const source = resolveAssetPath(root, relativePath(item.originalPath), policy), entry = resolveAssetPath(root, relativePath(item.entryPath), policy)
        const group = groupFor(policy, source)
        if (group?.state !== 'included' || !group.pending || !group.files.some(f => f.current === entry)) continue
        if (!(await stat(await safePath(root, source))).isFile() || !(await stat(await safePath(root, entry))).isFile()) continue
        group.pending = false; changed = true
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'BAD_PATH') throw error }
    }
    if (changed) await savePolicy(root, policy)
  })
}
