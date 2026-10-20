import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('release notice Escape dismissal persists the same seen marker as its close button', async () => {
  const source = await readFile(new URL('../src/client/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('function ReleaseNotice()')
  const end = source.indexOf('function apply(ctx)', start)
  assert.ok(start >= 0 && end > start, 'release notice component must remain in the client module')
  const notice = source.slice(start, end)
  assert.match(notice, /const dismiss = \(\) => \{[\s\S]*?localStorage\.setItem\(RELEASE_NOTICE_KEY, '1'\)[\s\S]*?setVisible\(false\)/)
  assert.match(notice, /const onKeyDown = \(event\) => \{ if \(event\.key === 'Escape'\) dismiss\(\) \}/)
  assert.match(notice, /['"]aria-label['"]: '关闭更新说明'/)
  assert.match(notice, /onClick: dismiss/)
})
