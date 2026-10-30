import path from 'node:path'
import { constants, createReadStream } from 'node:fs'
import { readFile, writeFile, mkdir, stat, copyFile, unlink, rename, open } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { EXCLUDED_PARTITION, readIndexPolicy, groupFor, policyExcluded, pathWithin, policyFile, savePolicy } from './index-policy.js'
import { locked, safePath, relativePath, atomicJson, readJson, digest, fail } from './workbench-state.js'
import { walkTree } from './fsindex.js'
import { extractReferences, extractHtmlReferences } from './workbench-links.js'

// A durable file-group journal: policies are committed before the first move.
// On failure both source/destination remain denied until an explicit retry.
export function createIndexPolicyService({ userData, getParsing, invalidate, purge, rebuild, notify }) {
  async function fileDigest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
  async function discover(b, selected, data, policy) {
    const files = new Set(selected), links = [], jobs = []
    const walk = await walkTree(b.root, b.root, { maxFiles: Number.MAX_SAFE_INTEGER, maxDepth: Number.MAX_SAFE_INTEGER, followLinks: false })
    if (walk.truncated || walk.coverage?.errors) throw fail('SCAN_INCOMPLETE', '无法完整确认资料归属，请排除扫描故障后重试')
    for (const c of data.captures) if (c.entryPath) links.push([c.path, c.entryPath])
    for (const s of Object.values(b.sources || {})) if (s.entryPath && s.originalPath && (s.mode === 'copy' || s.sourceRoot === b.root)) links.push([s.originalPath, s.entryPath])
    for (const g of Object.values(policy.groups)) for (const f of g.files) links.push([g.files[0]?.current, f.current])
    for (const f of walk.files.filter(f => f.path.endsWith('.md'))) {
      const handle = await open(await safePath(b.root, f.path), 'r')
      let text
      try { const buffer = Buffer.alloc(65536), result = await handle.read(buffer, 0, buffer.length, 0); text = buffer.subarray(0, result.bytesRead).toString('utf8') } finally { await handle.close() }
      if (text.startsWith('---') && !/\n---/.test(text)) throw fail('SOURCE_METADATA_TOO_LARGE', '资料来源元数据不完整，未移动：' + f.path)
      const source = b.core._internal.parseFrontmatter(text).data.source
      for (let p of Array.isArray(source) ? source : typeof source === 'string' ? [source] : []) {
        try { p = relativePath(p); links.push([p, f.path]) } catch { /* External provenance is not a local asset. */ }
      }
    }
    const parser = getParsing()
    if (parser?.listJobs) {
      for (let offset = 0; ; offset += 500) {
        const result = await parser.listJobs({ offset, limit: 500 })
        if (result.ok === false) throw fail('PARSE_STATE_UNREADABLE', '无法确认解析产物，未移动资料')
        for (const j of result.jobs || []) if (!j.source?.external) { jobs.push(j); if (j.land?.path) links.push([j.source.relPath, j.land.path]) }
        if ((result.jobs || []).length < 500) break
      }
    }
    let changed = true
    while (changed) { changed = false; for (const [a, z] of links) if (a && z && (files.has(a) || files.has(z))) for (const p of [a, z]) if (!files.has(p)) { files.add(p); changed = true } }
    return { members: [...files].filter(p => walk.files.some(f => f.path === p)), jobs }
  }

  async function set(b, args) {
    if (typeof args.excluded !== 'boolean') throw fail('BAD_POLICY', '请明确选择排除或取消排除')
    const selected = [...new Set((args.paths || [args.path]).map(relativePath))]
    if (!selected.length || selected.length > 500) throw fail('BAD_SELECTION', '请选择 1–500 份资料')
    for (const file of selected) {
      if (file.split('/')[0].startsWith('.') || /^(?:索引层|_模板|_手册)(?:\/|$)/.test(file) || /^(INDEX|AGENTS|README)\.md$/.test(file)) throw fail('SYSTEM_FILE', '系统文件不能作为资料移动')
      if (!(await stat(await safePath(b.root, file))).isFile()) throw fail('NOT_FILE', '请选择资料文件')
    }
    return locked(path.join(b.root, '.kbmeta', 'index-policy-operation'), async () => {
      const current = readIndexPolicy(b.root)
      if (args.expectedPolicyRevision != null && args.expectedPolicyRevision !== current.revision) throw fail('CONFLICT', '排除状态已变化，请刷新后重试')
      if (selected.every(file => { const g = groupFor(current, file); return g ? g.state === (args.excluded ? 'excluded' : 'included') : !args.excluded && !pathWithin(file, EXCLUDED_PARTITION) })) return { ok: true, unchanged: true, excluded: args.excluded, mapping: {}, groups: [...new Set(selected.map(p => groupFor(current, p)?.id).filter(Boolean))], policyRevision: current.revision }
      let groups, mapping = {}, removed = []
      try {
        await locked(b.dataFile, () => b.core._internal.withMutationLock(b.root, async () => {
          const data = await userData(b), policy = readIndexPolicy(b.root)
          if (args.expectedPolicyRevision != null && args.expectedPolicyRevision !== policy.revision) throw fail('CONFLICT', '排除状态已变化，请刷新后重试')
          const processed = new Set(); groups = []
          for (const file of selected) {
            if (processed.has(file)) continue
            let g = groupFor(policy, file)
            const { members, jobs } = await discover(b, g ? g.files.map(f => f.current) : [file], data, policy)
            if (!g) { const id = randomUUID(); g = policy.groups[id] = { id, files: [], savedLinks: [], pending: file.startsWith('90-收件箱/') } }
            for (const member of members) {
              const other = groupFor(policy, member)
              if (other && other.id !== g.id) { g.files.push(...other.files.filter(f => !g.files.some(x => x.current === f.current))); g.savedLinks.push(...other.savedLinks || []); delete policy.groups[other.id] }
              if (!g.files.some(f => f.current === member)) g.files.push({ current: member, normal: member.startsWith(EXCLUDED_PARTITION + '/') ? member.slice(EXCLUDED_PARTITION.length + 1) : member })
              processed.add(member)
            }
            if (args.excluded && getParsing()?.readJob) for (const j of jobs.filter(j => ['succeeded','partial'].includes(j.status) && g.files.some(f => [f.current, f.normal, ...(f.aliases || [])].includes(j.source.relPath)))) {
              const job = await getParsing().readJob(j.jobId)
              if (!job?.result || !/^[A-Za-z0-9._-]+$/.test(j.jobId)) continue
              const current = EXCLUDED_PARTITION + '/解析文件/' + j.jobId + '.md'
              if (g.files.some(f => f.current === current)) continue
              const target = await safePath(b.root, current, { missing: true })
              await mkdir(path.dirname(target), { recursive: true })
              const text = '---\nsource: ' + JSON.stringify(j.source.relPath) + '\n---\n\n' + String(job.result.plainText ?? job.result.text ?? '')
              try { await writeFile(target, text, { encoding: 'utf8', flag: 'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e; if (await readFile(target, 'utf8') !== text) throw fail('DESTINATION_EXISTS', '解析文件已存在不同内容，未覆盖') }
              g.files.push({ current, normal: '50-底稿/解析文件/' + j.jobId + '.md' })
            }
            g.excluded = args.excluded; g.state = args.excluded ? 'excluding' : 'including'; g.error = null
            for (const f of g.files) {
              f.target = args.excluded ? EXCLUDED_PARTITION + '/' + f.normal : f.normal
              if (f.current !== f.target) {
                const source = await safePath(b.root, f.current, { missing: true }), target = await safePath(b.root, f.target, { missing: true })
                const sourceHash = await fileDigest(source).catch(e => { if (e.code === 'ENOENT' && f.sha256) return null; throw e })
                if (sourceHash) f.sha256 = sourceHash
                const existing = await fileDigest(target).catch(e => { if (e.code === 'ENOENT') return null; throw e })
                if (existing && existing !== f.sha256) throw fail('DESTINATION_EXISTS', '归档目标已存在不同内容，未覆盖：' + f.target)
              }
              removed.push(f.current)
            }
            groups.push(g.id)
          }
          // Remove active manual chains; retain their definitions as management
          // metadata so re-inclusion can reconstruct the same user relationships.
          for (const id of groups) {
            const g = policy.groups[id], touched = p => g.files.some(f => [f.normal, f.current, f.target].includes(p))
            const affected = data.links.filter(l => touched(l.from) || touched(l.to))
            for (const l of affected) if (!g.savedLinks.some(x => x.id === l.id)) g.savedLinks.push(l)
            data.links = data.links.filter(l => !touched(l.from) && !touched(l.to))
          }
          await locked(policyFile(b.root), () => savePolicy(b.root, policy))
          data.revision++; await atomicJson(b.dataFile, data)
        }))
        invalidate()
        await purge(b)
        await locked(b.dataFile, () => b.core._internal.withMutationLock(b.root, async () => {
          const data = await userData(b), policy = readIndexPolicy(b.root)
          for (const id of groups) {
            const g = policy.groups[id]
            for (const f of g.files) {
              if (f.current === f.target) continue
              const from = await safePath(b.root, f.current, { missing: true }), to = await safePath(b.root, f.target, { missing: true })
              await mkdir(path.dirname(to), { recursive: true })
              try { await copyFile(from, to, constants.COPYFILE_EXCL) } catch (e) { if (e.code !== 'EEXIST' && e.code !== 'ENOENT') throw e }
              if (await fileDigest(to) !== f.sha256) throw fail('MOVE_VERIFY_FAILED', '资料移动校验失败，原件已保留')
              const original = await fileDigest(from).catch(e => { if (e.code === 'ENOENT') return null; throw e })
              if (original && original !== f.sha256) throw fail('FILE_CHANGED', '资料在移动期间变化，原件已保留')
              if (original) await unlink(from)
              f.aliases = [...new Set([...(f.aliases || []), f.current])]
              mapping[f.current] = f.target; f.current = f.target
              await locked(policyFile(b.root), () => savePolicy(b.root, policy))
            }
          }
          for (const id of groups) for (const f of policy.groups[id].files) for (const p of f.aliases || []) mapping[p] = f.current
          // Rebase source declarations and links inside moved documents. Incoming
          // links in unrelated notes stay intact and reconnect on restoration.
          for (const id of groups) for (const f of policy.groups[id].files) {
            if (!/\.(md|html?)$/i.test(f.current)) continue
            const originalPath = Object.entries(mapping).find(([, to]) => to === f.current)?.[0] || f.current
            const abs = await safePath(b.root, f.current), text = await readFile(abs, 'utf8')
            const refs = /\.html?$/i.test(f.current) ? extractHtmlReferences(text) : extractReferences(text)
            let output = text
            for (const ref of refs.sort((a, z) => z.start - a.start)) {
              let decoded; try { decoded = decodeURIComponent(ref.target) } catch { continue }
              const relative = path.posix.normalize(path.posix.join(path.posix.dirname(originalPath), decoded))
              const target = mapping[decoded] || mapping[relative]
              if (!target) continue
              const updated = (ref.wiki || ref.type === 'source' ? target : path.posix.relative(path.posix.dirname(f.current), target)) + (ref.anchor || '')
              output = output.slice(0, ref.start) + updated + output.slice(ref.end)
            }
            if (output !== text) { const temp = abs + '.' + randomUUID() + '.tmp'; await writeFile(temp, output, { encoding: 'utf8', flag: 'wx' }); await rename(temp, abs) }
          }
          const resolve = p => mapping[p] || p
          for (const c of data.captures) { c.path = resolve(c.path); if (c.entryPath) c.entryPath = resolve(c.entryPath) }
          for (const a of data.annotations) a.path = resolve(a.path)
          for (const key of ['reading', 'reviews']) data[key] = Object.fromEntries(Object.entries(data[key] || {}).map(([p, v]) => [resolve(p), v]))
          for (const id of groups) {
            const g = policy.groups[id]
            g.state = args.excluded ? 'excluded' : 'included'; g.error = null
          }
          for (const g of Object.values(policy.groups).filter(g => g.state === 'included')) {
            for (const l of g.savedLinks || []) {
              const link = { ...l, from: resolve(l.from), to: resolve(l.to) }
              if (policyExcluded(policy, link.from) || policyExcluded(policy, link.to)) continue
              if (!data.links.some(x => x.id === link.id)) data.links.push(link)
            }
          }
          data.revision++; await atomicJson(b.dataFile, data)
          await locked(policyFile(b.root), () => savePolicy(b.root, policy))
        }))
        invalidate()
        await rebuild(b, removed)
        notify({ type: 'files-changed', kbId: b.st.kbId, operation: 'index.policy.set' })
        return { ok: true, excluded: args.excluded, mapping, groups, policyRevision: readIndexPolicy(b.root).revision }
      } catch (e) {
        if (groups?.length) await locked(policyFile(b.root), async () => {
          const p = readIndexPolicy(b.root)
          for (const id of groups) if (p.groups[id]) { p.groups[id].state = 'failed'; p.groups[id].error = e.message }
          await savePolicy(b.root, p)
        })
        if (groups?.length) {
          await locked(b.dataFile, async () => {
            const data = await userData(b), policy = readIndexPolicy(b.root)
            data.links = data.links.filter(l => !policyExcluded(policy, l.from) && !policyExcluded(policy, l.to))
            data.revision++; await atomicJson(b.dataFile, data)
          }).catch(() => {})
          await purge(b).catch(() => {})
        }
        invalidate(); throw e
      }
    })
  }
  return { set }
}
