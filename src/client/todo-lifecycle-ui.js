export function createTodoLifecycleUI(React) {
  const h = React.createElement
  const NS = 'localTodoLifecycle'
  const zh = { title: '任务计划', completed: '已完成', active: '执行中', pending: '待处理', waiting: '等待确认', unconfirmed: '未确认完成', syncing: '状态同步中', stopped: '会话已停止，剩余步骤未确认完成', progress: '{done}/{total} 已完成' }
  const en = { title: 'Task plan', completed: 'Completed', active: 'In progress', pending: 'Pending', waiting: 'Waiting for confirmation', unconfirmed: 'Completion unconfirmed', syncing: 'Syncing status', stopped: 'Session stopped; remaining steps are not confirmed complete', progress: '{done}/{total} completed' }
  const css = `body:has([data-todo-lifecycle-panel]) section[data-testid="todo-panel"]{display:none}
    [data-todo-lifecycle-panel]{margin:0 0 8px;border:.5px solid var(--dsw-alias-border-l1,#d1d5db);border-radius:12px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;overflow:hidden}
    [data-todo-lifecycle-panel] .tl-head{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;color:inherit;font:inherit;padding:10px 14px;text-align:left;cursor:pointer}
    [data-todo-lifecycle-panel] .tl-count{margin-left:auto;color:var(--dsw-alias-label-secondary,#888);font-size:12px}
    [data-todo-lifecycle-panel] ul{list-style:none;margin:0;padding:0 14px 12px;max-height:240px;overflow:auto}
    [data-todo-lifecycle-panel] li{display:flex;align-items:flex-start;gap:9px;padding:5px 0;overflow-wrap:anywhere}
    [data-todo-lifecycle-panel] .tl-dot{flex:none;box-sizing:border-box;width:13px;height:13px;border:1.5px solid currentColor;border-radius:50%;margin-top:3px;opacity:.5}
    [data-todo-lifecycle-panel] [data-status=completed] .tl-dot{border:0;opacity:1;color:var(--dsw-alias-state-success-primary,#22a06b)}
    [data-todo-lifecycle-panel] [data-status=completed] .tl-dot:before{content:'✓';font-size:14px;line-height:13px}
    [data-todo-lifecycle-panel] [data-status=active] .tl-dot{opacity:1;border-color:var(--dsw-alias-state-business-primary,#6d5ee9);border-right-color:transparent;animation:tl-spin .8s linear infinite}
    [data-todo-lifecycle-panel] [data-status=completed] .tl-content{opacity:.65}
    [data-todo-lifecycle-panel] .tl-note{margin:0;padding:0 14px 10px;color:var(--dsw-alias-label-tertiary,#888);font-size:12px}
    @keyframes tl-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){[data-todo-lifecycle-panel] .tl-dot{animation:none!important}}`

  function viewOf(todos, running, waiting = false) {
    return (todos || []).map(item => ({ ...item, displayStatus: item.status === 'completed' ? 'completed'
      : item.status === 'in_progress' ? waiting ? 'waiting' : running === true ? 'active' : running === false ? 'unconfirmed' : 'syncing' : 'pending' }))
  }

  function TodoDock(props) {
    const todos = props.useProjection('todos') || []
    const row = props.useTodoLifecycleSessions(snapshot => snapshot.byId[props.sessionId])
    const live = typeof props.useSessionStatus === 'function'
      ? props.useSessionStatus(snapshot => snapshot.get(props.sessionId)) : undefined
    const [collapsed, setCollapsed] = React.useState(true)
    const running = live?.running ?? row?.running
    const waiting = live?.pendingInteraction === true
    const items = viewOf(todos, running, waiting), done = items.filter(item => item.status === 'completed').length
    if (!items.length) return null
    const stopped = running === false && !waiting && done < items.length
    const t = props.t
    return h('section', { 'data-todo-lifecycle-panel': '', 'data-testid': 'todo-lifecycle-panel', 'aria-label': t('title') },
      h('button', { className: 'tl-head', type: 'button', 'aria-expanded': !collapsed, onClick: () => setCollapsed(value => !value) },
        h('span', null, '☷'), h('span', null, t('title')), h('span', { className: 'tl-count' }, t('progress', { done, total: items.length })), h('span', { 'aria-hidden': true }, collapsed ? '⌃' : '⌄')),
      !collapsed && h('ul', null, items.map(item => h('li', { key: item.content, 'data-status': item.displayStatus, title: t(item.displayStatus) },
        h('span', { className: 'tl-dot', role: 'img', 'aria-label': t(item.displayStatus) }), h('span', { className: 'tl-content' }, item.content)))),
      stopped && h('p', { className: 'tl-note' }, t('stopped')))
  }

  function install(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'todo lifecycle: locale')
    ctx.effect(() => { const style = document.createElement('style'); style.dataset.todoLifecycleFix = ''; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'todo lifecycle: styles')
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'todo-lifecycle', order: 0, locale: NS,
      inject: () => ({ hooks: { todoLifecycleSessions: ctx.sessions.list } }) }, TodoDock))
  }
  return { apply: install, viewOf }
}
