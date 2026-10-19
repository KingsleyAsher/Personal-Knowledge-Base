// Synthetic library only: prepare a complete prompt without running or writing a report.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFlowEngine } from '../src/host/flows.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'kb-flow-prompt-'))
let bound = true
let delegated = 0
try {
  const kbPath = path.join(root, 'library')
  await mkdir(kbPath)
  const engine = createFlowEngine({
    stateDir: path.join(root, 'state'),
    core: { status: async () => ({ bound, kbId: 'synthetic-library', kbPath }) },
    delegate: async () => { delegated++; throw new Error('Preparation must never delegate') },
  })
  const saved = await engine.save({ flow: {
    name: 'Synthetic five-step flow', triggers: ['synthetic'], params: [{ name: 'topic', required: true, default: 'fixture topic' }],
    steps: Array.from({ length: 5 }, (_, i) => ({ title: 'Step ' + (i + 1), instruction: 'Fixture action ' + (i + 1), capability: i === 1 ? 'write' : 'read' })),
    outputRules: { land: false, kind: '知识', tags: ['fixture'], tz: 'Asia/Shanghai', windowDays: 3 },
  } })
  assert.equal(saved.ok, true)
  const request = { id: saved.flow.id, kbId: 'synthetic-library', expectedRevision: saved.flow.revision }
  const result = await engine.prepareConversation(request)
  assert.equal(result.ok, true)
  assert.equal(result.cwd, kbPath)
  for (let i = 1; i <= 5; i++) assert.ok(result.prompt.includes('Fixture action ' + i))
  assert.ok(result.prompt.includes('fixture topic'))
  assert.ok(result.prompt.includes('不额外创建知识库条目'))
  assert.equal((await engine.prepareConversation({ ...request, kbId: 'changed' })).reason, 'kb-changed')
  assert.equal((await engine.prepareConversation({ ...request, expectedRevision: 999 })).reason, 'flow-changed')
  const missing = await engine.save({ flow: { ...saved.flow, id: undefined, name: 'Missing parameter', params: [{ name: 'source', required: true, default: '' }] } })
  assert.equal((await engine.prepareConversation({ ...request, id: missing.flow.id, expectedRevision: missing.flow.revision })).reason, 'missing-param')
  await engine.setEnabled(saved.flow.id, false)
  assert.equal((await engine.prepareConversation(request)).reason, 'disabled')
  await engine.archive(saved.flow.id)
  assert.equal((await engine.prepareConversation(request)).reason, 'archived')
  bound = false
  assert.equal((await engine.prepareConversation(request)).reason, 'unbound')
  assert.equal(delegated, 0)
  assert.equal((await readdir(path.join(root, 'state', 'flows', 'synthetic-library'))).includes('runs'), false)
  console.log('PASS: complete prompt, parameters, library/revision guards, disabled/archive/unbound; no background execution or run records')
} finally {
  await rm(root, { recursive: true, force: true })
}
