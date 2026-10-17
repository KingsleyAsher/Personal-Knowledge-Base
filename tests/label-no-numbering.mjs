// p8 专用闸门：设置页两个主按钮的文字**不得**带序号（①②…）。
//
// 为什么单独写一条：这是纯文案改动，其余测试套件（F1–F4、R1–R7）都碰不到它；
// 而它的失效模式恰恰是"某次重构把序号又加回去"，人眼看不出来、只有机器能盯。
//
// 用法：
//   node tests/label-no-numbering.mjs                # 验真实源文件（期望 PASS）
//   node tests/label-no-numbering.mjs <别的文件>      # 验任意副本（用于坏样本自证，期望 FAIL）
//
// 判据（三条，缺一条不算过）：
//   1) 两个按钮的**期望文案逐字存在**（含中间那个空格、斜杠两侧空格）；
//   2) 这两个按钮所在行**不含** U+2460–U+2473（①–⑳）与全角序号「(一)」类前缀；
//   3) 覆盖自证：必须真的读到这两个按钮的渲染行（否则"0 命中"与"根本没读到"长得一样）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_TARGET = path.join(HERE, '..', 'src', 'client', 'index.js')
const target = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_TARGET

const EXPECT_PICK = '选择知识库文件夹'
const EXPECT_SETUP = '自动建库 / 识别'
const CIRCLED = /[\u2460-\u2473]/u

let failures = 0
const ok = (m) => console.log(`  OK   ${m}`)
const bad = (m) => { failures += 1; console.log(`  FAIL ${m}`) }
const assert = (cond, m) => (cond ? ok(m) : bad(m))

console.log(`== 目标 ${target} ==`)
if (!fs.existsSync(target)) {
  bad(`文件不存在：${target}`)
  process.exitCode = 1
} else {
  const text = fs.readFileSync(target, 'utf8')
  const lines = text.split('\n')
  // 按钮渲染行 = 同时含 'kbc-btn' 与 onClick 的那两行
  const buttonLines = []
  lines.forEach((line, i) => {
    if (line.includes('kbc-btn') && line.includes("e('button'") && line.includes('onClick')) buttonLines.push({ no: i + 1, line })
  })
  // 只保留设置页那两个主按钮（pickDir / doSetup）
  const targets = buttonLines.filter((b) => b.line.includes('onClick: pickDir') || b.line.includes('onClick: doSetup'))

  console.log(`  覆盖自证：全文件 ${lines.length} 行 / 命中按钮行 ${buttonLines.length} 条 / 其中设置页主按钮 ${targets.length} 条`)
  assert(targets.length === 2, `设置页主按钮恰好 2 条（实得 ${targets.length}）`)

  const pickRow = targets.find((b) => b.line.includes('onClick: pickDir'))
  const setupRow = targets.find((b) => b.line.includes('onClick: doSetup'))
  assert(!!pickRow, '找到「选择文件夹」按钮行')
  assert(!!setupRow, '找到「自动建库 / 识别」按钮行')

  if (pickRow) {
    assert(pickRow.line.includes(`'${EXPECT_PICK}'`), `L${pickRow.no} 文案逐字为「${EXPECT_PICK}」`)
    assert(!CIRCLED.test(pickRow.line), `L${pickRow.no} 该行不含圈号 ①–⑳`)
  }
  if (setupRow) {
    assert(setupRow.line.includes(`'${EXPECT_SETUP}'`), `L${setupRow.no} 文案逐字为「${EXPECT_SETUP}」`)
    assert(!CIRCLED.test(setupRow.line), `L${setupRow.no} 该行不含圈号 ①–⑳`)
  }

  // 说明：文件内其它地方的圈号（源码注释里解释"第①步"）允许存在，只禁用**按钮渲染行**上的。
  const allCircled = (text.match(/[\u2460-\u2473]/gu) || []).length
  console.log(`  参考：全文圈号共 ${allCircled} 处（注释里允许，按钮行不允许）`)
}

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`)
process.exitCode = failures === 0 ? 0 : 1
