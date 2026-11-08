import { Suspense, lazy } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './Layout'

const pages = {
  today: () => import('./pages/TodayPage'),
  habits: () => import('./pages/HabitsPage'),
  plan: () => import('./pages/TasksPage'),
  schedule: () => import('./pages/SchedulePage'),
  connect: () => import('./pages/ConnectionsPage'),
  settings: () => import('./pages/SettingsPage'),
}
const TodayPage = lazy(pages.today)
const SchedulePage = lazy(pages.schedule)
const TasksPage = lazy(pages.plan)
const HabitsPage = lazy(pages.habits)
const ConnectionsPage = lazy(pages.connect)
const SettingsPage = lazy(pages.settings)

// Once the app is idle, load every page's code: switching tabs is instant and
// the service worker caches them, so pages not yet visited still open offline.
if (import.meta.env.PROD) {
  const preload = () => { for (const load of Object.values(pages)) void load().catch(() => {}) }
  if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 5000 })
  else setTimeout(preload, 3000)
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
      <Route path="/schedule" element={<Suspense fallback={loading}><SchedulePage /></Suspense>} />
      <Route path="/settings" element={<Suspense fallback={loading}><SettingsPage /></Suspense>} />
      <Route path="/kit" element={<Suspense fallback={loading}><KitPage /></Suspense>} />
      {/* Hidden in v2 (their data stays): old links and bookmarks land on Today. */}
      {['/health', '/health/:key', '/nutrition', '/artist', '/review', '/bingo'].map(path => <Route key={path} path={path} element={<Navigate to="/" replace />} />)}
      <Route path="*" element={<section className="card"><h1>Page not found</h1><p>This dashboard page does not exist.</p><Link className="btn" to="/">Back to Today</Link></section>} />
    </Route>
  </Routes>
}
