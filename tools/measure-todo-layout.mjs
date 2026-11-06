// Isolated CSS geometry check. This is NOT installed DSH or real-event evidence.
import { chromium } from '../apps/desktop/node_modules/playwright/index.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../src/client/todo-lifecycle-ui.js', import.meta.url), 'utf8')
const css = source.match(/const css = `([\s\S]*?)`/)[1]
const output = resolve(process.argv[2] || '.test-runs/todo-layout')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  const rows = []
  for (const fallback of [false, true]) for (const width of [320, 1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      body{margin:0} .column{width:calc(100% - ${width < 600 ? 0 : 280}px);margin-left:auto;container-type:inline-size}
      .dock{${fallback ? '' : '--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;--dsh-chat-content-width:clamp(680px,64cqw,920px);--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);'}}
      .official{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px)*2 - var(--dsh-composer-dock-inset,8px)*4);max-width:calc(var(--dsh-composer-card-max-width,952px) - var(--dsh-composer-dock-inset,8px)*4);margin:0 auto;border:.5px solid}
      .card{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,952px);margin:auto;border:1px solid}
      ${css}</style><div class="column"><div class="dock"><section data-todo-lifecycle-panel>任务计划 · 合成布局检查</section><section class="official">官方公式对照（非官方组件）</section><div class="card">输入卡片公式对照（非真实输入框）</div></div></div>`)
    const row = await page.evaluate(() => {
      const panel = document.querySelector('[data-todo-lifecycle-panel]'), style = getComputedStyle(panel)
      return { panel: panel.getBoundingClientRect().width, officialFormula: document.querySelector('.official').getBoundingClientRect().width,
        cardFormula: document.querySelector('.card').getBoundingClientRect().width, scrollWidth: document.documentElement.scrollWidth,
        variables: Object.fromEntries(['side-clearance', 'dock-inset', 'card-max-width'].map(key => [key, style.getPropertyValue('--dsh-composer-' + key).trim()])) }
    })
    assert.ok(Math.abs(row.panel - row.officialFormula) <= 2)
    assert.ok(row.scrollWidth <= width)
    rows.push({ viewport: width, fallback, ...row })
  }
  await writeFile(resolve(output, 'layout.json'), JSON.stringify({ evidence: 'isolated Edge CSS harness, not installed desktop', rows }, null, 2) + '\n')
  console.log(JSON.stringify(rows, null, 2))
} finally { await browser.close() }
