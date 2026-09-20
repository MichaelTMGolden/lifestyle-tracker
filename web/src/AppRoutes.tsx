import { Suspense, lazy } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import Layout from './Layout'

const TodayPage = lazy(() => import('./pages/TodayPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const HealthIndexPage = lazy(() => import('./pages/HealthIndexPage'))
const MetricDetailPage = lazy(() => import('./pages/MetricDetailPage'))
const NutritionPage = lazy(() => import('./pages/NutritionPage'))
const BingoPage = lazy(() => import('./pages/BingoPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const HabitsPage = lazy(() => import('./pages/HabitsPage'))
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const ArtistPage = lazy(() => import('./pages/ArtistPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const loading = <p className="route-loading" role="status">Loading your dashboard…</p>

export default function AppRoutes() {
  return <Routes>
    <Route element={<Layout />}>
      <Route path="/" element={<Suspense fallback={loading}><TodayPage /></Suspense>} />
      <Route path="/tasks" element={<Suspense fallback={loading}><TasksPage /></Suspense>} />
      <Route path="/connect" element={<Suspense fallback={loading}><ConnectionsPage /></Suspense>} />
      <Route path="/habits" element={<Suspense fallback={loading}><HabitsPage /></Suspense>} />
      <Route path="/bingo" element={<Suspense fallback={loading}><BingoPage /></Suspense>} />
      <Route path="/schedule" element={<Suspense fallback={loading}><SchedulePage /></Suspense>} />
      <Route path="/health" element={<Suspense fallback={loading}><HealthIndexPage /></Suspense>} />
      <Route path="/review" element={<Suspense fallback={loading}><ReviewPage /></Suspense>} />
      <Route path="/nutrition" element={<Suspense fallback={loading}><NutritionPage /></Suspense>} />
      <Route path="/artist" element={<Suspense fallback={loading}><ArtistPage /></Suspense>} />
      <Route path="/health/:key" element={<Suspense fallback={loading}><MetricDetailPage /></Suspense>} />
      <Route path="/settings" element={<Suspense fallback={loading}><SettingsPage /></Suspense>} />
      <Route path="*" element={<section className="card"><h1>Page not found</h1><p>This dashboard page does not exist.</p><Link className="btn" to="/">Back to Today</Link></section>} />
    </Route>
  </Routes>
}
