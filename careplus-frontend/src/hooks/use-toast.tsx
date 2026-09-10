import * as React from "react"

export type ToastVariant = "success" | "error" | "info"

export interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastContextValue {
  toasts: ToastItem[]
  toast: (t: Omit<ToastItem, "id">) => void
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = React.useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((prev) => [...prev, { ...t, id }])
      setTimeout(() => dismiss(id), 4500)
    },
    [dismiss]
  )

  React.useEffect(() => {
    const onApiError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      toast({ title: "Request failed", description: detail?.message || "The hospital server could not complete the request.", variant: "error" })
    }
    window.addEventListener("careplus:api-error", onApiError)
    return () => window.removeEventListener("careplus:api-error", onApiError)
  }, [toast])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}
