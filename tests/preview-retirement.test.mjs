import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateChecker } from '../src/host/updates.js'

const stable = { package: '@local/dsh-knowledge-base', version: '2.1.1', tgz: 'local-dsh-knowledge-base-2.1.1.tgz', sha256: 'a'.repeat(64), buildId: 'b'.repeat(16), bytes: 100 }
const inactive = { package: stable.package, channel: 'preview', active: false }
const old = { ...stable, version: '2.1-beta4', tgz: 'local-dsh-knowledge-base-2.1-beta4.tgz' }
test('retired or stale preview mirrors never expose an obsolete download', async () => {
  for (const feed of [inactive, old]) {
    const checker = createUpdateChecker({ currentVersion: '2.1.1', fetch: async url => Response.json(url.includes('preview-manifest.json') ? feed : stable) })
    const result = await checker.check()
    assert.equal(result.ok, true)
    assert.equal(result.preview.available, false)
    assert.equal(result.preview.updateAvailable, false)
    assert.equal(result.preview.downloadSources, undefined)
    assert.equal(result.previewError, undefined)
  }
})
test('a future preview is still offered after an inactive mirror', async () => {
  const next = { ...old, version: '2.2-beta1', tgz: 'local-dsh-knowledge-base-2.2-beta1.tgz' }
  const checker = createUpdateChecker({ currentVersion: '2.1.1', fetch: async url => Response.json(url.includes('preview-manifest.json') ? url.includes('gitee.com') ? inactive : next : stable) })
  const result = await checker.check()
  assert.equal(result.preview.latestVersion, '2.2-beta1')
  assert.equal(result.preview.updateAvailable, true)
})
