// Render the shipped ParseSection with synthetic progress events and slow API
// replies. This checks layout and native <details> state, not model quality.
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const modules = process.env.KB_TEST_NODE_MODULES
assert(modules, 'Set KB_TEST_NODE_MODULES to the existing desktop node_modules')
const require = createRequire(path.join(modules, 'package.json'))
const { build } = require('esbuild'), { chromium } = require('playwright')
const source = await readFile('src/client/index.js', 'utf8')
const section = source.slice(source.indexOf('    const PARSE_KIND_TEXT ='), source.indexOf('    const RELEASE_VERSION ='))
assert(section.includes('function ParseSection'))
const fixture = `import * as react from 'react'; import {createRoot} from 'react-dom/client';
const e=react.createElement, ensureStyle=()=>{}, useToast=()=>react.useState(''), fmtBytes=n=>String(n||0)+' B';
window.jobCalls=0; window.delay=30;
const callApi=async a=>{
 if(a.op==='parse.providers')return {ok:true,providers:[],defaultOcr:null,defaultAsr:null,externalPolicy:'local-only'};
 if(a.op==='parse.jobs'){window.jobCalls++;await new Promise(r=>setTimeout(r,window.delay));return {ok:true,total:1,jobs:[{jobId:a.kind+'-synthetic',kind:a.kind,status:'running',stage:'recognizing',source:{relPath:a.kind+'-synthetic.txt',format:'txt',bytes:12},progress:{pagesTotal:3,pagesDone:window.jobCalls},requestedBy:{origin:'ui'},provider:{id:'synthetic',protocol:'synthetic',locality:'local'}}]};}
 if(a.op==='parse.requests')return {ok:true,total:1,requests:[{requestId:a.kind+'-request',status:'accepted',kind:a.kind,source:{relPath:'synthetic.txt'},requestedBy:{origin:'ui'},createdAt:'2026-11-02T12:00:00Z',detail:'Synthetic request'}]};
 return {ok:true,items:[]};
};
${section}
createRoot(document.getElementById('root')).render(e(ParseSection));`
const bundled = await build({ stdin: { contents: fixture, resolveDir: path.resolve(modules), loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', write: false, nodePaths: [path.resolve(modules)] })
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' })
  res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}#root{height:520px;overflow:auto;padding:20px}.kbc-parse-row{padding:20px;border:1px solid #ccc;margin:12px 0}.kbc-set-row{padding:8px}.kbc-parse-actions{padding:10px}</style><div id="root"></div><script>' + bundled.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.KB_TEST_BROWSER || path.join(process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe') })
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }), errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByRole('button', { name: '任务记录', exact: true }).click()
  for (const kind of ['ocr', 'asr']) {
    if (kind === 'asr') await page.getByRole('tab', { name: '音频转写 ASR' }).click()
    const row = page.locator('div.kbc-parse-row').filter({ hasText: kind + '-synthetic.txt' })
    await row.waitFor()
    const submissions = page.locator('summary').filter({ hasText: '提交记录' })
    if (!await submissions.evaluate(summary => summary.parentElement.open)) await submissions.click()
    const detail = page.locator('article details summary')
    if (!await detail.evaluate(summary => summary.parentElement.open)) await detail.click()
    await page.evaluate(() => {
      window.keptDetails = document.querySelector('article details')
      document.getElementById('root').scrollTop = 60
      window.delay = 350
    })
    const before = await row.boundingBox(), calls = await page.evaluate(() => window.jobCalls)
    await page.evaluate(() => { for (let i = 0; i < 12; i++) window.dispatchEvent(new CustomEvent('kbw-policy', { detail: { type: 'parse-jobs-changed' } })) })
    await page.waitForFunction(count => window.jobCalls > count, calls)
    assert.equal(await page.getByText('正在读取任务记录…', { exact: true }).count(), 0)
    assert.equal((await row.boundingBox()).y, before.y, 'background refresh must not move the task row')
    await page.waitForTimeout(450)
    assert.equal(await page.evaluate(() => window.jobCalls), calls + 1, 'event burst must share one in-flight request')
    assert.equal(await page.evaluate(() => document.querySelector('article details') === window.keptDetails && window.keptDetails.open), true)
    assert.equal((await row.boundingBox()).y, before.y)
  }
  assert.deepEqual(errors, [])
  const out = path.resolve(process.env.KB_TEST_OUTPUT_DIR || path.join(os.tmpdir(), 'dsh-kb-parse-ui'))
  await mkdir(out, { recursive: true })
  await page.screenshot({ path: path.join(out, 'ocr-asr-tasks-synthetic.png') })
  console.log('PASS: OCR and ASR background refresh preserve row position and expanded details; 12 events use one request; no browser errors.')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
