// 知识库核心逻辑（P0.1：按验收意见 A–D 修复，E/F/G 中可顺手处理的一并修）
// 只依赖 node 内置模块，不 import @deepseek-ai/*。
//
// 相对 0.1.0-p0 的关键变化：
//   A. init 成为公开可调用动作（bind 预览 + 确认初始化），不再只能靠自检钩子
//   B. 每个返回值都带"业务结论"，供自检断言；不再有"没抛异常就算通过"的空间
//   C. 配置损坏 ≠ 文件不存在：损坏时**不播种、不换库**，明确报 degraded 并给恢复入口；
//      初始化有完成状态，半成品重试补齐，半成品不得报 healthy
//   D. update 强制 expectedRevision（两层都校验）；索引路径进文件操作前做边界校验
//   E. 同库写入走进程内互斥；临时文件名带随机；索引失败返回部分完成而不是普通成功
//   F. 索引缺失/损坏时检索走**磁盘发现兜底**，并明确说"是兜底"；check 先取旧快照再比差异
//   G. frontmatter 的 tags 用带引号的 flow 序列，含逗号的标签不被拆开；未知字段保留
import crypto from 'node:crypto'
import os from 'node:os'
import { constants, existsSync } from 'node:fs'
import { access, appendFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readImportSources, derivedPrivatePartitions, effectivePrivateDirs, foldGeneratedPairs } from './fsindex.js'

// 版本单一来源：package.json 的 version 必须与此一致（详见 INSTALL 说明）
export const VERSION = '0.1.0-p8'

export const REQUIRED_FIELDS = ['title', 'type', 'tags', 'status', 'updated']
export const SCHEMA_VERSION = 1

const KIND_TO_CATEGORY = {
  知识: '20-知识笔记',
  项目: '10-项目',
  人物: '30-人物关系',
  素材: '40-素材资源',
  画像: '00-画像',
}

const TEMPLATES = {
  '知识条目.md': '# 标题\n\n> 一句话结论。\n\n## 正文\n\n',
  '项目条目.md': '# 项目名\n\n> 目标与当前状态。\n\n## 进展\n\n',
  '素材条目.md': '# 素材名\n\n> 是什么、能干什么。\n\n## 用法\n\n',
}

// 这些目录**不是知识条目**，任何情况下都不进索引（配置只能加、不能去掉）。
const DEFAULT_EXCLUDES = ['_模板', '_手册', '.kbmeta', '.kb-state', '50-底稿', '90-收件箱']

const nowIso = () => new Date().toISOString()
const today = () => nowIso().slice(0, 10)

function sha12(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12)
}
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}
function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}
const normAbs = (p) => toPosix(path.resolve(String(p ?? ''))).toLowerCase()
function slugOf(title) {
  const s = String(title)
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, '-')
    .trim()
  return s.slice(0, 40) || 'untitled'
}

// ── R3：frontmatter 采用「受限 YAML 子集 + 写前拒绝」───────────────
// 原则：**能无损识别的才允许写回**。缩进/嵌套映射、嵌套列表、块标量（| >）、
// 流式映射（{...}）、注释行、重复键、未闭合的 [...] 一律标 unsupported ——
// updateEntry 见到它直接拒绝写盘（unsupported-frontmatter），绝不静默改坏数据。
// 能无损处理的：顶层 `key: 标量`（引号原样解析）、`key: [a, b]`（含转义与引号）。

const UNSUPPORTED = {
  indent: 'frontmatter 含缩进/嵌套结构（本版不支持写回）',
  comment: 'frontmatter 含注释行（本版不支持写回）',
  sequence: 'frontmatter 含列表项（本版不支持写回）',
  block: 'frontmatter 含块标量（本版不支持写回）',
  flowMap: 'frontmatter 含流式映射（本版不支持写回）',
  duplicate: 'frontmatter 含重复键（本版不支持写回）',
  unclosed: 'frontmatter 的 [...] 未闭合（本版不支持写回）',
  multiline: 'frontmatter 含多行或嵌套结构（本版不支持写回）',
}

/** 双引号内转义：只认 \n \r \t \" \\；其它未知转义**保留反斜杠**（宁可保守，不吞字符） */
function unescapeDouble(s) {
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch !== '\\' || i + 1 >= s.length) {
      out += ch
      continue
    }
    const n = s[i + 1]
    if (n === 'n') { out += '\n'; i += 1 }
    else if (n === 'r') { out += '\r'; i += 1 }
    else if (n === 't') { out += '\t'; i += 1 }
    else if (n === '"') { out += '"'; i += 1 }
    else if (n === '\\') { out += '\\'; i += 1 }
    else out += ch
  }
  return out
}

function unquoteScalar(rawIn) {
  const s = String(rawIn ?? '').trim()
  if (s === '' || s === '~' || s === 'null') return ''
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return unescapeDouble(s.slice(1, -1))
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  return s
}

/** 行内 flow 序列：引号内的逗号不拆；返回 closed=false 表示引号未闭合 */
function parseFlowSeq(inner) {
  const parts = []
  let buf = ''
  let quote = null
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (quote !== null) {
      if (quote === '"' && ch === '\\' && i + 1 < inner.length) { buf += ch + inner[i + 1]; i += 1; continue }
      if (quote === "'" && ch === "'" && inner[i + 1] === "'") { buf += "''"; i += 1; continue }
      if (ch === quote) { quote = null; buf += ch; continue }
      buf += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue }
    if (ch === ',') { parts.push(buf.trim()); buf = ''; continue }
    buf += ch
  }
  parts.push(buf.trim())
  return { values: parts.filter((x) => x !== '').map(unquoteScalar), closed: quote === null }
}

/** 解析 frontmatter 区块（不含 --- 定界行）；不支持的语法只打标，不抛异常 */
function parseHeaderBlock(headerRaw) {
  const data = {}
  const lines = []
  const seen = new Set()
  let unsupported = null
  const mark = (why) => { if (unsupported === null) unsupported = why }
  for (const rawLine of String(headerRaw ?? '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.trim() === '') continue
    if (/^[ \t]/.test(line)) { mark(UNSUPPORTED.indent); continue }
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) { mark(UNSUPPORTED.comment); continue }
    if (/^-(\s|$)/.test(trimmed)) { mark(UNSUPPORTED.sequence); continue }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(trimmed)
    if (!m) { mark(UNSUPPORTED.multiline); continue }
    const key = m[1]
    const rest = m[2].trim()
    if (seen.has(key)) { mark(UNSUPPORTED.duplicate); continue }
    seen.add(key)
    lines.push({ key, raw: line })
    if (/^[|>]/.test(rest)) { mark(UNSUPPORTED.block); data[key] = rest; continue }
    if (/^\{/.test(rest)) { mark(UNSUPPORTED.flowMap); data[key] = rest; continue }
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) { mark(UNSUPPORTED.unclosed); data[key] = rest; continue }
      const seq = parseFlowSeq(rest.slice(1, -1))
      if (!seq.closed) mark(UNSUPPORTED.unclosed)
      data[key] = seq.values
      continue
    }
    data[key] = unquoteScalar(rest)
  }
  return { data, lines, unsupported }
}

/**
 * 切出 frontmatter 的三个区间。bodyRaw **保留原文**（含分隔空行与行尾），
 * 供 rewriteFrontmatter 做字节级拼回 —— 这是「只改元数据时正文逐字不变」的基础。
 */
function splitFrontmatter(text) {
  if (typeof text !== 'string' || !text.startsWith('---')) return { ok: false, reason: 'no-frontmatter' }
  const firstNl = text.indexOf('\n')
  if (firstNl < 0) return { ok: false, reason: 'frontmatter 未闭合' }
  let cursor = firstNl + 1
  let closeStart = -1
  let closeEnd = -1
  while (cursor <= text.length) {
    const nl = text.indexOf('\n', cursor)
    const lineEnd = nl < 0 ? text.length : nl
    let line = text.slice(cursor, lineEnd)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (line === '---' || line === '...') {
      closeStart = cursor
      closeEnd = nl < 0 ? text.length : nl + 1
      break
    }
    if (nl < 0) break
    cursor = nl + 1
  }
  if (closeStart < 0) return { ok: false, reason: 'frontmatter 未闭合' }
  return {
    ok: true,
    openLine: text.slice(0, firstNl + 1),
    headerRaw: text.slice(firstNl + 1, closeStart),
    closeLine: text.slice(closeStart, closeEnd),
    bodyRaw: text.slice(closeEnd),
  }
}

/** 解析 frontmatter：返回 data / body / raw / valid / unsupported */
export function parseFrontmatter(text) {
  const parts = splitFrontmatter(text)
  if (!parts.ok) {
    if (parts.reason === 'no-frontmatter') return { data: {}, body: text, raw: '', valid: true, unsupported: null }
    return { data: {}, body: text, raw: '', valid: false, reason: parts.reason, unsupported: null }
  }
  const parsed = parseHeaderBlock(parts.headerRaw)
  const sep = /^\r?\n/.exec(parts.bodyRaw)
  return {
    data: parsed.data,
    body: sep ? parts.bodyRaw.slice(sep[0].length) : parts.bodyRaw,
    raw: parts.headerRaw,
    valid: true,
    unsupported: parsed.unsupported,
    parts,
  }
}

/** 序列化：含逗号/引号/换行的标签加引号，避免被拆开（G）；未知字段保留 */
/** 探测文本主导换行符，写回时保留（P1-E：不能静默把 CRLF 改成 LF） */
export function detectEol(text) {
  if (typeof text !== 'string' || text === '') return '\n'
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/\n/g) || []).length
  return crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n'
}

export const ALLOWED_TYPES = ['知识', '项目', '人物', '素材', '画像', '索引', '会议', '复盘']

/**
 * 库**根目录**的导航/说明文件：不是条目，不参与索引与缺陷检查。
 * 与库自己的 `.kb/kb-check.ps1` 的 `$NavFiles` 对齐（2026-10-17）。
 * 只对根目录生效 —— 子目录里的同名文件（如 10-项目/每日信息/README.md）仍是条目。
 */
export const ROOT_NAV_FILES = new Set(['AGENTS.md', 'README.md', 'INDEX.md', '知识库清单.md'])

/**
 * 派生稳定 id（2026-10-17）——frontmatter 没写 `id` 时，用**库内相对路径**派生身份。
 *
 * 动机：本库的写入者不止本产品一个（人工编辑、其他 Agent 都按 AGENTS.md 只写
 * title/type/tags/status/updated，从不写 id）。若把 `id` 定为必填，任何一次非产品写入
 * 都会变成永久的 noId 缺陷；而 path 本来就是本产品全链路的主键（索引按 path、diff 按 path）。
 *
 * 取舍：**改名会换身份**。本库条目名是 `YYYY-MM-DD-*`，改名极少（改名需先问主人）。
 * 显式写了 `id` 的条目仍以显式 id 为准（create 生成的 `kb-xxxxxxxx`）。
 */
export function derivedEntryId(relPath) {
  return 'p-' + crypto.createHash('sha1').update(String(relPath).replace(/\\/g, '/'), 'utf8').digest('hex').slice(0, 12)
}

/**
 * ⚠️ R1 起**不再用于检索预筛**（旧实现用它做"排除"，会漏掉 `implement`/`pha`/单字「库」这类查询）。
 * 现在检索直接在索引条目的 `text` 上做 includes；本函数仅为兼容旧调用方保留导出，
 * 新代码请不要用它过滤结果集。
 */
export function tokenizeForIndex(text) {
  const out = new Set()
  const lower = String(text ?? '').toLowerCase()
  for (const m of lower.matchAll(/[a-z0-9_]{2,}/g)) out.add(m[0])
  for (const m of lower.matchAll(/[\u4e00-\u9fff]+/g)) {
    const s = m[0]
    if (s.length === 1) out.add(s)
    for (let i = 0; i + 1 < s.length; i += 1) out.add(s.slice(i, i + 2))
  }
  return [...out]
}

