// 异构资料 / 旧库导入（接入原目录 · 复制导入）——与 UI、模型工具共用的唯一后端流程。
//
// p4（R1–R7 定向整改）后的硬约束：
//   R1  任务清单必须携带目标身份：{target, targetKbId, taskStateDir}；执行方用**独立 core**
//       （见 import-service.js），本文件只负责「按清单写目标库」，不读当前绑定。
//   R2  importId 单一校验（^imp-[a-z0-9]{6,16}$）；任务目录解析后必须仍在 imports 内，
//       并做 realpath 复核；源/目标/清单/复制读写各自过 checkRealPath。
//   R3  **先扫描冻结原始清单，再建标准结构**；「是不是生成物」只认清单/来源映射，
//       不再用「目录名与本插件受管目录同名」推断（旧资料夹的 00-画像/old.txt 不会被跳过）。
//       frontmatter 的 type 参与分类映射；私密来源的派生条目不得落到公开分区。
//   R4  plan 阶段逐文件冻结 sha256+size+mtime；run 前核验，变了就 conflict 停；
//       终态 = failed=0 && pending=0 && !truncated && errors=0；否则 partial 并列原因。
//       来源映射按「目标库身份 + 源根目录 + 源相对路径」长期保存在 <目标库>/.kbmeta/import-sources.json，
//       同一来源再导入走受控 update，不追加副本。
//   R5  文本类（md/txt/log/代码）**全文**进检索；原件与派生条目通过来源映射去重（在 kbcore.search 里做）。
//   R6  空/非法路径不解释成 cwd；目录不存在时若父级可写，由 initializeLibrary 创建。
//   其余原有约束（不覆盖同名、可中断可续、原件不执行、不冒充全文）保持不变。
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, stat, rename, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { toPosix, normSegs, walkTree, sha256File, privateRootOf, DEFAULT_PRIVATE_DIRS } from './fsindex.js'
import { checkRealPath, realOf, insideReal } from './kbcore.js'

export const IMPORT_VERSION = 2

// R2：唯一的 importId 契约。importIdFor 产出的 id 必须满足它（sha1 前 10 位十六进制）。
export const IMPORT_ID_RE = /^imp-[a-z0-9]{6,16}$/
export function isValidImportId(importId) {
  return typeof importId === 'string' && IMPORT_ID_RE.test(importId)
}

// 工具/版本目录：任何情况下都不导入（与内容无关）。
export const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.DS_Store'])
// 只在「源目录本身就是一个已初始化的知识库」时跳过：这些层不是知识内容（模板/手册/加工件/原件库/元数据）。
// 注意：这是**归属层判定**，不是"名字像生成物就跳过"——没有 .kbmeta 的旧资料夹不走这条。
export const LIBRARY_LAYERS = new Set(['_模板', '_手册', '50-底稿', '90-收件箱', '知识库地图', '.kb', '.kbmeta', '.kb-state', '.kb-import'])
// 根目录导航文件不是"源内容"
const ROOT_NAV = new Set(['INDEX.md', 'README.md', '知识库清单.md'])
// 可映射到分区的类型（与 kbcore 的 KIND_TO_CATEGORY 对齐）
const IMPORTABLE_KINDS = new Set(['知识', '项目', '人物', '素材', '画像'])

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.text', '.log'])
const DOC_EXT = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.wma'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.flv'])
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.ps1', '.sh', '.bat', '.cmd', '.json', '.yaml', '.yml', '.toml', '.ini', '.css', '.html', '.htm', '.sql', '.java', '.c', '.h', '.cpp', '.cs', '.go', '.rs'])

const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex')
const sha12Of = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12)
const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex')
const extOf = (rel) => path.extname(rel).toLowerCase()
const kbMetaOf = (folder) => path.join(folder, '.kbmeta', 'kb.json')
const normAbs = (p) => toPosix(path.resolve(String(p))).toLowerCase()

// 本机实测：Windows 上 rename 偶发 EPERM/EBUSY（杀软/索引服务持有句柄）。
// 原子写在生产里不能因为一次抖动就整任务失败 —— 短退避重试，仍然失败再抛。
async function renameWithRetry(from, to, attempts = 6) {
  const { rename } = await import('node:fs/promises')
  let lastError = null
  for (let i = 0; i < attempts; i += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = String((error && error.code) ?? '')
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(code)) throw error
      await new Promise((r) => setTimeout(r, 20 * 2 ** i))
    }
  }
  throw lastError
}

/** 导入任务的稳定 id：同一目标 + 同一源 + 同一模式 → 同一任务（重试续跑，不会开新任务）。 */
export function importIdFor(source, target, mode) {
  const key = [normAbs(source), normAbs(target ?? source), mode].join('|')
  return 'imp-' + sha1(key).slice(0, 10)
}

// ── R2：任务目录解析（唯一实现）────────────────────────────────────
export function importsRootOf(stateDir) {
  return path.resolve(stateDir, 'imports')
}

/** 取最近的已存在祖先的真实路径（任务目录通常还不存在，不能直接 realpath 它）。 */
async function nearestReal(p) {
  let cur = path.resolve(p)
  for (;;) {
    const real = await realOf(cur)
    if (real !== null) return { real, at: cur }
    const parent = path.dirname(cur)
    if (parent === cur) return { real: null, at: cur }
    cur = parent
  }
}

