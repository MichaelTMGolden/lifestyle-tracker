import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import './ux.css'
import './shell.css'
import { TimerProvider } from './timer/TimerContext'
import { MobileActionBar } from './components/MobileActionBar'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'

const destinations = [
  { path: '/', label: 'Today', group: 'Daily', detail: 'Focus, next steps and your day', keywords: 'home dashboard now priorities', icon: 'today' },
  { path: '/tasks', label: 'Tasks', group: 'Daily', detail: 'Your plans and unfinished work', keywords: 'todo to-do priorities backlog', icon: 'tasks' },
  { path: '/schedule', label: 'Schedule', group: 'Daily', detail: 'Your week and appointments', keywords: 'calendar events timetable agenda', icon: 'schedule' },
  { path: '/habits', label: 'Habits', group: 'Daily', detail: 'Practice, goals and consistency', keywords: 'skills timers rhythm challenges sessions', icon: 'habits' },
  { path: '/health', label: 'Health', group: 'Progress', detail: 'Readiness and health trends', keywords: 'sleep weight heart steps garmin', icon: 'health' },
  { path: '/nutrition', label: 'Nutrition', group: 'Progress', detail: 'Food, calories and nutrition', keywords: 'meals protein carbs fat macros', icon: 'nutrition' },
  { path: '/artist', label: 'Artist', group: 'Progress', detail: 'Skill growth and your audience', keywords: 'music spotify listeners evidence benchmarks assessments radar', icon: 'artist' },
  { path: '/review', label: 'Review', group: 'Progress', detail: 'Weekly reflection and follow-through', keywords: 'digest recommendations commitments recap', icon: 'review' },
  { path: '/bingo', label: 'Bingo', group: 'Tools', detail: 'Creative milestones and the bigger picture', keywords: 'year annual board', icon: 'bingo' },
  { path: '/connect', label: 'Connect', group: 'Tools', detail: 'Your connected data sources', keywords: 'integrations sync import garmin google spotify', icon: 'connect' },
  { path: '/settings', label: 'Settings', group: 'Tools', detail: 'Personal targets and baselines', keywords: 'preferences configuration customize', icon: 'settings' },
] as const
const groups = ['Daily', 'Progress', 'Tools'] as const
const defaultPins = ['/habits', '/schedule', '/review']
const iconPaths = {
  today: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  tasks: 'm3 6 2 2 4-4m-6 9 2 2 4-4m-6 9 2 2 4-4M12 6h9M12 13h9M12 20h9',
  schedule: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 17h3',
  habits: 'M6 18 3 15m3 3 3-3M6 18V8a4 4 0 0 1 4-4h4m4 2 3 3m-3-3-3 3M18 6v10a4 4 0 0 1-4 4h-4',
  health: 'M2 12h5l3-8 4 16 3-8h5',
  nutrition: 'M12 21c-6 0-9-4-9-10 6 0 9 3 9 10ZM12 21c0-9 2-15 9-18 1 8-2 16-9 18Z',
  artist: 'M9 18V5l12-2v13M9 9l12-2M9 18c0 2-2 3-4 3s-3-1-3-2 2-3 4-3c1 0 3 0 3 2ZM21 16c0 2-2 3-4 3s-3-1-3-2 2-3 4-3c1 0 3 0 3 2Z',
  review: 'M7 3h10l4 4v14H3V3h4ZM15 3v6h6M7 13h10M7 17h7',
  bingo: 'M3 3h18v18H3ZM9 3v18M15 3v18M3 9h18M3 15h18',
  connect: 'm9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
} as const
function NavigationIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={iconPaths[name]} /></svg>
}
function loadPins(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('pd:nav-pins') ?? 'null')
    if (Array.isArray(saved)) return [...new Set(saved.filter((path): path is string => typeof path === 'string' && path !== '/' && destinations.some(destination => destination.path === path)))].slice(0, 3)
  } catch { /* browser storage may be disabled */ }
  return defaultPins
}
const linkClass = ({ isActive }: { isActive: boolean }) => isActive ? 'shell-link active' : 'shell-link'

