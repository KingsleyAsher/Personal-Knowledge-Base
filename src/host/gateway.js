// 由 @local/dsh-agent-gateway 0.2.0 合并而来（2026-10-18）。
// 零 @deepseek-ai 依赖（只用 node 内置），由 kb-core 的 apply() 调用。
// 工具名保持不变：agent_call / knowledge_request（旧入口兼容）。
// agent-gateway — 让**任意一个 agent 会话**把任务委托给**任意一个 agent 预设**的子代理，
// 并在同一次调用里把「调用方才掌握的背景」一并交过去。
//
// 前身是 knowledge-gateway（只认知识库）。改成通用件的原因（主人 2026-10-15 要求）：
//   ① 「把这活儿交给另一个 agent」这件事本身与具体是哪一对 agent 无关；
//   ② 调用方常掌握着子代理拿不到的背景（例：只有知识库 agent 知道的情感经历），
//      必须由调用方在派活时直接带进去 —— 交接文件传递不了这一层。
//
// ── 为什么必须这样实现（三条硬事实，来自 knowledge-gateway 的实测）───────────
// 1. **子代理默认继承调用方的预设**（child-agent.js 的 composeFrom(childCtx, parent.ctx)
//    = "join the SAME standing composition"），委派请求里根本没有 preset 字段。
//    要让子代理跑在另一份预设下，只能在**创建窗口**里自己做：
//    agents.create({ meta: { agentPreset, cwd }, setup: async c => await agentPresets.mount(c, id) })
// 2. **必须继承模型路由**（agentOptions 从调用方 parent.options 拷 provider/model/reasoningEffort/maxTokens）。
//    否则目标预设人设模板里的 {{model}} 无值 → turn 直接 error，连模型请求都不发。
// 3. **事件读取有版本差异**：0.1.5 用 session.snapshotEvents(boundary)，旧宿主用 session.events.slice()；
//    本插件两者都兼容。另：直接创建的子代理没有 subagent/descriptor 事件，会在 list_agents 里
//    被折成 [diagnostic: corrupt] —— 本插件在 setup 里补写一条。
//
// ── 2026-10-18 抽出可复用内核 ────────────────────────────────────────────────
// 自定义流程执行器（flows.js）必须走**同一条**委派路径，否则 agent_call 与流程会各漂一套。
// 因此把 delegate 的执行体抽成 `runDelegation(env, ...)` 并导出 `createDelegate(ctx, cfg)`：
//   · apply() 仍然注册同样两个工具、参数与输出渲染逐字不变；
//   · 流程执行器拿自己的 createDelegate 实例（独立计数与上限），调用同一个内核。
// 没有调用方 agent 的场合（界面点「立即运行」）走**根级子代理**分支：
//   agents.create 的 parentAgent 是可选参数（dsh-agent 的注释：optional live parent），
//   该分支与父级分支的差别只在「不登记父会话 catalog / 不做深度累加」，其余一致。
//
// ── 服务获取：用 ctx.get，不要用 ctx.inject ──────────────────────────────────
// inject 是「等全部依赖就绪才回调」，任何一个服务在该层不可见，回调就永不触发，
// 表现为**插件静默无效果**（2026-09-20 实测：构图里有这一行，工具与守卫都没出现且不报错）。
// ctx.get 是即时读取：拿不到就当场报错，行为可观测。
//
// 本文件刻意**不 import 任何 @deepseek-ai/* 包**：只用 ctx 服务，因此同一份代码
// 在 0.1.5 与旧 0.1.1 两套宿主上都能跑（差异只有 descriptorVersion 一个配置项）。

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'kb-gateway'

// ── 实时 knowledge 授权台账（第二轮定向修复 2026-10-18）─────────────────────
// 为什么需要它：`kb_parse` 是新的受信入口，判"调用方是不是知识库身份"不能靠会话头里的
// `agentPreset === 'knowledge'` —— 那只是字符串。H1 的授权是**活对象身份**
// （authority 内部的 WeakSet + `agents.get(id) === agent` + revoke 标记），而 H1 服务
// 只对外暴露 grant/prepare/revoke，没有 isKnowledge。本台账在**授予的那一刻**记下来、
// 在**撤销的那一刻**划掉，于是别的模块可以据此判定"此刻仍然有效"。
// 它不是另一套授权：写入点只有下面两个，与 H1 的 grant/revoke 逐次同源。
const liveKnowledgeGrants = new WeakSet()
const revokedKnowledgeGrants = new WeakSet()

/** 授予成功后调用（与 h1Isolation.grantKnowledge/prepareKnowledge 同一处）。 */
export function noteKnowledgeGrant(agent) {
  if (agent === null || typeof agent !== 'object') return
  liveKnowledgeGrants.add(agent)
  revokedKnowledgeGrants.delete(agent)
}

/** 撤权后调用（与 h1Isolation.revoke 同一处；agent/disposed 也会走到这里）。 */
export function noteKnowledgeRevoke(agent) {
  if (agent === null || typeof agent !== 'object') return
  revokedKnowledgeGrants.add(agent)
}

/**
 * 此刻是否仍是**活着的知识库身份**：本台账里有授予、没被撤销，且宿主注册表里
 * 仍然是同一个对象（`agents.get(id) === agent` —— 与 H1 的 live() 判据一致）。
 * 只给宿主侧闸门用；不是工具、不是 HTTP 端点。
 */
