import { createContext, useContext, type ReactNode } from 'react'

export type ToastAction = { label: string; onClick: () => void }
export type ToastInput = { message: ReactNode; action?: ToastAction; tone?: 'error'; duration?: number }
export type ToastApi = { show: (toast: ToastInput) => number; dismiss: (id: number) => void }

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}

/**
 * A modal sheet makes the rest of the page inert and draws above it, so while
 * one is open toasts render inside it. Sheets register themselves here; the
 * most recently opened one hosts the toasts. Returns an unregister function.
 */
export type ToastHostApi = { register: (host: HTMLElement) => () => void }
export const ToastHostContext = createContext<ToastHostApi | null>(null)
