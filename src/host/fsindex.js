// 文件枚举与路径归一的唯一实现（host 半边共用）。
//
// 为什么单独成文件：审查意见 S2/S3 指出「清单/隐私/覆盖」三处必须口径一致——
//   · 隐私要按**规范化后的每一个返回路径**判，不能只看请求 range 的第一段；
//   · 清单要**完整递归 + 显式报告截断/权限/链接**，不能静默漏项；
//   · 分页、筛选、嵌套私密目录走的必须是**同一份**枚举结果。
// 所以三者共用这里的 walkTree / privateRootOf，不再各自实现一遍。
import path from 'node:path'
import { readdir, lstat, stat, realpath, open, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const toPosix = (p) => String(p).split(path.sep).join('/').split('\\').join('/')

/** 目录名 → 路径段（去掉空段与 `.`，统一斜杠）。 */
export function normSegs(rel) {
  return toPosix(rel)
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.')
}

/** 目标目录内部永远是元数据/工具目录，不进任何清单（.kb / .kbmeta / .kb-state / .git / node_modules 同理）。 */
export const META_DIRS = new Set(['.kb', '.kbmeta', '.kb-state', '.git', 'node_modules'])

/**
 * 判断一个「库内相对路径」是否落在某个私密根之下。
 * 采用**路径段前缀**语义（不区分大小写），因此 `00-画像` 不会误伤 `00-画像2`，
 * 且 `20-知识笔记/../00-画像` 这类写法一旦规范化到 `00-画像/...` 就会被正确识别。
 * @param {string} rel 库内相对路径（斜杠分隔）
 * @param {string[]} roots 私密根（配置值或默认值）
 * @returns {string|null} 命中的私密根；未命中返回 null
 */
export function privateRootOf(rel, roots) {
  const segs = normSegs(rel).map((s) => s.toLowerCase())
  for (const raw of roots ?? []) {
    const ps = normSegs(raw).map((s) => s.toLowerCase())
    if (ps.length === 0) continue
    if (ps.length === 1) {
      // 单段私密根（00-画像 / 30-人物关系）：**出现在任何层级都算**。
      // 审查意见明确要求"嵌套私密目录"也走同一策略——10-项目/00-画像/x.md 同样不列名。
      if (segs.some((s) => s === ps[0])) return normSegs(raw).join('/')
      continue
    }
    // 多段私密路径（如 10-项目/私密）：按前缀匹配
    if (ps.length <= segs.length && ps.every((s, i) => segs[i] === s)) return normSegs(raw).join('/')
  }
  return null
}

/** 默认私密根（配置未给时用它）——与地图的既有口径一致。 */
export const DEFAULT_PRIVATE_DIRS = ['00-画像', '30-人物关系']

// ── F2/F3：来源映射的读取与解释（kbcore / map / importer 共用同一口径）──────
const normAbs = (p) => toPosix(path.resolve(String(p ?? ''))).toLowerCase()

/** 读目标库的来源映射（无则空对象；坏文件按空处理，不让检索/概览崩） */
export async function readImportSources(root) {
  if (!root) return {}
  try {
    const raw = JSON.parse(await readFile(path.join(root, '.kbmeta', 'import-sources.json'), 'utf8'))
    return raw && typeof raw.entries === 'object' && raw.entries !== null ? raw.entries : {}
  } catch {
    return {}
  }
}

/**
 * F2：派生条目的隐私分区。
 * 导入时写入 `private:true / privatePartition:<分区>`；这里把它们并入**有效私密策略**。
 * 只按"承载私密派生条目的分区"取，不把普通分区整体设私密。
 */
export function derivedPrivatePartitions(entries) {
  const out = new Set()
  for (const v of Object.values(entries ?? {})) {
    if (!v || v.private !== true) continue
    if (typeof v.privatePartition === 'string' && v.privatePartition.trim() !== '') out.add(toPosix(v.privatePartition).split('/').filter(Boolean)[0])
  }
  return [...out].filter(Boolean)
}

/** 有效私密根 = 配置私密根 ∪ 派生隐私分区（配置为空时用默认两分区） */
export function effectivePrivateDirs(confDirs, derived) {
  const base = Array.isArray(confDirs) && confDirs.length > 0 ? confDirs : DEFAULT_PRIVATE_DIRS
  const merged = [...base, ...(derived ?? [])]
    .map((d) => toPosix(String(d ?? '')).split('/').filter((s) => s && s !== '.').join('/'))
    .filter(Boolean)
  return [...new Set(merged)]
}

/**
 * F3：这条来源映射是否允许把「派生条目」折叠到「原件」。
 * 只有 **原地接入（attach）且源根就是当前库** 时，原件才在检索层里；copy 的原件在 90-收件箱（不参与检索）。
 * 另外必须核对目标库身份，避免 A 库的映射影响 B 库。
 */
export function acceptableSourceEntry(v, { kbId, root } = {}) {
  if (!v || typeof v !== 'object') return false
  if (v.mode !== 'attach') return false
  if (typeof v.sourceRoot !== 'string' || typeof v.originalPath !== 'string' || typeof v.entryPath !== 'string') return false
  if (kbId != null && v.kbId != null && String(v.kbId) !== String(kbId)) return false
  if (root != null && normAbs(v.sourceRoot) !== normAbs(root)) return false
  return v.entryPath !== v.originalPath
}

/** 在给定路径集合里找「派生条目 → 原件」的折叠对（同一知识只保留一份）。 */
export function foldGeneratedPairs(paths, entries, opts) {
  const set = new Set(paths)
  const pairs = new Map()
  for (const v of Object.values(entries ?? {})) {
    if (!acceptableSourceEntry(v, opts)) continue
    if (set.has(v.entryPath) && set.has(v.originalPath)) pairs.set(v.entryPath, v.originalPath)
  }
  return pairs
}

/** 知识数（按同来源折叠）——与物理文件数分列 */
export function knowledgeCount(paths, entries, opts) {
  const pairs = foldGeneratedPairs(paths, entries, opts)
  return { knowledge: paths.length - pairs.size, physical: paths.length, folded: pairs.size }
}


const codeOf = (error) => String((error && (error.code || error.message)) ?? error)

/**
 * 完整递归枚举（不是"只扫 N 层"）。
 *
 * 审查意见 S3 的反例是：`20-知识笔记/a/b/c/d/deep-marker.md` 在全库范围返回 total=0。
 * 根因是旧实现 depth>3 直接 return ——**静默漏项**。现在：
 *   · 默认不设业务深度上限，只留一个防病态环的上限（默认 64 层，触发就写进 truncated，不静默）；
 *   · 链接默认不跟（followLinks=false 时记为 link-skipped 到 errors，可解释）；
 *   · 文件数上限在**加入前**判定，触发即 truncated={reason:'max-files'}；
 *   · readdir/stat 失败逐个记进 errors（含路径与错误码），不再"看不见就当没有"。
 *
 * @param {string} dir 起点（绝对路径）
 * @param {string} root 相对路径的基准（绝对路径，用于给每条结果算相对路径）
 * @param {{maxFiles?:number,maxDepth?:number,followLinks?:boolean,skipMeta?:boolean}} opts
 */
export async function walkTree(dir, root, opts = {}) {
  const maxFiles = Number.isFinite(opts.maxFiles) ? Number(opts.maxFiles) : 50000
  const maxDepth = Number.isFinite(opts.maxDepth) ? Number(opts.maxDepth) : 64
  const followLinks = opts.followLinks === true
  const skipMeta = opts.skipMeta !== false
  // 审查意见 S3/S2 的直接教训：调用方传进来的 root 可能是 posix 形式（status() 返回的就是），
  // 不归一化会让 path.relative 算出 ../../.. 这种假相对路径，隐私判断与页面对账都会错。
  // 注意：Windows 的短名（KINGSL~1）与长名（Kingsley Asher）混用会让 path.relative 算出
  // ../../.. 这种假相对路径 —— 起点与 root 都用 realpath 归一，隐私判断才对得上。
  const base = await realpath(path.resolve(String(root))).catch(() => path.resolve(String(root)))
  const start = await realpath(path.resolve(String(dir))).catch(() => path.resolve(String(dir)))
  const files = []
  const dirs = []
  const errors = []
  let truncated = null
  let deepest = 0
  let realRoot = null
  try {
    realRoot = await realpath(base)
  } catch {
    realRoot = base
  }
  const visited = new Set()

  const walk = async (current, depth) => {
    if (truncated) return
    if (depth > maxDepth) {
      truncated = { reason: 'max-depth', limit: maxDepth }
      return
    }
    deepest = Math.max(deepest, depth)
    let realCurrent = null
    try {
      realCurrent = await realpath(current)
    } catch (error) {
      errors.push({ path: toPosix(path.relative(base, current)), error: 'realpath:' + codeOf(error) })
      return
    }
    // 防环：同一真实目录只进一次（junction/符号链接回指时不会无限递归）
    if (visited.has(realCurrent)) return
    visited.add(realCurrent)

    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      errors.push({ path: toPosix(path.relative(base, current)) || '.', error: 'readdir:' + codeOf(error) })
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const ent of entries) {
      if (truncated) return
      if (skipMeta && ent.name.startsWith('.')) continue
      if (skipMeta && META_DIRS.has(ent.name)) continue
      const abs = path.join(current, ent.name)
      let info
      try {
        info = await lstat(abs)
      } catch (error) {
        errors.push({ path: toPosix(path.relative(base, abs)), error: 'lstat:' + codeOf(error) })
        continue
      }
      if (info.isSymbolicLink()) {
        if (!followLinks) {
          errors.push({ path: toPosix(path.relative(base, abs)), error: 'link-skipped' })
          continue
        }
        try {
          const real = await realpath(abs)
          const relToRoot = path.relative(realRoot, real)
          if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
            errors.push({ path: toPosix(path.relative(base, abs)), error: 'link-escapes-root' })
            continue
          }
          info = await stat(abs)
        } catch (error) {
          errors.push({ path: toPosix(path.relative(base, abs)), error: 'link:' + codeOf(error) })
          continue
        }
      }
      if (info.isDirectory()) {
        dirs.push(toPosix(path.relative(base, abs)))
        await walk(abs, depth + 1)
        continue
      }
      if (!info.isFile()) {
        errors.push({ path: toPosix(path.relative(base, abs)), error: 'not-a-regular-file' })
        continue
      }
      if (files.length >= maxFiles) {
        truncated = { reason: 'max-files', limit: maxFiles }
        return
      }
      files.push({ path: toPosix(path.relative(base, abs)), bytes: info.size, mtimeMs: info.mtimeMs })
    }
  }

  await walk(start, 0)
  return {
    files,
    dirs,
    errors,
    truncated,
    maxDepth: deepest,
    coverage: {
      files: files.length,
      dirs: dirs.length,
      depth: deepest,
      truncated: truncated !== null,
      truncatedReason: truncated ? truncated.reason : null,
      errors: errors.length,
      followLinks,
    },
  }
}

/** 流式 sha256（大文件也不吃内存）。 */
export async function sha256File(abs) {
  const fh = await open(abs, 'r')
  try {
    const hash = createHash('sha256')
    const buf = Buffer.allocUnsafe(1 << 20)
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (!bytesRead) break
      hash.update(buf.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } finally {
    await fh.close()
  }
}

/** 读文本文件的前 N 字节（导入时给摘录用，不整文件读进内存）。 */
export async function readHead(abs, bytes = 4096) {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.allocUnsafe(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}