export function isLiveKnowledgeGrant(agent, agentsService) {
  if (agent === null || typeof agent !== 'object' || agent.id === undefined) return false
  if (!liveKnowledgeGrants.has(agent) || revokedKnowledgeGrants.has(agent)) return false
  if (!agentsService || typeof agentsService.get !== 'function') return false
  return agentsService.get(agent.id) === agent
}

const DEFAULTS = {
  callerTool: 'agent_call',
  knowledgeTool: 'knowledge_request',
  // 2026-10-18：不再把开发机上的绝对路径写进包里（审查意见 F3 的可分发性要求）。
  // kbCwd 为空 = 不启用路径守卫（守卫默认关）；旧字段兼容分支回退到进程工作目录。
  kbCwd: '',
  kbPreset: 'knowledge',
  maxDepth: 3,
  maxCalls: 5,
  descriptorVersion: 3,
}

/**
 * 给子代理铸一个不会撞车的会话 id。
 *
 * 不要用 sessions.prepare()：它的自增计数只认内存 store，**不知道磁盘上已持久化的会话**
 * （2026-09-20 实测：上个进程留下的 session-1…session-8 还在，新进程又铸出 session-1
 *  → 工厂报 `session "session-1" already exists`）。原生子代理 driver 也自己造 UUID，
 * 此处跟随，只加宿主用的 `session-` 前缀。
 */
function mintSessionId() {
  return 'session-' + randomUUID()
}

/**
 * 委派台账（outbox）：把「这次派了谁、任务是什么、它最后带回了什么」写成本机一个小文件。
 *
 * 为什么需要它：**工具结果只有在调用方回合正常结束时才会被收下。**
 * 2026-10-15 实测：子代理 00:52:34 跑完并写出了完整回报，同一秒调用方回合被 stop 掐掉
 * → 工具结果变成了「Error: tool call aborted」，那份回报就此蒸发（文件是写出来了，
 * 但调用方与主人都不知道）。台账与回合是否被掐无关，专门兜这种「结果丢了」的场合。
 *
 * 落点：`$DSH_HOME/agent-gateway/outbox/<子代理会话 id>.json`（默认 `~/.dsh/...`）。
 * 写失败只记一行日志，绝不影响委派本身。
 */
function outboxTarget(childId) {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const dir = join(home, 'agent-gateway', 'outbox')
  return { dir: dir, file: join(dir, String(childId) + '.json') }
}

function writeOutbox(childId, payload) {
  try {
    const target = outboxTarget(childId)
    mkdirSync(target.dir, { recursive: true })
    writeFileSync(target.file, JSON.stringify(payload, null, 2), 'utf8')
    return target.file
  } catch (error) {
    console.error('[agent-gateway] outbox 写入失败：' + String(error))
    return ''
  }
}

/**
 * 只有「路径类字段」里的字符串才算「可能访问知识库」。
 * 早期版本扫描参数里的**所有**字符串，结果把「正文里提到知识库路径」也当成访问 ——
 * 连改这个插件自己都会被自己的守卫拦下。现在按字段名收窄。
 */
const PATH_KEY = /(^|_)(path|paths|file|files|dir|directory|cwd|target|command|script|pattern)($|_)/i

function collectPathLike(value, out, keyHint, depth) {
  if (out.length >= 400 || depth > 6) return
  if (typeof value === 'string') {
    if (keyHint !== '' && PATH_KEY.test(keyHint)) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathLike(item, out, keyHint, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) collectPathLike(value[key], out, key, depth + 1)
  }
}

/** 路径归一化：统一分隔符、折叠重复、小写 —— 只为「是否提到知识库」这种粗判。 */
function normalizePath(value) {
  return String(value).replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase()
}

function toArray(events) {
  return Array.isArray(events) ? events : Array.from(events)
}

/** 取一次会话事件快照：0.1.5 用 snapshotEvents()，旧宿主用 events.slice()。 */
function readEvents(session, boundary) {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents(boundary)
  const raw = session.events
  if (raw === undefined) return []
  return typeof raw.slice === 'function' ? raw.slice(boundary) : Array.from(raw)
}

/**
 * 折叠子代理的回报：只取**最后一次工具结果之后**的 assistant 文本（那才是收尾汇报，
 * 不会把「我先读一下…」这类过程叙述混进来）；没有最终文本则由调用方报失败。
 * 同时带回现场诊断，供失败时定位。
 */
function foldAnswer(events) {
  const list = toArray(events)
  const texts = []
  const order = []
  const counts = {}
  let lastToolResult = -1
  let toolCalls = 0
  let turnEnd = ''

  for (let index = 0; index < list.length; index += 1) {
    const ev = list[index]
    const type = ev === null || ev === undefined ? 'null' : String(ev.type)
    if (counts[type] === undefined) {
      counts[type] = 1
      order.push(type)
    } else {
      counts[type] += 1
    }
    if (type === 'tool/call') toolCalls += 1
    if (type === 'tool/result') lastToolResult = index
    if (type === 'turn/end' && ev.data !== undefined && ev.data !== null) {
      const reason = ev.data.reason ?? ev.data
      const err = reason.error
      turnEnd = String(reason.kind) + (err === undefined || err === null ? '' : ' | code=' + String(err.code) + ' | msg=' + String(err.message))
    }
    if (type !== 'assistant/message') continue
    const message = ev.data === undefined || ev.data === null ? undefined : ev.data.message
    if (message === undefined || !Array.isArray(message.content)) continue
    const parts = []
    for (const block of message.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        parts.push(block.text)
      }
    }
    if (parts.length > 0) texts.push({ index: index, text: parts.join('\n') })
  }

  const tail = texts.filter((entry) => entry.index > lastToolResult)
  const chosen = tail
  return {
    answer: chosen.map((entry) => entry.text).join('\n\n---\n\n'),
    summary: order.map((type) => type + '×' + String(counts[type])).join(', '),
    total: list.length,
    toolCalls: toolCalls,
    turnEnd: turnEnd,
  }
}

