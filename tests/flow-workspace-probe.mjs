import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, access, rm, writeFile, symlink, realpath } from 'node:fs/promises'
import { createFlowWorkspaceManager, prepareFlowConversation, FLOW_WORKSPACE_NAME } from '../src/host/flow-workspace.js'

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'kb-flow-workspace-')))
const exists = async p => access(p).then(() => true, () => false)
function registryFixture() {
  const items = []
  let creates = 0
  return {
    items, get creates() { return creates }, list: () => items,
    resolveByPath: async directory => items.find(item => item.path === directory),
    create: async directory => {
      creates++
      const workspace = { id: 'workspace-' + creates, path: directory, title: path.basename(directory), async setTitle(value) { this.title = value } }
      items.push(workspace)
      return workspace
    },
  }
}
try {
  const library = path.join(root, 'knowledge')
  await mkdir(library)
  const registry = registryFixture()
  const manager = createFlowWorkspaceManager({ getRegistry: () => registry })
  const results = await Promise.all([manager.ensure(library), manager.ensure(library), manager.ensure(library)])
  assert.equal(registry.creates, 1)
  assert.equal(registry.items.length, 1)
  assert.ok(results.every(result => result.workspaceId === 'workspace-1'))
  assert.equal(results[0].workspaceName, FLOW_WORKSPACE_NAME)
  assert.equal(results[0].workspacePath, path.join(root, FLOW_WORKSPACE_NAME))
  assert.equal(path.dirname(results[0].workspacePath), path.dirname(library))
  assert.equal(await exists(path.join(library, FLOW_WORKSPACE_NAME)), false)
  registry.items[0].title = 'renamed'
  await manager.ensure(library)
  assert.equal(registry.items[0].title, FLOW_WORKSPACE_NAME)
  const prepared = await prepareFlowConversation({ prepareConversation: async () => ({ ok: true, kbPath: library, cwd: library, prompt: 'steps', kbId: 'synthetic' }) }, manager, {})
  assert.equal(prepared.workspaceId, 'workspace-1')
  assert.ok(prepared.prompt.includes(library) && prepared.prompt.includes(results[0].workspacePath))
  assert.ok(prepared.prompt.includes('不要将当前工作区误当成知识库'))
  let touched = false
  const failed = await prepareFlowConversation({ prepareConversation: async () => ({ok:false,reason:'missing-param'}) }, {ensure:()=>{touched=true}}, {})
  assert.equal(failed.reason, 'missing-param'); assert.equal(touched, false)
  await assert.rejects(createFlowWorkspaceManager({getRegistry:()=>null}).ensure(library), /工作区服务/)
  const alternate = path.join(root, 'alternate'); await mkdir(alternate)
  const secondLibrary = path.join(alternate, 'knowledge'); await mkdir(secondLibrary)
  await assert.rejects(manager.ensure(secondLibrary), /同名.*其他位置/)
  assert.equal(await exists(path.join(alternate, FLOW_WORKSPACE_NAME)), false)
  await assert.rejects(manager.ensure(path.join(root, FLOW_WORKSPACE_NAME)), /同级流程工作区/)
  const occupied = path.join(root, 'occupied'); await mkdir(occupied)
  const occupiedLibrary = path.join(occupied, 'knowledge'); await mkdir(occupiedLibrary)
  await writeFile(path.join(occupied, FLOW_WORKSPACE_NAME), 'fixture')
  await assert.rejects(createFlowWorkspaceManager({getRegistry:()=>registryFixture()}).ensure(occupiedLibrary), /文件或目录链接/)
  const linked = path.join(root, 'linked'); await mkdir(linked)
  const linkedLibrary = path.join(linked, 'knowledge'); await mkdir(linkedLibrary)
  await symlink(linkedLibrary, path.join(linked, FLOW_WORKSPACE_NAME), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createFlowWorkspaceManager({getRegistry:()=>registryFixture()}).ensure(linkedLibrary), /文件或目录链接/)
  console.log('PASS: sibling directory; workspace registration/reuse/name; concurrent dedup; prompt paths; invalid inputs and name/file/junction conflicts fail without a session')
} finally { await rm(root,{recursive:true,force:true}) }
