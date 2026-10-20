// Real browser + real workbench service, with a synthetic library and a small host facade.
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'
import { sharedDraft, captureDocument } from '../src/host/capture-surface.js'
const require = createRequire(import.meta.url)
const runtime = process.env.KB_QA_NODE_MODULES

const { PDFDocument, StandardFonts } = require(runtime ? path.join(runtime, 'pdf-lib') : 'pdf-lib')
const output = path.resolve('../beta4-browser-evidence')
let failUpdates = false
const root = path.join(output, 'library'), stateDir = path.join(output, 'state')
await mkdir(root,{recursive:true})
const core = createCore({ stateDir }, () => {})
assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
await writeFile(path.join(root, '20-知识笔记/alpha.md'), '---\ntitle: Alpha 浏览器样本\ntype: 知识\ntags: [浏览器]\nstatus: 进行中\nupdated: 2026-10-20\n---\n公开蓝鲸证据。\n[来源](beta.md)\n')
await writeFile(path.join(root, '20-知识笔记/beta.md'), '# Beta\n公开蓝鲸第二份。')
await writeFile(path.join(root, '00-画像/secret.md'), '# 私密浏览器样本\n仅供虚构测试。')
const pdf = await PDFDocument.create(); const pdfPage = pdf.addPage([440, 320]); pdfPage.drawText('Synthetic PDF evidence', { x: 35, y: 245, font: await pdf.embedFont(StandardFonts.Helvetica), size: 19 })
await writeFile(path.join(root, '20-知识笔记/sample.pdf'), await pdf.save())
for (let i=0;i<8;i++) await writeFile(path.join(root,'20-知识笔记',`sample-${i}.md`),`---
title: ${['函数性质与证明方法','资料整理的三个步骤','阅读中的问题清单','课程复习与来源追踪','项目方案与关键决策','每周知识回顾','文档的引用与核对','成品归档与检索'][i]}
type: 知识
tags: [虚构资料, 方法]
updated: 2026-10-21
---
# 阅读与整理

这是一份用于界面验收的虚构资料。记录关键结论，保留来源，让下一次查找更容易。

## 操作步骤

- 保存原始资料
- 提取有依据的结论
- 检查引用是否有效

| 项目 | 状态 |
|---|---|
| 原件 | 已保留 |
| 来源 | 已核对 |

[相关资料](alpha.md)
[失效样本](missing-${i}.md)
`)
await core.maintainIndex()
const workbench = createWorkbench({ stateDir, getCore: () => core })
const frontend = await readFile('../host-api-reference/frontend-index.js', 'utf8')
const end = frontend.indexOf(';var Th;', frontend.indexOf('const vC=')) + 1
assert(end > 1000)
const react = frontend.slice(0, end).replaceAll('./vendor-DcuzkuQH.js', '/vendor.js') + '\nexport {sC as React,yC as ReactDOM};'
const plugin = await readFile('src/client/index.js')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/host-index.css"><link rel="stylesheet" href="/host-vendor.css"><title>知识工作台验收 · 虚构库</title></head><body data-ds-dark-theme style="margin:0;background:#18191b;color:#eee"><aside style="position:fixed;inset:0 auto 0 0;width:210px;box-sizing:border-box;background:#202124;padding:22px;color:#bec4ca;font:14px system-ui">DeepSeek Harness<br><br>虚构资料验收环境<br><br>知识库</aside><main style="margin-left:210px;height:calc(100vh - 104px);padding-top:12px"><div id="root" style="height:100%"></div></main><footer style="position:fixed;bottom:16px;left:calc(50% + 100px);transform:translateX(-50%);width:min(700px,65vw);height:68px;box-sizing:border-box;background:#2b2d30;border:1px solid #444;border-radius:18px;padding:18px;color:#aaa;font:13px system-ui">发消息或创建任务… · 此处模拟宿主底部输入区</footer><script type="module">
import {React,ReactDOM} from '/react.js';
window.kbSources=[]; window.qaDraft='';
const dom={...ReactDOM,createPortal:node=>node};
const shell={state:{getSnapshot:()=>({draft:window.qaDraft})}};
const actx={get:n=>n==='conversation'?{input:{for:()=>shell}}:undefined};
const services={inputTriggers:{registerSource:s=>{kbSources.push(s);return ()=>{}}},sessions:{scope:()=>actx}};
const registry={}, root=ReactDOM.createRoot(document.getElementById('root'));
const render=()=>{if(registry['kb-map'])root.render(React.createElement(React.Fragment,null,React.createElement(registry['kb-map']),registry['kb-release-notice']?React.createElement(registry['kb-release-notice']):null))};
const slots={inject:(_,fn)=>fn(),register:(opts,C)=>{registry[opts.id]=C;render();return ()=>{}}};
const ctx={get:n=>services[n],effect:fn=>fn(),inject:(deps,fn)=>{if(deps.every(d=>services[d]))return fn(ctx)},slots};
window.__ModuleLoader__={load:entry=>entry.factory(n=>{if(n==='react')return React;if(n==='react-dom')return dom;throw Error('Unknown module '+n)}).apply(ctx)};
await import('/plugin.js');
</script></body></html>`
const streams = new Set()
workbench.subscribe(ev => { for (const res of streams) res.write('data: ' + JSON.stringify(ev) + '\n\n') })
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
    if (url.pathname === '/kb-core/collect') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); return res.end(captureDocument(await readFile('src/client/capture.html', 'utf8'), await sharedDraft(req))) }
    if (['capture.js','capture-sw.js','capture.css','capture.webmanifest','capture-icon.svg','capture-icon-192.png','capture-icon-512.png'].some(name => url.pathname === '/kb-core/' + name)) {
      const name = url.pathname.split('/').at(-1)
      res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : 'application/manifest+json' })
      return res.end(await readFile(path.join('src/client', name)))
    }
    if (url.pathname.startsWith('/kb-core/pdf-assets/')) {
      const rel = url.pathname.slice('/kb-core/pdf-assets/'.length)
      assert(!rel.includes('..'))
      res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' })
      return res.end(await readFile(path.join('src/client/pdfjs', rel)))
    }
    if (url.pathname === '/kb-core/workbench-events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n'); streams.add(res); res.on('close', () => streams.delete(res)); return }
    if (url.pathname === '/kb-core/api') {
      let body = ''; for await (const chunk of req) body += chunk
      const args = JSON.parse(body || '{}'); let result
      if (args.op === 'status') result = { ok: true, status: { ...await core.status(), build: { version: '2.0.1-beta4' } } }
      else if (args.op === 'parse.providers') result = {ok:true,externalPolicy:'local-only',providers:[{id:'local-ocr',kind:'ocr',label:'本地 PaddleOCR-VL',model:'PaddleOCR-VL',locality:'local',locale:'本机',enabled:true},{id:'local-asr',kind:'asr',label:'本地 Qwen3-ASR',model:'Qwen3-ASR-1.7B',locality:'local',locale:'本机',enabled:true}],defaultOcr:'local-ocr',defaultAsr:'local-asr'}
      else if (args.op === 'parse.jobs') result={ok:true,jobs:[]}
      else if (args.op === 'updates.check') result = failUpdates ? { ok: false, error: '检查更新失败：所有更新源暂不可用，请稍后重试', sourceStatus: ['gitee','gitcode','github'].map((id, i) => ({ id, name: ['Gitee','GitCode','GitHub'][i], ok: false, error: '连接超时' })) } : { ok: true, currentVersion: '2.0.1-beta4', latestVersion: '1.1.6', sourceName: 'Gitee', updateAvailable: false,
        sourceStatus: [{ id: 'gitee', name: 'Gitee', ok: true, version: '1.1.6' }, { id: 'gitcode', name: 'GitCode', ok: true, version: '1.1.6' }, { id: 'github', name: 'GitHub', ok: false, error: '连接超时' }],
        downloadSources: [{ id: 'gitee', name: 'Gitee', url: 'https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-1.1.6.tgz' }, { id: 'gitcode', name: 'GitCode', url: 'https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-1.1.6.tgz?ref=main' }] }
      else result = await workbench.dispatch(args)
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(result))
    }
    const files = { '/react.js': react, '/vendor.js': await readFile('../host-api-reference/vendor.js'), '/plugin.js': await readFile('src/client/index.js'),
      '/kb-core/pdfjs.mjs': await readFile('src/client/pdfjs/pdf.mjs'), '/kb-core/pdf.worker.mjs': await readFile('src/client/pdfjs/pdf.worker.mjs') }
    if (url.pathname === '/host-index.css' || url.pathname === '/host-vendor.css') { res.writeHead(200, {'content-type':'text/css'}); return res.end(await readFile(path.join(output,url.pathname === '/host-index.css' ? 'index-BxpfOGf3.css':'vendor-DV2921Zo.css'))) }
    if (files[url.pathname]) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(files[url.pathname]) }
    const page = html.replace('</head>', '<style>@media(max-width:700px){body>aside{display:none}main{margin-left:0!important}footer{left:50%!important;width:94vw!important}}</style></head>')
    res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(url.searchParams.get('theme') === 'light' ? page.replace('data-ds-dark-theme', 'data-qa-light').replace('background:#18191b;color:#eee', 'background:#fafafa;color:#202124') : page)
  } catch (error) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: error.code, error: error.message })) }
})
await new Promise(resolve => server.listen(Number(process.env.BETA4_PORT || 47744), '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port
console.log(JSON.stringify({url,output,library:root,synthetic:true,actualHostStyles:true}));
