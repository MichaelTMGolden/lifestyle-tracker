// Service worker: makes the dashboard installable and lets the app shell open
// without a connection. Your data is never cached: /api requests always go to
// the network.
//  - Page loads: the saved shell at once, refreshed in the background (with its
//    assets), so opening never waits on the network; a deploy shows from the
//    next open. No saved shell yet: the network.
//  - /assets/*: hashed by the build, so cache first; old ones are trimmed.
//  - Icons, manifest, fonts: stale-while-revalidate.
const SHELL = 'pd-shell-v1'
const ASSETS = 'pd-assets-v1'
const STATIC = 'pd-static-v1'
const KEEP = [SHELL, ASSETS, STATIC]
const MAX_ASSETS = 80

// The page's own build output: entry JS/CSS (and preloads) named in index.html.
// On a first visit these load before this worker exists, so fetch them here.
const assetUrls = html => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])

async function cacheAssets(urls) {
  const cache = await caches.open(ASSETS)
  await Promise.all(urls.filter(u => new URL(u, self.location.origin).pathname.startsWith('/assets/'))
    .map(u => cache.match(u, { ignoreVary: true }).then(hit => hit ?? cache.add(u)).catch(() => { /* retried on the next visit */ })))
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL)
    await shell.addAll(['/manifest.webmanifest', '/favicon.svg', '/icon-192.png'])
    const page = await fetch('/', { cache: 'no-cache' })
    if (!page.ok) throw new Error('shell fetch failed')
    await shell.put('/', page.clone())
    await cacheAssets(assetUrls(await page.text()))
    await self.skipWaiting()
  })())
})

// The page reports the asset files it has already loaded (lazy page chunks
// included), since those were fetched before this worker could see them.
self.addEventListener('message', event => {
  if (event.data?.type === 'cache-assets' && Array.isArray(event.data.urls)) event.waitUntil(cacheAssets(event.data.urls))
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
    const fresh = fetch(req).then(async res => {
      // Store the new shell only once its own assets are cached, so the saved
      // shell can always start offline.
      if (res.ok) {
        const html = await res.clone().text()
        await cacheAssets(assetUrls(html))
        await (await caches.open(SHELL)).put('/', res.clone())
      }
      return res
    })
    event.waitUntil(fresh.catch(() => { /* offline: the saved shell serves */ }))
    event.respondWith(caches.match('/', { cacheName: SHELL }).then(hit => hit ?? fresh.catch(() => Response.error())))
    return
  }

  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    // Hashed files never change, so a cached copy fetched without Origin still serves module (cors) requests.
    event.respondWith(caches.match(req, { cacheName: ASSETS, ignoreVary: true }).then(hit => hit ?? fetch(req).then(res => {
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

// Habit reminders (Web Push). The payload is { title, body, url, tag }.
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data?.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'Personal Dashboard', {
    body: data.body || '',
    tag: data.tag || 'reminder', // a newer reminder for the same habit replaces the old one
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }))
})

// Tapping a notification focuses an open dashboard window, or opens one.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(w => new URL(w.url).origin === self.location.origin)
    if (open) { await open.focus(); if ('navigate' in open) await open.navigate(target).catch(() => {}); return }
    await self.clients.openWindow(target)
  })())
})
