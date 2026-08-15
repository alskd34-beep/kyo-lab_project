"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { CalendarDays, Plus, Trash2, Loader2, ChevronLeft, ChevronRight, Download } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { Input } from "@frontend/components/ui/input"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"

// ─── Types ───────────────────────────────────────────────────────────────────
interface HolidayRow {
  date: string
  description: string
  source?: "api" | "manual"
  createdAt?: string
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function HolidaysPage() {
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
  const isAdmin = user?.role === "admin"

  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear())
  const [rows, setRows] = useState<HolidayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgType, setMsgType] = useState<"ok" | "err">("ok")
  const [showAdd, setShowAdd] = useState(false)

  const flash = (m: string, type: "ok" | "err" = "ok") => {
    setMsg(m)
    setMsgType(type)
    setTimeout(() => setMsg(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/holidays?year=${year}`, { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch {
      flash("목록 조회 중 오류가 발생했습니다.", "err")
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const remove = async (date: string) => {
    const confirmed = await requestConfirm({
      title: "공휴일을 삭제할까요?",
      description: `${date} 공휴일을 삭제하면 스케줄 자동배정에서 근무일로 처리될 수 있습니다.`,
      confirmLabel: "공휴일 삭제",
      variant: "danger",
    })
    if (!confirmed) return

    setBusy(date)
    try {
      const res = await fetch("/api/holidays", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      })
      if (!res.ok) {
        const d = await res.json()
        flash(d.error ?? "삭제 실패", "err")
        return
      }
      flash("삭제되었습니다.")
      await load()
    } finally {
      setBusy(null)
    }
  }

  // 현재 보고 있는 연도를 공휴일 API 로 수집해 반영(수동 우선 보존, idempotent)
  const importFromApi = async () => {
    setImporting(true)
    try {
      const res = await fetch("/api/holidays/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      })
      const d = await res.json()
      if (!res.ok) {
        flash(d.error ?? "불러오기 실패", "err")
        return
      }
      flash(`${year}년 공휴일 ${d.imported}건 반영${d.skippedManual ? ` · 수동 ${d.skippedManual}건 보존` : ""}`)
      await load()
    } catch {
      flash("불러오기 중 오류가 발생했습니다.", "err")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">공휴일 관리</h1>
            <p className="text-xs text-slate-500">등록된 공휴일은 PCT 시험 스케줄 자동배정 시 비근무일로 처리됩니다.</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void importFromApi()}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60"
              title="data.go.kr 공휴일 API 에서 해당 연도를 불러와 반영합니다(수동 등록은 보존)."
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {year}년 API로 불러오기
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus size={16} /> 공휴일 추가
            </button>
          </div>
        )}
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          msgType === "err"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}>
          {msg}
        </div>
      )}

      {/* Year nav */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setYear(y => y - 1)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-20 text-center text-base font-bold text-slate-900">{year}년</span>
        <button
          onClick={() => setYear(y => y + 1)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3 text-sm font-semibold text-foreground">
          {year}년 공휴일 ({rows.length}일)
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>날짜</TableHead>
              <TableHead>설명</TableHead>
              <TableHead>구분</TableHead>
              {isAdmin && <TableHead className="text-center">관리</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 rounded-full" /></TableCell>
                    {isAdmin && <TableCell><Skeleton className="mx-auto h-6 w-6 rounded" /></TableCell>}
                  </TableRow>
                ))
              : rows.length === 0
                ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={isAdmin ? 4 : 3} className="py-16 text-center text-sm text-muted-foreground">
                        {year}년에 등록된 공휴일이 없습니다.
                      </TableCell>
                    </TableRow>
                  )
                : rows.map(r => (
                    <TableRow key={r.date}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.date}</TableCell>
                      <TableCell className="font-medium text-foreground">{r.description || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.source === "api" ? "API" : "수동"}</Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void remove(r.date)}
                            disabled={busy === r.date}
                            className="text-destructive hover:text-destructive"
                            title="삭제"
                          >
                            {busy === r.date ? <Loader2 className="animate-spin" /> : <Trash2 className="size-3.5" />}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
      </Card>

      {/* Add modal */}
      {showAdd && (
      <AddModal
        open
        onClose={() => setShowAdd(false)}
        onSaved={() => {
          setShowAdd(false)
          void load()
          flash("공휴일이 추가되었습니다.")
        }}
        onError={(m) => flash(m, "err")}
      />
      )}
    </div>
  )
}

// ─── 추가 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  open,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [date, setDate] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!date) { onError("날짜를 입력하세요."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, description }),
      })
      if (!res.ok) {
        const d = await res.json()
        onError(d.error ?? "추가 실패")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>공휴일 추가</DialogTitle>
          <DialogDescription>날짜와 설명을 입력해 공휴일을 등록합니다.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <DateField label="날짜" value={date} onChange={setDate} />
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">설명</label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="예) 설날, 어린이날"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
