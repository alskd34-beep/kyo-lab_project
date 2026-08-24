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
import { Button } from "@frontend/components/ui/button"
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
  { icon: typeof Info; iconClassName: string; buttonVariant: "default" | "destructive" }
> = {
  default: {
    icon: Info,
    iconClassName: "bg-primary/10 text-primary",
    buttonVariant: "default",
  },
  // 앰버는 토큰이 없어 리터럴을 쓴다 — 다크에서는 명도만 뒤집는다(50->950, 600->300).
  warning: {
    icon: AlertTriangle,
    iconClassName: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300",
    buttonVariant: "default",
  },
  danger: {
    icon: AlertTriangle,
    iconClassName: "bg-destructive/10 text-destructive",
    buttonVariant: "destructive",
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
      <DialogContent
        size="sm"
        overlayClassName="z-[110]"
        className="z-[120]"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <div
            className={cn(
              "mb-1 flex size-10 items-center justify-center rounded-md",
              style.iconClassName,
            )}
          >
            <Icon className="size-5" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-6">{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={style.buttonVariant}
            onClick={() => void onConfirm()}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "처리 중..." : confirmLabel}
          </Button>
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
