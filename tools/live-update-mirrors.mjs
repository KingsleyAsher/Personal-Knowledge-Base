import { createUpdateChecker, createUpdateDownloader } from '../src/host/updates.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = await mkdtemp(path.join(repo, '../mirror-live-'))
const results = []
for (const id of ['gitee', 'gitcode']) {
  const checker = createUpdateChecker({ currentVersion: '1.1.3', sourceIds: [id], timeoutMs: 15000 })
  const checked = await checker.check()
  let download
  if (checked.ok) {
    try {
      download = await createUpdateDownloader({ checker, cacheDir, timeoutMs: 20000 }).prepare({ expectedVersion: checked.latestVersion })
    } catch (error) { download = { ok: false, error: error.message } }
  }
  const result = { source: id, checked, download }
  results.push(result)
  console.log(JSON.stringify({ source: id, check: checked.ok, version: checked.latestVersion, status: checked.sourceStatus, download: download?.ok, error: download?.error }))
}
await writeFile(path.join(cacheDir, 'verification.json'), JSON.stringify(results, null, 2))
console.log('Report:', path.join(cacheDir, 'verification.json'))
if (results.some(x => !x.checked.ok || !x.download?.ok)) process.exitCode = 1
