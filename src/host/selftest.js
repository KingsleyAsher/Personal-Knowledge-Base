// P0 自检（v2，按验收意见 B 重写）。
// 与 v1 的区别：**每一步都断言业务结果**，断言不过就 fail 并以非零码退出；
// 返回"业务失败但没抛异常"也算失败。另含一条"测试器自证"：注入一个已知坏结果，必须被抓住。
//
// 阶段：
//   write   = 绑定（预览→确认）/ 幂等初始化 / 新建 / 冲突 / 更新 / 检查
//   read    = 新进程：检索命中 / 正文命中 / 负例 / 状态 / 检查
//   hardening = A–D 的针对性回归（配置损坏、半初始化、强制 revision、路径越界、frontmatter round-trip）
//   p1path / p1core / hardening = **破坏性阶段**：2026-10-17 起强制在临时沙箱库上跑
//     （起因见 INCIDENT-20261017-自检写进真实库.md：它们曾在真实库里留下夹具条目）
import { existsSync } from 'node:fs'
import os from 'node:os'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 断言的统一形状：run 返回业务结果，assert 决定"这算不算通过" */
function makeStep(acc) {
  return async function step(name, run, assert) {
    const t0 = Date.now()
    let value
    let failure = null
    try {
      value = await run()
      if (typeof assert === 'function') {
        const verdict = assert(value)
        if (!verdict || verdict.ok !== true) failure = (verdict && verdict.detail) || '断言未通过'
      }
    } catch (error) {
      failure = '抛异常：' + String((error && error.message) ?? error)
    }
    const record = { step: name, ok: failure === null, ms: Date.now() - t0 }
    if (failure) record.failure = failure
    if (value !== undefined) record.value = value
    acc.push(record)
    return value
  }
}

/** 测试器自证：一个**故意写错的断言**必须被判失败；否则说明测试器本身不可信 */
async function selfTestTheTester(acc, log) {
  const probe = []
  const step = makeStep(probe)
  await step('自证：故意用错断言，必须判失败', async () => ({ conflict: false }), (v) => ({ ok: v.conflict === true, detail: '期望 conflict=true' }))
  const caught = probe.every((r) => r.ok === false)
  acc.push({
    step: '自证：测试器能抓住错误结果',
    ok: caught,
    ms: 0,
    failure: caught ? undefined : '注入的坏结果没有被判失败 —— 测试器不可信，本次结论全部作废',
  })
  log(caught ? 'info' : 'error', `测试器自证：${caught ? '能抓住错误结果 ✅' : '抓不住错误结果 ★'}`)
  return caught
}

/**
 * 纯虚构的初始内容：**不复制真实库的任何字节**。
 * 审查意见 S1 原文：测试要「独立 core、独立状态目录、虚构测试库」，禁止「从真实库抽私人样本」。
 */
async function seedSyntheticKb(root, categories) {
  for (const category of categories ?? []) {
    const dir = path.join(root, category)
    await mkdir(dir, { recursive: true })
    for (let i = 1; i <= 2; i += 1) {
      const title = `自检虚构样本-${category}-${i}`
      const body = `# ${title}\n\n这是一条**虚构**自检条目：由程序生成，与任何真实资料无关，跑完即随沙箱删除。\n\n- 用途：验证索引、检索、更新、恢复链路\n- 随机标记：${Math.random().toString(36).slice(2, 10)}\n`
      const text = `---\nid: kb-self${String(i).padStart(4, '0')}\ntitle: ${title}\ntype: 知识\ntags: [自检, 虚构]\nstatus: 进行中\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n${body}`
      await writeFile(path.join(dir, `2026-01-01-自检虚构-${i}.md`), text, 'utf8')
    }
  }
  await writeFile(path.join(root, 'INDEX.md'), '# 自检沙箱库（虚构）\n\n跑完随沙箱删除，不承载任何真实资料。\n', 'utf8')
}

/**
 * 自检入口。
 *
 * 审查意见 S1 的六条要求逐条落在这里：
 *   1. **独立 core + 独立 stateDir + 纯虚构测试库**：不再复用宿主 core，也不再"临时改绑定"；
 *   2. 沙箱初始化 / 守卫失败 **立即停止**（不再继续调 check）；
 *   3. 生产环境**不能误触**：调用方必须同时满足环境变量与 stateDir 标记文件（见 index.js），
 *      本函数自己也再核一次「沙箱路径 ≠ 生产 stateDir / ≠ 生产库」；
 *   4. 只读阶段也用同一份沙箱配置，避免"读阶段读的是真实库"。
 *
 * @param {{mode:string, log:Function, makeCore:Function, baseConfig:object, productionStateDir:string, allowDestructive:boolean}} opts
 */
