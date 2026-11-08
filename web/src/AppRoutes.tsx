import { Suspense, lazy } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './Layout'

const TodayPage = lazy(() => import('./pages/TodayPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const HabitsPage = lazy(() => import('./pages/HabitsPage'))
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
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
