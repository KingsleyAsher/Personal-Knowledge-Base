/**
 * 解析服务（OCR / ASR）——第二轮新增的受控解析能力。
 *
 * 设计边界（与 AGENTS/第一轮交付一致）：
 *  · 原件只读：解析只读源文件，从不改写、移动、删除原件。
 *  · 结果隔离：全文/分段/页图只落 `<stateDir>/parse/<kbId>/`，不进知识库、不进任何普通 Agent 可读目录。
 *  · 凭据不入档：provider 只保存 credentialRef；值只在请求时从环境或 Windows DPAPI 存储读取，
 *    绝不写进任务记录、日志、HTTP 返回或 UI。
 *  · 协议与地址分离：protocol 决定"怎么发请求"，baseUrl/command 决定"发给谁"；
 *    支持某协议不代表兼容任何 HTTP API。
 *  · local-only：策略为 local-only 时拒绝一切"真实目标在公网"的提供方 ——
 *    **不相信调用方自填的 locality 标签**（2026-10-18 定向审查缺口 1）：
 *    locality=local/lan 要求目标可静态判为本机/内网；发请求前再按 DNS 实际解析地址复核，
 *    全公网解析一律拒绝，且拒绝发生在**发送正文之前**；跨源重定向逐跳复核。
 *  · 管理面与使用面分离（2026-10-18 定向审查缺口 2）：提供方增删改、可执行程序/参数、
 *    credentialRef、renderCommand、externalPolicy **只允许宿主认可的用户管理入口**改
 *    （saveProvider 等要求 viaAdmin），knowledge 模型只能在**预先固定**的提供方里挑一个。
 *  · 不伪造：引擎没给的字段（词级时间戳、置信度、说话人）一律标 unavailable，不生成。
 *
 * 任务状态机：queued → running → succeeded | partial | failed | canceled
 *  重启后 running 的记录一律判为 interrupted：attempts 未用尽则重新排队，否则 failed。
 *  解析成功与落库成功分开记录（job.status 与 job.land.status 相互独立）。
 */
import { spawn } from 'node:child_process'
import { atomicJson as atomicWriteJson, safePath } from './workbench-state.js'
import { createHash, randomUUID } from 'node:crypto'
import { promises as dnsPromises } from 'node:dns'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { presetProvider, NATIVE_PROTOCOLS } from './parse-presets.js'
import { createParseCredentials } from './parse-credentials.js'
import { createNativeAdapter } from './parse-native.js'
import { createParseDiscovery } from './parse-discovery.js'
import { checkRealPath } from './kbcore.js'
import { fileURLToPath } from 'node:url'

export const PARSING_SCHEMA_VERSION = 1

export const PARSE_PROTOCOLS = {
  ocr: ['openai-vision', 'dashscope-ocr', 'baidu-ocr', 'paddle-local', 'paddle-service', 'ppocr-local'],
  asr: ['openai-audio-transcriptions', 'cli-transcribe', 'dashscope-asr', 'baidu-asr', 'qwen3-local'],
}

export const PARSE_KINDS = ['ocr', 'asr']

export const LOCALITY = ['local', 'lan', 'cloud']

export const EXTERNAL_POLICIES = ['local-only', 'allow-configured']

export const DEFAULT_FORMATS = {
  ocr: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'pdf'],
  asr: ['wav', 'mp3', 'm4a', 'mp4', 'flac', 'ogg', 'aac'],
}

const HOST_PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PDF_HELPER = path.join(HOST_PKG_ROOT, 'tools', 'kb-pdf-pages.py')

const MAX_ATTEMPTS = 2
const DEFAULT_TIMEOUT_MS = 180_000
const MAX_TIMEOUT_MS = 30 * 60_000
const MAX_BYTES_LIMIT = 512 * 1024 * 1024
const JOBS_KEPT = 200

const nowIso = () => new Date().toISOString()
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sha12 = (buf) => sha256(buf).slice(0, 12)
const toPosix = (p) => String(p).split(path.sep).join('/')

// ── 目标地址分级（local-only 的真实判据）────────────────────────────────────
// 只认"可证明是本机/内网"的目标。域名一律按**实际解析出来的地址**判，
// 不按调用方填的 locality 判 —— 这是 2026-10-18 审查缺口 1 的直接对策。
// 注意：198.18.0.0/15 属保留段但本机代理常拿它做 fake-IP（等于把公网域名伪装成内网地址），
// 因此**一律按公网处理**，不给它留后门。
const PRIVATE_V4 = [
  [/^10\./, 'private'],
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'link-local'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  [/^192\.168\./, 'private'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'private'],
  [/^0\./, 'unspecified'],
]

function classifyV4(ip) {
  for (const [re, kind] of PRIVATE_V4) if (re.test(ip)) return kind
  return 'public'
}

/** 把单个 IP 分级：loopback / private / link-local / unspecified / public / unknown。 */
export function classifyAddress(ip) {
  const s = String(ip ?? '').trim().replace(/^\[|\]$/g, '')
  if (net.isIPv4(s)) return classifyV4(s)
  if (!net.isIPv6(s)) return 'unknown'
  const lower = s.toLowerCase()
  if (lower === '::1' || lower === '::') return lower === '::1' ? 'loopback' : 'unspecified'
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7)
    return net.isIPv4(mapped) ? classifyV4(mapped) : 'unknown'
  }
  if (/^f[cd]/.test(lower)) return 'private' // fc00::/7 ULA
  if (/^fe[89ab]/.test(lower)) return 'link-local'
  return 'public'
}

/** 这个名字本身是否"可静态判为本机/内网"（不查 DNS）。 */
export function isLocalHostName(host) {
  const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === '') return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (net.isIP(h)) return classifyAddress(h) !== 'public'
  return ['.local', '.lan', '.internal', '.home.arpa', '.localdomain', '.intranet'].some((s) => h.endsWith(s))
}

/**
 * 静态复核"标签与真实目标是否一致"：locality=local/lan 必须能静态判为本机/内网。
 * 域名（example.com 之类）不能靠名字自称 local —— 那正是审查复现的那条绕过路径。
 */
export function staticDestinationRefusal(provider) {
  if (provider === null || typeof provider !== 'object') return null
  if (['cli-transcribe', 'qwen3-local', 'paddle-local', 'ppocr-local'].includes(provider.protocol)) return null
  const baseUrl = String(provider.baseUrl ?? '')
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return { code: 'BAD_URL', message: `提供方 ${provider.id} 的 baseUrl 不是合法地址` }
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (provider.locality === 'cloud') return null
  if (isLocalHostName(host)) return null
  return {
    code: 'LOCALITY_MISMATCH',
    message: `提供方 ${provider.id} 声明 locality=${provider.locality}，但目标 ${host} 无法判为本机/内网地址。`
      + '如果它确实是公网服务，请把 locality 改成 cloud（并确认 externalPolicy 允许）；local-only 从不相信自填标签。',
  }
}

/** 解析域名到全部地址（可注入 lookup，供受控桩测试；默认走系统 DNS）。 */
async function resolveHost(host, lookup) {
  const h = String(host ?? '').replace(/^\[|\]$/g, '')
  if (net.isIP(h)) return [{ address: h, family: net.isIP(h) }]
  const fn = typeof lookup === 'function' ? lookup : dnsPromises.lookup
  const rows = await fn(h, { all: true, verbatim: true })
  return Array.isArray(rows) ? rows : []
}

// ── 固定 CLI 的程序/参数策略（审查缺口 2 的第二层）──────────────────────────
// 管理面已经不给模型改程序了；这里再挡一类"配置写对了但语义等于任意代码"的形态：
// 解释器的行内求值开关。参数由程序构造，模型永远不进命令行，但配置本身要被拒。
const INLINE_EXEC_FLAGS = new Set([
  '-e', '--eval', '-p', '--print', '--input-type', '-c', '/c', '/k',
  '-command', '--command', '-encodedcommand', '-enc', '-e:', '-commandwithargs',
])

/** 返回 {code,message} 表示拒绝；null 表示通过。纯函数，管理面与应用面都调它。 */
export function cliProgramRefusal(provider) {
  if (provider === null || typeof provider !== 'object') return null
  if (provider.protocol !== 'cli-transcribe') return null
  const command = String(provider.command ?? '')
  if (command === '') return { code: 'BAD_COMMAND', message: 'CLI 协议需要固定的可执行程序路径' }
  if (!path.isAbsolute(command)) {
    return { code: 'BAD_COMMAND', message: `CLI 程序必须是绝对路径（收到 ${command}）：不按 PATH 解析，避免同名程序劫持` }
  }
  if (!/\.(exe|cmd|bat)$/i.test(command)) {
    return { code: 'BAD_COMMAND', message: `CLI 程序必须是 .exe/.cmd/.bat（收到 ${command}）` }
  }
  const args = Array.isArray(provider.args) ? provider.args : []
  for (const a of args) {
    const token = String(a).trim().toLowerCase().split('=')[0]
    if (INLINE_EXEC_FLAGS.has(token)) {
      return {
        code: 'BAD_ARGS',
        message: `参数里出现行内求值开关 ${a}：那等于让配置直接执行任意代码。请改成"固定脚本文件 + 普通参数"的形态。`,
      }
    }
    if (/^-[ep]/.test(token) && /^-[ep][\s:]/.test(String(a).trim().toLowerCase())) {
      return { code: 'BAD_ARGS', message: `参数里出现行内求值开关 ${a}` }
    }
  }
  return null
}

// ── 子进程环境最小化 ────────────────────────────────────────────────────────
// 解析程序只需要 PATH/临时目录/用户目录这类生存必需项；不把整份宿主环境（含一切
// 凭据类变量）交给它。HTTP 提供方的凭据走 authHeaders，与子进程环境无关。
const CHILD_ENV_ALLOW = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'SystemDrive',
  'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA',
  'COMSPEC', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PYTHONIOENCODING',
  'CUDA_VISIBLE_DEVICES', 'HF_HOME', 'TRANSFORMERS_CACHE',
]

function minimalChildEnv() {
  const env = {}
  for (const key of CHILD_ENV_ALLOW) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

function errText(error) {
  return String((error && error.message) || error || 'unknown error')
}


function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 提供方 ID：小写字母数字与 - _ ，3..40 位。 */
export function validProviderId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{2,39}$/.test(id)
}

/** credentialRef 只接受"环境变量名"形态，绝不接受 secret 字面量。 */
export function validCredentialRef(ref) {
  if (ref === '' || ref == null) return true
  if (typeof ref !== 'string') return false
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(ref)) return false
  // 看起来像密钥的值直接拒绝（宁可让人改成 env 名）
  if (/^(SK|AK|PK)[-_]/i.test(ref)) return false
  return true
}

/**
 * 校验并归一化一个提供方定义。
 * 返回 {ok, value} 或 {ok:false, errors:[{field,code,message}]}
 */
