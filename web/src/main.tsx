import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Layout from './Layout.tsx'
import { AuthGate } from './auth/AuthGate.tsx'

// Code-split each route. Keeps the initial bundle small — in particular the heavy
// Recharts dependency (only used by MetricDetailPage) no longer loads for the
// Today / Health pages, which use the lightweight hand-rolled SVG charts instead.
const TodayPage = lazy(() => import('./pages/TodayPage.tsx'))
const SchedulePage = lazy(() => import('./pages/SchedulePage.tsx'))
const HealthIndexPage = lazy(() => import('./pages/HealthIndexPage.tsx'))
const MetricDetailPage = lazy(() => import('./pages/MetricDetailPage.tsx'))
const NutritionPage = lazy(() => import('./pages/NutritionPage.tsx'))
const BingoPage = lazy(() => import('./pages/BingoPage.tsx'))
const TasksPage = lazy(() => import('./pages/TasksPage.tsx'))
const HabitsPage = lazy(() => import('./pages/HabitsPage.tsx'))
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Suspense fallback={null}><TodayPage /></Suspense>} />
          <Route path="/tasks" element={<Suspense fallback={null}><TasksPage /></Suspense>} />
          <Route path="/connect" element={<Suspense fallback={null}><ConnectionsPage /></Suspense>} />
          <Route path="/habits" element={<Suspense fallback={null}><HabitsPage /></Suspense>} />
          <Route path="/bingo" element={<Suspense fallback={null}><BingoPage /></Suspense>} />
          <Route path="/schedule" element={<Suspense fallback={null}><SchedulePage /></Suspense>} />
          <Route path="/health" element={<Suspense fallback={null}><HealthIndexPage /></Suspense>} />
          <Route path="/nutrition" element={<Suspense fallback={null}><NutritionPage /></Suspense>} />
          <Route path="/health/:key" element={<Suspense fallback={null}><MetricDetailPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AuthGate>
  </StrictMode>,
)