// 需要引号的字符：YAML 里会改变含义的那些（逗号/冒号/井号/括号/引号/反斜杠/换行…）
const QUOTE_TRIGGER = /[,:#\[\]{}&*!|>'"%@`\r\n\t\\]/
const FIELD_ORDER = ['id', 'title', 'type', 'tags', 'status', 'created', 'updated', 'source', 'see_also']

function needsQuote(s) {
  if (s === '') return true
  if (/^\s|\s$/.test(s)) return true
  if (QUOTE_TRIGGER.test(s)) return true
  if (/^[-?]/.test(s)) return true
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true
  if (/^-?\d+(\.\d+)?$/.test(s)) return true
  return false
}

/** 标量序列化：必要时按 YAML 双引号规则转义（`\` → `\\`、`"` → `\"`、换行 → `\n`） */
function quoteScalar(v) {
  const s = String(v)
  if (!needsQuote(s)) return s
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"'
}

function formatValue(v) {
  if (Array.isArray(v)) return `[${v.map((x) => quoteScalar(x)).join(', ')}]`
  return quoteScalar(v)
}

function presentKeys(data) {
  const has = (k) => data[k] !== undefined && data[k] !== ''
  return [...FIELD_ORDER.filter(has), ...Object.keys(data).filter((k) => !FIELD_ORDER.includes(k) && has(k))]
}

/** 按原始行尾切开（保留每行自己的 \r\n / \n），供「未改动的行按原字节保留」 */
function splitLinesKeepEol(text) {
  const out = []
  let i = 0
  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    if (nl < 0) {
      out.push({ text: text.slice(i), eol: '' })
      break
    }
    const raw = text.slice(i, nl)
    if (raw.endsWith('\r')) out.push({ text: raw.slice(0, -1), eol: '\r\n' })
    else out.push({ text: raw, eol: '\n' })
    i = nl + 1
  }
  return out
}

/**
 * 只重建 frontmatter 区块：**未改动的行按原字节（含各自行尾）保留**，
 * 数据里已不存在的键删除，新键追加在末尾。正文由调用方原样拼回。
 */
function rewriteHeader(parts, data) {
  const keys = presentKeys(data)
  const keySet = new Set(keys)
  const lines = splitLinesKeepEol(parts.headerRaw)
  const originalKeys = new Set()
  const out = []
  for (const { text, eol } of lines) {
    const m = /^([A-Za-z_][\w-]*)\s*:/.exec(text)
    if (!m) {
      out.push(text + eol) // 空行等原样保留
      continue
    }
    const key = m[1]
    originalKeys.add(key)
    if (!keySet.has(key)) continue
    out.push(`${key}: ${formatValue(data[key])}${eol}`)
  }
  const appended = keys.filter((k) => !originalKeys.has(k))
  if (appended.length > 0) {
    const nl = parts.closeLine.endsWith('\r\n') ? '\r\n' : '\n'
    if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out[out.length - 1] += nl
    for (const key of appended) out.push(`${key}: ${formatValue(data[key])}${nl}`)
  }
  return out.join('')
}

export function buildFile(data, body, eol = '\n') {
  const keys = presentKeys(data)
  const lines = keys.map((k) => `${k}: ${formatValue(data[k])}`)
  // 正文也按目标 EOL 归一：CRLF 文件里正文若仍是 LF，就不是"无损"
  const normalizedBody = String(body ?? '').split('\r\n').join('\n').split('\n').join(eol)
  return `---${eol}${lines.join(eol)}${eol}---${eol}${eol}${normalizedBody}`
}

/**
 * 字节级拼回：只替换 frontmatter 区块，正文按原始字节（parts.bodyRaw）保留。
 * content 有变时正文按文件主导 EOL 归一后替换。
 */
