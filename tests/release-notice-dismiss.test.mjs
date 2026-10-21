import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('    const RELEASE_VERSION ='), source.indexOf('    function apply(ctx)'))
const currentReleaseVersion = /const RELEASE_VERSION = '([^']+)'/.exec(code)?.[1]
const key = 'dsh-kb-release-state'
function storage(version) {
  const data = new Map(version ? [[key, JSON.stringify({ version })]] : [])
  return { getItem: k => data.get(k) ?? null, setItem: (k, value) => data.set(k, String(value)) }
}
const api = () => vm.runInNewContext(code + '\n({ loadReleaseNotices, acknowledgeReleaseNotice, rememberPreviousClientVersion, shouldShowReleaseNotice, compareReleaseVersions, RELEASE_NOTICES })')
const versions = notice => Array.from(notice?.releases ?? [], entry => entry.version)

test('stable patch stays quiet; the next minor upgrade includes that patch', () => {
  const { loadReleaseNotices, acknowledgeReleaseNotice } = api(), store = storage('2.0.0')
  assert.equal(loadReleaseNotices(store, '2.0.1'), null)
  const entries = [{ version: '2.0.1', items: ['补丁'] }, { version: '2.1.0', items: ['迭代'] }]
  const notice = loadReleaseNotices(store, '2.1.0', entries)
  assert.equal(notice.fromVersion, '2.0.0')
  assert.deepEqual(versions(notice), ['2.0.1', '2.1.0'])
  acknowledgeReleaseNotice(store, notice)
  assert.equal(loadReleaseNotices(store, '2.1.0', entries), null)
})

test('stable major and minor upgrades show one summary without interim previews', () => {
  const p = api(), store = storage('1.1.6')
  assert.deepEqual(versions(p.loadReleaseNotices(store, '2.0.0')), ['2.0.0'])
  assert.equal(p.shouldShowReleaseNotice('2.0.0', '2.0.9'), false)
  assert.equal(p.shouldShowReleaseNotice('2.0.9', '2.1.0'), true)
})

test('skipping beta releases gives one combined popup and preserves it until closed', () => {
  const p = api(), store = storage('2.0.2-beta6')
  const notice = p.loadReleaseNotices(store, '2.0-beta9')
  assert.equal(notice.fromVersion, '2.0.2-beta6')
  assert.deepEqual(versions(notice), ['2.0-beta7', '2.0-beta8', '2.0-beta9'])
  assert.deepEqual(versions(p.loadReleaseNotices(store, '2.0-beta9')), versions(notice))
  p.acknowledgeReleaseNotice(store, notice)
  assert.equal(p.loadReleaseNotices(store, '2.0-beta9'), null)
})

test('an unclosed beta popup extends through a later stable upgrade', () => {
  const p = api(), store = storage('2.0-beta7')
  assert.deepEqual(versions(p.loadReleaseNotices(store, '2.0-beta8')), ['2.0-beta8'])
  const notice = p.loadReleaseNotices(store, '2.0.0')
  assert.equal(notice.fromVersion, '2.0-beta7')
  assert.deepEqual(versions(notice), ['2.0-beta8', '2.0-beta9', '2.0.0'])
})

test('fresh install, downgrade, bad storage, and legacy markers', () => {
  const p = api(), fresh = storage()
  assert.equal(p.loadReleaseNotices(fresh, '2.0.0'), null)
  assert.equal(JSON.parse(fresh.getItem(key)).version, '2.0.0')
  assert.equal(p.loadReleaseNotices(fresh, '1.1.6'), null)
  assert.equal(p.loadReleaseNotices({ getItem() { throw Error('disabled') } }), null)
  const legacy = storage(); legacy.setItem('dsh-kb-release-seen:1.1.3', '1')
  assert.equal(p.loadReleaseNotices(legacy, '2.0.0').fromVersion, '1.1.3')
})

test('hot load captures beta9 as the actual previous version before replacing the client', () => {
  const p = api(), store = storage('1.1.3')
  p.rememberPreviousClientVersion(store, '2.0.2-beta9')
  const note = p.loadReleaseNotices(store, '2.0.0')
  assert.equal(note.fromVersion, '2.0.2-beta9')
  assert.deepEqual(versions(note), ['2.0.0'])
})

test('current release is documented and preview ordering is numeric', () => {
  const p = api()
  assert.ok(p.RELEASE_NOTICES.some(entry => entry.version === '2.0.0'))
  assert.equal(p.compareReleaseVersions('2.0-beta10', '2.0-beta9'), 1)
  assert.equal(p.compareReleaseVersions('2.0-beta9', '2.0.0'), -1)
  assert.equal(p.compareReleaseVersions('2.0-beta9', '2.0.2-beta9'), 1)
  assert.equal(p.compareReleaseVersions('2.0.2-beta9', '2.0-beta9'), -1)
})

test('canonical beta9 migration from legacy beta9 produces an update summary', () => {
  const p = api(), store = storage('2.0.2-beta9')
  const notice = p.loadReleaseNotices(store, '2.0-beta9')
  assert.equal(notice.fromVersion, '2.0.2-beta9')
  assert.equal(notice.version, '2.0-beta9')
  assert.deepEqual(versions(notice), ['2.0-beta9'])
})

// Minimal hooks harness for the actual popup close path.
function mount(store) {
  let slots = [], cursor = 0, effects = [], dirty = false, output
  const listeners = new Map()
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true }] },
    useMemo(fn) { return (slots[cursor++] ??= { value: fn() }).value },
    useRef(value) { return react.useMemo(() => ({ current: value })) },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  const context = {
    react, reactDom: { createPortal: element => element }, e: (tag, props, ...children) => ({ tag, props: props || {}, children }),
    document: { createElement: () => ({ setAttribute() {}, remove() {} }), body: { appendChild() {} } },
    window: { localStorage: store, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
  }
  const Component = vm.runInNewContext('let releaseNoticeClaimed = false;\n' + code + '\nReleaseNotice', context)
  function flush() { for (let n = 0; n < 10; n++) { dirty = false; cursor = 0; effects = []; output = Component(); effects.forEach(fn => fn()); if (!dirty) return } throw Error('render did not settle') }
  flush()
  return { get output() { return output }, flush, listeners }
}
function find(element, predicate) { if (!element || typeof element !== 'object') return; if (predicate(element)) return element; for (const child of (element.children || []).flat()) { const match = find(child, predicate); if (match) return match } }
for (const action of ['Escape', 'close', 'backdrop', 'link']) test(`aggregated popup persists ${action} dismissal`, () => {
  const store = storage('2.0-beta7'), p = api()
  p.loadReleaseNotices(store, currentReleaseVersion)
  const view = mount(store)
  assert.ok(find(view.output, node => node.props.role === 'dialog'))
  assert.ok(find(view.output, node => node.props.className === 'kb-release-version').children[0].includes('2.0-beta7'))
  if (action === 'Escape') view.listeners.get('keydown')({ key: 'Escape' })
  if (action === 'close') find(view.output, node => node.tag === 'button').props.onClick()
  if (action === 'link') find(view.output, node => node.tag === 'a').props.onClick()
  if (action === 'backdrop') { const target = {}; view.output.props.onMouseDown({ target, currentTarget: target }) }
  view.flush()
  assert.equal(view.output, null)
  assert.equal(JSON.parse(store.getItem(key)).explainedVersion, currentReleaseVersion)
  assert.equal(mount(store).output, null)
})
