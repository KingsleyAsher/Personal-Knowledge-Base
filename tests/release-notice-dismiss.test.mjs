import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const noticeSource = source.slice(source.indexOf('    const RELEASE_VERSION ='), source.indexOf('    function apply(ctx)'))
const stateKey = 'dsh-kb-release-state'
const seenKey = (v) => 'dsh-kb-release-seen:' + v
function storage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }
}
const initial = (version, pending = []) => ({ [stateKey]: JSON.stringify({ version, pending }) })
const policy = () => vm.runInNewContext(noticeSource + '\n({ loadReleaseNotices, compareReleaseVersions, RELEASE_NOTICES })')
const versions = (items) => Array.from(items, (item) => item.version)

test('ordinary upgrade 1.1.2 -> 1.1.3 creates no announcement', () => {
  const store = storage(initial('1.1.2')), api = policy()
  assert.deepEqual(versions(api.loadReleaseNotices(store, '1.1.3')), [])
  assert.deepEqual(versions(api.RELEASE_NOTICES), ['1.1.1'])
  assert.equal(JSON.parse(store.getItem(stateKey)).version, '1.1.3')
})
test('skipping a designated release retains its announcement until acknowledged', () => {
  const store = storage(initial('1.0.0')), api = policy()
  assert.deepEqual(versions(api.loadReleaseNotices(store)), ['1.1.1'])
  assert.deepEqual(versions(api.loadReleaseNotices(store)), ['1.1.1'])
  store.setItem(seenKey('1.1.1'), '1')
  assert.deepEqual(versions(api.loadReleaseNotices(store)), [])
  assert.deepEqual(versions(api.loadReleaseNotices(store, '1.1.4')), [])
})
test('fresh install and multiple skipped milestones; future notices wait', () => {
  const api = policy(), store = storage(initial('1.0.0'))
  assert.deepEqual(versions(api.loadReleaseNotices(storage())), ['1.1.1'])
  const notices = [{ version: '2.0.0' }, { version: '1.1.1' }, { version: '1.2.0' }]
  assert.deepEqual(versions(api.loadReleaseNotices(store, '1.3.0', notices)), ['1.1.1', '1.2.0'])
  assert.deepEqual(versions(api.loadReleaseNotices(store, '1.3.0', notices)), ['1.1.1', '1.2.0'])
  store.setItem(seenKey('1.1.1'), '1'); store.setItem(seenKey('1.2.0'), '1')
  assert.deepEqual(versions(api.loadReleaseNotices(store, '2.0.0', notices)), ['2.0.0'])
})
test('legacy seen markers migrate without repeating the popup', () => {
  for (const v of ['1.1.1', '1.1.2', '1.1.3']) assert.deepEqual(versions(policy().loadReleaseNotices(storage({ [seenKey(v)]: '1' }))), [], v)
})
test('withdrawn pending notices and unreadable storage do not trigger popups', () => {
  assert.deepEqual(versions(policy().loadReleaseNotices(storage(initial('1.1.3', ['1.1.3'])))), [])
  assert.deepEqual(versions(policy().loadReleaseNotices({ getItem() { throw Error('disabled') } })), [])
})
test('numeric/prerelease version ordering and downgrade history', () => {
  const api = policy(), store = storage(initial('1.2.0'))
  assert.equal(api.compareReleaseVersions('1.10.0', '1.2.0'), 1)
  assert.equal(api.compareReleaseVersions('2.0.0-rc.2', '2.0.0-rc.10'), -1)
  assert.equal(api.compareReleaseVersions('2.0.0-rc.10', '2.0.0'), -1)
  assert.deepEqual(versions(api.loadReleaseNotices(store, '1.1.3')), [])
  assert.equal(JSON.parse(store.getItem(stateKey)).version, '1.2.0')
})

// Execute the actual component and event handlers with a minimal hooks harness.
function mount(store) {
  let slots = [], cursor = 0, effects = [], dirty = false, output
  const listeners = new Map()
  const react = {
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: initial }
      return [slots[i].value, (value) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true }]
    },
    useMemo(fn) { return (slots[cursor++] ??= { value: fn() }).value },
    useRef(value) { return react.useMemo(() => ({ current: value })) },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i]
      if (!old || deps.some((v, n) => v !== old.deps[n])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } })
    },
  }
  const context = {
    react, reactDom: { createPortal: (element) => element }, e: (tag, props, ...children) => ({ tag, props: props || {}, children }),
    document: { createElement: () => ({ setAttribute() {}, remove() {} }), body: { appendChild() {} } },
    window: { localStorage: store, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) },
  }
  const Component = vm.runInNewContext('let releaseNoticeClaimed = false;\n' + noticeSource + '\nReleaseNotice', context)
  function flush() {
    for (let n = 0; n < 10; n++) {
      dirty = false; cursor = 0; effects = []; output = Component(); effects.forEach((f) => f())
      if (!dirty) return
    }
    throw Error('render did not settle')
  }
  flush()
  return { get output() { return output }, flush, listeners }
}
function find(element, predicate) {
  if (!element || typeof element !== 'object') return
  if (predicate(element)) return element
  for (const child of (element.children || []).flat()) { const result = find(child, predicate); if (result) return result }
}
test('actual component stays hidden on ordinary upgrade', () => {
  const view = mount(storage(initial('1.1.2')))
  assert.equal(view.output, null); assert.equal(view.listeners.has('keydown'), false)
})
for (const action of ['Escape', 'close', 'backdrop', 'link']) test(`actual component persists ${action} dismissal across reloads`, () => {
  const store = storage(initial('1.0.0')), view = mount(store)
  assert.ok(find(view.output, (n) => n.props.role === 'dialog'))
  assert.ok(find(view.output, (n) => n.props.className === 'kb-release-version').children[0].includes('1.1.1'))
  assert.ok(mount(store).output, 'unclosed notice survives module reload')
  if (action === 'Escape') view.listeners.get('keydown')({ key: 'Escape' })
  if (action === 'close') find(view.output, (n) => n.tag === 'button').props.onClick()
  if (action === 'link') find(view.output, (n) => n.tag === 'a').props.onClick()
  if (action === 'backdrop') { const target = {}; view.output.props.onMouseDown({ target, currentTarget: target }) }
  view.flush()
  assert.equal(view.output, null); assert.equal(store.getItem(seenKey('1.1.1')), '1'); assert.equal(mount(store).output, null)
})
