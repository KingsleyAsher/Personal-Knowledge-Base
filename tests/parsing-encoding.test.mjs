// 编码回归：子进程环境最小化时，Python 的管道 stdout 用本地 ANSI 代码页（中文 Windows = GBK），
// 解析服务按 UTF-8 解码，含中文的路径会变乱码 → PDF 逐页 OCR 读不到渲染产物。
// 本测试先清掉 PYTHONIOENCODING / PYTHONUTF8，保证不依赖宿主环境；
// 若解析调用没有 -X utf8，本测试必失败（已用临时还原验证过）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createParsingService } from '../src/host/parsing.js'

delete process.env.PYTHONIOENCODING
delete process.env.PYTHONUTF8

const admin = { viaAdmin: true }
const root = await mkdtemp(path.resolve('..', 'encoding-qa-'))
const kbPath = path.join(root, '中文库名测试')

const waitJob = async (s, id, binding) => {
  for (let i = 0; i < 400; i++) {
    const j = await s.readJob(id, binding)
    if (j && ['succeeded', 'partial', 'failed', 'canceled'].includes(j.status)) return j
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('job timeout')
}

test('PDF page rendering survives non-ASCII paths with a clean minimal child env', async () => {
  const python = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim()
  await mkdir(kbPath)
  execFileSync(python, ['-X', 'utf8', '-c', 'import pymupdf,sys;d=pymupdf.open();d.new_page();d.new_page();d.save(sys.argv[1])', path.join(kbPath, 'two-pages.pdf')], { windowsHide: true })

  const binding = { kbId: 'synthetic', kbPath }
  let config = { parsing: { providers: [], externalPolicy: 'allow-configured' } }
  const seenImagePaths = []
  const service = createParsingService({
    stateDir: path.join(root, 'state'),
    getBinding: async () => binding,
    getCore: () => ({ getConfig: async () => config, setConfig: async patch => { config = { ...config, ...patch }; return { ok: true, revision: 1 } } }),
    credentialStore: { configured: async () => true, read: async () => ({ apiKey: 'fixture', secretKey: 'pair' }) },
    nativeRequest: async (p, url, init) => {
      if (url.includes('/token')) return { ok: true, json: { access_token: 'fixture-token', expires_in: 3600 } }
      const image = Buffer.from(new URLSearchParams(init.body).get('image'), 'base64')
      seenImagePaths.push(image.length)
      return { ok: true, json: { words_result: [{ words: '第 ' + seenImagePaths.length + ' 页识别' }] } }
    },
  })

  const provider = await service.saveProvider({ kind: 'ocr', vendor: 'baidu', credentialRef: 'SYNTHETIC', renderCommand: python }, admin)
  assert.equal(provider.ok, true)
  const submitted = await service.submit({ kind: 'ocr', providerId: provider.provider.id, sourceRel: 'two-pages.pdf' })
  assert.equal(submitted.ok, true, JSON.stringify(submitted))
  const job = await waitJob(service, submitted.jobId, binding)
  assert.equal(job.status, 'succeeded', JSON.stringify(job.diagnostics))
  assert.equal(seenImagePaths.length, 2, '每页都应把渲染出的 PNG 交给提供方')
  assert.ok(seenImagePaths.every(n => n > 0), '提供方收到的图像必须是真实文件内容')
})
