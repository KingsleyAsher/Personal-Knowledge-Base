// 自定义流程：定义持久化 + 触发语解析 + 运行执行器 + 受控落库。
//
// 设计约束（来自产品需求，逐条对应）：
//   1. 定义随**库身份（kbId）**保存：`<stateDir>/flows/<kbId>/flows.json`。
//      未绑定知识库 → 拒绝读写并给明确错误（不落"无主的流程"）。
//   2. revision 防覆盖：更新必须带 expectedRevision；不符 → conflict 且**不改盘**。
//      写前备份（与 kbcore 的原子写/备份风格一致：tmp + rename 重试 + 逐次 .bak）。
//   3. 软删除 = archived:true —— 从可触发列表移除，但定义与运行记录都保留，可恢复。
//   4. 运行记录与定义分开：`<stateDir>/flows/<kbId>/runs/<runId>.json`。
//      记录里固定 kbId / flowRevision / params / runId —— 库切换后不会串读（路径按 kbId 分）。
//   5. 执行 = 通过 gateway 的委派内核逐步交给知识库子代理（**不新建 Agent 运行时**）。
//      每一步一次委派 → 真进度、真取消、真失败原因；无副作用步骤才允许重试。
//   6. 成功才落库，且落库走**现有 core 的 createEntry**（隐私/路径/revision 保护全继承）；
//      失败或取消绝不写成成功，也绝不把"流程说明"当成已执行结果。
//
// 本文件不 import 任何 @deepseek-ai/* 包，只用 node 内置 + 注入进来的 core/delegate。

import crypto from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, unlink, copyFile } from 'node:fs/promises'
import path from 'node:path'

export const FLOWS_SCHEMA_VERSION = 1
function withBuiltinFlows(flows) {
  const flow = normalizeFlow({ id: 'builtin-inbox-organize', name: '整理并归档收件箱',
    triggers: ['整理并归档收件箱'], description: '内置流程：新开知识库 agent 会话，以 High 推理强度整理收件箱。',
    steps: [{ title: '整理并归档收件箱内的文件', instruction: '整理并归档收件箱内的文件。' }],
    outputRules: { land: false }, enabled: true, revision: 1 })
  return [{ ...flow, builtin: true }, ...flows.filter(f => f.id !== flow.id)]
}
export const FLOW_KINDS = ['知识', '项目', '人物', '素材', '画像']
export const MAX_STEPS = 12
export const MAX_RUNS_KEPT = 120
const BAK_KEEP = 5
// Multiple engine instances in one host must not race read/modify/write or
// admit the same run while its initial record is still being written.
const stateQueues = new Map()
async function serialized(key, fn) {
  const previous = stateQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(fn)
  stateQueues.set(key, current)
  try { return await current } finally { if (stateQueues.get(key) === current) stateQueues.delete(key) }
}

const nowIso = () => new Date().toISOString()
const str = (v) => (typeof v === 'string' ? v.trim() : '')
const arr = (v) => (Array.isArray(v) ? v : [])
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function newId(prefix) {
  return prefix + '-' + crypto.randomBytes(5).toString('hex')
}

/** kbId 直接进路径前必须收窄（防路径逃逸） */
function safeKbKey(kbId) {
  const raw = str(kbId)
  if (/^[A-Za-z0-9._-]{1,64}$/.test(raw) && raw !== '.' && raw !== '..') return raw
  return 'h-' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)
}

export function flowPathsOf(stateDir, kbId) {
  const base = path.join(path.resolve(stateDir), 'flows', safeKbKey(kbId))
  return {
    base: base,
    file: path.join(base, 'flows.json'),
    runsDir: path.join(base, 'runs'),
    backupsDir: path.join(base, 'backups'),
  }
}

/** 与 kbcore 一致的原子写：先写 tmp，再 rename；Windows 上短暂的 EPERM/EBUSY 退避重试。 */
async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(tmp, text, 'utf8')
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

async function readJson(file) {
  try {
    const raw = await readFile(file, 'utf8')
    try {
      return { state: 'ok', value: JSON.parse(raw), raw: raw }
    } catch (error) {
      return { state: 'corrupt', error: String((error && error.message) ?? error) }
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing' }
    return { state: 'unreadable', error: String((error && (error.code || error.message)) ?? error) }
  }
}

// ── 校验 / 规范化 ────────────────────────────────────────────────────────────
/**
 * 校验一份流程定义。返回**错误清单**（空数组 = 通过）。
 * 之所以是纯函数：桩测要用同一个函数做双向自证（好样本零误报、坏样本逐项命中）。
 */
export function validateFlow(flow) {
  const errors = []
  if (!isPlainObject(flow)) return ['定义必须是对象']
  if (str(flow.name) === '') errors.push('name 必填')
  if (str(flow.name).length > 80) errors.push('name 过长（≤80）')
  const triggers = arr(flow.triggers).map(str).filter((t) => t !== '')
  if (triggers.length === 0) errors.push('triggers 至少要有一条触发语')
  if (triggers.some((t) => t.length > 40)) errors.push('单条触发语过长（≤40）')
  const steps = arr(flow.steps)
  if (steps.length === 0) errors.push('steps 至少要有一项')
  if (steps.length > MAX_STEPS) errors.push(`steps 最多 ${MAX_STEPS} 项`)
  steps.forEach((s, i) => {
    if (!isPlainObject(s)) {
      errors.push(`steps[${i}] 必须是对象`)
      return
    }
    if (str(s.title) === '') errors.push(`steps[${i}].title 必填`)
    if (str(s.instruction) === '') errors.push(`steps[${i}].instruction 必填`)
    if (s.capability !== undefined && s.capability !== null && typeof s.capability !== 'string') errors.push(`steps[${i}].capability 必须是字符串`)
  })
  for (const [i, p] of arr(flow.params).entries()) {
    if (!isPlainObject(p)) {
      errors.push(`params[${i}] 必须是对象`)
      continue
    }
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]{1,32}$/.test(str(p.name))) errors.push(`params[${i}].name 非法（字母/数字/下划线/汉字，≤32）`)
  }
  const names = arr(flow.params).filter(isPlainObject).map((p) => str(p.name)).filter((n) => n !== '')
  if (new Set(names).size !== names.length) errors.push('params 名字重复')
  if (flow.capabilities !== undefined && flow.capabilities !== null && !Array.isArray(flow.capabilities)) errors.push('capabilities 必须是数组')
  if (flow.execution !== undefined && flow.execution !== null) {
    const route = flow.execution
    if (!isPlainObject(route)) errors.push('execution 必须是对象')
    else {
      for (const key of ['provider', 'model', 'reasoningEffort']) {
        if (route[key] !== undefined && (typeof route[key] !== 'string' || route[key].length > 256)) errors.push(`execution.${key} 必须是 ≤256 字的字符串`)
      }
      if (Boolean(str(route.provider)) !== Boolean(str(route.model))) errors.push('执行模型必须同时指定 provider 和 model')
      if (str(route.reasoningEffort) && !str(route.model)) errors.push('选择推理强度前请先选择执行模型')
    }
  }
  const rules = flow.outputRules === undefined || flow.outputRules === null ? {} : flow.outputRules
  if (!isPlainObject(rules)) errors.push('outputRules 必须是对象')
  else {
    if (rules.kind !== undefined && rules.kind !== null && FLOW_KINDS.indexOf(String(rules.kind)) < 0) errors.push('outputRules.kind 不在允许值内：' + FLOW_KINDS.join(' / '))
    if (rules.tags !== undefined && rules.tags !== null && !Array.isArray(rules.tags)) errors.push('outputRules.tags 必须是数组')
    if (rules.dir !== undefined && rules.dir !== null && rules.dir !== '') {
      const d = String(rules.dir).replace(/\\/g, '/')
      if (d.startsWith('/') || /^[A-Za-z]:/.test(d) || d.split('/').some((s) => s === '..')) errors.push('outputRules.dir 必须是库内相对路径（不得绝对路径/不得 ..）')
    }
    if (rules.status !== undefined && rules.status !== null && (typeof rules.status !== 'string' || String(rules.status).length > 20)) errors.push('outputRules.status 必须是 ≤20 字的字符串')
    if (rules.windowDays !== undefined && rules.windowDays !== null) {
      const n = Number(rules.windowDays)
      if (!Number.isInteger(n) || n < 1 || n > 365) errors.push('outputRules.windowDays 必须是 1..365 的整数')
    }
  }
  return errors
}

