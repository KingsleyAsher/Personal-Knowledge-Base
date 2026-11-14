import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createLegacyPorts } from '../packages/kb-service/legacy-ports.js'

const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
const start = source.indexOf("    function Section({ view = 'library' }")
const end = source.indexOf('    // ── 顶栏页签', start)

for (const [name, dirs, status, expected] of [
  ['shared bound library', { current: 'D:/library', defaultCandidate: 'D:/library', canWrite: true }, { kbPath: 'D:/library' }, 'D:/library'],
  ['shared reply before status', { current: 'D:/library', defaultCandidate: 'D:/library', canWrite: true }, undefined, ''],
  ['embedded unbound host', { bound: null, defaultKnowledgeBase: 'D:/candidate', defaultWritable: true }, undefined, 'D:/candidate'],
  ['missing optional directory fields', {}, undefined, ''],
]) test(`settings survives asynchronous directory response: ${name}`, async () => {
  const slots = [], effects = []
  let index = 0
  const react = {
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value }] },
    useRef(initial) { const [ref] = this.useState({ current: initial }); return ref },
    useCallback(fn) { return fn }, useEffect(fn) { effects.push(fn) },
  }
  const element = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const Section = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    react, e: element, useIndexBusy: () => false, ensureStyle() {},
    callApi: async a => a.op === 'status' ? { ok: true, status } : a.op === 'dirs' ? { ok: true, dirs } : { ok: true, imports: [] },
    IndexMaintenancePanel() {}, ParseSection() {}, workbenchUI: { UpgradeSettings() {}, RetrievalSettings() {} },
    setInterval, clearInterval,
  })
  Section()
  for (const effect of effects.splice(0)) effect()
  await new Promise(resolve => setImmediate(resolve))
  index = 0
  const tree = Section()
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(flatten)] : [node]
  const input = flatten(tree).find(node => node?.props?.['aria-label'] === '知识库文件夹')
  assert.equal(input.props.value, expected)
  assert.equal(typeof input.props.value, 'string')
  assert(flatten(tree).includes('当前知识库'))
})

test('shared dirs exposes embedded-client field aliases', async () => {
  const legacy = createLegacyPorts({ kernel: {}, kbId: 'synthetic', root: 'D:/library' })
  const { dirs } = await legacy({ op: 'dirs' })
  assert.equal(dirs.bound, dirs.current)
  assert.equal(dirs.defaultKnowledgeBase, dirs.defaultCandidate)
  assert.equal(dirs.defaultWritable, dirs.canWrite)
})
