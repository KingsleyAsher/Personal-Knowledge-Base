const $ = id => document.getElementById(id)
$('origin').textContent = chrome.runtime.getURL('').replace(/\/$/, '')
chrome.storage.local.get(['host']).then(value => { $('host').value = value.host || '' })
$('pair').onclick = async () => {
  try {
    const url = new URL($('host').value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw Error('请填写仅含协议、主机和端口的宿主地址')
    const allowed = await chrome.permissions.request({ origins: [url.origin + '/*'] })
    if (!allowed) throw Error('未授予访问此宿主的权限')
    const response = await fetch(url.origin + '/kb-core/clip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('code').value.trim() }) })
    const result = await response.json()
    if (!response.ok || !result.ok) throw Error(result.error || '配对失败')
    await chrome.storage.local.set({ host: url.origin, token: result.token, kbId: result.kbId })
    $('code').value = ''; $('result').textContent = '已配对，可以保存网页。'
  } catch (error) { $('result').textContent = error.message }
}
$('clear').onclick = async () => { await chrome.storage.local.remove(['host', 'token', 'kbId']); $('result').textContent = '本机连接已移除。可在知识库收件箱撤销宿主上的授权。' }