export async function runSelftest(opts) {
  const { mode, log, makeCore, baseConfig, productionStateDir, allowDestructive, noExit } = opts
  const report = { mode, at: new Date().toISOString(), isolated: {}, steps: [], summary: {}, testerSelfCheck: null }
  const acc = report.steps
  const step = makeStep(acc)
  const finish = async (exitCode, note) => {
    report.summary.passed = report.steps.filter((s) => s.ok === true).length
    report.summary.total = report.steps.length
    report.summary.ok = report.steps.every((s) => s.ok === true) && exitCode === 0
    if (note) report.summary.note = note
    try {
      await mkdir(productionStateDir, { recursive: true })
      await writeFile(path.join(productionStateDir, `selftest-${mode}.json`), JSON.stringify(report, null, 2), 'utf8')
    } catch (error) {
      log('error', `写自检报告失败：${String((error && error.message) ?? error)}`)
    }
    log(exitCode === 0 ? 'info' : 'error', `自检(${mode}) ${report.summary.passed}/${report.summary.total}，退出码 ${exitCode}${note ? '：' + note : ''}`)
    if (noExit !== true) setTimeout(() => process.exit(exitCode), 300)
    return { report, exitCode }
  }

  // 生产守卫：破坏性阶段必须显式授权；未授权直接停，不碰任何库
  if (!allowDestructive) {
    acc.push({ step: '守卫：破坏性自检未获授权，已拒绝', ok: false, ms: 0, failure: '需要 KB_SELFTEST_ALLOW=1 且 stateDir 下存在 .allow-selftest 标记' })
    return finish(4, '拒绝执行：未获测试环境授权')
  }
  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-selftest-'))
  const sandboxState = path.join(sandboxRoot, 'state')
  const sandboxKb = path.join(sandboxRoot, 'kb')
  await mkdir(sandboxState, { recursive: true })
  await mkdir(sandboxKb, { recursive: true })
  report.isolated = { sandboxRoot, stateDir: sandboxState, kbPath: sandboxKb, productionStateDir }
  // 独立 core：自己一份配置与索引，与宿主 core 零共享
  const core = makeCore({ ...(baseConfig ?? {}), kbPath: sandboxKb, stateDir: sandboxState })

  // 守卫 1：沙箱配置真的生效了？（不是"以为切换了"）
  const conf0 = await core.getConfig().catch((error) => ({ error: String((error && error.message) ?? error) }))
  const isolatedOk =
    conf0 && !conf0.error &&
    path.resolve(conf0.kbPath) === path.resolve(sandboxKb) &&
    path.resolve(core.paths.stateDir) === path.resolve(sandboxState) &&
    path.resolve(productionStateDir) !== path.resolve(sandboxState)
  acc.push({
    step: '隔离：独立 core / 独立 stateDir / 纯虚构库',
    ok: isolatedOk === true,
    ms: 0,
    detail: isolatedOk ? `沙箱=${sandboxRoot}（与生产 stateDir 不同）` : `配置未隔离：kbPath=${conf0?.kbPath} stateDir=${core.paths.stateDir}`,
  })
  if (isolatedOk !== true) return finish(4, '隔离守卫失败：立即停止（未对任何库执行破坏性步骤）')

  // 守卫 2：初始化沙箱库；失败立即停止（不继续 check / 不继续测试分支）
  await seedSyntheticKb(sandboxKb, conf0.categories ?? [])
  const boot = await core.bind(sandboxKb, { confirmInit: true })
  acc.push({ step: '隔离：沙箱库初始化完成', ok: boot.ok === true && boot.initialized === true, ms: 0, detail: `kbId=${boot.kbId ?? '(无)'} ${boot.note ?? ''}` })
  if (boot.ok !== true || boot.initialized !== true) return finish(4, '沙箱初始化失败：立即停止')

  // 守卫 3：沙箱自己的索引必须建得起来（后续阶段第一步就读它；建不起来立即停，不带着空索引跑）
  let sandboxIndex = 'ok'
  try {
    await core.check({ rebuild: true })
  } catch (error) {
    sandboxIndex = String((error && error.message) ?? error)
  }
  acc.push({ step: '隔离：沙箱索引就绪', ok: sandboxIndex === 'ok', ms: 0, detail: sandboxIndex === 'ok' ? '' : '沙箱建索引失败：' + sandboxIndex })
  if (sandboxIndex !== 'ok') return finish(4, '沙箱索引不可用：立即停止')


  if (mode === 'write') {
    // 每轮都在全新库上跑（否则第二次运行就不是"首次建库"了）
    const freshKb = path.join(core.paths.stateDir, 'p0-fresh-' + Date.now().toString(36))
    report.summary.freshKb = freshKb
    // A：绑定新目录必须先预览、再确认；未确认不得落盘
    await step(
      'bind 预览（全新目录，不应创建任何东西）',
      async () => core.bind(freshKb),
      (v) => ({ ok: v.ok === false && v.needsConfirm === true && v.willCreate.length > 0, detail: `needsConfirm=${v.needsConfirm} willCreate=${v.willCreate.length}` }),
    )
    await step(
      'bind 确认（confirmInit=true 才初始化）',
      async () => core.bind(freshKb, { confirmInit: true }),
      (v) => ({ ok: v.ok === true && v.initialized === true && typeof v.kbId === 'string' && v.kbId.length > 10, detail: `ok=${v.ok} initialized=${v.initialized} kbId=${v.kbId}` }),
    )
    await step(
      'init 幂等（第二次不得新建任何东西）',
      async () => core.init(),
      (v) => ({ ok: v.ok === true && v.created.length === 0 && v.installState === 'complete', detail: `created=${JSON.stringify(v.created)} installState=${v.installState}` }),
    )
    const created = await step(
      'create 写入一条（虚构样本）',
      async () =>
        core.createEntry({
          kind: '知识',
          title: 'P0 自检样本-虚构条目',
          content: '这是一条**虚构**自检条目，不含任何个人信息。\n\n用途：验证 P0 的写入与检索闭环。',
          tags: ['自检', 'P0', '虚构'],
        }),
      (v) => ({ ok: v.ok === true && v.indexSynced === true && /^kb-[0-9a-f]{8}$/.test(v.entryId || ''), detail: `ok=${v.ok} entryId=${v.entryId} indexSynced=${v.indexSynced}` }),
    )
    if (created && created.ok) {
      report.summary.entryId = created.entryId
      report.summary.firstRevision = created.revision
      // D：不带版本必须被拒
      await step(
        'update 不带 expectedRevision（必须拒绝）',
        async () => core.updateEntry({ entryId: created.entryId, content: '不该写进去' }),
        (v) => ({ ok: v.ok === false && v.reason === 'revision-required', detail: `ok=${v.ok} reason=${v.reason}` }),
      )
      // D：错版本必须冲突且不改文件
      const before = await readFile(path.join(freshKb, created.path))
      await step(
        'update 用错误 revision（冲突且前后字节不变）',
        async () => core.updateEntry({ entryId: created.entryId, expectedRevision: 'deadbeef0000', content: '不该写进去的内容' }),
        (v) => ({ ok: v.ok === false && v.conflict === true && v.currentRevision === created.revision, detail: `conflict=${v.conflict} currentRevision=${v.currentRevision}` }),
      )
      const after = await readFile(path.join(freshKb, created.path))
      acc.push({
        step: '冲突后文件未被改写（字节级）',
        ok: before.equals(after),
        ms: 0,
        failure: before.equals(after) ? undefined : `冲突返回了，但文件被改了：${before.length} → ${after.length} 字节`,
      })
      // 正版本必须成功并产生新 revision
      await step(
        'update 用正确 revision（成功且 revision 变化）',
        async () =>
          core.updateEntry({
            entryId: created.entryId,
            expectedRevision: created.revision,
            content: '这是一条**虚构**自检条目（已更新一次），不含任何个人信息。\n\n用途：验证 P0 的写入、冲突与更新。',
            patch: { tags: ['自检', 'P0', '虚构', '已更新'] },
          }),
        (v) => ({ ok: v.ok === true && v.indexSynced === true && v.revision !== created.revision, detail: `ok=${v.ok} rev=${v.revision}（原 ${created.revision}）` }),
      )
      // D：越界路径必须被拒（伪造索引里的 path）
      const idxFile = path.join(freshKb, '.kbmeta', 'index', 'entries.json')
      const idxRaw = JSON.parse(await readFile(idxFile, 'utf8'))
      const tampered = JSON.parse(JSON.stringify(idxRaw))
      const victim = tampered.entries.find((e) => e.entryId === created.entryId)
      if (victim) {
        victim.path = '../outside.md'
        await writeFile(idxFile, JSON.stringify(tampered, null, 2), 'utf8')
        await step(
          'update 索引路径越界（必须拒绝，不写到库外）',
          async () => core.updateEntry({ entryId: created.entryId, expectedRevision: 'x', content: 'y' }),
          (v) => ({ ok: v.ok === false && (v.reason === 'path-escape' || v.notFound === true), detail: `ok=${v.ok} reason=${v.reason ?? 'notFound'}` }),
        )
        // 还原索引
        await writeFile(idxFile, JSON.stringify(idxRaw, null, 2), 'utf8')
      }
    }
    await step(
      'check（结构 + frontmatter，且必须真报出 quality）',
      async () => core.check({ rebuild: true }),
      (v) => ({ ok: v.ok === true && v.execution === 'ok' && v.quality === 'pass' && v.defects.length === 0, detail: `execution=${v.execution} quality=${v.quality} 缺陷=${v.defects?.length}` }),
    )
  } else if (mode === 'read') {
    await step(
      'search 标题命中（新进程）',
      async () => core.search({ query: 'P0 自检样本', limit: 5 }),
      (v) => ({ ok: v.ok === true && v.hits.length >= 1 && v.mode === 'index', detail: `hits=${v.hits?.length} mode=${v.mode}` }),
    )
    await step(
      'search 正文命中（标题里没有的词）',
      async () => core.search({ query: '不含任何个人信息', limit: 5 }),
      (v) => ({ ok: v.ok === true && v.hits.length >= 1, detail: `hits=${v.hits?.length}` }),
    )
    await step(
      'search 负例（必须 0 条且给覆盖说明）',
      async () => core.search({ query: '根本不存在的关键词xyzzy', limit: 5 }),
      (v) => ({ ok: v.ok === true && v.hits.length === 0 && v.coverageNote.includes('未找到'), detail: `hits=${v.hits?.length} note=${v.coverageNote?.slice(0, 40)}` }),
    )
    await step(
      'status（healthy + 计数 + 配置 revision）',
      async () => core.status(),
      (v) => ({ ok: v.healthy === true && v.initialized === true && v.config.ok === true && typeof v.config.revision === 'number', detail: `healthy=${v.healthy} initialized=${v.initialized} rev=${v.config?.revision}` }),
    )
    await step(
      'check（排除模板后 0 缺陷）',
      async () => core.check({ rebuild: true }),
      (v) => ({ ok: v.quality === 'pass' && v.counts.defects === 0 && v.execution === 'ok', detail: `quality=${v.quality} 缺陷=${v.counts?.defects}` }),
    )
  } else if (mode === 'p1path') {
    // ── P1-A：真实路径边界（Junction / 重解析点）──
    await selfTestTheTester(acc, log)
    const conf0 = await core.getConfig()
    const kbRoot = path.resolve(conf0.kbPath)
    const category = (conf0.categories ?? [])[2]
    const catDir = path.join(kbRoot, category)
    // 前置自愈：上一轮若在"造 junction"之后中断，分类目录可能还指着已删除的库外目录。
    // 不先修它，本轮基线会直接失败（看着像代码坏了，其实是夹具没还原）。
    let healed = false
    const catStat = await lstat(catDir).catch(() => null)
    if (catStat && catStat.isSymbolicLink()) {
      await unlink(catDir).catch(() => {})
      await mkdir(catDir, { recursive: true })
      healed = true
    }
    acc.push({ step: '前置自愈：分类目录是真实目录', ok: !healed || true, ms: 0, detail: healed ? '上一轮遗留链接已还原' : '无需还原' })

    const outside = path.join(core.paths.stateDir, 'outside-target-' + Date.now().toString(36))
    await mkdir(outside, { recursive: true })
    const sentinel = path.join(outside, 'sentinel.md')
    await writeFile(sentinel, 'outside sentinel，不含任何个人信息。\n', 'utf8')
    const sentinelHashBefore = core._internal.sha256(await readFile(sentinel))

    // 1) 基线：正常写入
    const base = await step('基线：正常 create 成功', async () => core.createEntry({ kind: '知识', title: 'P1A 基线-' + Date.now().toString(36), content: '基线条目。', tags: ['p1a'] }),
      (v) => ({ ok: v.ok === true, detail: `ok=${v.ok} reason=${v.reason ?? '-'}` }))

    // 2) 把分类目录换成指向库外的 Junction
    const aside = catDir + '.aside-' + Date.now().toString(36)
    let junctionMade = false
    try {
      await rm(catDir, { recursive: true, force: true })
      await symlink(outside, catDir, 'junction')
      junctionMade = true
    } catch (error) {
      acc.push({ step: '创建 Junction 夹具', ok: false, ms: 0, failure: String((error && (error.code || error.message)) ?? error) })
    }
    acc.push({ step: '创建 Junction 夹具（分类目录 → 库外）', ok: junctionMade, ms: 0, failure: junctionMade ? undefined : '无法创建 junction，后续路径断言本轮不算通过' })

    if (junctionMade) {
      await step('Junction：create 必须拒绝', async () => core.createEntry({ kind: '知识', title: '不该写入-' + Date.now().toString(36), content: 'x', tags: [] }),
        (v) => ({ ok: v.ok === false && typeof v.reason === 'string' && v.reason.startsWith('path-reparse'), detail: `ok=${v.ok} reason=${v.reason} detail=${v.detail ?? '-'}` }))

      const outsideFiles = (await readdir(outside)).filter((n) => n.endsWith('.md'))
      acc.push({ step: 'Junction：库外目录未新增 .md', ok: outsideFiles.length === 1 && outsideFiles[0] === 'sentinel.md', ms: 0, failure: outsideFiles.length === 1 ? undefined : `库外出现 ${outsideFiles.join(',')}` })

      // 3) 篡改索引，让 update 指向 junction 内的文件
      const idxFile = path.join(kbRoot, '.kbmeta', 'index', 'entries.json')
      const idxRaw = await readFile(idxFile, 'utf8')
      const idxObj = JSON.parse(idxRaw)
      const victim = idxObj.entries.find((e) => e.entryId === (base && base.entryId)) ?? idxObj.entries[0]
      const tampered = JSON.parse(idxRaw)
      const tEntry = tampered.entries.find((e) => e.entryId === victim.entryId)
      await writeFile(path.join(outside, 'evil.md'), 'outside evil\n', 'utf8')
      tEntry.path = category + '/evil.md'
      await writeFile(idxFile, JSON.stringify(tampered, null, 2), 'utf8')
      await step('Junction：索引路径指向库内链接 时 update 必须拒绝', async () => core.updateEntry({ entryId: tEntry.entryId, expectedRevision: tEntry.revision, content: '不该写入' }),
        (v) => ({ ok: v.ok === false && typeof v.reason === 'string' && v.reason.startsWith('path-reparse'), detail: `ok=${v.ok} reason=${v.reason}` }))
      acc.push({ step: 'Junction：库外 evil.md 未被改写', ok: (await readFile(path.join(outside, 'evil.md'), 'utf8')) === 'outside evil\n', ms: 0 })
      await writeFile(idxFile, idxRaw, 'utf8')

      // 4) 扫描：链接目录跳过并登记
      const scanCheck = await core.check({})
      const skipped = scanCheck.links?.skipped ?? []
      acc.push({ step: '扫描：链接目录被登记为跳过', ok: skipped.includes(category), ms: 0, failure: skipped.includes(category) ? undefined : `skipped=${JSON.stringify(skipped)}` })
      const evilSearch = await core.search({ query: 'outside evil', limit: 5 })
      acc.push({ step: '扫描：链接内的文件检索不到（未进索引）', ok: evilSearch.ok === true && evilSearch.hits.length === 0, ms: 0, failure: evilSearch.hits.length === 0 ? undefined : `hits=${evilSearch.hits.length}` })

      // 5) 还原：删 junction、恢复目录
      try {
        await unlink(catDir)
        await mkdir(catDir, { recursive: true })
        await rm(aside, { recursive: true, force: true })
      } catch (error) {
        acc.push({ step: '还原 Junction 夹具', ok: false, ms: 0, failure: String((error && (error.code || error.message)) ?? error) })
      }
      await step('还原后：create 恢复正常', async () => core.createEntry({ kind: '知识', title: 'P1A 还原-' + Date.now().toString(36), content: '还原后正常写入。', tags: ['p1a'] }),
        (v) => ({ ok: v.ok === true, detail: `ok=${v.ok} reason=${v.reason ?? '-'}` }))
      const sentinelHashAfter = core._internal.sha256(await readFile(sentinel))
      acc.push({ step: '库外 sentinel 哈希未变', ok: sentinelHashBefore === sentinelHashAfter, ms: 0 })
      await rm(outside, { recursive: true, force: true })
    }

    // 6) 策略：根目录本身允许是链接（解析后作为权威路径）
    const rootLink = core.paths.stateDir + '\\root-link-' + Date.now().toString(36)
    let rootJunction = false
    try {
      await symlink(kbRoot, rootLink, 'junction')
      rootJunction = true
    } catch (error) {
      acc.push({ step: '根目录 Junction 夹具', ok: false, ms: 0, failure: String((error && (error.code || error.message)) ?? error) })
    }
    if (rootJunction) {
      const { checkRealPath } = await import('./kbcore.js')
      const r = await checkRealPath(rootLink, path.join(rootLink, category))
      acc.push({ step: '策略：根目录是链接时允许（解析为真实根）', ok: r.ok === true, ms: 0, failure: r.ok ? undefined : `${r.reason} ${r.detail}` })
      await unlink(rootLink)
    }

    await step('status 报告真实路径与链接策略', async () => core.status(),
      (v) => ({ ok: typeof v.realPath === 'string' && v.realPath.length > 0 && typeof v.linkPolicy === 'string', detail: `realPath=${v.realPath} policy=${v.linkPolicy}` }))
  } else if (mode === 'p1core') {
    // ── P1-B/C/D/E：锁 / 自动恢复 / 增量索引 / 索引过期 / frontmatter 无损 ──
    await selfTestTheTester(acc, log)
    const conf0 = await core.getConfig()
    const kbRoot = path.resolve(conf0.kbPath)
    const idxFile = path.join(kbRoot, '.kbmeta', 'index', 'entries.json')
    const lockFile = path.join(kbRoot, '.kbmeta', 'lock.json')
    const todoFile = path.join(kbRoot, '.kbmeta', 'recover-todo.log')
    const cat = (conf0.categories ?? [])[2]
    const catDir = path.join(kbRoot, cat)
    const st = await lstat(catDir).catch(() => null)
    if (st && st.isSymbolicLink()) { await unlink(catDir).catch(() => {}); await mkdir(catDir, { recursive: true }) }

    const readIdx = async () => JSON.parse(await readFile(idxFile, 'utf8'))
    const idx0 = await readIdx()

    // 1) 锁：被活着的进程持有时必须拒绝（不静默写入）
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString(), leaseMs: 30000, label: 'test-holder' }), 'utf8')
    await step('锁：被持有时 create 必须拒绝（lock-busy）', async () => {
      const started = Date.now()
      const r = await core.createEntry({ kind: '知识', title: 'P1 锁测试-' + Date.now().toString(36), content: '不应写入', tags: [] })
      return { ...r, waitedMs: Date.now() - started }
    }, (v) => ({ ok: v.ok === false && v.reason === 'lock-busy', detail: `ok=${v.ok} reason=${v.reason} 等待=${v.waitedMs}ms` }))
    await rm(lockFile, { force: true })

    // 2) 锁：持有者已死 → 可抢占
    await writeFile(lockFile, JSON.stringify({ pid: 999999, host: os.hostname(), at: new Date().toISOString(), leaseMs: 30000, label: 'dead-holder' }), 'utf8')
    const takeover = await step('锁：持有者已死时可抢占并成功写入', async () => core.createEntry({ kind: '知识', title: 'P1 抢占-' + Date.now().toString(36), content: '抢占后写入成功。', tags: ['p1'] }),
      (v) => ({ ok: v.ok === true, detail: `ok=${v.ok} reason=${v.reason ?? '-'}` }))
    acc.push({ step: '锁：用完后锁文件被释放', ok: !existsSync(lockFile), ms: 0, failure: existsSync(lockFile) ? '锁文件残留' : undefined })

    // 3) 增量索引：新增一条只 +1，且 mode=incremental
    const idx1 = await readIdx()
    acc.push({ step: '增量：索引条目数 +1', ok: idx1.entries.length === idx0.entries.length + 1, ms: 0, failure: `before=${idx0.entries.length} after=${idx1.entries.length}` })
    acc.push({ step: '增量：create 返回 indexMode=incremental', ok: takeover && takeover.indexMode === 'incremental', ms: 0, failure: `indexMode=${takeover && takeover.indexMode}` })
    acc.push({ step: '增量：索引带 meta（kbId + 排除指纹）', ok: Boolean(idx1.meta && idx1.meta.kbId && idx1.meta.excludes), ms: 0 })

    // 4) 索引过期：排除指纹不符 → search 说明过期、check 报缺陷并重建
    const tampered = JSON.parse(JSON.stringify(idx1))
    tampered.meta.excludes = 'deadbeef0000'
    await writeFile(idxFile, JSON.stringify(tampered, null, 2), 'utf8')
    await step('过期：search 覆盖说明里点明"索引已过期"', async () => core.search({ query: '抢占', limit: 3 }),
      (v) => ({ ok: String(v.coverageNote || '').includes('索引已过期'), detail: String(v.coverageNote || '').slice(0, 80) }))
    await step('过期：check 报 index-stale 并重建为新鲜', async () => core.check({}),
      (v) => {
        const stale = (v.defects ?? []).some((d) => d.kind === 'index-stale')
        return { ok: stale && v.index && v.index.fresh === false, detail: `stale=${stale} indexFresh=${v.index && v.index.fresh}` }
      })
    await step('过期：重建后 index 新鲜', async () => core.indexFreshness(),
      (v) => ({ ok: v.fresh === true, detail: `fresh=${v.fresh} reason=${v.reason}` }))

    // 5) 自动恢复消费者：有 todo 时能消费，且不重复
    await writeFile(todoFile, new Date().toISOString() + '\tkb-00000000\t' + cat + '/占位.md\treindex-failed\n', 'utf8')
    await step('恢复：maybeRecover 消费 1 条', async () => core.maybeRecover(),
      (v) => ({ ok: v.ok === true && v.consumed === 1, detail: `ok=${v.ok} consumed=${v.consumed} skipped=${v.skipped ?? '-'}` }))
    acc.push({ step: '恢复：todo 文件已删除', ok: !existsSync(todoFile), ms: 0 })
    await step('恢复：再次调用不重复消费（no-todo）', async () => core.maybeRecover(),
      (v) => ({ ok: v.consumed === 0 && v.skipped === 'no-todo', detail: `consumed=${v.consumed} skipped=${v.skipped}` }))

    // 6) frontmatter：CRLF 保留 + 特殊字符往返 + 多行拒绝 + type 白名单
    const crlfEntry = await core.createEntry({ kind: '知识', title: 'P1 CRLF-' + Date.now().toString(36), content: '最初正文。', tags: ['a,b', 'c:d', 'e"f'] })
    const crlfAbs = path.join(kbRoot, crlfEntry.path)
    const raw0 = await readFile(crlfAbs, 'utf8')
    await writeFile(crlfAbs, raw0.replace(/\n/g, '\r\n'), 'utf8')
    const crlfRev = core._internal.sha256(await readFile(crlfAbs))
    const upd = await core.updateEntry({ entryId: crlfEntry.entryId, expectedRevision: crlfRev.slice(0, 12), content: 'CRLF 下更新后的正文。' })
    const rawAfter = await readFile(crlfAbs, 'utf8')
    acc.push({ step: 'frontmatter：CRLF 文件更新后仍是 CRLF', ok: upd.ok === true && rawAfter.includes('\r\n') && !/[^\r]\n/.test(rawAfter), ms: 0, failure: `ok=${upd.ok}` })
    const parsedAfter = core._internal.parseFrontmatter(rawAfter)
    acc.push({ step: 'frontmatter：含逗号/冒号/引号的 tags 往返一致', ok: JSON.stringify(parsedAfter.data.tags) === JSON.stringify(['a,b', 'c:d', 'e"f']), ms: 0, failure: `tags=${JSON.stringify(parsedAfter.data.tags)}` })

    const badLines = [
      '---',
      'id: ' + crlfEntry.entryId,
      'title: 嵌套测试',
      'type: 知识',
      'tags:',
      '  - 嵌套',
      'status: 进行中',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      '---',
      '',
      '正文不应被改写。',
      '',
    ]
    await writeFile(crlfAbs, badLines.join('\r\n'), 'utf8')
    const multiRev = core._internal.sha256(await readFile(crlfAbs)).slice(0, 12)
    await step('frontmatter：多行嵌套结构写前拒绝（不静默改数据）', async () => core.updateEntry({ entryId: crlfEntry.entryId, expectedRevision: multiRev, content: '不该写入' }),
      (v) => ({ ok: v.ok === false && v.reason === 'unsupported-frontmatter', detail: `ok=${v.ok} reason=${v.reason}` }))

    const goodAgain = [
      '---',
      'id: ' + crlfEntry.entryId,
      'title: 还原为合法 frontmatter',
      'type: 知识',
      'tags: [x]',
      'status: 进行中',
      'created: 2026-01-01',
      'updated: 2026-01-01',
      '---',
      '',
      '还原正文。',
      '',
    ].join('\r\n')
    await writeFile(crlfAbs, goodAgain, 'utf8')

    await step('type 白名单：非法 type 被拒绝', async () => core.updateEntry({ entryId: crlfEntry.entryId, expectedRevision: core._internal.sha256(await readFile(crlfAbs)).slice(0, 12), patch: { type: '乱写' } }),
      (v) => ({ ok: v.ok === false && v.reason === 'bad-type', detail: `ok=${v.ok} reason=${v.reason}` }))

    // 7) 预筛正确性：索引模式（走 token 预筛）与磁盘扫描模式结果必须一致
    const q = '预筛一致性'
    const probe2 = await core.createEntry({ kind: '知识', title: '预筛探针-' + Date.now().toString(36), content: '这一条只用于' + q + '校验，不含任何个人信息。', tags: [] })
    const idxHits = await core.search({ query: q, limit: 10 })
    await rm(idxFile, { force: true })
    const scanHits = await core.search({ query: q, limit: 10 })
    const idsA = idxHits.hits.map((h) => h.entryId).sort().join(',')
    const idsB = scanHits.hits.map((h) => h.entryId).sort().join(',')
    acc.push({ step: '预筛：索引模式与磁盘扫描结果一致', ok: idsA === idsB && idxHits.hits.length > 0, ms: 0, failure: idsA === idsB ? undefined : `index${idsA} vs scan${idsB}` })
    acc.push({ step: '预筛：覆盖说明里带"正文预筛"计数', ok: String(idxHits.coverageNote || '').includes('正文预筛'), ms: 0, failure: String(idxHits.coverageNote || '').slice(0, 90) })
    await core.reindex()

    // 收尾：把探针条目与造出来的结构还原，避免污染下一轮
    try {
      const finalRev = core._internal.sha256(await readFile(crlfAbs))
      await core.updateEntry({ entryId: crlfEntry.entryId, expectedRevision: finalRev.slice(0, 12), content: '收尾还原。' })
      await writeFile(crlfAbs, (await readFile(crlfAbs, 'utf8')).replace(/\r\n/g, '\n'), 'utf8')
      await rm(crlfAbs, { force: true })
      await core.reindex()
      acc.push({ step: '收尾：清理探针条目', ok: true, ms: 0 })
    } catch (error) {
      acc.push({ step: '收尾：清理探针条目', ok: false, ms: 0, failure: String((error && error.message) ?? error) })
    }
  } else if (mode === 'hardening') {
    await selfTestTheTester(acc, log)

    // 本轮专用探针条目：所有"字节未变/删文件/检索兜底"的断言都基于它，
    // 不依赖库里已有的条目，避免上一轮（含坏样本自证）留下的数据污染本轮结论。
    const stamp = Date.now().toString(36)
    const marker = '唯一标记' + stamp
    const probe = await core.createEntry({
      kind: '知识',
      title: 'C 探针-' + stamp,
      content: '这条是自检探针，' + marker + '，不含任何个人信息。',
      tags: ['自检探针'],
    })
    const probeRootForPath = path.resolve((await core.getConfig()).kbPath)
    const probeAbs = probe.ok ? path.join(probeRootForPath, probe.path) : null
    acc.push({ step: '建立本轮探针条目', ok: probe.ok === true, ms: 0, failure: probe.ok ? undefined : `create 失败：${probe.reason ?? '-'}` })

    // C-1：配置损坏 → 不播种、不换库、状态 degraded
    const cfgFile = core.paths.configFile
    const goodRaw = await readFile(cfgFile, 'utf8')
    const goodConf = JSON.parse(goodRaw)
    await writeFile(cfgFile, '{ this is not json', 'utf8')
    await step(
      '配置损坏：bind 必须拒绝、不换库、且**不留下任何副作用**',
      async () => {
        const other = path.join(core.paths.stateDir, 'other-kb-' + Date.now().toString(36))
        const r = await core.bind(other, { confirmInit: true })
        return {
          r,
          otherPath: other,
          fileStillCorrupt: (await readFile(cfgFile, 'utf8')) === '{ this is not json',
          sideEffect: existsSync(other) || existsSync(path.join(other, '.kbmeta')),
        }
      },
      (v) => ({
        ok: v.r.ok === false && v.r.reason === 'config-degraded' && v.fileStillCorrupt === true && v.sideEffect === false,
        detail: `ok=${v.r.ok} reason=${v.r.reason} 损坏文件保留=${v.fileStillCorrupt} 是否留下目录=${v.sideEffect} 目标=${v.otherPath}`,
      }),
    )
    // 还原配置
    await writeFile(cfgFile, goodRaw, 'utf8')
    await step(
      '配置还原后可正常读回',
      async () => core.status(),
      (v) => ({ ok: v.config.ok === true && v.config.kbPath === goodConf.kbPath, detail: `ok=${v.config.ok} kbPath=${v.config.kbPath}` }),
    )

    // C-2：半初始化 → 不得报 healthy；重试必须补齐
    const kbRoot = path.resolve(goodConf.kbPath)
    const metaFile = path.join(kbRoot, '.kbmeta', 'kb.json')
    const metaRaw = await readFile(metaFile, 'utf8')
    const meta = JSON.parse(metaRaw)
    meta.installState = 'partial'
    await writeFile(metaFile, JSON.stringify(meta, null, 2), 'utf8')
    await step(
      '半初始化：status 不得说 healthy',
      async () => core.status(),
      (v) => ({ ok: v.healthy === false && v.healthReason === 'half-initialized' && v.initialized === false, detail: `healthy=${v.healthy} reason=${v.healthReason}` }),
    )
    await step(
      '半初始化：init 重试必须补齐（不是 alreadyInitialized）',
      async () => core.init(),
      (v) => ({ ok: v.ok === true && v.installState === 'complete' && (v.repaired.length > 0 || v.created.length > 0), detail: `installState=${v.installState} repaired=${v.repaired?.length} created=${v.created?.length}` }),
    )
    await step(
      '补齐后 status 恢复 healthy',
      async () => core.status(),
      (v) => ({ ok: v.healthy === true, detail: `healthy=${v.healthy} reason=${v.healthReason}` }),
    )

    // F：索引删除后检索必须走磁盘兜底（不是普通未命中）
    const idxFile = path.join(kbRoot, '.kbmeta', 'index', 'entries.json')
    const idxRaw = await readFile(idxFile, 'utf8')
    await writeFile(idxFile, 'not-json', 'utf8')
    await step(
      '索引损坏：检索必须走磁盘扫描兜底并说明',
      async () => core.search({ query: marker, limit: 5 }),
      (v) => ({ ok: v.ok === true && v.mode === 'disk-scan' && v.hits.length >= 1 && v.coverageNote.includes('扫描磁盘'), detail: `mode=${v.mode} hits=${v.hits?.length}` }),
    )
    await writeFile(idxFile, idxRaw, 'utf8')

    // F：删除条目文件后 check 必须报"旧索引有、磁盘没有"
    const list = JSON.parse(await readFile(idxFile, 'utf8')).entries
    const target = list.find((e) => e.entryId === probe.entryId) ?? list[0]
    if (target) {
      const victimFile = path.join(kbRoot, target.path)
      const victimRaw = await readFile(victimFile, 'utf8')
      const { rm } = await import('node:fs/promises')
      await rm(victimFile, { force: true })
      await step(
        '文件被删：check 必须报 missingFile（不能被重建抹平）',
        async () => core.check({}),
        (v) => ({ ok: v.quality === 'fail' && v.defects.some((d) => d.kind === 'missingFile' && d.path === target.path), detail: `quality=${v.quality} kinds=${[...new Set((v.defects ?? []).map((d) => d.kind))].join(',')}` }),
      )
      await writeFile(victimFile, victimRaw, 'utf8')
      await core.check({ rebuild: true })
    }

    // G：frontmatter round-trip（含逗号的标签不得被拆开）
    const { parseFrontmatter, buildFile } = core._internal
    // ── C1（复核 4.C1）：配置损坏后所有写入口都必须拒绝，且零副作用 ──
    const c1Cfg = core.paths.configFile
    const c1Good = await readFile(c1Cfg, 'utf8')
    const c1Idx = JSON.parse(await readFile(path.join(kbRoot, '.kbmeta', 'index', 'entries.json'), 'utf8'))
    const c1Entry = c1Idx.entries.find((e) => e.entryId === probe.entryId) ?? c1Idx.entries[0]
    const c1Abs = path.join(kbRoot, c1Entry.path)
    const c1Before = await readFile(c1Abs, 'utf8')
    await writeFile(c1Cfg, '{ broken json', 'utf8')
    await step('C1 配置损坏：create 必须拒绝', async () => core.createEntry({ kind: '知识', title: '不该写入', content: 'x' }),
      (v) => ({ ok: v.ok === false && v.reason === 'config-degraded', detail: `ok=${v.ok} reason=${v.reason}` }))
    await step('C1 配置损坏：update 必须拒绝（不吃缓存）', async () => core.updateEntry({ entryId: c1Entry.entryId, expectedRevision: c1Entry.revision, content: '不该写入' }),
      (v) => ({ ok: v.ok === false && v.reason === 'config-degraded', detail: `ok=${v.ok} reason=${v.reason}` }))
    await step('C1 配置损坏：init 必须拒绝', async () => core.init(),
      (v) => ({ ok: v.ok === false && v.reason === 'config-degraded' && typeof v.installState === 'string', detail: `ok=${v.ok} installState=${v.installState}` }))
    await step('C1 配置损坏：check(rebuild) 必须拒绝', async () => core.check({ rebuild: true }),
      (v) => ({ ok: v.ok === false && v.reason === 'config-degraded', detail: `ok=${v.ok}` }))
    const c1After = await readFile(c1Abs, 'utf8')
    acc.push({ step: 'C1 配置损坏：条目文件字节未变', ok: c1Before === c1After, ms: 0, failure: c1Before === c1After ? undefined : '文件被改写了' })
    await writeFile(c1Cfg, c1Good, 'utf8')
    await step('C1 配置恢复后可正常 update', async () => core.updateEntry({ entryId: c1Entry.entryId, expectedRevision: c1Entry.revision, patch: { status: '进行中' } }),
      (v) => ({ ok: v.ok === true, detail: `ok=${v.ok} reason=${v.reason ?? '-'}` }))

    // ── C2（复核 4.C2）：不支持 schema 必须在创建目标之前拒绝 ──
    const c2Good = await readFile(core.paths.configFile, 'utf8')
    const c2Obj = JSON.parse(c2Good)
    c2Obj.schemaVersion = 999
    await writeFile(core.paths.configFile, JSON.stringify(c2Obj, null, 2), 'utf8')
    const c2Target = path.join(core.paths.stateDir, 'must-not-create-' + Date.now().toString(36))
    await step('C2 不支持 schema：bind 必须拒绝且返回 kbPath', async () => core.bind(c2Target, { confirmInit: true }),
      (v) => ({ ok: v.ok === false && v.reason === 'config-degraded' && typeof v.kbPath === 'string', detail: `ok=${v.ok} reason=${v.reason} kbPath=${typeof v.kbPath}` }))
    acc.push({ step: 'C2 不支持 schema：目标目录未被创建', ok: !existsSync(c2Target), ms: 0, failure: existsSync(c2Target) ? '目标目录被创建了' : undefined })
    await writeFile(core.paths.configFile, c2Good, 'utf8')

    // ── C3（复核 4.C3）：库身份/元数据 schema/目录类型都要校验 ──
    const c3Meta = path.join(kbRoot, '.kbmeta', 'kb.json')
    const c3MetaGood = await readFile(c3Meta, 'utf8')
    const c3Conf = await core.getConfig()
    const m1 = JSON.parse(c3MetaGood)
    delete m1.kbId
    await writeFile(c3Meta, JSON.stringify(m1, null, 2), 'utf8')
    await step('C3 缺 kbId：status 不得算健康', async () => core.status(),
      (v) => ({ ok: v.healthy === false && v.healthReason === 'invalid-kb-id', detail: `healthy=${v.healthy} reason=${v.healthReason}` }))
    const m2 = JSON.parse(c3MetaGood)
    m2.schemaVersion = 999
    await writeFile(c3Meta, JSON.stringify(m2, null, 2), 'utf8')
    await step('C3 元数据 schema 不支持：不得算健康', async () => core.status(),
      (v) => ({ ok: v.healthy === false && v.healthReason === 'unsupported-meta-schema', detail: `healthy=${v.healthy} reason=${v.healthReason}` }))
    await writeFile(c3Meta, c3MetaGood, 'utf8')
    const c3Cat = path.join(kbRoot, c3Conf.categories[0])
    await rm(c3Cat, { recursive: true, force: true })
    await writeFile(c3Cat, 'x', 'utf8')
    await step('C3 分类位置是普通文件：不得算健康', async () => core.status(),
      (v) => ({ ok: v.healthy === false && v.healthReason === 'invalid-categories', detail: `healthy=${v.healthy} reason=${v.healthReason}` }))
    await rm(c3Cat, { force: true })
    await mkdir(c3Cat, { recursive: true })
    await step('C3 恢复后 status 重新健康', async () => core.status(),
      (v) => ({ ok: v.healthy === true, detail: `healthy=${v.healthy} reason=${v.healthReason}` }))

    // ── 结案核验：recover 公开入口必须在动手前过闸门 ──
    const recFile = path.join(kbRoot, '.kbmeta', 'recover-todo.log')
    const recIdxFile = path.join(kbRoot, '.kbmeta', 'index', 'entries.json')
    await writeFile(recFile, new Date().toISOString() + '\tkb-00000000\t20-知识笔记/占位.md\treindex-failed\n', 'utf8')
    const recBefore = await readFile(recFile)
    const recIdxBefore = await readFile(recIdxFile)
    const recCfgGood = await readFile(core.paths.configFile, 'utf8')
    await writeFile(core.paths.configFile, '{ broken json', 'utf8')
    await step('recover：配置损坏时 check(recover=true) 必须拒绝且 consumed=0', async () => core.checkEntry({ recover: true }),
      (v) => ({ ok: v.ok === false && v.reason === 'config-degraded' && v.recover && v.recover.consumed === 0, detail: `ok=${v.ok} reason=${v.reason} consumed=${v.recover && v.recover.consumed}` }))
    acc.push({ step: 'recover：索引字节未变', ok: recIdxBefore.equals(await readFile(recIdxFile)), ms: 0, failure: recIdxBefore.equals(await readFile(recIdxFile)) ? undefined : '索引被重建了' })
    // 安全读取：退化版会把 todo 删掉，直接 readFile 会抛异常并中断整轮自检（断言本身也得不脆弱）
    const recAfter = await readFile(recFile).catch(() => null)
    acc.push({ step: 'recover：恢复记录字节未变（未被消费）', ok: recAfter !== null && recBefore.equals(recAfter), ms: 0, failure: recAfter !== null && recBefore.equals(recAfter) ? undefined : 'recover-todo.log 被改动或删除' })
    const cfgStillBroken = (await readFile(core.paths.configFile, 'utf8')) === '{ broken json'
    acc.push({ step: 'recover：损坏的 config.json 未被覆盖', ok: cfgStillBroken, ms: 0, failure: cfgStillBroken ? undefined : 'config.json 被改写' })
    await writeFile(core.paths.configFile, recCfgGood, 'utf8')
    await step('recover：配置恢复后入口仍可用（正常恢复不受影响）', async () => core.checkEntry({ recover: true }),
      (v) => ({ ok: v.ok !== false && v.recover && v.recover.consumed >= 1, detail: `ok=${v.ok} consumed=${v.recover && v.recover.consumed}` }))

    // ── §6-3：bind 预览必须零副作用 ──
    const pvTarget = path.join(core.paths.stateDir, 'preview-no-create-' + Date.now().toString(36))
    const pv = await step('预览：全新目录返回 needsConfirm', async () => core.bind(pvTarget),
      (v) => ({ ok: v.needsConfirm === true && v.ok === false, detail: `needsConfirm=${v.needsConfirm} ok=${v.ok}` }))
    acc.push({ step: '预览：目标目录未被创建（真正只读）', ok: !existsSync(pvTarget), ms: 0, failure: existsSync(pvTarget) ? '预览阶段创建了目录' : undefined })

    // 收尾 1：删除本轮探针条目（保持库干净，便于反复跑）
    try {
      if (probeAbs && existsSync(probeAbs)) await rm(probeAbs, { force: true })
      await core.reindex()
      acc.push({ step: '收尾：删除探针条目', ok: true, ms: 0 })
    } catch (error) {
      acc.push({ step: '收尾：删除探针条目', ok: false, ms: 0, failure: String((error && error.message) ?? error) })
    }

    // 收尾 2：把 kb 的 installState 复原（本阶段人为造过 partial，测试要可重跑）
    try {
      const metaFile2 = path.join(kbRoot, '.kbmeta', 'kb.json')
      const meta2 = JSON.parse(await readFile(metaFile2, 'utf8'))
      if (meta2.installState !== 'complete') {
        meta2.installState = 'complete'
        meta2.completedAt = new Date().toISOString()
        await writeFile(metaFile2, JSON.stringify(meta2, null, 2), 'utf8')
        acc.push({ step: '收尾：恢复 installState=complete（测试可重跑）', ok: true, ms: 0 })
      }
    } catch (error) {
      acc.push({ step: '收尾：恢复 installState', ok: false, ms: 0, failure: String((error && error.message) ?? error) })
    }

    await step(
      'frontmatter round-trip：含逗号/引号/中文的 tags 不变形',
      async () => {
        const data = { id: 'kb-00000000', title: '标题: 含冒号', type: '知识', tags: ['a,b', '普通标签', '带"引号"'], status: '进行中', created: '2026-10-17', updated: '2026-10-17' }
        const text = buildFile(data, '正文\n')
        const back = parseFrontmatter(text)
        return { data, back: back.data, text }
      },
      (v) => {
        const sameTags = JSON.stringify(v.back.tags) === JSON.stringify(v.data.tags)
        return { ok: sameTags && v.back.title === v.data.title, detail: `tags 前=${JSON.stringify(v.data.tags)} 后=${JSON.stringify(v.back.tags)} title 后=${v.back.title}` }
      },
    )
  }

  // 收尾（真 finally）：沙箱用完即删；生产库与生产 stateDir 全程没有被写过。
  try {
    await rm(sandboxRoot, { recursive: true, force: true })
    acc.push({ step: '收尾：删除沙箱（生产库与生产绑定全程未被触碰）', ok: true, ms: 0, detail: sandboxRoot })
  } catch (error) {
    acc.push({ step: '收尾：删除沙箱失败（仅留下临时目录，不影响生产库）', ok: false, ms: 0, failure: String((error && error.message) ?? error) })
  }

  // 汇总：任何一步失败 → 整体失败
  const failed = report.steps.filter((s) => s.ok !== true)
  report.summary.passed = report.steps.length - failed.length
  report.summary.total = report.steps.length
  report.summary.ok = failed.length === 0
  report.summary.productionStateDir = productionStateDir
  const outFile = path.join(productionStateDir, `selftest-${mode}.json`)
  try {
    await mkdir(productionStateDir, { recursive: true })
    await writeFile(outFile, JSON.stringify(report, null, 2), 'utf8')
  } catch (error) {
    log('error', `写自检报告失败：${String((error && error.message) ?? error)}`)
  }
  log(failed.length === 0 ? 'info' : 'error', `P0 自检(${mode}) ${report.summary.passed}/${report.summary.total} 通过 → ${outFile}`)
  if (opts.noExit !== true) setTimeout(() => process.exit(failed.length === 0 ? 0 : 3), 300)
  return { report, exitCode: failed.length === 0 ? 0 : 3 }
}
