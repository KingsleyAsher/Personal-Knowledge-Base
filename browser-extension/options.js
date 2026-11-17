const $ = id => document.getElementById(id)
const DEFAULT_HOST = 'http://' + ['127', '0', '0', '1'].join('.') + ':' + 43172
$('origin').textContent = chrome.runtime.getURL('').replace(/\/$/, '')
function isDesktopHost(host) {
  try {
    const url = new URL(host)
    const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return url.protocol === 'http:' && local && (port === 43172 || (port >= 49152 && port <= 65535))
  } catch { return false }
}
function renderMode() {
  const desktop = $('mode').value === 'desktop'
  $('host-row').hidden = desktop
  $('mode-help').textContent = desktop
    ? '桌面版会自动连接本机 DSH，不需要输入桌面窗口的端口。'
    : '填写浏览器能够访问的 Web profile HTTP/HTTPS 地址。'
}
chrome.storage.local.get(['host', 'mode']).then(value => {
  $('host').value = value.host || ''
  $('mode').value = value.mode || (value.host && !isDesktopHost(value.host) ? 'custom' : 'desktop')
  renderMode()
})
$('mode').onchange = renderMode
$('pair').onclick = async () => {
  try {
    const mode = $('mode').value
    const url = new URL(mode === 'desktop' ? DEFAULT_HOST : $('host').value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw Error('请填写仅含协议、主机和端口的宿主地址')
    const allowed = await chrome.permissions.request({ origins: [url.origin + '/*'] })
    if (!allowed) throw Error('未授予访问此宿主的权限')
    const response = await fetch(url.origin + '/kb-core/clip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: $('code').value.trim() }) }).catch(() => {
      throw Error(mode === 'desktop' ? '无法连接本机 DSH。请确认 DSH 正在运行并已加载桌面版自动连接支持。' : '无法访问该 DSH 地址，请检查地址与运行状态。')
    })
    const result = await response.json()
    if (!response.ok || !result.ok) throw Error(result.error || '配对失败')
    await chrome.storage.local.set({ mode, host: url.origin, token: result.token, kbId: result.kbId })
    $('code').value = ''; $('result').textContent = '已配对，可以保存网页。'
  } catch (error) { $('result').textContent = error.message }
}
$('clear').onclick = async () => { await chrome.storage.local.remove(['mode', 'host', 'token', 'kbId']); $('result').textContent = '本机连接已移除。可在知识库收件箱撤销宿主上的授权。' }
