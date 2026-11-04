document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage()
const STABLE_DESKTOP_HOST = 'http://' + ['127', '0', '0', '1'].join('.') + ':' + 43172
const button = document.getElementById('save')
const output = document.getElementById('result')
const contextOutput = document.getElementById('context-status')
let connection = null
button.disabled = true
chrome.storage.local.get(['host', 'token', 'mode', 'lastContextMenuResult']).then(value => {
  connection = value
  if (value.lastContextMenuResult?.message) contextOutput.textContent = '最近一次右键操作：' + value.lastContextMenuResult.message
  button.disabled = false
}).catch(error => {
  output.textContent = '读取本机连接设置失败：' + error.message
})

function stableDesktopHost(host) {
  try {
    const url = new URL(host)
    const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return url.protocol === 'http:' && local && (port === 43172 || (port >= 49152 && port <= 65535)) ? STABLE_DESKTOP_HOST : null
  } catch { return null }
}

button.onclick = async () => {
  button.disabled = true
  try {
    const { host: savedHost, mode: savedMode, token } = connection || {}
    let host = savedHost
    if (!host || !token) throw Error('请先打开连接设置配对知识库')
    const mode = savedMode || (stableDesktopHost(host) ? 'desktop' : 'custom')
    const stableHost = mode === 'desktop' ? STABLE_DESKTOP_HOST : null
    if (stableHost) {
      const allowed = await chrome.permissions.request({ origins: [stableHost + '/*'] })
      if (!allowed) throw Error('需要允许扩展访问本机 DSH')
      if (stableHost !== host || mode !== savedMode) {
        host = stableHost
        await chrome.storage.local.set({ mode: 'desktop', host })
        connection = { ...connection, mode: 'desktop', host }
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!/^https?:\/\//.test(tab.url || '')) throw Error('只能保存 HTTP 或 HTTPS 网页')
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const selected = window.getSelection()?.toString().trim()
      const article = document.querySelector('article') || document.querySelector('main')
      const text = selected || article?.innerText?.trim() || ''
      return { title: document.title, url: location.href, text: text.slice(0, 500000), completeness: selected ? 'selection' : article && text ? 'article' : 'url-only' }
    } })
    const response = await fetch(host + '/kb-core/clip', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ item: result.result }) }).catch(() => {
      throw Error(mode === 'desktop' ? '无法连接本机 DSH。请确认 DSH 正在运行并已加载桌面版自动连接支持。' : '无法访问已配对的 DSH 地址，请检查宿主是否运行。')
    })
    const value = await response.json()
    if (!response.ok || !value.ok) throw Error(value.error || '保存失败')
    output.textContent = value.duplicate ? '知识库已有相同内容，未重复保存。' : result.result.completeness === 'url-only' ? '已保存网址；未能提取正文。' : '已保存到收件箱 / 快速收集。'
  } catch (error) { output.textContent = error.message }
  finally { button.disabled = false }
}
