(() => {
  const $ = id => document.getElementById(id), key = 'kb-quick-capture-text-v1'
  const shared = JSON.parse($('shared-draft').textContent || '{}')
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') } catch {}
  for (const name of ['title', 'text', 'url']) $(name).value = shared[name] || saved[name] || ''
  $('attachments').textContent = (shared.files || []).map(f => f.filename).join('，')
  const keepDraft = () => { try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(['title','text','url'].map(name => [name,$(name).value])))) } catch {} }
  for (const name of ['title','text','url']) $(name).addEventListener('input', keepDraft)
  $('discard').onclick = () => { for (const name of ['title','text','url']) $(name).value = ''; try { localStorage.removeItem(key) } catch {}; $('result').textContent = '本机文字草稿已清除。' }
  async function api(body) { const res = await fetch('/kb-core/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const out = await res.json(); if (!res.ok || !out.ok) throw Error(out.error || out.reason || '保存失败'); return out }
  async function encode(file) {
    if (file.size > 8388608) throw Error('单个文件最多 8 MiB')
    const bytes = new Uint8Array(await file.arrayBuffer()); let value = ''
    for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return { filename: file.name, base64: btoa(value) }
  }
  $('capture-form').onsubmit = async ev => {
    ev.preventDefault(); $('save').disabled = true; keepDraft()
    try {
      const attachments = [...(shared.files || []), ...await Promise.all([...$('files').files].map(encode))]
      const items = attachments.length ? attachments : [{}]
      let count = 0
      for (const item of items) {
        const s = await api({ op: 'atlas.snapshot' })
        const request = { op: 'capture.create', expectedKbId: s.kbId, policyVersion: s.policyVersion, expectedRevision: s.revision, title: $('title').value, text: $('text').value, url: $('url').value, ...item }
        let result = await api(request)
        if (result.requiresConfirmation && confirm('已有相同内容，仍然保存另一份？')) result = await api({ ...request, expectedRevision: result.revision, allowDuplicate: true })
        if (result.capture) count++
      }
      $('result').textContent = '已保存 ' + count + ' 项到收件箱 / 快速收集。'
      if (count) { try { localStorage.removeItem(key) } catch {}; shared.files = []; $('files').value = ''; $('attachments').textContent = '' }
    } catch (error) { $('result').textContent = error.message + '\n文字草稿仍保留，请检查连接和知识库绑定后重试。' }
    finally { $('save').disabled = false }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/kb-core/capture-sw.js', { scope: '/kb-core/' }).catch(() => {})
})()
