// 插件入口（host 半边）。只依赖 ctx 服务，不 import @deepseek-ai/*。
import { buildMap, MAP_RULES_VERSION } from './map.js'
import { readIndexPolicy } from './index-policy.js'
// 工具契约：output { schema, render, presentationMeta? } 必填（宿主实测强制）。
// 注册方式：ctx.effect(() => tools.register(entry), label)
//
// P0.1 修复（对应验收意见 A、B、D）：
//   A. 新增 kb_init 工具；kb_bind 增加 confirmInit 预览/确认两段，普通会话即可完成首次建库
//   B. registeredTools 只列**注册成功**的项，失败项单列；L1 证据绑定本次构建信息，不再用常量自称通过
//   D. update 在**工具层**就要求 expectedRevision，缺则直接返回错误，不依赖 core 兜底
import os from 'node:os'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { existsSync as fsExists, statSync as fsStat, readdirSync } from 'node:fs'
import path from 'node:path'
import { mkdir, writeFile, readFile, stat, realpath, access, copyFile, readdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createCore, VERSION } from './kbcore.js'
import { apply as gatewayApply, createDelegate as createGatewayDelegate, isLiveKnowledgeGrant } from './gateway.js'
import { createFlowEngine } from './flows.js'
import { createFlowWorkspaceManager, prepareFlowConversation } from './flow-workspace.js'
import { createUpdateChecker, createUpdateDownloader, startAutomaticChecks } from './updates.js'
import { runSelftest } from './selftest.js'
import { walkTree, privateRootOf, normSegs, toPosix as toPosixFile, DEFAULT_PRIVATE_DIRS, readImportSources, derivedPrivatePartitions, effectivePrivateDirs, knowledgeCount } from './fsindex.js'
import { createImportService } from './import-service.js'
import { inspectFolder } from './importer.js'
import { createParsingService } from './parsing.js'
import { createParseSourceAuthority } from './parse-source-authority.js'
import { createIndexMaintenance } from './index-maintenance.js'
import { createWorkbench } from './workbench.js'
import { syncManagedFiles } from './managed-files.js'
import { createCitationGuard } from './citation-guard.js'
import { sharedDraft, captureDocument } from './capture-surface.js'

export const name = 'kb-core'
// 版本单一来源：kbcore 的 VERSION（package.json 必须与之一致）
export const PLUGIN_VERSION = VERSION

const text = (t) => [{ type: 'text', text: t }]
// Stable loopback bridge for the browser extension. Keep this below the default
// Windows ephemeral port range used by the Desktop UI's --port 0 listener.
const CLIPPER_BRIDGE_HOST = '127.0.0.1'
const CLIPPER_BRIDGE_PORT = 43172
// 管理面解析动作：**模型侧一律拒绝**。这些动作会写"执行哪个程序 / 把正文发到哪个地址 /
// 读哪个环境变量当凭据 / 是否允许出网"，只能由用户在设置页改（2026-10-18 定向审查缺口 2）。
const PARSE_ADMIN_ACTIONS = new Set(['save-provider', 'delete-provider', 'default', 'policy', 'set-provider', 'provider-save', 'provider-delete'])

/** 模型侧是否想碰管理面动作（导出以便离线自证"伪造 action 也会被拒"）。 */
export function parseAdminActionOf(action) {
  return PARSE_ADMIN_ACTIONS.has(String(action ?? '').trim())
}

/**
 * 解析入口的调用方闸门（可作为纯函数自证）。
 * @param getService (name) => 服务对象或 null（ctx.get 的包装；属性访问不能直接写，会抛）
 * @param config     插件配置（`parse.allowWithoutIsolation === false` 要求 H1）
 */
export function createParseCaller(getService, config) {
  const parseCfg = config !== null && typeof config === 'object' && config.parse !== null && typeof config.parse === 'object'
    ? config.parse
    : {}
  // Standard desktop hosts do not ship H1. A verified knowledge identity is
  // sufficient there; an explicitly configured isolation requirement still wins.
  const allowWithoutIsolation = parseCfg.allowWithoutIsolation !== false
  return (exec) => {
    const deny = (reason, detail) => ({ ok: false, reason, detail })
    const agent = exec && exec.agent ? exec.agent : null
    if (agent === null) {
      return deny('PARSE_CALLER_UNVERIFIED', '解析需要可核验的调用方身份：没有调用方 agent，无法判定它是不是知识库子代理')
    }
    if (exec && exec.signal && exec.signal.aborted === true) {
      return deny('PARSE_CANCELED', '调用方已取消：不启动解析')
    }
    // ① 活对象身份（宿主注册表同一对象）。拿不到 agents 服务就不猜、不放行。
    const agentsService = getService('agents')
    if (agentsService === null || agentsService === undefined || typeof agentsService.get !== 'function') {
      return deny('PARSE_CALLER_UNVERIFIED', '宿主没有提供 agents 服务：无法核验调用方是否为存活 Agent')
    }
    if (agentsService.get(agent.id) !== agent) {
      return deny('PARSE_CALLER_UNVERIFIED', '调用方不是宿主当前存活的 Agent（身份对象与注册表不一致）')
    }
    const h1 = getService('h1Isolation')
    if (h1 === null || h1 === undefined) {
      if (allowWithoutIsolation === true) {
        const header = agent.session && agent.session.header ? agent.session.header : {}
        const knowledgeRoot = header.agentPreset === 'knowledge' && header.origin !== 'subagent' && !header.parentSession
        if (!isLiveKnowledgeGrant(agent, agentsService) && !knowledgeRoot) {
          return deny('PARSE_DELEGATION_REQUIRED', '兼容模式仍需知识库授权：请用 agent_call(target="knowledge") 委派解析')
        }
        return { ok: true, via: parseCfg.allowWithoutIsolation === true ? 'non-h1-explicit' : 'non-h1-verified', isolation: 'none', authorization: knowledgeRoot ? 'knowledge-root' : 'knowledge-subagent' }
      }
      return deny(
        'H1_REQUIRED',
        '本 profile 配置了 parse.allowWithoutIsolation: false，但没有启用 H1 隔离后端，解析未执行。请在启用 H1 的 profile 中执行，或由管理员调整隔离配置。',
      )
    }
    // ③ 隔离后端必须就绪：不就绪就拒绝，绝不退回宿主执行。
    let status = null
    try {
      status = typeof h1.getStatus === 'function' ? h1.getStatus() : null
    } catch {
      status = null
    }
    if (status === null || status.ready !== true) {
      return deny('H1_BACKEND_NOT_READY', `隔离后端未就绪（${status && status.code ? status.code : 'UNKNOWN'}）：解析不执行，也不退回宿主`)
    }
    // ② 实时 knowledge 授权（授予/撤销同源台账 + 活对象身份）。
    if (isLiveKnowledgeGrant(agent, agentsService)) return { ok: true, via: 'knowledge-subagent' }
    const header = agent.session && agent.session.header ? agent.session.header : {}
    // 根级知识库会话：宿主/界面选定的预设是宿主持久元数据，不是模型自报（与 H1 的
    // agent/created 判据一致）。仍然要求上面 ①②③ 全部成立，所以伪造会话头没有用。
    if (header.agentPreset === 'knowledge' && header.origin !== 'subagent' && !header.parentSession) {
      return { ok: true, via: 'knowledge-root' }
    }
    return deny('PARSE_DELEGATION_REQUIRED', '这条会话没有实时的知识库授权：解析只能由知识库子代理执行（请用 agent_call(target="knowledge") 委派）')
  }
}

/** kb_import 的 parse 子动作复用唯一解析授权门，且不接受模型传入的 providerId。 */
export async function runImportParseAction({ args, exec, importService, parseCaller, recordRejection = null }) {
  const gate = parseCaller(exec)
  const requestedBy = { via: 'tool', origin: 'import', gate: gate.via, session: exec?.agent?.session?.header?.id ?? null, agent: exec?.agent?.id ?? null }
  const reject = async failure => recordRejection && !['PARSE_CALLER_UNVERIFIED', 'PARSE_CANCELED'].includes(gate.reason) ? { ...failure, ...await recordRejection({ kind: args?.kind, requestedBy, failure: { reason: failure.reason || 'BAD_IMPORT_SOURCE', detail: failure.error } }) } : failure
  if (!gate.ok) return reject({ ok: false, reason: gate.reason, error: gate.detail })
  const importId = String(args?.importId ?? '')
  if (importId === '') return reject({ ok: false, error: 'parse 需要 importId' })
  const rel = String(args?.rel ?? '')
  if (rel.trim() === '') return reject({ ok: false, error: 'parse 需要 rel（导入清单里的相对路径）' })
  const out = await importService.parseItem(
    { importId, rel, kind: args?.kind },
    { requestedBy },
  )
  return !out.ok && !out.requestId ? reject(out) : out
}

const kv = (prefix, v, fields) =>
  text(prefix + ' ' + fields.filter((f) => v[f] !== undefined && v[f] !== null).map((f) => `${f}=${typeof v[f] === 'object' ? JSON.stringify(v[f]) : v[f]}`).join(' '))

/**
 * stateDir 解析：**按 profile 隔离**，且不再写死开发者测试路径（审查意见 §四 第 5 条）。
 * 判定顺序：
 *   ① 装在 profile 里（<profile>/node_modules/@local/dsh-knowledge-base）→ 直接用该 profile 目录；
 *   ② 否则按 DSH_HOME + profile 名（环境变量或 --profile 参数）拼；
 *   ③ 配置里的绝对路径照用（老安装的显式配置，避免"升级把既有绑定弄丢"）；相对路径按 profile 目录解析。
 */
export function detectProfileDir(pkgRoot) {
  const cand = path.resolve(pkgRoot, '..', '..', '..')
  try {
    if (path.basename(path.dirname(cand)) === 'profiles' && fsExists(path.join(cand, 'package.json'))) return cand
  } catch {
    /* 继续走 home 推断 */
  }
  const homeRaw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const home = homeRaw !== '' ? homeRaw : path.join(os.homedir(), '.dsh')
  let profile = typeof process.env.DSH_PROFILE === 'string' ? process.env.DSH_PROFILE.trim() : ''
  if (profile === '') {
    const argv = process.argv
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--profile' && argv[i + 1]) {
        profile = String(argv[i + 1])
        break
      }
    }
  }
  if (profile === '') profile = 'default'
  return path.join(home, 'profiles', profile)
}

export function resolveStateDir(config, pkgRoot) {
  const raw = typeof config.stateDir === 'string' ? config.stateDir.trim() : ''
  const profileDir = detectProfileDir(pkgRoot)
  const source = raw === '' ? 'profile-default' : path.isAbsolute(raw) ? 'config-absolute' : 'profile-relative'
  const stateDir = raw === '' ? path.join(profileDir, 'kb-state') : path.isAbsolute(raw) ? path.resolve(raw) : path.join(profileDir, raw)
  return { stateDir, source, profileDir }
}

/**
 * 把随包分发的 skills/ 铺到预设技能目录。
 * 背景：0.1.7 起预设是 profile 组合里的声明行，`customSkillDirs` 只能写绝对路径；
 * 若不铺过去，换台机器上「技能随包分发」实际为 0 个技能。
 * 目标目录与预设里 customSkillDirs 保持一致：<DSH_HOME>/.agent-presets/knowledge/skills
 *
 * 2026-10-18 修订（预设接管前的必要加固）：原实现「只补缺失文件」有两个后果——
 *   ① 插件升级后技能内容永远停在第一次铺开的那版（实测本机文件停在 2026-10-01）；
 *   ② 想更新就只能手删目录，而手删又会连用户改动一起丢。
 * 现改为**托管清单**：`<target>/.kb-managed.json` 记录「上次是我们写进去的」每个文件的 sha256。
 *   · 缺失 → 写入；内容相同 → 跳过；
 *   · 内容不同且**与我们上次写入的哈希一致**（说明用户没改过）→ 覆盖为新版；
 *   · 内容不同且与上次哈希不一致（用户自己改过）→ **保留用户版本**并告警，不覆盖。
 */
export async function bootstrapSkills(pkgRoot, log) {
  try {
    const from=path.join(pkgRoot,'skills'),home=process.env.DSH_HOME||path.join(process.env.USERPROFILE||os.homedir(),'.dsh')
    if(!fsExists(from))return {files:[],conflicts:0,reason:'no-bundled-skills'}
    const target=path.join(home,'.agent-presets','knowledge','skills'),items=[]
    const walk=async(dir,prefix='')=>{for(const row of await readdir(dir,{withFileTypes:true})){
      const rel=prefix+row.name
      if(row.isDirectory())await walk(path.join(dir,row.name),rel+'/')
      else if(row.isFile())items.push({path:rel,content:await readFile(path.join(dir,row.name)),instructions:true,version:PLUGIN_VERSION})
    }}
    await walk(from)
    const result=await syncManagedFiles({root:target,items})
    const refreshed=result.files.filter(r=>r.status==='updated').length,copied=result.files.filter(r=>r.status==='created').length
    return {...result,target,copied,refreshed,kept:result.conflicts,skipped:result.files.length-copied-refreshed-result.conflicts,needsNewSession:copied+refreshed>0}
  }catch(error){log('warn','技能升级待处理：'+String(error.code||error.message));return {files:[],conflicts:1,reason:error.code||'error',needsNewSession:false}}
}

export async function bootstrapPreset(pkgRoot,profileDir,log) {
  try {
    const existing=path.join(profileDir,'cordis.patch.yml')
    if(!fsExists(existing))return {files:[],conflicts:0,status:'not-present'}
    const profileText=await readFile(existing,'utf8')
    if(!/^\s*(?:-\s*)?id:\s*preset-knowledge\s*$/m.test(profileText))return {files:[],conflicts:0,status:'bundled-preset',target:profileDir}
    const content=await readFile(path.join(pkgRoot,'presets','01-knowledge-agent.patch.yml'))
    const result=await syncManagedFiles({root:profileDir,items:[{path:'cordis.patch.yml',content,version:PLUGIN_VERSION,instructions:true}],manifest:'.kb-preset-managed.json',backup:'.kb-preset-backups',candidates:'.kb-preset-candidates'})
    return {...result,target:profileDir,needsRestart:result.files.some(f=>['created','updated'].includes(f.status))}
  }catch(error){log('warn','预设升级检查待处理：'+String(error.code||error.message));return {files:[],conflicts:1,reason:error.code||'error'}}
}

