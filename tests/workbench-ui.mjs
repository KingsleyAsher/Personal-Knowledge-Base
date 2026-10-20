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
const runtime = 'C:/Users/Kingsley Asher/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/'
const { chromium } = require(runtime + 'playwright')
const { PDFDocument, StandardFonts } = require(runtime + 'pdf-lib')
const output = await mkdtemp(path.resolve('../workbench-ui-qa-'))
const root = path.join(output, 'library'), stateDir = path.join(output, 'state')
await mkdir(root)
const core = createCore({ stateDir }, () => {})
assert.equal((await core.bind(root, { confirmInit: true })).ok, true)
await writeFile(path.join(root, '20-知识笔记/alpha.md'), '---\ntitle: Alpha 浏览器样本\ntype: 知识\ntags: [浏览器]\nstatus: 进行中\nupdated: 2026-10-20\n---\n公开蓝鲸证据。\n[来源](beta.md)\n')
await writeFile(path.join(root, '20-知识笔记/beta.md'), '# Beta\n公开蓝鲸第二份。')
await writeFile(path.join(root, '00-画像/secret.md'), '# 私密浏览器样本\n仅供虚构测试。')
const pdf = await PDFDocument.create(); const pdfPage = pdf.addPage([440, 320]); pdfPage.drawText('Synthetic PDF evidence', { x: 35, y: 245, font: await pdf.embedFont(StandardFonts.Helvetica), size: 19 })
await writeFile(path.join(root, '20-知识笔记/sample.pdf'), await pdf.save())
await core.maintainIndex()
const workbench = createWorkbench({ stateDir, getCore: () => core })
const frontend = await readFile('../host-api-reference/frontend-index.js', 'utf8')
const end = frontend.indexOf(';var Th;', frontend.indexOf('const vC=')) + 1
assert(end > 1000)
const react = frontend.slice(0, end).replaceAll('./vendor-DcuzkuQH.js', '/vendor.js') + '\nexport {sC as React,yC as ReactDOM};'
const plugin = await readFile('src/client/index.js')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>知识工作台验收 · 虚构库</title></head><body style="margin:0;background:#fafbf9;color:#24352b"><div id="root" style="height:100vh"></div><script type="module">
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
      if (args.op === 'status') result = { ok: true, status: { ...await core.status(), build: { version: '2.0.1-beta1' } } }
      else if (args.op === 'parse.providers') result = { ok: true, providers: [], defaultOcr: null, defaultAsr: null }
      else if (args.op === 'updates.check') result = { ok: true, currentVersion: '2.0.1-beta1', updateAvailable: false }
      else result = await workbench.dispatch(args)
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(result))
    }
    const files = { '/react.js': react, '/vendor.js': await readFile('../host-api-reference/vendor.js'), '/plugin.js': plugin,
      '/kb-core/pdfjs.mjs': await readFile('src/client/pdfjs/pdf.mjs'), '/kb-core/pdf.worker.mjs': await readFile('src/client/pdfjs/pdf.worker.mjs') }
    if (files[url.pathname]) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(files[url.pathname]) }
    res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html)
  } catch (error) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: error.code, error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []; page.on('pageerror', e => errors.push(e.stack || e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
const cases = []
try {
  await page.goto(url)
  await page.getByRole('heading', { name: '知识库插件已更新' }).waitFor()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  assert.equal(await page.getByRole('checkbox', { name: '自动完整备份', exact: true }).isChecked(), false)
  assert.equal(await page.getByRole('checkbox', { name: '展示隐私内容', exact: true }).isChecked(), false)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '保存并开始使用' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: '搜索知识库' }).fill('完全不存在的验收关键词')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.locator('.kbw-list').getByText('当前范围没有匹配的内容', { exact: true }).waitFor()
  await page.getByLabel('搜索方式').selectOption('body')
  await page.getByRole('textbox', { name: '搜索知识库' }).fill('公开蓝鲸')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.locator('.kbw-list').getByRole('button', { name: /Alpha 浏览器样本/ }).waitFor()
  assert.equal(await page.locator('.kbw-list .kbw-row').count(), 2)
  await page.getByRole('textbox', { name: '搜索知识库' }).fill('')
  await page.getByLabel('搜索方式').selectOption('path')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  cases.push('文件筛选无结果和正文搜索返回真实匹配摘录')
  await page.getByRole('button', { name: /Alpha 浏览器样本/ }).click()
  await page.locator('.kbw-detail h2').waitFor()
  assert((await page.locator('.kbw-preview').innerText()).includes('公开蓝鲸证据'))
  cases.push('首次引导默认关闭备份与隐私，保存后目录地图和正文预览可用')
  await page.locator('.kbw-detail summary').filter({ hasText: '高亮摘录' }).click()
  await page.getByLabel('摘录原文（可在上方选中文字）').fill('公开蓝鲸证据。')
  await page.getByLabel('批注', { exact: true }).fill('浏览器批注样本')
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await page.locator('.kbw-preview mark').waitFor()
  cases.push('摘录保存后在原文中高亮')
  await page.getByRole('navigation').getByRole('button', { name: '收件箱', exact: true }).click()
  await page.getByLabel('标题（可留空）').fill('浏览器快速记录')
  await page.getByLabel('记录内容').fill('来自真实浏览器交互的虚构内容')
  await page.getByRole('button', { name: '保存到快速收集', exact: true }).click()
  await page.getByText('浏览器快速记录', { exact: true }).waitFor()
  cases.push('快速采集保存到服务端并进入收件箱清单')
  await page.getByRole('navigation').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('checkbox', { name: '展示隐私内容', exact: true }).check()
  assert.equal(await page.getByRole('checkbox', { name: '允许知识库提问使用隐私内容', exact: true }).isChecked(), false)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '保存并开始使用' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('navigation').getByRole('button', { name: '地图', exact: true }).click()
  await page.locator('.kbw-breadcrumb').getByRole('button', { name: '全库', exact: true }).click()
  await page.locator('.kbw-list').getByRole('button', { name: /secret/ }).waitFor()
  cases.push('隐私展示开启后可浏览，问答许可仍独立关闭')
  await page.getByRole('navigation').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('checkbox', { name: '展示隐私内容', exact: true }).uncheck()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '保存并开始使用' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.locator('.kbw-list').getByRole('button', { name: /secret/ }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /sample.pdf/ }).click()
  await page.locator('.kbw-pdf-page canvas').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.kbw-pdf-text span').length > 0)
  await page.getByRole('checkbox', { name: '区域摘录', exact: true }).check()
  const region = await page.locator('.kbw-pdf-region').boundingBox()
  await page.mouse.move(region.x + 35, region.y + 45); await page.mouse.down(); await page.mouse.move(region.x + 230, region.y + 125); await page.mouse.up()
  await page.locator('.kbw-detail summary').filter({ hasText: '高亮摘录' }).click()
  assert.equal(await page.getByLabel('摘录原文（可在上方选中文字）').inputValue(), '第 1 页区域摘录')
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  await page.locator('.kbw-pdf-highlight').waitFor()
  cases.push('PDF 区域框选产生截图摘录，保存后在原页显示高亮')
  await page.screenshot({ path: path.join(output, 'desktop-pdf.png') })
  cases.push('隐私关闭清除结果，本地 PDF.js 实际渲染页面与可选文字层')
  const native = await page.evaluate(async () => {
    const source = kbSources.find(s => s.name === 'knowledge-base')
    const items = await source.candidates({ sessionId: 'synthetic-session' }, { query: '', signal: new AbortController().signal })
    const outcome = source.onPick({ candidate: items[0] })
    qaDraft = '@基于知识库提问 公开蓝鲸证据'
    return { trigger: source.trigger, prompt: await source.codec.serialize(outcome.insert.ref, new AbortController().signal) }
  })
  assert.equal(native.trigger, '@'); assert(native.prompt.includes('knowledge_sources')); assert(native.prompt.includes('公开蓝鲸证据'))
  cases.push('原生 @ 源的候选、引用插入与发送时检索序列化契约通过')
  await page.getByRole('navigation').getByRole('button', { name: '关系', exact: true }).click()
  await page.locator('.kbw-graph').waitFor()
  await page.screenshot({ path: path.join(output, 'desktop-relations.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation').getByRole('button', { name: '地图', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'mobile-map.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.body.style.background = '#191d1a'; document.body.style.color = '#e1e8e3' })
  await page.screenshot({ path: path.join(output, 'mobile-dark.png') })
  await page.reload()
  await page.getByRole('navigation').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  cases.push('390px 手机无页面横溢，浅深色截图及刷新后不重复引导')
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } }), quick = await mobile.newPage()
  await quick.goto(url + '/kb-core/collect?title=' + encodeURIComponent('手机分享样本') + '&text=' + encodeURIComponent('分享后先确认'))
  assert.equal(await quick.getByLabel('标题', { exact: true }).inputValue(), '手机分享样本')
  assert(!(await workbench.dispatch({ op: 'capture.list' })).items.some(c => c.title === '手机分享样本'))
  await quick.getByRole('button', { name: '确认保存到知识库' }).click()
  await quick.getByRole('status').filter({ hasText: '已保存 1 项' }).waitFor()
  assert((await workbench.dispatch({ op: 'capture.list' })).items.some(c => c.title === '手机分享样本'))
  await quick.evaluate(() => navigator.serviceWorker.ready)
  await quick.getByLabel('内容', { exact: true }).fill('离线草稿样本')
  await mobile.setOffline(true); await quick.reload()
  assert.equal(await quick.getByLabel('内容', { exact: true }).inputValue(), '离线草稿样本')
  await mobile.setOffline(false)
  await quick.screenshot({ path: path.join(output, 'mobile-capture.png') })
  await mobile.close()
  cases.push('手机分享先确认才保存，PWA 仅缓存外壳，离线文字草稿重载保留')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, url, viewports: ['1440x960', '390x844'], cases, screenshots: output, browser: 'Browser plugin not available; bundled Playwright' }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ error: error.message, errors, output, cases }, null, 2)); throw error
} finally { await browser.close(); for (const res of streams) res.end(); await new Promise(resolve => server.close(resolve)) }
