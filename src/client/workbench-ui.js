// Embedded into the existing client factory by tools/sync-workbench-client.py.
// Uses the host's React and services; no second React runtime or remote scripts.
function createWorkbenchUI({ react: R, e, api: rawApi, ctx: getContext, Overview, Flows, Parsing, BuildBadge, version, portal }) {
  const api = async (body, signal) => {
    if (signal?.aborted) throw new Error('操作已取消')
    const out = await rawApi(body)
    if (signal?.aborted) throw new Error('操作已取消')
    if (!out || out.ok === false) throw Object.assign(new Error(out?.error || out?.reason || '操作失败'), { code: out?.code })
    return out
  }
  const event = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))
  const btn = (label, action, disabled = false, extra = {}) => e('button', { type: 'button', className: 'kbw-button', onClick: action, disabled, ...extra }, label)
  const field = (label, value, change, props = {}) => e('label', { className: 'kbw-field' }, e('span', null, label), e('input', { value: value ?? '', onChange: ev => change(ev.target.value), ...props }))
  const check = (label, value, change, disabled = false) => e('label', { className: 'kbw-check' }, e('input', { type: 'checkbox', checked: Boolean(value), onChange: ev => change(ev.target.checked), disabled }), label)
  const select = (label, value, change, values) => e('label', { className: 'kbw-field' }, e('span', null, label), e('select', { value, onChange: ev => change(ev.target.value) }, values.map(([v, l]) => e('option', { key: v, value: v }, l))))
  const date = ms => ms ? new Date(ms).toLocaleString('zh-CN') : '—'
  const size = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB'
  const download = (filename, text, mime = 'text/plain;charset=utf-8') => {
    const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement('a')
    a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const defaults = () => ({ showPrivate: false, allowPrivateQuestions: false, autoParse: false, reviewReminders: false, reviewFrequency: 'weekly', landing: 'map', backup: { enabled: false, directory: '', frequency: 'daily', includePrivate: true } })
  let stylesInstalled = false, styleElement = null
  function styles() {
    if (stylesInstalled) return
    stylesInstalled = true
    const style = document.createElement('style'); style.dataset.plugin = 'kb-workbench'
    styleElement = style
    style.textContent = `
      .kbw{--line:color-mix(in srgb,currentColor 16%,transparent);--soft:color-mix(in srgb,currentColor 5%,transparent);color:inherit;font:13px/1.65 system-ui,sans-serif;height:100%;display:flex;flex-direction:column;min-height:0}
      .kbw *{box-sizing:border-box}.kbw button,.kbw input,.kbw select,.kbw textarea{font:inherit;color:inherit}
      .kbw button{cursor:pointer}.kbw button:disabled{opacity:.45;cursor:default}.kbw :focus-visible{outline:2px solid #67a690;outline-offset:2px}
      .kbw-nav,.kbw-toolbar,.kbw-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.kbw-nav{padding:12px 18px;border-bottom:1px solid var(--line);flex-wrap:nowrap;overflow:auto;flex-shrink:0}
      .kbw-button{border:1px solid var(--line);background:var(--soft);padding:5px 10px;border-radius:6px;white-space:nowrap}.kbw-button[aria-current=true]{background:#44806b30;border-color:#67a690}.kbw-button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
      .kbw-toolbar{padding:12px 18px;flex-shrink:0}.kbw-toolbar input{flex:1;min-width:140px}.kbw input:not([type=checkbox]),.kbw select,.kbw textarea{background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:6px 8px;min-width:0;max-width:100%}
      .kbw-grid{display:grid;grid-template-columns:minmax(160px,210px) minmax(240px,1fr) minmax(280px,38%);min-height:0;flex:1;border-top:1px solid var(--line)}
      .kbw-tree,.kbw-list,.kbw-detail{overflow:auto;padding:14px;min-width:0}.kbw-tree,.kbw-list{border-right:1px solid var(--line)}.kbw-tree button{white-space:normal;text-align:left;max-width:100%}
      .kbw-dir{display:flex;gap:3px;margin:3px 0}.kbw-dir>button:last-child{flex:1;border-color:transparent}.kbw-dir-children{padding-left:12px;border-left:1px solid var(--line)}
      .kbw-row{display:block;width:100%;border:0;border-bottom:1px solid var(--line);background:none;text-align:left;padding:12px 6px;overflow-wrap:anywhere}.kbw-row:hover,.kbw-row[aria-current=true]{background:var(--soft)}.kbw-row strong{display:block;font-weight:550}.kbw-meta{opacity:.65;font-size:12px;overflow-wrap:anywhere}.kbw-path{font:11px/1.7 ui-monospace,monospace;opacity:.62;overflow-wrap:anywhere}
      .kbw-detail h2{font-size:18px;margin:0 0 10px}.kbw-preview{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.85 system-ui,sans-serif;max-height:60vh;overflow:auto;padding:12px;background:var(--soft);border-radius:5px}.kbw-preview mark{background:#e4be5a55;color:inherit}.kbw-detail img{max-width:100%}.kbw-detail iframe{width:100%;height:60vh;border:1px solid var(--line);background:white}
      .kbw-field{display:flex;flex-direction:column;gap:5px;margin:10px 0}.kbw-field>span{font-weight:550}.kbw-check{display:flex;gap:8px;align-items:flex-start;margin:10px 0}.kbw-check input{margin-top:5px}.kbw-form{max-width:720px;margin:0 auto;width:100%}.kbw-form textarea{width:100%;min-height:100px}.kbw-content{padding:18px;overflow:auto;flex:1;min-height:0}.kbw-status{padding:6px 18px;opacity:.75}.kbw-error{color:#bd604b;padding:8px 18px;overflow-wrap:anywhere}.kbw-empty{opacity:.6;padding:26px 8px}
      .kbw-backdrop{position:fixed;inset:0;z-index:10050;background:#0007;display:grid;place-items:center;padding:20px}.kbw-modal{color:var(--dsw-alias-label-primary,#252b28);background:var(--dsw-alias-bg-base,#fafbf9);width:min(720px,100%);max-height:90vh;overflow:auto;border-radius:12px;padding:24px;box-shadow:0 20px 80px #0005}.kbw-modal h2{font-size:22px;margin:0 0 12px}.kbw-modal .kbw-actions{margin-top:20px;justify-content:flex-end}.kbw-step{font-size:12px;opacity:.6;letter-spacing:.04em}.kbw-summary{padding:12px;border:1px solid var(--line);border-radius:7px;white-space:pre-wrap}
      body[data-ds-dark-theme] .kbw-modal{background:var(--dsw-alias-bg-base,#202622);color:var(--dsw-alias-label-primary,#e6ede8)}
      .kbw-relations{overflow:auto;flex:1;padding:16px}.kbw-graph{width:100%;height:420px;border:1px solid var(--line);background:var(--soft);touch-action:none}.kbw-graph text{fill:currentColor;font-size:12px}.kbw-graph line{stroke:#79a594;stroke-width:1.4}.kbw-graph rect{fill:var(--dsw-alias-bg-base,#edf3ef);stroke:#79a594}.kbw-graph g[data-node]{cursor:pointer}.kbw-graph [data-center] rect{stroke-width:3}
      .kbw-annotation{padding:10px 0;border-bottom:1px solid var(--line)}.kbw-annotation blockquote{margin:6px 0;padding-left:12px;border-left:3px solid #bda553}.kbw-breadcrumb{display:flex;gap:4px;flex-wrap:wrap;padding:0 18px 10px}.kbw-banner{padding:8px 18px;background:#b6a95a17;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .kbw-pdf-scroll{overflow:auto;max-height:65vh;border:1px solid var(--line);background:#8882}.kbw-pdf-page{position:relative;margin:8px auto;background:white;color:black}.kbw-pdf-page canvas{display:block}.kbw-pdf-text{position:absolute;inset:0;overflow:hidden;line-height:1;text-align:initial;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:2}.kbw-pdf-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}.kbw-pdf-text>span:not(.markedContent),.kbw-pdf-text .markedContent span:not(.markedContent){z-index:1}.kbw-pdf-text span::selection{background:#2979ff55}.kbw-pdf-text .endOfContent{display:none}.kbw-pdf-region{position:absolute;inset:0;z-index:4;cursor:crosshair}.kbw-pdf-highlight{position:absolute;background:#f2cd4660;pointer-events:none;z-index:3}.kbw-link{border:0;background:none;text-decoration:underline;color:inherit;padding:0;white-space:normal;text-align:left}
      @media(max-width:1000px){.kbw-grid{grid-template-columns:170px 1fr}.kbw-detail{grid-column:1/-1;border-top:1px solid var(--line);max-height:none}.kbw-grid:has(.kbw-detail[data-open=true]) .kbw-tree,.kbw-grid:has(.kbw-detail[data-open=true]) .kbw-list{display:none}.kbw-grid:has(.kbw-detail[data-open=true]){display:block;overflow:auto}.kbw-detail{height:100%}}
      @media(max-width:600px){.kbw-nav{padding:8px}.kbw-toolbar{padding:10px}.kbw-grid{grid-template-columns:1fr}.kbw-tree{max-height:200px;border-bottom:1px solid var(--line)}.kbw-list{border-right:0}.kbw-detail:not([data-open=true]){display:none}.kbw-backdrop{padding:8px}.kbw-modal{padding:18px}.kbw-nav .kbw-button{padding:5px 8px}.kbw-graph{height:320px}}
    `
    document.head.appendChild(style)
  }
  let eventsStarted = false, eventSource = null
  function connectEvents() {
    if (eventsStarted) return
    eventsStarted = true
    const source = new EventSource('/kb-core/workbench-events')
    eventSource = source
    source.onmessage = ev => { try { const data = JSON.parse(ev.data); event('kbw-policy', data) } catch {} }
    source.onerror = () => event('kbw-policy', { type: 'connection-lost' })
    window.addEventListener('pagehide', () => source.close(), { once: true })
  }
  async function fileBase64(file) {
    if (file.size > 8 * 1024 * 1024) throw new Error('单个文件最多 8 MiB')
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary)
  }

  function PreferencesFields({ prefs, setPrefs }) {
    const patch = part => setPrefs(old => ({ ...old, ...part }))
    const backup = part => setPrefs(old => ({ ...old, backup: { ...old.backup, ...part } }))
    return e('div', null,
      check('展示隐私内容', prefs.showPrivate, value => patch({ showPrivate: value, ...!value ? { allowPrivateQuestions: false } : {} })),
      e('p', { className: 'kbw-meta' }, '按当前知识库保存，同一宿主 profile 的连接客户端共同生效。关闭后只显示隐私分区统计。'),
      check('允许知识库提问使用隐私内容', prefs.allowPrivateQuestions, value => patch({ allowPrivateQuestions: value }), !prefs.showPrivate),
      e('p', { className: 'kbw-meta' }, '启用后，相关私密片段可能发送给当前选择的模型。已生成的聊天记录不随开关删除。'),
      check('自动完整备份', prefs.backup.enabled, value => backup({ enabled: value })),
      prefs.backup.enabled ? e('div', null,
        field('库外备份目录', prefs.backup.directory, value => backup({ directory: value }), { placeholder: '例如 D:\\知识库备份' }),
        select('备份频率', prefs.backup.frequency, value => backup({ frequency: value }), [['daily', '每天'], ['weekly', '每周']]),
        check('备份包含隐私资料', prefs.backup.includePrivate, value => backup({ includePrivate: value })),
        e('p', { className: 'kbw-meta' }, '本地保存，保留最近 7 份每日、4 份每周备份；不包含宿主密钥。')) : e('p', { className: 'kbw-meta' }, '已关闭自动完整备份。仍可手动执行单次备份或导出。索引快照与写前保护副本另行维护。'),
      check('采集后自动提交解析', prefs.autoParse, value => patch({ autoParse: value })),
      check('开启回顾提醒', prefs.reviewReminders, value => patch({ reviewReminders: value })),
      prefs.reviewReminders ? select('回顾频率', prefs.reviewFrequency, value => patch({ reviewFrequency: value }), [['daily', '每天'], ['weekly', '每周']]) : null,
      select('默认进入页面', prefs.landing, value => patch({ landing: value }), [['map', '地图'], ['overview', '总览'], ['remember', '记住上次页面']]))
  }

  function ParseWizard() {
    const [step, setStep] = R.useState(0), [kind, setKind] = R.useState('ocr'), [info, setInfo] = R.useState(null), [provider, setProvider] = R.useState(''), [sample, setSample] = R.useState(''), [busy, setBusy] = R.useState(false), [message, setMessage] = R.useState(''), [connected, setConnected] = R.useState(false), [verified, setVerified] = R.useState(false)
    const refresh = async () => { const r = await api({ op: 'parse.providers' }); setInfo(r); const defaults = kind === 'ocr' ? r.defaultOcr : r.defaultAsr; setProvider(defaults || r.providers.find(p => p.kind === kind && p.locality === 'local')?.id || '') }
    R.useEffect(() => { void refresh().catch(e => setMessage(e.message)); setConnected(false); setVerified(false) }, [kind])
    const run = async (op, extra = {}) => {
      setBusy(true); setMessage('正在检查…')
      try {
        const r = await api({ op, providerId: provider, kind, sourceRel: sample, ...extra })
        if (op === 'parse.test-connection') { setConnected(true); setMessage('连接检查通过；还需要真实样本解析。') }
        else if (op === 'parse.test-parse') { setVerified(r.status !== 'partial'); setMessage(r.status === 'partial' ? '样本部分成功，仍有缺页或缺段，请核对后再启用。' : '真实样本解析通过。') }
        else setMessage('已保存为当前默认解析服务。')
      } catch (e) { setMessage(e.message) } finally { setBusy(false) }
    }
    return e('div', null, e('p', { className: 'kbw-step' }, '解析配置向导 · ' + (step + 1) + ' / 5'),
      step === 0 ? select('需要处理的资料', kind, setKind, [['ocr', '图片 / PDF（PaddleOCR）'], ['asr', '音频 / 视频（Qwen3-ASR）']]) : null,
      step === 1 ? e('div', null, e('p', null, '优先复用本机已有环境。没有可选服务时，在下方添加并保存，再刷新列表。'),
        select('已有服务', provider, v => { setProvider(v); setConnected(false); setVerified(false) }, [['', '请选择'], ...(info?.providers || []).filter(p => p.kind === kind).map(p => [p.id, p.name + ' · ' + p.locality])]),
        btn('刷新列表', refresh), e('details', null, e('summary', null, '配置路径、模型和凭据'), e(Parsing))) : null,
      step === 2 ? e('div', null, e('p', null, '检查程序、地址与凭据连接。此步骤通过不代表能解析。'), btn('检查环境与连接', () => run('parse.test-connection'), busy || !provider)) : null,
      step === 3 ? e('div', null, field('库内样本相对路径', sample, setSample), e('p', { className: 'kbw-meta' }, '请选择小样本，真实解析会调用所选服务并保留结果。'), btn('真实样本解析', () => run('parse.test-parse'), busy || !sample || !provider)) : null,
      step === 4 ? e('div', null, e('p', null, verified ? '环境连接及真实样本均已通过。' : '请先完成真实样本解析，或稍后再设置。'), btn('设为默认服务', () => run('parse.default'), busy || !verified)) : null,
      message ? e('p', { role: 'status' }, message) : null,
      e('div', { className: 'kbw-actions' }, btn('上一步', () => setStep(s => Math.max(0, s - 1)), busy || step === 0), btn('下一步', () => setStep(s => Math.min(4, s + 1)), busy || step === 4 || step === 1 && !provider || step === 2 && !connected || step === 3 && !verified)))
  }

  let guideInstance = null
  function Guide() {
    styles()
    const owner = R.useRef(crypto.randomUUID())
    const [open, setOpen] = R.useState(false), [normal, setNormal] = R.useState(false), [step, setStep] = R.useState(0)
    const [prefs, setPrefs] = R.useState(defaults), [record, setRecord] = R.useState(null), [status, setStatus] = R.useState(null)
    const [error, setError] = R.useState(''), [busy, setBusy] = R.useState(false), [folder, setFolder] = R.useState('')
    const deferred = R.useRef(false), active = R.useRef(false), root = R.useRef(null)
    const owns = () => { if (!guideInstance) guideInstance = owner.current; return guideInstance === owner.current }
    const refresh = R.useCallback(async () => {
      const [p, s] = await Promise.all([api({ op: 'preferences.get' }), api({ op: 'status' })])
      setRecord(p); setPrefs(p.needsConfirmation ? p.suggestedDefaults : p.preferences); setStatus(s.status)
      return p
    }, [])
    const claim = R.useCallback(async () => {
      if (!owns() || deferred.current || active.current) return
      try {
        const p = await api({ op: 'preferences.get' })
        if (p.guideComplete) return
        const c = await api({ op: 'onboarding.claim', owner: owner.current })
        if (c.claimed) { active.current = true; await refresh(); setNormal(false); setStep(0); setOpen(true) }
      } catch (err) { setError(err.message) }
    }, [refresh])
    R.useEffect(() => {
      connectEvents(); void claim()
      const timer = setInterval(() => {
        if (!owns()) return
        if (active.current) void api({ op: 'onboarding.claim', owner: owner.current }).then(c => { if (c.completed || !c.claimed) { active.current = false; setOpen(false) } }).catch(err => setError(err.message))
        else void claim()
      }, 15000)
      const settings = () => { if (!owns()) return; void refresh().then(async p => {
        if (!p.guideComplete) { const c = await api({ op: 'onboarding.claim', owner: owner.current }); if (!c.claimed) throw new Error('另一个窗口正在完成设置'); active.current = true; deferred.current = false }
        setNormal(p.guideComplete); setStep(1); setOpen(true); setError('')
      }).catch(err => setError(err.message)) }
      const policy = ev => { if (ev.detail?.guideComplete) { active.current = false; setOpen(false) } }
      window.addEventListener('kbw-settings', settings); window.addEventListener('kbw-policy', policy)
      return () => { clearInterval(timer); window.removeEventListener('kbw-settings', settings); window.removeEventListener('kbw-policy', policy); if (guideInstance === owner.current) guideInstance = null; if (active.current) void api({ op: 'onboarding.defer', owner: owner.current }).catch(() => {}) }
    }, [claim, refresh])
    const close = R.useCallback(() => {
      if (busy) return
      if (active.current) void api({ op: 'onboarding.defer', owner: owner.current }).catch(() => {})
      active.current = false; deferred.current = true; setOpen(false); event('kbw-deferred')
    }, [busy])
    R.useEffect(() => {
      if (!open) return
      const previous = document.activeElement
      root.current?.querySelector('button')?.focus()
      const key = ev => {
        if (ev.key === 'Escape') { ev.preventDefault(); close() }
        if (ev.key === 'Tab') {
          const items = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,a[href]')]
          const first = items[0], last = items.at(-1)
          if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus() }
          else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus() }
        }
      }
      document.addEventListener('keydown', key)
      return () => { document.removeEventListener('keydown', key); previous?.focus?.() }
    }, [open, close])
    const save = async () => {
      setBusy(true); setError('')
      try {
        await api({ op: normal ? 'preferences.save' : 'onboarding.complete', owner: owner.current, version,
          expectedKbId: record.kbId, expectedRevision: record.revision, preferences: prefs })
        active.current = false; setOpen(false); event('kbw-policy', { type: 'preferences', guideComplete: !normal })
      } catch (err) { setError(err.message); if (err.code === 'CONFLICT') await refresh() }
      finally { setBusy(false) }
    }
    if (!open) return null
    const content = e('div', { className: 'kbw kbw-backdrop', onMouseDown: ev => { if (ev.target === ev.currentTarget) close() } },
      e('section', { className: 'kbw-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'kbw-guide-title', ref: root },
        e('div', { className: 'kbw-step' }, normal ? '知识库设置' : `知识工作台 · ${step + 1} / 3`),
        e('h2', { id: 'kbw-guide-title' }, step === 0 ? '知识库插件已更新' : step === 1 ? '选择适合你的使用方式' : '确认设置'),
        step === 0 ? e('div', null, e('p', null, '当前版本 ' + version + '：目录地图、可控隐私、快速收集、阅读摘录和知识库提问。'),
          e('p', null, '接下来确认隐私展示和备份等选项。已有明确设置会保留，自动完整备份默认关闭。')) : null,
        step === 1 ? e('div', null,
          e('p', { className: 'kbw-meta' }, '当前知识库：' + (status?.kbPath || '尚未绑定，可稍后设置')),
          !status?.kbPath ? e('div', null, field('知识库目录', folder, setFolder), btn('选择目录', async () => { const r = await api({ op: 'pick-dir' }); if (r.path) setFolder(r.path) }),
            btn('接入或建立知识库', async () => { setBusy(true); try { await api({ op: 'setup', path: folder }); await refresh() } catch (err) { setError(err.message) } finally { setBusy(false) } }, busy || !folder)) : null,
          e(PreferencesFields, { prefs, setPrefs }), e('details', null, e('summary', null, 'OCR / ASR 解析配置'), e(ParseWizard))) : null,
        step === 2 ? e('div', { className: 'kbw-summary' }, [
          '知识库：' + (status?.kbPath || '稍后绑定'), '隐私展示：' + (prefs.showPrivate ? '开启' : '关闭'),
          '私密资料用于问答：' + (prefs.allowPrivateQuestions ? '允许' : '不允许'),
          '自动完整备份：' + (prefs.backup.enabled ? prefs.backup.directory + ' · ' + prefs.backup.frequency : '关闭'),
          '自动解析：' + (prefs.autoParse ? '开启' : '关闭'), '回顾提醒：' + (prefs.reviewReminders ? '开启' : '关闭')].join('\n')) : null,
        error ? e('p', { className: 'kbw-error', role: 'alert' }, error) : null,
        e('div', { className: 'kbw-actions' }, btn(normal ? '取消' : '稍后设置', close, busy),
          step > (normal ? 1 : 0) ? btn('上一步', () => setStep(step - 1), busy) : null,
          step < 2 ? btn('下一步', () => setStep(step + 1), busy) : btn(busy ? '保存中…' : '保存并开始使用', save, busy))))
    return requirePortal(content)
  }
  function requirePortal(content) {
    // Factory supplies no new dependency: use the same ReactDOM exposed by the host.
    return portal(content, document.body)
  }

  function TreeNode({ path, label, onSelect, kbId, policy }) {
    const [open, setOpen] = R.useState(false), [children, setChildren] = R.useState(null), [error, setError] = R.useState('')
    const toggle = async () => {
      setOpen(!open)
      if (!children && !open) try { const r = await api({ op: 'atlas.tree', prefix: path, expectedKbId: kbId, policyVersion: policy }); setChildren(r.items) } catch (err) { setError(err.message) }
    }
    return e('div', null, e('div', { className: 'kbw-dir' }, btn(open ? '−' : '+', toggle, false, { 'aria-label': (open ? '折叠 ' : '展开 ') + label, 'aria-expanded': open }), btn(label, () => onSelect(path))),
      open ? e('div', { className: 'kbw-dir-children' }, error || (children === null ? '读取中…' : children.map(c => e(TreeNode, { key: c.path, path: c.path, label: c.name + ' ' + c.files, onSelect, kbId, policy })))) : null)
  }

  function PDFReader({ media, page, setPage, annotations, onSelection }) {
    const [doc, setDoc] = R.useState(null), [error, setError] = R.useState(''), [regionMode, setRegionMode] = R.useState(false), [dimension, setDimension] = R.useState({ width: 600, height: 800 })
    const canvas = R.useRef(null), textLayer = R.useRef(null), stage = R.useRef(null), regionStart = R.useRef(null)
    R.useEffect(() => {
      let live = true, task
      import('/kb-core/pdfjs.mjs').then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = '/kb-core/pdf.worker.mjs'
        const bytes = Uint8Array.from(atob(media.base64), c => c.charCodeAt(0))
        task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, cMapUrl: '/kb-core/pdf-assets/cmaps/', cMapPacked: true,
          standardFontDataUrl: '/kb-core/pdf-assets/standard_fonts/', wasmUrl: '/kb-core/pdf-assets/wasm/' })
        return task.promise.then(value => { if (live) setDoc({ value, pdfjs }) })
      }).catch(e => { if (live) setError(e.message) })
      return () => { live = false; void task?.destroy() }
    }, [media])
    R.useEffect(() => {
      if (!doc) return
      let live = true, renderTask, layer
      const load = async () => {
        const p = await doc.value.getPage(Math.min(Math.max(1, page), doc.value.numPages))
        if (!live) return
        const viewport = p.getViewport({ scale: 1.2 }), target = canvas.current
        target.width = viewport.width; target.height = viewport.height; setDimension({ width: viewport.width, height: viewport.height })
        renderTask = p.render({ canvas: target, canvasContext: target.getContext('2d'), viewport }); await renderTask.promise
        if (!live) return
        textLayer.current.replaceChildren()
        textLayer.current.style.setProperty('--scale-factor', '1.2')
        textLayer.current.style.setProperty('--total-scale-factor', '1.2')
        layer = new doc.pdfjs.TextLayer({ textContentSource: await p.getTextContent(), container: textLayer.current, viewport })
        await layer.render()
      }
      void load().catch(e => { if (live && e.name !== 'RenderingCancelledException') setError(e.message) })
      return () => { live = false; renderTask?.cancel(); layer?.cancel() }
    }, [doc, page])
    const rect = ev => { const box = stage.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height)) } }
    return e('div', null, e('div', { className: 'kbw-actions' }, btn('上一页', () => setPage(p => Math.max(1, p - 1)), page <= 1), e('span', null, '第 ' + page + ' / ' + (doc?.value.numPages || '…') + ' 页'), btn('下一页', () => setPage(p => Math.min(doc.value.numPages, p + 1)), !doc || page >= doc.value.numPages), check('区域摘录', regionMode, setRegionMode)),
      error ? e('p', { role: 'alert' }, 'PDF 加载失败：' + error) : null,
      e('div', { className: 'kbw-pdf-scroll' }, e('div', { className: 'kbw-pdf-page', ref: stage, style: dimension, onMouseUp: () => {
        if (regionMode) return
        const s = window.getSelection(), quote = s?.toString()
        if (!quote || !stage.current.contains(s.anchorNode)) return
        const box = stage.current.getBoundingClientRect(), rects = [...s.getRangeAt(0).getClientRects()].map(r => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, width: r.width / box.width, height: r.height / box.height }))
        onSelection(quote, { page, rects, type: 'text' })
      } }, e('canvas', { ref: canvas }), e('div', { className: 'kbw-pdf-text', ref: textLayer }),
        annotations.filter(a => a.page === page && a.region?.rects).flatMap(a => a.region.rects.map((r, i) => e('div', { key: a.id + i, className: 'kbw-pdf-highlight', style: { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.width * 100 + '%', height: r.height * 100 + '%' } }))),
        regionMode ? e('div', { className: 'kbw-pdf-region', onPointerDown: ev => { regionStart.current = rect(ev); ev.currentTarget.setPointerCapture(ev.pointerId) }, onPointerUp: ev => {
          if (!regionStart.current) return
          const start = regionStart.current, finish = rect(ev); regionStart.current = null
          const r = { x: Math.min(start.x, finish.x), y: Math.min(start.y, finish.y), width: Math.abs(start.x - finish.x), height: Math.abs(start.y - finish.y) }
          if (r.width < .005 || r.height < .005) return
          const crop = document.createElement('canvas'); crop.width = Math.ceil(r.width * dimension.width); crop.height = Math.ceil(r.height * dimension.height)
          crop.getContext('2d').drawImage(canvas.current, r.x * dimension.width, r.y * dimension.height, crop.width, crop.height, 0, 0, crop.width, crop.height)
          onSelection('第 ' + page + ' 页区域摘录', { page, rects: [r], type: 'region', image: crop.width * crop.height <= 1000000 ? crop.toDataURL('image/png') : null }); setRegionMode(false)
        } }) : null)))
  }

  function Detail({ file, snapshot, onClose, onNavigate, onChanged, readMode = false }) {
    const [detail, setDetail] = R.useState(null), [error, setError] = R.useState(''), [media, setMedia] = R.useState(null), [quote, setQuote] = R.useState(''), [note, setNote] = R.useState(''), [page, setPage] = R.useState(1), [important, setImportant] = R.useState(false)
    const [target, setTarget] = R.useState(''), [matches, setMatches] = R.useState([]), [relations, setRelations] = R.useState(null), [readingState, setReadingState] = R.useState('reading'), [region, setRegion] = R.useState(null)
    const selection = R.useRef(null), sequence = R.useRef(0)
    const base = { expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion }
    const load = R.useCallback(async () => {
      const seq = ++sequence.current; setDetail(null); setMedia(null); setError(''); setQuote(''); setNote('')
      try {
        const [d, rel] = await Promise.all([api({ op: 'atlas.detail', path: file, ...base }), api({ op: 'atlas.relations', path: file, ...base })])
        if (seq !== sequence.current) return
        setDetail(d); setRelations(rel); setPage(d.reading?.page || 1); setReadingState(d.reading?.status || 'reading')
        if (/\.(png|jpe?g|webp|pdf)$/i.test(file)) {
          const m = await api({ op: 'atlas.media', path: file, ...base })
          if (seq !== sequence.current) return
          const bytes = Uint8Array.from(atob(m.base64), c => c.charCodeAt(0))
          setMedia({ url: URL.createObjectURL(new Blob([bytes], { type: m.mime })), mime: m.mime, base64: m.base64, revision: m.revision })
        }
      } catch (err) { if (seq === sequence.current) setError(err.message) }
    }, [file, snapshot.kbId, snapshot.policyVersion])
    R.useEffect(() => { void load(); return () => { sequence.current++ } }, [load])
    R.useEffect(() => () => { if (media?.url) URL.revokeObjectURL(media.url) }, [media])
    const write = async body => { try { const d = await api({ ...body, ...base, expectedRevision: detail?.revision }); onChanged(); await load(); return d } catch (err) { setError(err.message) } }
    if (!detail) return e('aside', { className: 'kbw-detail', 'data-open': true }, btn('返回清单', onClose), e('p', null, error || '读取内容…'))
    const content = detail.content
    function textNodes(text) {
      const marks = detail.annotations.filter(a => a.revision === content.revision && a.quote).map(a => ({ at: text.indexOf(a.quote), text: a.quote })).filter(a => a.at >= 0).sort((a, b) => a.at - b.at)
      const parts = []; let cursor = 0
      const links = str => str.split(/(\[[^\]\n]+\]\([^)\n]+\)|\[\[[^\]\n]+\]\])/g).map((part, i) => {
        const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part), wiki = /^\[\[([^\]]+)\]\]$/.exec(part)
        if (!m && !wiki) return part
        const label = m?.[1] || wiki[1], target = m?.[2] || wiki[1]
        if (/^https?:\/\//i.test(target)) return e('a', { key: i, href: target, target: '_blank', rel: 'noopener noreferrer' }, label)
        if (/^[a-z]+:/i.test(target)) return part
        return e('button', { key: i, className: 'kbw-link', onClick: async () => {
          let segments = file.split('/').slice(0, -1)
          for (const s of target.split('#')[0].split('/')) { if (s === '..') segments.pop(); else if (s && s !== '.') segments.push(s) }
          const p = segments.join('/')
          try { await api({ op: 'atlas.detail', ...base, path: p }); onNavigate('map', p) } catch { setError('链接目标不存在或不可展示，请从关系清单检查依据') }
        } }, label)
      })
      for (const mark of marks) { if (mark.at < cursor) continue; parts.push(...links(text.slice(cursor, mark.at)), e('mark', { key: 'mark-' + mark.at }, mark.text)); cursor = mark.at + mark.text.length }
      parts.push(...links(text.slice(cursor))); return parts
    }
    return e('aside', { className: 'kbw-detail', 'data-open': true },
      e('div', { className: 'kbw-actions' }, btn('返回清单', onClose), btn('复制路径', () => navigator.clipboard.writeText(snapshot.root.replace(/\\/g, '/') + '/' + file)), btn('查看关系', () => onNavigate('relations', file)),
        btn('系统打开', async () => { try { await api({ op: 'atlas.file-action', ...base, path: file, action: 'open' }) } catch(e) { setError(e.message) } }),
        btn('文件夹中显示', async () => { try { await api({ op: 'atlas.file-action', ...base, path: file, action: 'reveal' }) } catch(e) { setError(e.message) } })),
      e('h2', null, detail.file.title), e('div', { className: 'kbw-path' }, file),
      e('p', { className: 'kbw-meta' }, size(detail.file.bytes) + ' · ' + date(detail.file.mtimeMs) + (detail.file.private ? ' · 隐私内容' : '') + ' · ' + detail.file.tags.join('，')),
      detail.capture?.url ? e('p', null, e('a', { href: detail.capture.url, target: '_blank', rel: 'noopener noreferrer' }, '原始网页')) : null,
      detail.capture?.note ? e('p', { className: 'kbw-preview' }, detail.capture.note) : null,
      content ? e('div', { ref: selection, className: 'kbw-preview', onMouseUp: () => { const selected = window.getSelection(); if (selected && selection.current?.contains(selected.anchorNode)) { setQuote(selected.toString()); setRegion(null) } } }, textNodes(content.text)) : null,
      content?.truncated ? e('p', { className: 'kbw-meta' }, '仅展示前 256 KiB，请打开原文查看完整内容。') : null,
      media?.mime === 'application/pdf' ? e(PDFReader, { media, page, setPage, annotations: detail.annotations, onSelection: (text, region) => { setQuote(text); setRegion(region) } }) : media ? e('img', { src: media.url, alt: detail.file.title }) : !content ? e('p', { className: 'kbw-meta' }, '此格式暂不直接预览，可沿来源关系查看解析文本。') : null,
      e('div', { className: 'kbw-actions' }, select('阅读状态', readingState, setReadingState, [['unread', '未读'], ['reading', '在读'], ['done', '读完']]),
        /\.pdf$/i.test(file) ? field('页码', page, v => setPage(Math.max(1, Number(v) || 1)), { type: 'number', min: 1 }) : null,
        btn('保存阅读位置', () => write({ op: 'reading.progress', path: file, page, status: readingState, position: selection.current?.scrollTop || 0 })),
        btn('加入回顾', () => write({ op: 'review.update', path: file, action: 'add' }))),
      e('details', { open: readMode }, e('summary', null, '高亮摘录与批注'),
        field('摘录原文（可在上方选中文字）', quote, setQuote), field('批注', note, setNote), check('标记重要', important, setImportant),
        btn('保存摘录', () => write({ op: 'reading.annotate', path: file, quote, note, important, page: /\.pdf$/i.test(file) ? page : null, region, fileRevision: content?.revision || media?.revision }), !quote.trim()),
        detail.annotations.map(a => e('div', { key: a.id, className: 'kbw-annotation' }, e('blockquote', null, a.quote), e('p', null, a.note),
          a.region?.image ? e('img', { src: a.region.image, alt: '第 ' + a.page + ' 页摘录区域' }) : null,
          e('span', { className: 'kbw-meta' }, a.page ? '第 ' + a.page + ' 页' : '第 ' + (a.line || '—') + ' 行'),
          a.revision && content && a.revision !== content.revision ? e('p', { role: 'status' }, '原文已更新，需核对摘录位置') : null,
          btn('删除摘录', () => write({ op: 'reading.delete', path: file, id: a.id }))))),
      e('details', { open: true }, e('summary', null, '来源、引用与手动关联'),
        relations?.items.map(edge => e('div', { key: edge.id, className: 'kbw-annotation' }, btn(edge.from === file ? edge.to : edge.from, () => onNavigate('map', edge.from === file ? edge.to : edge.from)),
          e('span', { className: 'kbw-meta' }, ' · ' + edge.type + ' · ' + edge.evidence), edge.type === 'manual' ? btn('解除', () => write({ op: 'atlas.link.delete', id: edge.id })) : null)),
        field('搜索关联目标', target, setTarget), btn('查找', async () => { try { const r = await api({ op: 'atlas.list', q: target, ...base, limit: 10 }); setMatches(r.items.filter(f => f.path !== file)) } catch (err) { setError(err.message) } }),
        matches.map(f => e('div', { key: f.path }, btn('关联 ' + f.title, () => write({ op: 'atlas.link.save', from: file, to: f.path, note: '' }))))),
      error ? e('p', { className: 'kbw-error', role: 'alert' }, error) : null)
  }

  function Relations({ snapshot, focus, navigate }) {
    const [data, setData] = R.useState(null), [error, setError] = R.useState(''), [type, setType] = R.useState(''), [depth, setDepth] = R.useState('1'), [zoom, setZoom] = R.useState(1), [offset, setOffset] = R.useState(0)
    const [pan, setPan] = R.useState({ x: 0, y: 0 }), drag = R.useRef(null)
    R.useEffect(() => { let live = true; setData(null); api({ op: 'atlas.relations', expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion, path: focus || undefined, type: type || undefined, depth: Number(depth), offset }).then(d => { if (live) setData(d) }).catch(e => { if (live) setError(e.message) }); return () => { live = false } }, [snapshot.policyVersion, snapshot.revision, focus, type, depth, offset])
    const nodes = data?.nodes || [], positions = new Map()
    const incoming = new Set((data?.edges || []).filter(edge => edge.to === focus).map(edge => edge.from))
    let left = 0, right = 0, other = 0
    nodes.forEach((n, i) => positions.set(n.path, !focus ? { x: 30 + (i % 3) * 280, y: 35 + Math.floor(i / 3) * 85 } : n.path === focus ? { x: 325, y: 180 } : incoming.has(n.path) ? { x: 20, y: 25 + left++ * 80 } : { x: 620, y: 25 + right++ * 80 }))
    return e('section', { className: 'kbw-relations' }, e('div', { className: 'kbw-toolbar' },
      select('关系', type, v => { setType(v); setOffset(0) }, [['', '来源、引用与手动关联'], ['source', '来源'], ['reference', '引用'], ['manual', '手动关联'], ['directory', '目录归属']]),
      select('展开层数', depth, setDepth, [['1', '一层'], ['2', '两层']]), btn('放大', () => setZoom(z => Math.min(3, z + .2))), btn('缩小', () => setZoom(z => Math.max(.3, z - .2))), btn('回到中心', () => { setZoom(1); setPan({ x: 0, y: 0 }) })),
      focus ? e('p', { className: 'kbw-path' }, '当前中心：' + focus) : e('p', { className: 'kbw-meta' }, '从地图选中资料后查看局部关系。点击节点可继续浏览。'),
      data ? e('svg', { className: 'kbw-graph', viewBox: '0 0 880 430', role: 'img', 'aria-label': '知识关系地图',
        onPointerDown: ev => { drag.current = { x: ev.clientX, y: ev.clientY, original: pan }; ev.currentTarget.setPointerCapture(ev.pointerId) },
        onPointerMove: ev => { if (drag.current) setPan({ x: drag.current.original.x + ev.clientX - drag.current.x, y: drag.current.original.y + ev.clientY - drag.current.y }) },
        onPointerUp: () => { drag.current = null } },
        e('g', { transform: `translate(${pan.x} ${pan.y}) scale(${zoom})` },
          data.edges.map(edge => { const a = positions.get(edge.from), b = positions.get(edge.to); return a && b ? e('line', { key: edge.id, x1: a.x + 110, y1: a.y + 22, x2: b.x + 110, y2: b.y + 22 }, e('title', null, edge.type + '：' + edge.evidence)) : null }),
          nodes.map(n => { const p = positions.get(n.path); return e('g', { key: n.path, 'data-node': true, 'data-center': n.path === focus || undefined, role: 'button', tabIndex: 0,
            onClick: () => navigate('map', n.path, n.layer === 'directory'), onKeyDown: ev => { if (ev.key === 'Enter') navigate('map', n.path, n.layer === 'directory') }, transform: `translate(${p.x} ${p.y})` },
            e('rect', { width: 230, height: 48, rx: 7 }), e('text', { x: 10, y: 29 }, n.title.slice(0, 19)), e('title', null, n.path)) }))) : e('p', null, error || '读取关系…'),
      data?.graphLimited ? e('p', { role: 'status' }, '画布已达到展示上限；以下清单可翻页查看完整结果。') : null,
      data?.items.map(edge => e('div', { key: edge.id, className: 'kbw-annotation' }, btn(edge.from, () => navigate('relations', edge.from)), e('span', null, ' → ' + edge.type + ' → '), btn(edge.to, () => navigate('relations', edge.to)), e('div', { className: 'kbw-meta' }, edge.evidence))),
      data && !data.total ? e('p', { className: 'kbw-empty' }, '当前范围没有已确认的关系。') : null,
      data ? e('div', { className: 'kbw-actions' }, btn('上一页', () => setOffset(Math.max(0, offset - 100)), offset === 0), e('span', null, '共 ' + data.total + ' 条关系'), btn('下一页', () => setOffset(offset + 100), offset + data.items.length >= data.total)) : null,
      data?.issues.length ? e('p', { className: 'kbw-meta' }, '存在 ' + data.issues.length + ' 个失效或歧义链接，未自动猜测目标。') : null)
  }

  function Inbox({ snapshot, changed, navigate }) {
    const [data, setData] = R.useState(null), [text, setText] = R.useState(''), [title, setTitle] = R.useState(''), [url, setUrl] = R.useState(''), [upload, setUpload] = R.useState(null), [status, setStatus] = R.useState(''), [error, setError] = R.useState(''), [busy, setBusy] = R.useState(false)
    const [selected, setSelected] = R.useState([]), [tags, setTags] = R.useState(''), [dir, setDir] = R.useState(''), [pair, setPair] = R.useState(null), [extensionOrigin, setExtensionOrigin] = R.useState(''), [connections, setConnections] = R.useState([])
    const draftKey = 'kbw-capture-draft:' + snapshot.kbId
    R.useEffect(() => { try { setText(localStorage.getItem(draftKey) || '') } catch {} }, [draftKey])
    R.useEffect(() => { try { if (text) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey) } catch {} }, [text, draftKey])
    const refresh = R.useCallback(() => api({ op: 'capture.list', expectedKbId: snapshot.kbId, status: status || undefined }).then(setData).catch(e => setError(e.message)), [snapshot.kbId, snapshot.policyVersion, status])
    R.useEffect(() => { void refresh() }, [refresh, snapshot.revision])
    const base = { expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion }
    const create = async allowDuplicate => {
      setBusy(true); setError('')
      try {
        const r = await api({ op: 'capture.create', ...base, expectedRevision: data.revision, title, text, url, base64: upload ? await fileBase64(upload) : undefined, filename: upload?.name, allowDuplicate })
        if (r.requiresConfirmation) { if (window.confirm('已有相同内容，仍然保存另一份？')) return await create(true); return }
        setText(''); setTitle(''); setUrl(''); setUpload(null); changed(); await refresh()
      } catch (err) { setError(err.message) } finally { setBusy(false) }
    }
    const batch = async action => {
      setBusy(true); setError('')
      try {
        let current = await api({ op: 'capture.list', ...base })
        if (action === 'organize') for (const id of selected) { await api({ op: 'capture.organize', ...base, id, dir, tags: tags.split(/[,，]/).map(s => s.trim()).filter(Boolean), expectedRevision: current.revision }); current = await api({ op: 'capture.list', ...base }) }
        else await api({ op: 'capture.update', ...base, ids: selected, status: action, expectedRevision: current.revision })
        setSelected([]); changed(); await refresh()
      } catch (err) { setError(err.message); await refresh() } finally { setBusy(false) }
    }
    return e('section', { className: 'kbw-content' }, e('div', { className: 'kbw-form' },
      e('h2', null, '收件箱 · 快速收集'), e('p', { className: 'kbw-meta' }, '文字、网页和文件保存到 90-收件箱/快速收集/，整理后保留原件。离线文字草稿保存在此浏览器，恢复连接后主动提交。'),
      e('p', null, e('a', { href: '/kb-core/collect', target: '_blank', rel: 'noopener noreferrer' }, '打开手机快速收集页 / 添加到主屏幕')),
      field('标题（可留空）', title, setTitle), field('网页地址（可选）', url, setUrl, { type: 'url' }),
      e('label', { className: 'kbw-field' }, '记录内容', e('textarea', { value: text, onChange: ev => setText(ev.target.value), placeholder: '先记下来，稍后整理…' })),
      e('input', { type: 'file', 'aria-label': '上传资料', onChange: ev => setUpload(ev.target.files?.[0] || null) }),
      btn(busy ? '处理中…' : '保存到快速收集', () => create(false), busy || !data),
      e('hr'), select('处理状态', status, setStatus, [['', '全部'], ['pending', '待处理'], ['processing', '处理中'], ['done', '已处理'], ['failed', '失败'], ['ignored', '已忽略']]),
      e('div', { className: 'kbw-actions' }, select('整理到分区', dir, setDir, [['', '默认知识笔记'], ['20-知识笔记','知识笔记'], ['10-项目','项目'], ['40-素材资源','素材资源'], ...snapshot.preferences.showPrivate ? [['30-人物关系','人物关系'],['00-画像','画像']] : []]), field('标签（逗号分隔）', tags, setTags),
        btn('整理所选', () => batch('organize'), busy || !selected.length), btn('忽略所选', () => batch('ignored'), busy || !selected.length), btn('重新待处理', () => batch('pending'), busy || !selected.length)),
      data?.items.map(c => e('div', { key: c.id, className: 'kbw-annotation' }, check(c.title, selected.includes(c.id), value => setSelected(old => value ? [...old, c.id] : old.filter(id => id !== c.id))),
        e('span', { className: 'kbw-meta' }, c.status + ' · ' + date(c.createdAt)), btn('查看原件', () => navigate('map', c.path)), c.entryPath ? btn('查看知识条目', () => navigate('map', c.entryPath)) : null)),
      e('details', null, e('summary', null, '浏览器剪藏配对'), field('扩展来源', extensionOrigin, setExtensionOrigin, { placeholder: 'chrome-extension://扩展ID' }),
        btn('生成配对码', async () => { try { setPair(await api({ op: 'capture.pair.create', ...base, origin: extensionOrigin })) } catch (err) { setError(err.message) } }),
        pair ? e('p', { className: 'kbw-summary' }, '配对码：' + pair.code + '（5 分钟内有效）\n在扩展设置中填写当前宿主地址和配对码。') : null,
        btn('查看已配对扩展', async () => { try { setConnections((await api({ op: 'capture.pair.list', ...base })).items) } catch (e) { setError(e.message) } }),
        connections.map(c => e('div', { key: c.id }, e('span', { className: 'kbw-path' }, c.origin), btn('撤销授权', async () => { await api({ op: 'capture.pair.revoke', ...base, id: c.id }); setConnections(old => old.filter(i => i.id !== c.id)) })))),
      error ? e('p', { className: 'kbw-error', role: 'alert' }, error) : null))
  }

  function Backups({ snapshot }) {
    const [directory, setDirectory] = R.useState(snapshot.preferences.backup.directory), [items, setItems] = R.useState([]), [message, setMessage] = R.useState(''), [busy, setBusy] = R.useState(false), [destination, setDestination] = R.useState(''), [restorePath, setRestorePath] = R.useState(''), [comparison, setComparison] = R.useState(null)
    const run = async body => { setBusy(true); try { const r = await api({ ...body, expectedKbId: snapshot.kbId, directory }); setMessage(r.valid === false ? '校验失败：' + JSON.stringify(r.errors) : r.manifest?.complete === false ? '备份不完整，请查看报告' : r.note || '操作完成'); if (r.items) setItems(r.items); if (r.manifest) setMessage('备份 ' + r.name + ' · ' + (r.manifest.complete ? '完整' : '不完整') + ' · ' + r.manifest.files.length + ' 个文件'); return r } catch (err) { setMessage(err.message) } finally { setBusy(false) } }
    return e('details', null, e('summary', null, '完整备份、恢复与导出'), e('p', { className: 'kbw-meta' }, '自动备份：' + (snapshot.preferences.backup.enabled ? '开启' : '关闭') + '。手动备份不打开自动开关。'),
      field('备份目录', directory, setDirectory), e('div', { className: 'kbw-actions' }, btn('手动备份一次', () => run({ op: 'backup.create' }), busy || !directory), btn('列出备份', () => run({ op: 'backup.list' }), busy || !directory),
        btn('导出可见原文与附件', () => run({ op: 'backup.export', format: 'files' }), busy || !directory),
        btn('导出目录 CSV', async () => { const r = await run({ op: 'backup.export', format: 'csv' }); if (r) download(r.filename, r.text) }, busy),
        btn('导出关系与摘录', async () => { const r = await run({ op: 'backup.export', format: 'json' }); if (r) download(r.filename, r.text, 'application/json') }, busy)),
      field('恢复到新目录（必须不存在）', destination, setDestination), field('单文件恢复：库内相对路径', restorePath, value => { setRestorePath(value); setComparison(null) }), items.map(item => e('div', { key: item.name, className: 'kbw-annotation' },
        e('div', { className: 'kbw-path' }, item.name), e('span', null, (item.complete ? '完整' : '不完整') + ' · ' + item.files + ' 个文件 · ' + date(item.createdAt)),
        btn('校验', () => run({ op: 'backup.verify', name: item.name }), busy), btn('恢复到新目录', () => { if (window.confirm('恢复到新目录并校验，当前知识库不切换。继续？')) void run({ op: 'backup.restore', name: item.name, destination }) }, busy || !destination || !item.complete),
        btn('比较单文件', async () => { const r = await run({ op: 'backup.restore-file', name: item.name, path: restorePath }); if (r) setComparison({ ...r, name: item.name, path: restorePath }) }, busy || !restorePath))),
      comparison ? e('div', null, e('p', null, '当前版本：' + (comparison.currentHash || '不存在') + '；备份版本：' + comparison.backupHash),
        e('details', null, e('summary', null, '查看当前与备份内容'), e('h4', null, '当前'), e('pre', { className: 'kbw-preview' }, comparison.currentText || '无文本预览'), e('h4', null, '备份'), e('pre', { className: 'kbw-preview' }, comparison.backupText || '无文本预览')),
        btn('确认恢复此文件', async () => { const r = await run({ op: 'backup.restore-file', name: comparison.name, path: comparison.path, confirm: true, expectedHash: comparison.currentHash }); if (r) setComparison(null) }, busy)) : null,
      message ? e('p', { role: 'status' }, message) : null)
  }

  function Review({ snapshot, navigate, changed }) {
    const [data, setData] = R.useState(null), [error, setError] = R.useState(''), [days, setDays] = R.useState('7')
    const refresh = R.useCallback(() => api({ op: 'review.list', expectedKbId: snapshot.kbId, days: Number(days) }).then(setData).catch(e => setError(e.message)), [snapshot.kbId, snapshot.policyVersion, days])
    R.useEffect(() => { void refresh() }, [refresh, snapshot.revision])
    const update = async (file, action) => { try { await api({ op: 'review.update', path: file, action, expectedKbId: snapshot.kbId, expectedRevision: data.revision }); changed(); await refresh() } catch (e) { setError(e.message) } }
    return e('section', { className: 'kbw-content' }, e('h2', null, '回顾'), select('时间范围', days, setDays, [['1', '每日'], ['7', '每周']]),
      e('h3', null, '待整理'), data?.pending.map(i => e('div', { key: i.id }, btn(i.title, () => navigate('inbox')))),
      e('h3', null, '到期回顾'), data?.due.map(i => e('div', { key: i.path, className: 'kbw-annotation' }, btn(i.path, () => navigate('reading', i.path)), btn('下一次', () => update(i.path, 'next')), btn('稍后一天', () => update(i.path, 'later')), btn('已掌握', () => update(i.path, 'mastered')), btn('取消回顾', () => update(i.path, 'remove')))),
      e('h3', null, '最近内容'), data?.recent.map(f => e('div', { key: f.path }, btn(f.title, () => navigate('reading', f.path)))),
      e('h3', null, '重要摘录'), data?.annotations.map(a => e('div', { key: a.id, className: 'kbw-annotation' }, e('blockquote', null, a.quote), btn(a.path, () => navigate('reading', a.path)))), error ? e('p', { role: 'alert' }, error) : null)
  }

  function TaskCenter({ snapshot }) {
    const [data, setData] = R.useState(null), [error, setError] = R.useState('')
    const refresh = async () => { try { setData(await api({ op: 'tasks.list', expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion })) } catch (e) { setError(e.message) } }
    const act = async (op, jobId) => { try { await api({ op, jobId }); await refresh() } catch (e) { setError(e.message) } }
    return e('details', null, e('summary', null, '任务中心'), btn('刷新任务', refresh),
      data?.tasks.map((t, i) => e('div', { key: t.id || i }, t.type + ' · ' + t.state + ' · ' + (t.copied || 0))),
      data?.imports?.map(i => e('div', { key: i.importId, className: 'kbw-annotation' }, '导入 · ' + i.stage + ' · 成功 ' + (i.counts?.done || 0) + ' / ' + (i.counts?.total || 0),
        btn(i.running ? '中止导入' : '继续 / 重试', async () => { try { await api({ op: i.running ? 'import-cancel' : 'import-run', importId: i.importId }); await refresh() } catch(e) { setError(e.message) } }))),
      data?.parseJobs.map(j => e('div', { key: j.jobId, className: 'kbw-annotation' }, e('div', null, j.kind + ' · ' + j.status + ' · ' + (j.source?.relPath || '')),
        ['running','queued'].includes(j.status) ? btn('取消', () => act('parse.cancel', j.jobId)) : null,
        ['failed','partial','interrupted'].includes(j.status) || j.land?.status === 'failed' ? btn(j.land?.status === 'failed' ? '仅重试落库' : '重试解析', () => act('parse.retry', j.jobId)) : null,
        j.result ? e('div', { className: 'kbw-meta' }, '解析字符 ' + (j.result.textChars || 0) + ' · 落库 ' + (j.land?.status || '待处理')) : null)),
      data && !data.tasks.length && !data.parseJobs.length ? e('p', null, '暂无任务') : null, error ? e('p', { role: 'alert' }, error) : null)
  }

  function FlowTemplates({ snapshot }) {
    const [message, setMessage] = R.useState('')
    return e('details', null, e('summary', null, '添加知识工作台流程模板'), e('div', { className: 'kbw-actions' }, [['inbox','整理本周收件箱'],['weekly','本周知识回顾'],['project','项目资料汇总']].map(([id,label]) => btn(label, async () => {
      try { const r = await api({ op: 'tasks.install-template', expectedKbId: snapshot.kbId, id }); setMessage((r.existing ? '已有模板：' : '已添加：') + label + '，刷新流程列表后可运行。') } catch(e) { setMessage(e.message) }
    }, false, { key: id }))), btn('导入此库备份的流程', async () => {
      try { const r = await api({ op: 'tasks.restore-flows', expectedKbId: snapshot.kbId }); setMessage('已恢复 ' + r.restored + ' 个流程；同 ID 已有流程跳过 ' + r.skipped.length + ' 个。') } catch(e) { setMessage(e.message) }
    }), message ? e('p', { role: 'status' }, message) : null)
  }

  function ReadingLibrary({ snapshot, navigate }) {
    const [data, setData] = R.useState(null), [selected, setSelected] = R.useState([]), [error, setError] = R.useState(''), [title, setTitle] = R.useState('阅读摘录')
    R.useEffect(() => { let live = true; api({ op: 'reading.list', expectedKbId: snapshot.kbId }).then(d => { if (live) setData(d) }).catch(e => setError(e.message)); return () => { live = false } }, [snapshot.kbId, snapshot.policyVersion, snapshot.revision])
    return e('section', { className: 'kbw-content' }, e('h2', null, '阅读与摘录'), btn('选择资料开始阅读', () => navigate('map')),
      data?.items.map(r => e('div', { key: r.path, className: 'kbw-annotation' }, btn(r.path, () => navigate('reading', r.path)), e('span', null, ' · ' + r.status + ' · 第 ' + r.page + ' 页'))),
      e('h3', null, '摘录'), data?.annotations.map(a => e('div', { key: a.id, className: 'kbw-annotation' }, check(a.quote, selected.includes(a.id), v => setSelected(old => v ? [...old, a.id] : old.filter(id => id !== a.id))), e('p', null, a.note), btn(a.path, () => navigate('reading', a.path)))),
      field('生成笔记标题', title, setTitle), btn('从所选摘录生成笔记', async () => { try { const r = await api({ op: 'reading.note', title, ids: selected, expectedKbId: snapshot.kbId, expectedRevision: data.revision, requestId: crypto.randomUUID() }); navigate('map', r.entry.path) } catch (e) { setError(e.message) } }, !selected.length),
      btn('导出摘录 Markdown', async () => { try { const r = await api({ op: 'reading.export', expectedKbId: snapshot.kbId }); download(r.filename, r.text) } catch (e) { setError(e.message) } }), error ? e('p', { role: 'alert' }, error) : null)
  }

  function Workbench() {
    styles()
    const [snapshot, setSnapshot] = R.useState(null), [tab, setTab] = R.useState('map'), [prefix, setPrefix] = R.useState(''), [selected, setSelected] = R.useState('')
    const [query, setQuery] = R.useState(''), [mode, setMode] = R.useState('path'), [layer, setLayer] = R.useState(''), [extension, setExtension] = R.useState(''), [tag, setTag] = R.useState(''), [after, setAfter] = R.useState(''), [before, setBefore] = R.useState(''), [sort, setSort] = R.useState('name'), [direct, setDirect] = R.useState(false)
    const [list, setList] = R.useState(null), [offset, setOffset] = R.useState(0), [error, setError] = R.useState(''), [busy, setBusy] = R.useState(false), [deferred, setDeferred] = R.useState(false), [tasks, setTasks] = R.useState(null), [reminder, setReminder] = R.useState(null)
    const current = R.useRef(null), generation = R.useRef(0), first = R.useRef(true), request = R.useRef(0)
    const refresh = R.useCallback(async () => {
      const gen = generation.current
      try {
        const next = await api({ op: 'atlas.snapshot' })
        if (gen !== generation.current) return
        if (current.current && (current.current.kbId !== next.kbId || current.current.policyVersion !== next.policyVersion)) { generation.current++; request.current++; setList(null); setSelected(''); setPrefix(''); setTasks(null) }
        if (first.current) {
          first.current = false
          let chosen = next.preferences.landing
          if (chosen === 'remember') { try { chosen = localStorage.getItem('kbw-tab:' + next.kbId) || 'map' } catch { chosen = 'map' } }
          setTab(chosen === 'overview' ? 'overview' : ['map', 'relations', 'inbox', 'reading', 'review', 'flows'].includes(chosen) ? chosen : 'map')
        }
        current.current = next; setSnapshot(next); setError('')
        if (next.guideComplete) setDeferred(false)
      } catch (err) { if (gen === generation.current) { setError(err.message); setSnapshot(null); setList(null); setSelected('') } }
    }, [])
    R.useEffect(() => {
      connectEvents(); void refresh()
      const policy = ev => {
        if (ev.detail?.type === 'review-due') { if (ev.detail.kbId === current.current?.kbId) setReminder(ev.detail.count); return }
        generation.current++; request.current++; current.current = null; setSnapshot(null); setList(null); setSelected(''); setTasks(null); void refresh()
      }
      const timer = setInterval(() => { if (!document.hidden) void refresh() }, 5000)
      const defer = () => setDeferred(true)
      const capture = ev => { if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setTab('inbox') } }
      window.addEventListener('kbw-policy', policy); window.addEventListener('kbw-deferred', defer); window.addEventListener('keydown', capture)
      return () => { generation.current++; request.current++; clearInterval(timer); window.removeEventListener('kbw-policy', policy); window.removeEventListener('kbw-deferred', defer); window.removeEventListener('keydown', capture) }
    }, [refresh])
    const navigate = R.useCallback((next, file, directory = false) => { setTab(next); setSelected(directory ? '' : file || ''); if (file) setPrefix(directory ? file : file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '') }, [])
    const loadList = R.useCallback(async () => {
      if (!snapshot) return
      const seq = ++request.current, gen = generation.current
      setBusy(true)
      try {
        const result = await api({ op: 'atlas.list', expectedKbId: snapshot.kbId, policyVersion: snapshot.policyVersion, prefix, q: query, mode, layer: layer || undefined, extension: extension || undefined,
          tag: tag || undefined, after: after || undefined, before: before || undefined, sort, direct, offset })
        if (seq === request.current && gen === generation.current) setList(result)
      } catch (err) { if (seq === request.current) setError(err.message) }
      finally { if (seq === request.current) setBusy(false) }
    }, [snapshot?.kbId, snapshot?.policyVersion, snapshot?.version, prefix, query, mode, layer, extension, tag, after, before, sort, direct, offset])
    R.useEffect(() => { const timer = setTimeout(() => { void loadList() }, 200); return () => clearTimeout(timer) }, [loadList])
    R.useEffect(() => { if (snapshot) try { localStorage.setItem('kbw-tab:' + snapshot.kbId, tab) } catch {} }, [tab, snapshot?.kbId])
    const openScope = p => { setPrefix(p); setSelected(''); setOffset(0) }
    const searchSubmit = ev => { ev?.preventDefault(); setOffset(0); void loadList() }
    const tabs = [['overview', '总览'], ['map', '地图'], ['relations', '关系'], ['inbox', '收件箱'], ['reading', '阅读'], ['review', '回顾'], ['flows', '流程']]
    return e('div', { className: 'kbw' },
      e('nav', { className: 'kbw-nav', 'aria-label': '知识库功能' }, tabs.map(([id, label]) => btn(label, () => { setTab(id); if (id !== 'relations') setSelected('') }, false, { key: id, 'aria-current': tab === id })),
        e('span', { style: { flex: 1 } }), btn('设置', () => event('kbw-settings')), e(BuildBadge)),
      deferred ? e('div', { className: 'kbw-banner' }, '必要设置尚未完成', btn('继续设置', () => event('kbw-settings'))) : null,
      snapshot?.needsConfirmation ? e('div', { className: 'kbw-banner' }, '此库尚未确认 profile 默认偏好，当前使用安全默认值。', btn('确认此库设置', () => event('kbw-settings'))) : null,
      reminder !== null ? e('div', { className: 'kbw-banner' }, '有 ' + reminder + ' 项资料可以回顾', btn('查看回顾', () => { setTab('review'); setReminder(null) }), btn('关闭', () => setReminder(null))) : null,
      error ? e('div', { className: 'kbw-error', role: 'alert' }, error, btn('重试', refresh)) : null,
      !snapshot ? e('div', { className: 'kbw-content' }, e('p', null, error ? '请检查绑定或进入设置。' : '正在读取知识库…'), btn('打开设置', () => event('kbw-settings'))) : null,
      snapshot ? e(R.Fragment, null,
        e('div', { className: 'kbw-status' }, '隐私展示：' + (snapshot.preferences.showPrivate ? '开启' : '关闭') + ' · 知识 ' + snapshot.totals.knowledge + ' 条 · 可展示文件 ' + snapshot.totals.visible + ' / 全部文件 ' + snapshot.totals.files, btn('调整', () => event('kbw-settings'))),
        snapshot.coverage.errors || snapshot.coverage.truncated ? e('div', { className: 'kbw-banner', role: 'status' }, '扫描结果不完整：' + snapshot.coverage.errors + ' 处错误' + (snapshot.coverage.truncated ? '，已达到扫描上限' : '') + '。当前统计仅覆盖已读取的内容。') : null,
        tab === 'overview' ? e('section', { className: 'kbw-content' }, e('div', { className: 'kbw-actions' }, btn('快速收集', () => navigate('inbox')), btn('查看地图', () => navigate('map'))),
          e('h2', null, '知识库分区'), e('div', { className: 'kbw-actions' }, snapshot.sections.filter(s => !s.private || snapshot.preferences.showPrivate).map(s => btn(s.name + ' · ' + s.files, () => { navigate('map'); openScope(s.name) }, false, { key: s.name }))),
          e('h2', null, '最近变更'), snapshot.recent.map(f => e('div', { key: f.path, className: 'kbw-annotation' }, btn(f.title, () => navigate('map', f.path)), e('span', { className: 'kbw-meta' }, ' · ' + date(f.mtimeMs)))),
          e('details', null, e('summary', null, '运行状态、索引与异常'), e(Overview)),
          e(Backups, { snapshot }), e(TaskCenter, { snapshot })) : null,
        tab === 'map' || tab === 'reading' && selected ? e(R.Fragment, null,
          e('form', { className: 'kbw-toolbar', onSubmit: searchSubmit }, e('input', { 'aria-label': '搜索知识库', placeholder: '搜索文件或知识正文', value: query, onChange: ev => setQuery(ev.target.value) }),
            e('select', { 'aria-label': '搜索方式', value: mode, onChange: ev => { setMode(ev.target.value); setOffset(0) } }, e('option', { value: 'path' }, '文件名与路径'), e('option', { value: 'body' }, '知识正文')),
            e('button', { type: 'submit', className: 'kbw-button', disabled: busy }, busy ? '查询中…' : '搜索'), btn('刷新', () => { void refresh(); void loadList() })),
          e('details', { style: { padding: '0 18px 10px' } }, e('summary', null, '筛选与排序'), e('div', { className: 'kbw-toolbar' },
            select('范围', layer, v => { setLayer(v); setOffset(0) }, [['', '全部文件'], ['knowledge', '知识条目'], ['original', '原件附件'], ['draft', '底稿']]),
            field('扩展名', extension, setExtension), field('标签', tag, setTag), field('起始日期', after, setAfter, { type: 'date' }), field('截止日期', before, setBefore, { type: 'date' }),
            select('排序', sort, setSort, [['name', '名称'], ['modified', '最近修改'], ['relevance', '匹配程度']]), check('仅当前层', direct, setDirect))),
          e('div', { className: 'kbw-breadcrumb' }, btn('全库', () => openScope('')), prefix.split('/').filter(Boolean).map((part, i, all) => btn(part, () => openScope(all.slice(0, i + 1).join('/')), false, { key: i }))),
          e('div', { className: 'kbw-grid' },
            e('aside', { className: 'kbw-tree', 'aria-label': '目录树', key: snapshot.policyVersion }, btn('全部内容', () => openScope('')),
              snapshot.sections.map(s => s.private && !snapshot.preferences.showPrivate ? e('div', { key: s.name, className: 'kbw-meta' }, s.name + ' · 隐私 · ' + s.files + ' 个') : e(TreeNode, { key: s.name, path: s.name, label: s.name + ' ' + s.files, onSelect: openScope, kbId: snapshot.kbId, policy: snapshot.policyVersion }))),
            e('section', { className: 'kbw-list', 'aria-label': '内容清单' }, list ? e(R.Fragment, null,
              e('div', { className: 'kbw-meta' }, list.total + ' 个结果 · ' + list.coverageNote), list.truncated ? e('p', { role: 'status' }, '结果不完整，扫描已达到上限') : null,
              list.items.map(f => e('button', { key: f.path, className: 'kbw-row', 'aria-current': selected === f.path, onClick: () => setSelected(f.path) }, e('strong', null, f.title), e('span', { className: 'kbw-path' }, f.path),
                e('div', { className: 'kbw-meta' }, size(f.bytes) + ' · ' + date(f.mtimeMs)), f.snippet ? e('p', null, f.snippet) : null)),
              !list.items.length ? e('p', { className: 'kbw-empty' }, '当前范围没有匹配的内容') : null,
              e('div', { className: 'kbw-actions' }, btn('上一页', () => setOffset(Math.max(0, offset - 100)), offset === 0), btn('下一页', () => setOffset(offset + 100), offset + list.items.length >= list.total))) : e('p', null, '读取清单…')),
            selected ? e(Detail, { key: selected + snapshot.policyVersion, file: selected, snapshot, onClose: () => setSelected(''), onNavigate: navigate, onChanged: refresh, readMode: tab === 'reading' }) : e('aside', { className: 'kbw-detail' }, e('p', { className: 'kbw-empty' }, '选择资料查看内容、来源与关系。')))) : null,
        tab === 'relations' ? e(Relations, { snapshot, focus: selected, navigate }) : null,
        tab === 'inbox' ? e(Inbox, { snapshot, changed: refresh, navigate }) : null,
        tab === 'reading' && !selected ? e(ReadingLibrary, { snapshot, navigate }) : null,
        tab === 'review' ? e(Review, { snapshot, changed: refresh, navigate }) : null,
        tab === 'flows' ? e('section', { className: 'kbw-content' }, e(FlowTemplates, { snapshot }), e(Flows)) : null) : null)
  }

  function registerReferences(ctx) {
    return ctx.inject(['inputTriggers'], scope => scope.effect(() => scope.get('inputTriggers').registerSource({
      trigger: '@', name: 'knowledge-base',
      async candidates(session, { query, signal }) {
        if (signal.aborted || query && !['基于知识库提问', 'knowledge', 'kb'].some(s => s.toLowerCase().includes(query.toLowerCase()))) return []
        const snap = await api({ op: 'atlas.snapshot' }, signal)
        const make = (prefix, includePrivate) => ({ name: '基于知识库提问', label: prefix ? '知识库 · ' + prefix : '基于知识库提问',
          description: (prefix || '全库') + (includePrivate ? ' · 含隐私' : ' · 不含隐私'),
          value: JSON.stringify({ sessionId: session.sessionId, kbId: snap.kbId, policyVersion: snap.policyVersion, prefix, includePrivate }) })
        const rows = [make('', false)]
        if (snap.preferences.allowPrivateQuestions) rows.push(make('', true))
        for (const section of snap.sections) if (!section.private || snap.preferences.allowPrivateQuestions) rows.push(make(section.name, section.private))
        return rows
      },
      onPick({ candidate }) {
        const selected = JSON.parse(candidate.value)
        const ref = 'kbq:' + encodeURIComponent(JSON.stringify(selected))
        return { insert: { source: 'knowledge-base', ref, label: '基于知识库提问（' + (selected.prefix || '全库') + (selected.includePrivate ? '，含隐私' : '，不含隐私') + '）', appearance: 'file', clipboardText: '@基于知识库提问' } }
      },
      codec: {
        clipboardText: () => '@基于知识库提问',
        async serialize(ref, signal) {
          if (!ref.startsWith('kbq:')) throw new Error('知识库引用无效，请重新选择')
          const selected = JSON.parse(decodeURIComponent(ref.slice(4)))
          const actx = ctx.get('sessions')?.scope(selected.sessionId)
          const conversation = actx?.get('conversation')
          const shell = conversation?.input?.for(actx)
          const draft = shell?.state?.getSnapshot()?.draft ?? shell?.snapshot?.draft
          if (typeof draft !== 'string') throw new Error('无法读取本次问题，请重新选择知识库提问')
          const query = draft.replaceAll(ref, '').replace(/@?基于知识库提问(?:（[^）]*）)?/g, '').trim()
          if (!query) throw new Error('请在知识库标记后输入问题')
          const result = await api({ op: 'search.context', expectedKbId: selected.kbId, policyVersion: selected.policyVersion, prefix: selected.prefix, includePrivate: selected.includePrivate, q: query }, signal)
          return result.prompt + '\n引用校验上下文：' + result.questionId + '。回答前使用 kb_validate_citations 校验拟用的 [S编号]，无效引用不得展示为依据。\n'
        },
      },
    }), 'kb-workbench: native @ knowledge reference'))
  }
  return { Workbench, Guide, api, event, registerReferences, dispose: () => { eventSource?.close(); eventSource = null; eventsStarted = false; styleElement?.remove(); stylesInstalled = false; guideInstance = null } }
}
