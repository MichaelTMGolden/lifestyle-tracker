import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { AuthGate } from './auth/AuthGate.tsx'
import AppRoutes from './AppRoutes.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate><BrowserRouter><AppRoutes /></BrowserRouter></AuthGate>
  </StrictMode>,
)
