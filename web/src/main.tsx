import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AuthGate } from './auth/AuthGate.tsx'
import AppRoutes from './AppRoutes.tsx'
import { prefetchToday, queryClient } from './todayData'

// A saved page from an older build asked for code a deploy has since removed:
// load the current build once (the service worker skips its saved copy for ?fresh).
// Only when the server can be reached: offline, a failed download is just that,
// and leaving a working page would strand it on a network error.
window.addEventListener('vite:preloadError', () => {
  if (!navigator.onLine) return
  void fetch('/asset-list.json', { cache: 'no-store' }).then(r => {
    if (!r.ok) return
    try { if (sessionStorage.getItem('pd:fresh')) return; sessionStorage.setItem('pd:fresh', '1') } catch { return }
    const params = new URLSearchParams(location.search); params.set('fresh', '1')
    location.replace(`${location.pathname}?${params}`)
  }, () => { /* unreachable: stay on this page */ })
})
if (new URLSearchParams(location.search).has('fresh')) {
  const params = new URLSearchParams(location.search); params.delete('fresh')
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`)
  // Allow another recovery later in the session once this one has settled.
  setTimeout(() => { try { sessionStorage.removeItem('pd:fresh') } catch { /* private mode */ } }, 15000)
}

// Opening on Today: ask for its data now, alongside the code (one round trip saved).
if (location.pathname === '/') prefetchToday()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate><BrowserRouter><AppRoutes /></BrowserRouter></AuthGate>
    </QueryClientProvider>
  </StrictMode>,
)

// Installable app + offline app shell. Production only: in development the
// service worker would cache Vite's modules and get in the way of hot reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ }) })
}
