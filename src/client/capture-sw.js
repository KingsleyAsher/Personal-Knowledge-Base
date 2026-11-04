const CACHE = 'kb-capture-shell-v1'
const SHELL = ['/kb-core/collect', '/kb-core/capture.js', '/kb-core/capture.css', '/kb-core/capture-icon.svg']
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting() })
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return
  // Never cache API responses, user data, or a shared draft response with query parameters.
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)))
})
