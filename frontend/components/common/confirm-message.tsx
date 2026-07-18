"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { AlertTriangle, Info, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { cn } from "@frontend/lib/utils"

export type ConfirmMessageVariant = "default" | "warning" | "danger"

export interface ConfirmMessageInput {
  title: string
  description: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmMessageVariant
}

interface ConfirmMessageDialogProps extends ConfirmMessageInput {
  open: boolean
  pending?: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

const VARIANT_STYLE: Record<
  ConfirmMessageVariant,
  { icon: typeof Info; iconClassName: string; buttonClassName: string }
> = {
  default: {
    icon: Info,
    iconClassName: "bg-blue-50 text-blue-600 ring-blue-100",
    buttonClassName: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-300",
  },
  warning: {
    icon: AlertTriangle,
    iconClassName: "bg-amber-50 text-amber-600 ring-amber-100",
    buttonClassName: "bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-300",
  },
  danger: {
    icon: AlertTriangle,
    iconClassName: "bg-red-50 text-red-600 ring-red-100",
    buttonClassName: "bg-red-600 hover:bg-red-700 focus-visible:ring-red-300",
  },
}

export function ConfirmMessageDialog({
  open,
  title,
  description,
  confirmLabel = "확인",
  cancelLabel = "취소",
  variant = "danger",
  pending = false,
  error,
  onOpenChange,
  onConfirm,
}: ConfirmMessageDialogProps) {
  const style = VARIANT_STYLE[variant]
  const Icon = style.icon

  return (
    <Dialog open={open} onOpenChange={nextOpen => !pending && onOpenChange(nextOpen)}>
      <DialogContent overlayClassName="z-[110]" className="z-[120] max-w-sm gap-5">
        <DialogHeader className="items-center text-center sm:items-start sm:text-left">
          <div
            className={cn(
              "mb-1 flex size-11 items-center justify-center rounded-full ring-8",
              style.iconClassName,
            )}
          >
            <Icon className="size-5" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-6">{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={pending}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
              style.buttonClassName,
            )}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "처리 중..." : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ConfirmMessageContextValue {
  requestConfirm: (input: ConfirmMessageInput) => Promise<boolean>
}

const ConfirmMessageContext = createContext<ConfirmMessageContextValue | null>(null)

export function ConfirmMessageProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmMessageInput | null>(null)
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null)

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(confirmed)
  }, [])

  const requestConfirm = useCallback((input: ConfirmMessageInput) => {
    resolverRef.current?.(false)
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve
      setRequest(input)
    })
  }, [])

  useEffect(() => {
    return () => resolverRef.current?.(false)
  }, [])

  return (
    <ConfirmMessageContext.Provider value={{ requestConfirm }}>
      {children}
      <ConfirmMessageDialog
        open={request !== null}
        title={request?.title ?? "확인"}
        description={request?.description ?? "계속 진행할까요?"}
        confirmLabel={request?.confirmLabel}
        cancelLabel={request?.cancelLabel}
        variant={request?.variant}
        onOpenChange={nextOpen => {
          if (!nextOpen) settle(false)
        }}
        onConfirm={() => settle(true)}
      />
    </ConfirmMessageContext.Provider>
  )
}

export function useConfirmMessage() {
  const context = useContext(ConfirmMessageContext)
  if (!context) {
    throw new Error("useConfirmMessage must be used within ConfirmMessageProvider")
  }
  return context
}