export function normalizeProvider(input, extra = {}) {
  const errors = []
  let src = input && typeof input === 'object' ? input : {}
  try { src = presetProvider(src) } catch (e) { errors.push({ field: 'vendor', message: e.message }) }
  const id = typeof src.id === 'string' ? src.id.trim() : ''
  if (!validProviderId(id)) errors.push({ field: 'id', code: 'BAD_ID', message: 'id 需为 3..40 位小写字母/数字/-/_' })
  const kind = PARSE_KINDS.includes(src.kind) ? src.kind : ''
  if (kind === '') errors.push({ field: 'kind', code: 'BAD_KIND', message: 'kind 只能是 ocr 或 asr' })
  const protocol = String(src.protocol ?? '').trim()
  if (kind !== '' && !PARSE_PROTOCOLS[kind].includes(protocol)) {
    errors.push({ field: 'protocol', code: 'BAD_PROTOCOL', message: `${kind} 支持的协议：${PARSE_PROTOCOLS[kind].join(' / ')}` })
  }
  const locality = LOCALITY.includes(src.locality) ? src.locality : 'local'
  const isHttp = protocol === 'openai-vision' || protocol === 'openai-audio-transcriptions' || protocol === 'paddle-service' || NATIVE_PROTOCOLS.includes(protocol)
  let baseUrl = ''
  let command = ''
  let args = []
  if (isHttp) {
    baseUrl = typeof src.baseUrl === 'string' ? src.baseUrl.trim().replace(/\/+$/, '') : ''
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) errors.push({ field: 'baseUrl', code: 'BAD_URL', message: 'HTTP 协议需要 http(s) 地址' })
    if (/^http:\/\//i.test(baseUrl) && (locality === 'cloud' || locality === 'lan')) {
      // 记录但不阻断：内网 http 是常见部署；策略层再判
    }
  }
  if (['cli-transcribe', 'qwen3-local', 'paddle-local', 'paddle-service', 'ppocr-local'].includes(protocol)) {
    command = typeof src.command === 'string' ? src.command.trim() : ''
    if (protocol !== 'cli-transcribe' && command && !/python(?:3)?(?:\.exe)?$/i.test(path.basename(command))) command = path.join(command, 'Scripts', 'python.exe')
    if (command === '') errors.push({ field: 'command', code: 'BAD_COMMAND', message: 'CLI 协议需要固定的可执行程序路径' })
    if (Array.isArray(src.args)) args = src.args.map((a) => String(a))
    else if (typeof src.args === 'string' && src.args.trim() !== '') errors.push({ field: 'args', code: 'BAD_ARGS', message: 'args 必须是数组（程序参数由程序构造，不接受命令串）' })
  }
  const formats = Array.isArray(src.formats) && src.formats.length > 0
    ? [...new Set(src.formats.map((f) => String(f).toLowerCase().replace(/^\./, '')).filter(Boolean))]
    : [...(DEFAULT_FORMATS[kind] || [])]
  if (Array.isArray(src.formats) && src.formats.length === 0) {
    errors.push({ field: 'formats', code: 'BAD_FORMATS', message: 'formats 不能为空数组；不填则用默认值' })
  }
  const credentialRef = typeof src.credentialRef === 'string' ? src.credentialRef.trim() : ''
  if (!validCredentialRef(credentialRef)) errors.push({ field: 'credentialRef', code: 'BAD_CREDENTIAL_REF', message: 'credentialRef 只能填环境变量名（如 KB_OCR_TOKEN），不要粘贴密钥' })
  const value = {
    vendor: ['openai', 'custom', 'qwen', 'baidu', 'local'].includes(src.vendor) ? src.vendor : 'custom',
    region: src.region || '',
    workspaceId: src.workspaceId || '',
    modelPath: String(src.modelPath || ''),
    ffmpegCommand: String(src.ffmpegCommand || ''),
    layoutModelPath: String(src.layoutModelPath || ''),
    detModelPath: String(src.detModelPath || ''), recModelPath: String(src.recModelPath || ''), dictionaryPath: String(src.dictionaryPath || ''),
    id,
    kind,
    protocol,
    label: typeof src.label === 'string' && src.label.trim() !== '' ? src.label.trim().slice(0, 60) : id,
    locality,
    model: typeof src.model === 'string' ? src.model.trim() : '',
    baseUrl,
    command,
    args,
    // PDF 拆页需要固定 Python（随包脚本）；只有管理员能配，模型不能给。
    renderCommand: typeof src.renderCommand === 'string' ? src.renderCommand.trim() : '',
    credentialRef,
    authScheme: src.authScheme === 'bearer' ? 'bearer' : 'none',
    timeoutMs: clampInt(src.timeoutMs, 5_000, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    formats,
    maxBytes: clampInt(src.maxBytes, 1_024, MAX_BYTES_LIMIT, 50 * 1024 * 1024),
    maxPages: clampInt(src.maxPages, 1, 300, 40),
    enabled: src.enabled !== false,
    notes: typeof src.notes === 'string' ? src.notes.slice(0, 300) : '',
    updatedAt: extra.now ?? nowIso(),
  }
  if (value.renderCommand && !/python(?:3)?(?:\.exe)?$/i.test(path.basename(value.renderCommand))) value.renderCommand = path.join(value.renderCommand, 'Scripts', 'python.exe')
  if (value.ffmpegCommand && !/^ffmpeg(?:\.exe)?$/i.test(path.basename(value.ffmpegCommand))) value.ffmpegCommand = path.join(value.ffmpegCommand, 'ffmpeg.exe')
  if (['qwen3-local', 'paddle-local', 'paddle-service', 'ppocr-local'].includes(protocol)) {
    if (!path.isAbsolute(command) || !/python(?:3)?(?:\.exe)?$/i.test(path.basename(command))) errors.push({ field: 'command', message: '本地适配器需要 Python 可执行文件绝对路径' })
    if (['qwen3-local', 'paddle-local'].includes(protocol) && !path.isAbsolute(value.modelPath)) errors.push({ field: 'modelPath', message: '请选择模型绝对路径' })
    if (['paddle-local', 'paddle-service'].includes(protocol) && !path.isAbsolute(value.layoutModelPath || '')) {
      value.layoutModelPath = 'D:\\DSH WorkPlace\\ocr-models\\PP-DocLayoutV3'
    }
    if (protocol === 'ppocr-local' && (!path.isAbsolute(value.detModelPath) || !path.isAbsolute(value.recModelPath))) errors.push({ field: 'modelPath', message: '请选择配套的检测模型、识别模型目录' })
    if (protocol === 'paddle-service') {
      let hostname = ''
      try { hostname = new URL(baseUrl).hostname } catch { /* normal validation below */ }
      if (!['127.0.0.1', '[::1]'].includes(hostname)) errors.push({ field: 'baseUrl', message: '本地版面管线仅支持回环 IP 服务地址' })
    }
    if (locality !== 'local') errors.push({ field: 'locality', message: '本地适配器必须使用本机位置' })
  }
  // 标签必须与真实目标一致：locality=local/lan 而目标是公网域名 → 直接拒（不信自填标签）。
  // 放在最后统一判，是为了让 id/kind/protocol 的错误先报出来（诊断顺序更直观）。
  if (isHttp || protocol === 'cli-transcribe') {
    const refusal = staticDestinationRefusal(value) ?? cliProgramRefusal(value)
    if (refusal) errors.push({ field: protocol === 'cli-transcribe' ? 'command' : 'baseUrl', code: refusal.code, message: refusal.message })
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

/** 解析配置块（stateDir/config.json 的 parsing 字段）的总校验。 */
export function normalizeParsingConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const providers = []
  const seen = new Set()
  const errors = []
  for (const item of Array.isArray(src.providers) ? src.providers : []) {
    const n = normalizeProvider(item)
    if (!n.ok) {
      errors.push({ field: 'providers', code: 'BAD_PROVIDER', message: (item && item.id) || '(no id)', detail: n.errors })
      continue
    }
    if (seen.has(n.value.id)) {
      errors.push({ field: 'providers', code: 'DUPLICATE_ID', message: n.value.id })
      continue
    }
    seen.add(n.value.id)
    providers.push(n.value)
  }
  const pick = (kind, id) => {
    if (typeof id !== 'string' || id.trim() === '') return null
    const hit = providers.find((p) => p.id === id && p.kind === kind)
    return hit ? hit.id : null
  }
  return {
    ok: errors.length === 0,
    errors,
    value: {
      schemaVersion: PARSING_SCHEMA_VERSION,
      externalPolicy: EXTERNAL_POLICIES.includes(src.externalPolicy) ? src.externalPolicy : 'local-only',
      providers,
      defaultOcr: pick('ocr', src.defaultOcr),
      defaultAsr: pick('asr', src.defaultAsr),
    },
  }
}

/** 对外展示用：绝不带凭据值，只带"有没有配"。 */
export function publicProvider(p) {
  return {
    vendor: p.vendor, region: p.region, workspaceId: p.workspaceId,
    modelPath: p.modelPath, ffmpegCommand: p.ffmpegCommand,
    layoutModelPath: p.layoutModelPath, detModelPath: p.detModelPath, recModelPath: p.recModelPath, dictionaryPath: p.dictionaryPath,
    id: p.id,
    kind: p.kind,
    protocol: p.protocol,
    label: p.label,
    locality: p.locality,
    model: p.model,
    baseUrl: p.baseUrl,
    command: p.command,
    renderCommand: p.renderCommand || '',
    args: Array.isArray(p.args) ? p.args : [],
    credentialRef: p.credentialRef,
    credentialConfigured: p.credentialRef === '' ? false : Boolean(process.env[p.credentialRef]),
    authScheme: p.authScheme,
    timeoutMs: p.timeoutMs,
    formats: p.formats,
    maxBytes: p.maxBytes,
    maxPages: p.maxPages,
    enabled: p.enabled,
    notes: p.notes,
    locale: p.locality === 'local' ? '本机' : p.locality === 'lan' ? '内网' : '云端',
  }
}

function providerConfigVersion(p) {
  return sha12(Buffer.from(JSON.stringify({ ...p, updatedAt: undefined }), 'utf8'))
}

function mimeOf(ext) {
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    bmp: 'image/bmp',
    pdf: 'application/pdf',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
  }
  return map[ext] ?? 'application/octet-stream'
}

