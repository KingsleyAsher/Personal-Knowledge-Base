  function Relations({ snapshot, focus, navigate }) {
    const [center, setCenter] = R.useState(focus || ''), [history, setHistory] = R.useState([]), [data, setData] = R.useState(null), [error, setError] = R.useState(''), [type, setType] = R.useState(''), [archive, setArchive] = R.useState(false), [navigation, setNavigation] = R.useState(false), [depth, setDepth] = R.useState('1'), [count, setCount] = R.useState(4), [hover, setHover] = R.useState(''), [issues, setIssues] = R.useState(false), [query, setQuery] = R.useState(''), [matches, setMatches] = R.useState([]), [transform, setTransform] = R.useState({ x: 0, y: 0, zoom: 1 })
    const [searched, setSearched] = R.useState(false), [searching, setSearching] = R.useState(false), [retry, setRetry] = R.useState(0), [aiBusy, setAiBusy] = R.useState(false)
    const svg = R.useRef(null), drag = R.useRef(null), moved = R.useRef(false), searchRequest = R.useRef(0)
    const resetView = () => setTransform({ x: 0, y: 0, zoom: 1 })
    R.useEffect(() => { setCenter(focus || ''); setHistory([]); resetView() }, [focus, snapshot.kbId])
    R.useEffect(() => {
      let live = true; setData(null); setError('')
      api({ op: 'atlas.relations', expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion, path: center || undefined, type: type || undefined, includeArchive: archive, includeNavigation: navigation, depth: Number(depth), limit: 500 }).then(d => {
        if (!live) return
        if (!center && d.suggestedCenters?.length) { setCenter(d.suggestedCenters[0].path); return }
        setData(d)
      }).catch(err => { if (live) setError(err.message) })
      return () => { live = false }
    }, [center, type, depth, archive, navigation, snapshot.kbId, snapshot.policyVersion, snapshot.version, snapshot.revision, retry])
    R.useEffect(() => () => { searchRequest.current++ }, [snapshot.kbId, snapshot.policyVersion])
    const enter = file => { if (file === center) return; setHistory(h => center ? [...h, center] : h); setCenter(file); setCount(4); setMatches([]); setSearched(false); resetView() }
    const search = async ev => {
      ev.preventDefault(); const seq = ++searchRequest.current; setSearching(true); setError('')
      try { const r = await api({ op: 'atlas.list', expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion, q: query, limit: 12 }); if (seq === searchRequest.current) { setMatches(r.items); setSearched(true) } }
      catch (err) { if (seq === searchRequest.current) setError(err.message) }
      finally { if (seq === searchRequest.current) setSearching(false) }
    }
    const point = ev => { const matrix = svg.current?.getScreenCTM(); if (!matrix) return { x: 0, y: 0 }; const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y } }
    R.useEffect(() => {
      const element = svg.current; if (!element) return
      const wheel = ev => { ev.preventDefault(); const p = point(ev); setTransform(t => { const zoom = Math.max(.25, Math.min(4, t.zoom * Math.exp(-ev.deltaY * .0015))), ratio = zoom / t.zoom; return { zoom, x: p.x - (p.x - t.x) * ratio, y: p.y - (p.y - t.y) * ratio } }) }
      element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel)
    }, [center, Boolean(data), issues])
    if (issues) return e(R.Fragment, null, e('div', { className: 'kbw-toolbar' }, btn('返回关系浏览', () => { setIssues(false); setRetry(n => n + 1) })), e(LinkRepairs, { snapshot, navigate }))
    const edges = data?.edges || data?.items || [], nodes = data?.nodes || [], lookup = new Map(nodes.map(n => [n.path, n]))
    const left = [...new Set(edges.filter(edge => edge.to === center && edge.from !== center).map(edge => edge.from))]
    const right = [...new Set(edges.filter(edge => edge.from === center && edge.to !== center).map(edge => edge.to))].filter(p => !left.includes(p))
    const second = [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].filter(p => p !== center && !left.includes(p) && !right.includes(p))
    const shownLeft = left.slice(0, count), shownRight = [...right, ...second].slice(0, count), rows = Math.max(shownLeft.length, shownRight.length, 2), height = Math.max(420, rows * 78 + 70), positions = new Map([[center, { x: 335, y: height / 2 - 26 }]])
    shownLeft.forEach((p, i) => positions.set(p, { x: 20, y: 45 + i * 78 })); shownRight.forEach((p, i) => positions.set(p, { x: 650, y: 45 + i * 78 }))
    const zoomBy = factor => setTransform(t => { const zoom = Math.max(.25, Math.min(4, t.zoom * factor)), ratio = zoom / t.zoom; return { zoom, x: 450 - (450 - t.x) * ratio, y: height / 2 - (height / 2 - t.y) * ratio } })
    const fitView = () => {
      const points = [...positions.values()], x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y)), width = Math.max(...points.map(p => p.x + 230)) - x, h = Math.max(...points.map(p => p.y + 52)) - y
      const zoom = Math.min(1.6, 860 / width, (height - 40) / h)
      setTransform({ zoom, x: (900 - width * zoom) / 2 - x * zoom, y: (height - h * zoom) / 2 - y * zoom })
    }
    const recenter = () => setTransform(t => ({ ...t, x: 450 - 450 * t.zoom, y: height / 2 - height / 2 * t.zoom }))
    const group = (label, items) => e('section', null, e('h3', null, label), items.map(edge => {
      const target = edge.from === center ? edge.to : edge.from
      return e('div', { key: edge.id, className: 'kbw-annotation', onMouseEnter: () => setHover(target), onMouseLeave: () => setHover('') }, btn(lookup.get(target)?.title || target, () => enter(target), false, { title: '以此资料为中心查看关系' }), e('p', { className: 'kbw-meta' }, relationLabel(edge.type) + ' · ' + edge.evidence), btn('打开资料', () => navigate('map', target)))
    }), !items.length ? e('p', { className: 'kbw-meta' }, '当前筛选下没有此类链接') : null)
    const hasGraph = Boolean(data && edges.length)
    return e('section', { className: 'kbw-relations' },
      e('div', { className: 'kbw-home-head' }, e('div', null, e('h2', null, '关系浏览'), e('p', { className: 'kbw-meta' }, '显示资料中已有的来源、引用和手动关联。点击关联节点继续浏览，点击中心节点打开资料。')), btn('检查失效链接' + (data?.issueTotal ? ' · ' + data.issueTotal : ''), () => setIssues(true))),
      e('details', { open: !center || searched }, e('summary', null, center ? '更换中心资料（搜索标题或路径）' : '选择中心资料'),
        e('form', { className: 'kbw-toolbar kbw-relation-filters', onSubmit: search }, field('查找资料', query, v => { setQuery(v); setSearched(false) }, { placeholder: '输入标题或路径，按 Enter 查找' }), e('button', { className: 'kbw-button', type: 'submit', disabled: searching }, searching ? '查找中…' : '查找资料')),
        searched ? matches.length ? e('div', { className: 'kbw-actions' }, matches.map(f => btn(f.title, () => enter(f.path), false, { key: f.path, title: f.path }))) : e('p', { role: 'status', className: 'kbw-meta' }, '没有找到资料，请尝试其他标题或路径。') : null),
      !center ? e('div', { className: 'kbw-empty' }, e('h3', null, data ? '选择一份资料查看关系' : '正在查找已有链接的资料…'), e('p', null, '没有链接的资料不会自动产生关联。可先打开资料添加引用或手动关联。'), e('div', { className: 'kbw-actions' }, snapshot.recent.filter(f => !/(INDEX|AGENTS)\.md$/i.test(f.path)).slice(0, 4).map(f => btn(f.title, () => enter(f.path), false, { key: f.path })))) : e(R.Fragment, null,
        e('div', { className: 'kbw-toolbar kbw-relation-filters' }, btn('返回上一份资料', () => { setCenter(history.at(-1) || ''); setHistory(h => h.slice(0, -1)); resetView() }, !history.length), select('显示的链接', type, setType, [['', '全部类型'], ['source', '来源链接'], ['reference', '文中引用'], ['manual', '手动关联']]), select('浏览范围', depth, setDepth, [['1', '直接关联'], ['2', '再展开一层']]), check('显示归档资料', archive, setArchive), check('显示目录索引文档', navigation, setNavigation)),
        e('p', { className: 'kbw-path' }, '当前资料：' + center),
        e('div', { className: 'kbw-actions', style: { marginBottom: 12 } }, btn('放大', () => zoomBy(1.2), !hasGraph), btn('缩小', () => zoomBy(1 / 1.2), !hasGraph), btn('显示全部节点', fitView, !hasGraph), btn('定位中心资料', recenter, !hasGraph), btn('打开当前资料', () => navigate('map', center)), btn(aiBusy ? '正在创建讨论…' : '与 AI 讨论可能的关联', async () => { setAiBusy(true); setError(''); try { await launchRepairChat(snapshot, [], center); setIssues(true) } catch (err) { setError(err.message) } finally { setAiBusy(false) } }, aiBusy)),
        e('p', { className: 'kbw-meta' }, '“来源链接”来自资料的来源信息，“文中引用”来自文档内链接；AI 建议需要预览确认后才会保存。'),
        !data ? e('p', { role: 'status' }, error ? '关系读取失败，请重试。' : '正在读取关系…') : !hasGraph ? e('div', { className: 'kbw-empty', role: 'status' }, e('h3', null, data.unfilteredTotal ? '已有链接被当前筛选隐藏' : '这份资料尚无可用的关联链接'),
          e('p', null, data.unfilteredTotal ? '请切换为全部类型，或显示归档资料和目录索引文档。' : '关系图依据文档内的实际链接生成。打开当前资料，添加来源、引用或手动关联后即可显示。'),
          data.centerIssueTotal ? e('p', null, '这份资料有 ' + data.centerIssueTotal + ' 个链接无法解析，请进入“检查失效链接”。') : null,
          data.unfilteredTotal ? btn('显示全部类型及隐藏资料', () => { setType(''); setArchive(true); setNavigation(true) }) : btn('打开资料并添加关联', () => navigate('map', center)),
          data.suggestedCenters?.length ? e('div', null, e('p', null, '也可以查看已有链接的资料：'), e('div', { className: 'kbw-actions' }, data.suggestedCenters.filter(f => f.path !== center).slice(0, 4).map(f => btn(f.title + ' · ' + f.count + ' 条链接', () => enter(f.path), false, { key: f.path })))) : null) : e(R.Fragment, null,
          e('p', { className: 'kbw-meta', role: 'status' }, '当前范围共 ' + data.total + ' 条链接；图中显示 ' + positions.size + ' 个节点。箭头指向被引用的资料。滚轮缩放，拖动画布平移；下方列表可逐条打开资料。'),
          e('svg', { ref: svg, className: 'kbw-graph', viewBox: '0 0 900 ' + height, role: 'group', 'aria-label': '知识关系地图', onPointerDown: ev => { moved.current = false; if (ev.target.closest('[data-node]')) return; drag.current = { ...point(ev), original: transform }; ev.currentTarget.setPointerCapture(ev.pointerId) }, onPointerMove: ev => { if (drag.current) { const p = point(ev), dx = p.x - drag.current.x, dy = p.y - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true; setTransform({ ...drag.current.original, x: drag.current.original.x + dx, y: drag.current.original.y + dy }) } }, onPointerUp: () => { drag.current = null }, onPointerCancel: () => { drag.current = null } }, e('defs', null, e('marker', { id: 'kbw-relation-arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, e('polygon', { points: '0,0 10,5 0,10', fill: 'var(--kbw-accent)' }))), e('g', { transform: `translate(${transform.x} ${transform.y}) scale(${transform.zoom})` },
            edges.map(edge => { const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null; const fromX = a.x < b.x ? a.x + 230 : a.x, toX = a.x < b.x ? b.x : b.x + 230, middle = (fromX + toX) / 2; return e('path', { key: edge.id, markerEnd: 'url(#kbw-relation-arrow)', 'data-active': hover === edge.from || hover === edge.to, d: `M${fromX},${a.y + 26} C${middle},${a.y + 26} ${middle},${b.y + 26} ${toX},${b.y + 26}` }, e('title', null, relationLabel(edge.type) + ' · ' + edge.evidence)) }),
            [...positions].map(([file, p]) => { const activate = () => file === center ? navigate('map', file) : enter(file); return e('g', { key: file, 'data-node': true, 'data-center': file === center, role: 'button', tabIndex: 0, 'aria-label': (file === center ? '打开资料：' : '查看关联：') + (lookup.get(file)?.title || file), transform: `translate(${p.x} ${p.y})`, onClick: () => { if (!moved.current) activate(); moved.current = false }, onKeyDown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate() } }, onMouseEnter: () => setHover(file), onMouseLeave: () => setHover('') }, e('rect', { width: 230, height: 52, rx: 9 }), e('text', { x: 12, y: 23 }, (lookup.get(file)?.title || file).slice(0, 16)), e('text', { x: 12, y: 41, style: { fontSize: 10, opacity: .6 } }, file === center ? '点击打开资料' : '点击以此资料为中心'), e('title', null, file)) }))),
          left.length > count || right.length + second.length > count ? btn('再显示 6 份关联资料', () => setCount(c => c + 6)) : null,
          e('div', { className: 'kbw-relation-columns' }, group('当前资料指向的链接', edges.filter(edge => edge.from === center)), group('指向当前资料的链接', edges.filter(edge => edge.to === center))))),
      data?.graphLimited ? e('p', { className: 'kbw-meta' }, '当前图谱达到显示上限，请选择关联节点或缩小浏览范围。') : null,
      error ? e('div', { role: 'alert', className: 'kbw-error' }, error, btn('重新读取关系', () => setRetry(n => n + 1))) : null)
  }
