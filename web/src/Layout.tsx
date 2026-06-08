import { NavLink, Outlet } from 'react-router-dom'
import './App.css'
import { TimerProvider } from './timer/TimerContext'
import { MobileActionBar } from './components/MobileActionBar'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link'

export default function Layout() {
  return (
    <TimerProvider>
      <div className="app">
        <header className="topbar">
          <span className="brand">Personal Dashboard</span>
          <nav className="nav">
            <NavLink to="/" end className={linkClass}>Today</NavLink>
            <NavLink to="/health" className={linkClass}>Health</NavLink>
            <NavLink to="/nutrition" className={linkClass}>Nutrition</NavLink>
            <NavLink to="/schedule" className={linkClass}>Schedule</NavLink>
            <NavLink to="/habits" className={linkClass}>Habits</NavLink>
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