/**
 * 解析任务目录：先过 id 契约，再核字符串边界，最后核真实路径边界。
 * @returns {{ok:true, dir:string, root:string}|{ok:false, reason:string}}
 */
export async function resolveImportDir(stateDir, importId) {
  if (!isValidImportId(importId)) return { ok: false, reason: 'bad-import-id' }
  const root = importsRootOf(stateDir)
  const dir = path.join(root, importId)
  const rel = path.relative(root, dir)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, reason: 'import-dir-escape' }
  const realRoot = await realOf(root)
  if (realRoot !== null) {
    const near = await nearestReal(dir)
    if (near.real === null || !insideReal(realRoot, near.real)) return { ok: false, reason: 'import-dir-escape-real' }
  }
  return { ok: true, dir, root }
}

export async function readManifest(stateDir, importId) {
  const r = await resolveImportDir(stateDir, importId)
  if (!r.ok) return null
  try {
    return JSON.parse(await readFile(path.join(r.dir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

/** 供服务层写回清单（任务身份 / 目标 kbId 等由服务层补齐）。 */
export async function saveManifest(stateDir, manifest) {
  manifest.updatedAt = new Date().toISOString()
  await writeManifest(stateDir, manifest)
  return manifest
}

async function writeManifest(stateDir, manifest) {
  const r = await resolveImportDir(stateDir, manifest.importId)
  if (!r.ok) throw new Error('导入任务目录非法：' + r.reason)
  await mkdir(r.dir, { recursive: true })
  const tmp = path.join(r.dir, 'manifest.json.tmp')
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  await renameWithRetry(tmp, path.join(r.dir, 'manifest.json'))
}

function cancelPathOf(dir) {
  return path.join(dir, 'cancel')
}

export function recount(manifest) {
  const c = { total: manifest.items.length, done: 0, pending: 0, failed: 0, skipped: 0, waiting: 0, entries: 0, updated: 0 }
  for (const it of manifest.items) {
    if (it.status === 'done') {
      c.done += 1
      if (it.entryPath) c.entries += 1
      if (it.updated === true) c.updated += 1
    } else if (it.status === 'failed') c.failed += 1
    else if (it.status === 'skipped') c.skipped += 1
    else c.pending += 1
    if (it.class === 'doc' || it.class === 'media' || it.class === 'other') c.waiting += 1
  }
  manifest.counts = c
  return c
}

/** 源目录本身是不是「本插件初始化完成的知识库」——决定是否按库的归属层/来源映射排除。 */
export async function isOwnLibrary(root) {
  const meta = await (async () => {
    try {
      return JSON.parse(await readFile(kbMetaOf(root), 'utf8'))
    } catch {
      return null
    }
  })()
  if (!meta || typeof meta !== 'object') return false
  return meta.schemaVersion === 1 && typeof meta.kbId === 'string' && meta.kbId.trim() !== '' && meta.installState === 'complete'
}

// ── R4：长期来源映射（落在目标库 .kbmeta 里，跟着库身份走）────────────
export function sourcesFileOf(targetRoot) {
  return path.join(targetRoot, '.kbmeta', 'import-sources.json')
}

export async function readSourceMap(targetRoot) {
  try {
    const raw = JSON.parse(await readFile(sourcesFileOf(targetRoot), 'utf8'))
    const entries = raw && typeof raw.entries === 'object' && raw.entries !== null ? raw.entries : {}
    return { version: 1, entries }
  } catch {
    return { version: 1, entries: {} }
  }
}

export async function writeSourceMap(targetRoot, map) {
  const file = sourcesFileOf(targetRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const payload = { version: 1, updatedAt: new Date().toISOString(), entries: map.entries ?? {} }
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await renameWithRetry(tmp, file)
  return payload
}

/**
 * 来源身份 = 目标库身份 + 源根目录 + 源相对路径。
 * 只带 rel 会把不同源目录里的同名文件当成同一来源（R4 复核意见第 2 点）。
 */
export function sourceKey(kbId, sourceRoot, rel) {
  return [String(kbId ?? '-'), normAbs(sourceRoot), toPosix(rel)].join('|')
}

/** 已生成条目路径集合：只从「清单/来源映射/请求记录」取，不从目录名推断。 */
export async function generatedPathsOf(targetRoot) {
  const out = new Set()
  const map = await readSourceMap(targetRoot)
  for (const v of Object.values(map.entries)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.entryPath === 'string') out.add(toPosix(v.entryPath))
    if (Array.isArray(v.entryPaths)) for (const p of v.entryPaths) if (typeof p === 'string') out.add(toPosix(p))
  }
  try {
    const req = JSON.parse(await readFile(path.join(targetRoot, '.kbmeta', 'requests.json'), 'utf8'))
    const items = req && req.items ? req.items : {}
    for (const it of Object.values(items)) {
      if (it && it.op === 'create' && typeof it.path === 'string') out.add(toPosix(it.path))
    }
  } catch {
    /* 没有请求记录就不排除 */
  }
  return out
}

async function canWriteAncestor(dir) {
  let anc = path.resolve(dir)
  while (!existsSync(anc) && path.dirname(anc) !== anc) anc = path.dirname(anc)
  try {
    const { access } = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    await access(anc, constants.W_OK)
    return { ok: true, base: toPosix(anc) }
  } catch (error) {
    return { ok: false, base: toPosix(anc), reason: String((error && (error.code || error.message)) ?? error) }
  }
}

/** 这个目录属于哪一类？——「自动建库/识别」的唯一判据来源。 */
export async function inspectFolder(folderRaw) {
  const raw = String(folderRaw ?? '').trim()
  const out = { path: raw === '' ? null : toPosix(path.resolve(raw)), exists: false, isDir: false, writable: false, creatable: false, createBase: null, kind: 'unknown', files: 0, dirs: 0, errors: 0, meta: null, reasons: [], truncated: null }
  if (raw === '') {
    out.kind = 'missing'
    out.reasons.push('路径为空（本版不会把空路径当成当前工作目录）')
    return out
  }
  const folder = path.resolve(raw)
  const st = await stat(folder).catch(() => null)
  if (st === null) {
    out.kind = 'missing'
    out.reasons.push('目录不存在')
    const w = await canWriteAncestor(folder)
    out.creatable = w.ok
    out.createBase = w.base
    if (!w.ok) out.reasons.push(`上级不可写（${w.base}：${w.reason}）`)
    return out
  }
  out.exists = true
  if (!st.isDirectory()) {
    out.kind = 'not-a-directory'
    out.reasons.push('这个路径不是文件夹')
    return out
  }
  out.isDir = true
  try {
    const probe = path.join(folder, `.kb-probe-${process.pid}-${Math.random().toString(16).slice(2, 8)}`)
    await writeFile(probe, 'ok', 'utf8')
    const { rm } = await import('node:fs/promises')
    await rm(probe, { force: true })
    out.writable = true
  } catch (error) {
    out.reasons.push('目录不可写：' + String((error && (error.code || error.message)) ?? error))
  }
  const metaPath = kbMetaOf(folder)
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'))
      out.meta = { installState: meta.installState ?? null, kbId: meta.kbId ?? null, schemaVersion: meta.schemaVersion ?? null, name: meta.name ?? null, createdAt: meta.createdAt ?? null }
      if (meta.schemaVersion !== 1) {
        out.kind = 'incompatible'
        out.reasons.push(`元数据版本不兼容（schemaVersion=${meta.schemaVersion ?? '缺'}，本版支持 1）`)
      } else if (typeof meta.kbId !== 'string' || meta.kbId.trim() === '') {
        out.kind = 'corrupt'
        out.reasons.push('元数据缺 kbId（库身份无效）')
      } else if (meta.installState !== 'complete') {
        out.kind = 'ours-partial'
        out.reasons.push(`本插件的库，初始化未完成（installState=${meta.installState ?? '缺'}）`)
      } else {
        out.kind = 'ours'
        out.reasons.push('本插件已有的库：接入时保留 kbId 与既有资料')
      }
    } catch (error) {
      out.kind = 'corrupt'
      out.reasons.push('元数据损坏（无法解析 .kbmeta/kb.json）：' + String((error && error.message) ?? error))
    }
  }
  const scan = await walkTree(folder, folder, { maxFiles: 5000, followLinks: false })
  out.files = scan.files.length
  out.dirs = scan.dirs.length
  out.errors = scan.errors.length
  out.truncated = scan.truncated
  if (out.kind === 'unknown') {
    out.kind = out.files === 0 ? 'empty' : 'foreign'
    out.reasons.push(out.files === 0 ? '空目录：可以按标准结构新建知识库' : `普通资料文件夹：${out.files} 个文件，将按结构分类导入`)
  }
  return out
}

function classifyFile(rel) {
  const ext = extOf(rel)
  if (TEXT_EXT.has(ext)) return ext === '.md' || ext === '.markdown' ? 'markdown' : 'text'
  if (DOC_EXT.has(ext)) return 'doc'
  if (IMAGE_EXT.has(ext)) return 'media'
  if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) return 'media'
  if (CODE_EXT.has(ext)) return 'code'
  return 'other'
}

const TYPE_LABEL = { markdown: 'Markdown 文档', text: '纯文本', doc: '文档（未解析）', media: '图片/音视频（未识别）', code: '代码/配置（仅作资料）', other: '未支持格式' }
// 与 kbcore 的 KIND_TO_CATEGORY 对齐（只用于「同一来源再导入时分区是否变了」）
const CATEGORY_OF = { 知识: '20-知识笔记', 项目: '10-项目', 人物: '30-人物关系', 素材: '40-素材资源', 画像: '00-画像' }

/** 从 md 头部解析 frontmatter 的 title/type/tags/status（容错：解析失败就当普通文本）。 */
function looseFrontmatter(head) {
  if (!head.startsWith('---')) return null
  const end = head.indexOf('\n---', 3)
  if (end < 0) return null
  const block = head.slice(3, end)
  const pick = (key) => {
    const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(block)
    if (!m) return null
    return m[1].trim().replace(/^['"]|['"]$/g, '')
  }
  const tagsRaw = pick('tags')
  const tags = tagsRaw ? tagsRaw.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []
  return { title: pick('title'), type: pick('type'), tags, bodyStart: head.indexOf('\n', end + 1) + 1 }
}

/** 目标分区：frontmatter 的 type 参与映射；私密来源一律降到私密分区（画像）。 */
export function mapEntryKind({ fmType, rel, privateDirs }) {
  const privateHit = privateRootOf(rel, privateDirs ?? DEFAULT_PRIVATE_DIRS)
  const base = typeof fmType === 'string' && IMPORTABLE_KINDS.has(fmType) ? fmType : '知识'
  if (privateHit !== null && base !== '画像') return { kind: '画像', privateHit: String(privateHit), downgraded: true }
  return { kind: base, privateHit: privateHit === null ? null : String(privateHit), downgraded: false }
}

/**
 * 冻结源清单（只读扫描 + 逐文件 sha256；不写目标库）。
 * R3：**先冻结、后建结构** —— 调用方必须先 plan 再 initializeLibrary。
 * R4：plan 阶段就把 sha256/size/mtime 写进清单，运行时只认这份冻结值。
 */
export async function planImport({ stateDir, source, target, mode, maxFiles = 20000, log = () => {}, isActive = null }) {
  const srcRaw = String(source ?? '').trim()
  if (srcRaw === '') return { error: 'source 不能为空', reason: 'empty-source' }
  const src = path.resolve(srcRaw)
  const tgt = path.resolve(String(target ?? src))
  const importId = importIdFor(src, tgt, mode)

  // R2：源与目标不得互相包含（同目录允许：attach 就是"在原地建库"；父子目录一律拒绝，避免自己导自己）
  const relST = path.relative(src, tgt)
  const relTS = path.relative(tgt, src)
  const srcInTgt = relST !== '' && !relST.startsWith('..') && !path.isAbsolute(relST)
  const tgtInSrc = relTS !== '' && !relTS.startsWith('..') && !path.isAbsolute(relTS)
  if (srcInTgt || tgtInSrc) {
    return { error: '源与目标不能互相包含（父子目录）：请换一个独立目录作为源或目标', reason: 'nested-source-target' }
  }

  // R4：运行中的任务只读不写（重复 plan 不重置进度）
  const existing = await readManifest(stateDir, importId)
  const active = typeof isActive === 'function' ? isActive(importId) : false
  if (existing && (active || existing.stage === 'importing' || existing.stage === 'verifying')) {
    const counts = recount(existing)
    log('warn', `导入计划 ${importId} 正在运行：本次只返回现有清单，未覆盖进度`)
    return { ...existing, running: true, counts, note: '任务正在运行：未覆盖现有清单' }
  }

  const own = await isOwnLibrary(src)
  const generated = own ? await generatedPathsOf(tgt) : new Set()
  const scan = await walkTree(src, src, { maxFiles, followLinks: false })
  const items = []
  const skippedDirs = []
  const skippedFiles = []
  let hashErrors = 0
  for (const f of scan.files) {
    const rel = toPosix(f.path)
    const segs = normSegs(rel)
    const top = segs[0] ?? ''
    if (SKIP_DIRS.has(top)) {
      if (!skippedDirs.includes(top)) skippedDirs.push(top)
      continue
    }
    // 归属层排除只在「源目录本身是已初始化知识库」时生效（旧资料夹同名目录不算）
    if (own && LIBRARY_LAYERS.has(top)) {
      if (!skippedDirs.includes(top)) skippedDirs.push(top)
      continue
    }
    if (generated.has(rel)) {
      skippedFiles.push(rel)
      continue
    }
    if (!rel.includes('/') && ROOT_NAV.has(rel)) {
      skippedFiles.push(rel)
      continue
    }
    const abs = path.join(src, ...rel.split('/'))
    const boundary = await checkRealPath(src, abs)
    if (!boundary.ok) {
      skippedFiles.push(rel)
      if (!skippedDirs.includes('(链接/越界文件)')) skippedDirs.push('(链接/越界文件)')
      continue
    }
    let sha256 = null
    let hashError = null
    try {
      sha256 = await sha256File(abs)
    } catch (error) {
      hashError = String((error && (error.code || error.message)) ?? error).slice(0, 200)
      hashErrors += 1
    }
    items.push({
      key: rel,
      rel,
      bytes: f.bytes,
      mtimeMs: Math.round(f.mtimeMs),
      class: classifyFile(rel),
      status: hashError === null ? 'pending' : 'failed',
      sha256,
      entryId: null,
      entryPath: null,
      originalPath: null,
      updated: false,
      reason: null,
      error: hashError === null ? null : `计划阶段读取失败：${hashError}`,
    })
  }
  const targetMeta = await (async () => {
    try {
      return JSON.parse(await readFile(kbMetaOf(tgt), 'utf8'))
    } catch {
      return null
    }
  })()
  const manifest = {
    version: IMPORT_VERSION,
    importId,
    mode, // attach（接入原目录）| copy（复制导入）
    source: toPosix(src),
    target: toPosix(tgt),
    targetKbId: targetMeta && typeof targetMeta.kbId === 'string' ? targetMeta.kbId : null,
    taskStateDir: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage: 'planned',
    skippedDirs,
    skippedFiles,
    scan: { files: scan.files.length, dirs: scan.dirs.length, errors: scan.errors.length + hashErrors, truncated: scan.truncated, maxDepth: scan.maxDepth, ownLibrary: own },
    items,
    counts: null,
  }
  recount(manifest)
  await writeManifest(stateDir, manifest)
  log('info', `导入计划 ${importId}：${items.length} 个源文件（跳过 ${skippedDirs.length} 类目录 / ${skippedFiles.length} 个文件），截断=${scan.truncated ? scan.truncated.reason : '无'}`)
  return manifest
}

async function copyPreserve(sourceAbs, targetAbs) {
  await mkdir(path.dirname(targetAbs), { recursive: true })
  await copyFile(sourceAbs, targetAbs)
}

function entryBodyFor(item, originalRel, text) {
  const meta = [
    `- 原件：\`${originalRel}\``,
    `- 大小：${item.bytes} 字节`,
    `- 类型：${TYPE_LABEL[item.class] ?? item.class}`,
    `- 源指纹（sha256）：\`${item.sha256}\``,
  ].join('\n')
  if (item.class === 'doc') {
    return ['## 待解析', '', '这个文件已登记并保留原件，但**本版没有做格式解析**（不做 OCR、不做 docx/xlsx/pdf 正文抽取）。', '要看内容请打开上面的原件；解析后应把正文补写到本节，而不是留着这条占位。', '', '## 原件信息', '', meta].join('\n')
  }
  if (item.class === 'media') {
    return ['## 待识别', '', '这个文件已登记并保留原件，但**本版没有做 OCR / 语音转写 / 视频取帧**。', '其中图片可走本地 OCR；音视频需转写后再补正文。', '', '## 原件信息', '', meta].join('\n')
  }
  if (item.class === 'other') {
    return ['## 未支持格式', '', `扩展名 \`${path.extname(item.rel) || '(无)'}\` 不在本版支持的范围内，**原件已原样保留**，没有转换、没有抽取内容。`, '', '## 原件信息', '', meta].join('\n')
  }
  // R5：文本类给**全文**（不是头部摘录）。逐条全文进索引，后半段关键词也能命中。
  const full = String(text ?? '')
  return [
    '## 正文（导入全文）',
    '',
    '> 以下是源文件的**完整文本**（导入时按 UTF-8 读取），用于全文检索；原件仍保留在原位（或 90-收件箱）。',
    '',
    '````text',
    full.trim() === '' ? '（文件为空或无法按 UTF-8 读取）' : full,
    '````',
    '',
    '## 原件信息',
    '',
    meta,
  ].join('\n')
}

/** R4：执行前核验冻结值（源文件被改/被删 → 明确冲突，不猜）。 */
async function preflight(manifest) {
  const conflicts = []
  for (const item of manifest.items) {
    if (item.status === 'done' || item.status === 'skipped') continue
    const srcAbs = path.join(manifest.source, ...item.rel.split('/'))
    const boundary = await checkRealPath(manifest.source, srcAbs)
    if (!boundary.ok) {
      conflicts.push({ rel: item.rel, reason: boundary.reason, detail: boundary.detail })
      continue
    }
    const st = await stat(srcAbs).catch(() => null)
    if (st === null) {
      conflicts.push({ rel: item.rel, reason: 'source-missing', detail: '源文件已不存在（计划后被移走/改名）' })
      continue
    }
    if (st.size !== item.bytes) {
      conflicts.push({ rel: item.rel, reason: 'source-size-changed', detail: `冻结 ${item.bytes} → 现在 ${st.size}` })
      continue
    }
    const hash = await sha256File(srcAbs).catch((error) => ({ error: String((error && (error.code || error.message)) ?? error) }))
    if (typeof hash !== 'string') {
      conflicts.push({ rel: item.rel, reason: 'source-unreadable', detail: hash.error })
      continue
    }
    if (item.sha256 !== null && hash !== item.sha256) {
      conflicts.push({ rel: item.rel, reason: 'source-hash-changed', detail: `冻结 ${String(item.sha256).slice(0, 12)}… → 现在 ${hash.slice(0, 12)}…` })
    }
  }
  return conflicts
}

/**
 * F1.4：copy 模式的原件归档**按内容版本**落盘（`<批次>/v<sha12>/<rel>`），
 * 同一版本重试复用（校验哈希），新版本不覆盖旧版本。返回库内相对路径。
 */
async function archiveCopy(manifest, item, buf, contentSha, batchDir) {
  const rel = `${batchDir}/v${contentSha.slice(0, 12)}/${item.rel}`
  const destAbs = path.join(manifest.target, ...rel.split('/'))
  const destCheck = await checkRealPath(manifest.target, destAbs)
  if (!destCheck.ok) throw new Error(`复制目标越界/是链接（${destCheck.reason}）：${destCheck.detail ?? ''}`)
  if (existsSync(destAbs)) {
    const cur = await sha256File(destAbs)
    if (cur !== contentSha) throw new Error(`归档副本已被占用且内容不符（${cur.slice(0, 12)} ≠ ${contentSha.slice(0, 12)}）`)
    return rel
  }
  await mkdir(path.dirname(destAbs), { recursive: true })
  const tmp = `${destAbs}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  await writeFile(tmp, buf)
  await rename(tmp, destAbs)
  const after = await sha256File(destAbs)
  if (after !== contentSha) throw new Error(`归档写入后哈希不符（${after.slice(0, 12)} ≠ ${contentSha.slice(0, 12)}）`)
  return rel
}

/**
 * 执行导入（可续跑）。
 * 只写目标库；**不读当前绑定**。调用方必须传一个已绑定到 manifest.target 的 core（见 import-service）。
 */
export async function runImport({ core, stateDir, importId, log = () => {}, onProgress = null }) {
  if (!isValidImportId(importId)) return { ok: false, reason: 'bad-import-id', error: 'importId 非法（必须形如 imp-xxxxxxxxxx）' }
  const resolved = await resolveImportDir(stateDir, importId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason, error: '导入任务目录非法：' + resolved.reason }
  const manifest = await readManifest(stateDir, importId)
  if (manifest === null) return { ok: false, error: '找不到导入清单（先 plan 再 run）' }
  if (!core || typeof core.createEntry !== 'function') return { ok: false, error: '缺少写入 core' }
  // 真 core 才做目标身份核验；注入桩（单元测试）没有 status 时跳过（服务层另有强制核验）
  if (typeof core.status === 'function') {
    const st = await core.status()
    if (!st || !st.kbPath) return { ok: false, reason: 'target-unbound', error: '任务目标未绑定' }
    if (normAbs(st.kbPath) !== normAbs(manifest.target)) {
      return { ok: false, reason: 'target-root-mismatch', error: `core 实际根目录 ${st.kbPath} ≠ 任务目标 ${manifest.target}` }
    }
    if (manifest.targetKbId && st.kbId && manifest.targetKbId !== st.kbId) {
      return { ok: false, reason: 'target-kbid-mismatch', error: `任务目标 kbId=${manifest.targetKbId}，core 实际 kbId=${st.kbId}` }
    }
  }
  if (manifest.stage === 'done') return { ok: true, manifest, note: '该任务已完成，未重复执行' }

  // R4：执行前核验（源变了 → conflict，不写任何条目）
  const conflicts = await preflight(manifest)
  if (conflicts.length > 0) {
    manifest.stage = 'conflict'
    manifest.conflicts = conflicts
    manifest.terminalReasons = conflicts.map((c) => `${c.rel}:${c.reason}`).slice(0, 20)
    manifest.updatedAt = new Date().toISOString()
    recount(manifest)
    await writeManifest(stateDir, manifest)
    log('warn', `导入 ${importId} 发现 ${conflicts.length} 处源变化：已停在 conflict，未写入条目（需重新 plan）`)
    return { ok: false, conflict: true, manifest, error: '源文件在计划后发生变化：请重新 plan 再 run' }
  }

  manifest.stage = 'importing'
  manifest.updatedAt = new Date().toISOString()
  await writeManifest(stateDir, manifest)

  const conf = typeof core.getConfig === 'function' ? await core.getConfig().catch(() => null) : null
  const privateDirs = Array.isArray(conf?.privateDirs) && conf.privateDirs.length > 0 ? conf.privateDirs : DEFAULT_PRIVATE_DIRS
  const targetKbId = manifest.targetKbId ?? (typeof core.status === 'function' ? (await core.status()).kbId : null)
  const attach = manifest.mode === 'attach'
  const batchDir = `90-收件箱/原件归档/${new Date().toISOString().slice(0, 10)}-导入-${importId.slice(4, 10)}`
  const sourceMap = await readSourceMap(manifest.target)
  let consecutiveFailures = 0
  const results = { created: 0, updated: 0, unchanged: 0, duplicated: 0, failed: 0, skipped: 0 }

  const fail = async (item, error) => {
    item.status = 'failed'
    item.error = String(error ?? 'unknown').slice(0, 300)
    results.failed += 1
    consecutiveFailures += 1
  }

  for (const item of manifest.items) {
    if (existsSync(cancelPathOf(resolved.dir))) {
      manifest.stage = 'canceled'
      manifest.updatedAt = new Date().toISOString()
      recount(manifest)
      const { rm } = await import('node:fs/promises')
      await rm(cancelPathOf(resolved.dir), { force: true })
      await writeManifest(stateDir, manifest)
      log('warn', `导入被取消（已完成 ${results.created + results.updated} 条）`)
      return { ok: false, canceled: true, manifest }
    }
    if (item.status === 'done' || item.status === 'skipped') continue
    const srcAbs = path.join(manifest.source, ...item.rel.split('/'))
    try {
      const boundary = await checkRealPath(manifest.source, srcAbs)
      if (!boundary.ok) {
        await fail(item, `源文件路径越界/是链接（${boundary.reason}）：${boundary.detail ?? ''}`)
        continue
      }
      // F1.3：冻结内容**只读一次** —— 哈希、正文、复制都用这同一份字节。
      // 之后源文件再变，也不会把新内容混进这次导入（item.sha256 不可变）。
      const buf = await readFile(srcAbs).catch(() => null)
      if (buf === null) {
        await fail(item, '源文件已不存在（计划后被移走/改名）')
        continue
      }
      if (buf.length !== item.bytes) {
        await fail(item, `源文件已变化（大小 ${item.bytes} → ${buf.length}）：冻结清单不匹配，未导入`)
        continue
      }
      const contentSha = sha256Of(buf)
      if (item.sha256 === null) {
        // 旧清单（p4 之前）没有哈希：只在这里补一次，之后不可变
        item.sha256 = contentSha
      }
      if (item.sha256 !== contentSha) {
        await fail(item, `源文件内容已变化（冻结 ${String(item.sha256).slice(0, 12)}… → 现在 ${contentSha.slice(0, 12)}…）：未使用新内容，需重新 plan`)
        continue
      }
      // F1.4：原件落位（copy 按内容版本归档；attach 留原位）
      let originalRef
      if (attach) {
        originalRef = item.rel
      } else {
        try {
          originalRef = await archiveCopy(manifest, item, buf, contentSha, batchDir)
        } catch (error) {
          await fail(item, `原件归档失败：${String((error && error.message) ?? error)}`)
          continue
        }
      }
      item.originalPath = originalRef

      const cls = item.class
      const isText = cls === 'markdown' || cls === 'text' || cls === 'code'
      const text = isText ? buf.toString('utf8') : ''
      const fm = cls === 'markdown' ? looseFrontmatter(text) : null
      const titleBase = (fm && fm.title) || path.basename(item.rel, path.extname(item.rel)) || item.rel
      const title = `导入·${titleBase}`.slice(0, 90)
      const mapped = mapEntryKind({ fmType: fm && fm.type, rel: item.rel, privateDirs })
      const tags = ['导入', ...(fm && Array.isArray(fm.tags) ? fm.tags.slice(0, 6) : [])]
      if (!fm || !fm.type) tags.push('待整理')
      if (mapped.privateHit !== null) tags.push('私密')
      const body = entryBodyFor(item, originalRef, text)
      const ver = contentSha.slice(0, 12)

      // F1：同一来源（目标身份+源根+相对路径）再导入 → 受控 update；不再静默转 create
      const key = sourceKey(targetKbId, manifest.source, item.rel)
      const prev = sourceMap.entries[key]
      let done = false
      if (prev && typeof prev.entryPath === 'string' && prev.entryId) {
        const prevAbs = path.join(manifest.target, ...prev.entryPath.split('/'))
        const lastRev = typeof prev.entryRevision === 'string' && prev.entryRevision.trim() !== '' ? prev.entryRevision : null
        if (!existsSync(prevAbs)) {
          await fail(item, 'entry-missing：上次生成的条目已不存在（不自动重建，避免绕过冲突；请人工确认后重建映射）')
          done = true
        } else if (lastRev === null) {
          await fail(item, 'entry-revision-unknown：来源映射缺少上次生成的 revision，拒绝盲写（需重新建立该来源映射）')
          done = true
        } else if (prev.sha256 === contentSha) {
          // 同一内容版本重试：幂等，不重写条目（不制造新 revision / updated 日期）
          item.status = 'done'
          item.entryId = prev.entryId
          item.entryPath = prev.entryPath
          item.entryRevision = lastRev
          item.updated = true
          item.unchanged = true
          item.error = null
          results.unchanged += 1
          done = true
          consecutiveFailures = 0
        } else {
          const prevCategory = prev.entryPath.split('/')[0]
          const wantCategory = CATEGORY_OF[mapped.kind]
          const categoryChanged = typeof wantCategory === 'string' && prevCategory !== wantCategory
          if (categoryChanged) {
            // 分区需要变化（例如旧库的公开条目其实是画像）：新建到正确分区，旧条目改成指针（不删除、不留双份正文）
            const createdNew = await core.createEntry({ kind: mapped.kind, title, content: body, tags, source: originalRef, requestId: `imp:${importId}:${item.rel}:remap:${ver}` })
            if (!createdNew.ok) {
              await fail(item, `remap-create-failed：${createdNew.reason ?? ''} ${createdNew.detail ?? ''}`)
              done = true
            } else {
              const retired = await core.updateEntry({
                entryId: prev.entryId,
                expectedRevision: lastRev,
                content: `## 已迁移\n\n本条目在再次导入时按 frontmatter type / 隐私规则重新映射到 \`${createdNew.path}\`；正文以新条目为准，这里只留指针。\n`,
                patch: { tags: [...tags, '已迁移'], status: '已归档' },
                requestId: `imp:${importId}:${item.rel}:retire:${ver}`,
              })
              if (!retired.ok) {
                // 新条目已建；旧条目没退休成功（可能被用户改过）→ 如实失败，不覆盖
                await fail(item, `remap-retire-failed：${retired.reason ?? (retired.conflict ? '旧条目被改动' : '')} ${retired.detail ?? ''}`)
              } else {
                item.status = 'done'
                item.entryId = createdNew.entryId
                item.entryPath = createdNew.path
                item.entryRevision = createdNew.revision
                item.updated = true
                item.error = null
                results.created += 1
                consecutiveFailures = 0
              }
              done = true
            }
          } else {
            const upd = await core.updateEntry({
              entryId: prev.entryId,
              expectedRevision: lastRev,
              content: body,
              patch: { title, tags, source: originalRef, type: mapped.kind },
              requestId: `imp:${importId}:${item.rel}:upd:${ver}`,
            })
            if (upd.ok || upd.deduplicated) {
              item.status = 'done'
              item.entryId = prev.entryId
              item.entryPath = prev.entryPath
              item.entryRevision = upd.revision
              item.updated = true
              item.error = null
              results.updated += 1
              done = true
              consecutiveFailures = 0
            } else if (upd.conflict) {
              // 期望 revision 不符：用户手改 / 外部改动 —— 不覆盖，也不转 create
              await fail(item, `entry-conflict：条目在两次导入之间被改动（期望 ${lastRev} 实际 ${upd.currentRevision}），未覆盖`)
              done = true
            } else {
              // 更新失败（索引不可用、frontmatter 不支持等）—— **不** 回退 create
              await fail(item, `update-failed：${upd.reason ?? 'unknown'} ${upd.detail ?? ''}`)
              done = true
            }
          }
        }
      }
      if (!done && item.status !== 'failed') {
        const created = await core.createEntry({ kind: mapped.kind, title, content: body, tags, source: originalRef, requestId: `imp:${importId}:${item.rel}:create:${ver}` })
        if (created.ok) {
          item.entryId = created.entryId
          item.entryPath = created.path
          item.entryRevision = created.revision
          item.status = 'done'
          item.error = null
          if (created.deduplicated) results.duplicated += 1
          else results.created += 1
          consecutiveFailures = 0
        } else {
          await fail(item, `${created.reason ?? 'create-failed'}：${created.detail ?? ''}`)
        }
      }
      if (item.status === 'done') {
        const partition = typeof item.entryPath === 'string' ? item.entryPath.split('/')[0] : null
        const isPrivate = mapped.privateHit !== null || mapped.kind === '画像'
        sourceMap.entries[key] = {
          kbId: targetKbId ?? null,
          sourceRoot: toPosix(path.resolve(manifest.source)),
          rel: toPosix(item.rel),
          mode: attach ? 'attach' : 'copy',
          sha256: contentSha,
          size: buf.length,
          mtimeMs: item.mtimeMs,
          entryId: item.entryId,
          entryPath: item.entryPath,
          entryRevision: item.entryRevision ?? null,
          originalPath: originalRef,
          originalSha256: contentSha,
          private: isPrivate,
          privatePartition: isPrivate ? partition : null,
          importId,
          updatedAt: new Date().toISOString(),
        }
        await writeSourceMap(manifest.target, sourceMap)
      }
    } catch (error) {
      await fail(item, String((error && error.message) ?? error))
    }
    recount(manifest)
    manifest.updatedAt = new Date().toISOString()
    await writeManifest(stateDir, manifest)
    if (onProgress) await onProgress(manifest)
    if (consecutiveFailures >= 8) {
      const reasons = [`连续失败 ${consecutiveFailures} 次（已中止）`]
      manifest.stage = 'partial'
      manifest.terminalReasons = reasons
      await writeManifest(stateDir, manifest)
      log('error', `导入连续失败 ${consecutiveFailures} 次，已中止（已完成 ${results.created + results.updated} 条，可修复后重试）`)
      return { ok: false, manifest, aborted: true }
    }
  }

  // 核验：原件哈希是否仍与清单一致（复制模式核副本、接入模式核源文件）
  manifest.stage = 'verifying'
  await writeManifest(stateDir, manifest)
  const verify = { checked: 0, mismatch: [], skipped: 0 }
  for (const item of manifest.items) {
    if (item.status !== 'done' || item.sha256 === null) continue
    if (verify.checked >= 500) {
      verify.skipped += 1
      continue
    }
    const abs = attach ? path.join(manifest.source, ...item.rel.split('/')) : path.join(manifest.target, ...item.originalPath.split('/'))
    try {
      const h = await sha256File(abs)
      if (h !== item.sha256) verify.mismatch.push({ rel: item.rel, expected: item.sha256, actual: h })
      verify.checked += 1
    } catch (error) {
      verify.mismatch.push({ rel: item.rel, error: String((error && error.message) ?? error) })
    }
  }
  manifest.verify = verify

  // R4：终态闭环 —— failed / pending / 截断 / 扫描错误 / 哈希不符 任一存在都不能报完整成功
  const c = recount(manifest)
  const reasons = []
  if (c.failed > 0) reasons.push(`失败 ${c.failed} 条`)
  if (c.pending > 0) reasons.push(`未完成 ${c.pending} 条`)
  if (manifest.scan && manifest.scan.truncated) reasons.push(`扫描被截断（${manifest.scan.truncated.reason}）`)
  if (manifest.scan && manifest.scan.errors > 0) reasons.push(`扫描错误 ${manifest.scan.errors} 处`)
  if (verify.mismatch.length > 0) reasons.push(`原件哈希不符 ${verify.mismatch.length} 条`)
  manifest.terminalReasons = reasons
  manifest.stage = reasons.length === 0 ? 'done' : 'partial'
  manifest.updatedAt = new Date().toISOString()
  await writeManifest(stateDir, manifest)
  log(manifest.stage === 'done' ? 'info' : 'warn', `导入 ${importId} 结束：stage=${manifest.stage} 新建 ${results.created} / 更新 ${results.updated} / 未变 ${results.unchanged} / 失败 ${results.failed}${reasons.length ? '；原因：' + reasons.join('；') : ''}`)
  return { ok: manifest.stage === 'done', manifest }
}

