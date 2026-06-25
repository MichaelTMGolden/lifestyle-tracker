import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import './App.css'
import { TimerProvider } from './timer/TimerContext'
import { MobileActionBar } from './components/MobileActionBar'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link'

export default function Layout() {
  // Mobile: the nav collapses behind a hamburger so the links don't overflow the
  // bar. Tapping any link (clicks bubble up to the <nav>) closes the menu again.
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <TimerProvider>
      <div className="app">
        <header className="topbar">
          <span className="brand">Personal Dashboard</span>
          <button
            className="nav-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
          <nav className={menuOpen ? 'nav open' : 'nav'} onClick={() => setMenuOpen(false)}>
            <NavLink to="/" end className={linkClass}>Today</NavLink>
            <NavLink to="/health" className={linkClass}>Health</NavLink>
            <NavLink to="/nutrition" className={linkClass}>Nutrition</NavLink>
            <NavLink to="/schedule" className={linkClass}>Schedule</NavLink>
            <NavLink to="/habits" className={linkClass}>Habits</NavLink>
            <NavLink to="/artist" className={linkClass}>Artist</NavLink>
            <NavLink to="/bingo" className={linkClass}>Bingo</NavLink>
            <NavLink to="/tasks" className={linkClass}>Tasks</NavLink>
            <NavLink to="/connect" className={linkClass}>Connect</NavLink>
          </nav>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
      <MobileActionBar />
    </TimerProvider>
  )
}