async function listJobFiles(dir) {
  try {
    const names = await readdir(dir)
    return names.filter((n) => n.endsWith('.json'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * @param {object} deps
 * @param {string} deps.stateDir      profile 级状态目录（解析工作区与任务记录都在其下）
 * @param {function} deps.log
 * @param {function} deps.getCore     返回当前 core 实例
 * @param {function} deps.getBinding  返回 {kbPath, kbId}（未绑定则 null）
 * @param {function} [deps.lookup]    DNS 解析器（默认 dns.promises.lookup）。**只给受控桩测试用**：
 *                                    作用是让"域名解析到公网地址 → 发正文前拦下"可以被离线证明。
 */
export function createParsingService({ stateDir, log = () => {}, getCore, getBinding, lookup = null, credentialStore = null, nativeRequest = null, onEvent = () => {} }) {
  const root = path.join(stateDir, 'parse')
  const credentials = credentialStore || createParseCredentials(stateDir)
  // nativeRequest is a transport fixture for offline tests; never exposed in settings.
  const native = createNativeAdapter({ request: async (p, url, init, context) => {
    const gate = await executionGate(p, context.conf)
    if (!gate.ok) return gate
    return (nativeRequest || requestJson)(p, url, init, { ...context, conf: gate.conf })
  }, credentials })
  const discovery = createParseDiscovery({
    savedPaths: async () => (await readParsingConfig()).providers.flatMap(p => [p.modelPath, p.layoutModelPath, p.detModelPath, p.recModelPath, p.command && path.dirname(path.dirname(p.command)), p.ffmpegCommand && path.dirname(p.ffmpegCommand)]).filter(Boolean),
    savedDeployments: async () => (await readParsingConfig()).providers.filter(p => p.locality === 'local'),
    savedServices: async () => (await readParsingConfig()).providers.filter(p => p.locality === 'local' && p.baseUrl).map(p => p.baseUrl),
    probe: async baseUrl => {
      const p = { id: 'local-probe', protocol: 'openai-vision', locality: 'local', enabled: true, baseUrl }
      const r = await requestJson(p, baseUrl + '/models', { method: 'GET' }, { conf: { externalPolicy: 'local-only' }, timeoutMs: 1500 })
      return r.ok ? r.json.data?.find(m => /paddleocr.?vl/i.test(m.id))?.id : null
    },
  })
  const environmentFile = p => path.join(root, 'validation', sha12(Buffer.from(p.id)) + '.json')
  async function managedPublic(p) {
    let environment = null
    try { const saved = JSON.parse(await readFile(environmentFile(p), 'utf8')); if (saved.configVersion === providerConfigVersion(p)) environment = saved } catch { /* not checked */ }
    return { ...publicProvider(p), configVersion: providerConfigVersion(p), credentialConfigured: await credentials.configured(p.credentialRef), environmentCheckedAt: environment?.ok ? environment.checkedAt : null }
  }
  const running = new Map() // jobId → {controller, child}
  const providerLocks = new Map() // providerId → promise chain（本机提供方串行）
  let recovered = false
  const snapshotBinding = b => b?.kbId && b?.kbPath ? { kbId: b.kbId, kbPath: path.resolve(b.kbPath) } : null
  const sameBinding = (a, b) => Boolean(a?.kbId && a?.kbPath && b?.kbPath && a.kbId === b.kbId && path.resolve(a.kbPath) === path.resolve(b.kbPath))
  const bindingFailure = () => ({ ok: false, code: 'BINDING_CHANGED', detail: '知识库绑定已改变，旧任务已停止；请切回原库后重试，已有记录仍保存在原库任务目录' })

  async function executionGate(provider, conf = {}) {
    if (conf.executionBinding && !sameBinding(conf.executionBinding, await getBinding())) return bindingFailure()
    const current = await readParsingConfig()
    const effective = { ...conf, externalPolicy: conf.externalPolicy === 'local-only' || current.externalPolicy === 'local-only' ? 'local-only' : 'allow-configured' }
    const refusal = policyRefusal(provider, effective)
    return refusal ? { ok: false, code: refusal.code, detail: refusal.message } : { ok: true, conf: effective }
  }

  /**
   * 本机 GPU 提供方串行：两套模型不假设能同时常驻。
   * 排队中的任务仍是 queued（stage=waiting-provider），可被取消；不静默终止别人的任务。
   */
  async function withProviderLock(providerId, fn) {
    const prev = providerLocks.get(providerId) ?? Promise.resolve()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const chained = prev.then(() => gate)
    providerLocks.set(providerId, chained)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (providerLocks.get(providerId) === chained) providerLocks.delete(providerId)
    }
  }

  const kbKeyOf = (binding) => (binding && binding.kbId ? String(binding.kbId).replace(/[^a-zA-Z0-9_-]/g, '') : 'unbound')
  const kbDir = (binding) => path.join(root, kbKeyOf(binding))
  const jobsDir = (binding) => path.join(kbDir(binding), 'jobs')
  const resultsDir = (binding) => path.join(kbDir(binding), 'results')
  const tmpDir = (binding) => path.join(kbDir(binding), 'tmp')

  async function ensureDirs(binding) {
    for (const d of [jobsDir(binding), resultsDir(binding), tmpDir(binding)]) await mkdir(d, { recursive: true })
  }

  async function readParsingConfig() {
    const core = getCore()
    if (!core) return normalizeParsingConfig(null).value
    const conf = await core.getConfig().catch(() => null)
    return normalizeParsingConfig(conf ? conf.parsing : null).value
  }

  async function writeParsingConfig(next) {
    const core = getCore()
    if (!core) return { ok: false, reason: 'core-not-ready' }
    const normalized = normalizeParsingConfig(next)
    if (!normalized.ok) return { ok: false, reason: 'invalid-parsing-config', errors: normalized.errors }
    const r = await core.setConfig({ parsing: normalized.value })
    if (!r || r.ok !== true) return { ok: false, reason: (r && r.reason) || 'set-config-failed', detail: r && r.detail }
    return { ok: true, revision: r.revision, parsing: normalized.value }
  }

  // ── 提供方管理（**仅管理面**）────────────────────────────────────────────
  // 2026-10-18 定向审查缺口 2：提供方定义里含有"会执行什么程序""把正文发到哪个地址"
  // "读哪个环境变量当凭据"。这些**不能由模型写**。因此四个写操作都要求 viaAdmin
  // （只有宿主认可的用户管理入口 —— 设置页 HTTP 路由 —— 会传它）。模型工具即使
  // 伪造 action 走到这里也只会拿到 ADMIN_ONLY。
  const adminOnly = (op) => ({
    ok: false,
    reason: 'ADMIN_ONLY',
    detail: `${op} 属于管理面操作（会改提供方程序/地址/凭据引用/外发策略），模型不能执行。`
      + '请在「设置 → 个人知识库 → 解析」里改；模型侧只能在一个已配置好的提供方上提交解析。',
  })

  async function providersPublic() {
    const conf = await readParsingConfig()
    const history = await listJobs({ limit: JOBS_KEPT })
    const providers = await Promise.all(conf.providers.map(async p => {
      const matching = history.jobs?.filter(j => j.provider.id === p.id && j.provider.configVersion === providerConfigVersion(p)).sort((a,b) => String(b.finishedAt||b.createdAt).localeCompare(String(a.finishedAt||a.createdAt))) || []
      const verified = matching.find(j => j.status === 'succeeded')
      const latest = matching.find(j => ['succeeded','failed','partial'].includes(j.status))
      return { ...await managedPublic(p), parseVerifiedAt: verified?.finishedAt || null, label: p.label.replace(/（待补齐）|待验证/g, ''), lastError: latest && ['failed','partial'].includes(latest.status) ? (latest.diagnostics?.at(-1)?.message || latest.diagnostics?.at(-1)?.code || latest.error?.message || latest.error?.detail || latest.error?.code || '最近一次解析未完成，请查看任务详情') : null }
    }))
    return {
      ok: true,
      externalPolicy: conf.externalPolicy,
      defaultOcr: conf.defaultOcr,
      defaultAsr: conf.defaultAsr,
      providers,
      protocols: PARSE_PROTOCOLS,
      locality: LOCALITY,
      // 让调用方知道"这些动作不在模型工具里"，而不是以为工具坏了
      adminActions: ['save-provider', 'delete-provider', 'default', 'policy'],
    }
  }

  async function saveProvider(input, { viaAdmin = false, credentialInput = null, clearCredential = false } = {}) {
    if (viaAdmin !== true) return adminOnly('保存提供方')
    const conf = await readParsingConfig()
    input = { ...input }
    if (!input.id) input.id = `${input.kind || 'ocr'}-${randomUUID().slice(0, 12)}`
    const old = conf.providers.find(p => p.id === input.id)
    if (clearCredential) input.credentialRef = ''
    else if (credentialInput?.apiKey?.trim()) {
      // Validate the provider before storing any credential.
      const pre = normalizeProvider(input)
      if (!pre.ok) return { ok: false, reason: 'invalid-provider', errors: pre.errors }
      if (pre.value.vendor === 'baidu' && !credentialInput.secretKey?.trim()) return { ok: false, reason: 'SECRET_KEY_REQUIRED' }
      input.credentialRef = await credentials.save(credentialInput)
      input.authScheme = 'bearer'
    } else if (input.credentialRef === undefined && old) input.credentialRef = old.credentialRef
    const norm = normalizeProvider(input)
    if (!norm.ok) return { ok: false, reason: 'invalid-provider', errors: norm.errors }
    const next = { ...conf, providers: conf.providers.map((p) => ({ ...p })) }
    const at = next.providers.findIndex((p) => p.id === norm.value.id)
    if (at >= 0) {
      if (next.providers[at].kind !== norm.value.kind) {
        return { ok: false, reason: 'kind-immutable', detail: '同一 id 不能改 kind（ocr/asr），请新建一个提供方' }
      }
      next.providers[at] = norm.value
    } else {
      next.providers.push(norm.value)
    }
    if (norm.value.locality !== 'cloud' && norm.value.kind === 'ocr' && next.defaultOcr === null) next.defaultOcr = norm.value.id
    if (norm.value.locality !== 'cloud' && norm.value.kind === 'asr' && next.defaultAsr === null) next.defaultAsr = norm.value.id
    const written = await writeParsingConfig(next)
    if (!written.ok) return written
    log('info', `解析提供方已保存 ${norm.value.id}（${norm.value.kind}/${norm.value.protocol}/${norm.value.locality}）`)
    return { ok: true, provider: await managedPublic(norm.value), revision: written.revision, defaults: { ocr: written.parsing.defaultOcr, asr: written.parsing.defaultAsr } }
  }

  async function deleteProvider(id, { viaAdmin = false } = {}) {
    if (viaAdmin !== true) return adminOnly('删除提供方')
    const conf = await readParsingConfig()
    const hit = conf.providers.find((p) => p.id === id)
    if (!hit) return { ok: false, reason: 'not-found', detail: '没有这个提供方' }
    const next = {
      ...conf,
      providers: conf.providers.filter((p) => p.id !== id),
      defaultOcr: conf.defaultOcr === id ? null : conf.defaultOcr,
      defaultAsr: conf.defaultAsr === id ? null : conf.defaultAsr,
    }
    const written = await writeParsingConfig(next)
    if (!written.ok) return written
    return { ok: true, removed: id, defaults: { ocr: written.parsing.defaultOcr, asr: written.parsing.defaultAsr } }
  }

  async function setDefaults({ kind, id }, { viaAdmin = false } = {}) {
    if (viaAdmin !== true) return adminOnly('设置默认提供方')
    if (!PARSE_KINDS.includes(kind)) return { ok: false, reason: 'bad-kind' }
    const conf = await readParsingConfig()
    if (id !== null && id !== '') {
      const hit = conf.providers.find((p) => p.id === id && p.kind === kind)
      if (!hit) return { ok: false, reason: 'not-found', detail: `没有 ${kind} 提供方 ${id}` }
    }
    const next = { ...conf, defaultOcr: kind === 'ocr' ? (id || null) : conf.defaultOcr, defaultAsr: kind === 'asr' ? (id || null) : conf.defaultAsr }
    const written = await writeParsingConfig(next)
    if (!written.ok) return written
    return { ok: true, defaults: { ocr: written.parsing.defaultOcr, asr: written.parsing.defaultAsr } }
  }

  async function setPolicy(policy, { viaAdmin = false } = {}) {
    if (viaAdmin !== true) return adminOnly('修改外发策略')
    if (!EXTERNAL_POLICIES.includes(policy)) return { ok: false, reason: 'bad-policy', detail: `可用：${EXTERNAL_POLICIES.join(' / ')}` }
    const conf = await readParsingConfig()
    const written = await writeParsingConfig({ ...conf, externalPolicy: policy })
    if (!written.ok) return written
    return { ok: true, externalPolicy: written.parsing.externalPolicy }
  }

  /**
   * 策略闸门（**同步部分**）：只做能静态判定的拒绝。
   *  · local-only 下云提供方一律拒绝；
   *  · 停用的拒绝；
   *  · locality 标签与目标不一致（公网域名自称 local）拒绝 —— 这一条不看策略，
   *    因为"标签说谎"在任何策略下都不是可接受的配置。
   * 真正发请求前还会做 DNS/IP 复核（asyncDestinationRefusal），那一步才是"发正文之前"的最后一道。
   */
  function policyRefusal(provider, conf) {
    if (provider.locality === 'cloud' && conf.externalPolicy === 'local-only') {
      return {
        code: 'LOCAL_ONLY_BLOCKED',
        message: `当前策略是 local-only：禁止把原件送去云端提供方 ${provider.id}。改用本机/内网提供方，或由管理员显式改为 allow-configured。`,
      }
    }
    if (provider.enabled !== true) return { code: 'PROVIDER_DISABLED', message: `提供方 ${provider.id} 已停用` }
    const mismatch = staticDestinationRefusal(provider)
    if (mismatch) return mismatch
    const cli = cliProgramRefusal(provider)
    if (cli) return cli
    return null
  }

  function pickProvider(conf, kind, providerId) {
    const wanted = typeof providerId === 'string' && providerId !== '' ? providerId : kind === 'ocr' ? conf.defaultOcr : conf.defaultAsr
    if (!wanted) {
      return { error: { code: 'NO_DEFAULT_PROVIDER', message: `未配置 ${kind.toUpperCase()} 默认提供方：请先在设置页添加并设为默认` } }
    }
    const hit = conf.providers.find((p) => p.id === wanted && p.kind === kind)
    if (!hit) return { error: { code: 'PROVIDER_NOT_FOUND', message: `没有 ${kind} 提供方 ${wanted}` } }
    const refused = policyRefusal(hit, conf)
    if (refused) return { error: refused }
    return { provider: hit }
  }

  // ── HTTP / CLI 适配器 ───────────────────────────────────────────────────
  async function authHeaders(provider, diagnostics) {
    const headers = {}
    if (provider.credentialRef === '' || provider.authScheme === 'none') return headers
    const value = (await credentials.read(provider.credentialRef)).apiKey
    if (!value) {
      diagnostics.push({ code: 'MISSING_CREDENTIAL', message: `提供方 ${provider.id} 引用的凭据 ${provider.credentialRef} 在宿主环境里没有值` })
      throw Object.assign(new Error('MISSING_CREDENTIAL'), { code: 'MISSING_CREDENTIAL' })
    }
    headers.Authorization = `Bearer ${value}`
    return headers
  }

  function mergeSignals(signals) {
    const list = signals.filter(Boolean)
    if (list.length === 0) return undefined
    if (list.length === 1) return list[0]
    const controller = new AbortController()
    const onAbort = (s) => () => controller.abort(s.reason ?? new Error('aborted'))
    for (const s of list) {
      if (s.aborted) {
        controller.abort(s.reason)
        break
      }
      s.addEventListener('abort', onAbort(s), { once: true })
    }
    return controller.signal
  }

  /**
   * 真实目标复核（**发正文之前**的最后一道，2026-10-18 审查缺口 1）。
   * 把目标域名解析成全部地址，只要出现公网地址：
   *  · local-only → 直接拒绝（无论 locality 标签怎么写）；
   *  · locality 不是 cloud → 判为标签与事实不符，拒绝。
   * 通过时返回**已核对的那个地址**，连接期用它直接建连（不再二次查 DNS），
   * 于是"解析完再被换成别的地址"这条路走不通。
   */
  async function checkTarget(urlString, provider, conf) {
    if (provider.protocol === 'cli-transcribe') return { ok: true, pinned: null }
    let url
    try {
      url = new URL(String(urlString))
    } catch {
      return { ok: false, code: 'BAD_URL', detail: '目标地址不合法：' + String(urlString) }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, code: 'BAD_URL', detail: '只支持 http(s) 目标：' + String(urlString) }
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    let rows
    try {
      rows = await resolveHost(host, lookup)
    } catch (error) {
      return { ok: false, code: 'DNS_FAILED', detail: `解析 ${host} 失败：${errText(error)}` }
    }
    const usable = rows.filter((r) => r && typeof r.address === 'string' && net.isIP(r.address) !== 0)
    if (usable.length === 0) return { ok: false, code: 'DNS_NO_ADDRESS', detail: `解析 ${host} 没有得到可用地址` }
    const publicRows = usable.filter((r) => classifyAddress(r.address) === 'public')
    if (publicRows.length > 0) {
      const sample = publicRows[0].address
      if (conf.externalPolicy === 'local-only') {
        return {
          ok: false,
          code: 'LOCAL_ONLY_DESTINATION_BLOCKED',
          detail: `local-only：${host} 解析到公网地址 ${sample}，请求在发送正文之前被拦下（提供方 ${provider.id}，标签 locality=${provider.locality} 不作数）`,
        }
      }
      if (provider.locality !== 'cloud') {
        return {
          ok: false,
          code: 'LOCALITY_MISMATCH',
          detail: `提供方 ${provider.id} 声明 locality=${provider.locality}，但 ${host} 解析到公网地址 ${sample}：标签与真实目标不一致，拒绝发送。`,
        }
      }
    }
    const chosen = usable[0]
    const family = Number(chosen.family) || net.isIP(chosen.address)
    return { ok: true, pinned: { address: chosen.address, family } }
  }

  /**
   * 单跳 HTTP：**固定连到已核对的地址**（连接期不再查 DNS）。
   * 不用全局 fetch —— 它没法钉住解析结果，"先查再连"之间仍可能被换掉。
   */
  function httpOnce({ url, method, headers, body, timeoutMs, signal, pinned }) {
    return new Promise((resolve) => {
      let u
      try {
        u = new URL(String(url))
      } catch {
        resolve({ ok: false, code: 'BAD_URL', detail: '目标地址不合法' })
        return
      }
      const isHttps = u.protocol === 'https:'
      const mod = isHttps ? https : http
      const rawHost = u.hostname.replace(/^\[|\]$/g, '')
      const family = pinned !== null ? Number(pinned.family) || net.isIP(pinned.address) : 0
      const lookupFn = (hostname, options, cb) => {
        const address = pinned !== null ? pinned.address : hostname
        if (options !== null && typeof options === 'object' && options.all === true) cb(null, [{ address, family }])
        else cb(null, address, family)
      }
      const payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body))
      const outHeaders = { ...(headers ?? {}) }
      if (payload !== null) outHeaders['content-length'] = String(payload.length)
      let settled = false
      let timer = null
      const onAbort = () => {
        try {
          req.destroy(Object.assign(new Error('已取消'), { code: 'CANCELED' }))
        } catch {
          /* ignore */
        }
      }
      const finish = (value) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve(value)
      }
      let req
      try {
        req = mod.request({
          protocol: u.protocol,
          hostname: rawHost,
          port: u.port !== '' ? Number(u.port) : isHttps ? 443 : 80,
          path: (u.pathname === '' ? '/' : u.pathname) + (u.search ?? ''),
          method: method ?? 'GET',
          headers: outHeaders,
          lookup: lookupFn,
          servername: isHttps && net.isIP(rawHost) === 0 ? rawHost : undefined,
          timeout: timeoutMs,
        })
      } catch (error) {
        finish({ ok: false, code: 'NETWORK_ERROR', detail: errText(error) })
        return
      }
      timer = setTimeout(() => {
        try {
          req.destroy(Object.assign(new Error('PARSE_TIMEOUT'), { code: 'PARSE_TIMEOUT' }))
        } catch {
          /* ignore */
        }
      }, timeoutMs)
      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      req.on('response', (res) => {
        const chunks = []
        let total = 0
        res.on('data', (chunk) => {
          total += chunk.length
          if (total > 32 * 1024 * 1024) {
            finish({ ok: false, code: 'RESPONSE_TOO_LARGE', detail: '响应超过 32MB，已中止' })
            try {
              req.destroy()
            } catch {
              /* ignore */
            }
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          finish({
            ok: true,
            status: Number(res.statusCode) || 0,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
          })
        })
        res.on('error', (error) => finish({ ok: false, code: 'NETWORK_ERROR', detail: errText(error) }))
      })
      req.on('timeout', () => {
        try {
          req.destroy(Object.assign(new Error('PARSE_TIMEOUT'), { code: 'PARSE_TIMEOUT' }))
        } catch {
          /* ignore */
        }
      })
      req.on('error', (error) => {
        const code = (error && error.code) || 'NETWORK_ERROR'
        finish({ ok: false, code: code === 'ABORT_ERR' ? 'CANCELED' : code, detail: errText(error) })
      })
      if (payload !== null) req.write(payload)
      req.end()
    })
  }

  /**
   * 固定请求器：手动处理重定向，每一跳都重新核目标。
   * 规则：
   *  · 跨源重定向在 local-only / 非 cloud 提供方下一律拒绝（不允许"服务端一句话把请求带去别处"）；
   *  · 换源时**不转发正文**（301/302/303 转 GET；307/308 跨源直接拒绝）——否则等于把原件送去别处；
   *  · 每一跳都做 checkTarget：DNS 在这段时间里被改掉也拦得住。
   */
  async function requestJson(provider, url, init, { signal, timeoutMs, conf }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('PARSE_TIMEOUT'), { code: 'PARSE_TIMEOUT' })), timeoutMs)
    const merged = mergeSignals([signal, controller.signal])
    try {
      let target = url
      let method = init.method ?? 'GET'
      let body = init.body
      let headers = init.headers ?? {}
      for (let hop = 0; hop < 4; hop++) {
        const gate = await executionGate(provider, conf)
        if (!gate.ok) return gate
        conf = gate.conf
        const checked = await checkTarget(target, provider, conf)
        if (checked.ok !== true) return { ok: false, code: checked.code, detail: checked.detail }
        // DNS may have waited while the user disabled cloud processing.
        const beforeSend = await executionGate(provider, conf)
        if (!beforeSend.ok) return beforeSend
        conf = beforeSend.conf
        const sameOriginAsStart = new URL(target).origin === new URL(url).origin
        const res = await httpOnce({
          url: target,
          method,
          headers,
          body: sameOriginAsStart ? body : null,
          timeoutMs,
          signal: merged,
          pinned: checked.pinned,
        })
        if (res.ok !== true) return res
        const status = res.status
        if (status >= 300 && status < 400) {
          if (NATIVE_PROTOCOLS.includes(provider.protocol)) return { ok: false, code: 'REDIRECT_BLOCKED', detail: '原生服务不允许重定向凭据或原件' }
          const loc = res.headers && res.headers.location ? String(res.headers.location) : ''
          if (loc === '') return { ok: false, status, code: 'REDIRECT_WITHOUT_LOCATION', detail: '服务端返回重定向但没有 Location' }
          let nextUrl
          try {
            nextUrl = new URL(loc, target)
          } catch {
            return { ok: false, status, code: 'BAD_REDIRECT', detail: 'Location 不是合法地址：' + loc }
          }
          const sameOrigin = nextUrl.origin === new URL(target).origin
          if (!sameOrigin && (conf.externalPolicy === 'local-only' || provider.locality !== 'cloud')) {
            return {
              ok: false,
              status,
              code: 'REDIRECT_BLOCKED',
              detail: `拒绝跨源重定向：${new URL(target).origin} → ${nextUrl.origin}（策略 ${conf.externalPolicy}，提供方 locality=${provider.locality}）`,
            }
          }
          if (!sameOrigin) {
            if (status === 307 || status === 308) {
              return { ok: false, status, code: 'REDIRECT_BODY_BLOCKED', detail: '拒绝把请求正文转发到另一个源（307/308 跨源）' }
            }
            method = 'GET'
            body = null
            headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !['content-type', 'authorization'].includes(k.toLowerCase())))
          }
          target = nextUrl.toString()
          continue
        }
        const text = res.buffer.toString('utf8')
        if (status < 200 || status >= 300) return { ok: false, status, code: 'HTTP_' + status, detail: '服务返回错误；请检查权限、额度、地域及输入格式' }
        try {
          return { ok: true, status, json: JSON.parse(text), rawLength: text.length }
        } catch {
          return { ok: false, status, code: 'BAD_JSON', detail: '服务未返回有效 JSON' }
        }
      }
      return { ok: false, code: 'TOO_MANY_REDIRECTS', detail: '重定向超过 4 跳' }
    } catch (error) {
      const code = (error && error.code) || (error && error.name === 'AbortError' ? 'PARSE_TIMEOUT' : 'NETWORK_ERROR')
      return { ok: false, code, detail: errText(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** OCR：openai-vision —— 明确的 HTTP 协议（POST {baseUrl}/chat/completions + image_url data URI）。 */
  async function ocrOneImage(provider, conf, imagePath, { signal, diagnostics }) {
    if (NATIVE_PROTOCOLS.includes(provider.protocol)) {
      const r = await native.image(provider, imagePath, mimeOf(path.extname(imagePath).slice(1)), { signal, timeoutMs: provider.timeoutMs, conf })
      if (r.requestId) diagnostics.push({ code: 'PROVIDER_REQUEST', requestId: String(r.requestId), at: nowIso() })
      return r
    }
    if (['paddle-local', 'paddle-service', 'ppocr-local'].includes(provider.protocol)) return localModel(provider, imagePath, { signal, diagnostics })
    const buf = await readFile(imagePath)
    const ext = path.extname(imagePath).slice(1).toLowerCase()
    const b64 = buf.toString('base64')
    const body = {
      model: provider.model || 'ocr',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别图中的全部文字，按阅读顺序输出 Markdown；表格用 Markdown 表格。不要补充原文没有的内容。' },
            { type: 'image_url', image_url: { url: `data:${mimeOf(ext)};base64,${b64}` } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4096,
    }
    let headers
    try {
      headers = { 'content-type': 'application/json', ...await authHeaders(provider, diagnostics) }
    } catch (error) {
      return { ok: false, code: (error && error.code) || 'AUTH_ERROR', detail: errText(error) }
    }
    const r = await requestJson(provider, `${provider.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, { signal, timeoutMs: provider.timeoutMs, conf })
    if (!r.ok) return { ok: false, code: r.code, detail: r.detail ?? '', status: r.status ?? null }
    const choice = r.json && Array.isArray(r.json.choices) ? r.json.choices[0] : null
    const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : ''
    if (text.trim() === '') return { ok: false, code: 'EMPTY_TEXT', detail: '提供方返回 200 但正文为空（可能是纯图形页）' }
    return {
      ok: true,
      text,
      usage: r.json && r.json.usage ? { promptTokens: r.json.usage.prompt_tokens ?? null, completionTokens: r.json.usage.completion_tokens ?? null, source: 'provider' } : null,
    }
  }

  /** 用随包固定脚本把 PDF 拆成逐页 PNG（并读出文字层，文本页可跳过 OCR）。 */
  async function renderPdfPages(provider, pdfPath, outDir, { signal, maxPages, onChild }) {
    const python = provider.renderCommand || provider.command
    if (!python || !/\.(exe|cmd|bat)$/i.test(python)) {
      return { ok: false, code: 'NO_RENDERER', detail: 'PDF 需要提供方配置 renderCommand 指向固定 Python 可执行文件（如本机 ocr-venv 的 python.exe）' }
    }
    await mkdir(outDir, { recursive: true })
    const args = [PDF_HELPER, '--pdf', pdfPath, '--outdir', outDir, '--dpi', '150', '--max-pages', String(maxPages)]
    const r = await runChild(python, args, { signal, timeoutMs: 300_000, onChild })
    if (!r.ok) return { ok: false, code: r.code || 'RENDER_FAILED', detail: (r.stderr || r.stdout || '').slice(-800) }
    try {
      const parsed = JSON.parse(r.stdout.trim().split('\n').pop())
      return { ok: true, pages: parsed.pages ?? [], pageCount: parsed.pageCount ?? 0, truncated: parsed.truncated === true }
    } catch (error) {
      return { ok: false, code: 'RENDER_BAD_OUTPUT', detail: errText(error) + ' | ' + String(r.stdout).slice(0, 300) }
    }
  }

  function runChild(command, args, { signal, timeoutMs, cwd, onChild }) {
    return new Promise((resolve) => {
      let child
      try {
        // 环境最小化：只给生存必需项。凭据类变量一律不进子进程环境
        // （HTTP 提供方的凭据走 authHeaders，与子进程无关）。
        child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: minimalChildEnv() })
      } catch (error) {
        resolve({ ok: false, code: 'SPAWN_FAILED', detail: errText(error) })
        return
      }
      if (typeof onChild === 'function') onChild(child)
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        resolve({ ok: false, code: 'PARSE_TIMEOUT', detail: `子进程超过 ${timeoutMs}ms 未返回`, stdout, stderr })
      }, timeoutMs)
      const onAbort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        resolve({ ok: false, code: 'CANCELED', detail: '已取消', stdout, stderr })
      }
      if (signal) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      child.stdout.on('data', (d) => {
        stdout += d.toString('utf8')
        if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000)
      })
      child.stderr.on('data', (d) => {
        stderr += d.toString('utf8')
        if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, code: 'SPAWN_FAILED', detail: errText(error), stdout, stderr })
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve(code === 0 ? { ok: true, code: 0, stdout, stderr } : { ok: false, code: 'EXIT_' + code, stdout, stderr })
      })
    })
  }

  /** ASR：cli-transcribe —— 固定程序 + 程序构造的参数（模型参数永不进入命令行）。 */
  async function asrViaCli(provider, audioPath, outDir, { signal, diagnostics, entry }) {
    const outFile = path.join(outDir, 'transcript.txt')
    const args = [...provider.args, audioPath, '--out', outFile]
    const r = await runChild(provider.command, args, { signal, timeoutMs: provider.timeoutMs, cwd: outDir, onChild: (c) => { entry.child = c } })
    if (!r.ok) return { ok: false, code: r.code, detail: (r.stderr || r.stdout || '').slice(-800) }
    let text
    try {
      text = await readFile(outFile, 'utf8')
    } catch (error) {
      return { ok: false, code: 'NO_TRANSCRIPT_FILE', detail: '转写程序没有生成预期输出文件：' + errText(error) }
    }
    if (text.trim() === '') return { ok: false, code: 'EMPTY_TEXT', detail: '转写结果为空' }
    return { ok: true, text, segments: parseAsrSegments(text) }
  }

  /**
   * multipart/form-data 自己拼（不再用全局 FormData）：
   * 因为它要跟着**已核对的固定连接**一起发出去，必须是一个字节串。
   */
  function buildMultipart(fields, file) {
    const boundary = '----kbparse' + randomUUID().replace(/-/g, '')
    const parts = []
    for (const [name, value] of fields) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'))
    }
    if (file) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`, 'utf8'))
      parts.push(file.data)
      parts.push(Buffer.from('\r\n', 'utf8'))
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
  }

  /** ASR：openai-audio-transcriptions —— 明确协议（multipart/form-data，字段 file/model）。 */
  async function asrViaHttp(provider, audioPath, { signal, diagnostics, conf }) {
    const buf = await readFile(audioPath)
    const ext = path.extname(audioPath).slice(1).toLowerCase()
    const fields = []
    if (provider.model) fields.push(['model', provider.model])
    fields.push(['response_format', 'json'])
    const form = buildMultipart(fields, {
      field: 'file',
      filename: path.basename(audioPath),
      contentType: mimeOf(ext),
      data: buf,
    })
    let headers
    try {
      headers = { 'content-type': form.contentType, ...await authHeaders(provider, diagnostics) }
    } catch (error) {
      return { ok: false, code: (error && error.code) || 'AUTH_ERROR', detail: errText(error) }
    }
    const r = await requestJson(provider, `${provider.baseUrl}/audio/transcriptions`, { method: 'POST', headers, body: form.body }, { signal, timeoutMs: provider.timeoutMs, conf })
    if (!r.ok) return { ok: false, code: r.code, detail: r.detail ?? '', status: r.status ?? null }
    const text = typeof r.json?.text === 'string' ? r.json.text : ''
    if (text.trim() === '') return { ok: false, code: 'EMPTY_TEXT', detail: '提供方返回 200 但 text 为空' }
    return { ok: true, text, segments: Array.isArray(r.json?.segments) ? mapHttpSegments(r.json.segments) : null, usage: r.json?.usage ?? null }
  }

  /** 从本地转写文本里恢复分段位置（脚本自己写的【起–止 分钟】前缀，不伪造）。 */
  function parseAsrSegments(text) {
    const out = []
    const re = /【\s*([\d.]+)\s*[–\-—~]\s*([\d.]+)\s*分钟】([\s\S]*?)(?=【|$)/g
    let m
    while ((m = re.exec(text)) !== null) {
      const startSec = Math.round(Number(m[1]) * 60)
      const endSec = Math.round(Number(m[2]) * 60)
      out.push({ index: out.length, startSec, endSec, text: m[3].trim(), granularity: 'chunk' })
    }
    return out.length > 0 ? out : null
  }

  function mapHttpSegments(segments) {
    return segments.map((s, i) => ({
      index: i,
      startSec: Number.isFinite(Number(s.start)) ? Number(s.start) : null,
      endSec: Number.isFinite(Number(s.end)) ? Number(s.end) : null,
      text: typeof s.text === 'string' ? s.text : '',
      granularity: 'provider',
    }))
  }

  // ── 任务记录 ────────────────────────────────────────────────────────────
  const jobPath = (binding, jobId) => path.join(jobsDir(binding), jobId + '.json')

  async function readJob(jobId, bindingIn) {
    const candidates = []
    const binding = snapshotBinding(bindingIn || await getBinding())
    if (binding) candidates.push(jobPath(binding, jobId))
    if (candidates.length === 0) return null
    for (const p of candidates) {
      try {
        const job = JSON.parse(await readFile(p, 'utf8'))
        if (job.kbId !== binding.kbId || job.binding && !sameBinding(job.binding, binding)) return null
        return job
      } catch {
        continue
      }
    }
    return null
  }

  const jobWriteChains = new Map()
  let writeSeq = 0

  /**
   * 任务记录原子写。
   * Windows 上 `rename(tmp, file)` 在目标同时被另一个写者替换时会抛 EPERM，
   * 而心跳（5s）、进度回调、终态写会并发发生 → 必须按 jobId 串行，且 tmp 名唯一。
   */
  async function writeJob(binding, job) {
    if (!binding || job.kbId !== binding.kbId || job.binding && !sameBinding(job.binding, binding)) throw Object.assign(new Error('拒绝把旧任务写入其他知识库的任务目录'), { code: 'JOB_BINDING_MISMATCH' })
    const key = job.jobId + '|' + kbKeyOf(binding)
    const prev = jobWriteChains.get(key) ?? Promise.resolve()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const chained = prev.then(() => gate)
    jobWriteChains.set(key, chained)
    await prev
    try {
      await ensureDirs(binding)
      const file = jobPath(binding, job.jobId)
      writeSeq = (writeSeq + 1) % 1_000_000
      const tmp = `${file}.tmp-${process.pid}-${writeSeq}`
      await writeFile(tmp, JSON.stringify(job, null, 2), 'utf8')
      // Windows readers / antivirus can briefly hold the destination even with
      // writers serialized. Retry replacement without deleting the old record.
      for (let attempt = 0; ; attempt++) {
        try { await rename(tmp, file); break }
        catch (e) {
          if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 7) throw e
          await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)))
        }
      }
      onEvent({ type: 'parse-jobs-changed', kbId: binding.kbId, jobId: job.jobId })
      return job
    } finally {
      release()
      if (jobWriteChains.get(key) === chained) jobWriteChains.delete(key)
    }
  }

  function publicJob(job) {
    return {
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      stage: job.stage,
      purpose: job.purpose,
      source: { relPath: job.source.relPath, external: job.source.external === true, sha256: job.source.sha256, bytes: job.source.bytes, format: job.source.format },
      provider: job.provider,
      progress: job.progress,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      heartbeatAt: job.heartbeatAt,
      finishedAt: job.finishedAt,
      cancelRequestedAt: job.cancelRequestedAt,
      result: job.result
        ? {
            textChars: job.result.textChars,
            pageCount: job.result.pageCount,
            pages: job.result.pages?.map((p) => ({ page: p.page, chars: p.chars, method: p.method, status: p.status })) ?? [],
            segments: job.result.segments?.map((s) => ({ index: s.index, startSec: s.startSec, endSec: s.endSec, chars: (s.text ?? '').length, status: s.status || 'ok', granularity: s.granularity })) ?? [],
            method: job.result.method,
            usage: job.result.usage ?? null,
            unavailable: job.result.unavailable ?? [],
          }
        : null,
      partial: job.partial,
      land: job.land,
      diagnostics: job.diagnostics,
      requestedBy: job.requestedBy,
    }
  }

  function newJobId(kind) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    return `${kind}-${stamp}-${randomUUID().slice(0, 8)}`
  }

  /** 源文件定位：必须在当前绑定库内（真实路径也在内），只读。 */
  async function resolveSource(sourceRel, bindingIn) {
    const binding = snapshotBinding(bindingIn || await getBinding())
    if (!binding || !binding.kbPath) return { ok: false, code: 'KB_UNBOUND', message: '知识库未绑定：先选择并绑定知识库文件夹' }
    const rel = String(sourceRel ?? '').trim().replace(/\\/g, '/')
    if (rel === '') return { ok: false, code: 'NO_SOURCE', message: '缺少 sourceRel（库内相对路径）' }
    if (path.posix.isAbsolute(rel) || rel.split('/').includes('..')) {
      return { ok: false, code: 'SOURCE_ESCAPE', message: 'sourceRel 必须是库内相对路径，且不能含 ..' }
    }
    const rootAbs = path.resolve(binding.kbPath)
    const abs = path.resolve(rootAbs, rel)
    const inside = (child, parent) => {
      const r = path.relative(parent, child)
      return r !== '' && !r.startsWith('..') && !path.isAbsolute(r)
    }
    if (!inside(abs, rootAbs)) return { ok: false, code: 'SOURCE_ESCAPE', message: '解析路径越出知识库根目录' }
    const followLinks = (await getCore()?.getConfig())?.followLinks === true
    const guard = await checkRealPath(rootAbs, abs, { followLinks })
    if (!guard.ok) return { ok: false, code: 'SOURCE_ESCAPE', message: '原件真实路径或目录联接不符合知识库访问规则：' + guard.detail }
    let st
    try {
      st = await stat(abs)
    } catch {
      return { ok: false, code: 'SOURCE_MISSING', message: '原件不存在：' + toPosix(rel) }
    }
    if (!st.isFile()) return { ok: false, code: 'SOURCE_NOT_FILE', message: '只支持单个文件原件' }
    return { ok: true, abs, rel: toPosix(rel), bytes: st.size, rootAbs }
  }

  async function jobSource(job, binding) {
    if (!job.source.external) return resolveSource(job.source.relPath, binding)
    if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/.test(job.source.storedName || '')) return { ok: false, code: 'SOURCE_DENIED', message: '外部原件快照无效' }
    try {
      const abs = await safePath(kbDir(binding), 'sources/' + job.source.storedName), st = await stat(abs)
      return { ok: st.isFile(), abs, bytes: st.size }
    } catch { return { ok: false, code: 'SOURCE_MISSING', message: '外部原件快照不存在' } }
  }

  // ── 提交任务 ────────────────────────────────────────────────────────────
  async function submit(input, options = {}) {
    const binding = snapshotBinding(await getBinding()), requestId = randomUUID(), requestedBy = options.requestedBy || { via: 'unknown' }
    if (!binding) return { ok: false, requestId, reason: 'KB_UNBOUND', detail: '请先绑定知识库，以确定解析服务与记录归属' }
    const record = { requestId, kbId: binding.kbId, binding, kind: ['ocr', 'asr'].includes(input?.kind) ? input.kind : null, createdAt: nowIso(), status: 'submitted', requestedBy,
      source: { relPath: options.authorizedSource ? options.authorizedSource.name : String(input?.sourceRel || ''), external: Boolean(options.authorizedSource) } }
    const recordPath = path.join(kbDir(binding), 'requests', requestId + '.json')
    await atomicWriteJson(recordPath, record)
    let out
    try { out = await submitExecution(input, options) }
    catch (error) { out = { ok: false, reason: error.code || 'SUBMIT_FAILED', detail: error.message } }
    Object.assign(record, { status: out.ok ? out.deduped ? 'reused' : 'accepted' : 'rejected', jobId: out.jobId || null, reason: out.reason || null, detail: out.detail || null })
    try { await atomicWriteJson(recordPath, record) }
    catch (error) { out = { ...out, warning: '任务状态已返回，但提交记录更新失败；请凭任务编号查看任务。' }; log('warn', '解析提交记录更新失败：' + (error.code || 'write-error')) }
    onEvent({ type: 'parse-jobs-changed', kbId: binding.kbId })
    return { ...out, requestId }
  }

  async function recordRejection({ kind, requestedBy, failure }) {
    const binding = snapshotBinding(await getBinding()), requestId = randomUUID()
    if (!binding) return { requestId }
    // Unauthorized paths are deliberately not retained in rejection history.
    await atomicWriteJson(path.join(kbDir(binding), 'requests', requestId + '.json'), { requestId, kbId: binding.kbId, binding, kind: ['ocr', 'asr'].includes(kind) ? kind : null, createdAt: nowIso(), status: 'rejected', requestedBy, source: { relPath: '', external: true }, reason: failure.reason, detail: failure.detail, jobId: null })
    onEvent({ type: 'parse-jobs-changed', kbId: binding.kbId })
    return { requestId }
  }

  async function submitExecution(input, { requestedBy, authorizedSource } = {}) {
    const binding = snapshotBinding(await getBinding())
    if (!binding || !binding.kbId) return { ok: false, reason: 'KB_UNBOUND', detail: '知识库未绑定或未初始化' }
    const kindIn = String(input?.kind ?? '').trim()
    if (!PARSE_KINDS.includes(kindIn)) return { ok: false, reason: 'BAD_KIND', detail: 'kind 只能是 ocr 或 asr' }
    const conf = await readParsingConfig()
    // Caller provenance is supplied by the host, never by model arguments.
    // A remembered provider ID cannot override the user's current default.
    const toolDefault = requestedBy?.via === 'tool'
    const picked = pickProvider(conf, kindIn, toolDefault ? undefined : input?.providerId)
    if (picked.error) return { ok: false, reason: picked.error.code, detail: picked.error.message }
    const provider = picked.provider
    const src = authorizedSource ? { ok: true, ...authorizedSource, rel: authorizedSource.name } : await resolveSource(input?.sourceRel, binding)
    if (!src.ok) return { ok: false, reason: src.code, detail: src.message }
    const format = path.extname(src.rel).slice(1).toLowerCase()
    if (!provider.formats.includes(format)) {
      return {
        ok: false,
        reason: 'UNSUPPORTED_FORMAT',
        detail: `提供方 ${provider.id} 不支持 .${format}；它支持：${provider.formats.join(' / ')}`,
      }
    }
    if (src.bytes > provider.maxBytes) {
      return { ok: false, reason: 'FILE_TOO_LARGE', detail: `原件 ${src.bytes} 字节超过提供方上限 ${provider.maxBytes} 字节` }
    }
    const sha = sha256(src.data || await readFile(src.abs))
    const cfgVer = providerConfigVersion(provider)
    const dedupeKey = sha256(Buffer.from([sha, kindIn, provider.id, cfgVer, provider.model].join('|'), 'utf8')).slice(0, 24)

    // 去重：同原件 + 同类型 + 同提供方/配置版本 + 已成功/部分成功 → 直接复用，不重复计费/重复建条目
    const existing = await findJobByDedupe(binding, dedupeKey, { reuseTerminalOnly: true, requestedBy, external: Boolean(authorizedSource) })
    if (existing) {
      return { ok: true, deduped: true, jobId: existing.jobId, status: existing.status, job: publicJob(existing), detail: '同一原件与同一提供方配置已有解析结果，复用（未重复请求引擎）' }
    }

    let externalStored = null
    if (authorizedSource) {
      externalStored = randomUUID() + '.' + format
      const storage = path.join(kbDir(binding), 'sources')
      await mkdir(storage, { recursive: true })
      const bytes = src.data || await readFile(src.abs)
      if (sha256(bytes) !== sha) return { ok: false, reason: 'SOURCE_CHANGED', detail: '文件在提交期间发生变化，请重新选择' }
      await writeFile(path.join(storage, externalStored), bytes, { flag: 'wx' })
    }
    const job = {
      schemaVersion: PARSING_SCHEMA_VERSION,
      jobId: newJobId(kindIn),
      kbId: binding.kbId,
      binding,
      kind: kindIn,
      purpose: typeof input?.purpose === 'string' ? input.purpose.slice(0, 200) : '',
      requestedBy: requestedBy ?? { via: 'unknown' },
      source: { relPath: src.rel, absPath: authorizedSource ? undefined : src.abs, external: Boolean(authorizedSource), storedName: externalStored, sha256: sha, bytes: src.bytes, format },
      provider: {
        id: provider.id,
        selectionSource: toolDefault || !input?.providerId ? 'settings-default' : 'explicit',
        protocol: provider.protocol,
        model: provider.model,
        locality: provider.locality,
        configVersion: cfgVer,
        credentialRef: provider.credentialRef,
      },
      configSnapshot: {
        parsingSchemaVersion: PARSING_SCHEMA_VERSION,
        externalPolicy: conf.externalPolicy,
        provider: { ...provider, args: [...provider.args] },
      },
      status: 'queued',
      stage: 'queued',
      progress: { pagesTotal: null, pagesDone: 0, segmentsTotal: null, segmentsDone: 0 },
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      dedupeKey,
      createdAt: nowIso(),
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
      result: null,
      partial: null,
      land: { status: 'none', entryId: null, revision: null, at: null, error: null },
      diagnostics: [],
      retryOf: typeof input?.retryOf === 'string' ? input.retryOf : null,
    }
    await writeJob(binding, job)
    log('info', `解析任务已排队 ${job.jobId}（${job.kind} ← ${job.source.relPath} via ${provider.id}）`)
    void runJob(job.jobId, binding)
    return { ok: true, deduped: false, jobId: job.jobId, status: 'queued', job: publicJob(job) }
  }

  async function findJobByDedupe(binding, dedupeKey, { reuseTerminalOnly, requestedBy, external } = {}) {
    const dir = jobsDir(binding)
    const files = await listJobFiles(dir)
    let best = null
    for (const f of files) {
      try {
        const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'))
        if (j.kbId !== binding.kbId || j.binding && !sameBinding(j.binding, binding)) continue
        if (j.dedupeKey !== dedupeKey) continue
        if (Boolean(j.source?.external) !== Boolean(external)) continue
        if (requestedBy?.via === 'tool' && j.requestedBy?.session !== requestedBy.session) continue
        if (reuseTerminalOnly && !['succeeded', 'partial'].includes(j.status)) continue
        if (best === null || String(j.createdAt) > String(best.createdAt)) best = j
      } catch {
        continue
      }
    }
    return best
  }

  // ── 执行 ────────────────────────────────────────────────────────────────
  async function runJob(jobId, bindingIn) {
    const binding = snapshotBinding(bindingIn || await getBinding())
    if (!binding) return
    const job = await readJob(jobId, binding)
    if (!job) return
    if (running.has(jobId)) return
    if (!['queued'].includes(job.status)) return
    const controller = new AbortController()
    const entry = { controller, child: null, job, binding, bindingChanged: false }
    running.set(jobId, entry)
    const conf = normalizeParsingConfig(job.configSnapshot?.provider ? { externalPolicy: job.configSnapshot.externalPolicy, providers: [job.configSnapshot.provider], defaultOcr: job.kind === 'ocr' ? job.configSnapshot.provider.id : null, defaultAsr: job.kind === 'asr' ? job.configSnapshot.provider.id : null } : null).value
    const provider = job.configSnapshot.provider
    conf.executionBinding = binding
    const diagnostics = []
    const work = path.join(tmpDir(binding), jobId)
    // 执行前先核一次真实目标：拦在"起引擎/发正文"之前，比事后记一条诊断有意义
    // （同一条判据在每次 HTTP 请求前还会再核一次，防 DNS 在这段时间里被改）。
    if (!['cli-transcribe', 'qwen3-local', 'paddle-local', 'ppocr-local'].includes(provider.protocol)) {
      const pre = await checkTarget(provider.baseUrl, provider, conf)
      if (pre.ok !== true) {
        job.status = 'failed'
        job.stage = 'failed'
        job.startedAt = nowIso()
        job.finishedAt = job.startedAt
        job.attempts += 1
        job.diagnostics = [{ code: pre.code, message: pre.detail ?? '', at: nowIso() }]
        await writeJob(binding, job)
        log('warn', `解析任务 ${jobId} 在发送前被策略拦下：${pre.code}`)
        running.delete(jobId)
        return
      }
    }
    const cliRefusal = cliProgramRefusal(provider)
    if (cliRefusal) {
      job.status = 'failed'
      job.stage = 'failed'
      job.startedAt = nowIso()
      job.finishedAt = job.startedAt
      job.attempts += 1
      job.diagnostics = [{ code: cliRefusal.code, message: cliRefusal.message, at: nowIso() }]
      await writeJob(binding, job)
      log('warn', `解析任务 ${jobId} 的 CLI 配置被策略拒绝：${cliRefusal.code}`)
      running.delete(jobId)
      return
    }
    job.status = 'running'
    job.stage = job.kind === 'ocr' ? 'rendering' : 'transcribing'
    job.startedAt = nowIso()
    job.heartbeatAt = job.startedAt
    job.attempts += 1
    await writeJob(binding, job)
    const heartbeat = setInterval(() => { void (async () => {
      if (!sameBinding(binding, await getBinding())) { entry.bindingChanged = true; controller.abort(Object.assign(new Error('binding changed'), { code: 'BINDING_CHANGED' })) }
      job.heartbeatAt = nowIso()
      await writeJob(binding, job)
    })().catch(() => { log('warn', `解析任务 ${jobId} 心跳写入失败，任务记录仍归属原库`) }) }, 5000)
    const t0 = Date.now()
    let outcome
    // 本机提供方串行：绝不假设两套模型能同时常驻；排队期间仍是 queued（可取消）
    const serialLocal = provider.locality === 'local'
    try {
      await mkdir(work, { recursive: true })
      const body = async () => {
        if (job.cancelRequestedAt !== null) return { ok: false, code: 'CANCELED', detail: '已取消' }
        const gate = await executionGate(provider, conf)
        if (!gate.ok) return gate
        const source = await jobSource(job, binding)
        if (!source.ok) return { ok: false, code: source.code, detail: source.message }
        const bytes = await readFile(source.abs)
        const verified = await jobSource(job, binding)
        if (!verified.ok) return { ok: false, code: verified.code, detail: verified.message }
        if (sha256(bytes) !== job.source.sha256) return { ok: false, code: 'SOURCE_CHANGED', detail: '原件已变化，请新建解析任务；不复用旧片段' }
        // Engines consume an immutable task copy, never a live source link.
        entry.sourcePath = path.join(work, 'source.' + job.source.format)
        await writeFile(entry.sourcePath, bytes)
        job.stage = job.kind === 'ocr' ? 'rendering' : 'transcribing'
        job.heartbeatAt = nowIso()
        await writeJob(binding, job)
        if (job.kind === 'ocr') return await runOcr(provider, conf, job, work, entry, diagnostics)
        return await runAsr(provider, conf, job, work, entry, diagnostics)
      }
      if (serialLocal) {
        job.note = 'serialized-local-provider'
        job.stage = 'waiting-provider'
        job.status = 'queued'
        await writeJob(binding, job)
        outcome = await withProviderLock('local-gpu', async () => {
          // 排队期间可能已被取消：必须以磁盘上的最新记录为准（内存里的是旧副本）
          const fresh = await readJob(job.jobId, binding)
          if (fresh && fresh.cancelRequestedAt !== null) {
            job.cancelRequestedAt = fresh.cancelRequestedAt
            return { ok: false, code: 'CANCELED', detail: '排队期间已取消' }
          }
          job.status = 'running'
          return await body()
        })
      } else {
        outcome = await body()
      }
    } catch (error) {
      outcome = { ok: false, code: (error && error.code) || 'PARSE_FAILED', detail: errText(error) }
    } finally {
      clearInterval(heartbeat)
      running.delete(jobId)
      await rm(work, { recursive: true, force: true }).catch(() => {})
    }
    const elapsedMs = Date.now() - t0
    job.finishedAt = nowIso()
    job.diagnostics = diagnostics
    // 取消状态可能只写在磁盘上（cancel() 写盘，而内存里这份是旧的）：以磁盘为准
    const latestOnDisk = await readJob(job.jobId, binding)
    if (entry.bindingChanged || !sameBinding(binding, await getBinding())) outcome = { ...outcome, ...bindingFailure() }
    if (latestOnDisk && latestOnDisk.cancelRequestedAt !== null) {
      job.cancelRequestedAt = latestOnDisk.cancelRequestedAt
      job.canceledBy = latestOnDisk.canceledBy ?? job.canceledBy ?? null
    }
    if (job.cancelRequestedAt !== null) {
      job.status = 'canceled'
      job.stage = 'canceled'
    } else if (outcome.ok && outcome.partial && outcome.partial.length > 0) {
      job.status = 'partial'
      job.stage = 'done'
      job.result = outcome.result
      job.partial = { failedUnits: outcome.partial, note: '部分页/段失败；成功部分已保存为底稿，失败范围见 failedUnits' }
    } else if (outcome.ok) {
      job.status = 'succeeded'
      job.stage = 'done'
      job.result = outcome.result
      job.partial = null
    } else {
      job.status = 'failed'
      job.stage = 'failed'
      job.partial = outcome.partial ?? null
      job.result = outcome.result ?? null
      job.diagnostics = [...diagnostics, { code: outcome.code || 'PARSE_FAILED', message: outcome.detail || '', at: nowIso() }]
    }
    job.progress.elapsedMs = elapsedMs
    await writeJob(binding, job)
    log(job.status === 'failed' ? 'warn' : 'info', `解析任务 ${jobId} → ${job.status}（${elapsedMs}ms${job.result ? '，' + job.result.textChars + ' 字' : ''}）`)
  }

  async function runOcr(provider, conf, job, work, entry, diagnostics) {
    const fmt = job.source.format
    const pages = []
    let pageCount = 0
    let method = 'vision-per-image'
    if (fmt === 'pdf') {
      job.stage = 'rendering'
      job.progress.pagesTotal = null
      await writeJob(entry.binding, job)
      const rendered = await renderPdfPages(provider, entry.sourcePath, path.join(work, 'pages'), { signal: entry.controller.signal, maxPages: provider.maxPages, onChild: (c) => { entry.child = c } })
      if (!rendered.ok) return { ok: false, code: rendered.code, detail: rendered.detail }
      pageCount = rendered.pageCount
      method = 'vision-per-page'
      job.progress.pagesTotal = rendered.pages.length
      if (rendered.truncated) diagnostics.push({ code: 'PAGES_TRUNCATED', message: `PDF 共 ${rendered.pageCount} 页，超过提供方上限 ${provider.maxPages} 页，只解析前 ${rendered.pages.length} 页`, at: nowIso() })
      job.stage = 'recognizing'
      for (const p of rendered.pages) {
        if (entry.controller.signal.aborted) return { ok: false, code: 'CANCELED', detail: '已取消' }
        const gate = await executionGate(provider, conf)
        if (!gate.ok) {
          const missing = rendered.pages.filter(row => !pages.some(done => done.page === row.page)).map(row => ({ unit: 'page', index: row.page, error: gate.code }))
          return { ...gate, partial: { failedUnits: missing, note: '未继续解析的页面已明确标记，已有结果保留在原库任务中' }, result: finalizeOcr(job, pages, method, { pageCount, diagnostics }) }
        }
        const pageNo = p.page
        if (typeof p.text === 'string' && p.text.trim().length >= 20) {
          // 文字层可直接抽取：不再送 OCR（文本 PDF 走直读，不浪费引擎）
          pages.push({ page: pageNo, chars: p.text.trim().length, method: 'text-layer', status: 'ok', text: p.text })
        } else {
          const one = await ocrOneImage(provider, conf, p.image, { signal: entry.controller.signal, diagnostics })
          if (one.ok) pages.push({ page: pageNo, chars: one.text.length, method: 'ocr', status: 'ok', text: one.text, usage: one.usage ?? null })
          else pages.push({ page: pageNo, chars: 0, method: 'ocr', status: 'failed', text: '', error: one.code + (one.detail ? ': ' + one.detail : '') })
        }
        job.progress.pagesDone = pages.length
        job.heartbeatAt = nowIso()
        await writeJob(entry.binding, job)
      }
      const failed = pages.filter((p) => p.status !== 'ok')
      const result = finalizeOcr(job, pages, method, { pageCount, diagnostics })
      if (pages.length === 0) return { ok: false, code: 'NO_PAGES', detail: '没有可解析的页' }
      if (failed.length === pages.length) return { ok: false, code: 'ALL_PAGES_FAILED', detail: failed[0]?.error || '所有页都失败', partial: failed.map((p) => ({ unit: 'page', index: p.page, error: p.error })), result }
      if (failed.length > 0) return { ok: true, partial: failed.map((p) => ({ unit: 'page', index: p.page, error: p.error })), result }
      return { ok: true, result }
    }
    // 单张图片
    job.progress.pagesTotal = 1
    job.stage = 'recognizing'
    await writeJob(entry.binding, job)
    const one = await ocrOneImage(provider, conf, entry.sourcePath, { signal: entry.controller.signal, diagnostics })
    if (!one.ok) return { ok: false, code: one.code, detail: one.detail }
    pages.push({ page: 1, chars: one.text.length, method: 'ocr', status: 'ok', text: one.text, usage: one.usage ?? null })
    job.progress.pagesDone = 1
    const result = finalizeOcr(job, pages, method, { pageCount: 1, diagnostics })
    return { ok: true, result }
  }

  function finalizeOcr(job, pages, method, extra) {
    const text = pages.map((p) => (pages.length > 1 ? `===== 第 ${p.page} 页 =====\n${p.text ?? ''}` : p.text ?? '')).join('\n\n').trim()
    const usage = pages.reduce(
      (acc, p) => {
        if (!p.usage) return acc
        acc.promptTokens = (acc.promptTokens ?? 0) + (p.usage.promptTokens ?? 0)
        acc.completionTokens = (acc.completionTokens ?? 0) + (p.usage.completionTokens ?? 0)
        acc.pages = (acc.pages ?? 0) + 1
        return acc
      },
      {},
    )
    return {
      text,
      textChars: text.length,
      pageCount: extra.pageCount,
      pages: pages.map((p) => ({ page: p.page, chars: p.chars, method: p.method, status: p.status })),
      segments: [],
      method,
      usage: Object.keys(usage).length > 0 ? { ...usage, source: 'provider' } : { available: false, reason: '提供方没有返回 usage' },
      unavailable: ['wordLevelTimestamps', 'confidence', 'speakerLabels'],
      diagnostics: extra.diagnostics ?? [],
    }
  }

  async function localModel(provider, file, { signal }) {
    const work = path.dirname(file)
    const manifest = path.join(root, `ocr-${randomUUID()}.json`)
    const out = manifest + '.out'
    try {
      await mkdir(root, { recursive: true })
      await writeFile(manifest, JSON.stringify([{ index: 0, file }]), 'utf8')
      const r = await runChild(provider.command, ['-X', 'utf8', path.join(HOST_PKG_ROOT, 'tools', 'kb-local-model.py'), '--kind', 'ocr', ...localArguments(provider), '--manifest', manifest, '--out', out], { signal, timeoutMs: provider.timeoutMs, cwd: work })
      if (!r.ok) return { ok: false, code: r.code, detail: '本地 OCR 执行失败；请检查运行环境和模型' }
      return JSON.parse(await readFile(out, 'utf8'))[0] || { ok: false, code: 'EMPTY_TEXT' }
    } finally { await rm(manifest, { force: true }); await rm(out, { force: true }) }
  }

  function localArguments(p) {
    return ['--protocol', p.protocol, '--model', p.modelPath || '', '--layout-model', p.layoutModelPath || '', '--service-url', p.baseUrl || '', '--service-model', p.model || '', '--det-model', p.detModelPath || '', '--rec-model', p.recModelPath || '', '--dictionary', p.dictionaryPath || '']
  }
  async function chunkedAsr(provider, conf, job, work, entry, diagnostics) {
    const signal = entry.controller.signal
    const seconds = provider.protocol === 'qwen3-local' ? 60 : 50
    const ffmpeg = provider.ffmpegCommand || (process.platform === 'win32' ? 'C:\\ffmpeg\\ffmpeg.exe' : 'ffmpeg')
    const converted = await runChild(ffmpeg, ['-nostdin', '-y', '-v', 'error', '-i', entry.sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', String(seconds), '-reset_timestamps', '1', path.join(work, 'chunk-%05d.wav')], { signal, timeoutMs: provider.timeoutMs, cwd: work, onChild: c => { entry.child = c } })
    if (!converted.ok) return { ok: false, code: converted.code, detail: '音频转换失败；请在高级设置中检查 FFmpeg 路径' }
    const files = (await readdir(work)).filter(n => /^chunk-\d{5}\.wav$/.test(n)).sort()
    if (!files.length || files.length > 1000) return { ok: false, code: 'BAD_CHUNK_COUNT', detail: '音频片段为空或超过 1000 段' }
    job.chunkResults = job.chunkResults || {}
    // Source hash and provider snapshot belong to this job and are immutable.
    // Checkpoints survive failed attempts and host restarts; only failures rerun.
    const checkpoint = path.join(root, 'checkpoints', job.jobId + '.json')
    if (provider.protocol === 'qwen3-local') {
      try { for (const r of JSON.parse(await readFile(checkpoint, 'utf8'))) if (r.ok) job.chunkResults[r.index] = r } catch { /* first attempt */ }
    }
    job.progress.segmentsTotal = files.length
    job.progress.segmentsDone = Object.values(job.chunkResults).filter(r => r.ok).length
    await writeJob(entry.binding, job)
    let localResults = []
    if (provider.protocol === 'qwen3-local') {
      await mkdir(path.dirname(checkpoint), { recursive: true })
      const manifest = path.join(work, 'manifest.json')
      const pending = files.flatMap((file, index) => job.chunkResults[index]?.ok ? [] : [{ index, file: path.join(work, file) }])
      if (pending.length) {
        // Write successful earlier pieces too so an interrupted retry never loses them.
        const output = checkpoint + '.attempt'
        await writeFile(manifest, JSON.stringify(pending), 'utf8')
        const capture = async () => {
          try {
            const rows = JSON.parse(await readFile(output, 'utf8'))
            for (const r of rows) if (r.ok) job.chunkResults[r.index] = r
            await writeFile(checkpoint, JSON.stringify(Object.values(job.chunkResults)), 'utf8')
            job.progress.segmentsDone = Object.values(job.chunkResults).filter(r => r.ok).length
            await writeJob(entry.binding, job)
          } catch { /* helper has not completed a piece yet */ }
        }
        let captureChain = Promise.resolve()
        const timer = setInterval(() => { captureChain = captureChain.then(capture) }, 1000)
        let r
        try {
          r = await runChild(provider.command, ['-X', 'utf8', path.join(HOST_PKG_ROOT, 'tools', 'kb-local-model.py'), '--kind', 'asr', '--model', provider.modelPath, '--manifest', manifest, '--out', output], { signal, timeoutMs: provider.timeoutMs, cwd: work, onChild: c => { entry.child = c } })
        } finally { clearInterval(timer); await captureChain; await capture() }
        try { localResults = JSON.parse(await readFile(output, 'utf8')) } catch { /* failed before first piece */ }
        for (const piece of pending) if (!localResults.some(r => r.index === piece.index)) localResults.push({ index: piece.index, ok: false, code: r?.code || 'LOCAL_MODEL_FAILED' })
        await rm(output, { force: true })
      }
    }
    const segments = [], failedUnits = []
    let offset = 0
    for (let index = 0; index < files.length; index++) {
      if (signal.aborted) return { ok: false, code: 'CANCELED' }
      const gate = await executionGate(provider, conf)
      if (!gate.ok) return { ...gate, partial: { failedUnits: files.slice(index).map((_f, i) => ({ index: index + i, code: gate.code })) } }
      const data = await readFile(path.join(work, files[index]))
      let audioBytes = 0
      for (let pos = 12; pos + 8 <= data.length;) {
        const size = data.readUInt32LE(pos + 4)
        if (data.toString('ascii', pos, pos + 4) === 'data') { audioBytes = Math.min(size, data.length - pos - 8); break }
        pos += 8 + size + (size % 2)
      }
      const duration = audioBytes / 32000
      let r = job.chunkResults[index]
      if (!r?.ok) r = provider.protocol === 'qwen3-local' ? localResults.find(r => r.index === index) : await native.recognize(provider, data, 'audio/wav', { signal, timeoutMs: provider.timeoutMs, conf })
      r = r || { ok: false, code: 'LOCAL_MODEL_FAILED' }
      job.chunkResults[index] = { ...r, index }
      if (r.requestId) diagnostics.push({ code: 'PROVIDER_REQUEST', requestId: String(r.requestId), segment: index, at: nowIso() })
      segments.push({ index, startSec: offset, endSec: offset + duration, text: r.ok ? r.text : `[第 ${index + 1} 段识别失败：${r.code}]`, status: r.ok ? 'ok' : 'failed', granularity: 'chunk' })
      if (!r.ok) failedUnits.push({ index, startSec: offset, endSec: offset + duration, code: r.code })
      offset += duration
      job.progress.segmentsDone = Object.values(job.chunkResults).filter(r => r.ok).length
      await writeJob(entry.binding, job)
    }
    if (failedUnits.length === files.length) return { ok: false, code: 'ALL_CHUNKS_FAILED', detail: '全部片段识别失败，成功片段会在重试时复用', partial: { failedUnits } }
    const usage = Object.values(job.chunkResults).filter(r => r.ok && r.usage).map(r => ({ index: r.index, usage: r.usage }))
    return { ok: true, text: segments.map(s => s.text).join('\n'), segments, failedUnits, usage: usage.length ? { successfulChunks: usage, note: '成功片段的服务商用量；不包含失败请求的计费' } : null }
  }

  async function runAsr(provider, conf, job, work, entry, diagnostics) {
    job.stage = 'transcribing'
    await writeJob(entry.binding, job)
    let out
    if (provider.protocol === 'cli-transcribe') out = await asrViaCli(provider, entry.sourcePath, work, { signal: entry.controller.signal, diagnostics, entry })
    else if (['dashscope-asr', 'baidu-asr', 'qwen3-local'].includes(provider.protocol)) out = await chunkedAsr(provider, conf, job, work, entry, diagnostics)
    else out = await asrViaHttp(provider, entry.sourcePath, { signal: entry.controller.signal, diagnostics, conf })
    if (!out.ok) return { ok: false, code: out.code, detail: out.detail, partial: out.partial }
    const segments = out.segments ?? null
    if (segments === null) diagnostics.push({ code: 'SEGMENTS_UNAVAILABLE', message: '引擎没有给出分段位置：只保存全文，不伪造时间轴', at: nowIso() })
    job.progress.segmentsTotal = segments ? segments.length : null
    job.progress.segmentsDone = segments ? segments.length : null
    const transcript = segments ? segments.map((s) => s.text).join('\n') : out.text
    const durationHint = segments ? segments.reduce((m, s) => Math.max(m, s.endSec ?? 0), 0) : null
    const result = {
      text: out.text,
      plainText: transcript,
      textChars: (transcript || '').length,
      pageCount: null,
      pages: [],
      segments: segments ?? [],
      durationSec: durationHint,
      method: provider.protocol,
      usage: out.usage ? { ...out.usage, source: 'provider' } : { available: false, reason: '提供方没有返回 usage' },
      unavailable: ['wordLevelTimestamps', 'confidence', 'speakerLabels'],
      diagnostics,
    }
    if ((transcript || '').trim() === '') return { ok: false, code: 'EMPTY_TEXT', detail: '转写结果为空' }
    return { ok: true, result, partial: out.failedUnits || [] }
  }

  // ── 取消 / 重试 ─────────────────────────────────────────────────────────
  async function cancel(jobId, { by } = {}) {
    const binding = await getBinding()
    const job = await readJob(jobId, binding)
    if (!job) return { ok: false, reason: 'not-found' }
    if (['succeeded', 'partial', 'failed', 'canceled'].includes(job.status)) {
      return { ok: false, reason: 'already-terminal', status: job.status, detail: '任务已结束，无法取消' }
    }
    job.cancelRequestedAt = nowIso()
    job.canceledBy = by ?? { via: 'unknown' }
    await writeJob(binding, job)
    const live = running.get(jobId)
    if (live) {
      // 关键：执行中的那份内存在写盘时会覆盖磁盘上的取消标记 → 同步到它，别被覆盖回去
      if (live.job) {
        live.job.cancelRequestedAt = job.cancelRequestedAt
        live.job.canceledBy = job.canceledBy
      }
      live.controller.abort(Object.assign(new Error('canceled'), { code: 'CANCELED' }))
    }
    // 排队中的任务立刻终止（不等执行）
    if (job.status === 'queued' && !live) {
      job.status = 'canceled'
      job.stage = 'canceled'
      job.finishedAt = nowIso()
      await writeJob(binding, job)
    }
    return { ok: true, jobId, status: job.status, cancelRequestedAt: job.cancelRequestedAt }
  }

  async function retry(jobId, { reason } = {}) {
    const binding = await getBinding()
    const job = await readJob(jobId, binding)
    if (!job) return { ok: false, reason: 'not-found' }
    // 解析成功但落库失败：只重试提交，不重复请求引擎
    if (job.result && (job.status === 'succeeded' || (job.status === 'partial' && !job.chunkResults)) && job.land?.status !== 'landed') {
      return { ok: true, retryKind: 'land-only', jobId, detail: '解析结果已存在：只重试落库，不重复请求引擎', land: job.land }
    }
    if (!['failed', 'canceled', 'partial'].includes(job.status)) {
      return { ok: false, reason: 'not-retryable', detail: `状态 ${job.status} 不能重试` }
    }
    if (job.attempts >= job.maxAttempts) {
      return { ok: false, reason: 'attempts-exhausted', detail: `已尝试 ${job.attempts} 次（上限 ${job.maxAttempts}）；请检查提供方或用新的解析请求` }
    }
    job.status = 'queued'
    job.stage = 'queued'
    job.result = null
    job.partial = null
    job.cancelRequestedAt = null
    job.finishedAt = null
    job.diagnostics = [...(job.diagnostics ?? []), { code: 'RETRY', message: String(reason ?? '手动重试'), at: nowIso() }]
    await writeJob(binding, job)
    void runJob(job.jobId, binding)
    return { ok: true, retryKind: 'parse', jobId, status: 'queued', attempts: job.attempts }
  }

  // ── 结果读取（有界） ────────────────────────────────────────────────────
  async function readResult(jobId, { offset = 0, limit = 4000, pages: pageFilter = null, segments: segFilter = null } = {}) {
    const binding = await getBinding()
    const job = await readJob(jobId, binding)
    if (!job) return { ok: false, reason: 'not-found' }
    if (!job.result) return { ok: false, reason: 'no-result', status: job.status, detail: '任务还没有结果' }
    const full = String(job.result.text ?? '')
    const start = clampInt(offset, 0, full.length, 0)
    const take = clampInt(limit, 1, 20000, 4000)
    let body = full.slice(start, start + take)
    if (Array.isArray(pageFilter) && pageFilter.length > 0) {
      body = String(job.result.text ?? '')
        .split(/===== 第 (\d+) 页 =====/)
        .reduce((acc, chunk, i, all) => {
          if (i % 2 === 1) {
            const no = Number(chunk)
            if (pageFilter.includes(no)) acc.push('===== 第 ' + no + ' 页 =====\n' + (all[i + 1] ?? ''))
          }
          return acc
        }, [])
        .join('\n')
        .slice(start, start + take)
    }
    return {
      ok: true,
      jobId,
      status: job.status,
      textChars: full.length,
      offset: start,
      returned: body.length,
      truncated: start + take < full.length,
      text: body,
      pages: job.result.pages ?? [],
      segments: segFilter === null ? (job.result.segments ?? []) : (job.result.segments ?? []).filter((s) => segFilter.includes(s.index)),
      usage: job.result.usage ?? null,
      unavailable: job.result.unavailable ?? [],
      note: '这是可追溯底稿，不是已校订知识；逐字引用请回原件',
    }
  }

  // ── 落库 ────────────────────────────────────────────────────────────────
  async function land(jobId, opts = {}) {
    const binding = await getBinding()
    const core = getCore()
    if (!core) return { ok: false, reason: 'core-not-ready' }
    const job = await readJob(jobId, binding)
    if (!job) return { ok: false, reason: 'not-found' }
    if (job.land?.status === 'landed') {
      return { ok: true, alreadyLanded: true, jobId, entryId: job.land.entryId, revision: job.land.revision, detail: '这条解析结果已经落库过（不会重复建条目）' }
    }
    if (!job.result) return { ok: false, reason: 'no-result', detail: `解析还没有结果（status=${job.status}）` }
    if (job.status === 'failed' || job.status === 'canceled') return { ok: false, reason: 'parse-not-successful', status: job.status }
    let sourceRel = job.source.relPath
    if (job.source.external) {
      // Explicit land imports an immutable original before creating a KB reference.
      sourceRel = '90-收件箱/解析原件/' + job.jobId + '.' + job.source.format
      await core._internal.withMutationLock(binding.kbPath, async () => {
        if (!sameBinding(binding, await getBinding())) throw Object.assign(new Error('知识库绑定已改变，未入库'), { code: 'BINDING_CHANGED' })
        const original = await jobSource(job, binding)
        if (!original.ok) throw Object.assign(new Error(original.message), { code: original.code })
        const bytes = await readFile(original.abs)
        if (sha256(bytes) !== job.source.sha256) throw Object.assign(new Error('解析原件快照已变化'), { code: 'SOURCE_CHANGED' })
        const directory = await safePath(binding.kbPath, '90-收件箱/解析原件', { missing: true })
        await mkdir(directory, { recursive: true })
        const destination = await safePath(binding.kbPath, sourceRel, { missing: true })
        try { await writeFile(destination, bytes, { flag: 'wx' }) }
        catch (error) { if (error.code !== 'EEXIST' || sha256(await readFile(destination)) !== job.source.sha256) throw error }
      })
    }
    const title = typeof opts.title === 'string' && opts.title.trim() !== ''
      ? opts.title.trim()
      : `${job.kind === 'ocr' ? 'OCR' : '语音转写'}底稿 · ${path.posix.basename(job.source.relPath)}`
    const kind = typeof opts.kind === 'string' && opts.kind !== '' ? opts.kind : '素材'
    const tags = Array.isArray(opts.tags) ? opts.tags.map(String) : [job.kind === 'ocr' ? 'OCR' : '语音转写', '解析底稿']
    const provenance = [
      '',
      '---',
      '## 解析来源',
      '',
      `- 原件：\`${sourceRel}\`（sha256 \`${job.source.sha256}\`）`,
      `- 解析类型：${job.kind === 'ocr' ? 'OCR' : '语音转写'}；提供方：${job.provider.id}（${job.provider.protocol} / ${job.provider.locality} / ${job.provider.model || '未标模型'}）`,
      `- 配置版本：\`${job.provider.configVersion}\`；任务：\`${job.jobId}\`；状态：${job.status}${job.partial ? '（部分失败：' + (job.partial.failedUnits ?? []).length + ' 处）' : ''}`,
      job.result.pages?.length ? `- 覆盖页：${job.result.pages.map((p) => p.page).join(', ')}（时长/页数：${job.result.pageCount ?? '未知'}）` : '',
      job.result.segments?.length ? `- 分段：${job.result.segments.length} 段（每段起止见任务记录）` : '',
      `- 引擎未提供：${(job.result.unavailable ?? []).join(' / ') || '无'}`,
      '',
      '> 这是可追溯底稿，不是已校订知识；逐字引用请回原件。',
    ].filter(Boolean).join('\n')
    const content = `${String(job.result.plainText ?? job.result.text).trim()}\n${provenance}\n`
    const args = { kind, title, content, tags, source: sourceRel, requestId: 'parse-' + job.jobId, expectedBinding: snapshotBinding(binding) }
    const r = await (opts.entryId
      ? core.updateEntry({
          entryId: opts.entryId,
          expectedRevision: opts.expectedRevision,
          patch: { title, tags, source: sourceRel },
          content,
          requestId: 'parse-' + job.jobId + '-upd',
          expectedBinding: snapshotBinding(binding),
        })
      : core.createEntry(args))
    if (!r || r.ok !== true) {
      job.land = { status: r && r.conflict ? 'conflict' : 'failed', entryId: opts.entryId ?? null, revision: null, at: nowIso(), error: (r && (r.reason || r.detail)) || 'land-failed' }
      await writeJob(binding, job)
      return { ok: false, reason: job.land.error, conflict: Boolean(r && r.conflict), jobId, land: job.land, detail: '解析结果已保留；修正后可只重试落库（retry），不会重复请求引擎' }
    }
    job.land = { status: 'landed', entryId: r.entryId ?? opts.entryId ?? null, revision: r.revision ?? null, at: nowIso(), error: null, path: r.path ?? null }
    await writeJob(binding, job)
    return { ok: true, jobId, land: job.land, entryId: job.land.entryId }
  }

  // ── 列表 / 恢复 ─────────────────────────────────────────────────────────
  async function listJobs({ limit = 20, offset = 0, kind = null, status = null, filter = null } = {}) {
    const binding = await getBinding()
    if (!binding || !binding.kbId) return { ok: true, jobs: [], note: '未绑定知识库' }
    const dir = jobsDir(binding)
    const files = await listJobFiles(dir)
    let jobs = [], unreadable = 0
    for (const f of files) {
      try {
        const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'))
        if (j.kbId !== binding.kbId || j.binding && !sameBinding(j.binding, binding)) continue
        if (kind && j.kind !== kind) continue
        if (status && j.status !== status) continue
        jobs.push(publicJob(j))
      } catch {
        unreadable++; continue
      }
    }
    jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    if (filter) jobs = await filter(jobs)
    const start = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0), pageSize = clampInt(limit, 1, JOBS_KEPT, 20)
    return { ok: true, jobs: jobs.slice(start, start + pageSize), total: jobs.length, offset: start, limit: pageSize, ...(unreadable ? { warning: `${unreadable} 条任务记录无法读取，原记录已保留` } : {}) }
  }

  async function listRequests({ limit = 20, offset = 0, kind = null, filter = null } = {}) {
    const binding = await getBinding()
    if (!binding?.kbId) return { ok: true, requests: [], total: 0 }
    const dir = path.join(kbDir(binding), 'requests'), files = await listJobFiles(dir)
    let rows = [], unreadable = 0
    for (const file of files) {
      try { const r = JSON.parse(await readFile(path.join(dir, file), 'utf8')); if (sameBinding(r.binding, binding) && (!kind || r.kind === kind)) rows.push(r) }
      catch { unreadable++ }
    }
    if (filter) rows = await filter(rows)
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const start = clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0), pageSize = clampInt(limit, 1, 200, 20)
    return { ok: true, requests: rows.slice(start, start + pageSize), total: rows.length, offset: start, limit: pageSize, ...(unreadable ? { warning: '部分提交记录无法读取，原记录已保留' } : {}) }
  }

  /** 启动恢复：running 的记录不可能还活着，必须明确结局，不能永久挂起。 */
  async function recover() {
    if (recovered) return { ok: true, scanned: 0, recovered: 0 }
    recovered = true
    const binding = await getBinding()
    if (!binding || !binding.kbId) return { ok: true, scanned: 0, recovered: 0, note: '未绑定' }
    const dir = jobsDir(binding)
    const files = await listJobFiles(dir)
    let fixed = 0
    for (const f of files) {
      const file = path.join(dir, f)
      let j
      try {
        j = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        continue
      }
      if (j.status !== 'running' && j.status !== 'queued') continue
      if (j.kbId !== binding.kbId || j.binding && !sameBinding(j.binding, binding)) continue
      if (running.has(j.jobId)) continue
      const requeue = j.attempts < (j.maxAttempts ?? MAX_ATTEMPTS) && j.status === 'running'
      j.diagnostics = [...(j.diagnostics ?? []), { code: 'INTERRUPTED', message: `宿主重启：任务停在 ${j.status}/${j.stage}，未观察到结束`, at: nowIso() }]
      if (requeue) {
        j.status = 'queued'
        j.stage = 'queued'
        j.note = 'requeued-after-restart'
        await writeJob(binding, j)
        void runJob(j.jobId, binding)
      } else {
        j.status = 'failed'
        j.stage = 'failed'
        j.finishedAt = nowIso()
        j.partial = j.partial ?? { failedUnits: [], note: '重启中断，未完成' }
        await writeJob(binding, j)
      }
      fixed += 1
    }
    if (fixed > 0) log('warn', `解析任务恢复：处理 ${fixed} 条中断记录`)
    await pruneJobs(binding)
    return { ok: true, scanned: files.length, recovered: fixed }
  }

  async function pruneJobs(binding) {
    const dir = jobsDir(binding)
    const files = await listJobFiles(dir)
    if (files.length <= JOBS_KEPT) return
    const rows = []
    for (const f of files) {
      try {
        const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'))
        rows.push({ f, at: j.createdAt, terminal: ['succeeded', 'partial', 'failed', 'canceled'].includes(j.status) })
      } catch {
        rows.push({ f, at: '', terminal: true })
      }
    }
    rows.sort((a, b) => String(a.at).localeCompare(String(b.at)))
    const drop = rows.filter((r) => r.terminal).slice(0, Math.max(0, rows.length - JOBS_KEPT))
    for (const r of drop) {
      await rm(path.join(dir, r.f), { force: true }).catch(() => {})
      await rm(path.join(root, 'checkpoints', r.f), { force: true }).catch(() => {})
    }
  }

  /** 连接测试：只验证"这个地址/程序通不通"，**不冒充解析通过**。 */
  async function testConnection(providerId) {
    const provider = (await readParsingConfig()).providers.find(p => p.id === providerId)
    const result = await checkConnection(providerId)
    if (provider && ['qwen3-local', 'paddle-local', 'paddle-service', 'ppocr-local'].includes(provider.protocol)) {
      const file = environmentFile(provider)
      await mkdir(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp-' + randomUUID()
      await writeFile(tmp, JSON.stringify({ configVersion: providerConfigVersion(provider), checkedAt: nowIso(), ok: result.ok }), 'utf8')
      await rename(tmp, file)
    }
    return result
  }

  async function checkConnection(providerId) {
    const conf = await readParsingConfig()
    const provider = conf.providers.find((p) => p.id === providerId)
    if (!provider) return { ok: false, reason: 'not-found' }
    const refused = policyRefusal(provider, conf)
    if (refused) return { ok: false, reason: refused.code, detail: refused.message, kind: 'policy' }
    const diagnostics = []
    const t0 = Date.now()
    if (['cli-transcribe', 'qwen3-local', 'paddle-local', 'paddle-service', 'ppocr-local'].includes(provider.protocol)) {
      try {
        const st = await stat(provider.command)
        if (!st.isFile()) return { ok: false, reason: 'BAD_COMMAND', detail: 'command 不是文件' }
      } catch {
        return { ok: false, reason: 'COMMAND_MISSING', detail: '找不到可执行程序：' + provider.command, kind: 'connection' }
      }
      if (provider.protocol !== 'cli-transcribe') {
        try {
          if (['qwen3-local', 'paddle-local'].includes(provider.protocol) && !(await stat(provider.modelPath)).isDirectory()) throw new Error('not-directory')
          if (provider.kind === 'asr') await stat(provider.ffmpegCommand || 'C:\\ffmpeg\\ffmpeg.exe')
        } catch { return { ok: false, kind: 'connection', reason: 'LOCAL_DEPENDENCY_MISSING', detail: '模型目录或 FFmpeg 不存在，请检查高级设置' } }
        const r = await runChild(provider.command, ['-X', 'utf8', path.join(HOST_PKG_ROOT, 'tools', 'kb-local-model.py'), '--check', '--kind', provider.kind, ...localArguments(provider)], { timeoutMs: 20000 })
        if (!r.ok) return { ok: false, kind: 'connection', reason: r.code, detail: '无法检查本地 Python 环境' }
        try {
          const check = JSON.parse(r.stdout.trim().split('\n').pop())
          if (check.ok && provider.kind === 'ocr') {
            const render = await runChild(provider.renderCommand || provider.command, ['-X', 'utf8', '-c', 'import importlib.util,json; print(json.dumps({"ok":bool(importlib.util.find_spec("pymupdf") or importlib.util.find_spec("fitz"))}))'], { timeoutMs: 20000 })
            if (!render.ok || !render.stdout.includes('"ok": true')) return { ok: false, kind: 'environment', reason: 'PDF_RENDER_MISSING', detail: 'OCR 环境存在；PDF 渲染环境缺少 PyMuPDF，请在高级设置中选择另一个已安装环境。图片识别仍可单独测试。' }
          }
          return check.ok ? { ok: true, kind: 'connection', detail: '模型目录及依赖存在（未加载模型）；需测试解析验证。' + (provider.kind === 'ocr' ? '已找到版面分析及 PDF 渲染依赖。' : '') } : { ok: false, kind: 'connection', reason: 'LOCAL_DEPENDENCY_MISSING', detail: '缺少依赖：' + check.missing.join('、') }
        } catch { return { ok: false, kind: 'connection', reason: 'LOCAL_CHECK_FAILED', detail: '环境检查未返回有效结果' } }
      }
      for (const a of provider.args) {
        if (a.toLowerCase().endsWith('.py') || a.toLowerCase().endsWith('.cmd')) {
          try {
            await stat(a)
          } catch {
            return { ok: false, reason: 'ARG_MISSING', detail: '参数里的脚本不存在：' + a, kind: 'connection' }
          }
        }
      }
      return { ok: true, kind: 'connection', latencyMs: Date.now() - t0, detail: '固定程序与脚本存在（这只证明"能找到程序"，不证明转写可用）', note: '解析请用 testParse（真实小样本）' }
    }
    if (NATIVE_PROTOCOLS.includes(provider.protocol)) return native.connection(provider, { timeoutMs: Math.min(provider.timeoutMs, 20000), conf })
    let headers
    try {
      headers = await authHeaders(provider, diagnostics)
    } catch (error) {
      return { ok: false, reason: (error && error.code) || 'AUTH_ERROR', detail: errText(error), kind: 'auth', diagnostics }
    }
    const r = await requestJson(provider, `${provider.baseUrl}/models`, { method: 'GET', headers }, { timeoutMs: Math.min(provider.timeoutMs, 20_000), conf, signal: null })
    if (!r.ok) return { ok: false, kind: 'connection', reason: r.code, detail: r.detail ?? '', status: r.status ?? null, diagnostics }
    const models = Array.isArray(r.json?.data) ? r.json.data.map((m) => m.id).filter(Boolean) : []
    const modelOk = provider.model === '' ? null : models.includes(provider.model)
    return {
      ok: true,
      kind: 'connection',
      latencyMs: Date.now() - t0,
      models,
      modelConfigured: provider.model || null,
      modelPresent: modelOk,
      detail: (modelOk === false ? `服务在线，但模型列表里没有 ${provider.model}` : '服务在线') + (provider.kind === 'ocr' ? `；PDF 渲染程序${provider.renderCommand && await stat(provider.renderCommand).then(s => s.isFile()).catch(() => false) ? '存在，需用 PDF 测试验证' : '未配置或不存在'}；视觉接口不包含版面分析管线` : ''),
      note: '这只证明"地址与鉴权通"，不证明解析可用；请用 testParse 真实跑一个小样本',
      diagnostics,
    }
  }

  /** 真实小样本解析：走同一条任务服务（不是另开一条捷径）。 */
  async function testParse({ providerId, sourceRel, kind } = {}, { requestedBy, authorizedSource } = {}) {
    const conf = await readParsingConfig()
    const toolDefault = requestedBy?.via === 'tool'
    const selectedId = toolDefault ? (kind === 'ocr' ? conf.defaultOcr : conf.defaultAsr) : providerId
    const provider = conf.providers.find((p) => p.id === selectedId)
    const submitted = await submit({ kind: kind ?? (toolDefault ? undefined : provider?.kind), providerId, sourceRel, purpose: 'provider-test' }, { requestedBy: requestedBy ?? { via: 'test' }, authorizedSource })
    if (!submitted.ok) return submitted
    const jobId = submitted.jobId
    const deadline = Date.now() + Math.min((provider?.timeoutMs || 600000) + 30_000, 10 * 60_000)
    while (Date.now() < deadline) {
      const j = await readJob(jobId)
      if (j && ['succeeded', 'partial', 'failed', 'canceled'].includes(j.status)) {
        const preview = j.result?.text ? String(j.result.text).slice(0, 120) : ''
        return {
          ok: j.status === 'succeeded' || j.status === 'partial',
          jobId,
          requestId: submitted.requestId,
          deduped: submitted.deduped,
          status: j.status,
          textChars: j.result?.textChars ?? 0,
          preview,
          diagnostics: j.diagnostics,
          note: '真实解析（同一条任务服务），结果已落底稿；这只是小样本，不代表全库准确率',
        }
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    return { ok: false, requestId: submitted.requestId, jobId, status: 'timeout-wait', detail: '等待解析超过上限；任务仍在后台（去任务列表看状态）' }
  }

  return {
    async scanStart(input, { viaAdmin = false } = {}) { return viaAdmin ? discovery.start(input) : adminOnly('扫描本机') },
    scanStatus(id, { viaAdmin = false } = {}) { return viaAdmin ? discovery.get(id) : adminOnly('查看扫描') },
    scanCancel(id, { viaAdmin = false } = {}) { return viaAdmin ? discovery.cancel(id) : adminOnly('取消扫描') },
    async scanAdd(scanId, resultId, { viaAdmin = false } = {}) {
      if (!viaAdmin) return adminOnly('添加扫描结果')
      const candidate = discovery.candidate(scanId, resultId)
      return candidate ? saveProvider(candidate, { viaAdmin: true }) : { ok: false, reason: 'CANDIDATE_NOT_READY' }
    },
    providersPublic,
    saveProvider,
    deleteProvider,
    setDefaults,
    setPolicy,
    submit,
    recordRejection,
    listJobs,
    listRequests,
    readResult,
    cancel,
    retry,
    land,
    recover,
    testConnection,
    testParse,
    readJob,
    publicJob,
    _internal: {
      resolveSource,
      normalizeParsingConfig,
      normalizeProvider,
      providerConfigVersion,
      parseAsrSegments,
      policyRefusal,
      // 2026-10-18 定向修复：这三项让"公网冒充 local / 行内求值 / 地址分级"可以离线自证
      staticDestinationRefusal,
      classifyAddress,
      isLocalHostName,
      cliProgramRefusal,
      checkTarget,
    },
  }
}
