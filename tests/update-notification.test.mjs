import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    const updateDismissKey = release =>')
const end = source.indexOf('    async function refreshBuildVersion()', start)
assert.ok(start > 0 && end > start)

function rules(version, data = new Map()) {
  let state = { version, update: null, dismissedRevision: 0 }
  const context = { window: { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } },
    patchBuildBadge: part => { state = { ...state, ...part } } }
  Object.defineProperty(context, 'buildBadgeState', { get: () => state })
  const api = vm.runInNewContext(source.slice(start, end) + '\n({ availableUpdates, pendingUpdatePrompts, dismissUpdatePrompts })', context)
  return { api, data, setUpdate: update => { state = { ...state, update } }, get state() { return state } }
}

const update = {
  ok: true, channel: 'stable', latestVersion: '2.0.3', updateAvailable: true,
  preview: { ok: true, channel: 'preview', latestVersion: '2.0.4-beta1', updateAvailable: true },
}

test('stable installation prompts only for stable releases; preview still has a badge candidate', () => {
  const r = rules('2.0.2'); r.setUpdate(update)
  assert.deepEqual(Array.from(r.api.availableUpdates(), x => x.channel), ['stable'])
  assert.deepEqual(Array.from(r.api.pendingUpdatePrompts(), x => x.channel), ['stable'])
  r.setUpdate({ ...update, updateAvailable: false })
  assert.equal(r.api.pendingUpdatePrompts().length, 0)
  assert.equal(r.state.update.preview.updateAvailable, true)
})

test('preview installation offers both channels and closing remembers exact release versions', () => {
  const r = rules('2.0.2-beta9'); r.setUpdate(update)
  assert.deepEqual(Array.from(r.api.pendingUpdatePrompts(), x => x.channel), ['stable', 'preview'])
  r.api.dismissUpdatePrompts(r.api.pendingUpdatePrompts())
  assert.equal(r.api.pendingUpdatePrompts().length, 0)
  assert.equal(r.data.get('dsh-kb-update-dismissed:stable:2.0.3'), '1')
  assert.equal(r.data.get('dsh-kb-update-dismissed:preview:2.0.4-beta1'), '1')
  r.setUpdate({ ...update, preview: { ...update.preview, latestVersion: '2.0.4-beta2' } })
  assert.deepEqual(Array.from(r.api.pendingUpdatePrompts(), x => x.latestVersion), ['2.0.4-beta2'])
})
