import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/client/workbench-ui.js', import.meta.url), 'utf8')
test('default selectors filter by kind, persist chosen IDs, preserve failures and reload saved values', async () => {
  const slots = [], effects = [], requests = []
  let index = 0, rejectSave = false
  const config = { ok: true, defaultOcr: 'local-ocr', defaultAsr: 'local-asr', providers: [
    { id: 'local-ocr', kind: 'ocr', label: 'Local OCR', locality: 'local', enabled: true },
    { id: 'cloud-ocr', kind: 'ocr', label: 'cloud-ocr', vendor: 'deepseek', locality: 'cloud', enabled: true },
    { id: 'disabled-ocr', kind: 'ocr', label: 'Disabled', locality: 'local', enabled: false },
    { id: 'cloud-asr', kind: 'asr', label: '', protocol: 'deepseek-asr', locality: 'cloud', enabled: true },
    { id: 'local-asr', kind: 'asr', label: 'Local ASR', locality: 'local', enabled: true },
  ] }
  const react = { useState(initial) { const at = index++; if (!(at in slots)) slots[at] = initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value }] }, useEffect(callback) { effects.push(callback) } }
  const e = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const target = new EventTarget()
  const factory = vm.runInNewContext(source + '\ncreateWorkbenchUI', { window: target, CustomEvent, console })
  const ui = factory({ react, e, api: async args => {
    requests.push(args)
    if (args.op === 'parse.providers') return structuredClone(config)
    if (rejectSave) return { ok: false, reason: 'synthetic failure' }
    config[args.kind === 'ocr' ? 'defaultOcr' : 'defaultAsr'] = args.providerId
    return { ok: true, defaults: { ocr: config.defaultOcr, asr: config.defaultAsr } }
  } })
  const render = () => { index = 0; return ui.ParsingDefaults({}) }
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(flatten)] : [node]
  const selectors = () => flatten(render()).filter(n => n?.type === 'select')
  render()
  const cleanup = effects.splice(0).map(effect => effect())
  const flush = () => new Promise(resolve => setImmediate(resolve))
  await flush()
  let [ocr, asr] = selectors()
  assert.deepEqual(ocr.children.map(n => n.props.value), ['', 'local-ocr', 'cloud-ocr', 'disabled-ocr'])
  assert.equal(ocr.children.at(-1).props.disabled, true)
  assert.equal(ocr.children[2].children.join(''), 'DeepSeek OCR · 云端')
  assert.equal(asr.children[1].children.join(''), 'DeepSeek ASR · 云端')
  assert.equal(ocr.children[1].children.join(''), 'Local OCR · 本机')
  assert.deepEqual(asr.children.map(n => n.props.value), ['', 'cloud-asr', 'local-asr'])
  ocr.props.onChange({ target: { value: 'cloud-ocr' } })
  await flush()
  assert.equal(selectors()[0].props.value, 'cloud-ocr')
  assert.equal(config.defaultAsr, 'local-asr')
  assert(requests.some(a => a.op === 'parse.default' && a.kind === 'ocr' && a.providerId === 'cloud-ocr'))
  rejectSave = true
  selectors()[0].props.onChange({ target: { value: 'local-ocr' } })
  await flush()
  assert.equal(selectors()[0].props.value, 'cloud-ocr')
  assert(flatten(render()).some(n => n?.props?.role === 'alert'))
  for (const dispose of cleanup) dispose?.()
  slots.length = 0
  render(); const cleanupAgain = effects.splice(0).map(effect => effect()); await flush()
  assert.equal(selectors()[0].props.value, 'cloud-ocr')
  for (const dispose of cleanupAgain) dispose?.()
})
