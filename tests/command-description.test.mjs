import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withCommandDescription, installCommandDescriptionFallback } from '../src/host/command-description.js'

const toolsPath = process.env.DSH_TEST_TOOLS_URL
const { defineTool } = toolsPath ? await import(toolsPath) : { defineTool: options => ({
  ...options,
  parameters: { type: 'object', required: ['description', 'command'], properties: { description: { type: 'string' }, command: { type: 'string' } } },
  execute(args, exec) {
    assert.equal(typeof args.command, 'string')
    assert.equal(typeof args.description, 'string')
    assert.deepEqual(Object.keys(args).sort(), ['command', 'description'])
    return options.execute(args, exec)
  },
}) }
const shell = () => defineTool({ name: 'pwsh', description: 'Synthetic shell',
  parameters: { description: { type: 'string', required: true }, command: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async args => JSON.stringify(args) })

test('missing display label is filled while the command and frozen input stay intact', async () => {
  const tool = shell(), args = Object.freeze({ command: 'Write-Output SYNTHETIC' })
  await assert.rejects(async () => tool.execute(args, {}))
  const result = JSON.parse(await withCommandDescription(tool).execute(args, {}))
  assert.equal(result.command, args.command)
  assert.equal(result.description, '执行知识库 PowerShell 命令')
  assert.deepEqual(args, { command: 'Write-Output SYNTHETIC' })
})

test('existing labels are preserved and invalid or missing execution arguments still fail', async () => {
  const tool = withCommandDescription(shell()), args = { command: 'Write-Output SYNTHETIC', description: 'Original label' }
  assert.deepEqual(JSON.parse(await tool.execute(args, {})), args)
  for (const invalid of [{ description: 'Missing command' }, { command: 'x', description: null }, { command: 42 }]) {
    await assert.rejects(async () => tool.execute(invalid, {}))
  }
  assert.equal(withCommandDescription({ ...shell(), name: 'other_tool' }), null)
})

test('only authorized callers receive the fallback, and cleanup restores the original executor', async () => {
  const original = shell(), execute = original.execute, agent = { id: 'fixture' }
  let listener, stopped = false
  const tools = { get: () => original }
  const stop = installCommandDescriptionFallback({ get: () => tools, on: (_event, fn) => { listener = fn; return () => { stopped = true } } }, caller => caller === agent)
  let calls = 0
  await listener({ name: 'pwsh', agent: { ...agent } }, () => { calls++ })
  assert.equal(original.execute, execute)
  await listener({ name: 'pwsh', agent }, () => { calls++ })
  const wrapped = original.execute
  await listener({ name: 'pwsh', agent }, () => { calls++ })
  assert.equal(original.execute, wrapped)
  assert.equal(JSON.parse(await original.execute({ command: 'Write-Output SYNTHETIC' }, { agent })).description, '执行知识库 PowerShell 命令')
  await assert.rejects(async () => original.execute({ command: 'Write-Output SYNTHETIC' }, { agent: { ...agent } }))
  assert.equal(calls, 3)
  stop()
  assert.equal(stopped, true)
  assert.equal(original.execute, execute)
})

test('installed DSH dispatch retains both policy denial and global tool restrictions', { skip: !toolsPath }, async () => {
  const { Context, Service } = await import(new URL('../../cordis/lib/index.js', toolsPath))
  const { createScope } = await import(new URL('../../dsh-scope/lib/index.js', toolsPath))
  const { ToolRuntime } = await import(toolsPath)
  class PromptFixture extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    tools() { return () => {} }
  }
  const root = new Context()
  const promptFork = root.plugin(PromptFixture), toolsFork = root.plugin(ToolRuntime)
  let testFork
  const run = new Promise((resolve, reject) => { testFork = root.inject(['tools'], ctx => {
    void (async () => {
      const agent = { id: 'fixture' }, scope = createScope(ctx, agent)
      agent.ctx = scope.ctx
      ctx.tools.register(shell())
      const dispose = installCommandDescriptionFallback(ctx, caller => caller === agent)
      const args = Object.freeze({ command: 'Write-Output SYNTHETIC' })
      const result = await ctx.tools.execute({ name: 'pwsh', arguments: args, agent, callId: 'synthetic-1', signal: new AbortController().signal })
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(JSON.parse(result.value).description, '执行知识库 PowerShell 命令')
      assert.equal(ctx.tools.get('pwsh'), ctx.tools.get('pwsh', agent))
      const deny = ctx.tools.guard(() => 'Synthetic policy denial')
      const blocked = await ctx.tools.execute({ name: 'pwsh', arguments: args, agent, callId: 'synthetic-2', signal: new AbortController().signal })
      assert.equal(blocked.isError, true)
      assert.match(JSON.stringify(blocked), /Synthetic policy denial/)
      deny()
      const restrict = agent.ctx.get('tools').restrict({ deny: ['pwsh'] })
      const hidden = await ctx.tools.execute({ name: 'pwsh', arguments: args, agent, callId: 'synthetic-3', signal: new AbortController().signal })
      assert.equal(hidden.isError, true)
      assert.equal(ctx.tools.get('pwsh', agent), undefined)
      restrict(); dispose(); await scope.dispose()
    })().then(resolve, reject)
  }) })
  try { await run } finally { await testFork.dispose(); await toolsFork.dispose(); await promptFork.dispose() }
})
