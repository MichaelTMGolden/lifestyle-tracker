import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import './ux.css'
import './shell.css'
import { TimerProvider } from './timer/TimerContext'
import { SessionWatcher } from './pages/focus/SessionWatcher'
import { MobileActionBar } from './components/MobileActionBar'
import { QuickLogSheet } from './components/QuickLog'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { Icon, ListRow, Sheet, ToastProvider } from './ui'
import { useToast, type IconName } from './ui/hooks'
import { pendingWrites, startHabitSync, subscribe } from './offline/habitSync'
import { refreshPush } from './push'

type Destination = { path: string; label: string; detail: string; keywords: string; icon: IconName }

// The three daily destinations get the tab bar; everything else lives under More.
const primary: Destination[] = [
  { path: '/', label: 'Today', detail: 'Focus, next steps and your day', keywords: 'home dashboard now priorities', icon: 'today' },
  { path: '/habits', label: 'Habits', detail: 'Practice, goals and streaks', keywords: 'skills timers rhythm challenges sessions heatmap', icon: 'habits' },
  { path: '/tasks', label: 'Plan', detail: 'Tasks and what is coming up', keywords: 'todo to-do tasks priorities backlog', icon: 'plan' },
]
const secondary: Destination[] = [
  { path: '/focus', label: 'Focus', detail: 'A full-screen timer for one habit', keywords: 'timer practice session stopwatch concentrate', icon: 'play' },
  { path: '/stats', label: 'Stats', detail: 'Your year across every habit', keywords: 'statistics progress year months streaks hours insights', icon: 'review' },
  { path: '/health', label: 'Health', detail: 'Readiness, trends and your weekly summary', keywords: 'sleep heart steps garmin stress body battery review weekly summary', icon: 'health' },
  { path: '/schedule', label: 'Routine', detail: 'Your weekly routine template', keywords: 'schedule calendar timetable agenda routine week template', icon: 'schedule' },
  { path: '/connect', label: 'Connect', detail: 'Connected data sources', keywords: 'integrations sync import garmin google', icon: 'connect' },
  { path: '/settings', label: 'Settings', detail: 'Targets and baselines', keywords: 'preferences configuration', icon: 'settings' },
]
const all = [...primary, ...secondary]

const matches = (d: Destination, pathname: string) => d.path === '/' ? pathname === '/' : pathname === d.path || pathname.startsWith(`${d.path}/`)
const sideClass = ({ isActive }: { isActive: boolean }) => isActive ? 'side-link active' : 'side-link'
const tabClass = ({ isActive }: { isActive: boolean }) => isActive ? 'tab-link active' : 'tab-link'