/** 与原生子代理一致：继承调用方的模型路由（provider/model/reasoningEffort/maxTokens）。 */
function inheritRoute(parent) {
  let source = parent.options === undefined || parent.options === null ? {} : parent.options
  // options 是建会话时的默认值。界面选模和实际请求的路由都记在宿主会话事件中。
  // 只读受信任的路由事件，不从用户/模型正文中提取 provider。
  const events = parent.session?.snapshotEvents?.() ?? []
  for (const event of events) {
    const selected = event.type === 'model/selection' ? event.data
      : event.type === 'request/header' ? event.data?.header?.config : null
    if (!selected || typeof selected.provider !== 'string' || !selected.provider.trim()
      || typeof selected.model !== 'string' || !selected.model.trim()) continue
    // 整体替换，避免把旧 provider 的推理/输出参数带进另一条路由。
    source = selected
  }
  const target = {}
  if (source.provider !== undefined) target.provider = source.provider
  if (source.model !== undefined) target.model = source.model
  if (source.reasoningEffort !== undefined) target.reasoningEffort = source.reasoningEffort
  if (source.maxTokens !== undefined) target.maxTokens = source.maxTokens
  return target
}

/**
 * 把「配置文件里的目标声明」规范化成内部结构。
 *
 * 配置形状（cordis.patch.yml 的 config.targets）：
 *
 *   targets:
 *     - id: knowledge                 # 必填，模型调用时用的名字
 *       preset: knowledge             # 必填，子代理跑的预设
 *       cwd: 'D:\DSH WorkPlace\知识库' # 必填，子代理的工作目录（决定它进哪份项目记忆）
 *       describe: 知识库管家            # 可选，供通用工具的目标清单
 *       brief: >-                     # 可选，追加给子代理的系统级作业说明
 *         先读根目录 AGENTS.md 再动手……
 *
 * 同时兼容 knowledge-gateway 的**旧单目标字段**（kbCwd / preset / toolName），
 * 让同一个插件既能当"知识库专用"又能当"通用委派"。
 */
function normalizeTargets(settings) {
  const targets = []
  const raw = settings.targets
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue
      const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : ''
      const preset = typeof entry.preset === 'string' && entry.preset !== '' ? entry.preset : ''
      if (id === '' || preset === '') continue
      targets.push({
        id: id,
        preset: preset,
        cwd: typeof entry.cwd === 'string' && entry.cwd !== '' ? entry.cwd : '',
        describe: typeof entry.describe === 'string' ? entry.describe : '',
        brief: typeof entry.brief === 'string' ? entry.brief : '',
        toolName: typeof entry.toolName === 'string' ? entry.toolName : '',
        fixed: entry.fixed === true,
      })
    }
  }
  // 旧字段兼容：只有 kbCwd/preset 时补一个知识库目标
  if (targets.length === 0) {
    // kbCwd 缺省不再回退到某个写死的绝对路径（可分发性）；空值表示"由 cwd 决定/继承"
    const kbCwd = typeof settings.kbCwd === 'string' && settings.kbCwd !== '' ? settings.kbCwd : ''
    const preset = typeof settings.preset === 'string' && settings.preset !== '' ? settings.preset : DEFAULTS.kbPreset
    targets.push({
      id: 'knowledge',
      preset: preset,
      cwd: kbCwd,
      describe: '知识库管家（个人知识库的读取与改写）',
      brief: '',
      toolName: typeof settings.toolName === 'string' && settings.toolName !== '' ? settings.toolName : DEFAULTS.knowledgeTool,
      fixed: true,
    })
  }
  return targets
}

/** 组装交给子代理的提示词。extra 是调用方带进来的背景 —— 这是本插件存在的核心理由。 */
function buildPrompt(target, task, kind, toolName, extra) {
  const lines = [
    '你被一个外部会话（另一个 agent）自动调用，作为「' + (target.describe === '' ? target.id : target.describe) + '」处理下面这一件事。',
    '你的工作目录是：' + (target.cwd === '' ? '(继承调用方)' : target.cwd),
    '',
    '【调用方声明的任务】' + task,
  ]
  if (typeof extra === 'string' && extra.trim() !== '') {
    lines.push('')
    lines.push('【调用方随任务带来的背景】')
    lines.push('（这一段是调用方在它那边掌握的上下文，你拿不到原始材料 —— 请把它当成作业前提，不要复述、不要外传。）')
    lines.push(extra.trim())
  }
  lines.push('')
  lines.push('【必须遵守】')
  if (target.brief !== '') {
    lines.push(target.brief.trim())
  } else {
    lines.push('1. 只做本次任务要求的事，范围不要扩大。')
  }
  lines.push('2. 你不能向主人提问。需要主人当场确认的事（删除、覆盖原件、归档、外发），不要执行，直接在回报里写明「需用户确认」及原因。')
  lines.push('3. 回报用简洁的文本，不要粘贴长原文，**不要在末尾追加无关的自检、渲染说明或元评论**。')
  lines.push('4. 不要调用其它子代理，也不要再调用 ' + toolName + '。')
  return lines.join('\n')
}

