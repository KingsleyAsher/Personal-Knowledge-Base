import path from 'node:path'
import { mkdir, readFile, writeFile, stat, copyFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { walkTree } from './fsindex.js'
import { digest, fail, relativePath, safePath, readJson, atomicJson, locked, inside } from './workbench-state.js'

export async function deliverablesOf(root) { return readJson(await safePath(root, '.kbmeta/deliverables.json', { missing: true }), { items: [], tasks: {} }) }
export function deliverablePrivate(registry, file) {
  if (!file.startsWith('任务成品/')) return false
  const task = file.split('/').slice(0, 2).join('/')
  return registry.tasks[task]?.private !== false || registry.items.find(i => i.path === file)?.private === true
}
export function createDeliverableService({ binding, versionOf, isPrivate, assertVisible, now }) {
  const imports = new Map()
  const taskName = value => {
    const name = String(value || '').trim()
    if (!name || name.length > 80 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name.startsWith('.')) throw fail('BAD_TASK', '任务名必须为有效的单层文件夹名称')
    return name
  }
  return { async dispatch(b, args) {
    const file = await safePath(b.root, '.kbmeta/deliverables.json', { missing: true })
    if (args.op === 'deliverables.list') return { items: b.deliverables.items.filter(i => { try { assertVisible(b, i.path); return true } catch { return false } }), directory: path.join(b.root, '任务成品') }
    if (args.op === 'deliverables.import-preview') {
      const external = path.resolve(String(args.directory || ''))
      if (!path.isAbsolute(args.directory || '') || inside(b.root, external) || inside(external, b.root)) throw fail('BAD_IMPORT', '请选择知识库外独立的既有成品文件夹')
      const scan = await walkTree(external, external, { maxFiles: 1000, followLinks: false })
      if (scan.coverage.errors || scan.truncated || !scan.files.length) throw fail('INCOMPLETE_IMPORT', '目录为空或无法完整扫描，请缩小范围')
      const files = []
      for (const f of scan.files) { const abs = await safePath(external, f.path); const s = await stat(abs); if (s.size > 32 * 1024 * 1024) throw fail('IMPORT_TOO_LARGE', '单个成品不能超过 32 MiB'); files.push({ path: f.path, bytes: s.size, hash: digest(await readFile(abs)) }) }
      const previewId = randomUUID(), task = taskName(args.task || path.basename(external))
      imports.set(previewId, { key: b.key, version: versionOf(b), root: external, task, files, expires: now() + 600000 })
      return { previewId, task, files, destination: '任务成品/' + task, note: '确认后复制原件，源文件保留。默认作为隐私成品，可在登记时声明来源。' }
    }
    if (args.expectedKbId !== b.st.kbId) throw fail('IDENTITY_REQUIRED', '请确认成品目标知识库')
    return locked(file, async () => {
      const data = await deliverablesOf(b.root)
      if (args.op === 'deliverables.import-confirm') {
        const p = imports.get(args.previewId)
        if (!p || p.key !== b.key || p.version !== versionOf(b) || p.expires < now()) throw fail('PREVIEW_EXPIRED', '导入预览已过期')
        const task = '任务成品/' + p.task, destination = await safePath(b.root, task, { missing: true })
        for (const f of p.files) if (digest(await readFile(await safePath(p.root, f.path))) !== f.hash) throw fail('FILE_CHANGED', '源文件已改变，请重新扫描')
        const created = []
        try {
          await binding(b.st.kbId)
          for (const f of p.files) { const target = await safePath(b.root, task + '/' + f.path, { missing: true }); await mkdir(path.dirname(target), { recursive: true }); await copyFile(await safePath(p.root, f.path), target, 1); created.push(target); data.items.push({ path: task + '/' + f.path, title: path.basename(f.path), description: '既有成品导入', private: true, revision: f.hash, at: new Date(now()).toISOString() }) }
          data.tasks[task] = { private: true, sources: [] }; await atomicJson(file, data)
        } catch (e) { for (const f of created) await unlink(f).catch(() => {}); throw e }
        imports.delete(args.previewId); return { imported: created.length, directory: destination }
      }
      const task = '任务成品/' + taskName(args.task), sources = Array.isArray(args.sources) ? args.sources.map(relativePath) : []
      for (const src of sources) { assertVisible(b, src); await safePath(b.root, src) }
      const privateValue = args.private !== false || sources.some(src => isPrivate(b, src)) || data.tasks[task]?.private === true
      if (args.op === 'deliverables.prepare') {
        await mkdir(await safePath(b.root, task, { missing: true }), { recursive: true })
        data.tasks[task] = { private: privateValue, sources }; await atomicJson(file, data)
        return { directory: path.join(b.root, ...task.split('/')), relativeDirectory: task, private: privateValue, instruction: '生成后调用 kb_deliverable register 登记每个文件及检索文字。' }
      }
      if (args.op === 'deliverables.register') {
        const rel = relativePath(args.path)
        if (!rel.startsWith(task + '/')) throw fail('OUTSIDE_TASK', '成品必须位于已准备的任务目录下')
        const abs = await safePath(b.root, rel), s = await stat(abs)
        if (!s.isFile() || s.size > 32 * 1024 * 1024) throw fail('BAD_DELIVERABLE', '文件不存在或大于 32 MiB')
        let text = String(args.text || '').slice(0, 2 * 1024 * 1024)
        if (/\.(md|txt|csv|json|html)$/i.test(rel)) text = (await readFile(abs, 'utf8')).slice(0, 2 * 1024 * 1024)
        const item = { path: rel, title: String(args.title || path.basename(rel)).slice(0, 200), description: String(args.description || '').slice(0, 2000), text, private: privateValue, sources, revision: digest(await readFile(abs)), at: new Date(now()).toISOString() }
        data.tasks[task] = { private: privateValue, sources }; data.items = data.items.filter(i => i.path !== rel); data.items.push(item)
        await binding(b.st.kbId); await atomicJson(file, data)
        return { item: { ...item, text: undefined }, indexed: true, coverage: text ? '已登记正文' : '仅名称与说明；未解析二进制正文' }
      }
      throw fail('BAD_DELIVERABLE_ACTION', '未知成品操作')
    })
  } }
}
