export async function sharedDraft(req) {
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost')
    return { title: String(url.searchParams.get('title') || '').slice(0, 200), text: String(url.searchParams.get('text') || '').slice(0, 1048576), url: String(url.searchParams.get('url') || '').slice(0, 8192), files: [] }
  }
  if (req.method !== 'POST') throw Error('只支持打开页面或分享资料')
  const chunks = []; let bytes = 0
  for await (const part of req) { bytes += part.length; if (bytes > 12 * 1024 * 1024) throw Error('分享内容超过 12 MiB'); chunks.push(part) }
  const form = await new Request('http://localhost/share', { method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' }, body: Buffer.concat(chunks) }).formData()
  const draft = { title: String(form.get('title') || '').slice(0, 200), text: String(form.get('text') || '').slice(0, 1048576), url: String(form.get('url') || '').slice(0, 8192), files: [] }
  for (const file of form.getAll('files')) {
    if (typeof file.arrayBuffer !== 'function') continue
    if (file.size > 8 * 1024 * 1024) throw Error('单个文件超过 8 MiB')
    draft.files.push({ filename: file.name, base64: Buffer.from(await file.arrayBuffer()).toString('base64') })
  }
  return draft
}

export function captureDocument(template, draft) {
  const data = JSON.stringify(draft).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  return template.replace('__KB_CAPTURE_DRAFT__', data)
}
