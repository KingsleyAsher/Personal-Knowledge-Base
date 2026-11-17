// DSH 0.2.1 requires a display-only description on its shell tools. Keep the
// original tool, schema, policy and executor; tolerate this one missing label.
export function withCommandDescription(tool) {
  if (!['pwsh', 'bash'].includes(tool?.name) ||
      !tool.parameters?.required?.includes('description') ||
      tool.parameters.properties?.description?.type !== 'string' ||
      tool.parameters.properties?.command?.type !== 'string') return null
  const execute = tool.execute.bind(tool)
  return {
    ...tool,
    execute(args, exec) {
      const normalized = args && typeof args === 'object' && !Array.isArray(args) &&
        args.description === undefined && typeof args.command === 'string'
        ? { ...args, description: tool.name === 'pwsh' ? '执行知识库 PowerShell 命令' : '执行知识库 Bash 命令' }
        : args
      return execute(normalized, exec)
    },
  }
}

export function installCommandDescriptionFallback(ctx, isAuthorized) {
  const installed = new WeakSet(), disposers = new Set()
  const off = ctx.on('tools/pre-execute', async (exec, next) => {
    if (!['pwsh', 'bash'].includes(exec.name) || !isAuthorized(exec.agent)) return next()
    const tools = ctx.get('tools')
    if (!tools?.get) return next()
    const source = tools.get(exec.name, exec.agent)
    if (!source || installed.has(source)) return next()
    const wrapper = withCommandDescription(source)
    if (!wrapper) return next()
    const original = source.execute
    const execute = (args, call) => isAuthorized(call?.agent) ? wrapper.execute(args, call) : original.call(source, args, call)
    // Retain the exact registry entry. A scoped replacement would shadow global
    // restrictions; changing only this executor keeps all visibility and policy
    // decisions on the original tool, with no redispatch or command rewriting.
    source.execute = execute
    installed.add(source)
    const dispose = () => { if (source.execute === execute) source.execute = original; disposers.delete(dispose) }
    disposers.add(dispose)
    return next()
  })
  return () => { off(); for (const dispose of [...disposers]) dispose() }
}
