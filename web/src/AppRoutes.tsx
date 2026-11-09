import { Suspense, lazy } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './Layout'

const pages = {
  today: () => import('./pages/TodayPage'),
  habits: () => import('./pages/HabitsPage'),
  habit: () => import('./pages/HabitPage'),
  stats: () => import('./pages/StatsPage'),
  plan: () => import('./pages/TasksPage'),
  schedule: () => import('./pages/SchedulePage'),
  connect: () => import('./pages/ConnectionsPage'),
  settings: () => import('./pages/SettingsPage'),
  health: () => import('./pages/HealthPage'),
}
const TodayPage = lazy(pages.today)
const SchedulePage = lazy(pages.schedule)
const TasksPage = lazy(pages.plan)
const HabitsPage = lazy(pages.habits)
const HabitPage = lazy(pages.habit)
const StatsPage = lazy(pages.stats)
const ConnectionsPage = lazy(pages.connect)
const SettingsPage = lazy(pages.settings)
const HealthPage = lazy(pages.health)

// Once the app is idle, load every page's code: switching tabs is instant and
// the service worker caches them, so pages not yet visited still open offline.
if (import.meta.env.PROD) {
  const preload = async () => {
    await Promise.allSettled(Object.values(pages).map(load => load()))
    // Hand the loaded files to the service worker: on a first visit they were
    // fetched before it was installed, so it never saw them.
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null
    const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => new URL(u).pathname.startsWith('/assets/'))
    reg?.active?.postMessage({ type: 'cache-assets', urls })
  }
  if ('requestIdleCallback' in window) requestIdleCallback(() => void preload(), { timeout: 5000 })
  else setTimeout(() => void preload(), 3000)
}
const KitPage = lazy(() => import('./pages/KitPage'))
const loading = <p className="route-loading" role="status">Loading your dashboard…</p>

export default function AppRoutes() {
  return <Routes>
    <Route element={<Layout />}>
      <Route path="/" element={<Suspense fallback={loading}><TodayPage /></Suspense>} />
      <Route path="/tasks" element={<Suspense fallback={loading}><TasksPage /></Suspense>} />
      <Route path="/connect" element={<Suspense fallback={loading}><ConnectionsPage /></Suspense>} />
      <Route path="/habits" element={<Suspense fallback={loading}><HabitsPage /></Suspense>} />
      <Route path="/habits/:id" element={<Suspense fallback={loading}><HabitPage /></Suspense>} />
      <Route path="/stats" element={<Suspense fallback={loading}><StatsPage /></Suspense>} />
      <Route path="/schedule" element={<Suspense fallback={loading}><SchedulePage /></Suspense>} />
      <Route path="/settings" element={<Suspense fallback={loading}><SettingsPage /></Suspense>} />
      <Route path="/health" element={<Suspense fallback={loading}><HealthPage /></Suspense>} />
      <Route path="/kit" element={<Suspense fallback={loading}><KitPage /></Suspense>} />
      {/* Hidden in v2 (their data stays): old links and bookmarks land on Today. */}
      {['/health/:key', '/nutrition', '/artist', '/review', '/bingo'].map(path => <Route key={path} path={path} element={<Navigate to="/" replace />} />)}
      <Route path="*" element={<section className="card"><h1>Page not found</h1><p>This dashboard page does not exist.</p><Link className="btn" to="/">Back to Today</Link></section>} />
    </Route>
  </Routes>
}
