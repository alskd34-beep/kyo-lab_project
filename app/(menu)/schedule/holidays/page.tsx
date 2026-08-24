"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { Plus, Trash2, Loader2, ChevronLeft, ChevronRight, Download } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { SortColumnHeader, sortCol, type SortDir } from "@frontend/components/ui/table-sort"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { Input } from "@frontend/components/ui/input"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"

// ─── Types ───────────────────────────────────────────────────────────────────
interface HolidayRow {
  date: string
  description: string
  source?: "api" | "manual"
  createdAt?: string
}

type SortField = "date" | "description" | "source"

const SORT_COLUMNS = [
  sortCol<SortField>("date", "날짜"),
  sortCol<SortField>("description", "설명"),
  sortCol<SortField>("source", "구분"),
]

function fieldValue(row: HolidayRow, field: SortField): string {
  if (field === "source") return row.source === "api" ? "API" : "수동"
  return row[field] ?? ""
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
  const [detailTarget, setDetailTarget] = useState<HolidayRow | null>(null)
  const [sortField, setSortField] = useState<SortField>("date")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  const sortedRows = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = fieldValue(a, sortField)
      const bv = fieldValue(b, sortField)
      return av.localeCompare(bv, "ko") * mul
    })
  }, [rows, sortField, sortDir])

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
      setRows(prev => prev.filter(row => row.date !== date))
      setDetailTarget(current => current?.date === date ? null : current)
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      {/* ── 페이지 머리 ────────────────────────────────────────────────────
          파란 아이콘 사각형은 제목이 하는 말을 그림으로 한 번 더 하는 장식이라 걷어냈다.
          부제는 화면 이름 되풀이가 아니라 실제 규칙이므로 남긴다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">공휴일 관리</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            등록된 공휴일은 PCT 시험 스케줄 자동배정 시 비근무일로 처리됩니다.
          </p>
        </div>
        {isAdmin && (
          /* 모바일에선 두 버튼이 한 줄을 넘겨 라벨이 두 줄로 접힌다 —
             폭을 반씩 나눠 갖게 하고, 연도는 아래 연도 네비에 이미 있으니 좁은 폭에선 숨긴다. */
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button
              variant="outline"
              size="lg"
              onClick={() => void importFromApi()}
              disabled={importing}
              title="data.go.kr 공휴일 API 에서 해당 연도를 불러와 반영합니다(수동 등록은 보존)."
              className="min-w-0 flex-1 sm:flex-none"
            >
              {importing ? <Loader2 className="animate-spin" /> : <Download />}
              <span className="truncate">
                <span className="hidden tabular-nums sm:inline">{year}년 </span>API로 불러오기
              </span>
            </Button>
            <Button size="lg" onClick={() => setShowAdd(true)} className="min-w-0 flex-1 sm:flex-none">
              <Plus /> 공휴일 추가
            </Button>
          </div>
        )}
      </header>

      {/* Flash message */}
      {msg && (
        <p className={`shrink-0 rounded-md border px-3 py-2 text-xs break-keep ${
          msgType === "err"
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-primary/20 bg-primary/10 text-primary"
        }`}>
          {msg}
        </p>
      )}

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 py-0">
        {/* 연도 이동을 별도 줄로 띄우면 제목·연도·표 머리가 세 층으로 겹친다.
            표 머리에 붙여 "지금 몇 년을 보고 있는가"와 건수를 한 줄에서 읽게 한다. */}
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="이전 연도" onClick={() => setYear(y => y - 1)}>
              <ChevronLeft />
            </Button>
            <h2 className="min-w-16 text-center text-sm font-semibold tabular-nums text-foreground">{year}년</h2>
            <Button variant="ghost" size="icon" aria-label="다음 연도" onClick={() => setYear(y => y + 1)}>
              <ChevronRight />
            </Button>
          </div>
          <p className="text-xs leading-normal text-muted-foreground">
            공휴일 <span className="font-semibold tabular-nums text-foreground">{rows.length}</span>일
          </p>
        </div>
        {/* ── 모바일 — 표를 표로 두지 않는다. 실선으로만 나눈 요약 목록 ──────────
            날짜·공휴일명·구분 세 값만 남기고, 정렬 머리는 데스크톱 표에만 둔다. */}
        <div className="min-h-0 min-w-0 flex-1 divide-y overflow-y-auto md:hidden">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))
            : rows.length === 0
              ? (
                  <p className="px-4 py-12 text-center text-sm break-keep text-muted-foreground">
                    <span className="tabular-nums">{year}</span>년에 등록된 공휴일이 없습니다.
                  </p>
                )
              : sortedRows.map(r => (
                  <button
                    key={r.date}
                    type="button"
                    onClick={() => setDetailTarget(r)}
                    className="flex w-full min-w-0 flex-col px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <span className="min-w-0 truncate text-sm font-medium break-keep text-foreground">
                      {r.description || "—"}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                      <span className="font-mono tabular-nums">{r.date}</span>
                      <span className="text-border">·</span>
                      <span>{r.source === "api" ? "API" : "수동"}</span>
                    </span>
                  </button>
                ))}
        </div>

        {/* ── 데스크톱 ─────────────────────────────────────────────────────── */}
        <div className="hidden min-h-0 min-w-0 flex-1 flex-col md:flex">
        <Table>
          <colgroup>
            <col className="w-[24%]" />
            <col />
            <col className="w-[16%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {SORT_COLUMNS.map((col) => (
                <TableHead key={col.key}>
                  <SortColumnHeader
                    col={col}
                    sortField={sortField}
                    sortDir={sortDir}
                    onPick={pickSort}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 rounded-md" /></TableCell>
                  </TableRow>
                ))
              : rows.length === 0
                ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={3} className="py-16 text-center text-sm text-muted-foreground">
                        {year}년에 등록된 공휴일이 없습니다.
                      </TableCell>
                    </TableRow>
                  )
                : sortedRows.map(r => (
                    <TableRow key={r.date} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetailTarget(r)}>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{r.date}</TableCell>
                      <TableCell className="font-medium text-foreground">
                        <span className="block truncate" title={r.description || undefined}>{r.description || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.source === "api" ? "API" : "수동"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
          </TableBody>
        </Table>
        </div>
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

      {detailTarget && (
        <ManagementDrawer
          open
          onOpenChange={(open) => { if (!open) setDetailTarget(null) }}
          size="sm"
          title="공휴일 상세"
          description="공휴일 정보를 확인하고 필요한 작업을 선택합니다."
          footer={(
            <>
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => void remove(detailTarget.date)}
                  disabled={busy === detailTarget.date}
                >
                  {busy === detailTarget.date ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  삭제
                </Button>
              )}
              <Button variant="outline" onClick={() => setDetailTarget(null)}>닫기</Button>
            </>
          )}
        >
          {/* 드로어 안에 다시 테두리 상자를 두르지 않는다 — 실선으로만 나눈다. */}
          <dl className="divide-y text-sm">
            <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
              <dt className="text-xs text-muted-foreground">날짜</dt>
              <dd className="font-mono font-medium tabular-nums text-foreground">{detailTarget.date}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-xs text-muted-foreground">공휴일명</dt>
              <dd className="min-w-0 truncate font-medium break-keep text-foreground">{detailTarget.description || "-"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-xs text-muted-foreground">등록 구분</dt>
              <dd><Badge variant="outline">{detailTarget.source === "api" ? "API" : "수동"}</Badge></dd>
            </div>
          </dl>
        </ManagementDrawer>
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
  const uid = useId()
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
    <ManagementDrawer
      open={open}
      onOpenChange={(next) => { if (!next && !saving) onClose() }}
      size="sm"
      title="공휴일 추가"
      description="날짜와 설명을 입력해 공휴일을 등록합니다."
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            추가
          </Button>
        </>
      )}
    >
        <div className="grid gap-3">
          <DateField label="날짜" value={date} onChange={setDate} />
          <div>
            <label htmlFor={`${uid}-description`} className="mb-1 block text-xs font-medium text-muted-foreground">설명</label>
            <Input
              id={`${uid}-description`}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="예) 설날, 어린이날"
            />
          </div>
        </div>
    </ManagementDrawer>
  )
}