/** 规范化成磁盘形状（补默认值、去空白、生成 step id）。校验不过的不写盘。 */
export function normalizeFlow(input, ctxIn = {}) {
  const now = ctxIn.now ?? nowIso()
  const rulesIn = isPlainObject(input.outputRules) ? input.outputRules : {}
  const steps = arr(input.steps).map((s, i) => {
    const step = {
      id: str(s.id) || 's' + String(i + 1),
      title: str(s.title),
      instruction: str(s.instruction),
    }
    if (str(s.capability) !== '') step.capability = str(s.capability)
    return step
  })
  const params = arr(input.params).map((p) => {
    const one = { name: str(p.name), default: p.default === undefined || p.default === null ? '' : String(p.default) }
    one.required = p.required === true
    return one
  })
  return {
    id: str(input.id) || newId('flow'),
    schemaVersion: FLOWS_SCHEMA_VERSION,
    revision: Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : 1,
    name: str(input.name),
    triggers: Array.from(new Set(arr(input.triggers).map(str).filter((t) => t !== ''))),
    description: str(input.description),
    execution: Object.fromEntries(['provider', 'model', 'reasoningEffort'].filter(key => str(input.execution?.[key])).map(key => [key, str(input.execution[key])])),
    params: params,
    steps: steps,
    capabilities: Array.from(new Set(arr(input.capabilities).map(str).filter((c) => c !== ''))),
    outputRules: {
      land: rulesIn.land === true,
      kind: FLOW_KINDS.indexOf(String(rulesIn.kind)) >= 0 ? String(rulesIn.kind) : '知识',
      tags: Array.from(new Set(arr(rulesIn.tags).map(str).filter((t) => t !== ''))),
      dir: str(rulesIn.dir).replace(/\\/g, '/'),
      tz: str(rulesIn.tz) || 'Asia/Shanghai',
      // 落库报告的 frontmatter status：终态语义（缺省「生效」，不写「进行中」这种过程态）
      status: str(rulesIn.status) || '生效',
      windowDays: Number.isFinite(Number(rulesIn.windowDays)) ? Math.trunc(Number(rulesIn.windowDays)) : 7,
    },
    enabled: input.enabled !== false,
    archived: input.archived === true,
    createdAt: str(input.createdAt) || now,
    updatedAt: now,
  }
}

/** 参数默认值解析：给定值 → 默认值；required 且最终为空 → 报缺参（不替用户猜）。 */
export function resolveParams(flow, given) {
  const g = isPlainObject(given) ? given : {}
  const values = Object.create(null)
  const missing = []
  for (const p of arr(flow.params)) {
    const raw = Object.hasOwn(g, p.name) ? g[p.name] : undefined
    const value = raw === undefined || raw === null || String(raw) === '' ? (p.default ?? '') : String(raw)
    if (p.required === true && String(value ?? '').trim() === '') missing.push(p.name)
    values[p.name] = String(value)
  }
  // 未声明的参数原样保留（调用方可能带临时值），但不参与 required 判定
  for (const key of Object.keys(g)) if (!Object.hasOwn(values, key)) values[key] = String(g[key])
  return { ok: missing.length === 0, values: values, missing: missing }
}

// ── 触发语解析（纯函数，桩测直接调） ─────────────────────────────────────────
const NEGATION = ['不要', '不用', '不需要', '别', '先别', '取消', '停止', '不用再', '别去', '不做', '不搞', '不必']
const HYPOTHETICAL = ['如果', '假如', '要是', '万一', '假设']
const DOC_MENTION = ['提到', '文档里', '文档中', '说明里', '说明中', '写着', '指的是', '引号', '所谓']

/**
 * 在一段话里找命中哪些**已启用且未归档**的流程。
 * 返回：
 *   status = hit（唯一流程）/ ambiguous（多个流程都命中）/ miss（无命中）
 *   matched：命中的 {flowId, name, trigger} —— ambiguous 时调用方列出候选让用户选
 *   guarded / guardReasons：句子里出现否定、假设、文档提及 → 提示"这更像提及而不是命令"，
 *   执行器默认因此**不自动开跑**（需求原文：不得把普通句子、否定句或文档中的触发词自动视作启动命令）。
 */
