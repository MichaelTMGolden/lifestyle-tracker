// Toast with an optional action (usually Undo). One provider near the root.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastInput } from './toastContext'

type ToastItem = ToastInput & { id: number }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++
    // An action needs time to reach; errors stay a little longer to be read.
    const duration = toast.duration ?? (toast.action ? 6000 : toast.tone === 'error' ? 6000 : 3500)
    setToasts(list => [...list.slice(-2), { ...toast, id }])
    timers.current.set(id, setTimeout(() => dismiss(id), duration))
    return id
  }, [dismiss])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return <ToastContext.Provider value={api}>
    {children}
    <div className="ui-toasts" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={`ui-toast${t.tone === 'error' ? ' ui-toast--error' : ''}`}>
        <span className="ui-toast__msg">{t.message}</span>
        {t.action && <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => { dismiss(t.id); t.action!.onClick() }}>{t.action.label}</button>}
      </div>)}
    </div>
  </ToastContext.Provider>
}
