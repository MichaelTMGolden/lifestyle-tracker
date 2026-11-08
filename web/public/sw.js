// Service worker: makes the dashboard installable and lets the app shell open
// without a connection. Your data is never cached: /api requests always go to
// the network.
//  - Page loads: network first (so a deploy shows at once), cached shell as fallback.
//  - /assets/*: hashed by the build, so cache first; old ones are trimmed.
//  - Icons, manifest, fonts: stale-while-revalidate.
const SHELL = 'pd-shell-v1'
const ASSETS = 'pd-assets-v1'
const STATIC = 'pd-static-v1'
const KEEP = [SHELL, ASSETS, STATIC]
const MAX_ASSETS = 80

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key)
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname === '/healthz')) return

  if (req.mode === 'navigate' && sameOrigin) {
    event.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/', copy)) }
      return res
    }).catch(() => caches.match('/', { cacheName: SHELL }).then(hit => hit ?? Response.error())))
    return
  }

  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(req, { cacheName: ASSETS }).then(hit => hit ?? fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then(c => c.put(req, copy)).then(() => trim(ASSETS, MAX_ASSETS)) }
      return res
    })))
    return
  }

  const cacheable = sameOrigin ? /\.(png|svg|webmanifest|ico)$/.test(url.pathname)
    : url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
  if (cacheable) {
    event.respondWith(caches.open(STATIC).then(async cache => {
      const hit = await cache.match(req)
      const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res }).catch(() => hit)
      return hit ?? fresh
    }))
  }
})
