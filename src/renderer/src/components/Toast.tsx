import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface ToastOptions {
  action?: { label: string; run: () => void }
  error?: boolean
  /** Milliseconds; defaults to 6 seconds, or 8 with an action. */
  duration?: number
}

interface ToastState {
  id: number
  message: string
  options: ToastOptions
}

const Ctx = createContext<(message: string, options?: ToastOptions) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const counter = useRef(0)

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    counter.current += 1
    setToast({ id: counter.current, message, options })
  }, [])

  useEffect(() => {
    if (!toast) return
    const ms = toast.options.duration ?? (toast.options.action ? 8000 : 6000)
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), ms)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast${toast.options.error ? ' error' : ''}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.options.action && (
            <button
              type="button"
              onClick={() => {
                toast.options.action!.run()
                setToast(null)
              }}
            >
              {toast.options.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