/**
 * 根级分支借用模型路由：从**当前存活的任一 agent** 拿 provider/model。
 * 同一进程 = 同一份 profile 配置，用户正在用的那条会话就是一条可用的真实路由。
 * 拿不到返回 {}（调用方会因此明确报错，而不是硬起一个必然 turn error 的子代理）。
 */
function borrowLiveRoute(env) {
  try {
    const agents = env.ctx.get('agents')
    if (!agents || typeof agents.list !== 'function') return {}
    const list = agents.list()
    for (const entry of Array.isArray(list) ? list : Array.from(list)) {
      const agent = entry && entry.agent !== undefined ? entry.agent : entry
      if (!agent || !agent.options) continue
      const route = inheritRoute(agent)
      if (route.provider !== undefined && route.model !== undefined) return route
    }
  } catch (error) {
    console.error('[agent-gateway] 借用模型路由失败：' + String((error && error.message) ?? error))
  }
  return {}
}

/**
 * 委派执行体 —— 从 apply() 里抽出的可复用内核（2026-10-18）。
 * 行为与抽出前逐字一致，差别只有「环境从哪来」：调用方传 env，不再读闭包。
 *
 * env = {
 *   ctx,                                  // 用来取 agents / agentPresets
 *   presets: () => service,               // agentPresets 服务（即时读）
 *   descriptorVersion, maxDepth, maxCalls,
 *   state: { count: 0 },                  // 本次实例的调用计数（每实例独立）
 *   fallbackCwd,                          // 没有调用方时根级子代理的 cwd
 *   rootRoute,                            // 根级分支的 agentOptions（缺省 {}）
 * }
 *
 * exec = { agent?, signal? } —— 有 agent 走父级分支（与 agent_call 完全一致），
 * 没有 agent 走根级分支（界面「立即运行」无模型会话可用时）。
 */
function delegationError(code, message) {
  return Object.assign(new Error(message), { code })
}

function waitForSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

async function runDelegation(env, target, task, kind, extra, exec, label) {
  const parent = exec?.agent ?? null
  // maxCalls limits simultaneous work per caller, not the lifetime of this plugin.
  const key = parent ?? env.rootKey
  const count = env.active.get(key) ?? 0
  if (count >= env.maxCalls) throw delegationError('DELEGATION_BUSY', '委派并发数达到上限，请等待已有请求结束')
  const agents = env.ctx.get('agents')
  if (parent && typeof agents?.get === 'function' && agents.get(parent.id) !== parent) {
    throw delegationError('DELEGATION_UNAUTHORIZED', '调用方不是宿主当前存活的 Agent')
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort(delegationError('DELEGATION_CANCELED', '委派已取消'))
  if (exec?.signal?.aborted) onAbort()
  else exec?.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(delegationError('DELEGATION_TIMEOUT', '委派超时，已请求停止子代理')), env.timeoutMs)
  env.active.set(key, count + 1)
  env.state.count += 1
  try {
    controller.signal.throwIfAborted()
    const resolvedTarget = env.resolveTarget ? await waitForSignal(env.resolveTarget(target), controller.signal) : target
    return await runDelegationBody(env, resolvedTarget, task, kind, extra, { ...exec, signal: controller.signal }, label)
  } finally {
    clearTimeout(timer)
    exec?.signal?.removeEventListener('abort', onAbort)
    const remaining = (env.active.get(key) ?? 1) - 1
    if (remaining) env.active.set(key, remaining)
    else env.active.delete(key)
  }
}

