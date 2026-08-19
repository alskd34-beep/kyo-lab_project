"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactElement } from "react"
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react"
import { cn } from "@frontend/lib/utils"

export type ToastVariant = "info" | "success" | "warning" | "error"

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastItem extends Required<Pick<ToastInput, "title">> {
  id: string
  description?: string
  variant: ToastVariant
  duration: number
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => string
  dismissToast: (id: string) => void
  clearToasts: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const TOAST_STYLE: Record<
  ToastVariant,
  { ring: string; accent: string; icon: ReactElement }
> = {
  info: {
    ring: "border-blue-200 bg-blue-50 text-blue-700 shadow-blue-100/40",
    accent: "bg-blue-600",
    icon: <Info size={16} />,
  },
  success: {
    ring: "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-emerald-100/40",
    accent: "bg-emerald-600",
    icon: <CheckCircle2 size={16} />,
  },
  warning: {
    ring: "border-amber-200 bg-amber-50 text-amber-700 shadow-amber-100/40",
    accent: "bg-amber-500",
    icon: <TriangleAlert size={16} />,
  },
  error: {
    ring: "border-rose-200 bg-rose-50 text-rose-700 shadow-rose-100/40",
    accent: "bg-rose-600",
    icon: <AlertCircle size={16} />,
  },
}

export function ToastMessageProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const clearToasts = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    setToasts([])
  }, [])

  const showToast = useCallback(
    (toast: ToastInput) => {
      const id = createId()
      const next: ToastItem = {
        id,
        title: toast.title,
        description: toast.description,
        variant: toast.variant ?? "info",
        duration: toast.duration ?? 3500,
      }

      setToasts((prev) => [...prev.slice(-3), next])

      const timer = setTimeout(() => {
        dismissToast(id)
      }, next.duration)
      timersRef.current.set(id, timer)

      return id
    },
    [dismissToast]
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const value = useMemo(
    () => ({ showToast, dismissToast, clearToasts }),
    [showToast, dismissToast, clearToasts]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 sm:right-4 sm:top-4 sm:w-[360px]"
      >
        {toasts.map((toast) => {
          const style = TOAST_STYLE[toast.variant]
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                "pointer-events-auto overflow-hidden rounded-md border bg-white shadow-lg shadow-slate-200/60 backdrop-blur",
                style.ring
              )}
            >
              <div className={cn("h-1 w-full", style.accent)} />
              <div className="flex items-start gap-3 px-4 py-3">
                <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white", style.accent)}>
                  {style.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {toast.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="알림 닫기"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToastMessage() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToastMessage must be used within ToastMessageProvider")
  }
  return ctx
}
