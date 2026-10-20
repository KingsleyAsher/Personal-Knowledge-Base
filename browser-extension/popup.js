document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage()
document.getElementById('save').onclick = async () => {
  const button = document.getElementById('save'), output = document.getElementById('result')
  button.disabled = true
  try {
    const { host, token } = await chrome.storage.local.get(['host', 'token'])
    if (!host || !token) throw Error('请先打开连接设置配对知识库')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!/^https?:\/\//.test(tab.url || '')) throw Error('只能保存 HTTP 或 HTTPS 网页')
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const selected = window.getSelection()?.toString().trim()
      const article = document.querySelector('article') || document.querySelector('main')
      const text = selected || article?.innerText?.trim() || ''
      return { title: document.title, url: location.href, text: text.slice(0, 500000), completeness: selected ? 'selection' : article && text ? 'article' : 'url-only' }
    } })
    const response = await fetch(host + '/kb-core/clip', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ item: result.result }) })
    const value = await response.json()
    if (!response.ok || !value.ok) throw Error(value.error || '保存失败')
    output.textContent = value.duplicate ? '知识库已有相同内容，未重复保存。' : result.result.completeness === 'url-only' ? '已保存网址；未能提取正文。' : '已保存到收件箱 / 快速收集。'
  } catch (error) { output.textContent = error.message }
  finally { button.disabled = false }
}
