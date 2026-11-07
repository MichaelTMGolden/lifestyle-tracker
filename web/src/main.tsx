import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AuthGate } from './auth/AuthGate.tsx'
import AppRoutes from './AppRoutes.tsx'
import { queryClient } from './todayData'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate><BrowserRouter><AppRoutes /></BrowserRouter></AuthGate>
    </QueryClientProvider>
  </StrictMode>,
)
