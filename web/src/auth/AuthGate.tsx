import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import '../App.css'

/**
 * Shows a password screen when the API reports auth is required and the user
 * isn't signed in. The real protection is the server-side gate on /api/* — this
 * is the UX layer, so if the status check fails we fail open (the API still 401s).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'login'>('loading')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const check = () =>
    api.authStatus()
      .then((s) => setState(s.required && !s.authed ? 'login' : 'ok'))
      .catch(() => setState('ok')) // API unreachable → let the app load; calls will surface errors

  useEffect(() => { check() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    const ok = await api.login(password)
    setBusy(false)
    if (ok) { setError(false); setPassword(''); await check() }
    else setError(true)
  }

  if (state === 'loading') return null
  if (state === 'ok') return <>{children}</>

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-brand">Personal Dashboard</h1>
        <p className="login-sub">Enter the password to continue.</p>
        <input
          type="password" autoFocus value={password} placeholder="Password"
          onChange={(e) => { setPassword(e.target.value); setError(false) }}
        />
        {error && <p className="login-err">Wrong password.</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Enter'}</button>
      </form>
    </div>
  )
}
