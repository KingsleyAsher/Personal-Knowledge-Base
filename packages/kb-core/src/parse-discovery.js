import { opendir, readFile, stat, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

async function exists(p) { try { return (await stat(p)).isFile() } catch { return false } }
export function createParseDiscovery({ savedPaths = async () => [], savedServices = async () => [], savedDeployments = async () => [], probe = async () => null, limits = {} } = {}) {
  const scans = new Map()
  const maxEntries = limits.maxEntries ?? 20000, maxDepth = limits.maxDepth ?? 8
  const home = os.homedir()
  const known = {
    python: path.join(home, '.dsh', 'ocr-venv', 'Scripts', 'python.exe'),
    asrPython: '',
    ffmpeg: '',
    layout: '',
  }
  const snapshot = scan => ({ ok: true, scan: JSON.parse(JSON.stringify(scan)) })
  async function walk(scan, roots) {
    const seen = new Set()
    const deployments = await savedDeployments().catch(() => [])
    const renderCandidates = [path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p, 'python.exe'))]
    let renderPython = ''
    for (const candidate of renderCandidates) if (await exists(candidate)) { renderPython = candidate; break }
    const queue = roots.map(root => ({ dir: root, depth: 0 }))
    const add = row => { if (!scan.results.some(r => r.path === row.path)) scan.results.push({ id: randomUUID(), ...row }) }
    try {
      while (queue.length && !scan.cancelRequested && scan.entries < maxEntries) {
        const { dir, depth } = queue.shift()
        try {
          if ((await lstat(dir)).isSymbolicLink()) continue
          const resolved = await realpath(dir)
          const saved = deployments.find(p => [p.modelPath, p.layoutModelPath, p.detModelPath, p.recModelPath].filter(Boolean).some(v => path.resolve(v).toLowerCase() === resolved.toLowerCase()))
          const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
          if (seen.has(key)) continue
          seen.add(key)
          const handle = await opendir(dir)
          const names = [], dirs = []
          for await (const ent of handle) {
            if (scan.cancelRequested || scan.entries >= maxEntries) { scan.incomplete = true; break }
            scan.entries++
            if (ent.isSymbolicLink()) continue
            if (ent.isDirectory()) dirs.push(ent.name)
            else if (ent.isFile()) names.push(ent.name)
          }
          scan.directories++
          if (names.includes('pyvenv.cfg')) add({ name: path.basename(dir), role: 'python', kind: /asr/i.test(dir) ? 'asr' : 'ocr', path: resolved, status: 'component', evidence: ['pyvenv.cfg', '独立 Python 环境'], missing: ['在模型配置中选择此环境；依赖需另行检查'], candidate: null })
          if (names.includes('ffmpeg.exe')) add({ name: 'FFmpeg', role: 'ffmpeg', kind: 'asr', path: path.join(resolved, 'ffmpeg.exe'), status: 'component', evidence: ['ffmpeg.exe'], missing: ['在 ASR 高级设置中选择此程序'], candidate: null })
          const configName = names.find(n => n === 'config.json' || n === 'inference.yml' || n === 'inference.yaml')
          let config = ''
          if (configName && (await stat(path.join(dir, configName))).size < 128 * 1024) config = await readFile(path.join(dir, configName), 'utf8')
          const weights = names.some(n => /\.(safetensors|bin|pdparams|pdiparams|gguf)$/i.test(n) || /\.safetensors\.index\.json$/.test(n))
          const identity = config + ' ' + path.basename(dir)
          if (weights || configName) {
            const qwen = /qwen.?3.?asr/i.test(identity), paddle = /paddleocr.?vl/i.test(identity)
            const role = /PP-DocLayout/i.test(identity) ? 'layout' : /PP-OCR.*?[_-]det/i.test(identity) ? 'detection' : /PP-OCR.*?[_-]rec/i.test(identity) ? 'recognition' : qwen || paddle ? 'weights' : 'unknown'
            const kind = qwen ? 'asr' : 'ocr'
            const runtimeCandidates = [saved?.command, path.join(dir, '.venv', 'Scripts', 'python.exe'), path.join(path.dirname(dir), '.venv', 'Scripts', 'python.exe'), path.join(path.dirname(dir), 'venv', 'Scripts', 'python.exe'), qwen ? known.asrPython : known.python].filter(Boolean)
            let runtime = runtimeCandidates.at(-1)
            for (const candidate of runtimeCandidates) if (await exists(candidate)) { runtime = candidate; break }
            const hasRuntime = await exists(runtime)
            const missing = [...(!weights ? ['未找到本地权重文件'] : []), ...(!hasRuntime ? ['未找到匹配的 Python 环境'] : []), ...(qwen && !(await exists(known.ffmpeg)) ? ['FFmpeg'] : [])]
            const candidate = (qwen || paddle) ? { kind, vendor: 'local', protocol: qwen ? 'qwen3-local' : 'paddle-local', locality: 'local', command: hasRuntime ? runtime : '', modelPath: resolved, ffmpegCommand: qwen ? known.ffmpeg : '', renderCommand: paddle && hasRuntime ? runtime : '', model: qwen ? 'Qwen3-ASR-1.7B' : 'PaddleOCR-VL', label: qwen ? '本地 Qwen3-ASR' : '本地 PaddleOCR-VL' } : null
            if (weights || qwen || paddle) add({ name: qwen ? 'Qwen3-ASR' : paddle ? 'PaddleOCR-VL' : path.basename(dir), role, kind, path: resolved, evidence: [configName, weights ? '权重文件标记' : '缺少权重标记'].filter(Boolean), status: ['layout', 'detection', 'recognition'].includes(role) ? 'component' : !qwen && !paddle ? 'unsupported' : missing.length ? 'missing-runtime' : 'unverified', missing: role === 'layout' ? ['这是版面分析组件；需关联视觉识别服务或文字识别管线'] : missing, candidate: candidate ? { ...candidate, layoutModelPath: paddle ? known.layout : '' } : ['layout', 'detection', 'recognition'].includes(role) ? { kind: 'ocr', vendor: 'local', protocol: role === 'layout' ? 'paddle-service' : 'ppocr-local', locality: 'local', command: hasRuntime ? runtime : '', renderCommand: hasRuntime ? runtime : '', baseUrl: '', layoutModelPath: role === 'layout' ? resolved : '', detModelPath: role === 'detection' ? resolved : '', recModelPath: role === 'recognition' ? resolved : '', model: role === 'layout' ? 'PaddleOCR-VL-1.6-0.9B' : 'PP-OCR', label: '本地 OCR 服务' } : null })
          }
          for (const name of dirs) {
            if (['.git', 'node_modules', '__pycache__', '.venv', 'Scripts', 'Lib'].includes(name)) continue
            if (depth < maxDepth) queue.push({ dir: path.join(dir, name), depth: depth + 1 })
            else scan.incomplete = true
          }
          await new Promise(resolve => setImmediate(resolve))
        } catch (e) {
          if (scan.mode === 'quick' && roots.includes(dir) && e.code === 'ENOENT') continue
          scan.issues.push({ path: dir, reason: e.code || 'READ_FAILED' }); scan.incomplete = true
        }
      }
      if (queue.length) scan.incomplete = true
      if (scan.mode === 'quick' && !scan.cancelRequested) {
        const urls = [...new Set(await savedServices())].slice(0, 8)
        for (const baseUrl of urls) {
          if (scan.cancelRequested) break
          const service = await probe(baseUrl)
          if (service) add({ name: 'PaddleOCR-VL 本地部署', role: 'service', kind: 'ocr', path: baseUrl, status: 'reachable', evidence: ['模型列表包含 PaddleOCR-VL', '关联本机 Python 与 PP-DocLayoutV3'], missing: [...(!(await exists(known.python)) ? ['OCR Python 环境'] : []), ...(!(await exists(path.join(known.layout, 'inference.pdiparams'))) ? ['PP-DocLayoutV3 版面模型'] : [])], candidate: { kind: 'ocr', vendor: 'local', protocol: 'paddle-service', locality: 'local', baseUrl, model: service, command: await exists(known.python) ? known.python : '', layoutModelPath: known.layout, renderCommand: renderPython || known.python, label: '本地 PaddleOCR-VL' } })
        }
      }
      const det = scan.results.find(r => r.role === 'detection'), rec = scan.results.find(r => r.role === 'recognition')
      for (const r of scan.results) {
        if (r.candidate?.kind === 'ocr' && renderPython) r.candidate.renderCommand = renderPython
        if (r.candidate?.protocol === 'ppocr-local') {
          r.candidate.detModelPath = det?.path || r.candidate.detModelPath
          r.candidate.recModelPath = rec?.path || r.candidate.recModelPath
          const versions = [det?.name, rec?.name].map(n => /PP-OCRv([45])/.exec(n || '')?.[1])
          r.missing = !det || !rec ? ['请补齐文字检测和文字识别模型目录'] : versions[0] && versions[0] === versions[1] ? [] : ['首版通用管线支持配套的 PP-OCRv4 / v5；当前版本需手动核对']
          r.status = r.missing.length ? 'component' : 'unverified'
        }
      }
      scan.status = scan.cancelRequested ? 'canceled' : 'done'
    } catch { scan.status = 'failed'; scan.incomplete = true }
  }
  return {
    async start({ mode = 'quick', directory } = {}) {
      if (!['quick', 'directory'].includes(mode)) return { ok: false, reason: 'BAD_SCAN_MODE' }
      let roots
      if (mode === 'directory') {
        if (typeof directory !== 'string' || !path.isAbsolute(directory)) return { ok: false, reason: 'ABSOLUTE_DIRECTORY_REQUIRED' }
        try { if (!(await lstat(directory)).isDirectory()) return { ok: false, reason: 'NOT_DIRECTORY' } } catch { return { ok: false, reason: 'DIRECTORY_MISSING' } }
        roots = [directory]
      } else roots = [...new Set([...(await savedPaths()), path.join(home, '.cache', 'huggingface', 'hub'), path.join(home, '.paddlex', 'official_models'), path.dirname(path.dirname(known.python))].filter(Boolean))]
      if ([...scans.values()].some(s => s.status === 'running')) return { ok: false, reason: 'SCAN_RUNNING' }
      while (scans.size >= 8) scans.delete(scans.keys().next().value)
      const scan = { id: randomUUID(), mode, roots, status: 'running', entries: 0, directories: 0, incomplete: false, issues: [], results: [], cancelRequested: false }
      scans.set(scan.id, scan)
      void walk(scan, roots)
      return snapshot(scan)
    },
    get(id) { const scan = scans.get(id); return scan ? snapshot(scan) : { ok: false, reason: 'SCAN_NOT_FOUND' } },
    cancel(id) { const scan = scans.get(id); if (!scan) return { ok: false, reason: 'SCAN_NOT_FOUND' }; scan.cancelRequested = true; scan.incomplete = true; return snapshot(scan) },
    candidate(id, resultId) { const scan = scans.get(id); return scan && ['done', 'canceled'].includes(scan.status) ? scan.results.find(r => r.id === resultId)?.candidate : null },
  }
}
