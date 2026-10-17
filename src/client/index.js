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
          e('button', { className: 'kbc-btn kbc-btn-ghost', disabled: busy, onClick: () => refresh({ force: true }) }, '刷新状态')),

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

    function apply(ctx) {
      ensureStyle()
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: 'kb-core', order: 26, label: () => '个人知识库' }, Section))
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({
          name: 'conversation.view',
          id: 'kb-map',
          order: 20,
          label: () => '知识库',
        }, Overview))
    }

    exports.name = 'kb-core'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