async function runDelegationBody(env, target, task, kind, extra, exec, label) {
  const safeExec = exec === undefined || exec === null ? {} : exec
  const parent = safeExec.agent === undefined || safeExec.agent === null ? null : safeExec.agent
  const presets = env.presets()
  if (presets === undefined || presets === null) throw new Error(label + ': agentPresets 服务不可用（宿主未提供）')

  let depth = 1
  let parentHeader = null
  if (parent !== null) {
    parentHeader = parent.session.header
    depth = (parentHeader.delegationDepth === undefined ? 0 : parentHeader.delegationDepth) + 1
    if (depth > env.maxDepth) {
      throw new Error(label + ': 委派深度 ' + String(depth) + ' 超过上限 ' + String(env.maxDepth) + '；请让调用链上游来处理这件事。')
    }
  }

  // 任务标签：**父会话的 catalog 行**与**子会话的 descriptor** 必须用同一个值 ——
  // 宿主的 catalog 折叠会拿子会话的 descriptor 去核对父会话那条记录，两处不一致
  // 就会被判成可疑数据、不显示。
  // （注意别叫 label：本函数最后一个形参已占用该名字，是工具名。）
  const taskLabel = String(task).replace(/\s+/g, ' ').trim().slice(0, 120)
  const cwd = target.cwd === '' ? (parentHeader !== null ? parentHeader.cwd : env.fallbackCwd) : target.cwd

  const meta = {
    cwd: cwd,
    origin: 'subagent',
    delegationDepth: depth,
    agentPreset: target.preset,
  }
  if (parentHeader !== null) meta.parentSession = parentHeader.id

  // 模型路由：父级分支从调用方继承（与 agent_call 完全一致）；根级分支没有调用方，
  // 就先看配置里有没有显式 rootRoute，再**借用当前任一存活会话的路由**（同一个进程、
  // 同一份 profile，用户正在用的那条就是可用路由）。两条都拿不到 → 明确报错，不硬起。
  // 为什么非有不可：预设人设里的 {{model}} 模板取不到值 → turn 直接 error，连模型请求都不发。
  let route = {}
  if (parentHeader !== null) {
    route = inheritRoute(parent)
  } else {
    const borrowed = borrowLiveRoute(env)
    route = Object.assign({}, borrowed, env.rootRoute)
    if (route.provider === undefined || route.model === undefined) {
      throw new Error(label + ': 界面触发的流程运行缺少模型路由（没有调用方会话可继承，也没有可借用的存活会话）。'
        + '请改在对话里让我运行（工具路径自动继承路由），或在 profile 的 gateway.rootRoute 里写 {provider, model}。')
    }
  }

  const createOpts = {
    sessionId: mintSessionId(),
    meta: meta,
    agentOptions: route,
    signal: safeExec.signal,
    setup: async (childCtx, child) => {
      // Team discovers membership at publication. Stamp the one-shot identity
      // before mounting any composition: never install Lead tools then change
      // the same live object's classification during its first pre-step.
      child.session.append('subagent/descriptor', {
        version: env.descriptorVersion,
        mode: 'one-shot',
        provider: name,
        label: taskLabel,
      })
      const preparedAuthority = env.ctx.get('h1Isolation')
      if (target.id === 'knowledge' && target.preset === 'knowledge' && preparedAuthority) {
        preparedAuthority.prepareKnowledge(child)
        // 台账：授予与撤销必须同源；prepare 成功即记下（真正执行仍要过 live()）
        noteKnowledgeGrant(child)
      }
      await presets.mount(childCtx, target.preset)
      safeExec.signal.throwIfAborted()
    },
  }
  if (parent !== null) createOpts.parentAgent = parent

  // 🔴 服务必须用 ctx.get：`ctx.agents` 是**属性访问**，'agents' 不在本插件的 inject 列表里时
  // 它本身就抛 `cannot get property "agents" without inject`（2026-10-18 真机实测踩到），
  // 且这一抛发生在 create 之前 —— 表现为流程第 1 步失败、没有任何子代理被创建。
  const agentsService = env.ctx.get('agents')
  if (agentsService === undefined || agentsService === null || typeof agentsService.create !== 'function') {
    throw new Error(label + ': 宿主的 agents 服务不可用（ctx.get("agents") 为空），无法创建子代理')
  }
  const creating = Promise.resolve().then(() => agentsService.create(createOpts))
  let handle
  try {
    handle = await waitForSignal(creating, safeExec.signal)
  } catch (error) {
    // A backend may finish creation after cancellation; do not orphan that handle.
    void creating.then(late => late.dispose()).catch(() => {})
    throw error
  }

  const child = handle.agent
  // H1 host-owned grant: live object identity, never a model/preset claim.
  const h1Authority = env.ctx.get('h1Isolation')

  // ── 把这次委派登记进**父会话**的子代理目录（catalog）──────────────────────────
  // 为什么非有不可：「任务管理」页画的行**就是**父会话 subagent/catalog 事件的投影
  // （better-sidebar 的 subagent-catalog.ts 原话：行恰好是 {id, createdAt, mode, label?}，
  // 由宿主按连接算一次投影）。原生子代理由 driver 追加这条；本插件是**自建**子代理，
  // 不补这一条 → 页面永远显示「暂无子代理」，连子代理的会话入口都没有 —— 于是调用方
  // 回合一旦被中断（stop / 宿主重启），子代理跑到哪、写出了什么都没处可看。
  //
  // 形状照宿主 SubagentCatalogEvent 的 v0：{ childId, childCreatedAt, version:0, mode, label? }。
  // 🔴 childCreatedAt 必须是**子会话头的 createdAt 原值**，不能拿 Date.now() 顶替 ——
  // 实测原生样本：子会话 a5ac99c8… 的头 createdAt = 1790812422626，父会话 catalog 里
  // 记的 childCreatedAt 一模一样的 1790812422626（宿主要求两者对得上）。
  // 根级分支没有父会话，自然没有 catalog 可登记（如实跳过，不伪造）。
  if (parent !== null) {
    try {
      const childHeader = child.session === undefined ? undefined : child.session.header
      const createdAt = childHeader === undefined || childHeader === null ? undefined : childHeader.createdAt
      const parentSession = parent.session
      if (typeof parentSession.append !== 'function') {
        console.error('[agent-gateway] catalog 未登记：调用方会话没有 append（无法显示在任务管理页）')
      } else if (!Number.isSafeInteger(createdAt)) {
        console.error('[agent-gateway] catalog 未登记：子会话头没有可用的 createdAt')
      } else {
        parentSession.append('subagent/catalog', {
          version: 0,
          childId: String(child.id),
          childCreatedAt: createdAt,
          mode: 'one-shot',
          label: taskLabel,
        })
      }
    } catch (error) {
      console.error('[agent-gateway] catalog append failed: ' + String(error))
    }
  }

  // 台账：先落一条「正在派」，跑完再补结果 —— 与调用方回合是否被掐无关。
  const outboxBase = {
    target: target.id,
    preset: target.preset,
    parentSession: parentHeader !== null ? String(parentHeader.id) : null,
    childSession: String(child.id),
  }
  const startedAtIso = new Date().toISOString()
  writeOutbox(child.id, Object.assign({ status: 'running', startedAt: startedAtIso }, outboxBase))

  let answer = ''
  let outcome = 'failed'
  let failureCode = null
  try {
    safeExec.signal.throwIfAborted()
    if (target.id === 'knowledge' && target.preset === 'knowledge') {
      if (h1Authority) h1Authority.grantKnowledge(child)
      // Application authorization is also required in the explicitly selected
      // daily compatibility mode. It does not claim OS filesystem isolation.
      noteKnowledgeGrant(child)
    }
    const followupId = parentHeader !== null
      ? 'agent-call-' + String(parentHeader.id) + '-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8)
      : 'agent-call-root-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8)
    child.followup({
      id: followupId,
      role: 'user',
      content: [{ type: 'text', text: buildPrompt(target, task, kind, label, extra) }],
      source: { kind: 'user' },
    })
    await waitForSignal(child.whenIdle(), safeExec.signal)
    safeExec.signal.throwIfAborted()
    const folded = foldAnswer(readEvents(child.session, 0))
    answer = folded.answer
    // Only a completed turn is a successful response. Never turn diagnostics
    // into non-empty "answers" which the flow runner could land as a report.
    const turnKind = folded.turnEnd.split(' | ')[0]
    if (turnKind !== 'completed') throw delegationError('DELEGATION_FAILED', '子代理未正常完成（状态=' + (turnKind || 'missing-turn-end') + '，childId=' + child.id + '）')
    if (answer.trim() === '') throw delegationError('DELEGATION_EMPTY', '子代理完成但没有最终文本（childId=' + child.id + '）')
    outcome = 'done'
  } catch (error) {
    failureCode = String(error?.code ?? 'DELEGATION_FAILED')
    outcome = safeExec.signal.aborted ? (failureCode === 'DELEGATION_TIMEOUT' ? 'timed-out' : 'canceled') : 'failed'
    throw error
  } finally {
    writeOutbox(child.id, Object.assign({
      status: outcome,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      errorCode: failureCode,
    }, outboxBase))
    try { h1Authority?.revoke(child) } catch (error) {
      console.error('[agent-gateway] H1 revoke failed: ' + String(error))
    }
    // 台账同轮撤权：即便 H1 不存在（开发模式），本次委派结束后也不能再当知识库身份用
    noteKnowledgeRevoke(child)
    try {
      let cleanupTimer
      try {
        await Promise.race([
          Promise.resolve().then(() => handle.dispose()),
          new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('子代理清理超时，请检查宿主任务状态')), 5000) }),
        ])
      } finally { clearTimeout(cleanupTimer) }
    } catch (error) {
      console.error('[agent-gateway] dispose 失败 ' + String(error))
    }
  }
  return {
    answer: answer,
    target: target.id,
    preset: target.preset,
    subagentId: String(child.id),
    kind: kind,
  }
}

