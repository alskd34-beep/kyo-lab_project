"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, Check, AlertCircle, AlertTriangle, Info } from "lucide-react"
import { cn } from "@frontend/lib/utils"

interface Notif {
  id: string
  type: string
  title: string
  body: string | null
  severity: string
  isRead: boolean
  createdAt: string
}

const SEV_ICON: Record<string, React.ReactNode> = {
  critical: <AlertTriangle size={15} className="text-red-500" />,
  warning: <AlertCircle size={15} className="text-amber-500" />,
  info: <Info size={15} className="text-blue-500" />,
}

export default function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=30", { credentials: "include" })
      if (!res.ok) return
      const data = await res.json()
      setRows(data.rows ?? [])
      setUnread(data.unread ?? 0)
    } catch { /* noop */ }
  }, [])

  // 최초 + 60초 폴링 (load는 async — setState는 fetch 이후 비동기로 일어남)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const t = setInterval(() => void load(), 60000)
    return () => clearInterval(t)
  }, [load])

  // 외부 클릭 닫기
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const markAll = async () => {
    await fetch("/api/notifications", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" })
    await load()
  }
  const markOne = async (id: string) => {
    await fetch("/api/notifications", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
    await load()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) void load() }}
        className={cn("relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
        aria-label="알림"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-xs leading-normal font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[min(92vw,360px)] overflow-hidden rounded-md border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-bold text-foreground">알림</span>
            {unread > 0 && (
              <button onClick={markAll} className="inline-flex items-center gap-1 text-xs leading-normal font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200">
                <Check size={12} />모두 읽음
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">알림이 없습니다.</p>
            ) : rows.map(n => (
              <button
                key={n.id}
                onClick={() => !n.isRead && markOne(n.id)}
                className={`flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${n.isRead ? "" : "bg-blue-50/40 dark:bg-blue-950/40"}`}
              >
                <span className="mt-0.5 shrink-0">{SEV_ICON[n.severity] ?? SEV_ICON.info}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={`truncate text-sm ${n.isRead ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}`}>{n.title}</p>
                    {!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-0.5 text-xs leading-normal text-muted-foreground">{new Date(n.createdAt).toLocaleString("ko-KR")}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