export default function Layout() {
  const main = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = all.find(d => matches(d, location.pathname))
  const inMore = !primary.some(d => matches(d, location.pathname))
  const q = query.trim().toLocaleLowerCase()
  const results = q ? all.filter(d => `${d.label} ${d.detail} ${d.keywords}`.toLocaleLowerCase().includes(q)) : secondary

  const openMore = useCallback(() => { setQuery(''); setMoreOpen(true) }, [])

  // The app icon's Quick log shortcut opens /?quick=1; closing the sheet tidies the address.
  const quickFromUrl = new URLSearchParams(location.search).get('quick') === '1'
  const closeQuick = useCallback(() => {
    setQuickOpen(false)
    const params = new URLSearchParams(location.search)
    if (params.get('quick') !== '1') return
    params.delete('quick')
    navigate({ pathname: location.pathname, search: params.size ? `?${params}` : '' }, { replace: true })
  }, [location.search, location.pathname, navigate])
  const closeMore = useCallback(() => setMoreOpen(false), [])

  useEffect(() => {
    document.title = `${current?.label ?? 'Dashboard'} · Personal Dashboard`
    main.current?.focus({ preventScroll: true })
    // A link to a section (/stats#levels) lands on it; any other page change starts at the top.
    // Child effects run first, so a section already on screen is found here.
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [location.pathname, location.hash, current?.label])

  // Focus the search box once the sheet has opened (desktop keyboard users).
  useEffect(() => { if (moreOpen && window.matchMedia('(min-width: 1024px)').matches) searchInput.current?.focus() }, [moreOpen])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k' || event.repeat || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault(); openMore()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [openMore])

  return <TimerProvider>
    <SessionWatcher />
    <ToastProvider>
      <div className="app dashboard-shell">
        <a className="skip-link" href="#main-content">Skip to content</a>

        <aside className="desktop-sidebar" aria-label="Dashboard navigation">
          <NavLink to="/" className="sidebar-brand" aria-label="Personal Dashboard home"><span className="brand">Personal<br />Dashboard</span></NavLink>
          <button className="sidebar-search sidebar-quick" onClick={() => setQuickOpen(true)} aria-haspopup="dialog" aria-expanded={quickOpen}><Icon name="plus" /><span>Quick log</span></button>
          <button className="sidebar-search" onClick={openMore} aria-haspopup="dialog" aria-expanded={moreOpen}><Icon name="search" /><span>Find a page</span><kbd>Ctrl K</kbd></button>
          <nav className="sidebar-groups" aria-label="Main navigation">
            <div className="sidebar-group">
              {primary.map(d => <NavLink key={d.path} to={d.path} end={d.path === '/'} className={sideClass}><Icon name={d.icon} /><span>{d.label}</span></NavLink>)}
            </div>
            <div className="sidebar-group">
              <h2>More</h2>
              {secondary.map(d => <NavLink key={d.path} to={d.path} className={sideClass}><Icon name={d.icon} /><span>{d.label}</span></NavLink>)}
            </div>
          </nav>
        </aside>

        <div className="shell-content">
          <main id="main-content" ref={main} tabIndex={-1}>
            <RouteErrorBoundary key={location.pathname}><div className="route-view"><Outlet /></div></RouteErrorBoundary>
          </main>
        </div>

        <nav className="tab-bar" aria-label="Main navigation">
          {primary.map(d => <NavLink key={d.path} to={d.path} end={d.path === '/'} className={tabClass}><Icon name={d.icon} /><span>{d.label}</span></NavLink>)}
          <button type="button" className={`tab-link${inMore ? ' active' : ''}`} onClick={openMore} aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={inMore ? 'page' : undefined}>
            <Icon name="more" /><span>More</span>
          </button>
        </nav>

        <Sheet open={moreOpen} onClose={closeMore} title="More" labelledBy="more-sheet-title">
          <div className="more-search">
            <Icon name="search" />
            <label className="ui-sr-only" htmlFor="page-search">Search pages</label>
            <input id="page-search" ref={searchInput} type="search" value={query} placeholder="Find a page" autoComplete="off"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); closeMore(); navigate(results[0].path) } }} />
          </div>
          <p className="ui-sr-only" role="status">{q ? `${results.length} pages found.` : ''}</p>
          <nav aria-label="More pages" className="ui-list">
            {results.map(d => <ListRow key={d.path} to={d.path} icon={d.icon} title={d.label} meta={d.detail} current={matches(d, location.pathname)} onClick={closeMore} />)}
            {results.length === 0 && <p className="more-empty">No page matches “{query}”.</p>}
          </nav>
        </Sheet>
      </div>
      <MobileActionBar />
      {/* Desktop entry point; on phones the action bar opens its own. */}
      <QuickLogSheet open={quickOpen || quickFromUrl} onClose={closeQuick} />
      <HabitSync />
        <UpdatePrompt />
    </ToastProvider>
  </TimerProvider>
}

/**
 * Offers a reload once the service worker has saved a newer version (it opens
 * from the saved copy, so otherwise the new one only shows on a later open).
 * Quiet when this page already runs that version.
 */
function UpdatePrompt() {
  const toast = useToast()
  const shown = useRef(false)
  useEffect(() => {
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    if (!sw) return
    const running = [...document.scripts].map(s => s.src ? new URL(s.src).pathname : '').filter(p => p.startsWith('/assets/'))
    const onMessage = (event: MessageEvent) => {
      const files: unknown = event.data?.files
      if (event.data?.type !== 'build-ready' || !Array.isArray(files) || shown.current) return
      if (running.length > 0 && running.every(p => files.includes(p))) return
      shown.current = true
      toast.show({ message: 'Update ready', action: { label: 'Reload', onClick: () => window.location.reload() }, duration: 30 * 60_000 })
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [toast])
  return null
}

/** Sends habit taps saved while offline, and says how many are still waiting. */
function HabitSync() {
  const toast = useToast()
  const qc = useQueryClient()
  const waiting = useSyncExternalStore(subscribe, pendingWrites).length
  // Keep this device's push subscription and time zone current for reminders.
  useEffect(() => { void refreshPush() }, [])
  useEffect(() => {
    startHabitSync((w, reason) => toast.show({ message: `Couldn't sync ${w.habitName} (${w.date}): ${reason}`, tone: 'error', duration: 10000 }))
    const synced = () => {
      toast.show({ message: 'Offline taps synced.' })
      void qc.invalidateQueries({ queryKey: ['today-bundle'] })
      void qc.invalidateQueries({ queryKey: ['goals'] })
      void qc.invalidateQueries({ queryKey: ['stats'] })
    }
    window.addEventListener('pd:habits-synced', synced)
    return () => window.removeEventListener('pd:habits-synced', synced)
  }, [toast, qc])
  if (!waiting) return null
  return <p className="sync-note" role="status">{waiting} {waiting === 1 ? 'tap' : 'taps'} saved offline · will sync when you're back online</p>
}