/**
 * 可复用的委派能力（**不注册工具**）。agent_call / knowledge_request 与流程执行器共用它。
 * 每次调用得到一个**独立实例**（自己的计数与上限）—— 流程跑很多步不会吃掉 agent_call 的额度。
 */
export function createDelegate(ctx, config) {
  const settings = config === undefined || config === null ? {} : config
  const env = {
    ctx: ctx,
    presets: () => ctx.get('agentPresets'),
    descriptorVersion: Number.isSafeInteger(settings.descriptorVersion) ? settings.descriptorVersion : DEFAULTS.descriptorVersion,
    maxDepth: Number.isSafeInteger(settings.maxDepth) ? settings.maxDepth : DEFAULTS.maxDepth,
    maxCalls: Number.isSafeInteger(settings.maxCalls) && settings.maxCalls > 0 ? settings.maxCalls : DEFAULTS.maxCalls,
    state: { count: 0 },
    active: new Map(),
    rootKey: {},
    timeoutMs: Number.isSafeInteger(settings.timeoutMs) && settings.timeoutMs > 0 ? settings.timeoutMs : 300000,
    fallbackCwd: typeof settings.fallbackCwd === 'string' && settings.fallbackCwd !== '' ? settings.fallbackCwd : process.cwd(),
    rootRoute: settings.rootRoute !== null && typeof settings.rootRoute === 'object' ? settings.rootRoute : {},
    resolveTarget: typeof settings.resolveTarget === 'function' ? settings.resolveTarget : null,
  }
  const targets = normalizeTargets(settings)
  return {
    targets: targets,
    descriptorVersion: env.descriptorVersion,
    maxDepth: env.maxDepth,
    maxCalls: env.maxCalls,
    getCallCount: () => env.state.count,
    /** 用内部 target 对象直接派（工具层已经解析过目标时用） */
    async delegate(target, task, kind, extra, exec, label) {
      return await runDelegation(env, target, task, kind, extra, exec, label)
    },
    /** 按 id 派；id 不在配置里 → 明确报错并给出可用清单（不猜、不回退） */
    async delegateTo(targetId, task, kind, extra, exec, label) {
      const wanted = typeof targetId === 'string' ? targetId.trim() : ''
      const target = targets.find((entry) => entry.id === wanted)
      if (target === undefined) {
        throw new Error((label === undefined ? 'delegate' : label) + ': 没有名为 "' + wanted + '" 的目标 agent。可用：'
          + targets.map((entry) => entry.id).join(', '))
      }
      return await runDelegation(env, target, task, kind, extra, exec, label)
    },
  }
}