function composeWithHeader(parts, data, contentText) {
  const header = rewriteHeader(parts, data)
  let bodyRaw = parts.bodyRaw
  if (typeof contentText === 'string') {
    const eol = parts.closeLine.endsWith('\r\n') ? '\r\n' : '\n'
    bodyRaw = eol + String(contentText).trimEnd().split('\r\n').join('\n').split('\n').join(eol) + eol
  }
  return parts.openLine + header + parts.closeLine + bodyRaw
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 真实路径：解析失败返回 null（不存在/无权限） */
export async function realOf(p) {
  try {
    return await realpath(p)
  } catch {
    return null
  }
}

/** 两个真实路径的包含判断（大小写不敏感，Windows） */
export function insideReal(realRoot, candidate) {
  if (!realRoot || !candidate) return false
  const norm = (s) => s.replace(/\\/g, '/').toLowerCase()
  const r = norm(realRoot)
  const c = norm(candidate)
  return c === r || c.startsWith(r.endsWith('/') ? r : r + '/')
}

/**
 * P1-A 真实路径边界校验。
 * 返回值：{ ok:true, realRoot } 或 { ok:false, reason, detail }
 * reason: path-escape（字符串层面越界）/ path-reparse（库内链接，默认拒绝）
 *        / path-reparse-escape（链接指向库外）/ root-missing
 */
export async function checkRealPath(root, candidate, opts = {}) {
  const followLinks = opts.followLinks === true
  const realRoot = await realOf(root)
  if (realRoot === null) return { ok: false, reason: 'root-missing', detail: String(root) }
  const absRoot = path.resolve(root)
  const absCandidate = path.resolve(candidate)
  if (!isInside(absRoot, absCandidate)) {
    return { ok: false, reason: 'path-escape', detail: String(candidate) }
  }
  const rel = path.relative(absRoot, absCandidate)
  const parts = rel.split(path.sep).filter(Boolean)
  let cur = absRoot
  for (const part of parts) {
    cur = path.join(cur, part)
    const st = await lstat(cur).catch(() => null)
    if (st === null) break // 之后都不存在，由调用方按“新建”处理
    if (st.isSymbolicLink()) {
      const real = await realOf(cur)
      if (!real || !insideReal(realRoot, real)) {
        return { ok: false, reason: 'path-reparse-escape', detail: `${toPosix(path.relative(absRoot, cur))} → ${toPosix(real ?? '(无法解析)')}` }
      }
      if (!followLinks) {
        return { ok: false, reason: 'path-reparse', detail: `${toPosix(path.relative(absRoot, cur))} 是链接/重解析点（默认拒绝；followLinks=true 可允许指向库内）` }
      }
    }
  }
  // 目标若已存在，再用真实路径核一次（防"中间没问题、末段是链接"）
  const realTarget = await realOf(absCandidate)
  if (realTarget !== null && !insideReal(realRoot, realTarget)) {
    return { ok: false, reason: 'path-reparse-escape', detail: `${toPosix(path.relative(absRoot, absCandidate))} → ${toPosix(realTarget)}` }
  }
  return { ok: true, realRoot, detail: '' }
}

export function createCore(cfg, logger) {
  const log = logger ?? (() => {})
  const stateDir = path.resolve(cfg.stateDir)
  const configFile = path.join(stateDir, 'config.json')
  const bindingFile = path.join(stateDir, 'binding.json')
  const logFile = path.join(stateDir, 'kb.log')

  let config = null
  let configHealth = { ok: true, state: 'unloaded', detail: '' }
  const locks = new Map()

  async function writeLog(level, message) {
    try {
      await appendFile(logFile, `${nowIso()}\t${level}\t${message}\n`, 'utf8')
    } catch {
      /* 日志失败不影响主流程 */
    }
    log(level, message)
  }

  function withLock(key, fn) {
    const prev = locks.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    locks.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  async function atomicWrite(file, text) {
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
    await writeFile(tmp, text, 'utf8')
    // Windows 上 rename 偶发 EPERM/EBUSY（杀软/索引服务持句柄）：短退避重试，别让一次抖动毁掉一次写入
    let lastError = null
    for (let i = 0; i < 6; i += 1) {
      try {
        await rename(tmp, file)
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

  async function readJsonState(file) {
    try {
      const raw = await readFile(file, 'utf8')
      try {
        return { state: 'ok', value: JSON.parse(raw), raw }
      } catch (error) {
        return { state: 'corrupt', error: String(error.message ?? error), raw }
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' }
      return { state: 'unreadable', error: String((error && (error.code || error.message)) ?? error) }
    }
  }

  // ── 配置（C：损坏不覆盖、不换库）──────────────────────────────────
  /** R3：私密目录白名单校验（只接受库内相对路径；绝对路径/.. 一律拒绝） */
  function sanitizePrivateDirs(list) {
    if (!Array.isArray(list)) return { ok: false, reason: 'privateDirs 必须是数组' }
    const out = []
    for (const raw of list) {
      if (typeof raw !== 'string') return { ok: false, reason: 'privateDirs 里必须都是字符串' }
      const posix = toPosix(raw.trim())
      if (posix === '' || posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return { ok: false, reason: `私密目录必须是库内相对路径：${raw}` }
      const segs = posix.split('/').filter((s) => s !== '' && s !== '.')
      if (segs.length === 0 || segs.some((s) => s === '..')) return { ok: false, reason: `私密目录不得越界：${raw}` }
      out.push(segs.join('/'))
    }
    return { ok: true, value: [...new Set(out)] }
  }

  /** 只接受库内相对路径或空串；空串保持空串（R6：不能再被 path.resolve 变成 cwd） */
  function normKbPath(raw) {
    const s = typeof raw === 'string' ? raw.trim() : ''
    return s === '' ? '' : toPosix(path.resolve(s))
  }

  function seededPrivateDirs(raw) {
    const s = sanitizePrivateDirs(raw)
    return s.ok ? s.value : null
  }

  async function loadConfig() {
    await mkdir(stateDir, { recursive: true })
    const disk = await readJsonState(configFile)
    if (disk.state === 'ok') {
      if (disk.value.schemaVersion !== SCHEMA_VERSION) {
        // C2：以前这里只设 configHealth.ok=false，返回对象没有 degraded，
        // 而 bind/init 只看 conf.degraded → 于是"先建库、后报错"。统一带上 degraded。
        config = { ...disk.value, degraded: true }
      // R3：旧配置（p3 及更早）没有 privateDirs 字段 → 用插件配置兜底（内存态，不回写）
      if (!Array.isArray(config.privateDirs)) {
        const seeded = seededPrivateDirs(cfg.privateDirs)
        if (seeded !== null) config.privateDirs = seeded
      }
        configHealth = {
          ok: false,
          state: 'unsupported-schema',
          detail: `config.json 的 schemaVersion=${disk.value.schemaVersion}，本版支持 ${SCHEMA_VERSION}；未改动原文件`,
          recovery: '备份后可删除 config.json 让程序重新播种，或等产品提供迁移工具',
        }
        await writeLog('warn', `配置 schema 不支持：${configHealth.detail}`)
        return config
      }
      config = disk.value
      // R3：旧配置没有 privateDirs → 用插件配置兜底（内存态；下次 setConfig 才落盘）
      if (!Array.isArray(config.privateDirs)) {
        const seeded = seededPrivateDirs(cfg.privateDirs)
        if (seeded !== null) config.privateDirs = seeded
      }
      configHealth = { ok: true, state: 'loaded', detail: '' }
      await writeLog('info', `配置从磁盘载入 revision=${config.revision ?? '-'} kbPath=${config.kbPath}`)
      return config
    }
    if (disk.state === 'corrupt' || disk.state === 'unreadable') {
      configHealth = {
        ok: false,
        state: disk.state === 'corrupt' ? 'corrupt' : 'unreadable',
        detail:
          disk.state === 'corrupt'
            ? `config.json 不是合法 JSON（${disk.error}）；文件已保留、未覆盖`
            : `config.json 读失败（${disk.error}）；文件已保留`,
        recovery: `检查 ${toPosix(configFile)}；修好或改名备份后重启，程序才会重新播种。原文件未动。`,
      }
      config = {
        schemaVersion: SCHEMA_VERSION,
        revision: null,
        kbPath: normKbPath(cfg.kbPath),
        categories: cfg.categories ?? Object.values(KIND_TO_CATEGORY),
        excludeFromSearch: cfg.excludeFromSearch ?? [],
        followLinks: cfg.followLinks === true,
        privateDirs: seededPrivateDirs(cfg.privateDirs),
        seededFrom: 'cordis.config（只读占位，未落盘）',
        degraded: true,
      }
      await writeLog('warn', `配置降级：${configHealth.detail}`)
      return config
    }
    config = {
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      kbPath: normKbPath(cfg.kbPath),
      categories: cfg.categories ?? Object.values(KIND_TO_CATEGORY),
      excludeFromSearch: cfg.excludeFromSearch ?? [],
      followLinks: cfg.followLinks === true,
      // R3：privateDirs 必须进配置 schema 并落盘（以前只从插件配置读、没播种 → API 回退默认两分区）
      privateDirs: seededPrivateDirs(cfg.privateDirs),
      seededFrom: 'cordis.config',
      updatedAt: nowIso(),
    }
    await atomicWrite(configFile, JSON.stringify(config, null, 2))
    configHealth = { ok: true, state: 'seeded', detail: '首次播种（原文件不存在）' }
    await writeLog('info', `配置播种完成 → ${toPosix(configFile)}`)
    return config
  }

  async function setConfig(patch) {
    // F4：配置写入走 stateDir 级跨实例锁（与 atomic commit 共用同一临界区）
    const lock = await acquireConfigLock('set-config')
    if (!lock.ok) return { ok: false, reason: 'config-lock-timeout', detail: lock.detail ?? '' }
    try {
      await loadConfig()
      if (configHealth.ok === false) {
        return { ok: false, reason: 'config-degraded', detail: configHealth.detail, recovery: configHealth.recovery }
      }
      const built = buildConfigPatch(config, patch)
      if (!built.ok) return built
      const next = { ...built.value, revision: (config.revision ?? 1) + 1, updatedAt: nowIso() }
      await atomicWrite(configFile, JSON.stringify(next, null, 2))
      config = next
      configHealth = { ok: true, state: 'loaded', detail: '' }
      await writeLog('info', `配置写入成功 revision=${next.revision}`)
      return { ok: true, revision: next.revision }
    } finally {
      await releaseConfigLock(lock.token)
    }
  }

  /** 配置字段白名单/校验（setConfig 与原子 commit 共用，避免两套口径） */
  function buildConfigPatch(current, patch) {
    // R3：白名单 + 校验。以前是 {...config, ...patch} 全量合并，未知/非法字段会原样落盘。
    const next = { ...current }
    const allowed = new Set(['kbPath', 'categories', 'excludeFromSearch', 'followLinks', 'privateDirs'])
    for (const key of Object.keys(patch ?? {})) {
      if (!allowed.has(key)) return { ok: false, reason: 'unknown-config-field', detail: `不接受的配置字段：${key}` }
    }
    if (patch && patch.kbPath !== undefined) next.kbPath = normKbPath(patch.kbPath)
    if (patch && patch.categories !== undefined) {
      if (!Array.isArray(patch.categories) || patch.categories.length === 0) return { ok: false, reason: 'bad-categories', detail: 'categories 必须是非空数组' }
      next.categories = patch.categories.map((s) => toPosix(String(s).trim())).filter(Boolean)
    }
    if (patch && patch.excludeFromSearch !== undefined) {
      if (!Array.isArray(patch.excludeFromSearch)) return { ok: false, reason: 'bad-excludes', detail: 'excludeFromSearch 必须是数组' }
      next.excludeFromSearch = patch.excludeFromSearch.map((s) => toPosix(String(s).trim())).filter(Boolean)
    }
    if (patch && patch.followLinks !== undefined) next.followLinks = patch.followLinks === true
    if (patch && patch.privateDirs !== undefined) {
      const checked = sanitizePrivateDirs(patch.privateDirs)
      if (!checked.ok) return { ok: false, reason: 'bad-private-dirs', detail: checked.reason }
      next.privateDirs = checked.value
    }
    return { ok: true, value: next }
  }

  async function getConfig() {
    if (config === null) await loadConfig()
    return { ...config }
  }
  /** 强制重读磁盘（防止"内存里还是好配置、磁盘已坏"导致先动手再报错） */
  async function getConfigFresh() {
    await loadConfig()
    return { ...config }
  }
  async function getConfigHealth() {
    if (config === null) await loadConfig()
    return { ...configHealth }
  }

  /**
   * R6：空 kbPath **不是** cwd。
   * 以前 `path.resolve('')` = 进程工作目录，于是"未绑定"被当成"绑定在一个真实目录"。
   * 现在：空/空白 → null（上层必须按 unbound 处理，不得扫描、不得写入）。
   */
  function kbRootOf(conf) {
    const raw = typeof conf?.kbPath === 'string' ? conf.kbPath.trim() : ''
    return raw === '' ? null : path.resolve(raw)
  }
  function excludesOf(conf) {
    const fromConf = Array.isArray(conf.excludeFromSearch) ? conf.excludeFromSearch : []
    return [...new Set([...DEFAULT_EXCLUDES, ...fromConf])]
  }

  async function readMeta(root) {
    return readJsonState(path.join(root, '.kbmeta', 'kb.json'))
  }

  // ── F4：stateDir 级配置锁（跨实例）────────────────────────────────
  // 作用：让「核对预期 + 写 config/binding」落在同一个临界区；不同进程/不同 core 实例都必须排队。
  // 与库级锁（root/.kbmeta/lock.json）不是一把锁：那把保护"某个库"，这把保护"这个 profile 的绑定"。
  const configLockFile = path.join(stateDir, 'config.lock')
  async function acquireConfigLock(label) {
    const deadline = Date.now() + 4000
    const token = crypto.randomUUID()
    for (;;) {
      try {
        const handle = await open(configLockFile, 'wx')
        await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), at: nowIso(), token, label }), 'utf8')
        await handle.close()
        return { ok: true, token }
      } catch (error) {
        if (!error || error.code !== 'EEXIST') return { ok: false, reason: 'config-lock-error', detail: String((error && (error.code || error.message)) ?? error) }
        let cur = null
        try { cur = JSON.parse(await readFile(configLockFile, 'utf8')) } catch { cur = null }
        let stale = false
        if (cur === null) {
          const st = await stat(configLockFile).catch(() => null)
          stale = st !== null && Date.now() - st.mtimeMs > 5000
        } else {
          stale = cur.host === os.hostname() && !pidAlive(cur.pid)
        }
        if (stale) {
          await rm(configLockFile, { force: true }).catch(() => {})
          continue
        }
        if (Date.now() >= deadline) return { ok: false, reason: 'config-lock-timeout', detail: `config.lock 被持有：${cur ? `${cur.pid}@${cur.host}` : '未知'}（${label}）` }
        await new Promise((r) => setTimeout(r, 25))
      }
    }
  }
  async function releaseConfigLock(token) {
    let cur = null
    try { cur = JSON.parse(await readFile(configLockFile, 'utf8')) } catch { cur = null }
    if (cur && cur.token && cur.token !== token) return { ok: false, reason: 'lock-owner-changed' }
    await rm(configLockFile, { force: true }).catch(() => {})
    return { ok: true }
  }

  // ── R2：跨实例锁（库级）────────────────────────────────────────────
  // 修三条危险边界：
  //   ① 活着的持有者**不凭时间强抢**（时间过期 ≠ 临界区已停；没有续约/fencing 就不能抢）
  //   ② 半写/空锁不给"立即判 stale"——按文件 mtime 给宽限期，过了才回收
  //   ③ 释放要核 ownerToken；旧持有者删不掉继任者的锁
  // 另：锁内容用「临时文件 + rename」写入，保证读者看到的永远是一份完整 JSON。
  const LOCK_LEASE_MS = 30_000
  const LOCK_WAIT_MS = 4_000
  const LOCK_PARTIAL_GRACE_MS = 5_000
  const lockFileOf = (root) => path.join(root, '.kbmeta', 'lock.json')
  // 进程内已持有的锁（root → info）：同一进程内的嵌套调用直接复用，避免自锁死
  const heldLocks = new Map()

  function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    if (pid === process.pid) return true
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return Boolean(error && error.code === 'EPERM') // 存在但无权限
    }
  }

  async function releaseKbLock(root, token) {
    const file = lockFileOf(root)
    let cur = null
    try {
      cur = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      cur = null
    }
    // 只有仍是自己那一把才删；否则宁可留着让后来者判活
    if (cur && cur.token && cur.token !== token) return { ok: false, reason: 'lock-owner-changed' }
    await rm(file, { force: true }).catch(() => {})
    return { ok: true }
  }

  async function acquireKbLock(root, label) {
    const existing = heldLocks.get(root)
    if (existing) return { ok: true, file: lockFileOf(root), info: existing, reentrant: true }
    const file = lockFileOf(root)
    await mkdir(path.dirname(file), { recursive: true })
    const deadline = Date.now() + LOCK_WAIT_MS
    for (let attempt = 0; ; attempt += 1) {
      const info = { pid: process.pid, host: os.hostname(), at: nowIso(), leaseMs: LOCK_LEASE_MS, label, token: crypto.randomUUID() }
      try {
        // 先把内容写进临时文件，再以 wx 的方式"占位"——若占位成功，内容早已完整
        const tmp = path.join(path.dirname(file), `lock.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
        await writeFile(tmp, JSON.stringify(info), 'utf8')
        let handle = null
        try {
          handle = await open(file, 'wx')
        } catch (error) {
          await rm(tmp, { force: true }).catch(() => {})
          throw error
        }
        await handle.close()
        await rename(tmp, file)
        heldLocks.set(root, info)
        return { ok: true, file, info }
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          return { ok: false, reason: 'lock-error', detail: String((error && (error.code || error.message)) ?? error) }
        }
        let cur = null
        try { cur = JSON.parse(await readFile(file, 'utf8')) } catch { cur = null }
        const sameHost = cur !== null && cur.host === os.hostname()
        let stale = false
        if (cur === null) {
          // 半写/空锁：给宽限期，过了才当残留回收
          const st = await stat(file).catch(() => null)
          const age = st === null ? Number.POSITIVE_INFINITY : Date.now() - st.mtimeMs
          stale = age > LOCK_PARTIAL_GRACE_MS
        } else if (sameHost && Number.isInteger(cur.pid) && !pidAlive(cur.pid)) {
          stale = true // 本机确认持有者已死
        } else if (!sameHost && cur.leaseMs > 0 && Date.parse(cur.at) && Date.now() - Date.parse(cur.at) > cur.leaseMs) {
          stale = true // 跨主机无法查 pid，只能按租约
        }
        // 本机确认仍活着 → **永不凭时间抢占**（超租期也等/返 busy）
        if (stale) {
          await writeLog('warn', `回收残留锁（${label}）：${JSON.stringify(cur)}`)
          await rm(file, { force: true }).catch(() => {})
          continue
        }
        if (Date.now() > deadline) {
          return { ok: false, reason: 'lock-busy', detail: `持有者 pid=${cur && cur.pid} host=${cur && cur.host} at=${cur && cur.at} label=${cur && cur.label}` }
        }
        await new Promise((r) => setTimeout(r, 40 + attempt * 25))
      }
    }
  }

  /** 在库级锁内执行；拿不到锁返回 lock-* 结构（不抛异常，调用方按 schema 处理） */
  async function withKbLock(root, label, fn) {
    const lock = await acquireKbLock(root, label)
    if (!lock.ok) {
      await writeLog('warn', `取锁失败（${label}）：${lock.reason} ${lock.detail}`)
      return { ok: false, reason: lock.reason, detail: lock.detail, lock: { held: false } }
    }
    try {
      return await fn()
    } finally {
      if (lock.reentrant !== true) {
        heldLocks.delete(root)
        await releaseKbLock(root, lock.info.token)
      }
    }
  }

  // ── P1-D / R1：索引 meta、全文条目与新鲜度 ─────────────────────────
  // R1 的核心决定：**不再用 token 做「排除」**。索引条目直接带可检索全文（text），
  // 搜索在 text 上做 includes —— 与"读盘扫描"是同一份拼接口径，因此同一快照下
  // 两路结果集合必然相同（旧实现的 ASCII 全词键 + 中文二元组无法表达任意子串）。
  // 外部改动靠 contentFingerprint（path|size|mtimeMs 汇总）失效 → 回退扫描磁盘。
  const INDEX_FORMAT = 2
  const INDEX_TOKENIZER = 'fulltext-v1'

  function excludesFingerprint(conf) {
    return sha12(Buffer.from(excludesOf(conf).join('|'), 'utf8'))
  }

  /** 由「路径 + 字节数 + mtime」拼内容指纹：外部改正文/加删文件都会变 */
  function fingerprintOf(rows) {
    const lines = rows.map((r) => `${r.path}|${r.size}|${r.mtimeMs}`).sort()
    return sha12(Buffer.from(lines.join('\n'), 'utf8'))
  }

  function entryFromBuffer(relPath, abs, buf, mtimeMs) {
    const text = buf.toString('utf8')
    const parsed = parseFrontmatter(text)
    return {
      // 2026-10-17：无 frontmatter id 时按路径派生（见 derivedEntryId）
      entryId: parsed.data.id ?? derivedEntryId(relPath),
      path: relPath,
      title: parsed.data.title ?? path.basename(abs, '.md'),
      kind: parsed.data.type ?? null,
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags : [],
      status: parsed.data.status ?? null,
      updated: parsed.data.updated ?? null,
      revision: sha12(buf),
      size: buf.length,
      mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
      frontmatterValid: parsed.valid !== false,
      // 全文（含 frontmatter）：与旧口径「整份文件读出来做 includes」逐字一致
      text,
    }
  }

  async function indexMetaOf(conf, entries, rootIn = kbRootOf(conf)) {
    const meta = rootIn === null ? { state: 'missing' } : await readMeta(rootIn)
    return {
      kbId: meta.state === 'ok' ? (meta.value.kbId ?? null) : null,
      excludes: excludesFingerprint(conf),
      entries: entries.length,
      format: INDEX_FORMAT,
      tokenizer: INDEX_TOKENIZER,
      fingerprint: fingerprintOf(entries),
      writtenAt: nowIso(),
    }
  }

  /** 索引是否可用于检索：身份/排除规则/格式版本/内容指纹全部对上才算 fresh */
  async function freshnessOf(conf, payload) {
    const root = kbRootOf(conf)
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entries)) {
      return { fresh: false, reason: 'index-corrupt', detail: '索引结构不是 { entries: [...] }' }
    }
    const meta = payload.meta ?? null
    if (meta === null) return { fresh: false, reason: 'index-legacy', detail: '索引缺 meta（旧格式），需重建' }
    const kb = await readMeta(root)
    const kbId = kb.state === 'ok' ? (kb.value.kbId ?? null) : null
    if (meta.kbId !== kbId) return { fresh: false, reason: 'index-kbid-mismatch', detail: `索引 kbId=${meta.kbId} 当前=${kbId}` }
    const excludes = excludesFingerprint(conf)
    if (meta.excludes !== excludes) return { fresh: false, reason: 'index-excludes-changed', detail: '排除规则与索引不一致（需重建）' }
    if (meta.format !== INDEX_FORMAT) return { fresh: false, reason: 'index-format-old', detail: `索引格式 ${meta.format ?? '(缺)'}，本版需要 ${INDEX_FORMAT}` }
    if (meta.tokenizer !== INDEX_TOKENIZER) return { fresh: false, reason: 'index-tokenizer-old', detail: `索引分词版本 ${meta.tokenizer ?? '(缺)'}，本版需要 ${INDEX_TOKENIZER}` }
    // 内容指纹：需要 walk+stat（不读文件），用来抓"用户在文件系统里直接改了正文"
    const current = await diskFingerprint(conf)
    if (current.error) return { fresh: false, reason: 'index-fingerprint-unknown', detail: current.error }
    if (meta.fingerprint !== current.fingerprint) {
      return { fresh: false, reason: 'index-stale-content', detail: `磁盘内容与索引不一致（${current.files} 个 .md；索引写入于 ${meta.writtenAt ?? '-'}），需重建` }
    }
    return { fresh: true, reason: 'ok', detail: '', meta }
  }

  /** 读索引并判新鲜度：一次读取、一个快照（避免 search 里重复 readIndex） */
  async function indexSnapshot(conf) {
    const root = kbRootOf(conf)
    const res = await readJsonState(indexPath(root))
    if (res.state !== 'ok') {
      return { state: res.state, entries: [], freshness: { fresh: false, reason: res.state === 'missing' ? 'index-missing' : 'index-corrupt', detail: res.error ?? '' } }
    }
    const payload = res.value ?? {}
    const entries = Array.isArray(payload.entries) ? payload.entries : []
    const freshness = await freshnessOf(conf, payload)
    return { state: 'ok', entries, payload, generatedAt: payload.generatedAt ?? null, freshness }
  }

  async function indexFreshness(confIn) {
    const conf = confIn ?? (await getConfig())
    if (!conf || !conf.kbPath) return { fresh: false, reason: 'unbound', detail: '未绑定知识库' }
    const snap = await indexSnapshot(conf)
    return snap.state === 'ok' ? snap.freshness : { fresh: false, reason: snap.freshness.reason, detail: snap.freshness.detail ?? '' }
  }

  /** 只更新索引里的某一条（增量）；索引不可用时退回整库重建（重建失败则如实报 failed） */
  async function updateIndexFor(conf, relPath, action = 'upsert') {
    const root = kbRootOf(conf)
    const idx = await readIndex(conf)
    if (idx.state !== 'ok') {
      const rebuilt = await reindexLocked(conf)
      if (rebuilt.ok === false) return { mode: 'failed', reason: rebuilt.reason, scanErrors: rebuilt.scanErrors ?? [] }
      return { mode: 'full', reason: idx.state, count: rebuilt.entries.length }
    }
    const entries = Array.isArray(idx.entries) ? idx.entries.slice() : []
    const at = entries.findIndex((e) => e.path === relPath)
    if (action === 'remove') {
      if (at >= 0) entries.splice(at, 1)
    } else {
      const abs = path.join(root, relPath)
      const buf = await readFile(abs)
      const st = await stat(abs).catch(() => null)
      const entry = entryFromBuffer(relPath, abs, buf, st ? st.mtimeMs : 0)
      if (at >= 0) entries[at] = entry
      else entries.push(entry)
    }
    const payload = { generatedAt: nowIso(), meta: await indexMetaOf(conf, entries), entries }
    await atomicWrite(indexPath(root), JSON.stringify(payload))
    return { mode: 'incremental', count: entries.length }
  }

  /**
   * C1/C2：统一配置闸门。所有"可能写盘"的公开入口都必须先过这里：
   *   - 强制重读磁盘（不依赖调用过 status 刷新缓存）
   *   - 判据统一用 configHealth.ok，不再用有时有、有时没有的 conf.degraded
   *   - 返回可直接透传给工具的结构（含工具 output schema 要求的字段）
   */
  async function configGate() {
    const conf = await getConfigFresh()
    const health = await getConfigHealth()
    if (health.ok === false) {
      return {
        ok: false,
        conf,
        health,
        refusal: {
          ok: false,
          reason: 'config-degraded',
          state: health.state,
          detail: health.detail,
          recovery: health.recovery ?? null,
        },
      }
    }
    // R6：未绑定就是未绑定 —— 不扫描 cwd、不写入、不假装有一个库
    if (kbRootOf(conf) === null) {
      return {
        ok: false,
        conf,
        health,
        refusal: {
          ok: false,
          reason: 'unbound',
          state: 'unbound',
          detail: '未绑定知识库（kbPath 为空）。本版不会把空路径当成当前工作目录；请先选择并绑定一个目录（kb_bind / 设置页「自动建库 / 识别」）。',
          recovery: '绑定一个目录后重试；老用户的既有绑定不受影响',
        },
      }
    }
    return { ok: true, conf, health }
  }

  /** C3：健康检查要校验身份与结构，缺身份不能算健康，也不能自动换身份 */
  async function healthOf(conf, rootIn = kbRootOf(conf)) {
    const root = rootIn
    if (root === null) return { healthy: false, reason: 'unbound', detail: '未绑定知识库（kbPath 为空）' }
    const metaDir = path.join(root, '.kbmeta')
    const metaFile = path.join(metaDir, 'kb.json')
    const indexDir = path.join(metaDir, 'index')
    for (const dir of [metaDir, indexDir]) {
      const st = await stat(dir).catch(() => null)
      if (st === null) {
        return { healthy: false, reason: 'not-initialized', detail: `缺 ${toPosix(path.relative(root, dir)) || dir}` }
      }
      if (!st.isDirectory()) {
        return { healthy: false, reason: 'meta-invalid', detail: `${toPosix(path.relative(root, dir))} 不是目录` }
      }
    }
    const meta = await readMeta(root)
    if (meta.state !== 'ok') {
      return { healthy: false, reason: meta.state === 'missing' ? 'not-initialized' : `meta-${meta.state}`, detail: meta.error ?? '' }
    }
    const m = meta.value
    if (m.installState !== 'complete') {
      return { healthy: false, reason: 'half-initialized', detail: `installState=${m.installState ?? '(缺)'}` }
    }
    if (typeof m.kbId !== 'string' || m.kbId.trim() === '') {
      return { healthy: false, reason: 'invalid-kb-id', detail: 'kb.json 缺 kbId：库身份无效。请恢复元数据，本程序不会自动换身份' }
    }
    if (m.schemaVersion !== SCHEMA_VERSION) {
      return { healthy: false, reason: 'unsupported-meta-schema', detail: `kb.json schemaVersion=${m.schemaVersion}，本版支持 ${SCHEMA_VERSION}` }
    }
    const bad = []
    for (const category of conf.categories ?? []) {
      const st = await stat(path.join(root, category)).catch(() => null)
      if (st === null) bad.push(`${category}（缺）`)
      else if (!st.isDirectory()) bad.push(`${category}（不是目录）`)
    }
    if (bad.length > 0) {
      return { healthy: false, reason: 'invalid-categories', detail: bad.join('、') }
    }
    return { healthy: true, reason: 'ok', detail: '' }
  }

  // ── A：绑定（含初始化预览与确认）──────────────────────────────────
  async function bind(kbPathIn, options = {}) {
    // R6：空路径不是 cwd；相对路径也不猜（一律要求绝对路径）
    const raw = String(kbPathIn ?? '').trim()
    if (raw === '') {
      return { ok: false, kbPath: null, needsConfirm: false, initialized: false, alreadyInitialized: false, kbId: null, willCreate: [], willModify: [], reason: 'empty-path', note: '路径为空：本版不会把空路径当成当前工作目录，请选择一个具体文件夹' }
    }
    if (!path.isAbsolute(raw)) {
      return { ok: false, kbPath: raw, needsConfirm: false, initialized: false, alreadyInitialized: false, kbId: null, willCreate: [], willModify: [], reason: 'relative-path', note: '请传文件夹的绝对路径（相对路径不按进程工作目录解释）' }
    }
    const target = path.resolve(raw)
    // F4：原子提交入口。预期当前绑定 / 配置 revision / 目标身份 + 写入，必须在同一临界区内完成；
    // 任何前置条件不符 → 零改动拒绝（不 bind、不写 config、不写 binding）。
    if (options && options.commit === true) {
      return await commitBind(target, options)
    }
    // 注意：bind 的**正常场景**就是从"未绑定"开始，所以不能走 configGate（它会把 unbound 当拒绝）。
    // 这里只拒绝「配置损坏/降级」。
    const gate = await configGate()
    if (!gate.ok && gate.refusal.reason === 'config-degraded') {
      // 失败返回也要满足 kb_bind 的 output schema（要求 ok + kbPath）
      return {
        ok: false,
        kbPath: toPosix(target),
        needsConfirm: false,
        initialized: false,
        alreadyInitialized: false,
        kbId: null,
        willCreate: [],
        willModify: [],
        ...gate.refusal,
      }
    }
    const conf = gate.conf
    const result = {
      ok: false,
      kbPath: toPosix(target),
      existed: existsSync(target),
      writable: false,
      alreadyInitialized: false,
      kbId: null,
      willCreate: [],
      willModify: [],
      initialized: false,
      needsConfirm: false,
      note: '',
    }

    // 预览阶段**不创建任何东西**（复核意见 §6-3）：只做只读探测
    if (result.existed) {
      const st = await stat(target).catch(() => null)
      if (st === null || !st.isDirectory()) {
        result.note = '目标路径已存在但不是目录'
        await writeLog('warn', `bind 失败：${result.note} ${result.kbPath}`)
        return result
      }
      try {
        await access(target, constants.W_OK)
        result.writable = true
      } catch (error) {
        result.note = `目录不可写：${String((error && (error.code || error.message)) ?? error)}`
        await writeLog('warn', `bind 失败：${result.note}`)
        return result
      }
    } else {
      // 目标不存在：查最近的已存在祖先是否可写（只读判断，不 mkdir）
      let anc = path.dirname(target)
      while (!existsSync(anc) && path.dirname(anc) !== anc) anc = path.dirname(anc)
      try {
        await access(anc, constants.W_OK)
        result.writable = true
        result.note = `目标不存在；确认后会创建（父级 ${toPosix(anc)} 可写）`
      } catch (error) {
        result.note = `目标不存在且父级不可写：${String((error && (error.code || error.message)) ?? error)}（${toPosix(anc)}）`
        await writeLog('warn', `bind 失败：${result.note}`)
        return result
      }
    }

    const meta = await readMeta(target)
    if (meta.state === 'ok') {
      result.alreadyInitialized = true
      result.initialized = meta.value.installState === 'complete'
      result.kbId = meta.value.kbId ?? null
      result.note = '已初始化，接入时不覆盖任何既有文件'
      const written = await setConfig({ kbPath: toPosix(target) })
      if (!written.ok) return { ...result, ...written, ok: false, kbPath: toPosix(target) }
      await writeBinding(result.kbId, target)
      result.ok = true
      await writeLog('info', `bind 接入既有库 kbPath=${result.kbPath} kbId=${result.kbId}`)
      return result
    }
    if (meta.state === 'corrupt') {
      result.note = '目标目录的 .kbmeta/kb.json 已损坏：未做任何改动，请人工检查'
      return result
    }

    result.willCreate = ['.kbmeta/kb.json', '.kbmeta/index/', '.kbmeta/backups/', ...(conf.categories ?? []), 'INDEX.md（仅当缺失）', '_模板/（仅当缺失）']
    if (options.confirmInit !== true) {
      result.needsConfirm = true
      result.note = result.note || '这是全新目录。确认后才会创建上述内容（不会覆盖任何既有文件）。'
      return result
    }
    // 确认后才创建目录并写探针
    try {
      await mkdir(target, { recursive: true })
      const probe = path.join(target, `.kb-write-probe-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
      await writeFile(probe, 'ok', 'utf8')
      await rm(probe, { force: true })
    } catch (error) {
      result.note = `创建目录失败：${String((error && (error.code || error.message)) ?? error)}`
      await writeLog('warn', `bind 失败：${result.note}`)
      return result
    }
    // R2：初始化也会写 .kbmeta（索引/备份目录/恢复记录），走同一把库级锁
    const initResult = await withKbLock(target, 'bind-init', async () => initTo(target, conf))
    result.initialized = initResult.installState === 'complete'
    result.kbId = initResult.kbId ?? null
    const written = await setConfig({ kbPath: toPosix(target) })
    if (!written.ok) return { ...result, ...written, ok: false, kbPath: toPosix(target) }
    await writeBinding(result.kbId, target)
    result.ok = result.initialized
    result.note = result.initialized ? '新库已初始化并绑定' : '初始化未完成，见 init 步骤'
    result.init = initResult
    await writeLog(result.ok ? 'info' : 'warn', `bind+init kbPath=${result.kbPath} 完成=${result.initialized}`)
    return result
  }

  /**
   * F4：原子提交切库。
   * 在 stateDir 配置锁（跨实例）内：重读磁盘配置 → 核对预期当前绑定 / 配置 revision →
   * 核对目标库身份 → 写 config + binding。任一步不符 → commit-conflict，且**零写入**。
   * 注意：不在 bind 之后再检查目标身份（那会让"先切库、再报失败"仍然发生）。
   */
  async function commitBind(target, options = {}) {
    const lock = await acquireConfigLock('commit-bind')
    if (!lock.ok) return { ok: false, kbPath: toPosix(target), reason: 'config-lock-timeout', detail: lock.detail ?? '', needsConfirm: false }
    try {
      const confNow = await loadConfig()
      const cfgHealth = await getConfigHealth()
      if (cfgHealth.ok === false) return { ok: false, kbPath: toPosix(target), reason: 'config-degraded', detail: cfgHealth.detail, needsConfirm: false }
      const expectedRev = options.expectedConfigRevision
      const expectedPath = typeof options.expectedCurrentKbPath === 'string' ? options.expectedCurrentKbPath : null
      const expectedCurrentKbId = options.expectedCurrentKbId ?? null
      const expectedTargetKbId = options.expectedTargetKbId ?? null
      const nowPath = confNow.kbPath ?? ''
      const conflict = (kind, extra) => ({
        ok: false,
        kbPath: toPosix(target),
        needsConfirm: false,
        reason: 'commit-conflict',
        conflict: kind,
        expected: { revision: expectedRev ?? null, kbPath: expectedPath, kbId: expectedCurrentKbId, targetKbId: expectedTargetKbId },
        actual: { revision: confNow.revision ?? null, kbPath: nowPath, kbId: null, targetKbId: null },
        note: '提交前置条件不符：未绑定、config.json 与 binding 文件均未改动',
        ...extra,
      })
      if (expectedRev !== undefined && expectedRev !== null && String(confNow.revision ?? '') !== String(expectedRev)) {
        return conflict('config-revision')
      }
      if (expectedPath !== null && normAbs(nowPath) !== normAbs(expectedPath)) {
        return conflict('current-binding')
      }
      let currentKbId = null
      try {
        const b = JSON.parse(await readFile(bindingFile, 'utf8'))
        currentKbId = b.kbId ?? null
      } catch {
        currentKbId = null
      }
      if (expectedCurrentKbId !== null && String(currentKbId ?? '') !== String(expectedCurrentKbId)) {
        return conflict('current-kbId', { actual: { revision: confNow.revision ?? null, kbPath: nowPath, kbId: currentKbId, targetKbId: null } })
      }
      // 目标身份必须在**写入之前**核对
      const meta = await readMeta(target)
      if (meta.state !== 'ok') {
        return { ...conflict('target-meta'), detail: `目标库元数据不可用（${meta.state}）：${meta.error ?? ''}` }
      }
      if (meta.value.installState !== 'complete') {
        return { ...conflict('target-meta'), detail: `目标库初始化未完成（installState=${meta.value.installState ?? '(缺)'}）` }
      }
      const targetKbId = meta.value.kbId ?? null
      if (expectedTargetKbId !== null && String(targetKbId ?? '') !== String(expectedTargetKbId)) {
        return { ...conflict('target-kbId', { actual: { revision: confNow.revision ?? null, kbPath: nowPath, kbId: currentKbId, targetKbId } }) }
      }
      const built = buildConfigPatch(confNow, { kbPath: toPosix(target) })
      if (!built.ok) return { ok: false, kbPath: toPosix(target), needsConfirm: false, ...built }
      const next = { ...built.value, revision: (confNow.revision ?? 1) + 1, updatedAt: nowIso() }
      await atomicWrite(configFile, JSON.stringify(next, null, 2))
      config = next
      configHealth = { ok: true, state: 'loaded', detail: '' }
      await writeBinding(targetKbId, target)
      await writeLog('info', `原子提交切库 kbPath=${toPosix(target)} kbId=${targetKbId} revision=${next.revision}`)
      return {
        ok: true,
        kbPath: toPosix(target),
        existed: true,
        writable: true,
        alreadyInitialized: true,
        initialized: true,
        kbId: targetKbId,
        revision: next.revision,
        willCreate: [],
        willModify: [],
        needsConfirm: false,
        note: '已原子提交（前置条件与写入在同一临界区）',
      }
    } finally {
      await releaseConfigLock(lock.token)
    }
  }

  async function writeBinding(kbId, target) {
    await atomicWrite(bindingFile, JSON.stringify({ kbId, kbPath: toPosix(target), boundAt: nowIso(), stateDir: toPosix(stateDir) }, null, 2))
  }

  // ── C：初始化有完成标记；半成品重试补齐 ─────────────────────────────
  async function initTo(root, conf) {
    const created = []
    const repaired = []
    const skipped = []
    await mkdir(root, { recursive: true })
    const metaDir = path.join(root, '.kbmeta')
    await mkdir(path.join(metaDir, 'index'), { recursive: true })
    await mkdir(path.join(metaDir, 'backups'), { recursive: true })
    const metaFile = path.join(metaDir, 'kb.json')
    const meta = await readMeta(root)
    let state = meta.state === 'ok' ? meta.value : null
    if (meta.state === 'corrupt') {
      return { installState: 'blocked', reason: 'meta-corrupt', detail: 'kb.json 损坏，未改动', kbId: null, created, repaired, skipped }
    }
    if (state === null) {
      state = {
        schemaVersion: SCHEMA_VERSION,
        kbId: crypto.randomUUID(),
        name: path.basename(root),
        createdAt: nowIso(),
        createdBy: `dsh-knowledge-base@${VERSION}`,
        stateDir: toPosix(stateDir),
        installState: 'partial',
      }
      await atomicWrite(metaFile, JSON.stringify(state, null, 2))
      created.push('.kbmeta/kb.json')
    } else if (state.installState !== 'complete') {
      repaired.push(`继续未完成的初始化（原 installState=${state.installState ?? '(缺)'}）`)
    } else {
      skipped.push('.kbmeta/kb.json')
    }
    for (const category of conf.categories ?? []) {
      const dir = path.join(root, category)
      if (existsSync(dir)) skipped.push(category)
      else {
        try {
          await mkdir(dir, { recursive: true })
          created.push(category + '/')
        } catch (error) {
          const detail = `${category}: ${(error && (error.code || error.message)) ?? error}`
          await writeLog('warn', `建分类目录失败 ${detail}`)
          return { installState: 'partial', reason: 'mkdir-failed', detail, kbId: state.kbId, created, repaired, skipped }
        }
      }
    }
    const indexFile = path.join(root, 'INDEX.md')
    if (existsSync(indexFile)) skipped.push('INDEX.md')
    else {
      await atomicWrite(
        indexFile,
        buildFile(
          { title: '索引', type: '索引', tags: ['索引'], status: '进行中', created: today(), updated: today() },
          '# 索引\n\n> 人工维护的导航页。插件不会覆盖本文件。\n\n## 板块\n\n' + (conf.categories ?? []).map((c) => `- [${c}/](${c}/)`).join('\n') + '\n',
        ),
      )
      created.push('INDEX.md')
    }
    const tplDir = path.join(root, '_模板')
    if (existsSync(tplDir)) skipped.push('_模板/')
    else {
      await mkdir(tplDir, { recursive: true })
      for (const [name, text] of Object.entries(TEMPLATES)) await atomicWrite(path.join(tplDir, name), text)
      created.push('_模板/（3 个模板）')
    }
    state.installState = 'complete'
    state.completedAt = nowIso()
    await atomicWrite(metaFile, JSON.stringify(state, null, 2))
    await writeLog('info', `init 完成 kbId=${state.kbId} 新建=${created.length} 补齐=${repaired.length}`)
    return { installState: 'complete', kbId: state.kbId, created, repaired, skipped }
  }

  async function init() {
    const gate = await configGate()
    if (!gate.ok) {
      // kb_init 的 output schema 要求 installState，失败返回也必须带上
      return { ok: false, installState: 'blocked', reason: gate.refusal.reason, detail: gate.refusal.detail, recovery: gate.refusal.recovery }
    }
    const conf = gate.conf
    const root = kbRootOf(conf)
    // R2：init 也会写 .kbmeta（含 index 目录），必须与 create/update/check 共用同一把锁
    return withLock(root, () => withKbLock(root, 'init', async () => {
      const result = await initTo(root, conf)
      const health = await healthOf(conf)
      if (result.installState === 'complete') await writeBinding(result.kbId, root)
      return { ok: result.installState === 'complete', ...result, health }
    }))
  }

  // ── 索引 ────────────────────────────────────────────────────────────
  const indexPath = (root) => path.join(root, '.kbmeta', 'index', 'entries.json')

  async function readIndex(conf) {
    const res = await readJsonState(indexPath(kbRootOf(conf)))
    if (res.state === 'ok') return { state: 'ok', ...res.value }
    return { state: res.state, entries: [] }
  }

  async function writeIndex(conf, entries) {
    const payload = { generatedAt: nowIso(), meta: await indexMetaOf(conf, entries), entries }
    const root = kbRootOf(conf)
    if (root === null) return { ok: false, reason: 'unbound' }
    await atomicWrite(indexPath(root), JSON.stringify(payload))
    return payload
  }

  /** 对**指定根目录**写索引（R6：初始化新库时当前绑定还没切，不能用 kbRootOf(conf)） */
  async function writeIndexAtRoot(root, conf, entries) {
    const payload = { generatedAt: nowIso(), meta: await indexMetaOf(conf, entries, root), entries }
    await atomicWrite(indexPath(root), JSON.stringify(payload))
    return payload
  }

  /**
   * R6 / R1：在**指定目录**建库或补齐（不切换当前绑定、不写 binding.json）。
   * 用于：
   *   · setup 新建空库（先建好、验证健康，再 bind 切库）；
   *   · 导入任务的目标库（任务有自己的 core，不应借道当前绑定）。
   * rebuildIndex=true 时若索引不存在则写一份**有效空索引**（避免"刚建好就提示要重建"）。
   */
  async function initializeLibrary(kbPathIn, options = {}) {
    const raw = String(kbPathIn ?? '').trim()
    if (raw === '') return { ok: false, reason: 'empty-path', error: '路径为空' }
    if (!path.isAbsolute(raw)) return { ok: false, reason: 'relative-path', error: '请传绝对路径' }
    const target = path.resolve(raw)
    const gate = await configGate()
    if (!gate.ok && gate.refusal.reason === 'config-degraded') return { ok: false, ...gate.refusal }
    const conf = gate.conf
    const st = await stat(target).catch(() => null)
    if (st !== null && !st.isDirectory()) return { ok: false, reason: 'not-a-directory', error: '目标不是文件夹' }
    if (st === null) {
      try {
        await mkdir(target, { recursive: true })
      } catch (error) {
        return { ok: false, reason: 'mkdir-failed', error: String((error && (error.code || error.message)) ?? error) }
      }
    }
    const initResult = await withKbLock(target, 'bind-init', async () => initTo(target, conf))
    if (initResult.installState !== 'complete') {
      return { ok: false, reason: 'init-incomplete', error: '初始化未完成：' + (initResult.reason ?? initResult.detail ?? initResult.installState), init: initResult }
    }
    let indexWritten = false
    if (options.rebuildIndex === true && !existsSync(indexPath(target))) {
      await writeIndexAtRoot(target, conf, [])
      indexWritten = true
    }
    const health = await healthOf(conf, target)
    return {
      ok: true,
      kbPath: toPosix(target),
      kbId: initResult.kbId ?? null,
      initialized: true,
      indexWritten,
      health,
      created: initResult.created,
      repaired: initResult.repaired,
    }
  }

  async function walkMd(root, exclude, dir = root, acc = [], errors = [], links = []) {
    let items = []
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // R4：目录枚举错误必须回传（以前这个 errors 数组被调用方丢掉，扫描不完整也当成功）
      errors.push(`${toPosix(path.relative(root, dir)) || '.'}: ${(error && (error.code || error.message)) ?? error}`)
      return acc
    }
    for (const item of items) {
      const full = path.join(dir, item.name)
      const rel = toPosix(path.relative(root, full))
      if (exclude.some((e) => rel === e || rel.startsWith(e + '/') || item.name === e)) continue
      // 2026-10-17：导航文件不算条目（与库自己的 kb-check.ps1 的 $NavFiles 对齐）。
      // · INDEX.md 在任何层级都是导航（根索引 + 各板块索引），一律跳过；
      // · AGENTS.md / README.md / 知识库清单.md **只在根目录**跳过 ——
      //   子目录里的 README.md（如 10-项目/每日信息/README.md 交付台账）仍是条目。
      if (item.name === 'INDEX.md' || (dir === root && ROOT_NAV_FILES.has(item.name))) continue
      // P1-A：链接/重解析点一律跳过，并登记（以前是静默忽略，无法说明覆盖范围）
      if (item.isSymbolicLink()) {
        links.push(rel)
        continue
      }
      if (item.isDirectory()) await walkMd(root, exclude, full, acc, errors, links)
      else if (item.name.endsWith('.md') && !item.name.includes('.tmp-')) acc.push(full)
    }
    return acc
  }

  /** 只 stat 不读内容的指纹（用于"外部是否改过"的廉价检测） */
  async function diskFingerprint(conf) {
    const root = kbRootOf(conf)
    const dirErrors = []
    const links = []
    let files = []
    try {
      files = await walkMd(root, excludesOf(conf), root, [], dirErrors, links)
    } catch (error) {
      return { error: String((error && error.message) ?? error), files: 0 }
    }
    if (dirErrors.length > 0) return { error: `目录枚举失败：${dirErrors[0]}`, files: files.length }
    const rows = []
    for (const file of files) {
      const rel = toPosix(path.relative(root, file))
      if (rel === 'INDEX.md') continue
      const st = await stat(file).catch(() => null)
      if (st === null) return { error: `无法读取文件属性：${rel}`, files: files.length }
      rows.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs })
    }
    return { fingerprint: fingerprintOf(rows), files: rows.length }
  }

  async function scanDisk(conf, root) {
    const links = []
    const dirErrors = []
    const files = await walkMd(root, excludesOf(conf), root, [], dirErrors, links)
    const entries = []
    const scanErrors = [...dirErrors]
    for (const file of files) {
      const rel = toPosix(path.relative(root, file))
      if (rel === 'INDEX.md') continue
      try {
        const buf = await readFile(file)
        const st = await stat(file).catch(() => null)
        entries.push(entryFromBuffer(rel, file, buf, st ? st.mtimeMs : 0))
      } catch (error) {
        scanErrors.push(`${rel}: ${(error && (error.code || error.message)) ?? error}`)
      }
    }
    return { entries, scanErrors, scannedFiles: files.length, skippedLinks: links }
  }

  /**
   * 重建索引（调用方必须已持库级锁）。
   * R4：扫描不完整时**不得**用不完整结果覆盖完整索引 —— 保留旧索引并如实报 partial。
   */
  async function reindexLocked(conf) {
    const root = kbRootOf(conf)
    const { entries, scanErrors, scannedFiles, skippedLinks } = await scanDisk(conf, root)
    if (scanErrors.length > 0) {
      await writeLog('warn', `索引未重建：扫描不完整（${scanErrors.length} 处错误，已扫描 ${scannedFiles} 个 .md），保留旧索引`)
      return { ok: false, partial: true, indexPreserved: true, reason: 'scan-incomplete', entries: [], scanErrors, scannedFiles, skippedLinks }
    }
    const payload = await writeIndex(conf, entries)
    await writeLog('info', `索引重建：${entries.length} 条（扫描 ${scannedFiles} 个 .md）`)
    return { ok: true, ...payload, scanErrors, scannedFiles, skippedLinks }
  }

  /** 公开重建入口：自己上锁（在锁内调用请用 reindexLocked） */
  async function reindex() {
    const conf = await getConfig()
    const root = kbRootOf(conf)
    return withLock(root, () => withKbLock(root, 'reindex', () => reindexLocked(conf)))
  }

  // ── R4：幂等请求标识（重试不重复建条目）────────────────────────────
  // 落盘 .kbmeta/requests.json。只对自己「上次没写完」的同一个请求做续做；
  // **不按标题合并已完成条目**（用户主动再建 = 新请求）。
  const requestsFileOf = (root) => path.join(root, '.kbmeta', 'requests.json')
  const REQUESTS_KEEP = 200
  const REQUESTS_TTL_MS = 7 * 24 * 3600 * 1000

  async function readRequests(root) {
    const res = await readJsonState(requestsFileOf(root))
    if (res.state === 'ok' && res.value && typeof res.value.items === 'object' && res.value.items !== null) {
      return { items: res.value.items }
    }
    return { items: {} }
  }

  async function saveRequests(root, store) {
    const now = Date.now()
    const keys = Object.keys(store.items)
    // 先丢"已完成且过期"的，再按时间保留最近 N 条；partial 的一律留着（它是恢复证据）
    for (const key of keys) {
      const it = store.items[key]
      const at = Date.parse(it && it.at)
      if (it && it.partial !== true && Number.isFinite(at) && now - at > REQUESTS_TTL_MS) delete store.items[key]
    }
    const rest = Object.keys(store.items)
    if (rest.length > REQUESTS_KEEP) {
      rest
        .filter((k) => store.items[k].partial !== true)
        .sort((a, b) => String(store.items[a].at).localeCompare(String(store.items[b].at)))
        .slice(0, rest.length - REQUESTS_KEEP)
        .forEach((k) => delete store.items[k])
    }
    await atomicWrite(requestsFileOf(root), JSON.stringify({ schemaVersion: 1, items: store.items }))
  }

  function contentHashOf(text) {
    return sha12(Buffer.from(String(text ?? ''), 'utf8'))
  }

  // ── 写入（D：路径边界 + 强制版本；E：互斥 + 部分完成）───────────────
  async function createEntry(args) {
    // C1：写入口必须强制重读并校验配置，不能吃 status 留下的缓存
    const gate = await configGate()
    if (!gate.ok) return { ok: false, entryId: null, reason: gate.refusal.reason, detail: gate.refusal.detail }
    const conf = gate.conf
    const root = kbRootOf(conf)
    const health = await healthOf(conf)
    if (!health.healthy) {
      return {
        ok: false,
        reason: 'not-initialized',
        detail: `知识库不可用（${health.reason}${health.detail ? ': ' + health.detail : ''}）。请先 kb_bind（新目录需 confirmInit=true）或 kb_init 补齐。`,
      }
    }
    const kind = args.kind ?? '知识'
    const category = KIND_TO_CATEGORY[kind]
    if (!category) return { ok: false, reason: 'bad-kind', detail: `可用：${Object.keys(KIND_TO_CATEGORY).join(' / ')}` }
    const requestIdIn = typeof args.requestId === 'string' && args.requestId.trim() !== '' ? args.requestId.trim() : null
    const titleIn = String(args.title ?? '')
    const contentHash = contentHashOf(args.content)
    return withLock(root, () => withKbLock(root, 'create', async () => {
      const store = await readRequests(root)
      // R4：重试同一个请求 → 返回原结果并继续未完成步骤（绝不新建第二个条目）
      let reqId = requestIdIn
      let resume = reqId !== null && store.items[reqId] ? store.items[reqId] : null
      if (resume === null) {
        // 没带 requestId 时，只认「上一次 partial 且文件仍在」的同一请求；
        // 不按标题合并已完成条目（用户主动再建 = 新请求）。
        const cand = Object.values(store.items).find(
          (it) => it && it.op === 'create' && it.partial === true && it.title === titleIn && it.contentHash === contentHash && typeof it.path === 'string' && existsSync(path.join(root, it.path)),
        )
        if (cand) { resume = cand; reqId = cand.requestId }
      }
      if (resume !== null) {
        // F1：同一 requestId 的**不同 payload** 必须拒绝，而不是返回旧结果
        if (requestIdIn !== null && (resume.title !== titleIn || (typeof resume.contentHash === 'string' && resume.contentHash !== contentHash))) {
          await writeLog('warn', `create 拒绝：requestId=${reqId} 的 payload 与上次不同`)
          return { ok: false, reason: 'request-payload-mismatch', requestId: reqId, detail: '同一 requestId 的标题/正文与上次不同：请为新内容使用新的 requestId（旧结果不能代表新内容）' }
        }
        const abs = path.join(root, resume.path)
        const buf = await readFile(abs)
        let indexSynced = true
        let indexMode = 'incremental'
        try {
          const synced = await updateIndexFor(conf, resume.path, 'upsert')
          indexMode = synced.mode
          if (synced.mode === 'failed') indexSynced = false
        } catch (error) {
          indexSynced = false
          indexMode = 'failed'
          await appendFile(path.join(root, '.kbmeta', 'recover-todo.log'), `${nowIso()}\t${resume.entryId}\t${resume.path}\treindex-failed\n`, 'utf8')
          await writeLog('warn', `create 重试后索引仍失败（条目已在）：${String(error)}`)
        }
        store.items[resume.requestId] = { ...resume, op: 'create', title: titleIn, contentHash, partial: !indexSynced, indexSynced, at: nowIso() }
        await saveRequests(root, store)
        await writeLog('info', `create 同一请求重试 → 复用 entryId=${resume.entryId}（${indexSynced ? '已补索引' : '索引仍失败'}）`)
        return {
          ok: true, resumed: true, deduplicated: true, partial: !indexSynced,
          indexSynced, indexMode, recoveryPending: !indexSynced,
          entryId: resume.entryId, revision: sha12(buf), path: resume.path,
        }
      }
      const entryId = 'kb-' + crypto.randomBytes(4).toString('hex')
      const dir = path.join(root, category)
      if (!isInside(root, dir)) return { ok: false, reason: 'path-escape', detail: category }
      // P1-A：分类目录若是链接/重解析点（或指到库外），拒绝写入
      const dirCheck = await checkRealPath(root, dir, { followLinks: conf.followLinks })
      if (!dirCheck.ok) {
        await writeLog('warn', `拒绝写入（分类目录真实路径异常）：${category} ${dirCheck.reason} ${dirCheck.detail}`)
        return { ok: false, reason: dirCheck.reason, detail: `分类目录 ${category}：${dirCheck.detail}` }
      }
      await mkdir(dir, { recursive: true })
      let file = path.join(dir, `${today()}-${slugOf(args.title)}.md`)
      if (existsSync(file)) file = path.join(dir, `${today()}-${slugOf(args.title)}-${entryId.slice(3)}.md`)
      if (!isInside(root, file)) return { ok: false, reason: 'path-escape', detail: toPosix(file) }
      const fileCheck = await checkRealPath(root, file, { followLinks: conf.followLinks })
      if (!fileCheck.ok) {
        await writeLog('warn', `拒绝写入（目标文件真实路径异常）：${fileCheck.reason} ${fileCheck.detail}`)
        return { ok: false, reason: fileCheck.reason, detail: fileCheck.detail }
      }
      const data = {
        id: entryId,
        title: args.title,
        type: kind,
        tags: args.tags ?? [],
        status: '进行中',
        created: today(),
        updated: today(),
      }
      if (args.source) data.source = args.source
      await atomicWrite(file, buildFile(data, String(args.content ?? '').trimEnd() + '\n'))
      const buf = await readFile(file)
      const relPath = toPosix(path.relative(root, file))
      const recId = reqId ?? entryId
      // P1-D/F：只更新自己那一条，不再整库重建；索引不可用才退回全量
      let indexMode = 'incremental'
      let partial = false
      try {
        const synced = await updateIndexFor(conf, relPath, 'upsert')
        indexMode = synced.mode
        if (synced.mode === 'failed') partial = true
      } catch (error) {
        partial = true
        indexMode = 'failed'
        await appendFile(path.join(root, '.kbmeta', 'recover-todo.log'), `${nowIso()}\t${entryId}\t${relPath}\treindex-failed\n`, 'utf8')
        await writeLog('warn', `create 后索引失败（条目已写入）：${String(error)}`)
      }
      store.items[recId] = {
        requestId: recId, op: 'create', entryId, path: relPath, title: titleIn, contentHash,
        revision: sha12(buf), partial, indexSynced: !partial, at: nowIso(),
      }
      await saveRequests(root, store)
      if (partial) return { ok: true, partial: true, indexSynced: false, indexMode: 'failed', recoveryPending: true, entryId, revision: sha12(buf), path: relPath, requestId: recId }
      await writeLog('info', `create ${entryId} → ${relPath}`)
      return { ok: true, indexSynced: true, indexMode, entryId, revision: sha12(buf), path: relPath, requestId: recId }
    }))
  }

  async function updateEntry(args) {
    // C1：同上——配置损坏时 update 曾经仍按旧缓存写入
    const gate = await configGate()
    if (!gate.ok) return { ok: false, entryId: args?.entryId ?? null, reason: gate.refusal.reason, detail: gate.refusal.detail }
    const conf = gate.conf
    if (typeof args.expectedRevision !== 'string' || args.expectedRevision.trim() === '') {
      return { ok: false, reason: 'revision-required', detail: 'update 必须带非空 expectedRevision；先用 kb_search/kb_status 取当前 revision' }
    }
    if (typeof args.entryId !== 'string' || args.entryId.trim() === '') {
      return { ok: false, reason: 'entry-required', detail: 'update 必须带 entryId' }
    }
    const root = kbRootOf(conf)
    return withLock(root, () => withKbLock(root, 'update', async () => {
      const index = await readIndex(conf)
      if (index.state !== 'ok') {
        return { ok: false, reason: 'index-unavailable', detail: `索引状态=${index.state}；先跑 kb_check（rebuild）再更新` }
      }
      const hit = index.entries.find((e) => e.entryId === args.entryId)
      if (!hit) return { ok: false, notFound: true, entryId: args.entryId, detail: '索引中没有这个 entryId' }
      if (path.isAbsolute(hit.path) || hit.path.includes('..') || !isInside(root, path.join(root, hit.path))) {
        await writeLog('warn', `拒绝越界路径 entryId=${args.entryId} path=${hit.path}`)
        return { ok: false, reason: 'path-escape', detail: `索引路径越出知识库：${hit.path}` }
      }
      const file = path.join(root, hit.path)
      if (!existsSync(file)) return { ok: false, notFound: true, entryId: args.entryId, detail: '索引有、文件已不在' }
      // P1-A：索引里的路径也必须通过真实路径校验（防索引被改成指向库外的 junction）
      const fileCheck = await checkRealPath(root, file, { followLinks: conf.followLinks })
      if (!fileCheck.ok) {
        await writeLog('warn', `拒绝更新（真实路径异常）：${args.entryId} ${fileCheck.reason} ${fileCheck.detail}`)
        return { ok: false, reason: fileCheck.reason, detail: fileCheck.detail }
      }
      const buf = await readFile(file)
      const currentRevision = sha12(buf)
      const reqIdIn = typeof args.requestId === 'string' && args.requestId.trim() !== '' ? args.requestId.trim() : null
      // F1：把"这次要写的内容"也算进请求身份，避免同一 requestId 的不同 payload 被当成重试
      const payloadHash = sha256(Buffer.from(JSON.stringify({ content: typeof args.content === 'string' ? args.content : null, patch: args.patch ?? null }), 'utf8'))
      // R4：同一 requestId 重试 —— 若上次已经写成功（当前 revision 就是那次的结果），直接返回原结果
      if (reqIdIn !== null) {
        const store = await readRequests(root)
        const prev = store.items[reqIdIn]
        if (prev && prev.op === 'update' && prev.entryId === args.entryId) {
          if (typeof prev.payloadHash === 'string' && prev.payloadHash !== payloadHash) {
            await writeLog('warn', `update 拒绝：requestId=${reqIdIn} 的 payload 与上次不同`)
            return { ok: false, reason: 'request-payload-mismatch', requestId: reqIdIn, detail: '同一 requestId 的内容/patch 与上次不同：请为新内容使用新的 requestId' }
          }
          if (prev.revision === currentRevision) {
            await writeLog('info', `update 同一请求重试 → 返回原结果 entryId=${args.entryId}`)
            return {
              ok: true, deduplicated: true, resumed: true, entryId: prev.entryId, revision: prev.revision,
              path: hit.path, indexSynced: prev.indexSynced !== false, indexMode: prev.indexMode ?? 'incremental',
              partial: prev.indexSynced === false, recoveryPending: prev.indexSynced === false,
            }
          }
        }
      }
      if (args.expectedRevision !== currentRevision) {
        await writeLog('warn', `update 冲突 ${args.entryId}: 期望 ${args.expectedRevision} 实际 ${currentRevision}`)
        return { ok: false, conflict: true, entryId: args.entryId, currentRevision, currentPath: hit.path, diffSummary: `期望 revision ${args.expectedRevision}，当前 ${currentRevision}（未写入任何内容）` }
      }
      const text0 = buf.toString('utf8')
      const parsed = parseFrontmatter(text0)
      if (!parsed.parts) {
        return { ok: false, reason: 'frontmatter-invalid', detail: `frontmatter 无法安全解析（${parsed.reason ?? '无 frontmatter'}）；为免毁坏数据，本次拒绝写回` }
      }
      // 2026-10-17：无 frontmatter id 的条目走派生 id（path → id），此处按**有效 id** 比对
      const effectiveId = parsed.data.id ?? derivedEntryId(hit.path)
      if (effectiveId !== args.entryId) {
        return { ok: false, reason: 'id-mismatch', detail: `索引 entryId=${args.entryId} 与文件有效 id=${effectiveId}（frontmatter id=${parsed.data.id ?? '(缺，按路径派生)'}）不一致` }
      }
      // R3：认不出的结构（嵌套/缩进/块标量/注释/重复键…）一律在写盘前拒绝
      if (parsed.unsupported) return { ok: false, reason: 'unsupported-frontmatter', detail: parsed.unsupported + '；为避免毁坏数据，本次拒绝写回' }
      const data = { ...parsed.data }
      const changed = []
      if (typeof args.content === 'string') changed.push('content')
      if (args.patch && typeof args.patch === 'object') {
        for (const key of ['title', 'type', 'tags', 'status', 'source']) {
          if (args.patch[key] !== undefined) {
            if (key === 'type' && !ALLOWED_TYPES.includes(args.patch.type)) {
              return { ok: false, reason: 'bad-type', detail: `type 必须是 ${ALLOWED_TYPES.join(' / ')} 之一（收到 ${JSON.stringify(args.patch.type)}）` }
            }
            data[key] = args.patch[key]
            changed.push(key)
          }
        }
      }
      if (changed.length === 0) return { ok: false, reason: 'no-change', detail: 'update 需要 content 或 patch 至少一项' }
      data.updated = today()
      const backupDir = path.join(root, '.kbmeta', 'backups', nowIso().replace(/[:.]/g, '-'))
      await mkdir(backupDir, { recursive: true })
      await writeFile(path.join(backupDir, `${args.entryId}.${currentRevision}.md`), buf)
      // R3：只替换 frontmatter 区块；只改元数据时正文按原始字节拼回（CRLF/LF/混合都保留）
      await atomicWrite(file, composeWithHeader(parsed.parts, data, typeof args.content === 'string' ? args.content : undefined))
      const nextBuf = await readFile(file)
      let indexSynced = true
      let indexMode = 'incremental'
      try {
        const synced = await updateIndexFor(conf, hit.path, 'upsert')
        indexMode = synced.mode
        if (synced.mode === 'failed') indexSynced = false
      } catch (error) {
        indexSynced = false
        indexMode = 'failed'
        await appendFile(path.join(root, '.kbmeta', 'recover-todo.log'), `${nowIso()}\t${args.entryId}\t${hit.path}\treindex-failed\n`, 'utf8')
        await writeLog('warn', `update 后索引失败（条目已写入）：${String(error)}`)
      }
      if (reqIdIn !== null) {
        const store = await readRequests(root)
        store.items[reqIdIn] = {
          requestId: reqIdIn, op: 'update', entryId: args.entryId, path: hit.path,
          revision: sha12(nextBuf), payloadHash, indexSynced, indexMode, partial: !indexSynced, at: nowIso(),
        }
        await saveRequests(root, store)
      }
      await writeLog('info', `update ${args.entryId} 字段=${changed.join(',')} rev ${currentRevision}→${sha12(nextBuf)}`)
      return { ok: true, partial: !indexSynced, indexSynced, indexMode, recoveryPending: !indexSynced, entryId: args.entryId, revision: sha12(nextBuf), path: hit.path, changed }
    }))
  }

  // ── 检索（R1：索引全文 includes，语义与磁盘扫描逐字一致）────────────
  async function search(args) {
    const gate = await configGate()
    if (!gate.ok) {
      return { ok: false, reason: gate.refusal.reason, hits: [], coverageNote: gate.refusal.reason === 'unbound' ? '未绑定知识库，未检索。' : '配置降级，未检索。', detail: gate.refusal.detail }
    }
    const conf = gate.conf
    const root = kbRootOf(conf)
    const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20)
    const query = String(args.query ?? '').trim()
    if (query === '') return { ok: false, reason: 'empty-query', hits: [], coverageNote: 'query 不能为空' }
    const lower = query.toLowerCase()

    // 只读一次索引、只判一次新鲜度（P1 里这两步各读一遍索引）
    const snap = await indexSnapshot(conf)
    let entries = snap.entries
    let mode = 'index'
    let note = ''
    let generatedAt = snap.generatedAt ?? null
    if (snap.state !== 'ok' || !snap.freshness.fresh) {
      // R1：索引不能证明与磁盘一致时，**必须回退扫描**——宁可慢，不能漏
      const scanned = await scanDisk(conf, root)
      entries = scanned.entries
      mode = 'disk-scan'
      generatedAt = null
      const why = snap.state !== 'ok'
        ? `索引${snap.state === 'missing' ? '不存在' : '损坏'}`
        : `索引已过期（${snap.freshness.reason}）`
      note = `${why}，已改为**扫描磁盘**兜底（${scanned.scannedFiles} 个 .md${scanned.scanErrors.length ? `，${scanned.scanErrors.length} 处扫描错误` : ''}${(scanned.skippedLinks ?? []).length ? `，跳过 ${scanned.skippedLinks.length} 个链接目录` : ''}）；建议 kb_check(rebuild) 重建索引。`
    }

    const metaHits = []
    const bodyHits = []
    const metaPaths = new Set()
    for (const e of entries) {
      const inMeta =
        String(e.title).toLowerCase().includes(lower) ||
        (e.tags ?? []).some((t) => String(t).toLowerCase().includes(lower)) ||
        String(e.kind ?? '').toLowerCase().includes(lower)
      if (!inMeta) continue
      metaHits.push({ entryId: e.entryId, path: e.path, title: e.title, snippet: `（标题/标签命中）tags=${(e.tags ?? []).join(',') || '-'}`, revision: e.revision })
      metaPaths.add(e.path)
    }
    for (const e of entries) {
      if (metaPaths.has(e.path)) continue // R1：按 path 归一（旧库 entryId 可能为 null）
      let text = typeof e.text === 'string' ? e.text : null
      if (text === null) {
        // 旧格式索引没有 text：读盘（宁可多读，不能漏）
        try {
          text = await readFile(path.join(root, e.path), 'utf8')
        } catch {
          continue
        }
      }
      const at = text.toLowerCase().indexOf(lower)
      if (at >= 0) {
        const snippet = text.slice(Math.max(0, at - 40), Math.min(text.length, at + query.length + 60)).replace(/\s+/g, ' ')
        bodyHits.push({ entryId: e.entryId, path: e.path, title: e.title, snippet: '…' + snippet + '…', revision: e.revision })
      }
    }
    // F3：原件与派生条目按**真实来源身份**去重（kbId + sourceRoot + originalPath + mode）：
    //   · 只有 attach 且源根就是当前库时，原件才在检索层里 → 才允许折叠；
    //   · copy 的原件在 90-收件箱（不参与检索），不能拿"源相对路径"去匹配目标库里的同名无关文件。
    let deduped = [...metaHits, ...bodyHits]
    try {
      const meta = await readMeta(root)
      const kbId = meta.state === 'ok' ? meta.value.kbId ?? null : null
      const sourceEntries = await readImportSources(root)
      const paths = deduped.map((h) => toPosix(h.path))
      const pairs = foldGeneratedPairs(paths, sourceEntries, { kbId, root })
      if (pairs.size > 0) deduped = deduped.filter((h) => !pairs.has(toPosix(h.path)))
    } catch {
      /* 没有来源映射就不去重（宁多一条，不少一条） */
    }
    const hits = deduped.slice(0, limit)
    const coverageNote =
      (hits.length === 0 ? '未找到匹配内容。' : '') +
      (note ? note + ' ' : '') +
      `正文预筛：未启用（索引条目内置全文，逐条按子串匹配，语义与扫描一致；被排除 0 条）；` +
      `检索方式=${mode}；范围=${entries.length} 个条目（标题/标签/正文全文）；` +
      `未纳入：${excludesOf(conf).join('、')}、原件二进制内容、未解析文件；` +
      (generatedAt ? `索引生成于 ${generatedAt}。` : '未使用索引。')
    await writeLog('info', `search "${query}" mode=${mode} 命中=${hits.length} 覆盖=${entries.length}`)
    return { ok: true, hits, coverageNote, mode }
  }

  // ── 检查（R2：走同一把库级锁；R4：扫描不完整不覆盖完整索引）─────────
  async function checkLocked(conf) {
    const root = kbRootOf(conf)
    const health = await healthOf(conf)
    // 一次读取、一个快照（旧实现 readIndex + indexFreshness 各读一遍）
    const snap = await indexSnapshot(conf)
    const freshness = snap.state === 'ok' ? snap.freshness : { fresh: false, reason: snap.freshness.reason, detail: snap.freshness.detail ?? '' }
    const oldEntries = snap.entries
    const fresh = await scanDisk(conf, root)
    const freshByPath = new Map(fresh.entries.map((e) => [e.path, e]))
    const oldByPath = new Map(oldEntries.map((e) => [e.path, e]))

    const added = fresh.entries.filter((e) => !oldByPath.has(e.path)).map((e) => e.path)
    const removed = oldEntries.filter((e) => !freshByPath.has(e.path)).map((e) => e.path)
    const changed = fresh.entries.filter((e) => oldByPath.has(e.path) && oldByPath.get(e.path).revision !== e.revision).map((e) => e.path)

    const defects = []
    for (const entry of fresh.entries) {
      const file = path.join(root, entry.path)
      let text = ''
      try {
        text = await readFile(file, 'utf8')
      } catch (error) {
        defects.push({ kind: 'missingFile', path: entry.path, detail: `扫描时列出、读取失败：${(error && (error.code || error.message)) ?? error}` })
        continue
      }
      const parsed = parseFrontmatter(text)
      for (const field of REQUIRED_FIELDS) {
        if (parsed.data[field] === undefined || parsed.data[field] === '') defects.push({ kind: 'frontmatter', path: entry.path, detail: `缺字段 ${field}` })
      }
      // 2026-10-17：不再要求 frontmatter 带 id —— entryId 由 derivedEntryId(path) 兜底，
      // 故这里不再产生 noId 缺陷（见 PATCH-NOTES-派生id.md）。
      if (parsed.valid === false) defects.push({ kind: 'frontmatter', path: entry.path, detail: parsed.reason ?? 'frontmatter 非法' })
    }
    for (const p0 of removed) defects.push({ kind: 'missingFile', path: p0, detail: '上一次索引里有、现在磁盘上没有（意外缺失或用户删除，需人工确认）' })
    for (const err of fresh.scanErrors) defects.push({ kind: 'scanError', path: '-', detail: err })
    // P1-D：索引过期单独记为缺陷（kbId/排除规则/格式/内容指纹任一不符）
    if (!freshness.fresh && snap.state === 'ok') {
      defects.push({ kind: 'index-stale', path: '-.kbmeta/index', detail: `索引已过期：${freshness.reason}${freshness.detail ? ' — ' + freshness.detail : ''}` })
    }

    // R4：扫描不完整（scanErrors>0）时**不得**用不完整结果覆盖索引 —— 保留旧索引并标 partial
    const indexWritten = fresh.scanErrors.length === 0
    if (indexWritten) await writeIndex(conf, fresh.entries)
    else defects.push({ kind: 'index-not-written', path: '-.kbmeta/index', detail: `扫描不完整（${fresh.scanErrors.length} 处错误），已保留旧索引、未覆盖；恢复记录不删除` })
    if (!indexWritten && existsSync(path.join(root, '.kbmeta', 'recover-todo.log'))) {
      await writeLog('warn', '扫描不完整：recover-todo 保留待下次消费')
    }

    const result = {
      ok: true,
      execution: fresh.scanErrors.length === 0 ? 'ok' : 'partial',
      quality: defects.length === 0 ? 'pass' : 'fail',
      healthy: health.healthy,
      healthReason: health.reason,
      counts: { entries: fresh.entries.length, defects: defects.length, scannedFiles: fresh.scannedFiles, scanErrors: fresh.scanErrors.length, skippedLinks: (fresh.skippedLinks ?? []).length },
      links: { skipped: fresh.skippedLinks ?? [], policy: conf.followLinks ? 'follow-inside' : 'deny' },
      diff: { added, removed, changed },
      defects,
      rebuiltAt: nowIso(),
      indexWritten,
      // 语义保持 P1 原样：index.fresh 反映**本次检查开始时**的新鲜度；
      // 本次是否已重建看 indexWritten / rebuiltAt（不要用"重建后状态"掩盖过期事实）
      index: { fresh: freshness.fresh, reason: freshness.reason, detail: freshness.detail ?? '' },
    }
    await writeLog(result.quality === 'pass' ? 'info' : 'warn', `check 条目=${result.counts.entries} 缺陷=${defects.length} 增${added.length}/删${removed.length}/改${changed.length}`)
    return result
  }

  async function check(args) {
    const gate = await configGate()
    if (!gate.ok) {
      return { ok: false, execution: 'error', quality: 'unknown', defects: [], reason: gate.refusal.reason, detail: gate.refusal.detail }
    }
    const conf = gate.conf
    const root = kbRootOf(conf)
    // R2：维护性写入（rebuild）必须与 create/update 共用同一把锁，否则会覆盖对方刚写的索引
    return withLock(root, () => withKbLock(root, 'check', () => checkLocked(conf)))
  }

  /** 公开检查入口（含 recover）：工具与自检共用同一条路径，避免"测的不是跑的" */
  async function checkEntry(args = {}) {
    if (args && args.recover) {
      const drained = await drainRecoverTodo()
      const result = await check({ ...args, rebuild: true })
      return { ...result, recover: drained }
    }
    return check(args ?? {})
  }

  /** 已持锁版本的恢复消费（公开入口与自动消费者共用，避免两处逻辑漂移） */
  async function drainRecoverTodoLocked(conf) {
    const root = kbRootOf(conf)
    const file = path.join(root, '.kbmeta', 'recover-todo.log')
    if (!existsSync(file)) return { ok: true, consumed: 0 }
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
    const rebuilt = await reindexLocked(conf)
    if (rebuilt.ok === false) {
      // 扫描不完整：保留旧索引与恢复记录，等下次再消费（不假装恢复成功）
      await writeLog('warn', `恢复未完成：扫描不完整（${(rebuilt.scanErrors ?? []).length} 处错误），索引与恢复记录均保留`)
      return { ok: false, consumed: 0, kept: true, reason: rebuilt.reason, scanErrors: rebuilt.scanErrors ?? [] }
    }
    await rm(file, { force: true })
    await writeLog('info', `recover-todo 已消费 ${lines.length} 条并重建索引`)
    return { ok: true, consumed: lines.length }
  }

  async function drainRecoverTodo() {
    // 结案核验的唯一遗漏：这里原来直接用 getConfig() 缓存，会先重建索引、删掉恢复记录，
    // 之后 check() 才报 config-degraded —— 属于"先动手后报错"。闸门必须在本函数入口。
    const gate = await configGate()
    if (!gate.ok) return { ...gate.refusal, consumed: 0 }
    const conf = gate.conf
    const root = kbRootOf(conf)
    return withLock(root, () => withKbLock(root, 'recover', async () => drainRecoverTodoLocked(conf)))
  }

  /**
   * R4 自动恢复消费者。触发点（写死在实现里，注释与代码一致）：
   *   ① 插件启动后一次（index.js 调）
   *   ② **每次写成功后一次**（index.js 在 create/update 成功后调）
   * 忙时（拿不到锁）返回 skipped=lock-*，由下一次触发补；停止时不删 todo（它是恢复证据）。
   */
  async function maybeRecover() {
    const gate = await configGate()
    if (!gate.ok) return { ok: false, consumed: 0, skipped: gate.refusal.reason }
    const conf = gate.conf
    const root = kbRootOf(conf)
    const todo = path.join(root, '.kbmeta', 'recover-todo.log')
    if (!existsSync(todo)) return { ok: true, consumed: 0, skipped: 'no-todo' }
    return withKbLock(root, 'auto-recover', async () => {
      try {
        return await drainRecoverTodoLocked(conf)
      } catch (error) {
        await writeLog('warn', `自动恢复失败（不影响使用）：${String((error && error.message) ?? error)}`)
        return { ok: false, consumed: 0, skipped: 'error', detail: String((error && error.message) ?? error) }
      }
    })
  }

  async function status() {
    const conf = await getConfigFresh()
    const cfgHealth = await getConfigHealth()
    const root = kbRootOf(conf)
    // R6：未绑定 → bound=false / kbPath=null，绝不扫描 cwd、绝不报成"某个真实目录"
    if (root === null) {
      return {
        kbName: null,
        kbPath: null,
        bound: false,
        initialized: false,
        installState: 'unbound',
        kbId: null,
        healthy: false,
        healthReason: 'unbound',
        healthDetail: '未绑定知识库（kbPath 为空）：不会扫描当前工作目录，写入会被拒绝',
        config: {
          file: toPosix(configFile),
          state: cfgHealth.state,
          ok: cfgHealth.ok,
          detail: cfgHealth.detail,
          recovery: cfgHealth.recovery ?? null,
          revision: conf.revision ?? null,
          seededFrom: conf.seededFrom ?? 'config.json',
          kbPath: '',
        },
        stateDir: toPosix(stateDir),
        realPath: null,
        index: { fresh: false, reason: 'unbound', detail: '' },
        lock: { file: null, held: false },
        followLinks: conf.followLinks === true,
        linkPolicy: conf.followLinks === true ? 'follow-inside（允许指向库内的链接，仍拒绝逃出库外）' : 'deny（库内链接一律拒绝）',
        privateDirs: Array.isArray(conf.privateDirs) ? conf.privateDirs : null,
        effectivePrivateDirs: null,
        bindingFile: toPosix(bindingFile),
        binding: null,
        counts: { entries: 0, indexState: 'unbound', indexedAt: null },
        logFile: toPosix(logFile),
      }
    }
    const meta = await readMeta(root)
    const index = await readIndex(conf)
    const binding = await readJsonState(bindingFile)
    const health = conf.degraded ? { healthy: false, reason: 'config-degraded', detail: cfgHealth.detail } : await healthOf(conf)
    // 只算一次新鲜度（旧实现调了两遍，等于走两遍指纹）
    const freshnessOnce = await indexFreshness(conf)
    return {
      kbName: meta.state === 'ok' ? meta.value.name : path.basename(root),
      kbPath: toPosix(root),
      bound: true,
      initialized: meta.state === 'ok' && meta.value.installState === 'complete',
      installState: meta.state === 'ok' ? (meta.value.installState ?? 'unknown') : meta.state,
      kbId: meta.state === 'ok' ? (meta.value.kbId ?? null) : null,
      healthy: health.healthy,
      healthReason: health.reason,
      healthDetail: health.detail,
      config: {
        file: toPosix(configFile),
        state: cfgHealth.state,
        ok: cfgHealth.ok,
        detail: cfgHealth.detail,
        recovery: cfgHealth.recovery ?? null,
        revision: conf.revision,
        seededFrom: conf.seededFrom ?? 'config.json',
        kbPath: conf.kbPath,
      },
      stateDir: toPosix(stateDir),
      realPath: await realOf(root),
      index: (() => {
        const f = freshnessOnce
        return { fresh: f.fresh, reason: f.reason, detail: f.detail ?? '' }
      })(),
      lock: { file: toPosix(lockFileOf(root)), held: existsSync(lockFileOf(root)) },
      followLinks: conf.followLinks === true,
      linkPolicy: conf.followLinks === true ? 'follow-inside（允许指向库内的链接，仍拒绝逃出库外）' : 'deny（库内链接一律拒绝）',
      // R5：隐私目录可配置（地图据此只给计数）；未配置时返回 null，由地图用默认值
      privateDirs: Array.isArray(conf.privateDirs) ? conf.privateDirs : null,
      // F2：有效私密策略 = 配置私密根 ∪ 承载私密派生条目的分区（清单/地图/recent/错误详情都用它）
      effectivePrivateDirs: effectivePrivateDirs(conf.privateDirs, derivedPrivatePartitions(await readImportSources(root))),
      bindingFile: toPosix(bindingFile),
      binding: binding.state === 'ok' ? { kbId: binding.value.kbId, kbPath: binding.value.kbPath, boundAt: binding.value.boundAt } : null,
      counts: { entries: index.state === 'ok' ? index.entries.length : 0, indexState: index.state, indexedAt: index.state === 'ok' ? index.generatedAt : null },
      logFile: toPosix(logFile),
    }
  }

  return {
    loadConfig,
    getConfig,
    getConfigHealth,
    setConfig,
    bind,
    init,
    initializeLibrary,
    createEntry,
    updateEntry,
    search,
    check,
    checkEntry,
    maybeRecover,
    indexFreshness,
    status,
    reindex,
    drainRecoverTodo,
    configGate,
    _internal: {
      parseFrontmatter, buildFile, isInside, sha12, sha256, composeWithHeader, splitFrontmatter, contentHashOf,
      // 供定向测试用（不属于公开契约）：锁的获取/释放是 R2 的核心不变量
      acquireKbLock, releaseKbLock, indexSnapshot, fingerprintOf,
    },
    paths: { stateDir, configFile, bindingFile, logFile },
  }
}
