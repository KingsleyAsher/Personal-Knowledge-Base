// 迁移助手：把旧委派插件（@local/dsh-agent-gateway）的 targets 迁进本插件的 gateway 段。
// 只读旧配置、只打印建议片段 —— 不写任何文件（避免动到别人的插件目录或 profile）。
// 用法：node tools/migrate-gateway-config.mjs [--old <cordis.patch.yml 路径>]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.dsh')
const oldPath = arg('old', path.join(home, 'plugins', 'agent-gateway', 'cordis.patch.yml'))

if (!fs.existsSync(oldPath)) {
  console.log('未找到旧插件配置：' + oldPath)
  console.log('如果你的旧插件在别处，用 --old <路径> 指定；不需要迁移就直接用默认的单目标配置。')
  process.exit(0)
}

const text = fs.readFileSync(oldPath, 'utf8')
// 只取 targets 段（缩进敏感的朴素解析，够用且不引入依赖）
const lines = text.split(/\r?\n/)
const start = lines.findIndex((l) => /^\s*targets:\s*$/.test(l))
if (start < 0) {
  console.log('旧配置里没有 targets 段，无需迁移。')
  process.exit(0)
}
const baseIndent = lines[start].match(/^\s*/)[0].length
const out = []
for (let i = start + 1; i < lines.length; i++) {
  const l = lines[i]
  if (l.trim() === '') { out.push(''); continue }
  const ind = l.match(/^\s*/)[0].length
  if (ind <= baseIndent && l.trim() !== '') break
  out.push(l.slice(baseIndent + 2))
}
const targetsYaml = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()

console.log('旧配置：' + oldPath)
console.log('\n把下面这段合并进本插件 cordis.patch.yml 的 gateway 段（targets 与 maxCalls 等平级）：\n')
console.log('        gateway:')
console.log(targetsYaml.split('\n').map((l) => '  ' + l).join('\n'))
console.log('\n注意：')
console.log('  · 目标 id 不能重复；合并版已自带一个 knowledge 目标，若要保留旧的 knowledge 项请删掉其中一处。')
console.log('  · 旧插件仍留在 profile 的 bundles 里时，合并注册会被跳过（代码会警告），迁移完成后再移除它。')
