// 插件入口（host 半边）。只依赖 ctx 服务，不 import @deepseek-ai/*。
import { buildMap, MAP_RULES_VERSION } from './map.js'
// 工具契约：output { schema, render, presentationMeta? } 必填（宿主实测强制）。
// 注册方式：ctx.effect(() => tools.register(entry), label)
//
// P0.1 修复（对应验收意见 A、B、D）：
//   A. 新增 kb_init 工具；kb_bind 增加 confirmInit 预览/确认两段，普通会话即可完成首次建库
//   B. registeredTools 只列**注册成功**的项，失败项单列；L1 证据绑定本次构建信息，不再用常量自称通过
//   D. update 在**工具层**就要求 expectedRevision，缺则直接返回错误，不依赖 core 兜底
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { existsSync as fsExists, statSync as fsStat } from 'node:fs'
import path from 'node:path'
import { mkdir, writeFile, readFile, stat, realpath, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createCore, VERSION } from './kbcore.js'
import { runSelftest } from './selftest.js'
import { walkTree, privateRootOf, normSegs, toPosix as toPosixFile, DEFAULT_PRIVATE_DIRS, readImportSources, derivedPrivatePartitions, effectivePrivateDirs, knowledgeCount } from './fsindex.js'
import { createImportService } from './import-service.js'
import { inspectFolder } from './importer.js'

export const name = 'kb-core'
// 版本单一来源：kbcore 的 VERSION（package.json 必须与之一致）
export const PLUGIN_VERSION = VERSION

const text = (t) => [{ type: 'text', text: t }]
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

