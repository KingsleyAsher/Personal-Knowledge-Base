import { randomUUID } from 'node:crypto'

export const name = 'local-todo-lifecycle-fix'
export const inject = ['agents', 'systemPrompt']
const SOURCE = 'todo:lifecycle-reconcile'

// End-of-turn reconciliation stays in the owning session and runs at most once
// per turn. Only the model can confirm work; stopping never fabricates completion.
export function createTodoCompletionGuard(isLive = () => true) {
  const requested = new WeakMap()
  return async payload => {
    const agent = payload?.agent
    if (!agent?.session || typeof agent.inject !== 'function' || !isLive(agent) || payload.signal?.aborted) return
    if (requested.get(agent) === payload.turn) return
    const events = agent.session.snapshotEvents?.() || []
    const start = events.findLastIndex(event => event.type === 'turn/start' && event.data?.turn === payload.turn)
    if (start < 0) return
    const turn = events.slice(start + 1)
    if (turn.some(event => event.type === 'user/message' && event.data?.source?.kind === SOURCE)) return
    const last = turn.findLast(event => event.type === 'assistant/message')
    if (!last || last.data?.message?.interrupted) return
    const todos = turn.findLast(event => event.type === 'todo/write')?.data?.todos
    if (!Array.isArray(todos) || !todos.length || todos.every(item => item.status === 'completed')) return
    if (!todos.every(item => typeof item.content === 'string' && ['pending', 'in_progress', 'completed'].includes(item.status))) return
    requested.set(agent, payload.turn)
    agent.inject({ id: randomUUID(), role: 'user', source: { kind: SOURCE, form: 'repair', turn: payload.turn },
      content: [{ type: 'text', text: '本轮待办尚未收尾。请核对实际执行结果并用 todo_write 更新完整列表：已经完成的步骤立即标记 completed；仍有用户已授权且可继续的步骤时，继续完成并及时更新进度；若任务已暂停、取消、受阻或需要用户决策，尊重停止要求，未完成项保留 pending 并说明原因。不要只为清除进度条而把未执行或未验证的步骤标成完成。本轮最多自动提醒这一次。当前记录：' + JSON.stringify(todos) }] })
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.get('systemPrompt').section({ name: 'todo:lifecycle', order: 850,
    text: '若本轮使用 todo_write 制定了计划，每完成一个实际步骤就更新完整待办列表并推进当前步骤；最终答复前核对完成状态。未完成、受阻、暂停或取消的事项如实保留待处理并说明，不得把结束会话等同于全部完成。' }), 'todo lifecycle: progress discipline')
  const guard = createTodoCompletionGuard(agent => ctx.get('agents')?.get(agent.id) === agent)
  ctx.effect(() => ctx.on('agent/turn-stopping', guard), 'todo lifecycle: bounded final reconciliation')
}
