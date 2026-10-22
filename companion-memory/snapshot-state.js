import { randomUUID } from 'node:crypto'

export const DYNAMIC_MEMORY_SOURCE = 'memory-evolve:dynamic-state'

export function retainedDynamicState(session) {
  const nodes = session?.surface?.nodes
  if (!nodes || typeof session.eventAt !== 'function') return undefined
  for (const seq of [...nodes].reverse()) {
    const event = session.eventAt(seq)
    const message = event?.type === 'user/message' ? event.data : undefined
    if (message?.source?.kind === DYNAMIC_MEMORY_SOURCE) return message.source.state
  }
  return undefined
}

// Compare committed surface messages rather than an in-memory last-sent flag:
// cancellation, restore, compaction and separate agents cannot poison the cache.
export function dynamicStateMessage(agent, state) {
  if (retainedDynamicState(agent?.session) === state) return undefined
  return {
    id: randomUUID(), role: 'user',
    source: { kind: DYNAMIC_MEMORY_SOURCE, form: 'state', state },
    content: [{ type: 'text', text: '[Memory dynamic state — current value; supersedes earlier dynamic-state notices only. Stable memory and all rules remain in force.]\n' + (state || '(No active dynamic memory state.)') }],
  }
}

export function installDynamicMemoryState(ctx, render) {
  return ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter') return decision
    const agent = payload?.agent ?? ctx.agent
    if (!agent?.session) throw new Error('Cannot deliver memory state without verified agent context')
    payload.signal?.throwIfAborted()
    const message = dynamicStateMessage(agent, render(agent))
    return message ? { ...decision, messages: [...decision.messages, message] } : decision
  })
}
