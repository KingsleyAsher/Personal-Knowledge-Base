// P1-G 客户端半边
//   1) settings.section  → 设置里的「个人知识库」
//   2) conversation.view → 顶栏页签「知识库」（简化版知识库地图，只读）
// 契约抄自已安装插件（dsh-lorebookmd / dsh-client-ui-trajectory）：
//   window.__ModuleLoader__.load({ id, factory })
//   顶栏页签 = ctx.slots.register({ name:'conversation.view', id, order, label }, Component)
window.__ModuleLoader__.load({
  id: '@local/dsh-knowledge-base',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const e = react.createElement

    const CSS = `
.kbc-set{display:flex;flex-direction:column;gap:12px;padding:4px 0 8px;font-size:13px;line-height:1.6}
.kbc-set-intro{opacity:.62}
.kbc-set-info{display:flex;flex-direction:column;gap:6px}
.kbc-set-row{display:flex;align-items:baseline;gap:10px}
.kbc-set-key{min-width:84px;flex-shrink:0;opacity:.55}
.kbc-set-val{word-break:break-all}
.kbc-set-input{width:100%;box-sizing:border-box;padding:7px 10px;font-size:13px;line-height:1.5;
  color:inherit;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  border-radius:8px;outline:none;transition:border-color .15s,box-shadow .15s}
.kbc-set-input::placeholder{color:rgba(255,255,255,.32)}
.kbc-set-input:focus{border-color:rgba(255,255,255,.34);box-shadow:0 0 0 2px rgba(255,255,255,.06)}
.kbc-set-actions{display:flex;gap:8px;flex-wrap:wrap}
.kbc-btn{padding:6px 14px;font-size:13px;line-height:1.5;border-radius:6px;cursor:pointer;
  border:1px solid transparent;transition:background .15s,border-color .15s,color .15s}
.kbc-btn:disabled{opacity:.4;cursor:not-allowed}
.kbc-btn-primary{color:#1a1a1a;background:#ececec;font-weight:500}
.kbc-btn-primary:hover:enabled{background:#f7f7f7}
.kbc-btn-primary:active:enabled{background:#dedede}
.kbc-btn-ghost{color:rgba(255,255,255,.92);background:rgba(255,255,255,.07);
  border-color:rgba(255,255,255,.12)}
.kbc-btn-ghost:hover:enabled{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.18)}
.kbc-btn-ghost:active:enabled{background:rgba(255,255,255,.1)}
.kbc-set-msg{opacity:.72}
.kbc-set-hint{opacity:.42;font-size:12px}
.kbc-set-h{font-size:12px;font-weight:600;opacity:.75;margin:14px 0 4px}
.kbc-set-plan{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:8px;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);font-size:12px}
.kbm-nowrap{white-space:nowrap;min-width:56px;flex:0 0 auto}

.kbm{height:100%;overflow:auto;padding:18px 22px 140px;font-size:13px;line-height:1.6;box-sizing:border-box}
.kbm-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.kbm-title{font-size:15px;font-weight:600}
.kbm-sub{opacity:.5;font-size:12px}
.kbm-stats{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0 18px}
.kbm-stat{display:flex;flex-direction:column;gap:2px}
.kbm-stat-num{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.kbm-stat-label{font-size:11px;opacity:.45}
.kbm-h{font-size:12px;opacity:.45;margin:18px 0 8px;letter-spacing:.02em}
.kbm-table{width:100%;max-width:880px;border-collapse:collapse}
.kbm-table td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.06)}
.kbm-table td:nth-child(1){width:auto}
.kbm-table td:nth-child(2){width:110px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8}
.kbm-table td:nth-child(3){width:130px;text-align:right;font-variant-numeric:tabular-nums;opacity:.8}
.kbm-table td:nth-child(4){width:120px;text-align:right;opacity:.45}
.kbm-table tr:last-child td{border-bottom:none}
.kbm-name{font-weight:500}
.kbm-priv{font-size:11px;opacity:.4;margin-left:6px}
.kbm-num{text-align:right;font-variant-numeric:tabular-nums;opacity:.75;white-space:nowrap}
.kbm-time{text-align:right;opacity:.45;white-space:nowrap;font-size:12px}
.kbm-file{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05);display:flex;gap:12px;
  align-items:baseline;cursor:copy;border-radius:4px}
.kbm-file:hover{background:rgba(255,255,255,.05)}
.kbm-file-path{flex:1;word-break:break-all}
.kbm-file-meta{opacity:.4;font-size:12px;white-space:nowrap}
.kbm-empty{opacity:.4;padding:20px 0}
.kbm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:8px 16px;
  border-radius:8px;background:rgba(0,0,0,.82);color:#fff;font-size:12px;pointer-events:none;z-index:99}
/* §四 顶栏页签新增 */
.kbm.mono,.kbm-sub.mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.kbm-badge{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(120,190,120,.16);
  color:rgba(160,225,160,.95);border:1px solid rgba(120,190,120,.28)}
.kbm-badge.bad{background:rgba(230,140,140,.14);color:rgba(245,175,175,.95);border-color:rgba(230,140,140,.3)}
.kbm-chips{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px}
.kbm-chip{display:flex;flex-direction:column;gap:1px;padding:6px 10px;border-radius:7px;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);min-width:120px}
.kbm-chip.ok{border-color:rgba(120,190,120,.3)}
.kbm-chip.bad{border-color:rgba(230,140,140,.34)}
.kbm-chip-k{font-size:11px;opacity:.42}
.kbm-chip-v{font-size:12px}
.kbm-stat-sub{font-size:11px;opacity:.35}
.kbm-scope{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.kbm-tab{padding:3px 10px;font-size:12px;border-radius:999px;cursor:pointer;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:inherit}
.kbm-tab.on{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.24)}
.kbm-search{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.kbm-pager{display:flex;gap:8px;margin-top:10px}
.kbm-issue{padding:6px 8px;border-radius:6px;background:rgba(230,170,90,.07);
  border:1px solid rgba(230,170,90,.2);margin-bottom:6px}
.kbm-issue-head{display:flex;align-items:baseline;gap:8px;cursor:pointer}
.kbm-issue-dot{width:6px;height:6px;border-radius:50%;background:rgba(240,190,110,.9);flex-shrink:0}
.kbm-issue-label{flex:1}
.kbm-issue-toggle{font-size:11px;opacity:.5;white-space:nowrap}
.kbm-issue-detail{font-size:12px;opacity:.62;padding:6px 0 2px 14px;line-height:1.6}
/* 自定义流程（知识库页签内的二级页签） */
.kbf-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
.kbf-tab{padding:4px 12px;border-radius:999px;cursor:pointer;font-size:12px;background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.1);color:inherit}
.kbf-tab.on{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.26)}
.kbf-row{display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);flex-wrap:wrap}
.kbf-name{font-weight:500;min-width:170px}
.kbf-trig{font-size:12px;opacity:.75}
.kbf-desc{font-size:12px;opacity:.55;flex:1;min-width:150px;word-break:break-all}
.kbf-state{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.16);opacity:.8}
.kbf-state.on{color:rgba(160,225,160,.95);border-color:rgba(120,190,120,.35)}
.kbf-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.kbf-field > label{font-size:12px;opacity:.55}
.kbf-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.kbf-step{padding:8px 10px;border:1px solid rgba(255,255,255,.1);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,.03)}
.kbf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.kbf-run{padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);margin:8px 0}
.kbf-run-row{font-size:12px;opacity:.75}
.kbf-ta{width:100%;box-sizing:border-box;min-height:58px;padding:6px 9px;font-size:12.5px;line-height:1.5;color:inherit;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;outline:none;resize:vertical;
  font-family:inherit}
.kbf-hr{height:1px;background:rgba(255,255,255,.08);margin:14px 0}
.kbc-parse-dev{pointer-events:none;user-select:none}
.kbc-parse-dev > *:not(.kbc-parse-dev-note){opacity:.45}
.kbc-parse-dev-note{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(255,190,90,.14);border:1px solid rgba(255,190,90,.42);color:rgba(255,206,132,.98);font-size:12.5px;line-height:1.7;font-weight:600;opacity:1}
/* 解析服务（OCR / ASR）：行优先，不用卡片，无动画 */
.kbc-parse-list{display:flex;flex-direction:column;gap:6px}
.kbc-parse-row{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.09)}
.kbc-parse-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.kbc-parse-id{font-weight:500;word-break:break-all}
.kbc-parse-meta{font-size:12px;opacity:.6;word-break:break-all}
.kbc-parse-badge{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.09);opacity:.85}
.kbc-parse-badge.off{opacity:.45}
.kbc-parse-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.kbc-parse-inline{width:210px;box-sizing:border-box;padding:4px 8px;font-size:12px;line-height:1.4;color:inherit;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;outline:none}
.kbc-parse-inline::placeholder{color:rgba(255,255,255,.32)}
.kbc-parse-inline:focus{border-color:rgba(255,255,255,.34)}
.kbc-parse-form{display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-radius:8px;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12)}
.kbc-parse-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kbc-parse-field{display:flex;flex-direction:column;gap:3px}
.kbc-parse-field > label{font-size:12px;opacity:.55}
.kbc-parse-err{font-size:12px;color:rgba(245,175,175,.95)}
.kbc-parse-ok{font-size:12px;color:rgba(160,225,160,.95)}
/* ── 主题适配（2026-10-18）────────────────────────────────────────────
   上面这套配色原本按深色主题写死：用「白色低透明度」当底色与描边、用浅色文字当前景。
   宿主的浅色主题不会给 body 挂 [data-ds-dark-theme]，于是白底与白字互相吃掉。
   下面只给浅色主题一套深色系覆盖；深色主题完全沿用上面的原值，一个像素都不改。
   宿主自带 --dsw-* 令牌，但语义没有逐个核实，这里用确定值，避免再猜错一次。 */
body:not([data-ds-dark-theme]) .kbc-set-input,
body:not([data-ds-dark-theme]) .kbf-ta,
body:not([data-ds-dark-theme]) .kbc-parse-inline{background:rgba(0,0,0,.035);border-color:rgba(0,0,0,.16);color:rgba(0,0,0,.88)}
body:not([data-ds-dark-theme]) .kbc-set-input::placeholder,
body:not([data-ds-dark-theme]) .kbc-parse-inline::placeholder{color:rgba(0,0,0,.38)}
body:not([data-ds-dark-theme]) .kbc-set-input:focus,
body:not([data-ds-dark-theme]) .kbc-parse-inline:focus{border-color:rgba(0,0,0,.42);box-shadow:0 0 0 2px rgba(0,0,0,.06)}
body:not([data-ds-dark-theme]) .kbc-btn-primary{background:#1a1a1a;color:#fff}
body:not([data-ds-dark-theme]) .kbc-btn-primary:hover:enabled{background:#333}
body:not([data-ds-dark-theme]) .kbc-btn-primary:active:enabled{background:#000}
body:not([data-ds-dark-theme]) .kbc-btn-ghost{color:rgba(0,0,0,.86);background:rgba(0,0,0,.045);border-color:rgba(0,0,0,.16)}
body:not([data-ds-dark-theme]) .kbc-btn-ghost:hover:enabled{background:rgba(0,0,0,.08);border-color:rgba(0,0,0,.24)}
body:not([data-ds-dark-theme]) .kbc-btn-ghost:active:enabled{background:rgba(0,0,0,.12)}
/* 卡片 / 列表容器：浅色下用轻微灰底 + 深一点描边 */
body:not([data-ds-dark-theme]) .kbc-set-plan,
body:not([data-ds-dark-theme]) .kbc-parse-form,
body:not([data-ds-dark-theme]) .kbc-parse-row,
body:not([data-ds-dark-theme]) .kbm-chip,
body:not([data-ds-dark-theme]) .kbf-step,
body:not([data-ds-dark-theme]) .kbf-run{background:rgba(0,0,0,.035);border-color:rgba(0,0,0,.12)}
/* 两组可点标签（页签）与徽标 */
body:not([data-ds-dark-theme]) .kbm-tab,
body:not([data-ds-dark-theme]) .kbf-tab{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.14)}
body:not([data-ds-dark-theme]) .kbm-tab.on,
body:not([data-ds-dark-theme]) .kbf-tab.on{background:rgba(0,0,0,.14);border-color:rgba(0,0,0,.28)}
body:not([data-ds-dark-theme]) .kbc-parse-badge{background:rgba(0,0,0,.08)}
body:not([data-ds-dark-theme]) .kbf-state{border-color:rgba(0,0,0,.18)}
body:not([data-ds-dark-theme]) .kbf-state.on{color:#1f7a33;border-color:rgba(31,122,51,.45)}
/* 分隔线 */
body:not([data-ds-dark-theme]) .kbm-table td,
body:not([data-ds-dark-theme]) .kbm-file,
body:not([data-ds-dark-theme]) .kbf-row{border-bottom-color:rgba(0,0,0,.09)}
body:not([data-ds-dark-theme]) .kbm-file:hover{background:rgba(0,0,0,.04)}
body:not([data-ds-dark-theme]) .kbf-hr{background:rgba(0,0,0,.12)}
/* 状态色：原值是深色主题下的浅绿 / 浅红 / 浅琥珀，浅色底上会糊 */
body:not([data-ds-dark-theme]) .kbm-badge{background:rgba(31,122,51,.1);color:#1f7a33;border-color:rgba(31,122,51,.35)}
body:not([data-ds-dark-theme]) .kbm-badge.bad{background:rgba(170,30,30,.09);color:#a51f1f;border-color:rgba(170,30,30,.34)}
body:not([data-ds-dark-theme]) .kbm-chip.ok{border-color:rgba(31,122,51,.4)}
body:not([data-ds-dark-theme]) .kbm-chip.bad{border-color:rgba(170,30,30,.4)}
body:not([data-ds-dark-theme]) .kbm-issue{background:rgba(190,120,20,.07);border-color:rgba(190,120,20,.3)}
body:not([data-ds-dark-theme]) .kbm-issue-dot{background:#b26a00}
body:not([data-ds-dark-theme]) .kbc-parse-err{color:#a51f1f}
body:not([data-ds-dark-theme]) .kbc-parse-ok{color:#1f7a33}
body:not([data-ds-dark-theme]) .kbc-parse-dev-note{background:rgba(255,150,0,.12);border-color:rgba(200,110,0,.5);color:#8a4a00}
/* ── 原生控件与下拉弹层：底色必须不透明（2026-10-18 追加）─────────────
   根因：控件底色原来是 rgba(255,255,255,.05) 这种半透明白。在页面里它叠在
   深色页面上，看着是「深色的」；但原生下拉列表是自带白底的独立弹层，
   同一个半透明白落在白底上就是白色，字又是浅色 → 白底白字。
   所以深色主题也必须给不透底底色，并用 color-scheme 让弹层跟着明暗画。 */
body[data-ds-dark-theme] .kbc-set-input,
body[data-ds-dark-theme] .kbf-ta,
body[data-ds-dark-theme] .kbc-parse-inline{background:#26262b;border-color:#3d3d45;color:#f2f2f5}
body[data-ds-dark-theme] .kbc-set-input::placeholder,
body[data-ds-dark-theme] .kbc-parse-inline::placeholder{color:#8b8b95}
body[data-ds-dark-theme] .kbc-set-input:focus,
body[data-ds-dark-theme] .kbc-parse-inline:focus{border-color:#5a5a66;box-shadow:0 0 0 2px rgba(255,255,255,.08)}
body[data-ds-dark-theme] .kbc-set-input,
body[data-ds-dark-theme] .kbf-run select,
body[data-ds-dark-theme] .kbm select{color-scheme:dark}
body[data-ds-dark-theme] .kbc-set-input option,
body[data-ds-dark-theme] .kbf-run option,
body[data-ds-dark-theme] .kbm option{background:#26262b;color:#f2f2f5}
body[data-ds-dark-theme] .kbc-btn-ghost{background:#2b2b32;border-color:#3d3d45}
body[data-ds-dark-theme] .kbc-btn-ghost:hover:enabled{background:#34343d;border-color:#4b4b57}
body[data-ds-dark-theme] .kbm-tab,
body[data-ds-dark-theme] .kbf-tab{background:#26262b;border-color:#3d3d45}
body[data-ds-dark-theme] .kbm-tab.on,
body[data-ds-dark-theme] .kbf-tab.on{background:#3c3c46;border-color:#55555f}
/* 浅色主题：同样不透底，弹层跟随浅色 */
body:not([data-ds-dark-theme]) .kbc-set-input,
body:not([data-ds-dark-theme]) .kbf-run select,
body:not([data-ds-dark-theme]) .kbm select{color-scheme:light}
body:not([data-ds-dark-theme]) .kbc-set-input option,
body:not([data-ds-dark-theme]) .kbf-run option,
body:not([data-ds-dark-theme]) .kbm option{background:#fff;color:#0f1115}
`

    function ensureStyle() {
      if (document.querySelector('style[data-plugin="kb-core"]')) return
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin', 'kb-core')
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function callApi(payload, method) {
      const response = await fetch('/kb-core/api', {
        method: method || 'POST',
        headers: { 'content-type': 'application/json' },
        body: (method || 'POST') === 'POST' ? JSON.stringify(payload) : undefined,
      })
      const text = await response.text()
      let data = null
      try { data = JSON.parse(text) } catch (err) { data = { ok: false, error: text.slice(0, 200) } }
      if (!response.ok) throw new Error((data && data.error) || ('HTTP ' + response.status))
      return data
    }

    // 重建索引：走宿主 op 'index-rebuild'，与模型工具 kb_check(rebuild=true) 同一条路径。
    // 设置页与顶栏页签各有一个按钮，都调这一个函数，避免两处语义漂移。
    async function rebuildIndex() {
      const data = await callApi({ op: 'index-rebuild' })
      // ok:false 时 data.error 是宿主给的可读原因（例如「扫描不完整（3 处错误），旧索引已保留」）
      if (!data || data.ok !== true) throw new Error((data && data.error) || '重建未成功')
      return data.result || {}
    }

    const fmtBytes = (n) => {
      if (typeof n !== 'number') return '-'
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
      return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
    }
    const fmtAgo = (iso) => {
      if (!iso) return '-'
      const d = Date.parse(iso)
      if (Number.isNaN(d)) return '-'
      const min = Math.floor((Date.now() - d) / 60000)
      if (min < 1) return '刚刚'
      if (min < 60) return min + ' 分钟前'
      const h = Math.floor(min / 60)
      if (h < 24) return h + ' 小时前'
      const day = Math.floor(h / 24)
      if (day < 30) return day + ' 天前'
      return new Date(d).toISOString().slice(0, 10)
    }

    function useToast() {
      const [msg, setMsg] = react.useState('')
      const timer = react.useRef(null)
      const show = react.useCallback((text) => {
        setMsg(text)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setMsg(''), 1600)
      }, [])
      react.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
      return [msg, show]
    }

    // ── 设置里的「个人知识库」──────────────────────────────────────
    // 两个主动作（本轮要求）：
    //   ①「选择知识库文件夹」——真正的系统文件夹对话框（可选已有、也可在其中新建）；
    //   ②「自动建库 / 识别」——选定后点一次，由服务端判断：空目录建库 / 本插件库接入 / 普通资料夹识别导入，
    //      元数据损坏或不兼容则明确提示且不覆盖。
    // 选择目录**只记录候选**；点主按钮才执行；验证可用后才切换当前库。
    function Section() {
      const [status, setStatus] = react.useState(null)
      const [dirs, setDirs] = react.useState(null)
      const [candidate, setCandidate] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [message, setMessage] = react.useState('')
      const [probe, setProbe] = react.useState(null)
      const [result, setResult] = react.useState(null)
      const [job, setJob] = react.useState(null)
      const [unfinished, setUnfinished] = react.useState([])
      const [pickerNote, setPickerNote] = react.useState('')
      const [rebuilding, setRebuilding] = react.useState(false)
      const [rebuildNote, setRebuildNote] = react.useState('')
      const dirtyRef = react.useRef(false)

      const refresh = react.useCallback(async (opts) => {
        const force = opts && opts.force === true
        try {
          const data = await callApi({ op: 'status' })
          setStatus(data.status)
          if (force || !dirtyRef.current) {
            if (data.status && data.status.kbPath) setCandidate(data.status.kbPath)
          }
        } catch (error) {
          setMessage('读取状态失败：' + String((error && error.message) || error))
        }
      }, [])

      const doRebuild = react.useCallback(async () => {
        setRebuilding(true)
        setRebuildNote('正在扫描并重建索引…（库大可稍等）')
        try {
          const r = await rebuildIndex()
          const bits = []
          if (r.entries !== null && r.entries !== undefined) bits.push('条目 ' + r.entries)
          // 不展示「索引状态」：checkEntry 的 counts 里没有这个字段，显示它等于凭空造状态。
          if (r.defects !== null && r.defects !== undefined) bits.push('缺陷 ' + r.defects)
          if (r.added || r.removed || r.changed) bits.push('差异 +' + (r.added || 0) + '/-' + (r.removed || 0) + '/~' + (r.changed || 0))
          if (r.elapsedMs) bits.push('用时 ' + r.elapsedMs + ' ms')
          setRebuildNote('索引已重建：' + (bits.join(' · ') || '完成'))
          await refresh({ force: false })
        } catch (err) {
          setRebuildNote('重建未成功：' + String((err && err.message) || err))
        } finally {
          setRebuilding(false)
        }
      }, [refresh])

      react.useEffect(() => {
        ensureStyle()
        refresh({ force: true })
        callApi({ op: 'dirs' }).then((d) => {
          if (!d || !d.ok) return
          setDirs(d.dirs)
          // 首次候选 = DSH 安装目录下的 KnowledgeBase；不可写就如实提示另选
          if (!d.dirs.bound) {
            setCandidate((prev) => (prev ? prev : d.dirs.defaultKnowledgeBase))
            setPickerNote(d.dirs.defaultWritable
              ? '未绑定。默认候选是 ' + d.dirs.defaultKnowledgeBase + '（点「自动建库 / 识别」会在那里新建标准知识库）。'
              : '默认候选 ' + d.dirs.defaultKnowledgeBase + ' 不可写：' + (d.dirs.defaultWritableReason || '') + '，请另选文件夹。')
          }
        }).catch(() => null)
      }, [refresh])

      // ① 选择文件夹：只记录候选位置，不绑定、不建库
      const pickDir = async () => {
        setBusy(true)
        setMessage('')
        try {
          const d = await callApi({ op: 'pick-dir' })
          if (d.ok && d.path) {
            dirtyRef.current = true
            setCandidate(String(d.path).replace(/\\/g, '/'))
            setProbe(null)
            setResult(null)
            setMessage('已记录候选文件夹：' + d.path + '。确认无误后点「自动建库 / 识别」。')
          } else if (d.ok && d.canceled) {
            setMessage('已取消选择（候选未改变）')
          } else {
            setPickerNote((d.note || '目录选择器不可用') + (d.capability ? '（capability=' + d.capability + '）' : ''))
            setMessage('未能打开系统文件夹对话框：可直接在下面粘贴绝对路径。')
          }
        } catch (err) {
          setPickerNote('目录选择器不可用：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      // ② 自动建库 / 识别：一次点击，服务端决定动作
      const doSetup = async () => {
        const target = candidate.trim()
        if (target === '') return
        setBusy(true)
        setMessage('')
        setResult(null)
        setJob(null)
        try {
          const p = await callApi({ op: 'probe-folder', path: target })
          setProbe(p && p.folder ? p.folder : null)
          const s = await callApi({ op: 'setup', path: target })
          setResult(s)
          if (s.ok && s.action === 'import-started') {
            setJob({ importId: s.importId, stage: 'importing', counts: s.counts })
            setMessage('已建标准结构，开始导入 ' + (s.counts ? s.counts.total : 0) + ' 个源文件（原件只读不动；可中断、可重试）')
          } else if (s.ok) {
            setMessage(s.action === 'created' ? '空目录：已新建标准知识库并切换为当前库' : '已接入既有库（保留 kbId 与资料）')
            dirtyRef.current = false
          } else {
            setMessage('未执行：' + (s.note || s.failed || '未知原因'))
          }
          await refresh({ force: false })
        } catch (error) {
          setMessage('执行失败：' + String((error && error.message) || error))
        } finally {
          setBusy(false)
        }
      }

      // R7：进入页面时列出**未完成**的导入任务（import-status 不带 id），并提供"继续/重试"。
      // 旧实现只在本次会话里 setJob 过才有进度条；重进页面就丢，未完成任务再也找不到。
      const loadUnfinished = react.useCallback(async () => {
        try {
          const d = await callApi({ op: 'import-status' })
          if (!d || d.ok !== true || !Array.isArray(d.imports)) return
          setUnfinished(d.imports.filter((m) => m.stage !== 'done' && m.stage !== 'canceled'))
        } catch {
          /* 列任务失败不影响主界面 */
        }
      }, [])
      react.useEffect(() => {
        loadUnfinished()
      }, [loadUnfinished])

      // 导入进度：只在有任务时轮询；**终态（done/partial/failed/canceled/conflict）立即停表**。
      // R7：effect 依赖 [jobId, stage]，终态清 interval（旧实现只依赖 jobId，跑完还在轮询）。
      const jobId = job && job.importId ? job.importId : ''
      const jobStage = job && job.stage ? job.stage : ''
      const TERMINAL_STAGE = { done: 1, partial: 1, failed: 1, canceled: 1, conflict: 1 }
      react.useEffect(() => {
        if (jobId === '') return undefined
        if (TERMINAL_STAGE[jobStage] === 1) return undefined
        let stop = false
        let timer = null
        const tick = async () => {
          try {
            const d = await callApi({ op: 'import-status', importId: jobId })
            if (stop) return
            if (d && d.ok) {
              setJob((prev) => ({ ...(prev || {}), ...d }))
              if (TERMINAL_STAGE[d.stage] === 1) {
                if (timer) clearInterval(timer)
                loadUnfinished()
              }
            }
          } catch {
            /* 轮询失败不打断界面 */
          }
        }
        tick()
        timer = setInterval(tick, 1500)
        return () => { stop = true; if (timer) clearInterval(timer) }
      }, [jobId, jobStage, loadUnfinished])

      const cancelImport = async () => {
        if (!jobId) return
        try {
          await callApi({ op: 'import-cancel', importId: jobId })
          setMessage('已请求中止：当前这条处理完就停（已完成的条目保留，可重试补完）')
        } catch (error) {
          setMessage('取消失败：' + String((error && error.message) || error))
        }
      }

      // R7：重进页面后也能"继续/重试"未完成任务
      const resumeJob = async (id) => {
        if (!id) return
        setBusy(true)
        try {
          const d = await callApi({ op: 'import-run', importId: id })
          if (d && d.ok) {
            setJob({ importId: id, stage: d.stage || 'running', counts: null })
            setResult({ action: 'import-started' })
            setMessage('已继续该任务：只补未完成的条目，不会重复建条目')
          } else {
            setMessage('继续失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (error) {
          setMessage('继续失败：' + String((error && error.message) || error))
        } finally {
          setBusy(false)
        }
      }

      const row = (label, value) => e('div', { className: 'kbc-set-row' },
        e('span', { className: 'kbc-set-key' }, label),
        e('span', { className: 'kbc-set-val' }, String(value)))

      const entryCount = status && status.counts && typeof status.counts.entries === 'number' ? status.counts.entries : null
      const indexStale = !!(status && status.index && status.index.fresh === false)
      const build = status && status.build ? status.build : null
      const currentKb = status && status.kbPath ? status.kbPath : ''
      const pending = candidate.trim() !== '' && candidate.trim() !== currentKb
      const canSetup = !busy && candidate.trim() !== ''
      const kindLabel = (kind) => ({
        empty: '空目录（将新建标准知识库）',
        ours: '本插件已有的库（验证后接入，保留 kbId 与资料）',
        'ours-partial': '本插件未初始化完成的库（先补齐再接入）',
        foreign: '普通资料文件夹（识别结构后分类导入并接入）',
        corrupt: '元数据损坏（不覆盖，需人工处理）',
        incompatible: '元数据版本不兼容（不覆盖）',
        missing: '目录不存在',
        'not-a-directory': '不是文件夹',
        unknown: '尚未识别',
      }[kind] || kind)
      const jc = (job && job.counts) || {}

      return e('div', { className: 'kbc-set' },
        e('div', { className: 'kbc-set-intro' }, '知识库由 kb-core 插件管理；设置页、顶栏页签与模型工具共用同一份配置与同一套后端流程。'),

        // ── 当前使用的知识库 ──
        e('div', { className: 'kbc-set-h' }, '当前使用的知识库'),
        e('div', { className: 'kbc-set-info' },
          row('路径', currentKb || '(未绑定)'),
          row('库身份', status && status.kbId ? String(status.kbId).slice(0, 8) : '-'),
          row('配置', status && status.config ? (status.config.ok ? '正常（revision ' + (status.config.revision ?? '-') + '）' : '降级：' + (status.config.state || '未知')) : '-'),
          row('库结构', status ? (status.healthy ? '正常' : '异常（' + (status.healthReason || '未知') + '）') : '-'),
          row('索引', status && status.index ? (status.index.fresh ? '新鲜' : '需重建（' + (status.index.reason || '未知') + '）') : '-'),
          row('条目数（索引）', entryCount === null ? '-' : entryCount),
          row('构建', build && build.buildId ? build.version + ' / ' + build.buildId : '-'),
          row('状态目录', status ? (status.stateDir || '-') : '-')),
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => refresh({ force: true }) }, '刷新状态'),
          e('button', {
            className: 'kbc-btn ' + (indexStale ? 'kbc-btn-primary' : 'kbc-btn-ghost'),
            disabled: busy || rebuilding || !status || !currentKb,
            onClick: doRebuild,
            title: '重新扫描并写入索引（等价于 kb_check(rebuild=true)）',
          }, rebuilding ? '重建中…' : (indexStale ? '重建索引（当前需重建）' : '重建索引'))),
        rebuildNote ? e('div', { className: 'kbc-set-msg' }, rebuildNote) : null,

        // ── 待处理文件夹 ──
        e('div', { className: 'kbc-set-h' }, '待处理的文件夹'),
        e('input', {
          className: 'kbc-set-input',
          value: candidate,
          placeholder: '选一个文件夹：可以是空目录、已有知识库，或普通资料文件夹',
          spellCheck: false,
          onChange: (ev) => { dirtyRef.current = true; setCandidate(ev.target.value); setProbe(null); setResult(null) },
        }),
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: pickDir }, busy ? '处理中…' : '选择知识库文件夹'),
          e('button', { className: 'kbc-btn kbc-btn-primary', disabled: !canSetup, onClick: doSetup }, busy ? '执行中…' : '自动建库 / 识别')),
        e('div', { className: 'kbc-set-hint' },
          pending
            ? '这是**待处理**的候选文件夹：点「自动建库 / 识别」才会执行；执行前不会改动它，也不会切换当前库。'
            : '选目录只记录位置，不建库、不切换；点第二个按钮才执行一次判断。'),
        probe ? e('div', { className: 'kbc-set-plan' },
          e('div', { className: 'kbc-set-key' }, '识别结果：' + kindLabel(probe.kind)),
          e('div', { className: 'kbc-set-hint' }, '文件 ' + probe.files + ' · 目录 ' + probe.dirs + ' · 可写=' + (probe.writable ? '是' : '否') + (probe.reasons && probe.reasons.length ? ' · ' + probe.reasons.join('；') : ''))) : null,
        message ? e('div', { className: 'kbc-set-msg' }, message) : null,
        jobId !== '' || unfinished.length > 0 ? e('div', { className: 'kbc-set-plan' },
          e('div', { className: 'kbc-set-key' }, jobId !== ''
            ? '导入进度（' + (job && job.stage ? job.stage : '准备中') + '）'
            : '未完成的导入任务（' + unfinished.length + '）'),
          jobId !== '' ? e('div', { className: 'kbc-set-hint' },
            '成功 ' + (jc.done ?? 0) + ' · 待处理 ' + (jc.pending ?? 0) + ' · 失败 ' + (jc.failed ?? 0) + ' · 跳过 ' + (jc.skipped ?? 0) + '（源文件 ' + (jc.total ?? 0) + '）；待解析/待识别 ' + (jc.waiting ?? 0)
            + (job && job.target ? '；目标：' + job.target : '')
            + (job && job.commitReason === 'binding-changed' ? '；**导入已完成但当前库已被切换，未覆盖你的选择**' : '')) : null,
          job && job.recent && job.recent.length > 0
            ? e('div', { className: 'kbc-set-hint' }, '失败项（可重试）：' + job.recent.slice(0, 5).map((r) => r.rel + '（' + r.error + '）').join('；'))
            : null,
          job && job.terminalReasons && job.terminalReasons.length > 0
            ? e('div', { className: 'kbc-set-hint' }, '未完成原因：' + job.terminalReasons.join('；'))
            : null,
          jobId !== '' ? e('div', { className: 'kbc-set-actions' },
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: !job || job.running === false, onClick: cancelImport }, '中止导入'),
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy || (job && job.running === true), onClick: () => resumeJob(jobId) }, '重试未完成')) : null,
          unfinished.filter((m) => m.importId !== jobId).slice(0, 5).map((m) => e('div', { className: 'kbc-set-hint', key: m.importId },
            m.importId + ' · ' + m.stage + ' · 成功 ' + ((m.counts && m.counts.done) || 0) + ' / 源文件 ' + ((m.counts && m.counts.total) || 0) + ' · ',
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => resumeJob(m.importId) }, '继续/重试')))
        ) : null,

        // ── 解析服务（OCR / ASR）──
        // 放在导入进度之后：导入把文件收进来，解析把它们变成可检索的文本。
        e(ParseSection, { initialImportId: jobId }),
        pickerNote ? e('div', { className: 'kbc-set-hint' }, pickerNote) : null)
    }

    // ── 顶栏页签「知识库」（审查意见 §四）─────────────────────────────
    // 只消费宿主的一份统一快照：身份 / 运行状态 / 分层计数 / 异常待办 / 分区 / 全量清单。
    // 规则：未知显示「未知」不显示「正常」；页面隐藏时暂停刷新；刷新只读、不绑定不建库不重建。
    const REFRESH_MS = 30000
    function Overview() {
      const [data, setData] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const [error, setError] = react.useState('')
      const [openIssue, setOpenIssue] = react.useState('')
      const [scope, setScope] = react.useState({ prefix: '', q: '' })
      const [list, setList] = react.useState(null)
      const [rebuilding, setRebuilding] = react.useState(false)
      const [toast, showToast] = useToast()
      // R7：概览与清单**各自**一个请求序号 + 快照版本。
      // 旧实现共用一个 seqRef：清单请求会递增它，导致概览响应被丢弃、finally 清不掉 busy（页面卡在"读取中"）。
      const overviewSeqRef = react.useRef(0)
      const filesSeqRef = react.useRef(0)
      const versionRef = react.useRef(null)
      const inflightRef = react.useRef(false)

      const load = react.useCallback(async (opts) => {
        // 合并重复请求：定时刷新/手动刷新/可见事件同时触发时只发一次
        if (inflightRef.current) return
        inflightRef.current = true
        const seq = ++overviewSeqRef.current
        setBusy(true)
        setError('')
        try {
          const d = await callApi({ op: 'overview', fresh: opts && opts.fresh === true })
          if (seq !== overviewSeqRef.current) return // 有更新的概览请求在路上 → 丢弃这次
          const ov = d.overview
          setData(ov)
          const ver = ov && ov.version ? ov.version : null
          if (versionRef.current !== null && ver !== null && ver !== versionRef.current) {
            // 换库/换配置：旧清单属于上一个库，必须清掉（否则会拼出指向错库的路径）
            setList(null)
            setScope({ prefix: '', q: '' })
            filesSeqRef.current += 1 // 在途的清单响应一并作废
            showToast('当前知识库已切换，列表已清空')
          }
          versionRef.current = ver
        } catch (err) {
          if (seq === overviewSeqRef.current) setError('读取失败：' + String((err && err.message) || err))
        } finally {
          // 所有路径都必须释放 busy：只有"自己仍是最新概览请求"才清（否则交给更新的那次）
          if (seq === overviewSeqRef.current) setBusy(false)
          inflightRef.current = false
        }
      }, [showToast])

      const doRebuild = react.useCallback(async () => {
        setRebuilding(true)
        try {
          const r = await rebuildIndex()
          const bits = []
          if (r.entries !== null && r.entries !== undefined) bits.push('条目 ' + r.entries)
          // 同上：不展示不存在的 indexState 字段。
          if (r.defects !== null && r.defects !== undefined) bits.push('缺陷 ' + r.defects)
          if (r.elapsedMs) bits.push('用时 ' + r.elapsedMs + ' ms')
          showToast('索引已重建：' + (bits.join(' · ') || '完成'))
          await load({ fresh: true })
        } catch (err) {
          showToast('重建未成功：' + String((err && err.message) || err))
        } finally {
          setRebuilding(false)
        }
      }, [load, showToast])

      const loadFiles = react.useCallback(async (prefix, query, offset) => {
        const seq = ++filesSeqRef.current
        const overviewVersion = versionRef.current
        try {
          const d = await callApi({ op: 'files', prefix, q: query, offset: offset || 0, limit: 100 })
          if (seq !== filesSeqRef.current) return // 更新的范围已经发出，别让旧响应覆盖
          if (d.ok === false) {
            setList({ error: d.error || '读取失败', files: [], total: 0, prefix, q: query, offset: 0, root: d.root || '' })
            return
          }
          // R7：清单必须与当前概览是同一份快照；不一致就拒绝显示（不能只靠 list.root 修复制路径）
          if (d.version && overviewVersion && d.version !== overviewVersion) {
            setList({ error: '列表快照与当前概览不一致（知识库已切换或配置已变）：已拒绝显示，请点「刷新」', files: [], total: 0, prefix, q: query, offset: 0, root: d.root || '' })
            showToast('知识库已切换：请刷新后再看清单')
            return
          }
          setList({ ...d, prefix, q: query })
        } catch (err) {
          if (seq !== filesSeqRef.current) return
          setList({ error: String((err && err.message) || err), files: [], total: 0, prefix, q: query, offset: 0, root: '' })
        }
      }, [showToast])
      react.useEffect(() => {
        ensureStyle()
        load()
        // 可见时轻量刷新，隐藏时暂停（不每隔几秒全库扫描）
        const timer = setInterval(() => { if (!document.hidden) load() }, REFRESH_MS)
        const onVis = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', onVis)
        return () => {
          overviewSeqRef.current += 1 // 卸载后任何在途响应都作废
          filesSeqRef.current += 1
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVis)
        }
      }, [load])

      // S5：复制路径用**这一行所属快照的根**（list.root），不拿当前全局 identity 拼旧列表的相对路径
      const copyPath = async (rel, rootIn) => {
        const root = String(rootIn || (data && data.identity && data.identity.kbPath) || '').replace(/\\/g, '/').replace(/\/$/, '')
        const full = root ? root + '/' + rel : rel
        try { await navigator.clipboard.writeText(full); showToast('已复制路径') } catch { showToast(full) }
      }

      if (error) {
        return e('div', { className: 'kbm' },
          e('div', { className: 'kbm-head' }, e('span', { className: 'kbm-title' }, '知识库')),
          e('div', { className: 'kbm-empty' }, error),
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: load }, '重试'))
      }
      if (!data) return e('div', { className: 'kbm' }, e('div', { className: 'kbm-empty' }, '正在读取状态…'))

      const id = data.identity || {}
      const run = data.run || {}
      const layers = data.layers || {}
      const issues = data.issues || []
      const scanStatus = (run.scan && run.scan.status) || 'unknown'
      const scanNote = (() => {
        if (scanStatus === 'missing') return '路径不存在或已失效：' + (id.kbPath || '') + '（到设置里重新绑定）'
        if (scanStatus === 'denied') return '无权限读取：' + (id.kbPath || '')
        if (scanStatus === 'not-a-directory') return '该路径不是目录：' + (id.kbPath || '')
        if (scanStatus === 'partial') return '扫描不完整（' + ((run.scan && run.scan.errors) || 0) + ' 处错误），下列数字只覆盖读到的部分'
        if (scanStatus === 'empty') return '目录可读，但没有可统计的文件'
        if (scanStatus === 'unbound') return '还没有绑定知识库'
        return ''
      })()
      const chip = (label, ok, detail) => e('div', { className: 'kbm-chip' + (ok === true ? ' ok' : ok === false ? ' bad' : '') },
        e('span', { className: 'kbm-chip-k' }, label),
        e('span', { className: 'kbm-chip-v' }, detail))
      const statCell = (label, value, sub) => e('div', { className: 'kbm-stat' },
        e('span', { className: 'kbm-stat-num' }, value),
        e('span', { className: 'kbm-stat-label' }, label),
        sub ? e('span', { className: 'kbm-stat-sub' }, sub) : null)

      const openScope = (prefix) => { setScope({ prefix, q: '' }); loadFiles(prefix, '') }

      return e('div', { className: 'kbm' },
        // 1) 库身份
        e('div', { className: 'kbm-head' },
          e('span', { className: 'kbm-title' }, id.name || '知识库'),
          e('span', { className: 'kbm-badge' }, id.mode === 'read-write' ? '读写库' : '只读观察库'),
          id.bound ? null : e('span', { className: 'kbm-badge bad' }, '未绑定'),
          e('span', { className: 'kbm-sub mono' }, id.kbPath || '(未绑定)'),
          id.kbIdShort ? e('span', { className: 'kbm-sub mono' }, 'kbId ' + id.kbIdShort) : null,
          e('button', {
            className: 'kbc-btn kbc-btn-ghost',
            style: { marginLeft: 'auto', padding: '3px 10px', fontSize: 12 },
            disabled: busy,
            onClick: load,
          }, busy ? '读取中…' : '刷新')),
        e('div', { className: 'kbm-sub', style: { marginTop: 2 } },
          '扫描于 ' + fmtAgo(run.scan && run.scan.at) + ' · 用时 ' + ((run.scan && run.scan.elapsedMs) || 0) + ' ms · 页面可见时每 ' + (REFRESH_MS / 1000) + ' 秒刷新（隐藏即暂停）'),
        scanNote ? e('div', { className: 'kbc-set-msg', style: { margin: '6px 0' } }, scanNote) : null,

        // 2) 运行状态条（未知就是未知）
        e('div', { className: 'kbm-chips' },
          chip('配置', run.config ? run.config.ok : null, run.config && run.config.ok ? '正常' : ('降级：' + ((run.config && run.config.reason) || '未知'))),
          chip('索引', run.index ? run.index.fresh : null, run.index && run.index.fresh === true ? '新鲜' : (run.index ? ('需重建：' + (run.index.reason || '未知')) : '未知')),
          chip('上次检查', null, run.lastCheck && run.lastCheck.known === false ? '未知（本版未落盘时间线）' : (run.lastCheck ? '已知' : '未知')),
          chip('扫描', scanStatus === 'ok' ? true : scanStatus === 'empty' ? null : false, scanStatus === 'ok' ? '完整' : (scanStatus === 'empty' ? '空目录' : scanStatus))),

        // 2b) 索引需重建时，这里给一个能点的按钮（否则用户只能去找 agent）
        e('div', { className: 'kbc-set-actions', style: { marginTop: 10 } },
          e('button', {
            className: 'kbc-btn ' + (run.index && run.index.fresh === false ? 'kbc-btn-primary' : 'kbc-btn-ghost'),
            disabled: busy || rebuilding,
            onClick: doRebuild,
            title: '重新扫描并写入索引（等价于 kb_check(rebuild=true)）',
          }, rebuilding ? '重建索引中…' : (run.index && run.index.fresh === false ? '重建索引（当前需重建）' : '重建索引'))),

        // 3) 分层计数（不能把总文件数当条目数）
        e('div', { className: 'kbm-stats' },
          statCell('知识条目', layers.entries === null ? '未知' : String(layers.entries), layers.entriesInIndex === undefined || layers.entriesInIndex === null ? '知识层 .md' : ('索引 ' + layers.entriesInIndex)),
          statCell('原件附件', String(layers.originals ?? 0), '90-收件箱'),
          statCell('底稿', String(layers.drafts ?? 0), '50-底稿'),
          statCell('全部文件', String(layers.filesAll ?? 0), fmtBytes(layers.bytesAll))),
        e('div', { className: 'kbc-set-hint' }, layers.note || ''),

        // 4) 异常与待办
        e('div', { className: 'kbm-h' }, '异常与待办' + (issues.length > 0 ? '（' + issues.length + '）' : '')),
        issues.length === 0
          ? e('div', { className: 'kbm-empty' }, '没有需要处理的项')
          : issues.map((it) => e('div', { key: it.kind, className: 'kbm-issue' },
            e('div', { className: 'kbm-issue-head', onClick: () => setOpenIssue(openIssue === it.kind ? '' : it.kind) },
              e('span', { className: 'kbm-issue-dot' }),
              e('span', { className: 'kbm-issue-label' }, it.label),
              e('span', { className: 'kbm-issue-toggle' }, openIssue === it.kind ? '收起' : '看范围')),
            openIssue === it.kind ? e('div', { className: 'kbm-issue-detail' }, it.detail) : null)),

        // 5) 全量内容入口：分区 → 文件清单（分页 + 搜索）
        e('div', { className: 'kbm-h' }, '内容入口'),
        e('div', { className: 'kbm-scope' },
          e('button', { className: 'kbm-tab' + (scope.prefix === '' ? ' on' : ''), onClick: () => openScope('') }, '全部'),
          (data.sections || []).map((s) => e('button', {
            key: s.name,
            className: 'kbm-tab' + (scope.prefix === s.name ? ' on' : ''),
            title: String(s.files) + ' 个文件',
            onClick: () => openScope(s.name),
          }, s.name + ' ' + s.files))),
        e('div', { className: 'kbm-search' },
          e('input', {
            className: 'kbc-set-input',
            value: scope.q,
            placeholder: '在这个范围内按文件名筛选（空 = 全部）',
            spellCheck: false,
            onChange: (ev) => setScope({ prefix: scope.prefix, q: ev.target.value }),
            onKeyDown: (ev) => { if (ev.key === 'Enter') loadFiles(scope.prefix, scope.q, 0) },
          }),
          e('button', { className: 'kbc-btn kbc-btn-ghost kbm-nowrap', onClick: () => loadFiles(scope.prefix, scope.q, 0) }, '筛选')),
        list === null
          ? e('div', { className: 'kbm-empty' }, '点上面的分区或「筛选」列出文件（只读；单次最多 100 行，可翻页）')
          : list.error
            ? e('div', { className: 'kbm-empty' }, list.error)
            : e('div', null,
              e('div', { className: 'kbm-sub' },
                '范围 ' + (list.prefix === '' ? '全库' : list.prefix) + (list.q ? ' · 关键词「' + list.q + '」' : '') +
                ' · 命中 ' + list.total + ' 个 · 显示 ' + (list.total === 0 ? 0 : list.offset + 1) + '–' + (list.offset + list.files.length) +
                (list.truncated ? '（清单被截断：' + (list.truncated.reason || '上限') + '，当前只覆盖到截断点）' : '') +
                (list.coverage ? ' · 枚举 ' + list.coverage.files + ' 个文件/最深 ' + list.coverage.depth + ' 层' + (list.coverage.errors ? '，' + list.coverage.errors + ' 处枚举错误' : '') : '')),
              list.masked && list.privateTotal > 0
                ? e('div', { className: 'kbc-set-msg', style: { margin: '4px 0 8px' } },
                  '另有 ' + list.privateTotal + ' 个文件在隐私分区：只计数、不列名、也不能按名字筛出来（首版不提供「列出明文」的开关）。要看具体文件请在系统资源管理器里打开该分区目录。')
                : null,
              list.files.length === 0
                ? e('div', { className: 'kbm-empty' }, '这个范围内没有匹配的文件')
                : list.files.map((f) => e('div', {
                  key: f.path,
                  className: 'kbm-file',
                  title: '点击复制完整路径',
                  onClick: () => copyPath(f.path, list.root),
                },
                e('span', { className: 'kbm-file-path' }, f.path),
                e('span', { className: 'kbm-file-meta' }, fmtBytes(f.bytes) + ' · ' + fmtAgo(new Date(f.mtimeMs).toISOString())))),
              e('div', { className: 'kbm-pager' },
                e('button', {
                  className: 'kbc-btn kbc-btn-ghost',
                  disabled: list.offset <= 0,
                  onClick: () => loadFiles(list.prefix, list.q, Math.max(0, list.offset - list.limit)),
                }, '上一页'),
                e('button', {
                  className: 'kbc-btn kbc-btn-ghost',
                  disabled: list.offset + list.files.length >= list.total,
                  onClick: () => loadFiles(list.prefix, list.q, list.offset + list.limit),
                }, '下一页'))),

        // 6) 最近变更（只是入口之一）
        e('div', { className: 'kbm-h' }, '最近变更'),
        (data.recent || []).length === 0
          ? e('div', { className: 'kbm-empty' }, '没有可显示的变更（隐私分区不进入此列表）')
          : (data.recent || []).map((f) => e('div', {
            key: f.path,
            className: 'kbm-file',
            title: '点击复制完整路径',
            onClick: () => copyPath(f.path, id.kbPath),
          },
          e('span', { className: 'kbm-file-path' }, f.path),
          e('span', { className: 'kbm-file-meta' }, fmtBytes(f.bytes) + ' · ' + fmtAgo(f.mtime)))),

        e('div', { className: 'kbc-set-hint', style: { marginTop: 16 } },
          '只读：本页不写文件、不建索引、不改绑定。「刷新」只是重新扫一次磁盘（同一份快照在 8 秒内复用，不会重复扫）。隐私分区只计数、不列文件名。'),
        toast ? e('div', { className: 'kbm-toast' }, toast) : null)
    }

    // ── 自定义流程：知识库页签内的二级页签 ─────────────────────────────
    // 与模型工具、设置页走**同一组** /kb-core/api 的 flows.* op（不新开端口）。
    // 交互底线：运行中显示步骤进度与取消按钮；取消后状态真的转 canceled（不是只隐藏 UI）。
    const FLOW_TERMINAL = { done: 1, landed: 1, failed: 1, canceled: 1 }
    const FLOW_KINDS = ['知识', '项目', '人物', '素材', '画像']
    const splitList = (s) => String(s || '').split(/[，,、;；\n]/).map((x) => x.trim()).filter((x) => x !== '')

    const emptyDraft = () => ({
      isNew: true,
      id: '',
      expectedRevision: null,
      name: '',
      triggersText: '',
      description: '',
      params: [],
      steps: [{ id: 's1', title: '', instruction: '', capability: '' }],
      outputRules: { land: true, kind: '知识', tags: '', dir: '', tz: 'Asia/Shanghai', windowDays: 7 },
      enabled: true,
    })

    const draftOf = (flow) => ({
      isNew: false,
      id: flow.id,
      expectedRevision: flow.revision,
      name: flow.name,
      triggersText: (flow.triggers || []).join('，'),
      description: flow.description || '',
      params: (flow.params || []).map((p) => ({ name: p.name, default: p.default === undefined ? '' : String(p.default), required: p.required === true })),
      steps: (flow.steps || []).map((s, i) => ({ id: s.id || 's' + (i + 1), title: s.title || '', instruction: s.instruction || '', capability: s.capability || '' })),
      outputRules: {
        land: flow.outputRules ? flow.outputRules.land === true : true,
        kind: flow.outputRules ? flow.outputRules.kind || '知识' : '知识',
        tags: flow.outputRules && Array.isArray(flow.outputRules.tags) ? flow.outputRules.tags.join('，') : '',
        dir: flow.outputRules ? flow.outputRules.dir || '' : '',
        tz: flow.outputRules ? flow.outputRules.tz || 'Asia/Shanghai' : 'Asia/Shanghai',
        windowDays: flow.outputRules && flow.outputRules.windowDays ? flow.outputRules.windowDays : 7,
      },
      enabled: flow.enabled !== false,
    })

    const payloadOf = (d) => ({
      id: d.isNew ? undefined : d.id,
      name: d.name,
      triggers: splitList(d.triggersText),
      description: d.description,
      params: d.params.filter((p) => String(p.name || '').trim() !== '').map((p) => ({ name: p.name.trim(), default: String(p.default ?? ''), required: p.required === true })),
      steps: d.steps.filter((s) => String(s.title || '').trim() !== '' || String(s.instruction || '').trim() !== '').map((s, i) => {
        const one = { id: s.id || 's' + (i + 1), title: s.title, instruction: s.instruction }
        if (String(s.capability || '').trim() !== '') one.capability = String(s.capability).trim()
        return one
      }),
      capabilities: [],
      outputRules: {
        land: d.outputRules.land === true,
        kind: d.outputRules.kind,
        tags: splitList(d.outputRules.tags),
        dir: String(d.outputRules.dir || '').trim(),
        tz: String(d.outputRules.tz || 'Asia/Shanghai').trim(),
        windowDays: Number(d.outputRules.windowDays) || 7,
      },
      enabled: d.enabled !== false,
    })

    let flowClientContext = null
    let flowLaunchPending = false

    async function launchFlowConversation(flow, kbId) {
      if (flowLaunchPending) throw new Error('正在创建流程会话，请勿重复点击')
      flowLaunchPending = true
      let reference = null
      let sessionId = ''
      try {
        const sessions = flowClientContext && flowClientContext.get('sessions')
        const workspace = flowClientContext && flowClientContext.get('uiWorkspace')
        const views = flowClientContext && flowClientContext.get('uiConversation')
        if (!sessions || !workspace || !views) throw new Error('宿主会话服务尚未就绪，请稍后重试')
        const prepared = await callApi({ op: 'flows.prepare-conversation', id: flow.id, kbId, expectedRevision: flow.revision })
        if (!prepared || !prepared.ok) throw new Error((prepared && (prepared.error || prepared.reason)) || '无法读取流程提示词')
        sessionId = await sessions.create({ cwd: prepared.cwd, agentPreset: 'knowledge' })
        reference = sessions.retain(sessionId, { source: 'kb-flow-launch' })
        await reference.ready
        const scope = sessions.scope(sessionId)
        const conversation = scope && scope.get('conversation')
        if (!conversation || typeof conversation.send !== 'function') throw new Error('新会话未就绪，未发送提示词')
        workspace.openSession(sessionId)
        views.binding(sessionId).activate('chat')
        // 原样发送完整步骤，普通会话负责流式回复、工具事件与停止操作。
        await conversation.send(prepared.prompt)
        return sessionId
      } catch (err) {
        throw new Error((sessionId ? '会话 ' + sessionId + ' 已创建，自动发送未确认成功；请查看该会话后再决定是否重试。' : '') + String((err && err.message) || err))
      } finally {
        if (reference) reference.release()
        flowLaunchPending = false
      }
    }

    function Flows() {
      const [data, setData] = react.useState(null)
      const [error, setError] = react.useState('')
      const [msg, setMsg] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [draft, setDraft] = react.useState(null)
      const launching = react.useRef(false)
      const [records, setRecords] = react.useState(null)
      const [toast, showToast] = useToast()

      const load = react.useCallback(async () => {
        try {
          const d = await callApi({ op: 'flows.list', includeArchived: true })
          if (d && d.ok) {
            setData(d)
            setError('')
          } else {
            setError((d && (d.error || d.reason)) || '读取失败')
          }
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }, [])

      react.useEffect(() => {
        ensureStyle()
        load()
      }, [load])

      const save = async () => {
        if (draft === null) return
        setBusy(true)
        setMsg('')
        try {
          const d = await callApi({ op: 'flows.save', flow: payloadOf(draft), expectedRevision: draft.expectedRevision === null ? undefined : draft.expectedRevision })
          if (d && d.ok) {
            setMsg(d.created ? '已新建流程「' + d.flow.name + '」（v' + d.revision + '）' : '已保存「' + d.flow.name + '」（v' + d.revision + '）')
            setDraft(null)
            await load()
          } else if (d && d.conflict) {
            setMsg('保存被拒（版本冲突）：当前 v' + d.currentRevision + '。为避免覆盖别人刚改的定义，本次没写盘 —— 请重新打开这条流程再改。')
            await load()
          } else {
            setMsg('保存失败：' + ((d && (d.error || d.reason)) || '未知'))
          }
        } catch (err) {
          setMsg('保存失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const toggle = async (flow) => {
        setBusy(true)
        try {
          const d = await callApi({ op: 'flows.enable', id: flow.id, enabled: !flow.enabled })
          if (d && d.ok) { setMsg((d.enabled ? '已启用 ' : '已停用 ') + flow.name); await load() } else setMsg('操作失败：' + ((d && (d.error || d.reason)) || '未知'))
        } catch (err) {
          setMsg('操作失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const archive = async (flow, restored) => {
        setBusy(true)
        try {
          const d = await callApi({ op: 'flows.archive', id: flow.id, restored: restored === true })
          if (d && d.ok) { setMsg(restored === true ? '已恢复 ' + flow.name : '已归档（软删除，可恢复）' + flow.name); await load() } else setMsg('操作失败：' + ((d && (d.error || d.reason)) || '未知'))
        } catch (err) {
          setMsg('操作失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const startRun = async (flow) => {
        if (launching.current) return
        launching.current = true
        setBusy(true)
        setMsg('正在新建会话并发送流程提示词…')
        setRecords(null)
        try {
          await launchFlowConversation(flow, data.kbId)
          setMsg('提示词已发送，请在新会话中查看实时执行过程')
        } catch (err) {
          setMsg('未能启动：' + String((err && err.message) || err))
        } finally {
          launching.current = false
          setBusy(false)
        }
      }

      const cancelBackgroundRun = async (runId) => {
        try {
          const d = await callApi({ op: 'flows.cancel', runId })
          setMsg(d && d.ok ? '已发出取消：正在跑的这一步会被中断，之后的步骤不再开始' : '取消失败：' + ((d && (d.error || d.reason)) || '未知'))
          await load()
        } catch (err) {
          setMsg('取消失败：' + String((err && err.message) || err))
        }
      }

      const loadRecords = async (flow) => {
        try {
          const d = await callApi({ op: 'flows.runs', flowId: flow.id, limit: 20 })
          setRecords({ flowId: flow.id, flowName: flow.name, rows: d && d.ok ? d.runs : [], error: d && d.ok ? '' : ((d && (d.error || d.reason)) || '读取失败') })
        } catch (err) {
          setRecords({ flowId: flow.id, flowName: flow.name, rows: [], error: String((err && err.message) || err) })
        }
      }

      const openEdit = async (flow) => {
        setBusy(true)
        try {
          const d = await callApi({ op: 'flows.get', id: flow.id })
          if (d && d.ok) setDraft(draftOf(d.flow))
          else setMsg('读取定义失败：' + ((d && (d.error || d.reason)) || '未知'))
        } catch (err) {
          setMsg('读取定义失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const patch = (p) => setDraft((prev) => (prev === null ? prev : Object.assign({}, prev, p)))
      const patchRules = (p) => setDraft((prev) => (prev === null ? prev : Object.assign({}, prev, { outputRules: Object.assign({}, prev.outputRules, p) })))
      const updateStep = (i, p) => setDraft((prev) => prev === null ? prev : Object.assign({}, prev, { steps: prev.steps.map((s, k) => (k === i ? Object.assign({}, s, p) : s)) }))
      const removeStep = (i) => setDraft((prev) => prev === null ? prev : Object.assign({}, prev, { steps: prev.steps.filter((s, k) => k !== i) }))
      const addStep = () => setDraft((prev) => prev === null ? prev : Object.assign({}, prev, { steps: prev.steps.concat([{ id: 's' + (prev.steps.length + 1), title: '', instruction: '', capability: '' }]) }))
      const updateParam = (i, p) => setDraft((prev) => prev === null ? prev : Object.assign({}, prev, { params: prev.params.map((s, k) => (k === i ? Object.assign({}, s, p) : s)) }))
      const removeParam = (i) => setDraft((prev) => prev === null ? prev : Object.assign({}, prev, { params: prev.params.filter((s, k) => k !== i) }))
      const addParam = () => setDraft((prev) => prev === null ? prev : Object.assign({}, prev, { params: prev.params.concat([{ name: '', default: '', required: false }]) }))

      const field = (label, node) => e('div', { className: 'kbf-field' }, e('label', null, label), node)
      const input = (value, onChange, placeholder) => e('input', {
        className: 'kbc-set-input',
        value: value,
        placeholder: placeholder || '',
        spellCheck: false,
        onChange: (ev) => onChange(ev.target.value),
      })
      const area = (value, onChange, placeholder) => e('textarea', {
        className: 'kbf-ta',
        value: value,
        placeholder: placeholder || '',
        spellCheck: false,
        onChange: (ev) => onChange(ev.target.value),
      })

      const head = e('div', { className: 'kbm-head' },
        e('span', { className: 'kbm-title' }, '流程'),
        e('span', { className: 'kbm-sub' }, data && data.ok ? ('库 ' + String(data.kbId || '-').slice(0, 8) + ' · ' + data.count + ' 条') : ''),
        e('button', { className: 'kbc-btn kbc-btn-ghost', style: { marginLeft: 'auto', padding: '3px 10px', fontSize: 12 }, disabled: busy, onClick: load }, busy ? '处理中…' : '刷新'))

      // ── 记录面板 ──
      const recordsPanel = records === null ? null : e('div', { className: 'kbf-run' },
        e('div', { className: 'kbf-run-row' }, '「' + records.flowName + '」后台运行记录：' + (records.error || (records.rows.length + ' 条'))),
        (records.rows || []).map((r) => e('div', { key: r.runId, className: 'kbf-run-row' },
          r.runId + ' · ' + r.status + ' · ' + (r.startedAt || '-') + ' · 步骤 ' + r.stepDone + '/' + r.stepTotal
          + (r.landedEntryId ? ' · 落库 ' + r.landedEntryId : '') + (r.error ? ' · ' + r.error : ''),
          FLOW_TERMINAL[r.status] === 1 ? null : e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => cancelBackgroundRun(r.runId) }, '取消后台运行'))),
        e('div', { className: 'kbf-actions' }, e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => setRecords(null) }, '收起')))

      // ── 编辑表单（表单 + 步骤编辑，不要求手写 JSON）──
      const form = draft === null ? null : e('div', { className: 'kbf-run' },
        e('div', { className: 'kbf-run-row' }, draft.isNew ? '新增流程' : ('编辑流程 ' + draft.id + '（当前 v' + draft.expectedRevision + '）')),
        field('名称', input(draft.name, (v) => patch({ name: v }), '例：信息报')),
        field('什么时候用到它（说哪句话会触发；多个用逗号隔开）', input(draft.triggersText, (v) => patch({ triggersText: v }), '例：信息报，每周信息')),
        field('它是做什么的（一句话）', area(draft.description, (v) => patch({ description: v }), '例：按上次交付到现在的窗口出一期《信息报》并发出来')),
        e('div', { className: 'kbf-field' }, e('label', null, '要做的事（按顺序执行，一步一件事）'),
          draft.steps.map((s, i) => e('div', { key: 's' + i, className: 'kbf-step' },
            input(s.title, (v) => updateStep(i, { title: v }), '第 ' + (i + 1) + ' 步：做什么（短标题）'),
            area(s.instruction, (v) => updateStep(i, { instruction: v }), '这一步具体要做什么（写到什么程度算完成）'),
            e('div', { className: 'kbf-actions' },
              e('label', { style: { fontSize: 12, opacity: .7, display: 'flex', gap: 6, alignItems: 'center' } },
                e('input', { type: 'checkbox', checked: String(s.capability || '') === 'write', onChange: (ev) => updateStep(i, { capability: ev.target.checked ? 'write' : '' }) }),
                '这一步会改动文件（失败就不自动重试）'),
              e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => removeStep(i) }, '删除这一步')))),
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: addStep }, '加一步')),
        e('details', { className: 'kbf-adv' },
          e('summary', { style: { fontSize: 12, opacity: .7, cursor: 'pointer', margin: '12px 0 8px' } }, '高级设置（一般不用改：落库规则、标签、参数、时区）'),
          e('div', { className: 'kbf-field' }, e('label', null, '跑完之后要把结果写成一条知识库条目吗'),
            e('label', { style: { fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' } },
              e('input', { type: 'checkbox', checked: draft.outputRules.land === true, onChange: (ev) => patchRules({ land: ev.target.checked }) }),
              draft.outputRules.land === true ? '会写一条（只在成功时写）' : '不写，只留在流程记录里'),
            draft.outputRules.land === true
              ? e('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 } },
                e('span', { style: { fontSize: 12, opacity: .6 } }, '写进哪个板块'),
                e('select', {
                  className: 'kbc-set-input',
                  style: { maxWidth: 160 },
                  value: draft.outputRules.kind,
                  onChange: (ev) => patchRules({ kind: ev.target.value }),
                }, FLOW_KINDS.map((k) => e('option', { key: k, value: k }, k))))
              : null),
          field('标签（逗号分隔，可空）', input(draft.outputRules.tags, (v) => patchRules({ tags: v }), '例：信息报，周报')),
          e('div', { className: 'kbf-field' }, e('label', null, '参数（需要你临时补的值；一般留空）'),
            draft.params.map((p, i) => e('div', { key: 'p' + i, className: 'kbf-grid', style: { marginBottom: 6 } },
              input(p.name, (v) => updateParam(i, { name: v }), '参数名'),
              e('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                input(p.default, (v) => updateParam(i, { default: v }), '默认值'),
                e('label', { style: { fontSize: 12, opacity: .7, whiteSpace: 'nowrap' } },
                  e('input', { type: 'checkbox', checked: p.required === true, onChange: (ev) => updateParam(i, { required: ev.target.checked }) }), ' 必填'),
                e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => removeParam(i) }, '删')))),
            e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: addParam }, '加参数')),
          e('div', { className: 'kbf-field' }, e('label', null, '统计窗口 / 时区 / 存放子目录'),
            e('div', { className: 'kbf-grid' },
              e('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                e('span', { style: { fontSize: 12, opacity: .6 } }, '窗口天数'),
                input(String(draft.outputRules.windowDays), (v) => patchRules({ windowDays: v }), '7')),
              input(draft.outputRules.tz, (v) => patchRules({ tz: v }), '时区 Asia/Shanghai'),
              input(draft.outputRules.dir, (v) => patchRules({ dir: v }), '存放子目录（可空，库内相对路径）')))),
        e('div', { className: 'kbf-actions' },
          e('button', { className: 'kbc-btn kbc-btn-primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => setDraft(null) }, '取消')))

      const listNode = data === null
        ? e('div', { className: 'kbm-empty' }, error || '正在读取流程…')
        : data.flows.length === 0
          ? e('div', { className: 'kbm-empty' }, '还没有自定义流程。点「新增流程」把一串固定步骤存下来；以后说它的触发语就能运行。')
          : data.flows.map((f) => e('div', { key: f.id, className: 'kbf-row' },
            e('span', { className: 'kbf-name' }, f.name),
            e('span', { className: 'kbf-trig' }, (f.triggers || []).join(' / ') || '（无触发语）'),
            e('span', { className: 'kbf-desc' }, f.description || '—'),
            e('span', { className: 'kbf-state' + (f.enabled ? ' on' : '') }, f.enabled ? '启用' : '停用'),
            e('span', { className: 'kbf-state' }, f.lastRun ? ('后台：' + f.lastRun.status + ' · ' + String(f.lastRun.startedAt || '').slice(5, 16)) : '无后台记录'),
            e('span', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => openEdit(f) }, '编辑'),
              e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => toggle(f) }, f.enabled ? '停用' : '启用'),
              e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy || !f.enabled || f.archived, onClick: () => startRun(f) }, '立即运行（新会话）'),
              e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => loadRecords(f) }, '后台记录'),
              f.archived
                ? e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => archive(f, true) }, '恢复')
                : e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => archive(f, false) }, '删除'))))

      return e('div', { className: 'kbm' },
        head,
        e('div', { className: 'kbm-sub' }, '点击运行会新建知识库会话，自动发送完整流程提示词，并切换到对话查看实时回复、工具调用和执行结果；可在会话中停止。新运行保存在会话历史中，后台记录保留旧执行器的历史。'),
        e('div', { className: 'kbf-bar', style: { marginTop: 10 } },
          e('button', { className: 'kbc-btn kbc-btn-primary', onClick: () => { setDraft(emptyDraft()); setMsg('') } }, '新增流程'),
          e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: load }, '刷新')),
        msg ? e('div', { className: 'kbc-set-msg' }, msg) : null,
        error && data !== null ? e('div', { className: 'kbm-empty' }, error) : null,
        recordsPanel,
        form,
        e('div', { className: 'kbm-h' }, '已定义的流程'),
        listNode,
        toast ? e('div', { className: 'kbm-toast' }, toast) : null)
    }

    // 知识库页签的容器：「概览」与「流程」是两个内部二级页签，不把概览堆成长页
    function BuildBadge() {
      const [build, setBuild] = react.useState(null)
      const [error, setError] = react.useState('')
      const [loading, setLoading] = react.useState(true)
      const request = react.useRef(0)
      const refresh = react.useCallback(async () => {
        const seq = ++request.current
        setLoading(true)
        setError('')
        try {
          const data = await callApi({ op: 'status' })
          if (seq !== request.current) return
          const current = data && data.ok && data.status && data.status.build
          if (!current || !current.version || !current.buildId) throw new Error('宿主尚未返回完整版本信息')
          setBuild(current)
        } catch (err) {
          if (seq === request.current) { setBuild(null); setError('版本信息读取失败') }
        } finally {
          if (seq === request.current) setLoading(false)
        }
      }, [])
      react.useEffect(() => {
        refresh()
        return () => { request.current += 1 }
      }, [refresh])
      return e('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px', fontSize: 12 }, 'aria-label': '插件版本信息' },
        e('span', { style: { opacity: .75, overflowWrap: 'anywhere' }, role: 'status' },
          loading ? '正在读取版本…' : error || ('版本 ' + build.version + ' · 构建 ' + build.buildId)),
        e('button', { className: 'kbc-btn kbc-btn-ghost', style: { padding: '3px 8px', fontSize: 12 }, disabled: loading, onClick: refresh, 'aria-label': '刷新版本信息' }, '刷新版本'))
    }

    function KbView() {
      const [tab, setTab] = react.useState('overview')
      ensureStyle()
      return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
        e('div', { className: 'kbf-bar', style: { padding: '12px 22px 0', margin: 0 } },
          e('button', { className: 'kbf-tab' + (tab === 'overview' ? ' on' : ''), onClick: () => setTab('overview') }, '概览'),
          e('button', { className: 'kbf-tab' + (tab === 'flows' ? ' on' : ''), onClick: () => setTab('flows') }, '流程'),
          e(BuildBadge)),
        e('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
          tab === 'overview' ? e(Overview) : e(Flows)))
    }

    // ── 解析服务（OCR / ASR）：提供方、任务、待解析项 ────────────────
    // 两条测试必须分开展示，文案也不能互相顶替：
    //   · 测试连接（parse.test-connection）—— 只证明「地址 / 程序 / 凭据」通
    //   · 真实解析测试（parse.test-parse）—— 真的拿一个小样本跑一遍解析（2–60 秒）
    // 连接通过绝不显示成「解析通过」。
    const PARSE_KIND_TEXT = { ocr: 'OCR', asr: 'ASR' }
    const PARSE_JOB_STATUS = {
      queued: '排队中', running: '运行中', succeeded: '成功',
      partial: '部分成功', failed: '失败', canceled: '已取消',
    }
    const PARSE_LAND_TEXT = { none: '未落库', landed: '已落库', failed: '落库失败', conflict: '落库冲突' }
    const PARSE_LOCALITY_TEXT = { local: 'local（本机）', lan: 'lan（局域网）', cloud: 'cloud（云端）' }
    const PARSE_CLI_PROTOCOLS = ['cli-transcribe']

    const parseShow = (v) => (v === null || v === undefined || v === '' ? '—' : String(v))
    const parseIsCli = (protocol) => PARSE_CLI_PROTOCOLS.indexOf(String(protocol || '')) >= 0
    const parseShortId = (id) => {
      const s = String(id || '')
      return s.length > 12 ? s.slice(0, 12) + '…' : s
    }
    const parseNum = (text) => {
      const s = String(text === null || text === undefined ? '' : text).trim()
      if (s === '') return undefined
      const n = Number(s)
      return Number.isFinite(n) ? n : undefined
    }

    const parseEmptyDraft = (kind, protocol) => ({
      isNew: true,
      id: '',
      kind: kind,
      protocol: protocol || '',
      label: '',
      locality: 'local',
      baseUrl: '',
      command: '',
      argsText: '',
      renderCommand: '',
      model: '',
      credentialRef: '',
      authScheme: 'none',
      timeoutMs: '',
      formatsText: '',
      maxBytes: '',
      maxPages: '',
      enabled: true,
      notes: '',
    })

    const parseDraftOf = (p) => ({
      isNew: false,
      // originId = 打开表单时的 id，用来确定"这个表单属于哪一行"
      // （直接用 draft.id 判会让用户在 id 输入框里敲第一个字符时表单就消失）
      originId: p.id || '',
      id: p.id || '',
      kind: p.kind || 'ocr',
      protocol: p.protocol || '',
      label: p.label || '',
      locality: p.locality || 'local',
      baseUrl: p.baseUrl || '',
      command: p.command || '',
      argsText: Array.isArray(p.args) ? p.args.join(', ') : '',
      renderCommand: p.renderCommand || '',
      model: p.model || '',
      credentialRef: p.credentialRef || '',
      authScheme: p.authScheme || 'none',
      timeoutMs: p.timeoutMs === null || p.timeoutMs === undefined ? '' : String(p.timeoutMs),
      formatsText: Array.isArray(p.formats) ? p.formats.join(', ') : '',
      maxBytes: p.maxBytes === null || p.maxBytes === undefined ? '' : String(p.maxBytes),
      maxPages: p.maxPages === null || p.maxPages === undefined ? '' : String(p.maxPages),
      enabled: p.enabled !== false,
      notes: p.notes || '',
    })

    // 数值字段留空就不发（不拿 0 去试探宿主校验），填了才带
    const parseProviderPayload = (d) => {
      const out = {
        id: String(d.id || '').trim(),
        kind: d.kind,
        protocol: d.protocol,
        label: String(d.label || '').trim(),
        locality: d.locality,
        model: String(d.model || '').trim(),
        credentialRef: String(d.credentialRef || '').trim(),
        authScheme: d.authScheme,
        formats: splitList(d.formatsText),
        enabled: d.enabled === true,
        notes: String(d.notes || ''),
      }
      const timeoutMs = parseNum(d.timeoutMs)
      if (timeoutMs !== undefined) out.timeoutMs = timeoutMs
      const maxBytes = parseNum(d.maxBytes)
      if (maxBytes !== undefined) out.maxBytes = maxBytes
      const maxPages = parseNum(d.maxPages)
      if (maxPages !== undefined) out.maxPages = maxPages
      if (parseIsCli(d.protocol)) {
        out.command = String(d.command || '').trim()
        out.args = splitList(d.argsText)
      } else {
        out.baseUrl = String(d.baseUrl || '').trim()
      }
      if (d.kind === 'ocr') out.renderCommand = String(d.renderCommand || '').trim()
      return out
    }

    function ParseSection(props) {
      const initialImportId = props && props.initialImportId ? String(props.initialImportId) : ''
      const [info, setInfo] = react.useState(null)
      const [msg, setMsg] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [draft, setDraft] = react.useState(null)
      const [formErrors, setFormErrors] = react.useState([])
      const [testSource, setTestSource] = react.useState({})
      const [testNote, setTestNote] = react.useState({})
      const [pending, setPending] = react.useState({})
      const [jobs, setJobs] = react.useState(null)
      const [jobDetail, setJobDetail] = react.useState(null)
      const [jobPreview, setJobPreview] = react.useState(null)
      const [waitImportId, setWaitImportId] = react.useState(initialImportId)
      const [waiting, setWaiting] = react.useState(null)
      const [waitNote, setWaitNote] = react.useState('')
      const [toast, showToast] = useToast()

      const load = react.useCallback(async () => {
        try {
          const d = await callApi({ op: 'parse.providers' })
          if (d && d.ok) setInfo(d)
          else setMsg('读取解析服务配置失败：' + ((d && (d.error || d.reason)) || '未知原因'))
        } catch (err) {
          setMsg('读取解析服务配置失败：' + String((err && err.message) || err))
        }
      }, [])

      const loadJobs = react.useCallback(async () => {
        try {
          const d = await callApi({ op: 'parse.jobs', limit: 8 })
          if (d && d.ok) setJobs(Array.isArray(d.jobs) ? d.jobs : [])
          else setMsg('读取解析任务失败：' + ((d && (d.error || d.reason)) || '未知原因'))
        } catch (err) {
          setMsg('读取解析任务失败：' + String((err && err.message) || err))
        }
      }, [])

      react.useEffect(() => {
        ensureStyle()
        load()
        loadJobs()
      }, [load, loadJobs])

      react.useEffect(() => {
        if (initialImportId === '') return
        setWaitImportId((prev) => (prev ? prev : initialImportId))
      }, [initialImportId])

      const providers = info && Array.isArray(info.providers) ? info.providers : []
      // parse.providers 回的是 defaultOcr / defaultAsr；save / delete / parse.default 回的是 defaults:{ocr,asr}
      // 两种都认，否则「默认提供方」会永远显示成未设置
      const defaults = (() => {
        const d = (info && info.defaults) || {}
        const ocr = d.ocr !== undefined ? d.ocr : (info && info.defaultOcr !== undefined ? info.defaultOcr : null)
        const asr = d.asr !== undefined ? d.asr : (info && info.defaultAsr !== undefined ? info.defaultAsr : null)
        return { ocr: ocr, asr: asr }
      })()
      const policy = info && info.externalPolicy ? String(info.externalPolicy) : ''
      const protocols = (info && info.protocols) || { ocr: [], asr: [] }
      const localities = info && Array.isArray(info.locality) && info.locality.length > 0 ? info.locality : ['local', 'lan', 'cloud']
      const providersOf = (kind) => providers.filter((p) => p.kind === kind)

      // 只要有任务在排队/运行就每 5 秒刷新一次；全部终态后立刻清掉 interval
      const activeCount = (jobs || []).filter((j) => j.status === 'queued' || j.status === 'running').length
      react.useEffect(() => {
        if (activeCount === 0) return undefined
        const timer = setInterval(() => { loadJobs() }, 5000)
        return () => clearInterval(timer)
      }, [activeCount, loadJobs])

      const patch = (p) => setDraft((prev) => (prev === null ? prev : Object.assign({}, prev, p)))
      const patchTestSource = (id, v) => setTestSource((prev) => Object.assign({}, prev, { [id]: v }))
      const patchTestNote = (id, v) => setTestNote((prev) => Object.assign({}, prev, { [id]: v }))
      const patchPending = (id, v) => setPending((prev) => Object.assign({}, prev, { [id]: v }))

      const changePolicy = async (next) => {
        if (!next || next === policy) return
        setBusy(true)
        try {
          const d = await callApi({ op: 'parse.policy', externalPolicy: next })
          if (d && d.ok) {
            setMsg(next === 'local-only'
              ? '已切到 local-only：所有位置为 cloud 的提供方都会被拒绝，云端 OCR / ASR 一律不可用。'
              : '已切到 allow-configured：只放行你在下面显式配置过的提供方，位置为 cloud 的会真的把文件发到外部服务。')
            await load()
          } else {
            setMsg('切换策略失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('切换策略失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const setDefault = async (kind, providerId) => {
        setBusy(true)
        try {
          const d = await callApi({ op: 'parse.default', kind: kind, providerId: providerId })
          if (d && d.ok) {
            setMsg('已把 ' + providerId + ' 设为 ' + (PARSE_KIND_TEXT[kind] || kind) + ' 默认提供方')
            await load()
          } else {
            setMsg('设置默认失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('设置默认失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const toggleProvider = async (p) => {
        setBusy(true)
        try {
          // 整体回传宿主给的 provider，只改 enabled —— 不把表单没覆盖的字段丢掉
          const d = await callApi({ op: 'parse.provider.save', provider: Object.assign({}, p, { enabled: p.enabled === false }) })
          if (d && d.ok) {
            showToast(p.enabled === false ? '已启用 ' + p.id : '已停用 ' + p.id)
            await load()
          } else if (d && Array.isArray(d.errors) && d.errors.length > 0) {
            setMsg('操作失败：' + d.errors.map((it) => String((it && it.message) || (it && it.field) || '校验失败')).join('；'))
          } else {
            setMsg('操作失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('操作失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const saveProvider = async () => {
        if (draft === null) return
        setBusy(true)
        setFormErrors([])
        try {
          const d = await callApi({
            op: 'parse.provider.save',
            provider: parseProviderPayload(draft),
          })
          if (d && d.ok) {
            setMsg('已保存 ' + parseShow(d.provider && d.provider.id) + '（revision ' + parseShow(d.revision) + '）')
            setDraft(null)
            await load()
          } else if (d && Array.isArray(d.errors) && d.errors.length > 0) {
            setFormErrors(d.errors.map((it) => String((it && it.message) || (it && it.field) || '校验失败')))
          } else {
            setFormErrors([String((d && (d.error || d.reason)) || '保存失败：未知原因')])
          }
        } catch (err) {
          setFormErrors([String((err && err.message) || err)])
        } finally {
          setBusy(false)
        }
      }

      const deleteProvider = async (p) => {
        const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm('删除提供方 ' + p.id + '？它的默认设置会被一起清掉。')
          : true
        if (!ok) return
        setBusy(true)
        try {
          const d = await callApi({ op: 'parse.provider.delete', providerId: p.id })
          if (d && d.ok) {
            setMsg('已删除 ' + p.id + (d.removed === false ? '（本来就已不存在）' : ''))
            if (draft !== null && draft.isNew === false && draft.originId === p.id) setDraft(null)
            await load()
          } else {
            setMsg('删除失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('删除失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      // 连接测试：只证明「地址 / 程序 / 凭据」通，不证明能解析
      const testConnection = async (p) => {
        patchPending(p.id, true)
        patchTestNote(p.id, '正在测试连接…')
        try {
          const d = await callApi({ op: 'parse.test-connection', providerId: p.id })
          if (d && d.ok) {
            patchTestNote(p.id, '连接通过：' + (d.latencyMs === null || d.latencyMs === undefined ? '' : String(d.latencyMs) + ' ms · ')
              + parseShow(d.detail) + (d.note ? '（' + d.note + '）' : '')
              + '。注意：这只证明地址 / 程序通，不代表能解析，请再点「真实解析测试」。')
          } else {
            patchTestNote(p.id, '连接失败：' + ((d && (d.reason || d.detail)) || '未知原因'))
          }
        } catch (err) {
          patchTestNote(p.id, '连接失败：' + String((err && err.message) || err))
        } finally {
          patchPending(p.id, false)
        }
      }

      // 真实解析测试：真的拿一个小样本跑一遍（2–60 秒），这才是「能解析」的证据
      const testParse = async (p) => {
        const sourceRel = String(testSource[p.id] === undefined ? '' : testSource[p.id]).trim()
        if (sourceRel === '') {
          patchTestNote(p.id, '先在这一行右侧填要试解析的源文件（知识库内的相对路径），再点「真实解析测试」')
          return
        }
        patchPending(p.id, true)
        patchTestNote(p.id, '正在真实解析测试（2–60 秒）…')
        try {
          const d = await callApi({ op: 'parse.test-parse', providerId: p.id, sourceRel: sourceRel, kind: p.kind })
          if (d && d.ok) {
            patchTestNote(p.id, '真实解析通过：' + parseShow(d.textChars) + ' 字符 · 状态 ' + parseShow(d.status)
              + (d.preview ? ' · 预览：' + String(d.preview).slice(0, 120) : '')
              + (d.note ? '（' + d.note + '）' : ''))
          } else {
            patchTestNote(p.id, '真实解析失败：' + ((d && (d.reason || d.detail)) || '未知原因'))
          }
        } catch (err) {
          patchTestNote(p.id, '真实解析失败：' + String((err && err.message) || err))
        } finally {
          patchPending(p.id, false)
        }
      }

      const refreshJob = async (jobId) => {
        try {
          const d = await callApi({ op: 'parse.job', jobId: jobId })
          if (d && d.ok) setJobDetail(d.job)
          else setMsg('读取任务详情失败：' + ((d && (d.error || d.reason)) || '未知原因'))
        } catch (err) {
          setMsg('读取任务详情失败：' + String((err && err.message) || err))
        }
      }

      const previewJob = async (jobId) => {
        try {
          const d = await callApi({ op: 'parse.result', jobId: jobId, limit: 600 })
          if (d && d.ok) {
            setJobPreview({
              jobId: jobId,
              text: String(d.text || ''),
              textChars: d.textChars,
              truncated: d.truncated === true,
            })
          } else {
            setMsg('读取解析结果失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('读取解析结果失败：' + String((err && err.message) || err))
        }
      }

      const cancelJob = async (jobId) => {
        try {
          const d = await callApi({ op: 'parse.cancel', jobId: jobId })
          if (d && d.ok) {
            showToast('已请求取消：' + parseShow(d.status))
            await loadJobs()
          } else {
            setMsg('取消失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('取消失败：' + String((err && err.message) || err))
        }
      }

      const retryJob = async (jobId) => {
        try {
          const d = await callApi({ op: 'parse.retry', jobId: jobId })
          if (d && d.ok) {
            showToast(d.retryKind === 'land-only' ? '已重新排队：只重试落库' : '已重新排队：重新解析')
            await loadJobs()
          } else {
            setMsg('重试失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('重试失败：' + String((err && err.message) || err))
        }
      }

      const landJob = async (jobId) => {
        try {
          const d = await callApi({ op: 'parse.land', jobId: jobId })
          if (d && d.ok) {
            setMsg('已落库：' + parseShow(d.land && d.land.entryId))
            await loadJobs()
          } else {
            setMsg('落库失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('落库失败：' + String((err && err.message) || err))
        }
      }

      const listWaiting = async () => {
        const id = String(waitImportId || '').trim()
        if (id === '') {
          setWaitNote('先填 importId（导入任务的 id）；上面「导入进度」里正在跑的那个 id 会自动填到这里。')
          return
        }
        setBusy(true)
        setWaiting(null)
        setWaitNote('')
        try {
          const d = await callApi({ op: 'import-waiting', importId: id })
          if (d && d.ok) {
            setWaiting({ items: Array.isArray(d.items) ? d.items : [], parseAvailable: d.parseAvailable !== false })
            setWaitNote(d.note ? String(d.note) : '')
          } else {
            setWaitNote(String((d && (d.error || d.reason || d.note)) || '读取失败'))
          }
        } catch (err) {
          setWaitNote(String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const parseWaiting = async (item) => {
        const id = String(waitImportId || '').trim()
        if (id === '') return
        const kind = item.suggestedKind === 'asr' ? 'asr' : 'ocr'
        setBusy(true)
        try {
          const d = await callApi({ op: 'import-parse', importId: id, rel: item.rel, kind: kind })
          if (d && d.ok) {
            setMsg('已提交解析：' + String(item.rel || '') + ' → ' + parseShow(d.jobId)
              + '（' + parseShow(d.status) + '）' + (d.deduped ? '；同一份任务被复用，没有重复排队' : ''))
            await loadJobs()
            await listWaiting()
          } else {
            setMsg('提交解析失败：' + ((d && (d.error || d.reason)) || '未知原因'))
          }
        } catch (err) {
          setMsg('提交解析失败：' + String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }

      const row = (label, value) => e('div', { className: 'kbc-set-row' },
        e('span', { className: 'kbc-set-key' }, label),
        e('span', { className: 'kbc-set-val' }, String(value)))

      const field = (label, node, hint) => e('div', { className: 'kbc-parse-field' },
        e('label', null, label),
        node,
        hint ? e('span', { className: 'kbc-set-hint' }, hint) : null)

      const textInput = (value, onChange, placeholder) => e('input', {
        className: 'kbc-set-input',
        value: value === null || value === undefined ? '' : String(value),
        placeholder: placeholder || '',
        spellCheck: false,
        onChange: (ev) => onChange(ev.target.value),
      })

      const selectInput = (value, options, onChange, disabled) => e('select', {
        className: 'kbc-set-input',
        value: value,
        disabled: disabled === true,
        onChange: (ev) => onChange(ev.target.value),
      }, options.map((o) => e('option', { key: o.value, value: o.value }, o.label)))

      const progressText = (j) => {
        const p = (j && j.progress) || {}
        const parts = []
        if (typeof p.pagesTotal === 'number' && p.pagesTotal > 0) parts.push('页 ' + (p.pagesDone || 0) + ' / ' + p.pagesTotal)
        if (typeof p.segmentsTotal === 'number' && p.segmentsTotal > 0) parts.push('段 ' + (p.segmentsDone || 0) + ' / ' + p.segmentsTotal)
        if (parts.length === 0) return '—'
        return parts.join(' · ')
      }

      const formNode = (d) => e('div', { className: 'kbc-parse-form' },
        e('div', { className: 'kbf-run-row' },
          d.isNew ? ('新增' + (PARSE_KIND_TEXT[d.kind] || d.kind) + ' 提供方') : ('编辑 ' + d.originId + '（kind 保存时不可改）')),
        e('div', { className: 'kbc-parse-grid' },
          field('id', textInput(d.id, (v) => patch({ id: v }), '必填；它就是主键，改 id 等于新建一条')),
          field('kind（类型）', selectInput(d.kind, [
            { value: 'ocr', label: 'ocr（图片 / 扫描件 → 文字）' },
            { value: 'asr', label: 'asr（语音 → 文字）' },
          ], (v) => {
            const list = (protocols && protocols[v]) || []
            patch({ kind: v, protocol: list.indexOf(d.protocol) >= 0 ? d.protocol : (list[0] || '') })
          }, !d.isNew))),
        e('div', { className: 'kbc-parse-grid' },
          field('protocol（协议）', selectInput(d.protocol,
            ((protocols && protocols[d.kind]) || []).map((x) => ({ value: x, label: x })),
            (v) => patch({ protocol: v }))),
          field('label（显示名）', textInput(d.label, (v) => patch({ label: v }), '例：本机 PaddleOCR-VL'))),
        e('div', { className: 'kbc-parse-grid' },
          field('locality（位置）', selectInput(d.locality,
            localities.map((x) => ({ value: x, label: PARSE_LOCALITY_TEXT[x] || x })),
            (v) => patch({ locality: v }))),
          field('authScheme（鉴权方式）', selectInput(d.authScheme, [
            { value: 'none', label: 'none（不带凭据）' },
            { value: 'bearer', label: 'bearer（Authorization: Bearer …）' },
          ], (v) => patch({ authScheme: v })))),
        parseIsCli(d.protocol)
          ? e('div', { className: 'kbc-parse-grid' },
            field('command（可执行程序）', textInput(d.command, (v) => patch({ command: v }), '例：whisper.exe 的绝对路径')),
            field('args（参数，逗号分隔）', textInput(d.argsText, (v) => patch({ argsText: v }), '例：--model,large,--language,zh')))
          : field('baseUrl（服务地址）', textInput(d.baseUrl, (v) => patch({ baseUrl: v }), 'http 协议必填，例：http://127.0.0.1:8118/v1')),
        d.kind === 'ocr'
          ? field('renderCommand（版面渲染命令，可空）', textInput(d.renderCommand, (v) => patch({ renderCommand: v }), '可选：把 PDF 页面渲染成图片的程序'))
          : null,
        e('div', { className: 'kbc-parse-grid' },
          field('model（模型名）', textInput(d.model, (v) => patch({ model: v }), '例：PaddleOCR-VL-1.6-0.9B')),
          field('credentialRef（凭据名）', textInput(d.credentialRef, (v) => patch({ credentialRef: v }), '环境变量名，如 KB_OCR_TOKEN'))),
        e('div', { className: 'kbc-parse-grid' },
          field('timeoutMs（超时毫秒）', textInput(d.timeoutMs, (v) => patch({ timeoutMs: v }), '可空，留空则不覆盖宿主默认值')),
          field('formats（支持的格式，逗号分隔）', textInput(d.formatsText, (v) => patch({ formatsText: v }), '例：png,jpg,pdf'))),
        e('div', { className: 'kbc-parse-grid' },
          field('maxBytes（单文件上限，字节）', textInput(d.maxBytes, (v) => patch({ maxBytes: v }), '可空')),
          field('maxPages（最多页数）', textInput(d.maxPages, (v) => patch({ maxPages: v }), '可空'))),
        field('notes（备注）', textInput(d.notes, (v) => patch({ notes: v }), '给未来的自己一句说明')),
        e('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 } },
          e('input', { type: 'checkbox', checked: d.enabled === true, onChange: (ev) => patch({ enabled: ev.target.checked }) }),
          ' 启用（停用的提供方不会被当成默认 / 可选项）'),
        formErrors.length > 0
          ? e('div', { className: 'kbc-parse-err' }, '保存被拒：' + formErrors.join('；'))
          : null,
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-primary', disabled: busy, onClick: saveProvider }, busy ? '保存中…' : '保存'),
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => { setDraft(null); setFormErrors([]) } }, '取消')))

      const providerRow = (p) => {
        const isDefault = defaults[p.kind] === p.id
        const isPending = pending[p.id] === true
        const src = testSource[p.id] === undefined ? '' : testSource[p.id]
        const editing = draft !== null && draft.isNew === false && draft.originId === p.id
        return e('div', { className: 'kbc-parse-row', key: p.id },
          e('div', { className: 'kbc-parse-head' },
            e('span', { className: 'kbc-parse-id' }, p.id),
            isDefault ? e('span', { className: 'kbc-parse-badge' }, '默认') : null,
            p.enabled === false ? e('span', { className: 'kbc-parse-badge off' }, '停用') : null),
          e('div', { className: 'kbc-parse-meta' },
            '协议 ' + parseShow(p.protocol) + ' · 位置 ' + parseShow(p.locality) + (p.locale ? '（' + p.locale + '）' : '')
            + ' · 模型 ' + parseShow(p.model)
            + (p.credentialRef ? ' · 凭据 ' + p.credentialRef + (p.credentialConfigured ? '（已配置）' : '（未配置）') : '')
            + (p.baseUrl ? ' · ' + p.baseUrl : '')
            + (p.command ? ' · ' + p.command : '')),
          e('div', { className: 'kbc-parse-actions' },
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: isPending || busy, onClick: () => testConnection(p) }, '测试连接'),
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: isPending || busy, onClick: () => testParse(p) }, '真实解析测试'),
            e('input', {
              className: 'kbc-parse-inline',
              value: src,
              placeholder: '要试解析的源文件（库内相对路径）',
              spellCheck: false,
              onChange: (ev) => patchTestSource(p.id, ev.target.value),
            }),
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy || isDefault, onClick: () => setDefault(p.kind, p.id) }, isDefault ? '已是默认' : '设为默认'),
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => toggleProvider(p) }, p.enabled === false ? '启用' : '停用'),
            e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => deleteProvider(p) }, '删除'),
            e('button', {
              className: 'kbc-btn kbc-btn-ghost',
              disabled: busy,
              onClick: () => { setFormErrors([]); setDraft(parseDraftOf(p)) },
            }, editing ? '编辑中' : '编辑')),
          testNote[p.id] ? e('div', { className: 'kbc-parse-meta' }, testNote[p.id]) : null,
          editing ? formNode(draft) : null)
      }

      const jobRow = (j) => {
        const status = String(j.status || '')
        const landStatus = j.land && j.land.status ? String(j.land.status) : 'none'
        const canCancel = status === 'queued' || status === 'running'
        const canRetry = status === 'failed' || status === 'canceled' || (landStatus !== 'none' && landStatus !== 'landed')
        const canLand = (status === 'succeeded' || status === 'partial') && landStatus !== 'landed'
        const textChars = j.result && typeof j.result.textChars === 'number' ? j.result.textChars : null
        return e('div', { className: 'kbc-parse-row', key: j.jobId },
          e('div', { className: 'kbc-parse-head' },
            e('span', { className: 'kbc-parse-id' }, parseShortId(j.jobId)),
            e('span', { className: 'kbc-parse-badge' }, PARSE_KIND_TEXT[j.kind] || parseShow(j.kind)),
            e('span', { className: 'kbc-parse-badge' }, PARSE_JOB_STATUS[status] || parseShow(status)),
            landStatus === 'landed' ? e('span', { className: 'kbc-parse-badge' }, '已落库') : null),
          e('div', { className: 'kbc-parse-meta' },
            parseShow(j.source && j.source.relPath)
            + (textChars === null ? '' : ' · ' + textChars + ' 字符')
            + (j.stage ? ' · 阶段 ' + j.stage : '')
            + (j.land && j.land.entryId ? ' · 条目 ' + j.land.entryId : '')),
          e('div', { className: 'kbc-parse-actions' },
            e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => refreshJob(j.jobId) }, '详情'),
            e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => previewJob(j.jobId) }, '预览'),
            canCancel ? e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => cancelJob(j.jobId) }, '取消') : null,
            canRetry ? e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => retryJob(j.jobId) }, '重试') : null,
            canLand ? e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => landJob(j.jobId) }, '落库') : null))
      }

      const detailPanel = jobDetail === null ? null : e('div', { className: 'kbc-parse-form' },
        e('div', { className: 'kbf-run-row' },
          '任务 ' + parseShow(jobDetail.jobId) + ' · ' + (PARSE_JOB_STATUS[jobDetail.status] || parseShow(jobDetail.status))
          + ' · 尝试 ' + parseShow(jobDetail.attempts) + ' / ' + parseShow(jobDetail.maxAttempts)),
        e('div', { className: 'kbc-parse-meta' },
          '源文件 ' + parseShow(jobDetail.source && jobDetail.source.relPath)
          + ' · 格式 ' + parseShow(jobDetail.source && jobDetail.source.format)
          + ' · ' + fmtBytes(jobDetail.source && jobDetail.source.bytes)),
        e('div', { className: 'kbc-parse-meta' },
          '提供方 ' + parseShow(jobDetail.provider && jobDetail.provider.id)
          + ' · ' + parseShow(jobDetail.provider && jobDetail.provider.protocol)
          + ' · ' + parseShow(jobDetail.provider && jobDetail.provider.locality)
          + ' · ' + parseShow(jobDetail.provider && jobDetail.provider.model)),
        e('div', { className: 'kbc-parse-meta' }, '进度 ' + progressText(jobDetail)),
        e('div', { className: 'kbc-parse-meta' },
          '落库 ' + (jobDetail.land
            ? (PARSE_LAND_TEXT[jobDetail.land.status] || parseShow(jobDetail.land.status))
              + (jobDetail.land.entryId ? ' · ' + jobDetail.land.entryId : '')
              + (jobDetail.land.error ? ' · ' + jobDetail.land.error : '')
            : '未落库')),
        (jobDetail.diagnostics || []).length > 0
          ? e('div', { className: 'kbc-parse-err' },
            '诊断：' + jobDetail.diagnostics.map((x) => parseShow(x && x.code) + ' ' + parseShow(x && x.message)).join('；'))
          : null,
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => setJobDetail(null) }, '收起')))

      const previewPanel = jobPreview === null ? null : e('div', { className: 'kbc-parse-form' },
        e('div', { className: 'kbf-run-row' },
          '结果预览 ' + parseShortId(jobPreview.jobId) + ' · ' + parseShow(jobPreview.textChars) + ' 字符'
          + (jobPreview.truncated ? '（一次最多取 600 字符，已截断）' : '')),
        e('div', { className: 'kbc-parse-meta', style: { whiteSpace: 'pre-wrap' } },
          jobPreview.text === '' ? '（没有可显示的文本）' : jobPreview.text),
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => setJobPreview(null) }, '收起')))

      const waitingPanel = e('div', null,
        e('div', { className: 'kbc-set-h' }, '待解析 / 待识别'),
        e('div', { className: 'kbc-parse-actions' },
          e('input', {
            className: 'kbc-set-input',
            style: { maxWidth: 320 },
            value: waitImportId,
            placeholder: '导入任务的 importId（上面「导入进度」里那个会自动填进来）',
            spellCheck: false,
            onChange: (ev) => setWaitImportId(ev.target.value),
          }),
          e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: listWaiting }, '列出待解析项')),
        waitNote !== '' ? e('div', { className: 'kbc-set-hint' }, waitNote) : null,
        waiting === null
          ? null
          : waiting.items.length === 0
            ? e('div', { className: 'kbc-set-hint' }, '这个导入任务里没有待解析项')
            : e('div', { className: 'kbc-parse-list' }, waiting.items.map((it) => e('div', { key: String(it.rel), className: 'kbc-parse-row' },
              e('div', { className: 'kbc-parse-head' },
                e('span', { className: 'kbc-parse-id' }, String(it.rel || '')),
                e('span', { className: 'kbc-parse-badge' }, PARSE_KIND_TEXT[it.suggestedKind] || parseShow(it.suggestedKind)),
                e('span', { className: 'kbc-parse-badge' }, parseShow(it.parseStatus))),
              e('div', { className: 'kbc-parse-meta' },
                '分类 ' + parseShow(it.class)
                + (it.parseJobId ? ' · 任务 ' + parseShortId(it.parseJobId) : '')
                + (it.entryId ? ' · 条目 ' + it.entryId : '')),
              e('div', { className: 'kbc-parse-actions' },
                e('button', {
                  className: 'kbc-btn kbc-btn-ghost',
                  disabled: busy || waiting.parseAvailable === false,
                  onClick: () => parseWaiting(it),
                }, '解析'))))))

      return e('div', { className: 'kbc-parse-dev' },
        e('div', { className: 'kbc-set-h' }, '解析服务（OCR / ASR）'),
        e('div', { className: 'kbc-parse-dev-note' }, '开发中，现阶段使用可直接在聊天中告诉模型使用的本地模型或者使用其他插件接口。'),
        row('策略', policy === '' ? '（未读到）' : (policy === 'local-only' ? 'local-only（禁止云解析）' : policy)),
        e('div', { className: 'kbc-set-actions' },
          e('select', {
            className: 'kbc-set-input',
            style: { maxWidth: 240 },
            value: policy,
            disabled: busy || policy === '',
            onChange: (ev) => changePolicy(ev.target.value),
          },
          policy === '' ? e('option', { value: '' }, '（未读到）') : null,
          e('option', { value: 'local-only' }, 'local-only（禁止云解析）'),
          e('option', { value: 'allow-configured' }, 'allow-configured'))),
        e('div', { className: 'kbc-set-hint' },
          policy === 'local-only'
            ? 'local-only：所有位置为 cloud 的提供方都会被拒绝（云端 OCR / ASR 一律不可用），只能用位置为 local / lan 的。'
            : 'allow-configured：只放行你下面显式配置过的提供方；位置为 cloud 的会真的把文件发到外部服务。'),
        row('默认提供方（OCR）', defaults.ocr ? defaults.ocr : '未设置'),
        row('默认提供方（ASR）', defaults.asr ? defaults.asr : '未设置'),
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => load() }, busy ? '处理中…' : '刷新解析配置'),
          e('button', {
            className: 'kbc-btn kbc-btn-ghost',
            disabled: busy,
            onClick: () => { setFormErrors([]); setDraft(parseEmptyDraft('ocr', ((protocols && protocols.ocr) || [])[0] || '')) },
          }, '新增 OCR 提供方'),
          e('button', {
            className: 'kbc-btn kbc-btn-ghost',
            disabled: busy,
            onClick: () => { setFormErrors([]); setDraft(parseEmptyDraft('asr', ((protocols && protocols.asr) || [])[0] || '')) },
          }, '新增 ASR 提供方')),
        msg !== '' ? e('div', { className: 'kbc-set-msg' }, msg) : null,
        draft !== null && draft.isNew ? formNode(draft) : null,
        ['ocr', 'asr'].map((kind) => e('div', { key: kind },
          e('div', { className: 'kbc-set-h' }, (PARSE_KIND_TEXT[kind] || kind) + ' 提供方'),
          providersOf(kind).length === 0
            ? e('div', { className: 'kbc-set-hint' }, '还没有配置 ' + (PARSE_KIND_TEXT[kind] || kind) + ' 提供方')
            : e('div', { className: 'kbc-parse-list' }, providersOf(kind).map(providerRow)))),
        e('div', { className: 'kbc-set-h' }, '解析任务'),
        e('div', { className: 'kbc-set-actions' },
          e('button', { className: 'kbc-btn kbc-btn-ghost', onClick: () => loadJobs() }, '刷新任务')),
        e('div', { className: 'kbc-set-hint' },
          activeCount > 0
            ? '有 ' + activeCount + ' 个任务在排队 / 运行，每 5 秒自动刷新一次；全部结束后自动停止刷新。'
            : '只显示最近 8 个任务。'),
        jobs === null
          ? e('div', { className: 'kbc-set-hint' }, '还没有读取任务列表')
          : jobs.length === 0
            ? e('div', { className: 'kbc-set-hint' }, '还没有解析任务')
            : e('div', { className: 'kbc-parse-list' }, jobs.map(jobRow)),
        detailPanel,
        previewPanel,
        waitingPanel,
        toast ? e('div', { className: 'kbm-toast' }, toast) : null)
    }

    function apply(ctx) {
      flowClientContext = ctx
      ensureStyle()
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: 'kb-core', order: 26, label: () => '个人知识库' }, Section))
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({
          name: 'conversation.view',
          id: 'kb-map',
          order: 20,
          label: () => '知识库',
        }, KbView))
    }

    exports.name = 'kb-core'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
