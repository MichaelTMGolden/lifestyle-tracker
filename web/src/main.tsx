import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AuthGate } from './auth/AuthGate.tsx'
import AppRoutes from './AppRoutes.tsx'
import { prefetchToday, queryClient } from './todayData'

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