export function matchTriggers(flows, textIn) {
  const text = str(textIn)
  const matched = []
  if (text === '') return { status: 'miss', matched: [], guarded: false, guardReasons: [], coverage: { flows: arr(flows).length } }
  const live = arr(flows).filter((f) => f && f.enabled !== false && f.archived !== true)
  for (const flow of live) {
    for (const trigger of arr(flow.triggers)) {
      if (str(trigger) === '') continue
      const at = text.indexOf(trigger)
      if (at < 0) continue
      matched.push({ flowId: flow.id, name: flow.name, trigger: trigger, at: at })
      break
    }
  }
  const reasons = []
  const window = (entry) => text.slice(Math.max(0, entry.at - 10), entry.at)
  let guarded = false
  for (const entry of matched) {
    const before = window(entry)
    const neg = NEGATION.find((w) => before.indexOf(w) >= 0)
    if (neg !== undefined) {
      guarded = true
      reasons.push(`「${entry.trigger}」前面有否定词「${neg}」：这看起来不是在叫我执行`)
    }
    const hyp = HYPOTHETICAL.find((w) => before.indexOf(w) >= 0)
    if (hyp !== undefined) {
      guarded = true
      reasons.push(`「${entry.trigger}」出现在「${hyp}…」的假设句里`)
    }
    const doc = DOC_MENTION.find((w) => text.indexOf(w) >= 0)
    if (doc !== undefined) {
      guarded = true
      reasons.push(`这段话里有对「${entry.trigger}」的提及式措辞（${doc}），可能只是提到而不是要求执行`)
    }
  }
  const flowIds = Array.from(new Set(matched.map((m) => m.flowId)))
  const status = matched.length === 0 ? 'miss' : flowIds.length === 1 ? 'hit' : 'ambiguous'
  return { status: status, matched: matched, guarded: guarded, guardReasons: Array.from(new Set(reasons)), coverage: { flows: live.length } }
}

// ── 执行器 ───────────────────────────────────────────────────────────────────
function fmtInTz(iso, tz) {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function isSideEffectStep(step) {
  const cap = str(step === undefined || step === null ? '' : step.capability).toLowerCase()
  // Unknown capabilities can have side effects. Only explicitly read-only
  // steps qualify for automatic retry; a label is not a permission boundary.
  return !['read', 'search', 'fetch', 'read-only'].includes(cap)
}

function buildStepTask(flow, run, step, index, prior) {
  const lines = []
  lines.push(`【流程】${flow.name}（定义版本 v${flow.revision}，运行 ${run.runId}）`)
  if (flow.description !== '') lines.push(`【用途】${flow.description}`)
  lines.push('【本次参数】')
  const keys = Object.keys(run.params ?? {})
  if (keys.length === 0) lines.push('（无）')
  else for (const k of keys) lines.push(`- ${k} = ${run.params[k]}`)
  lines.push(`【时间窗】${run.window.startAt} → ${run.window.endAt}（时区 ${run.window.tz}；默认取最近 ${run.window.windowDays} 天）`)
  lines.push(`【第 ${index + 1}/${flow.steps.length} 步】${step.title}`)
  lines.push(step.instruction)
  if (prior.length > 0) {
    lines.push('【前序步骤已产出的内容（节选，作为本步输入）】')
    for (const p of prior) {
      const body = String(p.answer ?? '').trim()
      lines.push(`--- ${p.index + 1}. ${p.title} ---`)
      lines.push(body.length > 1200 ? body.slice(0, 1200) + '…（已截断）' : body)
    }
  }
  lines.push('')
  lines.push('【本次作业纪律】')
  lines.push('1. 只做上面这一步；不要替后面的步骤先做，也不要省略。')
  lines.push('2. 这一段的产出会被留在运行记录里，后续步骤会读它 —— 写清楚、可引用，不要寒暄。')
  lines.push('3. 需要主人当场确认的事（删除、覆盖原件、外发），不要执行；直接写「需用户确认」+ 原因。')
  lines.push('4. 不要调用其它子代理，也不要再调用知识库请求工具。')
  return lines.join('\n')
}

function buildReport(flow, run) {
  const lines = []
  lines.push(`# ${flow.name} · 运行报告`)
  lines.push('')
  lines.push(`- 运行：\`${run.runId}\`（流程 ${flow.id} v${run.flowRevision}）`)
  lines.push(`- 知识库：${run.kbId}`)
  lines.push(`- 参数：${Object.keys(run.params ?? {}).length === 0 ? '（无）' : Object.keys(run.params).map((k) => `${k}=${run.params[k]}`).join('，')}`)
  lines.push(`- 时间窗：${run.window.startAt} → ${run.window.endAt}（${run.window.tz}）`)
  lines.push(`- 开始 / 结束：${run.startedAt} / ${run.finishedAt ?? '-'}`)
  lines.push('')
  lines.push('## 步骤')
  run.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title} — ${s.status}${s.attempts > 1 ? `（重试 ${s.attempts - 1} 次）` : ''}`)
  })
  lines.push('')
  lines.push('## 产出')
  run.steps.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.title}`)
    lines.push(String(s.answer ?? '').trim() === '' ? '（本步没有产出文本）' : String(s.answer).trim())
    lines.push('')
  })
  lines.push('---')
  lines.push(`> 本报告由自定义流程执行器生成（流程输出规则：落库=${flow.outputRules.land ? '是' : '否'}，类型=${flow.outputRules.kind}）。运行记录见 \`${run.runId}\`。`)
  return lines.join('\n')
}

/**
 * 创建流程引擎。
 *
 * opts = {
 *   stateDir,                 // <profile>/kb-state
 *   core,                     // kbcore 实例（要 status() 与 createEntry()）
 *   delegate,                 // async ({targetId, task, kind, context, parentAgent, signal}) => {answer, subagentId, target, preset}
 *   log,                      // (level, message) => void
 *   targetId,                 // 委派目标 id（默认 knowledge）
 * }
 */
