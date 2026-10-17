// 知识库地图（只读扫描）：给顶栏「知识库」页签用。
// 铁律：
//   · 只读 —— 只 readdir/stat，绝不写、不建索引、不建 .kbmeta
//   · 隐私区（默认 00-画像、30-人物关系）只出计数与体积，不出文件名，不进最近变更
//   · 不跟随符号链接/Junction（避免扫到库外）
//   · 根目录默认是**当前绑定**的库；要观察别的只读库必须显式传 root + readOnly
// R5 变更：返回 status（ok/empty/missing/denied/partial/not-a-directory）+ errors[]，
//         让"空库 / 路径失效 / 无权限 / 部分扫描"四种情况不再长得一样；
//         系统元数据与备份目录（.kbmeta、.kb-state）不进分区统计与最近变更。
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { privateRootOf } from './fsindex.js'

export const MAP_RULES_VERSION = 'map-v2'
export const DEFAULT_PRIVATE = ['00-画像', '30-人物关系']
export const DEFAULT_SKIP = ['.kb', '.kbmeta', '.kb-state', '_模板', '_手册', '知识库地图']
const ROOT_FILES_NAME = '(根目录文件)'

const isDir = (d) => d.isDirectory()
const skipName = (name, skip) => skip.includes(name)

function toPosix(p) {
  return String(p).split(path.sep).join('/')
}

async function walk(dir, ctx, rel = '') {
  let items = []
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    ctx.errors.push(`${rel || '.'}: ${(error && (error.code || error.message)) ?? error}`)
    return
  }
  for (const item of items) {
    if (skipName(item.name, ctx.skip)) continue
    // 链接一律不跟（与 kbcore 的 scanDisk 口径一致）
    if (item.isSymbolicLink()) {
      ctx.links += 1
      continue
    }
    const full = path.join(dir, item.name)
    const relPath = rel ? rel + '/' + item.name : item.name
    if (isDir(item)) {
      ctx.dirs += 1
      await walk(full, ctx, relPath)
      continue
    }
    let st = null
    try {
      st = await stat(full)
    } catch (error) {
      ctx.errors.push(`${relPath}: ${(error && (error.code || error.message)) ?? error}`)
      continue
    }
    ctx.files += 1
    ctx.bytes += st.size
    // 根目录下的散文件不算「分区」，统一聚到一行，避免把 AGENTS.md 当成板块
    const isTopLevelFile = !relPath.includes('/')
    const top = isTopLevelFile ? ROOT_FILES_NAME : relPath.slice(0, relPath.indexOf('/'))
    const sec = ctx.sections.get(top) ?? { name: top, files: 0, bytes: 0, latestAt: 0, rootFiles: isTopLevelFile }
    sec.files += 1
    sec.bytes += st.size
    if (st.mtimeMs > sec.latestAt) sec.latestAt = st.mtimeMs
    ctx.sections.set(top, sec)
    if (!ctx.privateTop.has(top)) {
      ctx.recent.push({ path: relPath, bytes: st.size, mtimeMs: st.mtimeMs })
    }
  }
}

/**
 * 扫描一个只读根目录，返回地图数据。
 * @param {string} root 绝对路径
 * @param {{privateDirs?: string[], skipDirs?: string[], recentLimit?: number, readOnly?: boolean}} opts
 */
export async function buildMap(root, opts = {}) {
  const privateDirs = opts.privateDirs ?? DEFAULT_PRIVATE
  const skip = [...DEFAULT_SKIP, ...(opts.skipDirs ?? [])]
  const recentLimit = opts.recentLimit ?? 12
  const absRoot = path.resolve(root)
  const started = Date.now()
  const base = {
    root: toPosix(absRoot),
    scannedAt: new Date().toISOString(),
    elapsedMs: 0,
    rulesVersion: MAP_RULES_VERSION,
    readOnly: opts.readOnly === true,
    sections: [],
    recent: [],
    privacy: { privateDirs, note: '标记 private 的分区只统计数量与体积，不列出文件名，也不进入最近变更' },
  }

  // 1) 根目录本身要先判"在不在 / 是不是目录 / 能不能读"——三者不能都显示成"0 文件的正常库"
  let st = null
  let statError = null
  try {
    st = await stat(absRoot)
  } catch (error) {
    statError = error
  }
  if (st === null) {
    const code = statError && (statError.code || statError.message)
    const missing = code === 'ENOENT' || code === 'ENOTDIR'
    return {
      ...base,
      elapsedMs: Date.now() - started,
      status: missing ? 'missing' : 'denied',
      errors: [`根目录不可访问（${code ?? 'unknown'}）：${base.root}`],
      totals: { files: 0, dirs: 0, bytes: 0, links: 0, sections: 0 },
    }
  }
  if (!st.isDirectory()) {
    return {
      ...base,
      elapsedMs: Date.now() - started,
      status: 'not-a-directory',
      errors: [`根目录不是目录：${base.root}`],
      totals: { files: 0, dirs: 0, bytes: 0, links: 0, sections: 0 },
    }
  }

  const ctx = { files: 0, dirs: 0, bytes: 0, links: 0, sections: new Map(), recent: [], skip, privateTop: new Set(privateDirs), errors: [] }
  await walk(absRoot, ctx)

  const sections = [...ctx.sections.values()]
    .map((s) => ({
      name: s.name,
      files: s.files,
      bytes: s.bytes,
      latestAt: s.latestAt ? new Date(s.latestAt).toISOString() : null,
      private: privateDirs.includes(s.name),
      rootFiles: s.rootFiles === true,
    }))
    // 目录按名字排，根目录文件永远排最后
    .sort((a, b) => {
      if (a.rootFiles !== b.rootFiles) return a.rootFiles ? 1 : -1
      return a.name > b.name ? 1 : a.name < b.name ? -1 : 0
    })

  const recent = ctx.recent
    // R3：嵌套私密目录（如 10-项目/私密）也不进"最近变更"
    .filter((r) => privateRootOf(r.path, privateDirs) === null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, recentLimit)
    .map((r) => ({ path: r.path, bytes: r.bytes, mtime: new Date(r.mtimeMs).toISOString() }))

  // R3：错误详情里的私密路径/文件名同样要隐藏（否则等于从错误信息里泄漏清单）
  const errors = ctx.errors.map((e) => {
    const head = String(e).split(':')[0]
    return privateRootOf(head, privateDirs) !== null ? '（私密路径）：枚举异常（路径与文件名已隐藏）' : e
  })
  const status = errors.length > 0 ? 'partial' : ctx.files === 0 ? 'empty' : 'ok'
  return {
    ...base,
    elapsedMs: Date.now() - started,
    status,
    errors,
    totals: {
      files: ctx.files,
      dirs: ctx.dirs,
      bytes: ctx.bytes,
      links: ctx.links,
      // 只数真分区：根目录散文件那一行是聚合项，不算分区
      sections: sections.filter((s) => s.rootFiles !== true).length,
    },
    sections,
    recent,
  }
}
