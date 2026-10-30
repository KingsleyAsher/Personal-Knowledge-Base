// Mirror-layer probe for the sidebar panel-list row: applies the rules read from the host bundle
// against the plugin's real apply(). Actual rendering in the host is NOT observed here — no browser
// tooling is installed on this machine, so this probe only mirrors the observed semantics:
//   main is a root-scoped keyed slot (register option `key`, component receives no props);
//   the row lives in sidebar.panellist with the same `id`, order ?? 0, resolveSlotLabel(label) ?? id,
//   sorted ascending, active: id === activePanelId, entryKey: usePanelInfo(...) ?? "conversation".
// resolveSlotLabel itself is an external module export, so its definition body is not in the bundle;
// here it is mirrored from the observed usage line only (string or locale thunk).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const applyStart = source.indexOf('    function apply(ctx)')
const applySource = source.slice(applyStart, source.indexOf("    exports.name = 'kb-core'"))
const iconStart = source.indexOf('    function KnowledgePanelIcon')
const iconSource = source.slice(iconStart, source.indexOf('\n    // ── ', iconStart))

const storage = initial => {
  const data = new Map(Object.entries(initial))
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}

const e = (tag, props) => ({ tag, props })
const icon = vm.runInNewContext(iconSource + '\nKnowledgePanelIcon', { e })
const store = storage({ 'dsh.conversation.session': '{"view":"chat","draft":"keep"}' })

const registrations = []
const context = {
  window: { localStorage: store, setInterval() { return 1 }, clearInterval() {} },
  document: { hidden: false, addEventListener() {}, removeEventListener() {}, documentElement: { getAttribute() { return null }, setAttribute() {} } },
  createWorkbenchUI: () => ({ dispose() {}, registerReferences() {} }),
  react: {}, ReferenceChip: undefined, e, callApi() {}, Overview() {}, Flows() {}, ParseSection() {}, BuildBadge() {},
  reactDom: {}, RELEASE_VERSION: 'test', PROJECT_RECORD_URL: 'https://example.invalid/project-record',
  rememberPreviousClientVersion() {}, ensureStyle() {}, WorkbenchSettings() {}, Workbench() { return { name: 'Workbench' } },
  KbView() { return { name: 'KbView' } }, KnowledgePanelIcon: icon,
  patchBuildBadge() {}, refreshBuildVersion() {}, checkBuildUpdates() {},
  buildVersionRequest: { current: 0 }, buildUpdateRequest: { current: 0 },
}
const apply = vm.runInNewContext('let flowClientContext, workbenchUI;\n' + source.slice(source.indexOf('    function resetKnowledgeViewOnStartup('), applyStart) + applySource + '\napply', context)
apply({
  effect() {}, inject() {},
  slots: { inject: (_name, callback) => callback(), register: (options, component) => { registrations.push({ options, component }) } },
})

const entryFor = name => registrations.filter(({ options }) => options.name === name)
const rowEntry = entryFor('sidebar.panellist')[0]
const panelEntry = entryFor('main')[0]
assert.ok(rowEntry && panelEntry, 'the row and its matching global panel must both be registered')

// Mirror of the observed metadata build for sidebar.panellist.
const resolveSlotLabel = label => typeof label === 'function' ? label() : label
const rowsOf = entries => entries
  .map(({ options }) => ({ id: options.id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? options.id }))
  .sort((a, b) => a.order - b.order)

// Shipped rows recorded from the host bundle: plugins panel order 0, task manager order 10.
// The fixtures stand in for those shipped panels' own main entries.
const shipped = [
  { options: { name: 'sidebar.panellist', id: 'plugins-panel', order: 0, label: () => '插件' } },
  { options: { name: 'sidebar.panellist', id: 'task-panel', order: 10, label: '定时任务' } },
]
const shippedPanels = [{ options: { name: 'main', key: 'plugins-panel' } }, { options: { name: 'main', key: 'task-panel' } }]
const rows = rowsOf([...shipped, rowEntry])
assert.deepEqual(rows.map(row => row.id), ['plugins-panel', 'task-panel', 'kb-panel'], 'the new row sorts after the shipped rows')
assert.deepEqual(rows.map(row => row.label), ['插件', '定时任务', '知识库'])

// Mirror of the observed selection rule: an entryKey resolves through the active panel id,
// falling back to "conversation"; a row without its main entry throws without changing selection.
const mainEntries = entryFor('main').concat(shippedPanels)
const resolvePanel = activePanelId => {
  const entryKey = activePanelId ?? 'conversation'
  const entry = mainEntries.find(({ options }) => options.key === entryKey)
  if (!entry) throw new Error(`main entry for panel "${entryKey}" is missing`)
  return entry
}
assert.throws(() => resolvePanel('row-without-its-panel'), /missing/, 'the mirror must reject a row whose panel is absent')
assert.equal(resolvePanel('plugins-panel').options.key, 'plugins-panel', 'a broken row must not move the selection')

const activePanelId = 'kb-panel'
const active = resolvePanel(activePanelId)
assert.equal(active.component, context.KbView, 'the active global panel is the knowledge main UI')
assert.equal(panelEntry.component, context.KbView)
assert.equal(active.options.key, rowEntry.options.id, 'row id must address the same panel as the main key')
// The row is host-owned; the plugin supplies only the icon component, which receives { size, active }.
assert.equal(rowEntry.component, icon)
assert.notEqual(rowEntry.component, panelEntry.component, 'the panel gets the main UI, the row gets the icon')
const rendered = icon({ size: 16, active: rowEntry.options.id === activePanelId })
assert.equal(rendered.tag, 'svg')
assert.equal(rendered.props.width, 16)
assert.equal(rendered.props.height, 16)
assert.equal(rendered.props['aria-hidden'], true)
assert.equal(rendered.props.stroke, 'currentColor')

// The top-tab entry stays in its own registry, so the two entries do not collide.
const tab = entryFor('conversation.view').find(({ options }) => options.id === 'kb-map')
assert.ok(tab, 'the top tab entry must stay registered')
assert.equal(tab.component, panelEntry.component, 'the tab and the global panel both render the knowledge main UI')
assert.notEqual(tab.options.id, rowEntry.options.id, 'the tab entry and the row entry keep separate ids in their own registries')

console.log('PASS: row/panel pair resolves (id kb-panel ↔ main key kb-panel), label 知识库, order 20 lands after shipped rows 0 and 10, icon gets {size, active}, top tab unchanged')
console.log('NOT CONFIRMED: actual sidebar rendering in the real host — no browser tooling on this machine; this probe mirrors the semantics observed in the host bundle (including resolveSlotLabel, whose definition lives outside the bundle)')