export function apply(ctx, config) {
  const startedAt = new Date().toISOString()
  const pkgRootForState = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const stateResolved = resolveStateDir(config, pkgRootForState)
  const stateDir = stateResolved.stateDir
  let installed = false
  let attempts = 0
  let timer = null
  let core = null
  const workbench = createWorkbench({ stateDir, getCore: () => core, getParsing: () => parsingService, getFlows: () => ensureFlowEngine(), getImports: () => importService,
    getUpgradeContext: async({retry=false}={})=>{if(retry){skillsUpgrade=bootstrapSkills(pkgRoot,log);presetUpgrade=bootstrapPreset(pkgRoot,stateResolved.profileDir,log)}const skills=await skillsUpgrade,preset=await presetUpgrade;return {version:PLUGIN_VERSION,buildId:buildInfo.buildId||'loading',runtimeId:startedAt,external:{skills,preset,conflicts:(skills.conflicts||0)+(preset.conflicts||0),needsNewSession:skills.needsNewSession,needsRestart:preset.needsRestart}}},
    getFileActions: () => ctx.get('sessionController'), getAIWorkspace: root => flowWorkspaceManager.ensure(root),
    log: (level, message) => console[level === 'warn' ? 'warn' : 'log']('[kb-workbench] ' + message) })
  const citationGuard = createCitationGuard({validate:(args,caller)=>workbench.dispatch(args,caller),log:message=>console.warn('[kb-citations] '+message)})
  ctx.effect(() => ctx.on('agent/turn-stopping', citationGuard), 'kb: final citation check')
  ctx.effect(() => {
    void workbench.runAutomatic().catch(error => console.warn('[kb-workbench] ' + error.message))
    const timer = setInterval(() => { void workbench.runAutomatic().catch(error => console.warn('[kb-workbench] ' + error.message)) }, 60000)
    timer.unref?.()
    return () => { clearInterval(timer); workbench.dispose() }
  }, 'kb-workbench: opt-in background maintenance')
  const flowWorkspaceManager = createFlowWorkspaceManager({ getRegistry: () => ctx.get('workspaceRegistry') })
  const updateChecker = createUpdateChecker({ currentVersion: PLUGIN_VERSION })
  const updateProfile = ctx.get('profileContext')
  const updateDownloader = createUpdateDownloader({ checker: updateChecker,
    cacheDir: typeof updateProfile?.dir === 'string' ? path.join(updateProfile.dir, '.kb-plugin-updates') : null })
  // 自动检查属于宿主后台机制，页面关闭后仍继续按周期检查。
  ctx.effect(() => startAutomaticChecks(updateChecker), 'kb-core: automatic update checks')
  // R1：UI 与工具共用的导入服务。在 install() 里创建（要等 core 就绪后才拿得到配置）。
  let importService = null
// 第二轮：解析服务（OCR/ASR）。工具、设置页、导入与流程**共用这一个实例**。
let parsingService = null

  const log = (level, message) => {
    const line = `[kb-core] ${level} ${message}`
    if (level === 'warn' || level === 'error') console.error(line)
    else console.log(line)
  }

  /**
   * 唯一构建标识（审查意见 §五 第 4 条）：对**本包实际落盘的 9 个文件**逐个取 sha256 再汇总。
   * 同名同版本号的不同构建 → buildId 必然不同，运行态可核对，不再靠"版本号自称"。
   */
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  // 随包技能：只补缺失文件，失败只告警、不影响工具注册。
  let skillsUpgrade=bootstrapSkills(pkgRoot, log),presetUpgrade=bootstrapPreset(pkgRoot,stateResolved.profileDir,log)
  const buildInfo = { version: PLUGIN_VERSION, buildId: null, files: [], stateDirSource: stateResolved.source, profile: stateResolved.profileDir }
  const buildPromise = (async () => {
    // 2026-10-18：新增 gateway.js / flows.js 两个**装载文件** —— buildId 必须覆盖它们，
    // 否则改了流程实现而 buildId 不变，"构建=版本/buildId"这条唯一硬判据就失效了。
    const list = ['package.json', 'cordis.patch.yml', 'src/host/index.js', 'src/host/kbcore.js', 'src/host/fsindex.js', 'src/host/importer.js', 'src/host/import-service.js', 'src/host/map.js', 'src/host/selftest.js', 'src/host/gateway.js', 'src/host/flows.js', 'src/host/parsing.js', 'src/host/updates.js', 'src/host/flow-workspace.js', 'src/client/index.js', 'src/host/parse-presets.js', 'src/host/parse-credentials.js', 'src/host/parse-native.js', 'src/host/parse-discovery.js', 'src/host/index-maintenance.js', 'tools/kb-local-model.py', 'tools/kb-pdf-pages.py', 'src/host/workbench.js', 'src/host/workbench-state.js', 'src/host/workbench-backup.js', 'src/client/workbench-ui.js', 'src/client/pdfjs/cmaps/78-EUC-H.bcmap', 'src/client/pdfjs/cmaps/78-EUC-V.bcmap', 'src/client/pdfjs/cmaps/78-H.bcmap', 'src/client/pdfjs/cmaps/78-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/78-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/78-V.bcmap', 'src/client/pdfjs/cmaps/78ms-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/78ms-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/83pv-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/90ms-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/90ms-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/90msp-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/90msp-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/90pv-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/90pv-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/Add-H.bcmap', 'src/client/pdfjs/cmaps/Add-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/Add-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/Add-V.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-0.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-1.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-2.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-3.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-4.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-5.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-6.bcmap', 'src/client/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-0.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-1.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-2.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-3.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-4.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-5.bcmap', 'src/client/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-0.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-1.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-2.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-3.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-4.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-5.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-6.bcmap', 'src/client/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap', 'src/client/pdfjs/cmaps/Adobe-Korea1-0.bcmap', 'src/client/pdfjs/cmaps/Adobe-Korea1-1.bcmap', 'src/client/pdfjs/cmaps/Adobe-Korea1-2.bcmap', 'src/client/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap', 'src/client/pdfjs/cmaps/B5-H.bcmap', 'src/client/pdfjs/cmaps/B5-V.bcmap', 'src/client/pdfjs/cmaps/B5pc-H.bcmap', 'src/client/pdfjs/cmaps/B5pc-V.bcmap', 'src/client/pdfjs/cmaps/CNS-EUC-H.bcmap', 'src/client/pdfjs/cmaps/CNS-EUC-V.bcmap', 'src/client/pdfjs/cmaps/CNS1-H.bcmap', 'src/client/pdfjs/cmaps/CNS1-V.bcmap', 'src/client/pdfjs/cmaps/CNS2-H.bcmap', 'src/client/pdfjs/cmaps/CNS2-V.bcmap', 'src/client/pdfjs/cmaps/ETen-B5-H.bcmap', 'src/client/pdfjs/cmaps/ETen-B5-V.bcmap', 'src/client/pdfjs/cmaps/ETenms-B5-H.bcmap', 'src/client/pdfjs/cmaps/ETenms-B5-V.bcmap', 'src/client/pdfjs/cmaps/ETHK-B5-H.bcmap', 'src/client/pdfjs/cmaps/ETHK-B5-V.bcmap', 'src/client/pdfjs/cmaps/EUC-H.bcmap', 'src/client/pdfjs/cmaps/EUC-V.bcmap', 'src/client/pdfjs/cmaps/Ext-H.bcmap', 'src/client/pdfjs/cmaps/Ext-RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/Ext-RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/Ext-V.bcmap', 'src/client/pdfjs/cmaps/GB-EUC-H.bcmap', 'src/client/pdfjs/cmaps/GB-EUC-V.bcmap', 'src/client/pdfjs/cmaps/GB-H.bcmap', 'src/client/pdfjs/cmaps/GB-V.bcmap', 'src/client/pdfjs/cmaps/GBK-EUC-H.bcmap', 'src/client/pdfjs/cmaps/GBK-EUC-V.bcmap', 'src/client/pdfjs/cmaps/GBK2K-H.bcmap', 'src/client/pdfjs/cmaps/GBK2K-V.bcmap', 'src/client/pdfjs/cmaps/GBKp-EUC-H.bcmap', 'src/client/pdfjs/cmaps/GBKp-EUC-V.bcmap', 'src/client/pdfjs/cmaps/GBpc-EUC-H.bcmap', 'src/client/pdfjs/cmaps/GBpc-EUC-V.bcmap', 'src/client/pdfjs/cmaps/GBT-EUC-H.bcmap', 'src/client/pdfjs/cmaps/GBT-EUC-V.bcmap', 'src/client/pdfjs/cmaps/GBT-H.bcmap', 'src/client/pdfjs/cmaps/GBT-V.bcmap', 'src/client/pdfjs/cmaps/GBTpc-EUC-H.bcmap', 'src/client/pdfjs/cmaps/GBTpc-EUC-V.bcmap', 'src/client/pdfjs/cmaps/H.bcmap', 'src/client/pdfjs/cmaps/Hankaku.bcmap', 'src/client/pdfjs/cmaps/Hiragana.bcmap', 'src/client/pdfjs/cmaps/HKdla-B5-H.bcmap', 'src/client/pdfjs/cmaps/HKdla-B5-V.bcmap', 'src/client/pdfjs/cmaps/HKdlb-B5-H.bcmap', 'src/client/pdfjs/cmaps/HKdlb-B5-V.bcmap', 'src/client/pdfjs/cmaps/HKgccs-B5-H.bcmap', 'src/client/pdfjs/cmaps/HKgccs-B5-V.bcmap', 'src/client/pdfjs/cmaps/HKm314-B5-H.bcmap', 'src/client/pdfjs/cmaps/HKm314-B5-V.bcmap', 'src/client/pdfjs/cmaps/HKm471-B5-H.bcmap', 'src/client/pdfjs/cmaps/HKm471-B5-V.bcmap', 'src/client/pdfjs/cmaps/HKscs-B5-H.bcmap', 'src/client/pdfjs/cmaps/HKscs-B5-V.bcmap', 'src/client/pdfjs/cmaps/Katakana.bcmap', 'src/client/pdfjs/cmaps/KSC-EUC-H.bcmap', 'src/client/pdfjs/cmaps/KSC-EUC-V.bcmap', 'src/client/pdfjs/cmaps/KSC-H.bcmap', 'src/client/pdfjs/cmaps/KSC-Johab-H.bcmap', 'src/client/pdfjs/cmaps/KSC-Johab-V.bcmap', 'src/client/pdfjs/cmaps/KSC-V.bcmap', 'src/client/pdfjs/cmaps/KSCms-UHC-H.bcmap', 'src/client/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap', 'src/client/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap', 'src/client/pdfjs/cmaps/KSCms-UHC-V.bcmap', 'src/client/pdfjs/cmaps/KSCpc-EUC-H.bcmap', 'src/client/pdfjs/cmaps/KSCpc-EUC-V.bcmap', 'src/client/pdfjs/cmaps/LICENSE', 'src/client/pdfjs/cmaps/NWP-H.bcmap', 'src/client/pdfjs/cmaps/NWP-V.bcmap', 'src/client/pdfjs/cmaps/RKSJ-H.bcmap', 'src/client/pdfjs/cmaps/RKSJ-V.bcmap', 'src/client/pdfjs/cmaps/Roman.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UCS2-H.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UCS2-V.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UTF16-H.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UTF16-V.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UTF8-H.bcmap', 'src/client/pdfjs/cmaps/UniCNS-UTF8-V.bcmap', 'src/client/pdfjs/cmaps/UniGB-UCS2-H.bcmap', 'src/client/pdfjs/cmaps/UniGB-UCS2-V.bcmap', 'src/client/pdfjs/cmaps/UniGB-UTF16-H.bcmap', 'src/client/pdfjs/cmaps/UniGB-UTF16-V.bcmap', 'src/client/pdfjs/cmaps/UniGB-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniGB-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniGB-UTF8-H.bcmap', 'src/client/pdfjs/cmaps/UniGB-UTF8-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UCS2-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UCS2-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UTF16-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UTF16-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UTF8-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS-UTF8-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap', 'src/client/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap', 'src/client/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap', 'src/client/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap', 'src/client/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap', 'src/client/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniKS-UCS2-H.bcmap', 'src/client/pdfjs/cmaps/UniKS-UCS2-V.bcmap', 'src/client/pdfjs/cmaps/UniKS-UTF16-H.bcmap', 'src/client/pdfjs/cmaps/UniKS-UTF16-V.bcmap', 'src/client/pdfjs/cmaps/UniKS-UTF32-H.bcmap', 'src/client/pdfjs/cmaps/UniKS-UTF32-V.bcmap', 'src/client/pdfjs/cmaps/UniKS-UTF8-H.bcmap', 'src/client/pdfjs/cmaps/UniKS-UTF8-V.bcmap', 'src/client/pdfjs/cmaps/V.bcmap', 'src/client/pdfjs/cmaps/WP-Symbol.bcmap', 'src/client/pdfjs/LICENSE', 'src/client/pdfjs/pdf.mjs', 'src/client/pdfjs/pdf.worker.mjs', 'src/client/pdfjs/standard_fonts/FoxitDingbats.pfb', 'src/client/pdfjs/standard_fonts/FoxitFixed.pfb', 'src/client/pdfjs/standard_fonts/FoxitFixedBold.pfb', 'src/client/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb', 'src/client/pdfjs/standard_fonts/FoxitFixedItalic.pfb', 'src/client/pdfjs/standard_fonts/FoxitSerif.pfb', 'src/client/pdfjs/standard_fonts/FoxitSerifBold.pfb', 'src/client/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb', 'src/client/pdfjs/standard_fonts/FoxitSerifItalic.pfb', 'src/client/pdfjs/standard_fonts/FoxitSymbol.pfb', 'src/client/pdfjs/standard_fonts/LiberationSans-Bold.ttf', 'src/client/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf', 'src/client/pdfjs/standard_fonts/LiberationSans-Italic.ttf', 'src/client/pdfjs/standard_fonts/LiberationSans-Regular.ttf', 'src/client/pdfjs/standard_fonts/LICENSE_FOXIT', 'src/client/pdfjs/standard_fonts/LICENSE_LIBERATION', 'src/client/pdfjs/wasm/jbig2.wasm', 'src/client/pdfjs/wasm/LICENSE_JBIG2', 'src/client/pdfjs/wasm/LICENSE_OPENJPEG', 'src/client/pdfjs/wasm/LICENSE_PDFJS_JBIG2', 'src/client/pdfjs/wasm/LICENSE_PDFJS_OPENJPEG', 'src/client/pdfjs/wasm/LICENSE_PDFJS_QCMS', 'src/client/pdfjs/wasm/LICENSE_QCMS', 'src/client/pdfjs/wasm/openjpeg.wasm', 'src/client/pdfjs/wasm/openjpeg_nowasm_fallback.js', 'src/client/pdfjs/wasm/qcms_bg.wasm', 'browser-extension/manifest.json', 'browser-extension/options.html', 'browser-extension/options.js', 'browser-extension/popup.html', 'browser-extension/popup.js', 'browser-extension/style.css', 'src/host/capture-surface.js', 'src/client/capture.html', 'src/client/capture.js', 'src/client/capture.css', 'src/client/capture-sw.js', 'src/client/capture.webmanifest', 'src/client/capture-icon.svg', 'src/client/capture-icon-192.png', 'src/client/capture-icon-512.png', 'src/host/workbench-question.js', 'src/host/workbench-links.js', 'src/host/workbench-deliverables.js', 'src/client/workbench-theme.css', 'src/client/workbench-features.js', 'src/client/workbench-relations.js', 'src/host/workbench-files.js', 'src/host/workbench-trash.js', 'src/host/workbench-relation-index.js', 'src/host/parse-source-authority.js', 'src/host/versioning.js', 'src/host/retrieval.js', 'src/host/retrieval-api.js', 'src/host/retrieval-chunks.js', 'src/host/retrieval-worker.js', 'RETRIEVAL.md', 'src/host/retrieval-pool.js', 'src/host/managed-files.js', 'src/host/system-upgrades.js', 'presets/01-knowledge-agent.patch.yml', 'skills/personal-knowledge-base/SKILL.md', 'src/host/citation-guard.js', 'browser-extension/background.js', 'browser-extension/icons/knowledge-base-128.png', 'browser-extension/icons/knowledge-base-16.png', 'browser-extension/icons/knowledge-base-32.png', 'browser-extension/icons/knowledge-base-48.png', 'PERFORMANCE.md', 'src/host/retrieval-cache.js', 'src/host/relation-name-lookup.js', 'EXISTING-FRAMEWORK-OPTIMIZATION.md', 'src/host/runtime-resources.js', 'src/host/storage-io.js', 'src/host/index-policy.js', 'src/host/index-policy-service.js', 'src/client/knowledge-ui.css']
    const whole = crypto.createHash('sha256')
    for (const rel of list) {
      try {
        const buf = await readFile(path.join(pkgRoot, rel))
        const one = crypto.createHash('sha256').update(buf).digest('hex')
        buildInfo.files.push({ path: rel, bytes: buf.length, sha256: one })
        whole.update(rel + '\0' + one + '\n')
      } catch {
        buildInfo.files.push({ path: rel, bytes: null, sha256: null, missing: true })
        whole.update(rel + '\0missing\n')
      }
    }
    buildInfo.buildId = whole.digest('hex').slice(0, 16)
    evidence.build = buildInfo
    await flushEvidence()
  })().catch((error) => log('warn', `计算 buildId 失败：${String((error && error.message) ?? error)}`))

  /** 复核 §6-4：宿主构建锚——记下实际运行的可执行文件与 app.asar 的大小/时间，供核对 */
  function describeHostBuild() {
    const info = { execPath: process.execPath, platform: `${process.platform}-${process.arch}`, node: process.version }
    try {
      const res = process.resourcesPath
      if (res) {
        info.resourcesPath = res
        const asar = path.join(res, 'app.asar')
        if (fsExists(asar)) {
          const st = fsStat(asar)
          if (st) {
            info.appAsar = { path: asar, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() }
          }
        }
      }
    } catch (error) {
      info.error = String((error && error.message) ?? error)
    }
    return info
  }

  // 证据：L1 绑定"本次实际构建"的信息，避免常量自称已验证
  const evidence = {
    startedAt,
    plugin: `dsh-knowledge-base@${PLUGIN_VERSION}`,
    stateDir,
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}`, release: os.release() },
    layers: {
      L1_static: {
        verifiedAt: startedAt,
        method: 'offline: 用正确 asar 偏移（8+header_size）读 asar，核对 dsh-tools 的 output 必填串与 directoryFlow 槽位',
        note: '本字段记录的是**引用**，不代表本次启动重新验证；真正运行期证据在 L2/L3',
        // 复核 §6-4：以前只有"启动时刻+方法描述"，补上宿主构建的**可核对锚**
        hostBuild: describeHostBuild(),
      },
      L2_runtime: {},
      L3_operation: {},
    },
    registration: { attempted: [], registered: [], failed: [] },
  }

  async function flushEvidence() {
    try {
      await mkdir(stateDir, { recursive: true })
      await writeFile(path.join(stateDir, 'boot-evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
    } catch (error) {
      log('warn', `写 boot-evidence 失败：${String(error)}`)
    }
  }

  function probeServices() {
    const wanted = ['tools', 'sessions', 'agentPresets', 'configForms', 'credentials', 'profileContext']
    const seen = {}
    for (const key of wanted) {
      try {
        const value = ctx.get(key)
        seen[key] = value === undefined || value === null ? 'absent' : 'present'
      } catch (error) {
        seen[key] = 'threw:' + String((error && error.message) ?? error).slice(0, 60)
      }
    }
    evidence.layers.L2_runtime = { ...seen, at: new Date().toISOString() }
    return seen
  }

  // ── 自定义流程（2026-10-18）───────────────────────────────────────────────
  // 定义与运行记录按 kbId 落 <stateDir>/flows/<kbId>/；执行走 gateway 的**同一条**委派内核
  // （不新建 Agent 运行时）。模型工具、设置页与「立即运行」按钮共用这一个引擎实例。
  // ── 第二轮：解析（OCR/ASR）的宿主侧闸门与流程步骤执行体 ───────────────────
  /**
   * 谁能调用解析工具。
   *
   * 2026-10-18 定向审查缺口 3 的修复：**不再靠会话头里的 agentPreset 字符串**。
   * 现在的判据是三件事同时成立：
   *   ① **活的身份**：`agents.get(agent.id) === agent`（宿主注册表里的同一个对象，
   *      与 H1 authority 的 live() 完全一致）；没有 agents 服务 → 直接拒。
   *   ② **此刻仍有效的 knowledge 授权**：来自 gateway 的实时台账（授予时记、撤销时划掉），
   *      即 `agent_call(target=knowledge)` 真的创建并授权过的那个子代理；已被 revoke /
   *      委派结束 / 会话销毁 → 立刻失效。
   *   ③ **隔离后端就绪**：H1 profile 下 `getStatus().ready !== true` → 拒，且**不退回宿主执行**。
   * 根级知识库会话由宿主/界面选择的预设核验（宿主持久元数据，与 H1 的
   * agent/created 判据同款），无需子代理委派台账；仍要求活对象身份。
   *
   * 非 H1 profile：普通桌面模式核验活的知识库根会话或实时委派授权后放行，
   * 标注 isolation:none。`parse.allowWithoutIsolation:false` 可显式要求 H1。
   * H1 已安装但未就绪仍拒绝，不回退到普通桌面模式。
   *
   * 抽成模块级工厂是为了**可被离线自证**：传桩服务就能复现"伪造会话头被拒 / 撤权后失效 /
   * 后端不就绪被拒"，不必起真宿主（2026-10-18 审查方就是这样复现旧缺口的）。
   */
  const kbParseCaller = createParseCaller((serviceName) => {
    try {
      return ctx.get(serviceName)
    } catch {
      return null
    }
  }, config)
  const parseSources = createParseSourceAuthority({
    getAgents: () => ctx.get('agents'), knowledgeCaller: kbParseCaller,
    getController: () => ctx.get('sessionController'),
    getBinding: async () => { const st = await core?.status(); return st?.kbId && st?.kbPath ? { kbId: st.kbId, kbPath: st.kbPath } : null },
  })
  const kbParseWait = async (jobId, { signal = null, timeoutMs = 600_000 } = {}) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (signal && signal.aborted) return { ok: false, reason: 'canceled', detail: '已取消' }
      const j = await parsingService.readJob(jobId)
      if (j && ['succeeded', 'partial', 'failed', 'canceled'].includes(j.status)) {
        return { ok: j.status === 'succeeded' || j.status === 'partial', status: j.status, job: j }
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return { ok: false, reason: 'timeout-waiting', detail: '等待解析超过上限（任务仍在后台，可稍后查看任务列表）' }
  }
  /** 流程的解析能力步骤：参数里必须有 source（库内相对路径）。缺依赖就明确说未启用。 */
  const kbRunParseStep = async ({ kind, params, signal, flow, run }) => {
    if (parsingService === null) return { ok: false, reason: 'PARSE_NOT_ENABLED', detail: '解析服务未就绪（本插件未接入解析能力）' }
    const src = String((params && (params.source ?? params.Source ?? params.sourceRel)) ?? '').trim()
    if (src === '') return { ok: false, reason: 'missing-param', detail: '解析步骤需要流程参数 source（库内相对路径，如 90-收件箱/原件归档/x.pdf）' }
    const submitted = await parsingService.submit(
      { sourceRel: src, kind: kind ?? undefined, purpose: 'flow-step' },
      { requestedBy: { via: 'tool', origin: 'flow', flowId: flow?.id || null, runId: run?.runId || null } },
    )
    if (!submitted.ok) return { ok: false, reason: submitted.reason, detail: submitted.detail }
    const waited = await kbParseWait(submitted.jobId, { signal, timeoutMs: 15 * 60_000 })
    if (!waited.ok) return { ok: false, reason: waited.reason, detail: waited.detail, jobId: submitted.jobId }
    const job = waited.job
    const preview = String(job.result?.text ?? '').slice(0, 1200)
    const answer = [
      `解析任务 ${job.jobId}（${job.kind}）status=${job.status}`,
      `提供方 ${job.provider.id} / ${job.provider.protocol} / ${job.provider.locality}；原件 ${job.source.relPath}`,
      `结果字符数 ${job.result?.textChars ?? 0}${job.partial ? `；部分失败 ${(job.partial.failedUnits ?? []).length} 处` : ''}`,
      '',
      preview,
    ].join('\n')
    return { ok: true, jobId: job.jobId, status: job.status, answer }
  }

  let flowEngine = null
  let flowEngineCwd = null
  const ensureFlowEngine = async () => {
    const st = core === null ? null : await core.status().catch(() => null)
    const kbPath = st && st.kbPath ? String(st.kbPath) : ''
    if (flowEngine !== null && flowEngineCwd === kbPath) return flowEngine
    const gcfg = config.gateway !== undefined && config.gateway !== null && typeof config.gateway === 'object' ? config.gateway : {}
    const dcfg = Object.assign({}, gcfg)
    const preset = typeof gcfg.flowPreset === 'string' && gcfg.flowPreset !== '' ? gcfg.flowPreset : 'knowledge'
    const brief = typeof gcfg.flowBrief === 'string' && gcfg.flowBrief !== ''
      ? gcfg.flowBrief
      : '按流程步骤逐条执行：只做本步，产出写清楚供后续步骤引用；不要调用其它子代理。'
    // cwd 跟随**当前绑定**：换库后重建实例，流程步骤始终跑在该库目录里（不串库）
    dcfg.targets = [{ id: 'knowledge', preset: preset, cwd: kbPath, describe: '知识库管家（本插件自带，读取与改写个人知识库）', brief: brief, toolName: '' }]
    const inst = createGatewayDelegate(ctx, dcfg)
    flowEngine = createFlowEngine({
      stateDir: stateDir,
      core: core,
      targetId: 'knowledge',
      log: log,
      delegate: async (req) => inst.delegateTo(req.targetId, req.task, req.kind, req.context, { agent: req.parentAgent ?? null, signal: req.signal ?? null, execution: req.execution }, req.label),
      // 第二轮：流程里的 OCR/ASR 能力步骤由**同一个任务服务**执行（不另开捷径）。
      parseStep: async (req) => kbRunParseStep(req),
    })
    flowEngineCwd = kbPath
    log('info', `流程引擎就绪：stateDir=${stateDir} 委派目标=knowledge（cwd=${kbPath === '' ? '(未绑定→回退调用方 cwd)' : kbPath}）`)
    return flowEngine
  }

  /** kb_parse：解析能力的主模型入口；kb_import 的 parse 子动作复用同一调用方闸门。 */
  const parseToolDefs = () => {
    const tool = {
      name: 'kb_parse',
      description:
        '所有 Agent 默认共用的 OCR / ASR 通道。没有指定调用方式时必须使用本工具；只有用户本次明确指定外部工具或脚本才按该方式执行，例外不延续到其他任务。失败不得自动绕过或切换云端。用 sourcePath 提交当前会话工作目录内的文件，或先 action=source 获取十分钟有效且绑定会话的 sourceRef。知识库文件仍要求知识库访问授权；开放解析不授予知识库读写或配置权限。只用设置中当前默认服务，临时文件解析不会自动入库。'
        + '会话提交及测试解析强制使用当前设置的默认 OCR/ASR 服务；不得根据记忆指定其他服务。用户需要单次选择时，请其在解析设置页选择后提交。test-parse 必须提供 kind。'
        + 'action：providers（列出提供方与默认/策略）/ test-connection（只验地址或程序通不通）/ test-parse（真实小样本解析，与连接测试分开）/ submit / jobs / job / result（有界读取，可只取某几页或某几段）/ cancel / retry（解析失败重试；解析成功但落库失败只重试落库）/ land（把底稿按来源落成条目）。'
        + '⚠️ 提供方的新增/修改/删除、程序与参数、凭据引用、外发策略都属**管理面**，只能由用户在「设置 → 个人知识库 → 解析」里改；模型调用这些动作会得到 ADMIN_ONLY。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['source', 'requests', 'providers', 'test-connection', 'test-parse', 'submit', 'jobs', 'job', 'result', 'cancel', 'retry', 'land'],
            description: '要执行的动作（管理面动作不在模型侧提供）',
          },
          // 保留这两个字段：即使有人伪造出管理面 action，也要在 execute 里被 ADMIN_ONLY 挡住，
          // 而不是靠"schema 里没有这个字段"来挡（见 2026-10-18 定向审查 §最小修复）。
          provider: { type: 'object', additionalProperties: true, description: '（管理面，模型侧会被拒）提供方定义' },
          providerId: { type: 'string', description: '连接测试使用；会话 submit/test-parse 始终跟随设置中的默认服务，此字段不能覆盖默认值。单次选择请由用户在设置页操作。' },
          kind: { type: 'string', enum: ['ocr', 'asr'] },
          externalPolicy: { type: 'string', enum: ['local-only', 'allow-configured'], description: '（管理面，模型侧会被拒）' },
          sourceRel: { type: 'string', description: '库内相对路径（不能是绝对路径或含 ..）' },
          sourcePath: { type: 'string', description: '当前会话工作目录内的文件路径，由宿主校验；不能借此访问个人知识库' },
          sourceRef: { type: 'string', description: 'action=source 返回的当前会话文件引用' },
          attachmentId: { type: 'string', description: '当前会话的宿主图片附件编号，不能指定其他会话' },
          purpose: { type: 'string' },
          jobId: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
          pages: { type: 'array', items: { type: 'number' }, description: 'result：只要这些页（OCR）' },
          segments: { type: 'array', items: { type: 'number' }, description: 'result：只要这些段（ASR）' },
          status: { type: 'string' },
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          entryId: { type: 'string', description: 'land：更新已有条目时给出（必须同时给 expectedRevision）' },
          expectedRevision: { type: 'string' },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            reason: { type: 'string' },
            detail: { type: 'string' },
            jobId: { type: 'string' },
            status: { type: 'string' },
          },
        },
        render(_args, v) {
          if (!v || v.ok !== true) return text(`解析操作未完成：${(v && (v.reason || v.detail)) || '未知原因'}`)
          const act = String(v.action ?? '')
          if (act === 'providers') {
            const list = (v.providers ?? []).map((p) => `  · ${p.id} [${p.kind}/${p.protocol}/${p.locality}] ${p.enabled ? '启用' : '停用'}${p.model ? ' model=' + p.model : ''}`)
            return text([`策略 ${v.externalPolicy}；默认 OCR=${v.defaultOcr ?? '未设'} / ASR=${v.defaultAsr ?? '未设'}`, list.length ? '提供方：\n' + list.join('\n') : '（还没有配置任何提供方）'].join('\n'))
          }
          if (act === 'jobs') {
            const rows = (v.jobs ?? []).map((j) => `  · ${j.jobId} ${j.kind} ${j.status} ← ${j.source.relPath}${j.result ? `（${j.result.textChars} 字）` : ''}`)
            return text(rows.length ? `任务（共 ${v.total}）：\n${rows.join('\n')}` : '没有解析任务')
          }
          if (act === 'result') {
            return text(`任务 ${v.jobId} status=${v.status}；本次返回 ${v.returned}/${v.textChars} 字${v.truncated ? '（还有更多，用 offset 续读）' : ''}\n\n${v.text}`)
          }
          if (act === 'job') {
            const j = v.job ?? {}
            return text(`任务 ${j.jobId}：${j.status}/${j.stage}；提供方 ${j.provider?.id ?? '-'}；进度 页 ${j.progress?.pagesDone ?? 0}/${j.progress?.pagesTotal ?? '-'} 段 ${j.progress?.segmentsDone ?? 0}/${j.progress?.segmentsTotal ?? '-'}；落库 ${j.land?.status ?? 'none'}；诊断 ${(j.diagnostics ?? []).length} 条`)
          }
          if (act === 'land') return text(`已落库：${v.land?.entryId ?? v.entryId ?? '-'}（任务 ${v.jobId}）`)
          if (act === 'test-connection') return text(`连接测试：${v.detail ?? '通过'}（延迟 ${v.latencyMs ?? '-'}ms${v.modelPresent === false ? '；模型不在列表' : ''}）—— 这只证明地址/程序通，不证明解析可用`)
          if (act === 'test-parse') return text(`真实小样本解析：${v.status}，${v.textChars ?? 0} 字；预览：${String(v.preview ?? '').slice(0, 120)}`)
          return text(JSON.stringify(v).slice(0, 3000))
        },
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const action = String(args?.action ?? '').trim()
        // 管理面动作**先**拒：即便有人绕过 schema 的枚举（伪造 action / 直接调 execute），
        // 这里也不会把 program/args/credentialRef/externalPolicy 写进配置。
        if (PARSE_ADMIN_ACTIONS.has(action)) {
          return {
            ok: false,
            action,
            reason: 'ADMIN_ONLY',
            detail: `${action} 属管理面（提供方程序/地址/凭据引用/外发策略）：只能在「设置 → 个人知识库 → 解析」里由用户改。模型侧请使用一个已配置好的提供方（providerId）提交解析。`,
          }
        }
        if (parsingService === null) return { ok: false, action, reason: 'PARSE_NOT_READY', detail: '解析服务尚未就绪（core 未安装完成）' }
        let identity
        try { identity = parseSources.caller(exec) } catch (error) { return { ok: false, action, reason: error.code, detail: error.message } }
        const gate = kbParseCaller(exec), knowledge = gate.ok === true
        const requestedBy = { via: 'tool', origin: 'agent', gate: knowledge ? gate.via : 'managed-workspace', session: identity.session, agent: String(identity.agent.id), preset: identity.agent.session?.header?.agentPreset || null }
        const owned = job => knowledge && !job.source?.external || job.requestedBy?.session === identity.session
        const filter = async jobs => workbench.filterJobs(jobs.filter(owned))
        try {
          let authorizedSource, sourceRel = String(args?.sourceRel || '')
          if (['source', 'submit', 'test-parse'].includes(action)) {
            if ([args?.attachmentId, args?.sourcePath, args?.sourceRef, sourceRel].filter(Boolean).length > 1) throw Object.assign(new Error('请选择一种来源方式'), { code: 'BAD_SOURCE' })
            if (args?.attachmentId) {
              const ref = await parseSources.issueAttachment(args.attachmentId, exec)
              if (action === 'source') return { ok: true, action, ...ref }
              authorizedSource = await parseSources.resolve(ref.sourceRef, exec)
            } else if (args?.sourcePath) {
              const ref = await parseSources.issue(args.sourcePath, exec)
              if (action === 'source') return { ok: true, action, ...ref }
              if (ref.sourceRel) sourceRel = ref.sourceRel
              else authorizedSource = await parseSources.resolve(ref.sourceRef, exec)
            } else if (args?.sourceRef) authorizedSource = await parseSources.resolve(args.sourceRef, exec)
            if (!authorizedSource) {
              if (!knowledge) throw Object.assign(new Error(gate.detail || '知识库文件仍需知识库授权；普通文件请使用 sourcePath'), { code: gate.reason || 'KNOWLEDGE_DELEGATION_REQUIRED' })
              await workbench.assertDisplay(sourceRel)
            }
          }
          if (['job', 'result', 'cancel', 'retry', 'land'].includes(action)) {
            const job = await parsingService.readJob(String(args?.jobId || ''))
            if (!job || !owned(job)) return { ok: false, action, reason: 'JOB_DENIED', detail: '任务不存在或不属于当前会话' }
            await workbench.filterJobs([job]).then(rows => { if (!rows.length) throw Object.assign(new Error('任务来源不可见'), { code: 'PRIVATE_HIDDEN' }) })
          }
          if (action === 'land' && !knowledge) return { ok: false, action, reason: 'KNOWLEDGE_DELEGATION_REQUIRED', detail: '入库需要单独的知识库写入授权，请委派知识库 Agent' }
          switch (action) {
            case 'requests': return { ...(await parsingService.listRequests({ limit: args?.limit, offset: args?.offset, kind: args?.kind, filter })), action }
            case 'providers':
              return { ...(await parsingService.providersPublic()), action }
            case 'test-connection':
              return { ...(await parsingService.testConnection(String(args?.providerId ?? ''))), action }
            case 'test-parse':
              return {
                ...(await parsingService.testParse(
                  { providerId: String(args?.providerId ?? ''), sourceRel, kind: args?.kind },
                  { requestedBy, authorizedSource },
                )),
                action,
              }
            case 'submit':
              return {
                ...(await parsingService.submit(
                  { sourceRel, kind: args?.kind, providerId: args?.providerId, purpose: args?.purpose },
                  { requestedBy, authorizedSource },
                )),
                action,
              }
            case 'jobs':
              return { ...(await parsingService.listJobs({ limit: args?.limit, offset: args?.offset, kind: args?.kind ?? null, status: args?.status ?? null, filter })), action }
            case 'job': {
              const job = await parsingService.readJob(String(args?.jobId ?? ''))
              if (!job) return { ok: false, action, reason: 'not-found', detail: '没有这个任务' }
              return { ok: true, action, job: parsingService.publicJob(job) }
            }
            case 'result':
              return {
                ...(await parsingService.readResult(String(args?.jobId ?? ''), {
                  offset: args?.offset,
                  limit: args?.limit,
                  pages: Array.isArray(args?.pages) ? args.pages.map(Number) : null,
                  segments: Array.isArray(args?.segments) ? args.segments.map(Number) : null,
                })),
                action,
              }
            case 'cancel':
              return { ...(await parsingService.cancel(String(args?.jobId ?? ''), { by: requestedBy })), action }
            case 'retry':
              return { ...(await parsingService.retry(String(args?.jobId ?? ''), { reason: '工具重试' })), action }
            case 'land':
              return {
                ...(await parsingService.land(String(args?.jobId ?? ''), {
                  title: args?.title,
                  kind: args?.kind,
                  tags: args?.tags,
                  entryId: args?.entryId,
                  expectedRevision: args?.expectedRevision,
                })),
                action,
              }
            default:
              return { ok: false, action, reason: 'unknown-action', detail: '未知 action：' + action + '（模型侧可用：providers / test-connection / test-parse / submit / jobs / job / result / cancel / retry / land；提供方管理在设置页）' }
          }
        } catch (error) {
          const failure = { ok: false, action, reason: error.code || 'parse-op-failed', detail: String((error && error.message) ?? error) }
          if (['source', 'submit', 'test-parse'].includes(action)) return { ...failure, ...await parsingService.recordRejection({ kind: args?.kind, requestedBy, failure }) }
          return failure
        }
      },
    }
    return [tool]
  }

  /** kb_flow / kb_flow_resolve 的工具定义（与 flowEngine 共用同一份状态） */
  const flowToolDefs = () => {
    const flowTool = {
      name: 'kb_flow',
      description: '自定义流程：把用户固化的固定步骤存成有版本的定义并执行。action=list 紧凑索引（id/名称/触发语/用途/启用/最近运行，不含步骤正文）/ get 取完整定义 / save 新建或更新（更新必须带 expectedRevision；不符返回 conflict 且**不改盘**）/ set-enabled 启用或停用 / run 立即运行（用 id 或一句能命中触发语的话；固定 kbId+flowRevision+params+runId，同一 runId 不重复执行；同一流程不允许并发）/ runs 运行记录 / cancel 取消（真中断，不是隐藏界面）/ archive 软删除（可恢复，运行记录保留）。执行通过已安装宿主的委派能力把每一步交给知识库子代理完成；成功才按 outputRules 落库，失败或取消绝不记为成功。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'save', 'set-enabled', 'run', 'runs', 'cancel', 'archive'] },
          id: { type: 'string', description: '流程 id（get / save 更新 / set-enabled / run / archive 用）' },
          text: { type: 'string', description: '用户原话：run 时可用它替代 id（按触发语解析命中哪条流程）' },
          flow: { type: 'object', additionalProperties: true, description: 'save 的完整定义（省略 id = 新建）：name/triggers/description/params/steps/capabilities/outputRules/enabled' },
          expectedRevision: { type: 'number', description: '更新必填：先 list 或 get 取当前 revision' },
          enabled: { type: 'boolean', description: 'set-enabled 的目标状态' },
          restored: { type: 'boolean', description: 'archive 传 true = 取消归档（恢复）' },
          includeArchived: { type: 'boolean', description: 'list 是否包含已归档（默认不含）' },
          params: { type: 'object', additionalProperties: true, description: 'run 的参数值（缺省用定义里的 default）' },
          runId: { type: 'string', description: 'run 的幂等键：重试请复用同一个值（同一 runId 直接返回既有记录）' },
          limit: { type: 'number', description: 'runs 返回条数（默认 20）' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            reason: { type: 'string' },
            error: { type: 'string' },
            kbId: { type: 'string' },
            flow: { type: 'object', additionalProperties: true },
            flows: { type: 'array', items: { type: 'object', additionalProperties: true } },
            run: { type: 'object', additionalProperties: true },
            runId: { type: 'string' },
            runs: { type: 'array', items: { type: 'object', additionalProperties: true } },
            deduplicated: { type: 'boolean' },
          },
          required: ['ok', 'action'],
        },
        render(_args, v) {
          const head = `流程 ${v.action ?? '-'}：${v.ok ? 'OK' : '失败'}${v.reason ? '（' + v.reason + '）' : ''}`
          const lines = [head]
          if (v.error) lines.push('  原因：' + v.error)
          if (Array.isArray(v.flows)) {
            lines.push(`  共 ${v.flows.length} 条（kbId=${String(v.kbId ?? '-').slice(0, 8)}）`)
            for (const f of v.flows) {
              const last = f.lastRun ? `最近 ${f.lastRun.startedAt ?? '-'} → ${f.lastRun.status}` : '尚未运行'
              lines.push(`  · ${f.name} [${f.id}] v${f.revision} ${f.enabled ? '启用' : '停用'}${f.archived ? '（已归档）' : ''}｜触发语：${(f.triggers ?? []).join('/')}｜${last}`)
            }
          }
          if (v.flow && v.flow.steps) {
            lines.push(`  ${v.flow.name} [${v.flow.id}] v${v.flow.revision} ${v.flow.enabled ? '启用' : '停用'}｜触发语：${(v.flow.triggers ?? []).join('/')}`)
            lines.push(`  用途：${v.flow.description || '（未写）'}`)
            for (const [i, s] of v.flow.steps.entries()) lines.push(`  ${i + 1}. ${s.title}${s.capability ? '（' + s.capability + '）' : ''}：${String(s.instruction ?? '').slice(0, 60)}`)
            const r = v.flow.outputRules ?? {}
            lines.push(`  输出规则：落库=${r.land ? '是' : '否'} 类型=${r.kind} 时区=${r.tz} 窗口=${r.windowDays} 天`)
          }
          if (v.flow && !v.flow.steps && v.flow.name) lines.push(`  ${v.flow.name} [${v.flow.id}] v${v.flow.revision}`)
          if (v.run && v.run.status) {
            lines.push(`  运行 ${v.run.runId}：${v.run.status}${v.deduplicated ? '（同一 runId 已有记录，未重复执行）' : ''}`)
            for (const [i, s] of (v.run.steps ?? []).entries()) lines.push(`   ${i + 1}. ${s.title} — ${s.status}${s.error ? '：' + s.error : ''}`)
            if (v.run.landedEntryId) lines.push('  已落库：entryId=' + v.run.landedEntryId + (v.run.landedPath ? ' path=' + v.run.landedPath : ''))
            if (v.run.error) lines.push('  失败原因：' + v.run.error)
          }
          if (v.runId && (!v.run || !v.run.status)) lines.push('  runId=' + v.runId)
          if (Array.isArray(v.runs)) {
            lines.push(`  共 ${v.runs.length} 条运行记录`)
            for (const r of v.runs) lines.push(`  · ${r.runId} ${r.flowName ?? ''} → ${r.status}（${r.startedAt ?? '-'}，步骤 ${r.stepDone ?? 0}/${r.stepTotal ?? 0}）${r.landedEntryId ? ' 落库=' + r.landedEntryId : ''}${r.error ? ' 原因=' + r.error : ''}`)
          }
          return text(lines.join('\n'))
        },
      },
      isConcurrencySafe() {
        return false
      },
      async execute(args, exec) {
        const action = String(args?.action ?? '')
        let engine
        try {
          engine = await ensureFlowEngine()
        } catch (error) {
          return { ok: false, action: action, reason: 'engine-unavailable', error: String((error && error.message) ?? error) }
        }
        try {
          if (action === 'list') return Object.assign({ action: action }, await engine.list({ includeArchived: args?.includeArchived === true }))
          if (action === 'get') return Object.assign({ action: action }, await engine.get(args?.id))
          if (action === 'save') return Object.assign({ action: action }, await engine.save({ flow: args?.flow, expectedRevision: args?.expectedRevision }))
          if (action === 'set-enabled') return Object.assign({ action: action }, await engine.setEnabled(args?.id, args?.enabled === true))
          if (action === 'archive') return Object.assign({ action: action }, await engine.archive(args?.id, args?.restored === true))
          if (action === 'run') {
            // 工具路径**继承了调用方的模型路由**（gateway 的父级分支），不需要借路由
            const res = await engine.run({
              id: args?.id,
              text: args?.text,
              params: args?.params,
              runId: args?.runId,
              parentAgent: exec !== undefined && exec !== null ? (exec.agent ?? null) : null,
              signal: exec !== undefined && exec !== null ? (exec.signal ?? null) : null,
            })
            evidence.layers.L3_operation['kb_flow_run'] = { at: new Date().toISOString(), ok: res.ok === true, status: res.status ?? null, reason: res.reason ?? null }
            await flushEvidence()
            return Object.assign({ action: action }, res)
          }
          if (action === 'runs') return Object.assign({ action: action }, await engine.runs({ flowId: args?.id, runId: args?.runId, limit: args?.limit }))
          if (action === 'cancel') return Object.assign({ action: action }, await engine.cancel(args?.runId ?? args?.id))
          return { ok: false, action: action, reason: 'bad-action', error: 'action 只支持 list / get / save / set-enabled / run / runs / cancel / archive' }
        } catch (error) {
          return { ok: false, action: action, reason: 'runner-error', error: String((error && error.message) ?? error) }
        }
      },
    }
    const resolveTool = {
      name: 'kb_flow_resolve',
      description: '把一段用户原话拿去比对**已启用且未归档**流程的触发语，返回 hit（唯一命中，并说明命中的是哪条 trigger）/ ambiguous（多个流程都命中，列出候选让用户选）/ miss（没有命中）。同时标出"像是提及而不是命令"的情况（否定句、假设句、文档引用式措辞），那种情况不要直接运行，先问用户。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string', description: '用户原话（整句，不要只截触发语）' } },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            status: { type: 'string' },
            matched: { type: 'array', items: { type: 'object', additionalProperties: true } },
            guarded: { type: 'boolean' },
            guardReasons: { type: 'array', items: { type: 'string' } },
            coverage: { type: 'object', additionalProperties: true },
          },
          required: ['ok', 'status'],
        },
        render(_args, v) {
          if (!v.ok) return text('解析失败：' + (v.error ?? v.reason ?? '-'))
          if (v.status === 'miss') return text(`未命中任何启用中的流程（比对范围：${v.coverage?.flows ?? 0} 条流程）。可以说流程名，或先 kb_flow(list) 看有哪些。`)
          const lines = [v.status === 'hit' ? '命中 1 条流程：' : '命中多条（需要用户选一条）：']
          for (const m of v.matched ?? []) lines.push(`  · ${m.name} [${m.flowId}] ← 触发语「${m.trigger}」`)
          if (v.guarded) {
            lines.push('注意：这更像"提到"而不是"要求执行"，不要直接运行：')
            for (const r of v.guardReasons ?? []) lines.push('  - ' + r)
          }
          return text(lines.join('\n'))
        },
      },
      isConcurrencySafe() {
        return true
      },
      async execute(args) {
        try {
          const engine = await ensureFlowEngine()
          return await engine.resolve(args?.text)
        } catch (error) {
          return { ok: false, status: 'error', reason: 'engine-unavailable', error: String((error && error.message) ?? error) }
        }
      },
    }
    // HTTP/落盘记录保留 null；工具契约的顶层 reason/error 声明为 string。
    // 在统一返回边界归一化，覆盖成功、失败、去重、取消等所有 action。
    const executeFlow = flowTool.execute
    flowTool.execute = async (args, exec) => {
      const result = await executeFlow(args, exec)
      const value = { ...result }
      for (const key of ['reason', 'error']) if (value[key] === null) value[key] = ''
      return value
    }
    return [flowTool, resolveTool]
  }

  function toolDefs() {
    return [
      ...[
        ['kb_inbox', '列出待整理归档的原件（包含排除索引分区中的待整理资料），不经过搜索索引。action=list 可分页。完成一份归档后 action=complete，提供原件 path 和归档笔记 entryPath；笔记必须有 source 指向原件。使用 kb_record action=create 并填写 source，系统自动继承排除状态和目标分区；不得自行取消用户的排除规则。', { action: { type: 'string', enum: ['list','complete'] }, path: { type: 'string' }, entryPath: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, ['action'], 'inbox.'],
        ['kb_question_search', '用户消息含 @[基于知识库回答…](dsh-kb:UUID) 时，UUID 即 questionId，请先用本工具检索后再作答，不要把引用参数当作答案。按知识库引用检索，最多返回五条摘要；来源含可直接复制的 citation 字段，引用时照抄；先将今天/昨天换成实际日期。证据足够不重复搜索或机械读取；缺少条件或存在冲突才补查，必要的多轮取证仍允许。若返回 retrievalDisclosure，最终回答末尾应列出其中的真实检索过程，多次调用合并展示。必要时用 kb_question_read 补齐原文，回答前用 kb_validate_citations 做一次证据审查和引用校验；仅有具体缺口、冲突或无效引用时再处理。', { questionId: { type: 'string' }, query: { type: 'string' } }, ['questionId','query'], 'question.search'],
        ['kb_question_read', '读取本次知识库检索来源的指定行附近内容（最多6000字符）；引用时照抄 source.citation 字段。', { questionId: { type: 'string' }, sourceId: { type: 'string' }, line: { type: 'number' } }, ['questionId','sourceId'], 'question.read'],
        ['kb_relation_review', '读取用户主动发起的链接修复讨论，或提交候选建议；只提建议，不修改原文件。', { requestId: { type: 'string' }, path: { type: 'string' }, action: { type: 'string', enum: ['inspect','read','propose'] }, proposals: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, target: { type: 'string' }, reason: { type: 'string' } }, required: ['id','target','reason'], additionalProperties: false } } }, ['requestId','action'], 'links.ai.'],
        ['kb_deliverable', '准备当前知识库下的任务成品目录，或登记生成的文件和检索正文。默认隐私；来源含隐私时不能登记为公开。', { action: { type: 'string', enum: ['prepare','register'] }, task: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' }, description: { type: 'string' }, title: { type: 'string' }, private: { type: 'boolean' }, sources: { type: 'array', items: { type: 'string' } } }, ['action','task'], 'deliverables.'],
      ].map(([name, description, properties, required, operation]) => ({ name, description, parameters: { type: 'object', additionalProperties: false, properties, required }, output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' } }, required: ['ok'] }, render: (_a, value) => text(JSON.stringify(value)) }, isConcurrencySafe: () => !name.includes('deliverable'),
        async execute(args, exec) {
          try {
            const agent = exec?.agent
            if (!agent || ctx.get('agents')?.get(agent.id) !== agent) return { ok: false, reason: 'CALLER_UNVERIFIED' }
            if (name === 'kb_deliverable' || name === 'kb_inbox') { const header=agent.session?.header || {}; if (!isLiveKnowledgeGrant(agent,ctx.get('agents')) && !(header.agentPreset==='knowledge' && header.origin!=='subagent' && !header.parentSession)) return {ok:false,reason:'KNOWLEDGE_DELEGATION_REQUIRED',error:'此操作需要知识库授权会话'} }
            const b = await workbench.binding()
            return await workbench.dispatch({ ...args,signal:exec?.signal, expectedKbId: b.st.kbId, op: operation.endsWith('.') ? operation + args.action : operation }, agent.id)
          } catch (e) { return { ok: false, reason: e.code || 'WORKBENCH_ERROR', error: e.code ? e.message : '知识库工具执行失败' } }
        } })),
      {
        name: 'kb_validate_citations',
        description: '校验本次 @知识库提问中的可点击 [S编号](<来源链接>) 引用，检查来源、版本、行号和隐私权限；没有 Markdown 链接或未用尖括号包裹的链接均视为无效。回答前审查关键条件覆盖与冲突，可用 review 报告。missingCitations=true 或引用无效时先补齐真实来源并重新校验，不能无引用作知识库事实回答；ready 时保留草稿引用直接回答，supplement-needed 时针对缺口补查。新版协议只返回校验和检索说明；需要完整答案可设 returnAnswer=true。最终回答必须保留 valid[].citations 的可点击来源链接，遵循 nextAction；按 retrievalDisclosure.footer 追加说明，关闭时不追加，流程说明不能代替来源。',
        parameters: { type: 'object', additionalProperties: false, required: ['questionId', 'answer'], properties: { questionId: { type: 'string' }, answer: { type: 'string' },returnAnswer:{type:'boolean'},review:{type:'object',additionalProperties:false,required:['coverage','gaps','conflicts'],properties:{coverage:{type:'string',enum:['sufficient','insufficient','uncertain']},gaps:{type:'array',items:{type:'string'}},conflicts:{type:'array',items:{type:'string'}}}} } },
        output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' } }, required: ['ok'] }, render: (_a, v) => text(JSON.stringify(v)) },
        isConcurrencySafe: () => true,
        async execute(args, exec) { try { const agent = exec?.agent; if (!agent || ctx.get('agents')?.get(agent.id) !== agent) return { ok: false, reason: 'CALLER_UNVERIFIED' }; return await workbench.dispatch({ op: 'question.validate', questionId: args.questionId, answer: args.answer,review:args.review,returnAnswer:args.returnAnswer }, agent.id) } catch (error) { return { ok: false, reason: error.code || 'VALIDATION_FAILED' } } },
      },
      {
        name: 'kb_status',
        description: '查看知识库状态：绑定路径、初始化与健康状态（healthy/healthReason）、条目数、配置状态与 revision、状态目录。配置损坏时会明确报 degraded 并给恢复入口。只读。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { kbPath: { type: 'string' }, healthy: { type: 'boolean' } }, required: ['kbPath', 'healthy'] },
          render(_a, v) {
            const build = v.build && v.build.buildId ? `\n  构建=${v.build.version}/${v.build.buildId}（stateDir 来源=${v.build.stateDirSource ?? '-'}）` : ''
            return text(`状态：${v.kbPath}\n  初始化=${v.initialized} 健康=${v.healthy}(${v.healthReason})\n  条目=${v.counts?.entries} 索引=${v.counts?.indexState}\n  配置=${v.config?.state}(ok=${v.config?.ok}) revision=${v.config?.revision}\n  状态目录=${v.stateDir}${build}` + (v.healthDetail ? `\n  说明：${v.healthDetail}` : '') + (v.config?.recovery ? `\n  恢复：${v.config.recovery}` : ''))
          },
        },
        isConcurrencySafe: () => true,
        async execute() {
          return { ...(await core.status()), build: buildInfo }
        },
      },
      {
        name: 'kb_bind',
        description:
          '把知识库绑定到一个目录。**全新目录**：不传 confirmInit 时只返回预览（将创建什么），传 confirmInit=true 才真正初始化；初始化完成后自动同步 kbId 到绑定记录。**已有库**：接入但不覆盖任何既有文件。目录名写错或不可写会明确报错。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: '知识库根目录的绝对路径' },
            confirmInit: { type: 'boolean', description: 'true = 确认在全新目录里执行初始化；缺省只返回预览' },
          },
          required: ['path'],
        },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, needsConfirm: { type: 'boolean' }, kbPath: { type: 'string' } }, required: ['ok', 'kbPath'] },
          render(_a, v) {
            if (v.needsConfirm) return text(`预览（尚未改动任何文件）：${v.kbPath}\n将创建：${(v.willCreate ?? []).join('、')}\n确认请再调用一次并传 confirmInit=true。`)
            if (!v.ok) return text(`绑定失败：${v.kbPath}\n原因：${v.reason ?? v.note ?? '未知'}${v.recovery ? '\n恢复：' + v.recovery : ''}`)
            return text(`绑定成功：${v.kbPath}\n  已初始化=${v.alreadyInitialized || v.initialized} kbId=${v.kbId}\n  ${v.note ?? ''}`)
          },
        },
        isConcurrencySafe: () => false,
        async execute(args) {
          const result = await core.bind(args.path, { confirmInit: args.confirmInit === true })
          evidence.layers.L3_operation.kb_bind = { at: new Date().toISOString(), ok: result.ok, needsConfirm: result.needsConfirm ?? false }
          await flushEvidence()
          return result
        },
      },
      {
        name: 'kb_init',
        description: '对**当前绑定的知识库**执行初始化或补齐未完成的初始化（幂等）。半初始化会补齐分类目录/INDEX/模板，并把 installState 置为 complete。已有完整库调用它不会改动任何文件。',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, installState: { type: 'string' } }, required: ['ok', 'installState'] },
          render(_a, v) {
            if (!v.ok) return text(`初始化未完成：installState=${v.installState} reason=${v.reason ?? '-'} detail=${v.detail ?? '-'}`)
            return text(`初始化完成：kbId=${v.kbId}\n  新建：${(v.created ?? []).join('、') || '无'}\n  补齐：${(v.repaired ?? []).join('、') || '无'}\n  跳过：${(v.skipped ?? []).length} 项\n  健康=${v.health?.healthy}(${v.health?.reason})`)
          },
        },
        isConcurrencySafe: () => false,
        async execute() {
          const result = await core.init()
          evidence.layers.L3_operation.kb_init = { at: new Date().toISOString(), ok: result.ok, installState: result.installState }
          await flushEvidence()
          return result
        },
      },
      {
        name: 'kb_record',
        description:
          '写入或更新一条知识条目。create 返回 entryId 与 revision；**update 必须带 entryId 与非空 expectedRevision**（不带直接拒绝），版本不符返回 conflict 且不改文件；写前自动备份。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', description: 'create 或 update' },
            kind: { type: 'string', description: '知识 / 项目 / 人物 / 素材 / 画像（create 必填）' },
            title: { type: 'string' },
            content: { type: 'string', description: '正文（Markdown）' },
            tags: { type: 'array', items: { type: 'string' } },
            source: { type: 'string', description: '派生自哪份原件（库内相对路径）' },
            entryId: { type: 'string', description: 'update 必填' },
            expectedRevision: { type: 'string', description: 'update 必填，非空' },
            patch: { type: 'object', additionalProperties: true, description: 'update 的字段级修改' },
            requestId: { type: 'string', description: '幂等请求标识（可选）：网络/中断后重试请传同一个值，重试不会重复建条目；用户主动再建请换新值' },
          },
          required: ['action'],
        },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, entryId: { type: 'string' }, revision: { type: 'string' }, conflict: { type: 'boolean' } }, required: ['ok'] },
          render(_a, v) {
            if (v.conflict) return text(`写入冲突（未覆盖）：${v.diffSummary}\n当前 revision=${v.currentRevision}`)
            if (!v.ok) return text(`写入失败：${v.reason ?? '-'}${v.detail ? ' — ' + v.detail : ''}`)
            if (v.partial) return text(`条目已写入但索引未同步：entryId=${v.entryId} rev=${v.revision} path=${v.path}\n（已登记 recover-todo，可跑 kb_check 带 recover=true 修复）`)
            return text(`写入成功：entryId=${v.entryId} rev=${v.revision} path=${v.path}${v.changed ? ' 改动=' + v.changed.join(',') : ''}`)
          },
        },
        isConcurrencySafe: () => false,
        async execute(args) {
          const action = String(args.action ?? '').toLowerCase()
          // D：工具层就卡住，不让"省略版本"走到 core
          if (action === 'update' && (typeof args.expectedRevision !== 'string' || args.expectedRevision.trim() === '')) {
            return { ok: false, reason: 'revision-required', detail: 'update 必须在参数里带非空 expectedRevision（先用 kb_search 取当前 revision）' }
          }
          let result
          if (action === 'create') {
            if (!args.title || !args.content) return { ok: false, reason: 'missing-fields', detail: 'create 需要 title 与 content' }
            result = await core.createEntry(args)
          } else if (action === 'update') {
            if (!args.entryId) return { ok: false, reason: 'entry-required', detail: 'update 需要 entryId' }
            result = await core.updateEntry(args)
          } else {
            return { ok: false, reason: 'bad-action', detail: 'action 只支持 create / update' }
          }
          evidence.layers.L3_operation['kb_record_' + action] = { at: new Date().toISOString(), ok: result.ok, reason: result.reason ?? null, conflict: result.conflict ?? false }
          await flushEvidence()
          // R4：写成功后消费一次恢复记录（第二个固定触发点；启动时还有一个）。忙时跳过、下次补。
          if (result.ok === true) {
            try {
              const recovered = await core.maybeRecover()
              if (recovered && recovered.consumed > 0) log('info', `写后自动恢复：消费 ${recovered.consumed} 条恢复记录`)
            } catch (error) {
              log('warn', `写后自动恢复失败（不影响本次写入）：${String((error && error.message) ?? error)}`)
            }
          }
          return result
        },
      },
      {
        name: 'kb_search',
        description: '检索知识库：索引层（标题/标签/类型）+ 正文全文。索引缺失或损坏时**自动改为扫描磁盘兜底**并在结果里说明；无命中时明确说"未找到"并给检索覆盖范围。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { query: { type: 'string' }, limit: { type: 'number', description: '默认 5，最大 20' }, retrievalMode: { type:'string', enum:['exact','fulltext','semantic','hybrid'] } },
          required: ['query'],
        },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { hits: { type: 'array', items: { type: 'object', additionalProperties: true } }, coverageNote: { type: 'string' } }, required: ['hits', 'coverageNote'] },
          render(_a, v) {
            if (!v.ok) return text(`检索失败：${v.reason ?? '-'}`)
            if (v.hits.length === 0) return text(v.coverageNote+(v.retrievalDisclosure?'\n\n'+v.retrievalDisclosure.instruction:''))
            const lines = v.hits.map((h, i) => `${i + 1}. ${h.title} — ${h.path}  (rev ${h.revision ?? '-'})\n   ${h.snippet}`)
            return text(`命中 ${v.hits.length} 条（mode=${v.mode}）：\n${lines.join('\n')}\n\n${v.coverageNote}${v.retrievalDisclosure?'\n\n'+v.retrievalDisclosure.instruction:''}`)
          },
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          let result
          try {
            const found = await workbench.dispatch({ op:'search.list',mode:'body',q:args.query,retrievalMode:args.retrievalMode,limit:Math.max(1,Math.min(20,args.limit||5)) })
            result = { ...found,ok:true,hits:found.items.map(h=>({...h,revision:h.revision?.slice(0,12)||null})) }
          } catch (error) {
            result = {ok:false,hits:[],reason:error.code||'SEARCH_ERROR',coverageNote:'统一检索未完成，请重试；未返回过期或权限不明的结果。'}
          }
          evidence.layers.L3_operation.kb_search = { at: new Date().toISOString(), ok: result.ok, hits: result.hits?.length ?? 0, mode: result.mode }
          await flushEvidence()
          return result
        },
      },
      {
        name: 'kb_check',
        description: '检查知识库：先取旧索引快照，再报"增/删/改"差异与缺陷（缺文件、缺字段、非法 frontmatter、扫描错误）。execution（能否完整扫描）与 quality（内容是否干净）分开报。recover=true 时消费 recover-todo 并重建索引。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: { rebuild: { type: 'boolean' }, recover: { type: 'boolean' } },
        },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { execution: { type: 'string' }, quality: { type: 'string' }, defects: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['execution', 'quality'] },
          render(_a, v) {
            if (!v.ok) return text(`检查失败：${v.reason ?? '-'}`)
            const head = `检查：execution=${v.execution} quality=${v.quality} healthy=${v.healthy}(${v.healthReason}) 条目=${v.counts?.entries} 缺陷=${v.defects.length}`
            const diff = `差异：新增 ${v.diff?.added?.length ?? 0} / 删除 ${v.diff?.removed?.length ?? 0} / 修改 ${v.diff?.changed?.length ?? 0}`
            const list = v.defects.slice(0, 12).map((d) => `  · [${d.kind}] ${d.path} — ${d.detail}`)
            return text([head, diff, ...list].join('\n'))
          },
        },
        isConcurrencySafe: () => false,
        async execute(args) {
          // 与自检共用同一条路径：recover 的前置闸门在 drainRecoverTodo 里
          return core.checkEntry(args ?? {})
        },
      },
      {
        name: 'kb_import',
        description: '导入异构资料 / 旧库，与设置页共用同一后端流程。action=plan：只读冻结源清单（含逐文件 sha256、跳过目录、截断情况），不写任何东西；action=run：按清单执行（可中断、可重试、同一文件不重复建条目）；action=status：看阶段与成功/待处理/失败计数；action=cancel：中止；action=waiting：列出该导入任务里"待解析/待识别"的项（含建议的解析类型与是否可解析）；action=parse：仅知识库授权会话且 H1 就绪时可用，把其中一项交给解析服务（只解析、不自动落库，落库用 kb_parse action=land）。mode=attach 接入原目录（原件留原位）/ copy 复制导入（原件进 90-收件箱）。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['plan', 'run', 'status', 'cancel', 'waiting', 'parse'] },
            source: { type: 'string', description: '源文件夹绝对路径（plan 必填）' },
            mode: { type: 'string', enum: ['attach', 'copy'], description: '默认 attach' },
            importId: { type: 'string', description: 'run/status/cancel/waiting/parse 必填（plan 会返回）' },
            rel: { type: 'string', description: 'parse：导入清单里的相对路径' },
            kind: { type: 'string', enum: ['ocr', 'asr'], description: 'parse：解析类型（不填按扩展名推断）' },
            providerId: { type: 'string', description: '兼容旧请求保留；会话导入解析始终使用设置中的默认服务，忽略此字段' },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
              ok: { type: 'boolean' },
              importId: { type: 'string' },
              mode: { type: 'string' },
              stage: { type: 'string' },
              counts: { type: 'object', additionalProperties: true },
              error: { type: 'string' },
            },
          },
          render(_a, v) {
            if (!v.ok && v.error) return text(`导入失败：${v.error}`)
            const c = v.counts ?? {}
            const lines = [
              `导入 ${v.importId ?? '-'}（mode=${v.mode ?? '-'} stage=${v.stage ?? '-'}）`,
              `  成功 ${c.done ?? 0} / 待处理 ${c.pending ?? 0} / 失败 ${c.failed ?? 0} / 跳过 ${c.skipped ?? 0}（源文件 ${c.total ?? 0}）`,
              `  条目 ${c.entries ?? 0}；待解析/待识别 ${c.waiting ?? 0}`,
            ]
            if (v.source) lines.push(`  源：${v.source}`)
            if (v.started) lines.push('  已在后台开始执行；用 action=status 查看进度')
            if (Array.isArray(v.recent) && v.recent.length) lines.push('  失败项：' + v.recent.slice(0, 5).map((r) => `${r.rel}（${r.error}）`).join('；'))
            return text(lines.join('\n'))
          },
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const action = String(args?.action ?? '')
          if (importService === null) return { ok: false, error: '导入服务尚未就绪（core 未安装完成）' }
          // R1：模型工具与设置页走**同一个**服务；任务目标由清单固定，不跟随当前绑定
          if (action === 'plan') {
            const source = String(args?.source ?? '')
            if (source.trim() === '') return { ok: false, error: 'plan 需要 source' }
            const mode = args?.mode === 'copy' ? 'copy' : 'attach'
            const cur = await core.status()
            const planned = await importService.plan({ source, mode, current: cur })
            if (!planned.ok) return { ok: false, error: planned.error ?? planned.reason, reason: planned.reason ?? null }
            return {
              ok: true,
              importId: planned.importId,
              mode: planned.mode,
              source: planned.source,
              target: planned.target,
              targetKbId: planned.targetKbId,
              taskStateDir: planned.taskStateDir,
              stage: planned.stage,
              counts: planned.counts,
              scan: planned.scan,
              running: planned.running === true,
              skippedDirs: planned.skippedDirs,
            }
          }
          if (action === 'run') {
            const importId = String(args?.importId ?? '')
            if (importId === '') return { ok: false, error: 'run 需要 importId' }
            const started = await importService.start({ importId })
            if (!started.ok) return { ok: false, error: started.error ?? started.reason, reason: started.reason ?? null, importId, target: started.target ?? null }
            return { ...started, counts: null, stage: started.stage ?? 'running' }
          }
          if (action === 'status') {
            const importId = String(args?.importId ?? '')
            if (importId === '') {
              const l = await importService.status({})
              return { ok: true, imports: l.imports, running: l.imports.some((m) => m.running) }
            }
            const st = await importService.status({ importId })
            if (!st.ok) return { ok: false, error: st.error ?? st.reason, reason: st.reason ?? null }
            return st
          }
          if (action === 'cancel') {
            const importId = String(args?.importId ?? '')
            if (importId === '') return { ok: false, error: 'cancel 需要 importId' }
            const r = await importService.cancel({ importId })
            if (!r.ok) return { ok: false, error: r.error ?? r.reason, reason: r.reason ?? null, importId }
            return { ok: true, importId: r.importId, stage: r.stage }
          }
          if (action === 'waiting') {
            const importId = String(args?.importId ?? '')
            if (importId === '') return { ok: false, error: 'waiting 需要 importId' }
            return await importService.waiting({ importId })
          }
          if (action === 'parse') {
            return await runImportParseAction({ args, exec, importService, parseCaller: kbParseCaller, recordRejection: parsingService?.recordRejection })
          }
          return { ok: false, error: '未知 action：' + action }
        },
      },
    ]
  }

  async function install(tools) {
    if (installed) return
    installed = true
    const conf = await core.getConfig()
    log('info', `配置就绪 kbPath=${conf.kbPath} stateDir=${stateDir} revision=${conf.revision} degraded=${Boolean(conf.degraded)}`)
    // R1：唯一的导入执行入口。任务用独立 core 写目标库；切库只在完成且核验通过后提交，
    // 且只在「当前绑定仍是开始时那一个」时提交（失败/取消不碰绑定）。
    importService = createImportService({
      stateDir,
      getBaseConfig: () => core.getConfig(),
      getCurrentCore: () => core,
      log,
      getParsingService: () => parsingService,
      commitBinding: async (target, opts = {}) => {
        // F4：把"预期当前绑定 / 配置 revision / 目标 kbId"交给 core.bind 的原子提交入口。
        // 前置检查与写入在同一个跨实例临界区（stateDir/config.lock）内；拒绝时 config 与 binding 均不变。
        // 目标身份在**写入之前**核对，不存在"先切库、再报失败"的窗口。
        const r = await core.bind(target, {
          commit: true,
          expectedConfigRevision: opts.expectedConfigRevision,
          expectedCurrentKbPath: opts.expectedCurrentKbPath,
          expectedCurrentKbId: opts.expectedCurrentKbId,
          expectedTargetKbId: opts.expectedTargetKbId,
        })
        if (!r || r.ok !== true) {
          return { ok: false, reason: (r && (r.reason || r.conflict)) || 'commit-failed', note: (r && (r.note || r.detail)) || '提交被拒绝', conflict: r && r.conflict, result: r }
        }
        return { ok: true, kbPath: r.kbPath, kbId: r.kbId ?? null, revision: r.revision ?? null }
      },
    })

    // 第二轮：解析服务（OCR/ASR）—— 与工具、设置页、导入、流程共用同一个实例
    parsingService = createParsingService({
      stateDir,
      log,
      onEvent: event => workbench.notify(event),
      getCore: () => core,
      getBinding: async () => {
        const st = core === null ? null : await core.status().catch(() => null)
        if (!st || st.bound !== true || !st.kbId || !st.kbPath) return null
        return { kbPath: st.kbPath, kbId: st.kbId }
      },
    })
    log('info', '解析服务已就绪（OCR/ASR 任务与设置页共用同一实例）')
    void parsingService
      .recover()
      .then((r) => {
        if (r && r.recovered > 0) log('warn', `解析任务恢复：处理 ${r.recovered} 条中断记录（扫描 ${r.scanned} 条）`)
      })
      .catch((error) => log('warn', '解析任务恢复失败（不影响新任务）：' + String((error && error.message) ?? error)))
    // 流程工具与既有 7 个工具走**同一条**注册路径（失败项同样单列，不静默丢）
    const defs = toolDefs().concat(flowToolDefs()).concat(parseToolDefs())
    for (const entry of defs) {
      evidence.registration.attempted.push(entry.name)
      try {
        ctx.effect(() => tools.register(entry), 'kb-core: ' + entry.name)
        if (['kb_status', 'kb_flow', 'kb_flow_resolve', 'kb_parse', 'kb_import'].includes(entry.name)) {
          ctx.get('h1Isolation')?.registerGateway(entry)
          ctx.inject(['h1Isolation'], scope => scope.get('h1Isolation').registerGateway(entry))
        }
        evidence.registration.registered.push(entry.name) // B：只记真正成功的
        log('info', '已注册工具 ' + entry.name)
      } catch (error) {
        const detail = String((error && error.message) ?? error)
        evidence.registration.failed.push({ name: entry.name, error: detail })
        log('error', '注册工具 ' + entry.name + ' 失败：' + detail)
      }
    }

    // ── 轻量入口规则：让**任何** Agent 知道"本机有自定义流程、先查再跑" ─────────────
    // 只写入口与边界，**不写流程正文**（正文按需求不塞进常驻提示词）。
    // 注册在 contexts 层（systemPrompt.context），不是 sections；顺序 600 排在工具清单之后。
    try {
      const sp = ctx.get('systemPrompt')
      if (sp !== undefined && sp !== null && typeof sp.context === 'function') {
        ctx.effect(() => {
          const dispose = sp.context({
            name: 'kb:flows',
            order: 600,
            interpolate: false,
            text: [
              'OCR / ASR 默认统一走 kb_parse，所有 Agent 可解析当前工作目录内的获准文件；用 sourcePath 或 sourceRef，任务和结果返回原会话。个人知识库仍需单独授权。',
              '未指定方法时不走脚本、HTTP 或其他解析工具；仅用户本次明确指定外部方式才执行该次例外，例外不延续。失败报告原因，不自动绕过或换云端。',
              '本机知识库提供「自定义流程」：用户把一串固定步骤固化后，说流程名或触发语即可运行。',
              '用户请求运行流程时先用 kb_flow_resolve(text) 判断命中/歧义/未命中；唯一命中才 kb_flow(action="run")，歧义先让用户选。仅需浏览流程列表时调用 kb_flow(action="list")，不机械先列后查。',
              '不要凭流程名自己编造步骤，也不要不查就跑——步骤只来自定义本身。',
              '普通提及、否定句（如"今天不用发每周信息"）、假设句不是运行命令；停用或已删除的流程不会被命中。',
              '新建或修改流程用 kb_flow(action="save")（更新必须带 expectedRevision）；运行中可用 runs 看进度、cancel 取消。',
            ].join('\n'),
          })
          return () => {
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {
              console.error('[kb-core] 撤销流程入口提示失败：' + String(error))
            }
          }
        }, 'kb-core: flow hint')
        log('info', '已注册流程入口提示：systemPrompt.context kb:flows（order=600，5 行）')
      } else {
        log('warn', '宿主未提供 systemPrompt.context：流程入口提示未注册（工具与界面不受影响）')
      }
    } catch (error) {
      log('warn', '流程入口提示注册失败（不影响工具）：' + String((error && error.message) ?? error))
    }
    probeServices()
    await flushEvidence()
    // B：ready 只说真实情况
    const okCount = evidence.registration.registered.length
    log(okCount === defs.length ? 'info' : 'error', `ready：${okCount}/${defs.length} 个工具注册成功${evidence.registration.failed.length ? '；失败：' + evidence.registration.failed.map((f) => f.name).join(',') : ''}`)

    // ── 合并旧委派插件（@local/dsh-agent-gateway 0.2.0，2026-10-18）──
    // 工具名不变（agent_call / knowledge_request）→ 旧会话、技能、文档都不用改。
    // 默认只有一个自带知识库目标；cwd 跟随已绑定的 kbPath（未绑定则用调用方工作目录）。
    try {
      // 双注册防护：若同一个 profile 的组合里仍挂着旧委派插件，就不再合并注册。
      // 判据取自 profile 自己的 package.json（dsh.profile.bundles），不猜、不依赖服务名。
      let legacyPresent = false
      try {
        const pkgText = await readFile(path.join(stateResolved.profileDir, 'package.json'), 'utf8')
        const pkgJson = JSON.parse(pkgText)
        const bundles = (pkgJson && pkgJson.dsh && pkgJson.dsh.profile && Array.isArray(pkgJson.dsh.profile.bundles)) ? pkgJson.dsh.profile.bundles : []
        legacyPresent = bundles.includes('@local/dsh-agent-gateway')
      } catch (error) {
        log('debug', '读取 profile 组合失败（按"无旧插件"处理）：' + String(error && error.message ? error.message : error))
      }
      if (legacyPresent) {
        log('warn', '检测到旧委派插件仍在组合里（@local/dsh-agent-gateway）→ 本次跳过合并注册，避免 agent_call 双注册；迁移时请从 profile 的 bundles 里移除它')
        throw Object.assign(new Error('legacy-gateway-present'), { code: 'LEGACY_GATEWAY_PRESENT' })
      }
      const kbPathResolved = typeof config.kbPath === 'string' ? config.kbPath.trim() : ''
      const gcfg = Object.assign({}, config.gateway && typeof config.gateway === 'object' ? config.gateway : {})
      // Resolve the binding at call time, never the empty bundle default or a
      // stale startup path. This function is host-owned, not a tool argument.
      gcfg.resolveTarget = async target => {
        if (target.id !== 'knowledge') return target
        const st = await core.status()
        if (!st?.bound || !st.kbId || !st.kbPath) throw new Error('知识库未绑定或未初始化，拒绝回退到调用方目录')
        return { ...target, preset: 'knowledge', cwd: st.kbPath }
      }
      if (!Array.isArray(gcfg.targets) || gcfg.targets.length === 0) {
        gcfg.targets = [{
          id: 'knowledge',
          preset: 'knowledge',
          cwd: kbPathResolved,
          describe: '知识库管家（本插件自带，读取与改写个人知识库）',
          toolName: 'knowledge_request',
        }]
      }
      gatewayApply(ctx, gcfg)
      log('info', '委派工具已合并注册：' + gcfg.targets.map((t) => t.id).join(', '))
    } catch (error) {
      log('warn', '委派工具未注册（可能已被旧插件占用，本次不重复注册）：' + String(error && error.message ? error.message : error))
    }

  // ── P1-G：设置分区的同源接口（与工具共用同一个 core，不重复实现）──
  const SETTINGS_API = '/kb-core/api'
  // 地图扫描有成本（几千个文件），60 秒内复用结果；**缓存按 {kbId, 根目录, 规则版本} 分组**
  // R5：换绑定 / 换观察库 / 隐私规则变化都会让 key 变化 → 自动失效，不再"绑定变了地图还看旧库"
  let kbMapCache = { at: 0, key: null, value: null }
  const KB_MAP_TTL_MS = 60_000
  const posix = (p) => String(p).split(path.sep).join('/')
  const kbSendJson = (res, code, payload) => {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }
  const kbReadBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = []
      let bytes = 0, rejected = false
      req.on('data', (chunk) => {
        if (rejected) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 12 * 1024 * 1024) { rejected = true; chunks.length = 0; reject(new Error('请求超过 12 MiB 上限')); return }
        chunks.push(buffer)
      })
      req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks).toString('utf8')) })
      req.on('error', reject)
    })
  // ── 顶栏页签（审查意见 §四）：统一快照 + 全量清单 ─────────────────────
  // 原则：页面只消费这一份快照，不在前端二次推导；算不出来的显式标 known:false，
  //       「未知」绝不显示成「正常」。刷新只做只读扫描，不绑定、不建库、不重建索引。
  const KB_LIST_PAGE = 100
  const KB_LIST_MAX = 50000
  const OVERVIEW_TTL_MS = 8000
  let overviewCache = { at: 0, key: null, value: null, inflight: null }
  let indexMaintainer = null
  ctx.effect(() => {
    indexMaintainer = createIndexMaintenance({ getCore: () => core, watch: workbench.resources.watch, resources: workbench.resources, onChange: () => { overviewCache.value = null; overviewCache.at = 0; workbench.notify({type:'snapshot-dirty'}) } })
    return () => { indexMaintainer?.dispose(); indexMaintainer = null }
  }, 'kb-core: automatic index maintenance')

  // F2：有效私密策略 —— 配置里的私密根 ∪ 承载私密派生条目的分区。
  // 只配置 '10-项目/私密' 时，派生到 00-画像 的条目同样必须遮罩：物理分区是插件指定的私密分区，不能因配置漏项变公开。
  const kbEffectivePrivateDirs = async (conf, root) => {
    const sourceEntries = root ? await readImportSources(root) : {}
    return effectivePrivateDirs(conf?.privateDirs, derivedPrivatePartitions(sourceEntries))
  }

  /**
   * R3：扫描错误的详情也不能泄漏私密路径/文件名。
   * 旧实现把 `00-画像/PRIVATE_LINK_SENTINEL: link-skipped` 原样放进 issues.detail，
   * 等于在"错误详情"里公开了私密文件的存在与名字。
   */
  const kbPrivateErrorText = (entry, privateDirs) => {
    const pathPart = typeof entry === 'string' ? String(entry).split(/[:：]/)[0] : String(entry?.path ?? '')
    const rest = typeof entry === 'string' ? String(entry).slice(pathPart.length).replace(/^[:：]\s*/, '') : String(entry?.error ?? '')
    if (privateRootOf(pathPart, privateDirs) !== null) return '（私密路径）：枚举异常（路径与文件名已隐藏）'
    return `${pathPart}：${rest}`
  }

  // S2：起点核验不能只看字符串包含——解析真实路径，确认**扫描起点**仍在库内（防 junction/符号链接把枚举带出库外）
  const kbSafeUnder = async (root, prefixRaw) => {
    const prefix = String(prefixRaw ?? '')
    if (prefix.includes('\0')) return { ok: false, reason: 'bad-path' }
    const abs = path.resolve(root, prefix)
    const rel = path.relative(root, abs)
    if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) return { ok: false, reason: 'escape' }
    let realRoot
    let realBase
    try {
      realRoot = await realpath(root)
      realBase = await realpath(abs)
    } catch {
      return { ok: false, reason: 'missing' }
    }
    const relReal = path.relative(realRoot, realBase)
    if (relReal !== '' && (relReal.startsWith('..') || path.isAbsolute(relReal))) return { ok: false, reason: 'escape-real' }
    return { ok: true, abs: realBase }
  }
  const kbCountRecoverTodo = async (kbPath) => {
    try {
      const raw = await readFile(path.join(kbPath, '.kbmeta', 'recover-todo.log'), 'utf8')
      return raw.split('\n').filter((l) => l.trim() !== '').length
    } catch {
      return 0
    }
  }
  // 「知识条目」的权威口径：能在检索层出现的 .md（排除导航文件与 excludeFromSearch 目录）。
  // 不再硬编码 00/10/20/30/40 —— 异构库、改名分区同样成立；隐私分区照样计数（只不列名）。
  const KB_NAV_NAMES = new Set(['INDEX.md', 'README.md', 'AGENTS.md', '知识库清单.md'])
  // 这些目录里即使有 .md 也不是"知识条目"（模板/手册/加工件/原件/生成物）
  const KB_NON_ENTRY_DIRS = ['.kb', '.kbmeta', '.kb-state', '.kb-import', '_模板', '_手册', '_工具', '50-底稿', '90-收件箱', '知识库地图']
  const kbEntryScan = async (kbPath, conf) => {
    const excluded = new Set([...KB_NON_ENTRY_DIRS, ...(Array.isArray(conf?.excludeFromSearch) ? conf.excludeFromSearch : [])])
    const walk = await walkTree(kbPath, kbPath, { maxFiles: KB_LIST_MAX, followLinks: conf?.followLinks === true, skipMeta: true })
    const entries = walk.files.filter((f) => {
      if (!/\.md$/i.test(f.path)) return false
      const segs = normSegs(f.path)
      if (KB_NAV_NAMES.has(segs[segs.length - 1])) return false
      return !segs.some((s) => excluded.has(s))
    })
    return { count: entries.length, paths: entries.map((f) => f.path), coverage: walk.coverage, errors: walk.errors }
  }
  const kbSnapshotKey = (st) => [st.kbId ?? '-', st.kbPath ?? '-', st.config?.revision ?? '-', st.binding?.boundAt ?? '-'].join('|')
  const kbSnapshotVersion = (st) => crypto.createHash('sha1').update(kbSnapshotKey(st)).digest('hex').slice(0, 8)
  const kbOverview = async (current, opts = {}) => {
    const st = await current.status()
    const display = st.kbId ? await workbench.displayPolicy() : { revision: 0, privateDirs: DEFAULT_PRIVATE_DIRS }
    const key = kbSnapshotKey(st) + '|' + display.revision
    const version = kbSnapshotVersion(st)
    if (opts.fresh !== true && overviewCache.value !== null && overviewCache.key === key && Date.now() - overviewCache.at <= OVERVIEW_TTL_MS) {
      return { ...overviewCache.value, cached: true }
    }
    // 并发去重：定时刷新 + 手动刷新 + 切页同时来，只扫一遍
    if (opts.fresh !== true && overviewCache.inflight !== null && overviewCache.inflight.key === key) {
      return await overviewCache.inflight.promise
    }
    const promise = (async () => {
      const conf = await current.getConfig().catch(() => null)
      const privateDirs = display.privateDirs
      const map = st.kbPath ? await buildMap(st.kbPath, { privateDirs, readOnly: false }) : null
      const sections = (map && map.sections) || []
      const pick = (n) => sections.find((s) => s.name === n) || null
      const drafts = pick('50-底稿')
      const originals = pick('90-收件箱')
      // S3：知识数来自**磁盘枚举**，不是索引条目数（删了索引不该让知识数变成 0）
      const entryScan = st.kbPath ? await kbEntryScan(st.kbPath, conf) : { count: 0, paths: [], coverage: null, errors: [] }
      // F3：知识数按同一来源折叠；物理文件数另列（两份承载文件不等于两份知识）
      const sourceEntries = st.kbPath ? await readImportSources(st.kbPath) : {}
      const folded = st.kbPath
        ? knowledgeCount(entryScan.paths ?? [], sourceEntries, { kbId: st.kbId ?? null, root: st.kbPath })
        : { knowledge: 0, physical: 0, folded: 0 }
      // 配置健康只看 config.ok（state 是 loaded/seeded 等来源标记，不是健康状况）
      const configOk = Boolean(st.config?.ok)
      // 配置健康与库结构健康分开：配置降级时 healthOf 根本没跑，不能把"没检查"说成"坏了"
      const kbHealthy = st.healthReason === 'config-degraded' ? null : st.healthy === true
      const issues = []
      if (!st.kbPath) {
        issues.push({ kind: 'unbound', label: '未绑定知识库', detail: '还没有绑定任何目录；到「设置 → 个人知识库」选一个文件夹，再点「自动建库 / 识别」。' })
      } else {
        if (!configOk) {
          issues.push({ kind: 'config-degraded', label: '配置降级：' + (st.config?.state ?? 'unknown'), detail: st.config?.detail ?? '配置文件字段缺失或非法；改动会写回 stateDir/config.json。' })
        }
        if (kbHealthy === false) {
          issues.push({ kind: 'kb-unhealthy', label: '库结构不健康：' + (st.healthReason ?? '未知'), detail: st.healthDetail || '库元数据/分类目录不完整，写入会被拒绝；请先修复或用 kb_init 补齐。' })
        }
        if (st.index && st.index.fresh !== true) {
          issues.push({ kind: 'index-stale', label: (st.index.reason === 'index-fingerprint-unknown' ? '无法检查索引' : '索引需要同步') + '：' + (st.index.reasonLabel || st.index.reason || '未知'), detail: '原因码：' + st.index.reason + '；索引生成时间：' + (st.index.indexedAt || '未知') + '。' + (st.index.detail || '') + '；未同步时检索回退磁盘扫描，扫描错误会单独报告。' })
        }
        const recoverTodo = await kbCountRecoverTodo(st.kbPath)
        if (recoverTodo > 0) {
          issues.push({ kind: 'recover-todo', label: '待恢复记录 ' + recoverTodo + ' 条', detail: '上次写入后索引未完成；下次启动或下一次写成功时会消费，不必手动处理。' })
        }
        const coverage = entryScan.coverage
        if (coverage && coverage.truncated) {
          issues.push({
            kind: 'scan-truncated',
            label: `扫描被截断（${coverage.truncatedReason}）`,
            detail: `已枚举 ${coverage.files} 个文件、最深 ${coverage.depth} 层；**结果不完整**，下面的知识数与清单只覆盖到截断点。`,
          })
        }
        if ((entryScan.errors?.length ?? 0) > 0) {
          issues.push({ kind: 'scan-error', label: '枚举错误 ' + entryScan.errors.length + ' 处', detail: entryScan.errors.slice(0, 5).map((e) => kbPrivateErrorText(e, privateDirs)).join('；') })
        }
        if (map && Array.isArray(map.errors) && map.errors.length > 0) {
          issues.push({ kind: 'map-error', label: '地图扫描错误 ' + map.errors.length + ' 处', detail: map.errors.slice(0, 5).map((e) => kbPrivateErrorText(e, privateDirs)).join('；') })
        }
      }
      return {
        at: new Date().toISOString(),
        version,
        cached: false,
        identity: {
          bound: Boolean(st.kbPath),
          kbPath: st.kbPath || null,
          name: st.kbPath ? path.basename(st.kbPath) : null,
          kbIdShort: st.kbId ? String(st.kbId).slice(0, 8) : null,
          kbId: st.kbId ?? null,
          mode: 'read-write',
          linkPolicy: st.linkPolicy ?? null,
          configRevision: st.config?.revision ?? null,
          stateDir: st.stateDir ?? null,
          snapshotVersion: version,
        },
        run: {
          // 三个"健康"分开报，字段名不再互相冒充
          config: {
            ok: configOk,
            state: st.config?.state ?? 'unknown',
            reason: configOk ? null : (st.config?.detail ?? 'unknown'),
            revision: st.config?.revision ?? null,
            file: st.config?.file ?? null,
          },
          kb: {
            healthy: kbHealthy, // null = 未检查（配置降级时），不是"正常"
            reason: kbHealthy === null ? 'config-degraded（未检查库结构）' : (st.healthReason ?? null),
            detail: st.healthDetail ?? '',
          },
          index: {
            fresh: st.index ? st.index.fresh === true : null,
            reason: st.index ? (st.index.reason ?? null) : 'unknown',
            entries: st.counts ? (st.counts.entries ?? null) : null,
            indexedAt: st.counts?.indexedAt ?? null,
          },
          // 审查意见：暂未实现的数据标未知，不能显示成正常
          lastCheck: { known: false, note: '本版没有把检查时间线落盘（kb_check 只回落结果）' },
          scan: {
            status: map ? map.status : (st.kbPath ? 'unknown' : 'unbound'),
            at: map ? map.scannedAt : null,
            elapsedMs: map ? map.elapsedMs : 0,
            errors: (map && map.errors ? map.errors.length : 0) + (entryScan.errors?.length ?? 0),
            coverage: entryScan.coverage ?? { files: 0, dirs: 0, depth: 0, truncated: false, truncatedReason: null, errors: 0 },
          },
        },
        layers: {
          entries: folded.knowledge, // 知识数：同一来源折叠后（原件 + 派生条目只算一份）
          physicalEntries: folded.physical, // 物理文件数：磁盘上可检索的 .md
          foldedSources: folded.folded, // 被折叠掉的派生条目数（同一来源）
          entriesInIndex: st.counts ? (st.counts.entries ?? null) : null, // 索引记录数，供对账
          originals: originals ? originals.files : 0,
          drafts: drafts ? drafts.files : 0,
          filesAll: map && map.totals ? map.totals.files : 0,
          bytesAll: map && map.totals ? map.totals.bytes : 0,
          coverage: entryScan.coverage ?? null,
          note: '知识条目＝按来源映射折叠后的知识数（同一来源的原件与派生条目只算一份）；physicalEntries＝磁盘上的 .md 文件数；entriesInIndex＝索引记录数（物理行）；「全部文件」含原件与加工件，不能当条目数',
        },
        issues,
        sections: sections.map((s) => ({
          name: s.name,
          files: s.files,
          bytes: s.bytes,
          latestAt: s.latestAt ?? null,
          private: Boolean(s.private),
          rootFiles: Boolean(s.rootFiles),
        })),
        recent: (map && map.recent) || [],
        privacy: (map && map.privacy) || null,
      }
    })()
    overviewCache.inflight = { key, promise }
    try {
      const value = await promise
      overviewCache = { at: Date.now(), key, value, inflight: null }
      return value
    } catch (error) {
      overviewCache.inflight = null
      throw error
    }
  }

  // ── 目录候选 / 原生选择器 / 自动建库识别 / 导入任务（S4 + 配置页两个主动作）──
  const dshInstallRoot = () => {
    // 桌面版：<install>\DeepSeek Harness.exe → install 根；其它宿主退回 resources 的上级
    const exeDir = path.dirname(process.execPath)
    if (/deepseek\s*harness/i.test(path.basename(process.execPath, path.extname(process.execPath)))) return exeDir
    if (process.resourcesPath) return path.dirname(process.resourcesPath)
    // 非桌面宿主（node 直接跑）不往 Program Files 写：退回 <home>/KnowledgeBase
    const homeRaw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
    const home = homeRaw !== '' ? homeRaw : path.join(os.homedir(), '.dsh')
    return home
  }
  const kbDefaultCandidate = () => path.join(dshInstallRoot(), 'KnowledgeBase')
  const kbCanWriteDir = async (dir) => {
    let anc = dir
    while (!fsExists(anc) && path.dirname(anc) !== anc) anc = path.dirname(anc)
    try {
      await access(anc, fsConstants.W_OK)
      return { ok: true, base: anc }
    } catch (error) {
      return { ok: false, base: anc, reason: String((error && (error.code || error.message)) ?? error) }
    }
  }
  const kbDirsInfo = async () => {
    const cand = kbDefaultCandidate()
    const w = await kbCanWriteDir(cand)
    const st = core ? await core.status().catch(() => null) : null
    return {
      stateDir: posix(stateDir),
      installRoot: posix(dshInstallRoot()),
      defaultKnowledgeBase: posix(cand),
      defaultWritable: w.ok,
      defaultWritableReason: w.ok ? null : `上级目录不可写（${posix(w.base)}：${w.reason}）`,
      bound: st && st.kbPath ? st.kbPath : null,
      picker: (() => {
        try {
          const svc = ctx.get('directoryPicker')
          if (!svc || typeof svc.capability !== 'function') return { available: false, kind: null }
          const cap = svc.capability()
          return { available: Boolean(cap && typeof cap.kind === 'string'), kind: cap ? cap.kind : null, canOpenDialog: Boolean(cap && cap.kind === 'native' && typeof cap.pick === 'function') }
        } catch (error) {
          return { available: false, kind: null, error: String((error && error.message) ?? error) }
        }
      })(),
    }
  }
  // S4：走 host 的 ctx.directoryPicker seam（capability 判别），不是客户端的 uiWorkspace。
  const kbPickDir = async () => {
    let svc = null
    try {
      svc = ctx.get('directoryPicker')
    } catch (error) {
      return { ok: false, reason: 'service-threw', note: String((error && error.message) ?? error) }
    }
    if (!svc || typeof svc.capability !== 'function') {
      return { ok: false, reason: 'no-directory-picker', note: '当前宿主没有提供 ctx.directoryPicker：无法打开系统文件夹对话框，请直接粘贴绝对路径' }
    }
    let cap
    try {
      cap = svc.capability()
    } catch (error) {
      return { ok: false, reason: 'capability-failed', note: String((error && error.message) ?? error) }
    }
    const kind = cap && typeof cap.kind === 'string' ? cap.kind : 'unknown'
    if (kind !== 'native' || typeof cap.pick !== 'function') {
      // browse 后端只能列目录、不能弹原生对话框——如实说，不假装成功
      return { ok: false, reason: 'unsupported-capability', capability: kind, note: `当前宿主的目录选择能力是 ${kind}（不是 native），本页暂不接 browse 原语，请粘贴路径` }
    }
    const controller = new AbortController()
    const timerOut = setTimeout(() => controller.abort(), 300_000)
    try {
      const picked = await cap.pick(controller.signal)
      if (typeof picked !== 'string' || picked.trim() === '') return { ok: true, canceled: true, path: null }
      return { ok: true, canceled: false, path: toPosixFile(path.resolve(picked)) }
    } catch (error) {
      const aborted = Boolean(error && (error.name === 'AbortError' || /abort/i.test(String(error.message ?? ''))))
      return { ok: false, reason: aborted ? 'canceled' : 'pick-failed', note: String((error && error.message) ?? error) }
    } finally {
      clearTimeout(timerOut)
    }
  }

  // 「自动建库 / 识别」：选定文件夹后点一次 —— 空目录建库、本插件库接入、普通资料夹识别导入。
  // R1/R3 的顺序：foreign 目录**先冻结清单、再建标准结构**；导入完成且核验通过后才切当前库。
  const kbSetupFolder = async (folderRaw, modeIn) => {
    if (importService === null) return { ok: false, blocked: true, note: '导入服务尚未就绪' }
    return await importService.setupFolder(folderRaw, modeIn)
  }
  const webServer = ctx.get('webServer')
  // #region kbSummarizeRebuild
  /**
   * 把 core.checkEntry({ rebuild: true }) 的返回映射成界面按钮的结论（纯函数，便于用虚构样本验证）。
   *
   * 语义要点（2026-10-18 复核指出、本版修正）：checkEntry 在**扫描不完整**时故意返回
   * ok:true + execution:'partial' + indexWritten:false —— 意思是「检查跑完了，但旧索引被保留」，
   * 绝不能算重建成功。成功必须三个条件同时成立：ok===true、execution==='ok'、indexWritten===true。
   * 另外 counts 里**没有** indexState 字段（恒 undefined），所以这里不产出任何「索引状态」，
   * 免得界面凭空显示「索引 ok」。
   */
  const kbSummarizeRebuild = (checkRes, elapsedMs) => {
    const r = checkRes && typeof checkRes === 'object' ? checkRes : null
    const counts = r && r.counts && typeof r.counts === 'object' ? r.counts : {}
    const execution = r ? r.execution ?? null : null
    const indexWritten = r ? r.indexWritten === true : false
    const scanErrors = typeof counts.scanErrors === 'number' ? counts.scanErrors : null
    const entries = typeof counts.entries === 'number' ? counts.entries : null
    const diff = r && r.diff && typeof r.diff === 'object' ? r.diff : {}
    const len = (v) => (Array.isArray(v) ? v.length : null)
    const ok = !!(r && r.ok === true && execution === 'ok' && indexWritten === true)
    let reason = null
    if (!ok) {
      if (!r) reason = '宿主没有返回检查结果'
      else if (r.ok === false) reason = String(r.reason ?? r.detail ?? '前置条件拒绝，未执行重建')
      else if (execution === 'partial') reason = '扫描不完整' + (scanErrors !== null ? `（${scanErrors} 处错误）` : '') + '，旧索引已保留'
      else if (execution === 'error') reason = String(r.reason ?? r.detail ?? '检查阶段报错，未重建索引')
      else if (!indexWritten) reason = '本次未写入索引，旧索引已保留'
      else reason = '重建未成功'
    }
    return {
      ok,
      reason,
      execution,
      indexWritten,
      scanErrors,
      quality: r ? r.quality ?? null : null,
      healthy: r ? r.healthy ?? null : null,
      entries,
      defects: r ? len(r.defects) : null,
      added: len(diff.added),
      removed: len(diff.removed),
      changed: len(diff.changed),
      rebuiltAt: r && r.rebuiltAt ? String(r.rebuiltAt) : null,
      indexFreshBefore: r && r.index ? r.index.fresh ?? null : null,
      elapsedMs: typeof elapsedMs === 'number' ? elapsedMs : null,
    }
  }
  // #endregion kbSummarizeRebuild

  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/kb-core/collect', handler: async (req, res) => {
      try {
        const draft = await sharedDraft(req)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        res.end(captureDocument(await readFile(path.join(pkgRoot, 'src/client/capture.html'), 'utf8'), draft))
      } catch (error) { kbSendJson(res, 400, { ok: false, error: '未保存分享内容：' + error.message }) }
    } }), 'kb-workbench: mobile quick capture')
    for (const [asset, type] of [['capture.js','text/javascript'], ['capture-sw.js','text/javascript'], ['capture.css','text/css'], ['capture.webmanifest','application/manifest+json'], ['capture-icon.svg','image/svg+xml'], ['capture-icon-192.png','image/png'], ['capture-icon-512.png','image/png']]) {
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/kb-core/' + asset, handler: async (req, res) => {
        if (req.method !== 'GET') return kbSendJson(res, 405, { ok: false })
        res.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' })
        res.end(await readFile(path.join(pkgRoot, 'src/client', asset)))
      } }), 'kb-workbench: capture asset ' + asset)
    }
    for (const folder of ['cmaps', 'standard_fonts', 'wasm']) for (const asset of readdirSync(path.join(pkgRoot, 'src/client/pdfjs', folder))) {
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/kb-core/pdf-assets/' + folder + '/' + asset, handler: async (req, res) => {
        if (req.method !== 'GET') return kbSendJson(res, 405, { ok: false })
        res.writeHead(200, { 'content-type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', 'cache-control': 'private, max-age=3600' })
        res.end(await readFile(path.join(pkgRoot, 'src/client/pdfjs', folder, asset)))
      } }), 'kb-workbench: PDF resource ' + folder + '/' + asset)
    }
    const clipperHandler = async (req, res) => {
      const origin = String(req.headers.origin || '')
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return kbSendJson(res, 403, { ok: false, error: '只接受浏览器扩展请求' })
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('vary', 'Origin')
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' }); return res.end() }
      if (req.method !== 'POST') return kbSendJson(res, 405, { ok: false })
      try {
        const body = JSON.parse(await kbReadBody(req))
        const out = await workbench.clipper({ origin, code: body.code, token: String(req.headers.authorization || '').replace(/^Bearer /, ''), item: body.item })
        return kbSendJson(res, 200, { ok: true, ...out })
      } catch (error) { return kbSendJson(res, error.code === 'CLIPPER_UNAUTHORIZED' ? 401 : 400, { ok: false, error: error.code ? error.message : '剪藏未完成，请稍后重试' }) }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/kb-core/clip', handler: clipperHandler }), 'kb-workbench: restricted browser capture')
    if (path.basename(stateResolved.profileDir).toLowerCase() === 'desktop') {
      ctx.effect(() => {
        const server = createServer((req, res) => {
          if (String(req.url || '').split('?')[0] !== '/kb-core/clip') return kbSendJson(res, 404, { ok: false, error: 'not found' })
          void clipperHandler(req, res).catch(error => {
            log('warn', '固定剪藏入口请求失败：' + String((error && error.message) ?? error))
            if (res.headersSent) res.destroy()
            else kbSendJson(res, 500, { ok: false, error: '剪藏未完成，请稍后重试' })
          })
        })
        server.on('listening', () => log('info', '浏览器扩展固定入口已就绪：http://' + CLIPPER_BRIDGE_HOST + ':' + CLIPPER_BRIDGE_PORT))
        server.on('error', error => {
          const reason = error && error.code ? error.code : String((error && error.message) ?? error)
          log('error', '浏览器扩展固定入口启动失败（' + CLIPPER_BRIDGE_HOST + ':' + CLIPPER_BRIDGE_PORT + '）：' + reason)
        })
        server.listen(CLIPPER_BRIDGE_PORT, CLIPPER_BRIDGE_HOST)
        return () => { if (server.listening) server.close() }
      }, 'kb-workbench: stable browser capture bridge')
    }
    for (const asset of ['pdf.mjs', 'pdf.worker.mjs']) ctx.effect(() => webServer.register({ kind: 'exact', path: '/kb-core/' + (asset === 'pdf.mjs' ? 'pdfjs.mjs' : asset), handler: async (req, res) => {
      if (req.method !== 'GET') return kbSendJson(res, 405, { ok: false })
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' })
      res.end(await readFile(path.join(pkgRoot, 'src', 'client', 'pdfjs', asset)))
    } }), 'kb-workbench: PDF reader ' + asset)
    ctx.effect(() => webServer.register({ kind: 'exact', path: '/kb-core/workbench-events', handler: (req, res) => {
      if (req.method !== 'GET' || req.headers['sec-fetch-site'] === 'cross-site') return kbSendJson(res, 403, { ok: false })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
      res.write(': workbench connected\n\n')
      const off = workbench.subscribe(event => res.write('data: ' + JSON.stringify(event) + '\n\n'))
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
      const close = () => { off(); clearInterval(heartbeat) }
      res.on('close', close)
    } }), 'kb-workbench: shared policy events')
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: SETTINGS_API,
          handler: async (req, res) => {
            try {
              const current = core
              if (!current) return kbSendJson(res, 503, { ok: false, error: 'core 尚未就绪' })
              if (req.method === 'GET') return kbSendJson(res, 200, { ok: true, status: { ...(await current.status()), build: buildInfo } })
              if (req.method !== 'POST') return kbSendJson(res, 405, { ok: false, error: 'method not allowed' })
              const body = JSON.parse((await kbReadBody(req)) || '{}')
              if (typeof body.op === 'string' && /^(preferences|onboarding|atlas|capture|search|backup|reading|review|tasks|question|links|deliverables|trash|retrieval|upgrade)\./.test(body.op)) {
                const origin = req.headers.origin
                if (req.headers['sec-fetch-site'] === 'cross-site' ||
                  String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() !== 'application/json' ||
                  (origin && (() => { try { return new URL(origin).host !== req.headers.host } catch { return true } })())) {
                  return kbSendJson(res, 403, { ok: false, error: '工作台请求必须来自当前客户端' })
                }
                try { return kbSendJson(res, 200, await workbench.dispatch(body)) }
                catch (error) { return kbSendJson(res, 200, { ok: false, code: error.code || 'WORKBENCH_ERROR', error: error.code ? error.message : '工作台操作未完成，请重试；用户数据已保留' }) }
              }
              if (body.op === 'status') return kbSendJson(res, 200, { ok: true, status: { ...(await current.status()), build: buildInfo } })
              if (body.op === 'updates.check') return kbSendJson(res, 200, {
                ...await updateChecker.check({ force: body.force === true }),
                installSupported: Boolean(updateProfile?.dir && ctx.get('pluginManager')?.installBundle),
              })
              if (body.op === 'updates.prepare') {
                // Only the first-party client can request a verified download.
                // Model tools expose no install action, URL override, or cache path.
                const origin = req.headers.origin
                if (req.headers['sec-fetch-site'] === 'cross-site' ||
                  String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() !== 'application/json' ||
                  (origin && (() => { try { return new URL(origin).host !== req.headers.host } catch { return true } })())) {
                  return kbSendJson(res, 403, { ok: false, error: '更新请求必须来自当前客户端' })
                }
                if (!updateProfile?.dir || typeof ctx.get('pluginManager')?.installBundle !== 'function') return kbSendJson(res, 409, { ok: false, error: '当前宿主不支持客户端内安装插件，请使用宿主插件管理器' })
                try { return kbSendJson(res, 200, await updateDownloader.prepare({ expectedVersion: body.expectedVersion })) }
                catch (error) { return kbSendJson(res, 400, { ok: false, error: String(error.message || error) }) }
              }
              if (body.op === 'index-maintenance.status') {
                const status = await current.status()
                return kbSendJson(res, 200, { ok: true, enabled: (await current.getConfig()).autoIndex !== false, scheduler: indexMaintainer?.status(), maintenance: current.maintenanceStatus(), kbId: status.kbId, index: status.index })
              }
              if (body.op === 'index-maintenance.configure') {
                const out = await current.setConfig({ autoIndex: body.enabled })
                if (out.ok) overviewCache.value = null
                return kbSendJson(res, 200, out)
              }
              if (body.op === 'index-snapshots') return kbSendJson(res, 200, await current.indexSnapshots({ restore: body.restore, expectedKbId: body.expectedKbId }))
              if (body.op === 'index-rebuild') {
                // 界面「重建索引」按钮的唯一入口：与模型工具 kb_check(rebuild=true) 走同一条路径，
                // 不另写一套扫描逻辑，避免「按钮」与「工具」两种语义漂移。
                const t0 = Date.now()
                const checkRes = await current.maintainIndex({ full: true, expectedKbId: body.expectedKbId, expectedRevision: body.expectedRevision, confirmDrop: body.confirmDrop })
                if (checkRes.ok) indexMaintainer?.resume()
                overviewCache.value = null
                const summary = { ...checkRes, elapsedMs: Date.now() - t0, added: checkRes.diff?.added?.length, removed: checkRes.diff?.removed?.length, changed: checkRes.diff?.changed?.length }
                // ok 只代表「索引确实重建了」：partial / 拒绝 / 空返回都是 ok:false + 可读 reason。
                // 仍然回 200 —— 请求本身处理成功，结论是「没重建成功」，前端据此报原因。
                return kbSendJson(res, 200, {
                  ok: summary.ok,
                  error: summary.ok ? undefined : (summary.detail || summary.reason || '重建未成功'),
                  result: summary,
                })
              }
              if (body.op === 'map') {
                // R5：扫描根 = **当前绑定的库**（与 kb_status/工具同源）。
                // 要看别的库必须显式传 viewRoot，并在返回里标 readOnly —— 不静默混用"观察库"与"读写库"。
                const cur = await current.status()
                const viewRoot = typeof body.viewRoot === 'string' && body.viewRoot.trim() !== '' ? body.viewRoot.trim() : null
                const scanRoot = path.resolve(viewRoot !== null ? viewRoot : cur.kbPath)
                const readOnly = viewRoot !== null
                const mapConf = await current.getConfig().catch(() => null)
                const privateDirs = await kbEffectivePrivateDirs(mapConf, cur.kbPath)
                const cacheKey = `${cur.kbId ?? '-'}|${posix(scanRoot)}|${MAP_RULES_VERSION}|${readIndexPolicy(scanRoot).revision}|${readOnly ? 'ro' : 'rw'}|${(privateDirs ?? []).join(',')}`
                const now = Date.now()
                let reused = false
                if (kbMapCache.key === cacheKey && kbMapCache.value !== null && now - kbMapCache.at <= KB_MAP_TTL_MS && body.fresh !== true) {
                  reused = true
                } else {
                  kbMapCache = { at: now, key: cacheKey, value: await buildMap(scanRoot, { privateDirs, readOnly }) }
                }
                return kbSendJson(res, 200, {
                  ok: true,
                  map: kbMapCache.value,
                  cached: reused,
                  target: { bound: cur.kbPath, scanned: posix(scanRoot), readOnly },
                })
              }
              if (body.op === 'overview') {
                // §四：一次算完身份 / 运行状态 / 分层计数 / 异常待办 / 分区 / 最近变更
                return kbSendJson(res, 200, { ok: true, overview: await kbOverview(current, { fresh: body.fresh === true }) })
              }
              if (body.op === 'files') {
                // §四「全量内容入口」。
                // S2：隐私按**每条返回路径规范化后**判断（私密根用路径段前缀语义），不看请求 range；
                // 首版不提供揭示通道，因此「全部」、子范围、筛选、分页、嵌套私密目录都绕不过默认策略。
                const cur = await current.status()
                if (!cur.kbPath) return kbSendJson(res, 200, { ok: false, error: '未绑定知识库' })
                const prefix = body.prefix ? String(body.prefix) : ''
                const safe = await kbSafeUnder(cur.kbPath, prefix)
                if (!safe.ok) {
                  const escape = safe.reason === 'escape' || safe.reason === 'escape-real'
                  return kbSendJson(res, 400, { ok: false, error: escape ? 'prefix 越界（必须在库内）' : 'prefix 不可用：' + safe.reason, reason: safe.reason })
                }
                const conf = await current.getConfig().catch(() => null)
                const privateDirs = (await workbench.displayPolicy()).privateDirs
                const walk = await walkTree(safe.abs, cur.kbPath, { maxFiles: KB_LIST_MAX, followLinks: conf?.followLinks === true })
                const q = String(body.q ?? '').trim().toLowerCase()
                const matched = []
                let privateTotal = 0
                for (const f of walk.files) {
                  if (privateRootOf(f.path, privateDirs) !== null) {
                    // 私密文件：只计数；不列名、不参与关键词匹配（否则"搜到 1 条"就泄漏了存在性）
                    privateTotal += 1
                    continue
                  }
                  if (q !== '' && !f.path.toLowerCase().includes(q)) continue
                  matched.push(f)
                }
                matched.sort((a, b) => b.mtimeMs - a.mtimeMs)
                const limit = Math.min(Number(body.limit) > 0 ? Number(body.limit) : KB_LIST_PAGE, 500)
                const offset = Math.max(Number(body.offset) || 0, 0)
                return kbSendJson(res, 200, {
                  ok: true,
                  version: kbSnapshotVersion(cur),
                  kbId: cur.kbId ?? null,
                  root: posix(cur.kbPath),
                  prefix: toPosixFile(prefix),
                  query: q,
                  total: matched.length,
                  privateTotal,
                  masked: privateTotal > 0,
                  offset,
                  limit,
                  files: matched.slice(offset, offset + limit),
                  coverage: walk.coverage,
                  truncated: walk.truncated,
                })
              }
              if (body.op === 'dirs') {
                return kbSendJson(res, 200, { ok: true, dirs: await kbDirsInfo() })
              }
              if (body.op === 'pick-dir') {
                // S4：宿主 seam 是 ctx.directoryPicker（capability 判别），**不是** uiWorkspace。
                // 客户端服务与 host 服务不能混用——上一版接错就在这。
                const picked = await kbPickDir()
                return kbSendJson(res, 200, picked)
              }
              if (body.op === 'probe-folder') {
                if (typeof body.path !== 'string' || body.path.trim() === '') return kbSendJson(res, 400, { ok: false, error: '缺少 path' })
                const info = await inspectFolder(body.path)
                return kbSendJson(res, 200, { ok: true, folder: info })
              }
              if (body.op === 'setup') {
                // 两个主按钮里的第二个：选完目录点一次，由服务端判断该建库、该接入、还是该导入。
                if (typeof body.path !== 'string' || body.path.trim() === '') return kbSendJson(res, 400, { ok: false, error: '缺少 path' })
                const result = await kbSetupFolder(body.path, body.mode)
                return kbSendJson(res, 200, result)
              }
              if (body.op === 'import-plan') {
                if (importService === null) return kbSendJson(res, 503, { ok: false, error: '导入服务尚未就绪' })
                const planned = await importService.plan({ source: body.source, mode: body.mode, current: await current.status() })
                if (!planned.ok) return kbSendJson(res, 400, { ok: false, error: planned.error ?? planned.reason, reason: planned.reason ?? null })
                return kbSendJson(res, 200, planned)
              }
              if (body.op === 'import-run') {
                if (importService === null) return kbSendJson(res, 503, { ok: false, error: '导入服务尚未就绪' })
                const started = await importService.start({ importId: String(body.importId ?? '') })
                // R2：importId 非法/任务目录越界 → 400（且磁盘上不新增任何东西）
                const bad = started.reason === 'bad-import-id' || /escape/.test(String(started.reason ?? ''))
                return kbSendJson(res, bad ? 400 : 200, started)
              }
              if (body.op === 'import-status') {
                if (importService === null) return kbSendJson(res, 503, { ok: false, error: '导入服务尚未就绪' })
                const importId = body.importId === undefined || body.importId === null ? '' : String(body.importId)
                const st = await importService.status({ importId })
                const bad = st.reason === 'bad-import-id' || /escape/.test(String(st.reason ?? ''))
                return kbSendJson(res, bad ? 400 : 200, st)
              }
              if (body.op === 'import-cancel') {
                if (importService === null) return kbSendJson(res, 503, { ok: false, error: '导入服务尚未就绪' })
                if (String(body.importId ?? '') === '') return kbSendJson(res, 400, { ok: false, error: '缺少 importId' })
                const r = await importService.cancel({ importId: String(body.importId) })
                const bad = r.reason === 'bad-import-id' || r.reason === 'import-dir-escape' || r.reason === 'import-dir-escape-real'
                return kbSendJson(res, bad ? 400 : 200, r)
                            }
              // ── 第二轮：待解析项（设置页「待解析/待识别」列表与单项解析）──
              if (body.op === 'import-waiting') {
                if (importService === null) return kbSendJson(res, 503, { ok: false, error: '导入服务尚未就绪' })
                if (String(body.importId ?? '') === '') return kbSendJson(res, 400, { ok: false, error: '缺少 importId' })
                const r = await importService.waiting({ importId: String(body.importId) })
                const bad = r.reason === 'bad-import-id' || r.reason === 'import-dir-escape' || r.reason === 'import-dir-escape-real'
                return kbSendJson(res, bad ? 400 : 200, r)
              }
              if (body.op === 'import-parse') {
                if (importService === null) return kbSendJson(res, 503, { ok: false, error: '导入服务尚未就绪' })
                if (String(body.importId ?? '') === '' || String(body.rel ?? '') === '') return kbSendJson(res, 400, { ok: false, error: '缺少 importId 或 rel' })
                const r = await importService.parseItem({ importId: String(body.importId), rel: String(body.rel), kind: body.kind, providerId: body.providerId })
                const hardFail = r.ok === false && ['PARSE_TARGET_NOT_BOUND', 'PARSE_NOT_ENABLED', 'item-not-found', 'LOCAL_ONLY_BLOCKED', 'UNSUPPORTED_FORMAT', 'SOURCE_ESCAPE'].includes(r.reason)
                return kbSendJson(res, hardFail ? 400 : 200, r)
              }
              // ── 自定义流程 API（op 名冻结，见 FLOWS-REPORT.md；界面与端到端验收共用这几个）──
              //   flows.list   {includeArchived?}          → {ok,kbId,count,flows[]}
              //   flows.get    {id}                        → {ok,flow}
              //   flows.save   {flow, expectedRevision?}   → {ok,flow,created,revision} | conflict
              //   flows.enable {id, enabled}               → {ok,id,enabled,revision}
              //   flows.archive{id, restored?}             → {ok,id,archived,restored}
              //   flows.resolve{text}                      → {ok,status,matched,guarded}
              //   flows.run    {id?, text?, params?, runId?} → {ok,runId,run}（立即返回，后台执行）
              //   flows.prepare-conversation {id,kbId,expectedRevision,params?} → {ok,cwd,prompt}（不执行）
              //   flows.runs   {flowId?, runId?, limit?}   → {ok,runs[]} | {ok,run}
              //   flows.cancel {runId}                     → {ok,canceling}
              if (String(body.op).startsWith('flows.')) {
                let engine
                try {
                  engine = await ensureFlowEngine()
                } catch (error) {
                  return kbSendJson(res, 503, { ok: false, error: '流程引擎不可用：' + String((error && error.message) ?? error) })
                }
                const sub = String(body.op).slice('flows.'.length)
                let out
                try {
                  if (sub === 'models') {
                    const llm = ctx.get('llm')
                    if (!llm?.listProviders || !llm?.resolveModelInfo) throw new Error('宿主尚未提供模型目录，请升级宿主后重试')
                    const groups = [], failures = []
                    for (const provider of llm.listProviders()) {
                      try {
                        const models = []
                        for (const model of await llm.listModels(provider.id)) {
                          try {
                            const info = await llm.resolveModelInfo(provider.id, model.id)
                            models.push({ id: model.id, name: info.name || model.name || model.id, reasoning: info.reasoning })
                          } catch { failures.push({ name: provider.name + ' / ' + model.id }) }
                        }
                        groups.push({ id: provider.id, name: provider.name || provider.id, models })
                      } catch { failures.push({ name: provider.name || provider.id }) }
                    }
                    out = { ok: true, groups, failures }
                  }
                  else if (sub === 'list') out = await engine.list({ includeArchived: body.includeArchived === true })
                  else if (sub === 'get') out = await engine.get(body.id)
                  else if (sub === 'save') out = await engine.save({ flow: body.flow, expectedRevision: body.expectedRevision })
                  else if (sub === 'enable') out = await engine.setEnabled(body.id, body.enabled === true)
                  else if (sub === 'archive') out = await engine.archive(body.id, body.restored === true)
                  else if (sub === 'resolve') out = await engine.resolve(body.text)
                  else if (sub === 'prepare-conversation') out = await prepareFlowConversation(engine, flowWorkspaceManager, body)
                  else if (sub === 'run') {
                    // 界面触发**没有调用方 agent** → gateway 走根级分支（借用存活会话的模型路由）
                    out = await engine.start({ id: body.id, text: body.text, params: body.params, runId: body.runId, parentAgent: null, signal: null })
                    if (out && out.ok === true && out.run && out.run.promise) delete out.run.promise
                  } else if (sub === 'runs') out = await engine.runs({ flowId: body.flowId ?? body.id, runId: body.runId, limit: body.limit })
                  else if (sub === 'cancel') out = await engine.cancel(body.runId ?? body.id)
                  else return kbSendJson(res, 400, { ok: false, error: 'unknown flows op: ' + sub })
                } catch (error) {
                  return kbSendJson(res, 500, { ok: false, error: String((error && error.message) ?? error) })
                }
                const bad = out && (out.reason === 'bad-import-id' || out.reason === 'invalid-flow')
                return kbSendJson(res, bad ? 400 : 200, out)
              }
              if (body.op === 'bind') {
                const result = await current.bind(String(body.kbPath ?? ''), { confirmInit: body.confirmInit === true })
                return kbSendJson(res, 200, { ok: result.ok !== false, result })
              }
              // ── 第二轮：解析服务（OCR/ASR）—— 设置页与工具共用同一个任务服务 ──
              if (typeof body.op === 'string' && body.op.startsWith('parse.')) {
                if (parsingService === null) return kbSendJson(res, 503, { ok: false, error: '解析服务尚未就绪' })
                const sub = String(body.op).slice('parse.'.length)
                const uiCaller = { via: 'ui', gate: 'settings-api' }
                // 管理面写操作的唯一入口：设置页这条已鉴权的 HTTP 路由。
                // 服务层还会再要一次 viaAdmin（防止将来别处误用），不只依赖这一处布尔。
                const admin = { viaAdmin: true }
                try {
                  let out
                  if (['job', 'result', 'cancel', 'retry', 'land'].includes(sub)) {
                    const target = await parsingService.readJob(String(body.jobId ?? ''))
                    if (target?.source?.relPath && !target.source.external) await workbench.assertDisplay(target.source.relPath)
                  }
                  if (sub === 'providers') out = await parsingService.providersPublic()
                  else if (sub === 'provider.save') out = await parsingService.saveProvider(body.provider, { ...admin, credentialInput: body.credentials, clearCredential: body.clearCredential === true })
                  else if (sub === 'scan.start') out = await parsingService.scanStart({ mode: body.mode, directory: body.directory }, admin)
                  else if (sub === 'scan.status') out = parsingService.scanStatus(String(body.scanId || ''), admin)
                  else if (sub === 'scan.cancel') out = parsingService.scanCancel(String(body.scanId || ''), admin)
                  else if (sub === 'scan.add') out = await parsingService.scanAdd(String(body.scanId || ''), String(body.resultId || ''), admin)
                  else if (sub === 'provider.delete') out = await parsingService.deleteProvider(String(body.providerId ?? ''), admin)
                  else if (sub === 'default') out = await parsingService.setDefaults({ kind: String(body.kind ?? ''), id: String(body.providerId ?? '') }, admin)
                  else if (sub === 'policy') out = await parsingService.setPolicy(String(body.externalPolicy ?? ''), admin)
                  else if (sub === 'test-connection') out = await parsingService.testConnection(String(body.providerId ?? ''))
                  else if (sub === 'test-parse') out = await parsingService.testParse({ providerId: body.providerId, sourceRel: body.sourceRel, kind: body.kind }, { requestedBy: uiCaller })
                  else if (sub === 'submit') out = await parsingService.submit({ sourceRel: body.sourceRel, kind: body.kind, providerId: body.providerId, purpose: body.purpose }, { requestedBy: uiCaller })
                  else if (sub === 'jobs') out = await parsingService.listJobs({ limit: body.limit, offset: body.offset, kind: body.kind ?? null, status: body.status ?? null, filter: workbench.filterJobs })
                  else if (sub === 'requests') out = await parsingService.listRequests({ limit: body.limit, offset: body.offset, kind: body.kind ?? null, filter: workbench.filterJobs })
                  else if (sub === 'job') {
                    const job = await parsingService.readJob(String(body.jobId ?? ''))
                    out = job ? { ok: true, job: parsingService.publicJob(job) } : { ok: false, reason: 'not-found' }
                  } else if (sub === 'result') out = await parsingService.readResult(String(body.jobId ?? ''), { offset: body.offset, limit: body.limit, pages: Array.isArray(body.pages) ? body.pages.map(Number) : null })
                  else if (sub === 'cancel') out = await parsingService.cancel(String(body.jobId ?? ''), { by: uiCaller })
                  else if (sub === 'retry') out = await parsingService.retry(String(body.jobId ?? ''), { reason: '界面重试' })
                  else if (sub === 'land') out = await parsingService.land(String(body.jobId ?? ''), { title: body.title, kind: body.kind, tags: body.tags, entryId: body.entryId, expectedRevision: body.expectedRevision })
                  else return kbSendJson(res, 400, { ok: false, error: 'unknown parse op: ' + sub })
                  const hardFail = out && out.ok === false && ['SOURCE_ESCAPE', 'SOURCE_MISSING', 'UNSUPPORTED_FORMAT', 'FILE_TOO_LARGE', 'BAD_KIND', 'LOCAL_ONLY_BLOCKED', 'LOCAL_ONLY_DESTINATION_BLOCKED', 'LOCALITY_MISMATCH', 'ADMIN_ONLY', 'invalid-provider', 'BAD_ARGS', 'BAD_COMMAND'].includes(out.reason)
                  return kbSendJson(res, hardFail ? 400 : 200, out)
                } catch (error) {
                  return kbSendJson(res, 500, { ok: false, error: String((error && error.message) ?? error) })
                }
              }
              return kbSendJson(res, 400, { ok: false, error: `unknown op: ${String(body.op)}` })
            } catch (error) {
              kbSendJson(res, 500, { ok: false, error: String((error && error.message) ?? error) })
            }
          },
        }),
      'kb-core: settings api',
    )
    log('info', `设置接口已注册：${SETTINGS_API}`)
  } else {
    log('warn', '宿主未提供 webServer 服务：设置接口未注册（工具不受影响）')
  }

  // P1-C 自动恢复消费者：启动后先尝试消费一次（拿不到锁就跳过，不干扰其他实例）
  core.maybeRecover()
    .then((r) => {
      if (r && r.consumed > 0) log('info', `自动恢复：消费 ${r.consumed} 条恢复记录`)
      else if (r && r.skipped && r.skipped !== 'no-todo') log('info', `自动恢复跳过：${r.skipped}`)
    })
    .catch((error) => log('warn', `自动恢复失败（不影响使用）：${String((error && error.message) ?? error)}`))

    const selftestMode = process.env.KB_P0_SELFTEST
    if (selftestMode) {
      // S1：生产环境不能误触破坏性自检 —— 必须同时满足「环境变量授权」与「stateDir 下有标记文件」。
      // 自检本身另建独立 core / 独立 stateDir / 纯虚构库（见 selftest.js），不碰这里的 core 与绑定。
      const marker = path.join(stateDir, '.allow-selftest')
      const allowDestructive = process.env.KB_SELFTEST_ALLOW === '1' && fsExists(marker)
      log('info', `进入自检模式 mode=${selftestMode}（独立沙箱，破坏性授权=${allowDestructive}）`)
      try {
        await runSelftest({
          mode: selftestMode,
          log,
          makeCore: (cfg) => createCore(cfg, log),
          baseConfig: config,
          productionStateDir: stateDir,
          allowDestructive,
        })
      } catch (error) {
        log('error', '自检异常：' + String((error && error.message) ?? error))
        process.exit(2)
      }
    }
  }

  ctx.effect(
    () => () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    'kb-core: wait timer',
  )

  const probe = async () => {
    if (installed) return
    attempts += 1
    if (core === null) {
      // stateDir 解析结果必须注入 core 的配置：否则 config.stateDir='' 时 `path.resolve('')` 会落到宿主 cwd，
      // 使 config.json/binding.json/kb.log 写进进程工作目录（而不是 <profile>/kb-state）。
      core = createCore({ ...config, stateDir, resources: workbench.resources }, log)
      void workbench.runAutomatic().catch(error => console.warn('[kb-workbench] ' + error.message))
      // A live switch must not introduce an unprotected vault while ordinary
      // workers still hold permissions. This strict release requires a stopped
      // host + reprovision before changing the protected vault.
      const bindBeforeH1 = core.bind.bind(core)
      core.bind = async (target, opts = {}) => {
        // Legacy bind also switches an existing library without commit=true.
        // Check every entry before it can inspect or mutate another root.
        await ctx.get('h1Isolation')?.assertBindingTarget(target)
        return bindBeforeH1(target, opts)
      }
      try {
        const conf = await core.loadConfig()
        evidence.config = { file: core.paths.configFile, revision: conf.revision, kbPath: conf.kbPath, degraded: Boolean(conf.degraded) }
      } catch (error) {
        log('error', '配置载入失败：' + String((error && error.message) ?? error))
        evidence.configError = String((error && error.message) ?? error)
      }
      await flushEvidence()
    }
    const tools = ctx.get('tools')
    if (tools !== undefined) {
      try {
        await install(tools)
      } catch (error) {
        log('error', '安装失败：' + String((error && error.message) ?? error))
        evidence.installError = String((error && error.message) ?? error)
        await flushEvidence()
      }
      return
    }
    if (attempts === 1 || attempts % 10 === 0) log('warn', `等待 tools 服务：第 ${attempts} 次探测`)
    if (attempts >= 30) {
      log('error', '放弃：30 次探测仍拿不到 tools')
      evidence.fatal = 'tools service absent after 30 probes'
      await flushEvidence()
      return
    }
    timer = setTimeout(probe, 200)
  }

  probe().catch(async (error) => {
    log('error', '初始化异常：' + String((error && error.stack) ?? error))
    evidence.fatal = String((error && error.message) ?? error)
    await flushEvidence()
  })
}
