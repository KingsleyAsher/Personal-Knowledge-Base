// Targeted real-browser harness for the production refresh scheduler + watcher.
// The full DSH React/host facade is intentionally not simulated here.
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createCore } from '../src/host/kbcore.js'
import { createWorkbench } from '../src/host/workbench.js'

const require=createRequire(import.meta.url)
const { chromium }=require(path.join(process.env.KB_TEST_NODE_MODULES||'', 'playwright'))
const output=path.resolve(process.argv[2]||'../optimization-evidence');await mkdir(output,{recursive:true})
const base=await mkdtemp(path.join(os.tmpdir(),'kb-browser-')),root=path.join(base,'library'),stateDir=path.join(base,'state');await mkdir(root)
const core=createCore({stateDir},()=>{});await core.bind(root,{confirmInit:true})
const wb=createWorkbench({stateDir,getCore:()=>core});await wb.retrieval.automatic()
const source=await readFile(new URL('../src/client/workbench-ui.js',import.meta.url),'utf8')
const scheduler=source.slice(source.indexOf('  function refreshSchedule('),source.indexOf('  const btn ='))
let snapshots=0
const streams=new Set(),off=wb.subscribe(change=>{for(const res of streams)res.write('data: '+JSON.stringify(change)+'\n\n')})
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>知识库刷新简查 · 合成资料</title>
<style>body{font:18px system-ui;background:#f5f7f4;color:#20342c;margin:64px;max-width:800px}section{background:white;padding:32px;border:1px solid #d5dfd7;border-radius:16px}button{padding:12px 18px;font:inherit;background:#244d3d;color:white;border:0;border-radius:8px}small{display:block;margin:20px 0;color:#5d7065}</style>
<h1>事件刷新 · 浏览器简查</h1><small>合成资料，使用产品刷新调度与文件监听。此页为验收界面。</small>
<section><p id="state">读取中…</p><p id="count"></p><button id="refresh">刷新快照</button></section><script>
${scheduler}
window.refreshes=0;const updates=refreshSchedule(async()=>{const d=await(await fetch('/snapshot')).json();window.refreshes++;document.querySelector('#state').textContent='已读取 '+d.totals.files+' 份合成资料';document.querySelector('#count').textContent='刷新次数：'+window.refreshes;window.lastSnapshot=d});
const events=new EventSource('/events');events.onmessage=()=>updates.schedule();document.querySelector('#refresh').onclick=()=>updates.schedule(0);updates.schedule(0);
window.testUpdates=updates;window.hiddenForTest=false;Object.defineProperty(document,'hidden',{get:()=>window.hiddenForTest});
</script></html>`
const server=http.createServer(async(req,res)=>{
  try {
    if(req.url==='/snapshot'){snapshots++;res.setHeader('content-type','application/json');res.end(JSON.stringify(await wb.dispatch({op:'atlas.snapshot'})));return}
    if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': connected\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return}
    res.setHeader('content-type','text/html;charset=utf-8');res.end(html)
  }catch(e){res.statusCode=500;res.end(e.message)}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url='http://127.0.0.1:'+server.address().port
let browser
const errors=[],cases=[]
try {
  browser=await chromium.launch({headless:true,...(process.env.KB_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.KB_TEST_BROWSER_EXECUTABLE}:{})})
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  await page.clock.install()
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  await page.goto(url);await page.waitForFunction(()=>window.refreshes===1)
  assert.equal(await page.title(),'知识库刷新简查 · 合成资料');assert.equal(page.url(),url+'/')
  await page.getByRole('heading',{name:'事件刷新 · 浏览器简查'}).waitFor()
  const initial=await page.evaluate(()=>window.lastSnapshot.totals.files)
  await writeFile(path.join(root,'browser-external.txt'),'browser synthetic evidence')
  await page.waitForFunction(n=>window.lastSnapshot?.totals.files===n+1,initial)
  cases.push('外部文件变更通过真实 watcher/SSE 刷新快照')
  let before=await page.evaluate(()=>window.refreshes)
  await page.clock.fastForward(59000);assert.equal(await page.evaluate(()=>window.refreshes),before)
  await page.clock.fastForward(1250);await page.waitForFunction(n=>window.refreshes===n+1,before)
  cases.push('空闲 59 秒无轮询，60 秒兜底一次')
  before=await page.evaluate(()=>window.refreshes)
  await page.evaluate(()=>{for(let i=0;i<30;i++)window.testUpdates.schedule()})
  await page.clock.fastForward(250);await page.waitForFunction(n=>window.refreshes===n+1,before)
  cases.push('30 个连续事件合并为一次刷新')
  before=await page.evaluate(()=>window.refreshes)
  await page.evaluate(()=>{window.hiddenForTest=true;document.dispatchEvent(new Event('visibilitychange'))})
  await page.clock.fastForward(120000);assert.equal(await page.evaluate(()=>window.refreshes),before)
  await page.evaluate(()=>{window.hiddenForTest=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))})
  await page.clock.fastForward(250);await page.waitForFunction(n=>window.refreshes===n+1,before)
  cases.push('隐藏 120 秒无请求，恢复可见与焦点合并刷新')
  before=await page.evaluate(()=>window.refreshes)
  await page.getByRole('button',{name:'刷新快照'}).click();await page.clock.fastForward(250);await page.waitForFunction(n=>window.refreshes===n+1,before)
  await page.screenshot({path:path.join(output,'refresh-desktop.png')})
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'refresh-mobile.png')})
  assert.deepEqual(errors,[])
  const report={passed:true,url,title:await page.title(),browser:await browser.version(),browserPlugin:'not available',scope:'production scheduler + real synthetic-library watcher/SSE; full DSH React host not tested',cases,errors,snapshots}
  await writeFile(path.join(output,'refresh-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{
  await browser?.close();off();for(const res of streams)res.end();await new Promise(resolve=>server.close(resolve));wb.dispose();await rm(base,{recursive:true,force:true})
}