export function apply(ctx, config) {
  const settings = config === undefined || config === null ? {} : config
  const descriptorVersion = Number.isSafeInteger(settings.descriptorVersion) ? settings.descriptorVersion : DEFAULTS.descriptorVersion
  const maxDepth = Number.isSafeInteger(settings.maxDepth) ? settings.maxDepth : DEFAULTS.maxDepth
  const maxCalls = Number.isSafeInteger(settings.maxCalls) && settings.maxCalls > 0 ? settings.maxCalls : DEFAULTS.maxCalls
  const callerTool = typeof settings.callerTool === 'string' && settings.callerTool !== '' ? settings.callerTool : DEFAULTS.callerTool
  const guardEnabled = settings.guard === true

  // 工具注册走**同一份**可复用内核（自己的实例，与流程执行器互不占用额度）
  const core = createDelegate(ctx, settings)
  const targets = core.targets
  const delegate = core.delegate

  // 知识库路径与豁免：守卫只针对「个人知识库」这一个目录（通用委派不该顺手把别的目录也锁上）
  // 2026-10-18：kbCwd 不再有写死默认值。空值 = 不知道知识库在哪 → 守卫**不安装**并如实说明，
  // 而不是拿开发机的路径去比对（那会在别人的机器上锁错目录，且看起来"守卫生效了"）。
  const kbCwd = typeof settings.kbCwd === 'string' && settings.kbCwd !== '' ? settings.kbCwd : ''
  const kbKey = normalizePath(kbCwd)
  const allowPresets = Array.isArray(settings.guardAllowPresets)
    ? settings.guardAllowPresets.map(String)
    : ['knowledge', 'chat']
  const kbTarget = targets.find((entry) => normalizePath(entry.cwd) === kbKey)

  // 每个目标自带的固定工具名（工具名 → 目标），用于兼容旧调用方（如 knowledge_request）
  const namedTools = targets.filter((entry) => entry.toolName !== '')

  // 宿主根行的 apply 可能**早于**这些服务发布（同层兄弟是并发加载的），所以不能假设
  // 「一进来就齐」：先即时读一次，不齐就按 200ms 重试，最多约 6 秒，并把每次结果写进
  // 启动日志 —— 宁可日志吵，也不要「装好了但什么都没发生、且不报错」。
  let tools
  let sessions
  let presets
  let installed = false
  let attempts = 0
  let timer = null

  /** 判断一个 agent 是否属于允许直连知识库的预设。出错/解析不出时放行（软强制）。 */
  const presetOf = (agent) => {
    try {
      if (agent === undefined || agent === null || agent.ctx === undefined) return undefined
      return presets.composedPreset(agent.ctx)
    } catch (error) {
      console.error('[agent-gateway] preset lookup failed: ' + String(error))
      return undefined
    }
  }

  // ── 工具 1：通用委派 agent_call ──────────────────────────────────────────────
  const callTool = {
    name: callerTool,
    description:
      '把一个任务交给**另一个 agent 预设**的子代理去执行，并把它写出的回报带回。'
      + '子代理是全新会话、看不到你和主人的对话历史 —— 所以要靠 task 说清要什么、靠 context 把'
      + '**只有你这边掌握的背景**（材料、约束、判断、情感语境等）一并带过去；它拿不到原始对话。'
      + '可用目标见参数说明。回报里若出现「需用户确认」，把它转述给主人，不要自行执行。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          description: '目标 agent（用配置里声明的 id）。可选值：'
            + targets.map((entry) => entry.id + (entry.describe === '' ? '' : '（' + entry.describe + '）')).join(' / '),
        },
        task: {
          type: 'string',
          description: '要这个 agent 做的事：具体、可验收。越具体越好。',
        },
        context: {
          type: 'string',
          description: '**只有你这边掌握、而子代理拿不到的背景**：相关材料要点、硬约束、必须避开的雷区、判断依据、情感语境等。它不会复述这一段，只当作业前提。留空则子代理只有 task。',
        },
        kind: {
          type: 'string',
          description: '任务性质：read = 只要结论/查询（缺省）；write = 需要对方产出或改写文件。',
        },
      },
      required: ['target', 'task'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answer: { type: 'string' },
          target: { type: 'string' },
          preset: { type: 'string' },
          subagentId: { type: 'string' },
          kind: { type: 'string' },
        },
        required: ['answer', 'target', 'preset', 'subagentId', 'kind'],
      },
      render(_args, value) {
        return [{ type: 'text', text: value.answer }]
      },
    },
    isConcurrencySafe() {
      return true
    },
    async execute(args, exec) {
      const wanted = typeof args.target === 'string' ? args.target.trim() : ''
      const target = targets.find((entry) => entry.id === wanted)
      if (target === undefined) {
        throw new Error(callerTool + ': 没有名为 "' + wanted + '" 的目标 agent。可用：'
          + targets.map((entry) => entry.id).join(', ')
          + '（目标清单在 profile 的 cordis.patch.yml 里，需要新增请让主人加一行然后重启。）')
      }
      const kind = args.kind === 'write' ? 'write' : 'read'
      return await delegate(target, String(args.task), kind, args.context, exec, callerTool)
    },
  }

  // ── 工具 2..N：每个 target 自带的固定工具名（兼容旧调用方，如 knowledge_request）──
  const fixedTools = namedTools.map((target) => ({
    name: target.toolName,
    description:
      '把这件事交给「' + (target.describe === '' ? target.id : target.describe) + '」这个 agent 执行'
      + '（预设 ' + target.preset + '，工作目录 ' + (target.cwd === '' ? '继承调用方' : target.cwd) + '），并带回它的回报。'
      + '这是 ' + callerTool + '(target="' + target.id + '") 的固定别名。'
      + '若回报里出现「需用户确认」，把它转述给主人，不要自行执行。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        purpose: {
          type: 'string',
          description: '这次请求的用途（为什么要做这件事）。例如：为了给歌词定稿核对一处事实 / 更新某条项目进展。',
        },
        request: {
          type: 'string',
          description: '具体要读什么、或要改什么，以及要什么形式的回报。越具体越好。',
        },
        mode: {
          type: 'string',
          description: '请求类型：read = 只读（缺省）；write = 需要写入或改写文件。',
        },
        context: {
          type: 'string',
          description: '只有你这边掌握、而对方拿不到的背景（材料要点、硬约束、必须避开的雷区、判断依据、情感语境）。留空则对方只有 request。',
        },
      },
      required: ['purpose', 'request'],
    },
    output: callTool.output,
    isConcurrencySafe() {
      return true
    },
    async execute(args, exec) {
      const kind = args.mode === 'write' ? 'write' : 'read'
      const task = '【用途】' + String(args.purpose) + '\n【具体请求】' + String(args.request)
      return await delegate(target, task, kind, args.context, exec, target.toolName)
    },
  }))

  /** 服务就绪后一次性安装：注册全部工具 + 可选守卫。 */
  const install = (t, s, p) => {
    if (installed) return
    installed = true
    tools = t
    sessions = s
    presets = p

    for (const entry of [callTool].concat(fixedTools)) {
      try {
        ctx.effect(() => tools.register(entry), 'agent-gateway: ' + entry.name)
        // Retain exact registered definition identity for the global guard.
        ctx.get('h1Isolation')?.registerGateway(entry)
        ctx.inject(['h1Isolation'], scope => scope.get('h1Isolation').registerGateway(entry))
        console.log('[agent-gateway] 已注册工具 ' + entry.name)
      } catch (error) {
        console.error('[agent-gateway] 注册工具 ' + entry.name + ' 失败：' + String(error))
      }
    }

    // ── 守卫：非豁免预设不得直接读写知识库路径（默认关；只针对知识库那一个目录）──
    if (guardEnabled && kbKey === '') {
      console.error('[agent-gateway] 守卫已请求开启，但 gateway.kbCwd 未配置（不知道知识库在哪）→ 不安装守卫；请显式配置 kbCwd')
    } else if (guardEnabled) {
      try {
        const hint = kbTarget !== undefined && kbTarget.toolName !== ''
          ? kbTarget.toolName
          : callerTool + '（target="' + (kbTarget === undefined ? 'knowledge' : kbTarget.id) + '"）'
        const registeredNames = [callerTool].concat(fixedTools.map((entry) => entry.name))
        ctx.effect(() => tools.guard((exec) => {
          const callName = String(exec.name === undefined ? '' : exec.name)
          if (registeredNames.indexOf(callName) >= 0) return undefined // 网关自己放行
          const preset = presetOf(exec.agent)
          if (preset === undefined) return undefined // 解析失败放行（软强制，误伤代价更高）
          if (allowPresets.indexOf(preset) >= 0) return undefined // 豁免预设放行
          const strings = []
          collectPathLike(exec.arguments, strings, '', 0)
          let hit = false
          for (const text of strings) {
            if (normalizePath(text).indexOf(kbKey) >= 0) {
              hit = true
              break
            }
          }
          if (!hit) return undefined
          return '知识库（' + kbCwd + '）不允许本会话直接读写：请改用 ' + hint
            + ' 把这件事交给知识库 agent（预设 ' + (kbTarget === undefined ? 'knowledge' : kbTarget.preset) + '）执行。'
            + '（本守卫对结构化路径工具有效；shell 命令只能拦明显的字面路径，属软强制。）'
        }), 'agent-gateway: guard')
        console.log('[agent-gateway] 已安装守卫，豁免预设=' + allowPresets.join(','))
      } catch (error) {
        console.error('[agent-gateway] 安装守卫失败：' + String(error))
      }
    }

    console.log('[agent-gateway] ready: callerTool=' + callerTool
      + ' | targets=' + targets.map((entry) => entry.id + '→' + entry.preset).join(', ')
      + ' | fixedTools=' + (fixedTools.length === 0 ? '(none)' : fixedTools.map((e) => e.name).join(','))
      + ' | maxDepth=' + String(maxDepth) + ' maxCalls=' + String(maxCalls) + ' descriptorVersion=' + String(descriptorVersion))
  }

  /** 立即探测一次；不齐就 200ms 后再来，最多 30 次（约 6 秒）。 */
  const probe = () => {
    if (installed) return
    attempts += 1
    const t = ctx.get('tools')
    const s = ctx.get('sessions')
    const p = ctx.get('agentPresets')
    if (t !== undefined && s !== undefined && p !== undefined) {
      console.log('[agent-gateway] 服务就绪（第 ' + String(attempts) + ' 次探测）')
      install(t, s, p)
      return
    }
    if (attempts === 1 || attempts % 10 === 0) {
      console.log('[agent-gateway] 等待服务：第 ' + String(attempts) + ' 次探测，tools=' + String(t !== undefined)
        + ' sessions=' + String(s !== undefined) + ' agentPresets=' + String(p !== undefined))
    }
    if (attempts >= 30) {
      console.error('[agent-gateway] 放弃：30 次探测（约 6 秒）后仍拿不到 tools/sessions/agentPresets')
      return
    }
    timer = setTimeout(probe, 200)
  }

  ctx.effect(() => () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }, 'agent-gateway: wait timer')
  probe()
}