export function apply(ctx, config) {
  const startedAt = new Date().toISOString()
  const pkgRootForState = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const stateResolved = resolveStateDir(config, pkgRootForState)
  const stateDir = stateResolved.stateDir
  let installed = false
  let attempts = 0
  let timer = null
  let core = null
  // R1：UI 与工具共用的导入服务。在 install() 里创建（要等 core 就绪后才拿得到配置）。
  let importService = null

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
  const buildInfo = { version: PLUGIN_VERSION, buildId: null, files: [], stateDirSource: stateResolved.source, profile: stateResolved.profileDir }
  const buildPromise = (async () => {
    const list = ['package.json', 'cordis.patch.yml', 'src/host/index.js', 'src/host/kbcore.js', 'src/host/fsindex.js', 'src/host/importer.js', 'src/host/import-service.js', 'src/host/map.js', 'src/host/selftest.js', 'src/client/index.js']
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

  function toolDefs() {
    return [
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
          properties: { query: { type: 'string' }, limit: { type: 'number', description: '默认 5，最大 20' } },
          required: ['query'],
        },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { hits: { type: 'array', items: { type: 'object', additionalProperties: true } }, coverageNote: { type: 'string' } }, required: ['hits', 'coverageNote'] },
          render(_a, v) {
            if (!v.ok) return text(`检索失败：${v.reason ?? '-'}`)
            if (v.hits.length === 0) return text(v.coverageNote)
            const lines = v.hits.map((h, i) => `${i + 1}. ${h.title} — ${h.path}  (rev ${h.revision ?? '-'})\n   ${h.snippet}`)
            return text(`命中 ${v.hits.length} 条（mode=${v.mode}）：\n${lines.join('\n')}\n\n${v.coverageNote}`)
          },
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          const result = await core.search(args)
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
        description: '导入异构资料 / 旧库，与设置页共用同一后端流程。action=plan：只读冻结源清单（含逐文件 sha256、跳过目录、截断情况），不写任何东西；action=run：按清单执行（可中断、可重试、同一文件不重复建条目）；action=status：看阶段与成功/待处理/失败计数；action=cancel：中止。mode=attach 接入原目录（原件留原位）/ copy 复制导入（原件进 90-收件箱）。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['plan', 'run', 'status', 'cancel'] },
            source: { type: 'string', description: '源文件夹绝对路径（plan 必填）' },
            mode: { type: 'string', enum: ['attach', 'copy'], description: '默认 attach' },
            importId: { type: 'string', description: 'run/status/cancel 必填（plan 会返回）' },
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
        async execute(args) {
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

    const defs = toolDefs()
    for (const entry of defs) {
      evidence.registration.attempted.push(entry.name)
      try {
        ctx.effect(() => tools.register(entry), 'kb-core: ' + entry.name)
        evidence.registration.registered.push(entry.name) // B：只记真正成功的
        log('info', '已注册工具 ' + entry.name)
      } catch (error) {
        const detail = String((error && error.message) ?? error)
        evidence.registration.failed.push({ name: entry.name, error: detail })
        log('error', '注册工具 ' + entry.name + ' 失败：' + detail)
      }
    }
    probeServices()
    await flushEvidence()
    // B：ready 只说真实情况
    const okCount = evidence.registration.registered.length
    log(okCount === defs.length ? 'info' : 'error', `ready：${okCount}/${defs.length} 个工具注册成功${evidence.registration.failed.length ? '；失败：' + evidence.registration.failed.map((f) => f.name).join(',') : ''}`)

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
    new Promise((resolve) => {
      let buf = ''
      req.on('data', (chunk) => {
        buf += chunk
        if (buf.length > 1_000_000) req.destroy()
      })
      req.on('end', () => resolve(buf))
      req.on('error', () => resolve(''))
    })
  // ── 顶栏页签（审查意见 §四）：统一快照 + 全量清单 ─────────────────────
  // 原则：页面只消费这一份快照，不在前端二次推导；算不出来的显式标 known:false，
  //       「未知」绝不显示成「正常」。刷新只做只读扫描，不绑定、不建库、不重建索引。
  const KB_LIST_PAGE = 100
  const KB_LIST_MAX = 50000
  const OVERVIEW_TTL_MS = 8000
  let overviewCache = { at: 0, key: null, value: null, inflight: null }

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
    const key = kbSnapshotKey(st)
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
      const privateDirs = await kbEffectivePrivateDirs(conf, st.kbPath)
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
          issues.push({ kind: 'index-stale', label: '索引需重建（' + (st.index.reason || '未知') + '）', detail: '检索会自动回退扫描磁盘，结果不会漏；要重建请用 kb_check(rebuild=true)。' })
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
  if (webServer && typeof webServer.register === 'function') {
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
              if (body.op === 'status') return kbSendJson(res, 200, { ok: true, status: { ...(await current.status()), build: buildInfo } })
              if (body.op === 'map') {
                // R5：扫描根 = **当前绑定的库**（与 kb_status/工具同源）。
                // 要看别的库必须显式传 viewRoot，并在返回里标 readOnly —— 不静默混用"观察库"与"读写库"。
                const cur = await current.status()
                const viewRoot = typeof body.viewRoot === 'string' && body.viewRoot.trim() !== '' ? body.viewRoot.trim() : null
                const scanRoot = path.resolve(viewRoot !== null ? viewRoot : cur.kbPath)
                const readOnly = viewRoot !== null
                const mapConf = await current.getConfig().catch(() => null)
                const privateDirs = await kbEffectivePrivateDirs(mapConf, cur.kbPath)
                const cacheKey = `${cur.kbId ?? '-'}|${posix(scanRoot)}|${MAP_RULES_VERSION}|${readOnly ? 'ro' : 'rw'}|${(privateDirs ?? []).join(',')}`
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
                const privateDirs = await kbEffectivePrivateDirs(conf, cur.kbPath)
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
              }              if (body.op === 'bind') {
                const result = await current.bind(String(body.kbPath ?? ''), { confirmInit: body.confirmInit === true })
                return kbSendJson(res, 200, { ok: result.ok !== false, result })
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
      core = createCore({ ...config, stateDir }, log)
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
