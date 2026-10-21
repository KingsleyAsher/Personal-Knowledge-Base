import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    function resetKnowledgeViewOnStartup(')
const reset = vm.runInNewContext(source.slice(start, source.indexOf('    function apply(ctx)', start)) + '\nresetKnowledgeViewOnStartup')

function storage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    get length() { return data.size },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  }
}

test('startup restores Chat for current and legacy knowledge views without losing session data', () => {
  for (const prefix of ['dsh.conversation.', 'dsh.conversation.chat.']) {
    const key = prefix + 'session-1'
    const original = { view: 'kb-map', draft: { text: 'unsent draft', references: [{ ref: 'sample' }] }, selection: { seq: 7 }, viewRequest: { view: 'kb-map', focus: 'sample.md' } }
    const store = storage({ [key]: JSON.stringify(original) })
    reset(store)
    assert.deepEqual(JSON.parse(store.getItem(key)), { ...original, view: 'chat', viewRequest: null })
    // Manual navigation is unrestricted during this run; next startup resets it.
    store.setItem(key, JSON.stringify({ ...original, view: 'kb-map' }))
    assert.equal(JSON.parse(store.getItem(key)).view, 'kb-map')
    reset(store)
    assert.equal(JSON.parse(store.getItem(key)).view, 'chat')
  }
})

test('other views, unrelated storage, malformed sessions and workbench landing preferences stay intact', () => {
  const initial = {
    'dsh.conversation.a': JSON.stringify({ view: 'trajectory', draft: 'keep' }),
    'dsh.conversation.b': JSON.stringify({ view: 'chat' }),
    'dsh.conversation.c': '{invalid',
    'dsh.conversation.d': 'null',
    'dsh.conversation.e': '[]',
    'other.session': JSON.stringify({ view: 'kb-map' }),
    'kbw-tab:library': 'reading',
  }
  const store = storage(initial)
  reset(store)
  for (const [key, value] of Object.entries(initial)) assert.equal(store.getItem(key), value, key)
})

test('unavailable storage or an unwritable session does not stop startup or other sessions', () => {
  assert.doesNotThrow(() => reset({ get length() { throw Error('disabled') } }))
  const store = storage({ 'dsh.conversation.a': '{invalid', 'dsh.conversation.b': '{"view":"kb-map"}', 'dsh.conversation.c': '{"view":"kb-map"}' })
  const write = store.setItem
  store.setItem = (key, value) => { if (key.endsWith('.b')) throw Error('read-only'); write(key, value) }
  assert.doesNotThrow(() => reset(store))
  assert.equal(JSON.parse(store.getItem('dsh.conversation.c')).view, 'chat')
})

test('actual plugin apply resets saved selection before registering the knowledge view', () => {
  const store = storage({ 'dsh.conversation.session': '{"view":"kb-map","draft":"keep"}' })
  const registered = []
  const applySource = source.slice(source.indexOf('    function apply(ctx)'), source.indexOf("    exports.name = 'kb-core'"))
  const context = {
    window: { localStorage: store, setInterval() { return 1 }, clearInterval() {} }, document: { hidden: false, addEventListener() {}, removeEventListener() {}, documentElement: { getAttribute() { return null }, setAttribute() {} } },
    createWorkbenchUI: options => { assert.equal(options.projectRecordUrl, context.PROJECT_RECORD_URL); return { dispose() {}, registerReferences() {} } },
    react: {}, e() {}, callApi() {}, Overview() {}, Flows() {}, ParseSection() {}, BuildBadge() {},
    reactDom: {}, RELEASE_VERSION: 'test', PROJECT_RECORD_URL: 'https://example.invalid/project-record', rememberPreviousClientVersion() {}, ensureStyle() {}, WorkbenchSettings() {}, KbView() {},
    patchBuildBadge() {}, refreshBuildVersion() {}, checkBuildUpdates() {}, buildVersionRequest: { current: 0 }, buildUpdateRequest: { current: 0 },
  }
  const apply = vm.runInNewContext('let flowClientContext, workbenchUI;\n' + source.slice(start, source.indexOf('    function apply(ctx)', start)) + applySource + '\napply', context)
  apply({
    effect() {}, inject() {},
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        assert.equal(JSON.parse(store.getItem('dsh.conversation.session')).view, 'chat')
        registered.push({ options, component })
      },
    },
  })
  const knowledge = registered.find(({ options }) => options.id === 'kb-map')
  assert.equal(knowledge.component, context.KbView)
  assert.equal(knowledge.options.label(), '知识库')
})
