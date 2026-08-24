"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { ActorAvatar, primePeopleCacheFromUsers } from "@frontend/lib/tester-profiles"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@frontend/components/ui/table"
import {
  CalendarDays,
  ClipboardPenLine,
  DatabaseZap,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react"

type HistoryType = "edit" | "reassign" | "ingest"
type FilterType = "all" | HistoryType

interface HistoryRow {
  id: string
  type: HistoryType
  occurredAt: string
  orderId: string | null
  productName: string | null
  productCode: string | null
  batchNo: string | null
  title: string
  summary: string
  field: string | null
  beforeValue: string | null
  afterValue: string | null
  reason: string | null
  actorId: string | null
  actorName: string | null
  status: string | null
}

interface HistoryStats {
  total: number
  edits: number
  reassignments: number
  ingests: number
}

const FILTERS: Array<{ id: FilterType; label: string }> = [
  { id: "all", label: "전체" },
  { id: "edit", label: "오더 수정" },
  { id: "reassign", label: "담당자 변경" },
  { id: "ingest", label: "자동 적재" },
]

/* 오더 수정과 담당자 변경이 똑같은 파랑이라 배지 색이 아무것도 구분해 주지 못했다.
   셋을 서로 다르게 두되 브랜드 파랑 밖으로 나가지 않게 한다 —
   자동 적재는 사람이 한 일이 아니라 잉크를 뺀 중립색으로 물러앉힌다(초록은 '완료'와 겹쳤다). */
const TYPE_META: Record<HistoryType, { label: string; icon: typeof History; className: string }> = {
  edit: {
    label: "오더 수정",
    icon: ClipboardPenLine,
    className: "",
  },
  reassign: {
    label: "담당자 변경",
    icon: UserRoundCheck,
    className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  ingest: {
    label: "자동 적재",
    icon: DatabaseZap,
    className: "bg-muted text-muted-foreground",
  },
}

type SortField = "occurredAt" | "type" | "productName" | "productCode" | "batchNo" | "title" | "actorName"

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  sortCol("occurredAt", "일시"),
  sortCol("type", "유형"),
  {
    key: "order",
    label: "오더",
    // 본문이 품목명/품목코드/제조번호를 한 칸에 그리므로 칸을 나누지 않는다.
    noSplit: true,
    fields: [
      { id: "productName", label: "품목명" },
      { id: "productCode", label: "품목코드" },
      { id: "batchNo", label: "제조번호" },
    ],
  },
  // 본문이 "요약 · 사유"를 한 칸에 이어 붙이므로 칸을 나누지 않는다(나누면 보조 헤더가 빈칸).
  { ...sortCol("title", "내용"), noSplit: true },
  sortCol("actorName", "작업자"),
]

function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })
}

function TypeBadge({ type }: { type: HistoryType }) {
  const meta = TYPE_META[type]
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap", meta.className)}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  )
}

function StatCell({ title, value }: { title: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col bg-card px-4 py-3">
      <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
      <span className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString("ko-KR")}</span>
    </div>
  )
}

function LoadingRows() {
  return Array.from({ length: 7 }).map((_, i) => (
    <TableRow key={i}>
      <TableCell className="px-3 py-3"><Skeleton className="h-4 w-28" /></TableCell>
      <TableCell className="px-3 py-3"><Skeleton className="h-6 w-20 rounded-md" /></TableCell>
      <TableCell className="px-3 py-3"><Skeleton className="h-4 w-36" /></TableCell>
      <TableCell className="px-3 py-3"><Skeleton className="h-4 w-56" /></TableCell>
      <TableCell className="px-3 py-3"><Skeleton className="h-4 w-24" /></TableCell>
    </TableRow>
  ))
}

function todayDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function daysAgoDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function ReassignmentsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<HistoryRow[]>([])
  const [stats, setStats] = useState<HistoryStats>({ total: 0, edits: 0, reassignments: 0, ingests: 0 })
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterType>("all")
  const [query, setQuery] = useState("")
  const [fromDate, setFromDate] = useState(() => daysAgoDate(30))
  const [toDate, setToDate] = useState(() => todayDate())
  const [sortField, setSortField] = useState<SortField>("occurredAt")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    if (fromDate && toDate && fromDate > toDate) {
      setMsg("조회 시작일은 종료일보다 늦을 수 없습니다.")
      setLoading(false)
      return
    }
    try {
      const params = new URLSearchParams({ limit: "1000" })
      if (fromDate) params.set("from", fromDate)
      if (toDate) params.set("to", toDate)
      // 작업자 칸에 계정 사진을 띄우려면 사용자 명부가 프로필 캐시에 있어야 한다.
      // 이력에 찍히는 사람은 대개 시험자가 아니라 관리자 계정이라
      // /api/testers 만으로는 매칭되지 않는다. (관리자 전용 화면이라 조회 가능)
      const [res, usersRes] = await Promise.all([
        fetch(`/api/ai-schedule-history?${params.toString()}`, { credentials: "include" }),
        fetch("/api/users", { credentials: "include" }).catch(() => null),
      ])
      if (usersRes?.ok) {
        const users = (await usersRes.json()).rows
        if (Array.isArray(users)) primePeopleCacheFromUsers(users)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "조회 실패")
      setRows(data.rows ?? [])
      setStats(data.stats ?? { total: 0, edits: 0, reassignments: 0, ingests: 0 })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "AI 스케줄 이력을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter(row => {
      if (filter !== "all" && row.type !== filter) return false
      if (!needle) return true
      return [
        row.productName,
        row.productCode,
        row.batchNo,
        row.title,
        row.summary,
        row.reason,
        row.actorName,
        row.status,
      ].some(value => (value ?? "").toLowerCase().includes(needle))
    })
  }, [rows, filter, query])

  const displayedRows = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1
    return [...filteredRows].sort((a, b) => {
      const av = a[sortField] ?? ""
      const bv = b[sortField] ?? ""
      if (sortField === "occurredAt") {
        return String(av).localeCompare(String(bv)) * mul
      }
      if (sortField === "type") {
        return (TYPE_META[a.type]?.label ?? a.type).localeCompare((TYPE_META[b.type]?.label ?? b.type), "ko") * mul
      }
      return String(av).localeCompare(String(bv), "ko") * mul
    })
  }, [filteredRows, sortField, sortDir])

  if (!isAdmin) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <p className="flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm break-keep text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <ShieldAlert size={16} className="shrink-0" /> 관리자만 접근할 수 있는 화면입니다.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      {/* ── 페이지 머리 ────────────────────────────────────────────────────
          부제가 아래 필터 칩(전체·오더 수정·담당자 변경·자동 적재)을 그대로 읽어 주고 있었다.
          지우고 그 자리에 "언제부터 언제까지를 보고 있는가"라는 사실을 적는다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">AI 스케줄 전체 이력</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            <span className="tabular-nums">{fromDate || "처음"}</span> ~ <span className="tabular-nums">{toDate || "오늘"}</span> 조회
          </p>
        </div>
        <Button variant="outline" size="lg" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          새로고침
        </Button>
      </header>

      {msg && (
        <p className="shrink-0 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs break-keep text-destructive">{msg}</p>
      )}

      {/* 네 장의 카드 대신 카드 한 장을 실선으로 나눈다 — 테두리를 가진 층은 하나만 */}
      <Card className="shrink-0 gap-0 py-0">
        <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
          <StatCell title="전체 이력" value={stats.total} />
          <StatCell title="오더 수정" value={stats.edits} />
          <StatCell title="담당자 변경" value={stats.reassignments} />
          <StatCell title="자동 적재" value={stats.ingests} />
        </div>
      </Card>

      {/* 조회조건 줄 — 위아래가 전부 테두리 상자면 리듬이 죽는다. 여기는 테두리 없이 둔다.
          필터 4개 + 기간 + 검색이라 좁은 폭에선 반드시 넘친다 → flex-wrap 으로 줄을 접는다. */}
      <div className="flex min-w-0 shrink-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={cn(
                "h-8 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                filter === item.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
          <DateRangeField
            label="조회기간"
            startDate={fromDate}
            endDate={toDate}
            onChange={(start, end) => {
              setFromDate(start)
              setToDate(end)
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => { setFromDate(daysAgoDate(30)); setToDate(todayDate()) }}
          >
            <CalendarDays />
            최근 30일
          </Button>
        </div>
        <div className="relative w-full min-w-0 lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="품목명, 제조번호, 변경내용 검색"
            className="h-8 pl-8"
          />
        </div>
      </div>

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 py-0">
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <History className="size-3.5 text-muted-foreground" />
            타임라인
          </h2>
          <p className="text-xs leading-normal text-muted-foreground">
            표시 <span className="font-semibold tabular-nums text-foreground">{filteredRows.length.toLocaleString("ko-KR")}</span>건
          </p>
        </div>
        {/* ── 모바일 — 표를 표로 두지 않는다 ────────────────────────────────
            다섯 열(일시·유형·오더·내용·작업자)을 320px 에 우겨넣을 수 없다.
            품목명을 주 값으로 올리고 유형·내용·일시·작업자만 남긴 요약 목록으로 접는다. */}
        <div className="min-h-0 min-w-0 flex-1 divide-y overflow-y-auto md:hidden">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            : displayedRows.length === 0
              ? (
                  <p className="px-4 py-12 text-center text-sm break-keep text-muted-foreground">
                    표시할 AI 스케줄 이력이 없습니다.
                  </p>
                )
              : displayedRows.map(row => (
                  <div key={row.id} className="min-w-0 px-4 py-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {row.productName ?? "—"}
                      </p>
                      <TypeBadge type={row.type} />
                    </div>
                    <p className="mt-1 text-xs leading-normal break-keep text-foreground">{row.title}</p>
                    <p className="mt-0.5 truncate text-xs leading-normal text-muted-foreground">
                      {row.summary}
                    </p>
                    <p className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                      <span className="min-w-0 truncate tabular-nums">{formatDateTime(row.occurredAt)}</span>
                      {row.actorName && (
                        <>
                          <span className="text-border">·</span>
                          <span className="min-w-0 truncate">{row.actorName}</span>
                        </>
                      )}
                    </p>
                  </div>
                ))}
        </div>

        {/* ── 데스크톱 ─────────────────────────────────────────────────────── */}
        <div className="hidden min-h-0 min-w-0 flex-1 flex-col md:flex">
        <Table className="text-sm">
          {/* 논리 열 5개 + 다필드 묶음 1개(오더) → 최대 6칸.
              칸 순서(펼침 / 합침):
              일시 · 구분 · 품목명/오더 · 품목코드/내용 · 내용/작업자 · 작업자 */}
          {/* 오더 열이 noSplit 이라 펼침으로 칸이 늘지 않는다 (논리 열 5개 = 최대 5칸). */}
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[22%]" />
            <col className="w-[36%]" />
            <col className="w-[12%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {SORT_COLUMNS.map((col) => (
                <TableHead key={col.key} className="px-3 py-2 text-muted-foreground">
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
            {loading ? (
              <LoadingRows />
            ) : displayedRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="px-3 py-14 text-center text-sm text-muted-foreground">
                  표시할 AI 스케줄 이력이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              /* 눌러도 열리는 화면이 없는 행이다 — 손가락 커서는 달지 않는다. */
              displayedRows.map(row => (
                <TableRow key={row.id} className="hover:bg-muted/40">
                  <TableCell className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                    <span className="block truncate" title={formatDateTime(row.occurredAt)}>
                      {formatDateTime(row.occurredAt)}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <TypeBadge type={row.type} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <CellStack
                      primary={row.productName ?? "—"}
                      secondary={`${row.productCode ?? "—"} · ${row.batchNo ?? "—"}`}
                      primaryClass="font-medium text-foreground"
                      title={[row.productName, row.productCode, row.batchNo].filter(Boolean).join(" / ")}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <CellStack
                      primary={row.title}
                      secondary={row.reason ? `${row.summary} · 사유: ${row.reason}` : row.summary}
                      primaryClass="font-medium text-foreground"
                      title={[row.title, row.summary, row.reason ? `사유: ${row.reason}` : ""].filter(Boolean).join(" / ")}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                    {row.actorName ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <ActorAvatar actorId={row.actorId} name={row.actorName} size="xs" />
                        <span className="block truncate">{row.actorName}</span>
                      </div>
                    ) : (
                      <span className="block truncate">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </Card>
    </div>
  )
}
