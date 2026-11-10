// Service worker: makes the dashboard installable and lets the app shell open
// without a connection. Your data is never cached: /api requests always go to
// the network.
//  - Page loads: the saved shell at once, so opening never waits on the network.
//    The current shell is fetched in the background and replaces the saved one
//    only once every file of its build (asset-list.json) is cached; a deploy
//    shows from the next open. ?fresh=1 asks for the network copy (the page
//    found code missing). No saved shell yet: the network.
//  - /assets/*: hashed by the build, so cache first. The saved build's files
//    and the previous build's are kept; older ones are dropped.
//  - Icons, manifest, fonts: stale-while-revalidate.
const SHELL = 'pd-shell-v1'
const ASSETS = 'pd-assets-v1'
const STATIC = 'pd-static-v1'
const KEEP = [SHELL, ASSETS, STATIC]
// Which build's files the saved shell needs, and the one before it (a page still
// open from the old build can keep loading its own chunks).
const CURRENT = '/__build/current'
const PREVIOUS = '/__build/previous'

// The page's own build output named in index.html (entry JS/CSS and preloads).
const assetUrls = html => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1])

/** Cache every URL; rejects if any can't be fetched. */
async function cacheAll(urls) {
  const cache = await caches.open(ASSETS)
  await Promise.all(urls.map(u => cache.match(u, { ignoreVary: true }).then(hit => hit ?? cache.add(u))))
}

/** Best effort, for files a page reports it has loaded. */
const cacheSome = urls => cacheAll(urls.filter(u => new URL(u, self.location.origin).pathname.startsWith('/assets/'))).catch(() => { /* retried later */ })

const readList = async (shell, key) => { const r = await shell.match(key); return r ? r.json() : [] }

/**
 * Make `html` the saved shell once all of its build's files are cached, so it
 * can always start (offline too). Keeps the previous build's files, drops older.
 */
// One installation at a time: another one pruning between this one's caching
// and its promotion could remove the files it is about to rely on.
let installing = Promise.resolve()
function installBuild(html) {
  const run = installing.catch(() => undefined).then(() => installBuildNow(html))
  installing = run.catch(() => undefined)
  return run
}

async function installBuildNow(html) {
  // Without the build's full file list the new shell can't be known complete:
  // keep the saved one (throws; the caller ignores it and tries next open).
  const list = await fetch('/asset-list.json', { cache: 'no-store' })
  if (!list.ok) throw new Error('asset list unavailable')
  const files = await list.json()
  if (!Array.isArray(files) || files.length === 0) throw new Error('asset list empty')
  // A deploy between the two fetches would pair this HTML with another build's
  // list: every file the HTML names must be on the list, or keep the saved shell.
  if (!assetUrls(html).every(u => files.includes(u))) throw new Error('asset list is for another build')
  const needed = [...new Set([...assetUrls(html), ...files])]
  await cacheAll(needed)
  const shell = await caches.open(SHELL)
  const assets = await caches.open(ASSETS)
  // First run after upgrading from a worker that kept no build list: treat
  // everything already cached as the previous build, so an open tab keeps its chunks.
  const known = await shell.match(CURRENT)
  const current = known ? await readList(shell, CURRENT) : (await assets.keys()).map(r => new URL(r.url).pathname)
  const same = current.length === needed.length && current.every(u => needed.includes(u))
  if (!same) await shell.put(PREVIOUS, new Response(JSON.stringify(current)))
  await shell.put(CURRENT, new Response(JSON.stringify(needed)))
  await shell.put('/', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  const keep = new Set([...needed, ...(same ? await readList(shell, PREVIOUS) : current)])
  for (const req of await assets.keys()) if (!keep.has(new URL(req.url).pathname)) await assets.delete(req)
  // A different build is now saved: tell open pages, which offer a reload unless
  // they already run it. (The very first save has nothing to replace.)
  if (!same && known) {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const page of pages) page.postMessage({ type: 'build-ready', files: needed })
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL)
    await shell.addAll(['/manifest.webmanifest', '/favicon.svg', '/icon-192.png'])
    const page = await fetch('/', { cache: 'no-cache' })
    if (!page.ok) throw new Error('shell fetch failed')
    await installBuild(await page.text())
    await self.skipWaiting()
  })())
})

// The page reports the asset files it has already loaded (lazy page chunks
// included), since those were fetched before this worker could see them.
self.addEventListener('message', event => {
  if (event.data?.type === 'cache-assets' && Array.isArray(event.data.urls)) event.waitUntil(cacheSome(event.data.urls))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/asset-list.json')) return

  if (req.mode === 'navigate' && sameOrigin) {
    // Always fetch the current shell; it replaces the saved one in the background.
    const network = fetch(req).then(res => ({ res, copy: res.clone() }))
    event.waitUntil(network.then(async ({ res, copy }) => { if (res.ok) await installBuild(await copy.text()) })
      .catch(() => { /* offline, or its build only partly cached: keep the saved shell */ }))
    const live = network.then(({ res }) => res)
    if (url.searchParams.has('fresh')) {
      event.respondWith(live.catch(() => caches.match('/', { cacheName: SHELL }).then(hit => hit ?? Response.error())))
      return
    }
    event.respondWith(caches.match('/', { cacheName: SHELL }).then(hit => hit ?? live.catch(() => Response.error())))
    return
  }

  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    // Hashed files never change, so a cached copy fetched without Origin still serves module (cors) requests.
    event.respondWith(caches.match(req, { cacheName: ASSETS, ignoreVary: true }).then(hit => hit ?? fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then(c => c.put(req, copy)) }
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