export default function Layout() {
  const dialog = useRef<HTMLDialogElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const [pins, setPins] = useState(loadPins)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pinStatus, setPinStatus] = useState('')
  const visible = [destinations[0], ...pins.flatMap(path => destinations.filter(destination => destination.path === path))]
  const current = destinations.find(destination => destination.path === location.pathname)
    ?? destinations.find(destination => destination.path !== '/' && location.pathname.startsWith(`${destination.path}/`))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const results = destinations.filter(destination => `${destination.label} ${destination.group} ${destination.detail} ${destination.keywords}`.toLocaleLowerCase().includes(normalizedQuery))

  const openMenu = useCallback(() => {
    setQuery(''); setPinStatus('')
    dialog.current?.showModal()
    setMenuOpen(true)
    searchInput.current?.focus()
  }, [])
  function closeMenu() { dialog.current?.close(); setMenuOpen(false) }

  useEffect(() => {
    document.title = `${current?.label ?? 'Dashboard'} · Personal Dashboard`
    main.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [location.pathname, current?.label])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k' || event.repeat || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault(); openMenu()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [openMenu])

  function pin(path: string, label: string) {
    const wasPinned = pins.includes(path)
    const next = wasPinned ? pins.filter(p => p !== path) : pins.length < 3 ? [...pins, path] : pins
    setPins(next)
    setPinStatus(`${label} ${wasPinned ? 'removed from' : 'added to'} mobile shortcuts.`)
    try { localStorage.setItem('pd:nav-pins', JSON.stringify(next)) } catch { /* retain session preference */ }
  }
  function resultKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    const links = Array.from(dialog.current?.querySelectorAll<HTMLAnchorElement>('[data-nav-result]') ?? [])
    if (!links.length) return
    const index = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (index === -1 && event.target !== searchInput.current) return
    event.preventDefault()
    const next = index === -1 ? (event.key === 'ArrowDown' ? 0 : links.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length
    links[next].focus()
  }

  return <TimerProvider>
    <div className="app dashboard-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="desktop-sidebar" aria-label="Dashboard navigation">
        <NavLink to="/" className="sidebar-brand" aria-label="Personal Dashboard home"><span className="sidebar-brand-mark" aria-hidden="true">✦</span><span className="brand">Personal<br />Dashboard</span></NavLink>
        <button className="sidebar-search" onClick={openMenu} aria-haspopup="dialog" aria-expanded={menuOpen}><NavigationIcon name="search" /><span>Find a page</span><kbd>Ctrl K</kbd></button>
        <nav className="sidebar-groups" aria-label="Main navigation">
          {groups.map(group => <div className="sidebar-group" key={group}><h2>{group}</h2>{destinations.filter(destination => destination.group === group).map(destination =>
            <NavLink key={destination.path} to={destination.path} end={destination.path === '/'} className={linkClass}><NavigationIcon name={destination.icon} /><span>{destination.label}</span></NavLink>)}</div>)}
        </nav>
        <div className="sidebar-footer"><span className="sidebar-footer-dot" aria-hidden="true" /><span>Your personal workspace</span></div>
      </aside>
      <div className="shell-content">
        <header className="mobile-shell-header">
          <div className="mobile-shell-brand"><NavLink to="/" className="brand">Personal Dashboard</NavLink><button className="mobile-search" onClick={openMenu} aria-label="Search dashboard pages" aria-haspopup="dialog" aria-expanded={menuOpen}><NavigationIcon name="search" /></button></div>
          <nav className="primary-nav" aria-label="Pinned navigation">
            {visible.map(destination => <NavLink key={destination.path} to={destination.path} end={destination.path === '/'} className={linkClass}>{destination.label}</NavLink>)}
            <button className={`shell-link more-nav${visible.every(destination => destination.path !== current?.path) ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={openMenu}>More <span aria-hidden="true">⌄</span></button>
          </nav>
        </header>
        <main id="main-content" ref={main} tabIndex={-1}>
          <RouteErrorBoundary key={location.pathname}><Outlet /></RouteErrorBoundary>
        </main>
      </div>
      <dialog className="navigation-dialog" ref={dialog} aria-labelledby="navigation-title" onClose={() => setMenuOpen(false)} onKeyDown={resultKeys} onClick={event => { if (event.target === event.currentTarget) closeMenu() }}>
        <div className="navigation-dialog-head"><h2 id="navigation-title">Find your next page</h2><button className="navigation-close" onClick={closeMenu} aria-label="Close navigation">✕</button></div>
        <div className="navigation-search"><NavigationIcon name="search" /><label className="ux-sr-only" htmlFor="page-search">Search dashboard pages</label><input id="page-search" ref={searchInput} value={query} onChange={event => { setQuery(event.target.value); setPinStatus('') }} placeholder="Search pages, skills, nutrition…" autoComplete="off" aria-describedby="navigation-search-hint" onKeyDown={event => {
          if (event.key === 'Enter' && results[0]) { event.preventDefault(); closeMenu(); navigate(results[0].path) }
        }} /></div>
        <p id="navigation-search-hint" className="navigation-key-hint">Use ↑ ↓ to browse, Enter to open, Esc to close.</p>
        <div className="navigation-pin-note"><span>Mobile shortcuts</span><span>{pins.length}/3 pinned</span></div>
        <p className="navigation-pin-help">Today stays first. Pin your other favourites, or unpin one to make room.</p>
        <p className="ux-sr-only" role="status">{pinStatus || `${results.length} pages found.`}</p>
        <nav aria-label="Search results" className="navigation-results">
          {groups.map(group => {
            const matches = results.filter(destination => destination.group === group)
            return matches.length > 0 && <div className="navigation-result-group" key={group}><h3>{group}</h3>{matches.map(destination => <div className="all-pages-row" key={destination.path}>
              <NavLink to={destination.path} end={destination.path === '/'} className={linkClass} onClick={closeMenu} data-nav-result><NavigationIcon name={destination.icon} /><span><strong>{destination.label}</strong><small>{destination.detail}</small></span></NavLink>
              {destination.path !== '/' && <button className="pin-nav" aria-label={`${pins.includes(destination.path) ? 'Unpin' : 'Pin'} ${destination.label}`} title={pins.includes(destination.path) ? 'Remove mobile shortcut' : pins.length >= 3 ? 'Unpin a page first' : 'Add mobile shortcut'} aria-pressed={pins.includes(destination.path)} disabled={!pins.includes(destination.path) && pins.length >= 3} onClick={() => pin(destination.path, destination.label)}>{pins.includes(destination.path) ? '★' : '☆'}</button>}
            </div>)}</div>
          })}
          {results.length === 0 && <p className="navigation-empty">No page matches “{query}”. Try “tasks”, “health” or “practice”.</p>}
        </nav>
      </dialog>
    </div>
    <MobileActionBar />
  </TimerProvider>
}