export function createFlowEngine(opts) {
  const stateDir = path.resolve(opts.stateDir)
  const core = opts.core
  const delegate = opts.delegate
  const log = typeof opts.log === 'function' ? opts.log : () => {}
  const targetId = str(opts.targetId) || 'knowledge'
  // 第二轮：解析步骤（capability = parse / parse.ocr / parse.asr）走与工具、设置页同一个解析服务。
  // 没注入就是"未启用"——不静默退回委派，也不假装跑过。
  const parseStep = typeof opts.parseStep === 'function' ? opts.parseStep : null
  const active = new Map() // flowId -> { runId, controller, startedAt }
  const activeByRun = new Map() // runId -> same entry

  const fail = (reason, error, extra) => Object.assign({ ok: false, reason: reason, error: error }, extra ?? {})

  const UNBOUND_TEXT = '未绑定知识库：流程按库身份（kbId）保存，先绑定再管理流程'
  const UNINIT_TEXT = '知识库尚未初始化（没有 kbId）：先运行 kb_init 补齐，再管理流程'

  /** 按未绑定 / 未初始化分别给明确错误（不把两种"没有库"混成一句） */
  const kbFail = (b) => fail(b.reason, b.reason === 'kb-uninitialized' ? UNINIT_TEXT : UNBOUND_TEXT)

  async function boundKb() {
    const st = await core.status()
    if (!st || st.bound !== true || !st.kbPath) return { ok: false, reason: 'unbound', status: st }
    // 有路径但还没有 kbId（未 init）→ 拒绝：否则两个"未初始化"的库会落到同一个 key 上互串
    if (!st.kbId) return { ok: false, reason: 'kb-uninitialized', status: st }
    return { ok: true, kbId: st.kbId, kbPath: st.kbPath, status: st }
  }

  async function readStore(kbId) {
    const p = flowPathsOf(stateDir, kbId)
    const disk = await readJson(p.file)
    if (disk.state === 'ok' && isPlainObject(disk.value)) {
      const value = disk.value
      return {
        ok: true,
        store: {
          schemaVersion: FLOWS_SCHEMA_VERSION,
          kbId: kbId,
          updatedAt: str(value.updatedAt),
          flows: withBuiltinFlows(arr(value.flows).filter(isPlainObject)),
        },
        paths: p,
        state: 'ok',
      }
    }
    if (disk.state === 'corrupt') return { ok: false, reason: 'flows-corrupt', error: 'flows.json 损坏，未改动：' + (disk.error ?? ''), paths: p }
    if (disk.state === 'unreadable') return { ok: false, reason: 'flows-unreadable', error: 'flows.json 不可读：' + (disk.error ?? ''), paths: p }
    return { ok: true, store: { schemaVersion: FLOWS_SCHEMA_VERSION, kbId: kbId, updatedAt: '', flows: withBuiltinFlows([]) }, paths: p, state: 'missing' }
  }

  async function writeStore(kbId, store, paths) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      const prev = await readFile(paths.file, 'utf8')
      await mkdir(paths.backupsDir, { recursive: true })
      await writeFile(path.join(paths.backupsDir, `flows.json.${stamp}.bak`), prev, 'utf8')
      const olds = (await readdir(paths.backupsDir)).filter((n) => n.endsWith('.bak')).sort()
      for (const name of olds.slice(0, Math.max(0, olds.length - BAK_KEEP))) {
        await unlink(path.join(paths.backupsDir, name)).catch(() => {})
      }
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) log('warn', '流程写前备份失败（继续写）：' + String((error && error.message) ?? error))
    }
    const payload = {
      schemaVersion: FLOWS_SCHEMA_VERSION,
      kbId: kbId,
      updatedAt: nowIso(),
      flows: arr(store.flows).filter(f => f.id !== 'builtin-inbox-organize'),
    }
    await atomicWrite(paths.file, JSON.stringify(payload, null, 2))
    return payload
  }

  // ── 运行记录读写 ──
  async function writeRun(kbId, record) {
    const p = flowPathsOf(stateDir, kbId)
    await atomicWrite(path.join(p.runsDir, record.runId + '.json'), JSON.stringify(record, null, 2))
  }

  async function readRun(kbId, runId) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(str(runId))) return null
    const p = flowPathsOf(stateDir, kbId)
    const disk = await readJson(path.join(p.runsDir, str(runId) + '.json'))
    return disk.state === 'ok' && isPlainObject(disk.value) ? disk.value : null
  }

  async function listRuns(kbId, flowId, limit) {
    const p = flowPathsOf(stateDir, kbId)
    let names = []
    try {
      names = (await readdir(p.runsDir)).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    const rows = []
    for (const name of names) {
      const disk = await readJson(path.join(p.runsDir, name))
      if (disk.state !== 'ok' || !isPlainObject(disk.value)) continue
      if (flowId !== undefined && flowId !== null && flowId !== '' && disk.value.flowId !== flowId) continue
      rows.push(summaryOfRun(disk.value))
    }
    rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    return rows.slice(0, Math.max(1, Math.min(Number(limit) > 0 ? Number(limit) : 20, MAX_RUNS_KEPT)))
  }

  function summaryOfRun(run) {
    return {
      runId: run.runId,
      flowId: run.flowId,
      flowName: run.flowName,
      flowRevision: run.flowRevision,
      kbId: run.kbId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      reason: run.reason ?? null,
      error: run.error ?? null,
      landedEntryId: run.landedEntryId ?? null,
      stepDone: arr(run.steps).filter((s) => s.status === 'done').length,
      stepTotal: arr(run.steps).length,
      cached: false,
    }
  }

  async function pruneRuns(kbId) {
    const p = flowPathsOf(stateDir, kbId)
    let names = []
    try {
      names = (await readdir(p.runsDir)).filter((n) => n.endsWith('.json'))
    } catch {
      return { removed: 0 }
    }
    if (names.length <= MAX_RUNS_KEPT) return { removed: 0 }
    const rows = []
    for (const name of names) {
      const disk = await readJson(path.join(p.runsDir, name))
      rows.push({ name: name, at: disk.state === 'ok' ? String(disk.value.startedAt ?? '') : '' })
    }
    rows.sort((a, b) => a.at.localeCompare(b.at))
    let removed = 0
    for (const row of rows.slice(0, rows.length - MAX_RUNS_KEPT)) {
      await unlink(path.join(p.runsDir, row.name)).catch(() => {})
      removed += 1
    }
    return { removed: removed }
  }

  // ── 对外：定义 CRUD ──
  async function list(input) {
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)
    const includeArchived = input !== undefined && input !== null && input.includeArchived === true
    const runsByFlow = new Map()
    const runs = await listRuns(b.kbId, '', MAX_RUNS_KEPT)
    for (const run of runs) if (!runsByFlow.has(run.flowId)) runsByFlow.set(run.flowId, run)
    const flows = r.store.flows
      .filter((f) => includeArchived || f.archived !== true)
      .map((f) => ({
        id: f.id,
        builtin: f.builtin === true,
        name: f.name,
        triggers: arr(f.triggers),
        description: f.description,
        enabled: f.enabled !== false,
        archived: f.archived === true,
        revision: f.revision,
        stepCount: arr(f.steps).length,
        updatedAt: f.updatedAt,
        lastRun: runsByFlow.get(f.id) ?? null,
      }))
    return {
      ok: true,
      kbId: b.kbId,
      kbPath: b.kbPath,
      schemaVersion: FLOWS_SCHEMA_VERSION,
      count: flows.length,
      includeArchived: includeArchived,
      flows: flows,
      activeRuns: Array.from(active.keys()),
    }
  }

  async function get(id) {
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)
    const flow = r.store.flows.find((f) => f.id === str(id))
    if (!flow) return fail('not-found', '没有这个流程：' + str(id), { kbId: b.kbId })
    return { ok: true, kbId: b.kbId, flow: flow }
  }

  // 页面运行只准备一条完整提示词；执行和实时事件交给普通知识库会话。
  // 不调用 start/run，不创建后台运行记录，也不启动委派或落库。
  async function prepareConversation(input = {}) {
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    if (input.kbId !== b.kbId) return fail('kb-changed', '绑定的知识库已变化，请刷新流程页面后再运行')
    const found = await get(input.id)
    if (!found.ok) return found
    if (found.kbId !== b.kbId) return fail('kb-changed', '绑定的知识库已变化，请刷新后重试')
    const flow = found.flow
    if (flow.archived === true) return fail('archived', '该流程已归档：恢复后才能运行')
    if (flow.enabled === false) return fail('disabled', '该流程已停用：启用后才能运行')
    if (flow.revision !== input.expectedRevision) return fail('flow-changed', '流程定义已变化，请刷新页面后再运行')
    const execution = flow.builtin ? (input.execution?.provider && input.execution?.model ? { provider: input.execution.provider, model: input.execution.model, reasoningEffort: 'high' } : {}) : input.execution === undefined ? (flow.execution || {}) : input.execution
    const executionErrors = validateFlow({ ...flow, execution })
    if (executionErrors.length) return fail('invalid-flow', executionErrors.join('；'))
    const running = active.get(flow.id)
    if (running) return fail('flow-busy', '该流程仍有后台任务运行，请等待结束或先取消（' + running.runId + '）')
    const resolved = resolveParams(flow, input.params)
    if (!resolved.ok) return fail('missing-param', '缺少必填参数：' + resolved.missing.join('、'))
    const route = Object.fromEntries(['provider', 'model', 'reasoningEffort'].filter(key => str(execution?.[key])).map(key => [key, str(execution[key])]))
    // The knowledge Agent and plugin own the operating rules. This button only
    // supplies the user's task, without the generic custom-flow prompt wrapper.
    if (flow.builtin) return { ok: true, kbId: b.kbId, kbPath: b.kbPath, cwd: b.kbPath, flowId: flow.id, flowRevision: flow.revision, execution: route, requiredReasoningEffort: 'high', prompt: flow.steps[0].instruction }
    const rules = flow.outputRules
    const windowDays = Number(rules.windowDays) || 7
    const tz = rules.tz || 'Asia/Shanghai'
    const end = Date.now()
    const lines = [
      `请在本会话中直接执行知识库流程「${flow.name}」（${flow.id}，定义版本 v${flow.revision}）。`,
      `知识库身份：${b.kbId}`,
      `用途：${flow.description || '按以下步骤完成任务'}`,
      '先用 kb_status 核对当前绑定的 kbId；与上述身份不一致时停止并说明原因。',
      '执行前核对已有产出和未结束的同名任务，避免重复写入或重复外发。',
      '按顺序在本会话中执行以下全部步骤。开始每一步时说明步骤序号和当前动作，完成后展示实际结果；工具调用和输出留在本会话中。',
      '不要调用 kb_flow 的 run，也不要把整个流程再次交给后台流程引擎或子代理。遇到错误、缺少参数或需确认的操作时，在本会话说明并等待处理；不得假报成功或自动重试有副作用的动作。',
      '【本次参数】',
      JSON.stringify(resolved.values, null, 2),
      `【默认时间窗】${fmtInTz(new Date(end - windowDays * 86400_000).toISOString(), tz)} → ${fmtInTz(new Date(end).toISOString(), tz)}（${tz}，最近 ${windowDays} 天；步骤中另有明确时间要求时按该要求执行）`,
      '【依次执行】',
    ]
    flow.steps.forEach((step, index) => {
      lines.push(`第 ${index + 1}/${flow.steps.length} 步：${step.title}`)
      if (step.capability) lines.push(`步骤能力：${step.capability}`)
      lines.push(step.instruction, '')
    })
    lines.push('【输出规则】', JSON.stringify(rules, null, 2))
    lines.push(flow.builtin ? '请按步骤实际创建或更新归档知识条目，保留来源和原件；整理汇总保留在本会话，不额外创建一份汇总条目。'
      : rules.land === true
      ? '只有全部步骤成功后，才按上述输出规则通过知识库条目工具写入最终成果；失败、取消或等待确认时不写成功报告。完成后给出条目位置和实际产出。'
      : '最终成果保留在本会话，不额外创建知识库条目。')
    return { ok: true, kbId: b.kbId, kbPath: b.kbPath, cwd: b.kbPath, flowId: flow.id, flowRevision: flow.revision, execution: route, requiredReasoningEffort: flow.builtin ? 'high' : undefined, prompt: lines.join('\n') }
  }

  /**
   * 新建或更新。更新必须带 expectedRevision（数字）。
   * conflict 时**不写盘**，并返回当前 revision 与差异摘要。
   */
  async function save(input) {
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)
    const payload = isPlainObject(input) && isPlainObject(input.flow) ? input.flow : isPlainObject(input) ? input : null
    if (payload === null) return fail('bad-flow', 'save 需要 flow 对象')
    const errors = validateFlow(payload)
    if (errors.length > 0) return fail('invalid-flow', '流程定义不合法：' + errors.join('；'), { errors: errors })
    const wantId = str(payload.id)
    if (wantId === 'builtin-inbox-organize') return fail('builtin-flow', '内置整理流程不可修改或删除')
    const exist = wantId === '' ? null : r.store.flows.find((f) => f.id === wantId) ?? null
    const expected = input !== null && input !== undefined && input.expectedRevision !== undefined && input.expectedRevision !== null
      ? Number(input.expectedRevision)
      : (payload.expectedRevision !== undefined && payload.expectedRevision !== null ? Number(payload.expectedRevision) : null)

    if (exist !== null) {
      if (!Number.isFinite(expected)) return fail('revision-required', '更新流程必须带 expectedRevision（先 list/get 取当前 revision）', { currentRevision: exist.revision })
      if (Number(exist.revision) !== Number(expected)) {
        return fail('conflict', `版本不符（期望 ${expected}，当前 ${exist.revision}）：为避免覆盖别人刚改的定义，本次未写盘`, {
          currentRevision: exist.revision,
          conflict: true,
          current: { id: exist.id, name: exist.name, revision: exist.revision, updatedAt: exist.updatedAt },
        })
      }
    } else if (wantId !== '' && (input.createIfMissing !== true)) {
      return fail('not-found', '没有这个流程：' + wantId + '（新建请省略 id）')
    }

    const merged = Object.assign({}, exist || {}, payload, {
      outputRules: Object.assign({}, exist ? exist.outputRules : {}, payload.outputRules || {}),
      id: exist !== null ? exist.id : wantId,
      revision: exist !== null ? Number(exist.revision) + 1 : 1,
      createdAt: exist !== null ? exist.createdAt : undefined,
      // Archive/restore has a separate endpoint; an edit must not restore a flow.
      archived: exist !== null ? exist.archived === true : payload.archived === true,
    })
    const flow = normalizeFlow(merged)
    if (flow.archived) flow.enabled = false
    if (exist && Object.hasOwn(exist, 'enabledBeforeArchive')) flow.enabledBeforeArchive = exist.enabledBeforeArchive
    const next = exist !== null
      ? r.store.flows.map((f) => (f.id === flow.id ? flow : f))
      : r.store.flows.concat([flow])
    await writeStore(b.kbId, { flows: next }, r.paths)
    log('info', `流程${exist !== null ? '更新' : '新建'} ${flow.id}「${flow.name}」→ v${flow.revision}`)
    return { ok: true, kbId: b.kbId, flow: flow, created: exist === null, revision: flow.revision }
  }

  async function setEnabled(id, enabled) {
    if (str(id) === 'builtin-inbox-organize') return fail('builtin-flow', '内置整理流程保持可用')
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)
    const flow = r.store.flows.find((f) => f.id === str(id))
    if (!flow) return fail('not-found', '没有这个流程：' + str(id))
    if (flow.archived === true) return fail('archived', '该流程已归档：请先恢复，再启用或停用')
    const next = Object.assign({}, flow, { enabled: enabled === true, revision: Number(flow.revision) + 1, updatedAt: nowIso() })
    await writeStore(b.kbId, { flows: r.store.flows.map((f) => (f.id === next.id ? next : f)) }, r.paths)
    return { ok: true, kbId: b.kbId, id: next.id, enabled: next.enabled, revision: next.revision }
  }

  /** 软删除：archived=true。定义与运行记录都留着，可恢复；从可触发列表移除。 */
  async function archive(id, restored) {
    if (str(id) === 'builtin-inbox-organize') return fail('builtin-flow', '内置整理流程不可删除')
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)
    const flow = r.store.flows.find((f) => f.id === str(id))
    if (!flow) return fail('not-found', '没有这个流程：' + str(id))
    // 归档时把"原本是否启用"记下来，恢复时原样还回去（否则恢复后仍是停用，等于恢复了个不可用的流程）
    const enabledBefore = flow.archived === true ? (flow.enabledBeforeArchive !== false) : (flow.enabled !== false)
    const next = Object.assign({}, flow, {
      archived: restored === true ? false : true,
      enabled: restored === true ? enabledBefore : false,
      enabledBeforeArchive: enabledBefore,
      revision: Number(flow.revision) + 1,
      updatedAt: nowIso(),
    })
    await writeStore(b.kbId, { flows: r.store.flows.map((f) => (f.id === next.id ? next : f)) }, r.paths)
    return { ok: true, kbId: b.kbId, id: next.id, archived: next.archived, restored: restored === true, revision: next.revision }
  }

  async function resolve(text) {
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)
    const res = matchTriggers(r.store.flows, text)
    return Object.assign({ ok: true, kbId: b.kbId }, res)
  }

  // ── 对外：运行 ──
  function makeRun(flow, runId, kbId, params, window) {
    return {
      schemaVersion: FLOWS_SCHEMA_VERSION,
      runId: runId,
      flowId: flow.id,
      flowName: flow.name,
      flowRevision: Number(flow.revision),
      kbId: kbId,
      target: targetId,
      params: params,
      window: window,
      status: 'running',
      startedAt: nowIso(),
      finishedAt: null,
      steps: arr(flow.steps).map((s) => ({
        id: s.id,
        title: s.title,
        capability: s.capability ?? null,
        retryable: !isSideEffectStep(s),
        status: 'pending',
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        answer: '',
        error: null,
        subagentId: null,
      })),
      retryableSteps: arr(flow.steps).filter((s) => !isSideEffectStep(s)).map((s) => s.id),
      sideEffectSteps: arr(flow.steps).filter((s) => isSideEffectStep(s)).map((s) => s.id),
      landedEntryId: null,
      landedRevision: null,
      reason: null,
      error: null,
      cancelRequestedAt: null,
    }
  }

  async function runOnce(flow, runId, b, paramsIn, parentAgent, signal, entry) {
    const resolved = resolveParams(flow, paramsIn)
    if (!resolved.ok) {
      const rec = {
        schemaVersion: FLOWS_SCHEMA_VERSION,
        runId: runId,
        flowId: flow.id,
        flowName: flow.name,
        flowRevision: Number(flow.revision),
        kbId: b.kbId,
        target: targetId,
        params: resolved.values,
        window: null,
        status: 'failed',
        startedAt: nowIso(),
        finishedAt: nowIso(),
        steps: [],
        retryableSteps: [],
        sideEffectSteps: [],
        landedEntryId: null,
        reason: 'missing-param',
        error: '缺少必填参数：' + resolved.missing.join('、'),
        cancelRequestedAt: null,
      }
      await writeRun(b.kbId, rec)
      entry.persisted()
      return rec
    }
    const windowDays = Number(flow.outputRules.windowDays) || 7
    const tz = flow.outputRules.tz || 'Asia/Shanghai'
    const startedAt = nowIso()
    const window = {
      startAt: fmtInTz(new Date(Date.now() - windowDays * 86400_000).toISOString(), tz),
      endAt: fmtInTz(new Date().toISOString(), tz),
      tz: tz,
      windowDays: windowDays,
    }
    const rec = makeRun(flow, runId, b.kbId, resolved.values, window)
    rec.startedAt = startedAt
    entry.startedAt = startedAt
    const recordCancellation = () => { rec.cancelRequestedAt ??= nowIso() }
    entry.controller.signal.addEventListener('abort', recordCancellation, { once: true })
    if (entry.controller.signal.aborted) recordCancellation()
    const onAbort = () => entry.controller.abort()
    if (signal !== undefined && signal !== null) {
      if (signal.aborted) entry.controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    active.set(flow.id, entry)
    activeByRun.set(runId, entry)
    const prior = []
    let canceled = false
    let failure = null
    try {
      await writeRun(b.kbId, rec)
      entry.persisted()
      for (let i = 0; i < flow.steps.length; i += 1) {
        const step = flow.steps[i]
        const slot = rec.steps[i]
        if (entry.controller.signal.aborted) {
          canceled = true
          slot.status = 'skipped'
          break
        }
        slot.status = 'running'
        slot.startedAt = nowIso()
        await writeRun(b.kbId, rec)
        const task = buildStepTask(flow, rec, step, i, prior)
        let attempt = 0
        const maxAttempts = slot.retryable ? 2 : 1
        let lastError = null
        while (attempt < maxAttempts) {
          attempt += 1
          slot.attempts = attempt
          try {
            const currentBinding = await boundKb()
            if (!currentBinding.ok || currentBinding.kbId !== b.kbId || path.resolve(currentBinding.kbPath) !== path.resolve(b.kbPath)) {
              throw Object.assign(new Error('流程运行中知识库绑定已改变，停止执行'), { code: 'FLOW_BINDING_CHANGED' })
            }
            const capNow = String(step.capability ?? '').trim().toLowerCase()
            if (capNow === 'parse' || capNow === 'parse.ocr' || capNow === 'parse.asr') {
              if (parseStep === null) {
                throw Object.assign(new Error('解析能力未启用：本插件没有接入解析服务（先安装含解析服务的版本）'), { code: 'PARSE_NOT_ENABLED' })
              }
              const parsed = await parseStep({
                kind: capNow === 'parse.asr' ? 'asr' : capNow === 'parse.ocr' ? 'ocr' : null,
                flow: flow,
                run: rec,
                step: step,
                index: i,
                params: resolved.values,
                signal: entry.controller.signal,
              })
              if (!parsed || parsed.ok !== true) {
                throw new Error('解析步骤失败：' + String((parsed && (parsed.detail || parsed.reason)) || '未给出原因'))
              }
              slot.answer = str(parsed.answer)
              slot.parseJobId = parsed.jobId ?? null
              slot.parseStatus = parsed.status ?? null
              slot.subagentId = null
              slot.status = 'done'
              slot.error = null
              lastError = null
              break
            }
            const delegated = await delegate({
              targetId: targetId,
              task: task,
              kind: isSideEffectStep(step) ? 'write' : 'read',
              context: `流程「${flow.name}」第 ${i + 1}/${flow.steps.length} 步。运行 ${runId}，定义版本 v${flow.revision}。`,
              parentAgent: parentAgent ?? null,
              execution: flow.execution || {},
              signal: entry.controller.signal,
              label: 'kb_flow',
            })
            entry.controller.signal.throwIfAborted()
            if (delegated?.ok === false || (delegated?.status && delegated.status !== 'completed' && delegated.status !== 'done')) {
              throw new Error('委派返回失败状态，未接受为步骤产出')
            }
            const answer = str(delegated && delegated.answer)
            if (answer === '') throw new Error('子代理没有产出文本（可能整轮失败，见 outbox 台账）')
            slot.answer = answer
            slot.subagentId = delegated && delegated.subagentId ? String(delegated.subagentId) : null
            slot.status = 'done'
            slot.error = null
            lastError = null
            break
          } catch (error) {
            lastError = String((error && error.message) ?? error)
            if (entry.controller.signal.aborted || error?.code === 'FLOW_BINDING_CHANGED') break
            if (attempt >= maxAttempts) break
            slot.error = lastError
            log('warn', `流程 ${flow.id} 第 ${i + 1} 步失败，准备重试（该步无副作用）：${lastError}`)
          }
        }
        slot.finishedAt = nowIso()
        if (slot.status !== 'done') {
          if (entry.controller.signal.aborted) {
            canceled = true
            slot.status = 'skipped'
          } else {
            slot.status = 'failed'
            slot.error = lastError
            failure = { step: i + 1, error: lastError }
            failure.sideEffect = !slot.retryable
          }
          await writeRun(b.kbId, rec)
          break
        }
        prior.push({ index: i, title: step.title, answer: slot.answer })
        await writeRun(b.kbId, rec)
      }

      if (entry.controller.signal.aborted) canceled = true
      if (canceled) {
        rec.status = 'canceled'
        rec.reason = 'canceled'
        rec.error = '用户取消：未完成步骤已停止，未落库'
      } else if (failure !== null) {
        rec.status = 'failed'
        rec.reason = failure.sideEffect ? 'step-failed-side-effect' : 'step-failed'
        rec.error = `第 ${failure.step} 步失败：${failure.error}${failure.sideEffect ? '（该步有副作用，未自动重试）' : ''}`
      } else {
        // 全部步骤成功 → 按 outputRules 走**现有 core** 落库（不绕过隐私/路径/revision 保护）
        if (flow.outputRules.land === true) {
          const currentBinding = await boundKb()
          if (!currentBinding.ok || currentBinding.kbId !== b.kbId || path.resolve(currentBinding.kbPath) !== path.resolve(b.kbPath)) {
            throw new Error('落库前知识库绑定已改变，报告未写入其他库')
          }
          entry.controller.signal.throwIfAborted()
          entry.committing = true
          // 报告标题的日期按**定义里的时区**取（本地 03:29 时 UTC 还是前一天，实测会差一天）
          const dayLocal = fmtInTz(nowIso(), flow.outputRules.tz || 'Asia/Shanghai').slice(0, 10)
          if (rec.finishedAt === null || rec.finishedAt === '') rec.finishedAt = nowIso()
          const landed = await core.createEntry({
            kind: flow.outputRules.kind,
            title: `${flow.name} 运行报告 ${dayLocal}`,
            content: buildReport(flow, rec),
            tags: arr(flow.outputRules.tags),
            tz: flow.outputRules.tz || 'Asia/Shanghai',
            status: flow.outputRules.status || '生效',
            requestId: 'flow-run-' + runId,
            expectedBinding: { kbId: b.kbId, kbPath: b.kbPath, revision: b.status?.config?.revision ?? null },
            signal: entry.controller.signal,
          })
          if (landed && landed.ok === true) {
            rec.status = 'landed'
            rec.landedEntryId = landed.entryId ?? null
            rec.landedRevision = landed.revision ?? null
            rec.landedPath = landed.path ?? null
            rec.landedPartial = landed.partial === true || landed.indexSynced === false
          } else {
            rec.status = 'failed'
            rec.reason = 'land-failed'
            rec.error = '步骤都跑完了，但落库失败（不算成功）：' + String((landed && (landed.detail || landed.reason)) ?? '未知原因')
          }
        } else {
          rec.status = 'done'
          rec.reason = 'not-landed-by-rule'
        }
      }
    } catch (error) {
      rec.status = entry.controller.signal.aborted ? 'canceled' : 'failed'
      rec.reason = rec.status === 'canceled' ? 'canceled' : 'runner-error'
      rec.error = String((error && error.message) ?? error)
    } finally {
      entry.persisted()
      signal?.removeEventListener('abort', onAbort)
      entry.controller.signal.removeEventListener('abort', recordCancellation)
      rec.finishedAt = nowIso()
      active.delete(flow.id)
      activeByRun.delete(runId)
      await writeRun(b.kbId, rec)
      await pruneRuns(b.kbId).catch(() => null)
      log('info', `流程运行 ${runId}（${flow.name} v${flow.revision}）结束：${rec.status}`)
    }
    return rec
  }

  /**
   * 启动一次运行。返回**立即**（后台跑），便于界面轮询进度与取消。
   *   · 同一 runId 再次调用 → 直接返回既有记录（deduplicated:true），不会重复执行
   *   · 同一流程已有运行未结束 → 拒绝第二个并说明（不排队、不静默覆盖）
   */
  async function start(input) {
    return serialized(stateDir, () => startLocked(input))
  }

  async function startLocked(input) {
    const req = isPlainObject(input) ? input : {}
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    if (typeof delegate !== 'function') return fail('no-delegate', '委派能力不可用（gateway 未就绪）')
    const r = await readStore(b.kbId)
    if (!r.ok) return fail(r.reason, r.error)

    let flow = null
    if (str(req.id) !== '') flow = r.store.flows.find((f) => f.id === str(req.id)) ?? null
    if (flow === null && str(req.text) !== '') {
      const res = matchTriggers(r.store.flows, req.text)
      if (res.status === 'ambiguous') {
        return fail('ambiguous', '这句话同时命中多个流程，请选一个再运行', { candidates: res.matched })
      }
      if (res.status === 'miss') return fail('no-match', '没有启用中的流程匹配这句话')
      if (res.guarded === true) return fail('guarded-mention', '这更像"提到"而不是"要求执行"：' + res.guardReasons.join('；'), { candidates: res.matched })
      flow = r.store.flows.find((f) => f.id === res.matched[0].flowId) ?? null
    }
    if (flow === null) return fail('not-found', '找不到要运行的流程（给 id 或能命中触发语的一句话）')
    if (flow.builtin) return fail('conversation-required', '内置整理流程请从收件箱或流程页面新开知识库会话运行（High）')
    if (flow.archived === true) return fail('archived', '该流程已归档（删除是软删除）：恢复后才能运行')
    if (flow.enabled === false) return fail('disabled', '该流程已停用：启用后才能运行')

    const runId = /^[A-Za-z0-9._-]{1,80}$/.test(str(req.runId))
      ? str(req.runId)
      : 'run-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex')

    const existing = await readRun(b.kbId, runId)
    if (existing !== null) {
      const expectedParams = resolveParams(flow, req.params).values
      const canonical = value => JSON.stringify(Object.keys(value ?? {}).sort().map(key => [key, String(value[key])]))
      if (existing.flowId !== flow.id || (req.params !== undefined && canonical(existing.params) !== canonical(expectedParams))) {
        return fail('run-payload-mismatch', '同一 runId 的流程或参数与已有请求不同，未重复执行')
      }
      return { ok: true, deduplicated: true, kbId: b.kbId, runId: runId, run: existing, note: '同一 runId 已有记录：直接返回它，不重复执行（防双击/重试重复）' }
    }
    const runningEntry = active.get(flow.id)
    if (runningEntry !== undefined) {
      return fail('flow-busy', '该流程已有一个运行未结束（runId=' + runningEntry.runId + '）：同一流程不允许并发，请等它结束或先取消', { runningRunId: runningEntry.runId })
    }

    const resolved = resolveParams(flow, req.params)
    if (!resolved.ok) return fail('missing-param', '缺少必填参数：' + resolved.missing.join('、'))
    let persisted
    const initialRecordWritten = new Promise(resolve => { persisted = resolve })
    const entry = { runId, controller: new AbortController(), startedAt: nowIso(), persisted, committing: false }
    active.set(flow.id, entry)
    activeByRun.set(runId, entry)
    const promise = runOnce(flow, runId, b, req.params, req.parentAgent ?? null, req.signal ?? null, entry)
    promise.then(persisted, persisted)
    promise.catch((error) => log('error', '流程运行异常：' + String((error && error.stack) ?? error)))
    await initialRecordWritten
    // 先把"运行中"的记录交给调用方（runOnce 内部会立即写盘一次）
    const pending = {
      runId: runId,
      flowId: flow.id,
      flowName: flow.name,
      flowRevision: flow.revision,
      kbId: b.kbId,
      status: 'running',
      startedAt: nowIso(),
      steps: arr(flow.steps).map((s, i) => ({ id: s.id, title: s.title, status: i === 0 ? 'running' : 'pending' })),
      promise: promise,
    }
    return { ok: true, deduplicated: false, kbId: b.kbId, runId: runId, run: pending }
  }

  /** 等待式运行（工具调用用；界面用 start + 轮询）。 */
  async function run(input) {
    const started = await start(input)
    if (started.ok !== true) return started
    if (started.deduplicated === true) return { ok: true, deduplicated: true, runId: started.runId, run: started.run }
    // 注意：Promise 的 typeof 是 'object'，必须判 then，不能判 function（首版就栽在这）
    const pendingPromise = started.run !== undefined && started.run !== null && started.run.promise !== undefined && typeof started.run.promise.then === 'function'
      ? started.run.promise
      : null
    if (pendingPromise === null) return started
    const final = await pendingPromise
    return { ok: final.status === 'done' || final.status === 'landed', runId: final.runId, run: final, status: final.status, reason: final.reason, error: final.error }
  }

  async function runs(input) {
    const req = isPlainObject(input) ? input : {}
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    if (str(req.runId) !== '') {
      const one = await readRun(b.kbId, req.runId)
      if (one === null) return fail('not-found', '没有这个运行记录：' + str(req.runId))
      return { ok: true, kbId: b.kbId, run: one }
    }
    const rows = await listRuns(b.kbId, str(req.flowId), Number(req.limit) || 20)
    return { ok: true, kbId: b.kbId, count: rows.length, runs: rows }
  }

  /** 取消：真的 abort（不是隐藏 UI），并把记录标成 canceled —— 之后绝不会变成成功。 */
  async function cancel(runId) {
    const b = await boundKb()
    if (!b.ok) return kbFail(b)
    const id = str(runId)
    const entry = activeByRun.get(id)
    if (entry !== undefined) {
      if (entry.committing) return fail('commit-in-progress', '报告已进入原子落库阶段，不能承诺撤销；请等待最终结果')
      entry.controller.abort()
      return { ok: true, kbId: b.kbId, runId: id, canceling: true, note: '已发出取消：正在跑的这一步会被中断，之后的步骤不再开始' }
    }
    const rec = await readRun(b.kbId, id)
    if (rec === null) return fail('not-found', '没有这个运行记录：' + id)
    if (['done', 'landed', 'failed', 'canceled'].includes(rec.status)) {
      return fail('not-running', `该运行已结束（status=${rec.status}）：没有可取消的东西`, { run: summaryOfRun(rec) })
    }
    rec.status = 'canceled'
    rec.cancelRequestedAt ??= nowIso()
    rec.reason = 'canceled-implicit'
    rec.error = '进程内没有这次的执行上下文（可能插件已重启）：已标记为取消，不会继续'
    rec.finishedAt = nowIso()
    await writeRun(b.kbId, rec)
    return { ok: true, kbId: b.kbId, runId: id, canceling: false, run: summaryOfRun(rec) }
  }

  return {
    list: list,
    get: get,
    prepareConversation,
    save: input => serialized(stateDir, () => save(input)),
    setEnabled: (id, enabled) => serialized(stateDir, () => setEnabled(id, enabled)),
    archive: (id, restored) => serialized(stateDir, () => archive(id, restored)),
    resolve: resolve,
    start: start,
    run: run,
    runs: runs,
    cancel: cancel,
    activeRuns: () => Array.from(active.entries()).map(([flowId, entry]) => ({ flowId: flowId, runId: entry.runId, startedAt: entry.startedAt })),
    _internal: { boundKb: boundKb, readStore: readStore, matchTriggers: matchTriggers },
  }
}
