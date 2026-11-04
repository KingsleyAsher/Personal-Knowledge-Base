const STABLE_DESKTOP_HOST = 'http://' + ['127', '0', '0', '1'].join('.') + ':' + 43172
const MENU_ID = 'save-to-knowledge-base'

function stableDesktopHost(host) {
  try {
    const url = new URL(host)
    const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return url.protocol === 'http:' && local && (port === 43172 || (port >= 49152 && port <= 65535))
  } catch { return false }
}

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) return
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '保存到个人知识库',
      contexts: ['all', 'tab'],
    }, () => {
      if (chrome.runtime.lastError) console.error('无法创建知识库右键菜单：', chrome.runtime.lastError.message)
    })
  })
}

chrome.runtime.onInstalled.addListener(registerContextMenu)

async function showResult(ok, message) {
  await chrome.storage.local.set({ lastContextMenuResult: { ok, message, at: Date.now() } }).catch(() => {})
  await Promise.allSettled([
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#23735e' : '#b42318' }),
    chrome.action.setBadgeText({ text: ok ? 'OK' : '!' }),
    chrome.action.setTitle({ title: `右键保存：${message}` }),
  ])
}

async function showPageToast(tabId, ok, message) {
  if (!Number.isInteger(tabId)) return
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [ok, message],
    func: (success, detail) => {
      document.querySelector('[data-dsh-kb-context-save-toast="true"]')?.remove()
      const toast = document.createElement('div')
      toast.dataset.dshKbContextSaveToast = 'true'
      toast.setAttribute('role', 'status')
      toast.setAttribute('aria-live', 'polite')
      toast.textContent = `${success ? '保存成功' : '保存失败'}：${detail}`
      toast.style.cssText = [
        'position:fixed', 'top:18px', 'right:18px', 'z-index:2147483647',
        'max-width:min(420px,calc(100vw - 36px))', 'box-sizing:border-box',
        'padding:12px 16px', 'border-radius:9px', 'color:#fff',
        `background:${success ? '#176b4b' : '#9f2622'}`,
        'box-shadow:0 8px 28px rgba(0,0,0,.28)',
        'font:500 14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'overflow-wrap:anywhere', 'pointer-events:none',
      ].join(';')
      ;(document.documentElement || document.body).appendChild(toast)
      window.setTimeout(() => toast.remove(), 5000)
    },
  }).catch(() => {})
}

async function reportResult(tabId, ok, message) {
  await Promise.allSettled([showResult(ok, message), showPageToast(tabId, ok, message)])
}

async function resolveConnection() {
  const saved = await chrome.storage.local.get(['host', 'token', 'mode'])
  if (!saved.token) throw Error('请先打开扩展“连接设置”并完成配对。')

  let mode = saved.mode || (stableDesktopHost(saved.host) ? 'desktop' : 'custom')
  let host
  if (mode === 'desktop') {
    host = STABLE_DESKTOP_HOST
  } else {
    let url
    try { url = new URL(saved.host) } catch { throw Error('已保存的宿主地址无效，请重新配对。') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('已保存的宿主地址无效，请重新配对。')
    host = url.origin
  }

  const permission = { origins: [host + '/*'] }
  const hasPermission = await chrome.permissions.contains(permission)
  if (!hasPermission) {
    const granted = await chrome.permissions.request(permission)
    if (!granted) throw Error('需要允许扩展访问已配对的 DSH 地址。')
  }

  if (saved.host !== host || saved.mode !== mode) {
    await chrome.storage.local.set({ host, mode })
  }
  return { host, token: saved.token, mode }
}

async function saveFromContextMenu(info, tab) {
  try {
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
      throw Error('只能在普通 HTTP 或 HTTPS 网页中保存；浏览器设置页、扩展商店等受保护页面无法读取。')
    }

    const selection = String(info.selectionText || '').trim()
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [selection],
      func: selectedText => {
        const selected = String(selectedText || window.getSelection()?.toString() || '').trim()
        const article = document.querySelector('article') || document.querySelector('main')
        const text = selected || article?.innerText?.trim() || ''
        return {
          title: document.title,
          url: location.href,
          text: text.slice(0, 500000),
          completeness: selected ? 'selection' : article && text ? 'article' : 'url-only',
        }
      },
    })
    if (!injected?.result) throw Error('读取网页内容失败，请在普通网页中重试。')

    const connection = await resolveConnection()
    const response = await fetch(connection.host + '/kb-core/clip', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + connection.token },
      body: JSON.stringify({ item: injected.result }),
    }).catch(() => {
      throw Error(connection.mode === 'desktop'
        ? '无法连接本机 DSH。请确认 DSH 正在运行并已加载桌面版自动连接支持。'
        : '无法访问已配对的 DSH 地址，请检查宿主是否运行。')
    })
    const value = await response.json()
    if (!response.ok || !value.ok) throw Error(value.error || '保存失败。')

    const message = value.duplicate
      ? '知识库已有相同内容，未重复保存。'
      : injected.result.completeness === 'url-only'
        ? '已保存网址；未能提取正文。'
        : '已保存到收件箱 / 快速收集。'
    await reportResult(tab.id, true, message)
  } catch (error) {
    await reportResult(tab?.id, false, error?.message || '保存失败，请稍后重试。')
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) void saveFromContextMenu(info, tab)
})
