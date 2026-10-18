// 用虚构样本验「重建索引」的结果映射（不碰正式库、不启动模型）。
//
// 为什么能直接验：结果映射被抽成了纯函数 `kbSummarizeRebuild`，它只吃 checkEntry 的返回。
// 本脚本从 **包内实际文件** 里抽出 `#region kbSummarizeRebuild` 区间来跑 —— 验的是要发货的那份代码，
// 不是另抄一份。抽不到区间就报错退出（防止"验了别的东西"）。
//
// 四组样本 + 一个正控：
//   ① 完整成功    ok:true  execution:'ok'      indexWritten:true  → 必须 ok:true
//   ② 扫描不完整  ok:true  execution:'partial' indexWritten:false → 必须 ok:false（r1 在这里误报成功）
//   ③ 配置拒绝    ok:false execution:'error'   reason:'config-degraded' → ok:false 且带原因
//   ④ 空返回      null → ok:false 且说"没有返回"
//   正控：r1 的旧判据 `ok !== false` 在样本②上给 true —— 反例复现，证明这条测试抓得住原缺陷。
//
// 用法：node rebuild-probe.mjs <包内 src/host/index.js> [结果 json 路径]

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const hostPath = process.argv[2]
if (!hostPath) {
  console.error('用法：node rebuild-probe.mjs <src/host/index.js> [out.json]')
  process.exit(2)
}
const outPath = process.argv[3] || null

const src = readFileSync(hostPath, 'utf8')
const BEGIN = '// #region kbSummarizeRebuild'
const END = '// #endregion kbSummarizeRebuild'
const i = src.indexOf(BEGIN)
const j = src.indexOf(END)
if (i < 0 || j < 0 || j < i) {
  console.error('抽不到 #region kbSummarizeRebuild 区间 —— 拒绝给出结论')
  process.exit(2)
}
const body = src.slice(i + BEGIN.length, j)

// eslint-disable-next-line no-new-func
const factory = new Function(`${body}\n; return kbSummarizeRebuild`)
const summarize = factory()
if (typeof summarize !== 'function') {
  console.error('区间里没有导出 kbSummarizeRebuild 函数')
  process.exit(2)
}

const samples = [
  {
    name: '① 完整成功',
    res: {
      ok: true, execution: 'ok', quality: 'pass', healthy: true,
      counts: { entries: 65, defects: 0, scanErrors: 0 },
      diff: { added: [], removed: [], changed: [] },
      defects: [], rebuiltAt: '2026-10-18T14:00:00.000Z',
      indexWritten: true, index: { fresh: false, reason: 'fingerprint-changed' },
    },
    expect: { ok: true, reasonHas: null },
  },
  {
    name: '② 扫描不完整（旧索引保留）',
    res: {
      ok: true, execution: 'partial', quality: 'fail', healthy: true,
      counts: { entries: 0, defects: 3, scanErrors: 3 },
      diff: { added: [], removed: [], changed: [] },
      defects: [{ kind: 'scanError' }, { kind: 'index-not-written' }],
      rebuiltAt: '2026-10-18T14:01:00.000Z',
      indexWritten: false, index: { fresh: false, reason: 'fingerprint-changed' },
    },
    expect: { ok: false, reasonHas: '旧索引已保留' },
  },
  {
    name: '③ 配置拒绝',
    res: { ok: false, execution: 'error', quality: 'unknown', defects: [], reason: 'config-degraded', detail: '配置降级' },
    expect: { ok: false, reasonHas: 'config-degraded' },
  },
  {
    name: '④ 空返回',
    res: null,
    expect: { ok: false, reasonHas: '没有返回' },
  },
]

// r1 的旧判据（用于正控）
const r1Rule = (checkRes) => !checkRes || checkRes.ok !== false

const results = []
let failed = 0
for (const s of samples) {
  const got = summarize(s.res, 123)
  const problem = []
  if (got.ok !== s.expect.ok) problem.push(`ok 期望 ${s.expect.ok} 实际 ${got.ok}`)
  if (s.expect.reasonHas && !String(got.reason ?? '').includes(s.expect.reasonHas)) {
    problem.push(`reason 期望含「${s.expect.reasonHas}」实际 ${JSON.stringify(got.reason)}`)
  }
  if (got.ok === true && got.reason !== null) problem.push('成功时不应带 reason')
  if ('indexState' in got) problem.push('结果里不应出现 indexState（counts 没有这个字段）')
  const r1 = r1Rule(s.res)
  results.push({ 样本: s.name, 期望成功: s.expect.ok, 实际成功: got.ok, r1旧判据: r1, reason: got.reason, 问题: problem })
  if (problem.length > 0) failed += 1
  console.log(`${problem.length === 0 ? 'PASS' : 'FAIL'}  ${s.name}  → ok=${got.ok}  reason=${got.reason ?? '-'}  （r1 旧判据=${r1}）`)
}

// 正控：样本②旧判据必须给"成功"，否则说明这条测试抓不到原缺陷
const ctrl = r1Rule(samples[1].res) === true && summarize(samples[1].res, 1).ok === false
console.log(`\n正控（旧判据在样本②上误报成功、新判据不误报）：${ctrl ? 'PASS' : 'FAIL'}`)

const summary = {
  时间: new Date().toISOString(),
  被验文件: path.basename(hostPath),
  被验文件字节: Buffer.byteLength(src, 'utf8'),
  区间行数: body.split('\n').length,
  样本数: samples.length,
  失败数: failed,
  正控通过: ctrl,
  结论: failed === 0 && ctrl ? 'PASS' : 'FAIL',
  明细: results,
}
console.log(`\n结论：${summary.结论}（${samples.length - failed}/${samples.length} 通过）`)
if (outPath) {
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8')
  console.log(`结果已写入：${outPath}`)
}
process.exit(summary.结论 === 'PASS' ? 0 : 1)