export async function cancelImport(stateDir, importId) {
  if (!isValidImportId(importId)) return { ok: false, reason: 'bad-import-id', error: 'importId 非法（必须形如 imp-xxxxxxxxxx）' }
  const resolved = await resolveImportDir(stateDir, importId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason, error: '导入任务目录非法：' + resolved.reason }
  const manifest = await readManifest(stateDir, importId)
  if (manifest === null) return { ok: false, reason: 'not-found', error: '找不到导入任务：' + importId }
  await mkdir(resolved.dir, { recursive: true })
  await writeFile(cancelPathOf(resolved.dir), new Date().toISOString(), 'utf8')
  return { ok: true, importId, stage: 'cancel-requested' }
}

export async function listImports(stateDir) {
  const dir = importsRootOf(stateDir)
  try {
    const { readdir } = await import('node:fs/promises')
    const names = await readdir(dir, { withFileTypes: true })
    const out = []
    for (const n of names) {
      if (!n.isDirectory()) continue
      if (!isValidImportId(n.name)) continue
      const m = await readManifest(stateDir, n.name)
      if (m) out.push({ importId: m.importId, mode: m.mode, source: m.source, target: m.target, targetKbId: m.targetKbId ?? null, stage: m.stage, createdAt: m.createdAt, updatedAt: m.updatedAt, counts: m.counts, terminalReasons: m.terminalReasons ?? [] })
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return out
  } catch {
    return []
  }
}
