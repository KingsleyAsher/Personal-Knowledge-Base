import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/workbench-ui.js', import.meta.url), 'utf8')
const start = source.indexOf('  function FrameworkMigration(')
const component = source.slice(start, source.indexOf('  function UpgradeSettings(', start))
function setup(failure = false) {
  const hooks = [], effects = [], calls = []
  let index = 0, applied = false
  const plan = { kbId: 'synthetic-kb', planId: 'preview-token', revision: 'snapshot-hash', canApply: true, creates: 1, preserved: 1,
    rows: [{ path: '_手册/知识库框架.md', kind: 'file', status: 'create' }, { path: 'AGENTS.md', kind: 'file', status: 'preserved', candidate: 'NEW REFERENCE ONLY' }] }
  const e = (type, props, ...children) => ({ type, props: props || {}, children })
  const context = { R: {
    useState(value) { const key = index++; if (!(key in hooks)) hooks[key] = value; return [hooks[key], next => { hooks[key] = next }] },
    useRef(value) { const key = index++; if (!(key in hooks)) hooks[key] = { current: value }; return hooks[key] },
    useEffect(effect) { const key = index++; if (!(key in hooks)) { hooks[key] = true; effects.push(effect) } },
  }, e, btn: (text, onClick, disabled, props) => e('button', { onClick, disabled, ...props }, text),
  api: async request => {
    calls.push(request)
    if (request.op === 'preferences.get') return { ok: true, kbId: 'synthetic-kb' }
    assert.equal(request.expectedKbId, 'synthetic-kb')
    if (request.op === 'upgrade.framework-status') return { ok: true, framework: applied && failure ? { phase: 'failed', needsRecovery: true } : null }
    if (request.op === 'upgrade.framework-preview') return { ok: true, framework: plan }
    if (request.op === 'upgrade.framework-apply') {
      assert.equal(request.planId, plan.planId); assert.equal(request.revision, plan.revision); assert.equal(request.confirm, true)
      applied = true
      return failure ? { ok: false, error: 'SYNTHETIC SERVER FAILURE' } : { ok: true, framework: { phase: 'completed', created: ['_手册/知识库框架.md'] } }
    }
    throw Error('unexpected request')
  } }
  const renderComponent = vm.runInNewContext(component + '\nFrameworkMigration', context)
  const render = () => { index = 0; return renderComponent() }
  const flatten = node => node == null ? [] : typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(flatten)] : [node]
  const button = (tree, name) => flatten(tree).find(node => node?.type === 'button' && node.children.includes(name))
  return { render, calls, effects, flatten, button }
}

test('migration UI previews before enabling confirmation, sends the reviewed identity and shows completion only on success', async () => {
  const s = setup(), first = s.render()
  assert.equal(s.button(first, '确认补齐新版框架'), undefined)
  assert.equal(s.calls.some(call => call.op === 'upgrade.framework-apply'), false)
  await s.button(first, '预览旧库迁移').props.onClick()
  const reviewed = s.render(), confirm = s.button(reviewed, '确认补齐新版框架')
  assert.equal(confirm.props.disabled, false)
  assert(s.flatten(reviewed).includes('NEW REFERENCE ONLY'))
  await confirm.props.onClick()
  assert(s.flatten(s.render()).some(text => typeof text === 'string' && text.includes('已补齐 1 项')))
})

test('a business failure keeps the migration error visible and offers recovery instead of reporting success', async () => {
  const s = setup(true)
  await s.button(s.render(), '预览旧库迁移').props.onClick()
  await s.button(s.render(), '确认补齐新版框架').props.onClick()
  const failed = s.render(), content = s.flatten(failed)
  assert(content.includes('SYNTHETIC SERVER FAILURE'))
  assert(!content.some(text => typeof text === 'string' && text.includes('已补齐 1 项')))
  assert(s.button(failed, '恢复未完成迁移'))
})
