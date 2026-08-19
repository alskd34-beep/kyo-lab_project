"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
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

const TYPE_META: Record<HistoryType, { label: string; icon: typeof History; className: string }> = {
  edit: {
    label: "오더 수정",
    icon: ClipboardPenLine,
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  reassign: {
    label: "담당자 변경",
    icon: UserRoundCheck,
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  ingest: {
    label: "자동 적재",
    icon: DatabaseZap,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
}

type SortField = "occurredAt" | "type" | "productName" | "productCode" | "batchNo" | "title" | "actorName"

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  sortCol("occurredAt", "일시"),
  sortCol("type", "유형"),
  {
    key: "order",
    label: "오더",
    fields: [
      { id: "productName", label: "품목명" },
      { id: "productCode", label: "품목코드" },
      { id: "batchNo", label: "제조번호" },
    ],
  },
  sortCol("title", "내용"),
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

function StatCard({ title, value, tone }: { title: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{title}</p>
      <p className={cn("mt-1 text-2xl font-black tabular-nums", tone)}>{value.toLocaleString("ko-KR")}</p>
    </div>
  )
}

function LoadingRows() {
  return Array.from({ length: 7 }).map((_, i) => (
    <TableRow key={i} className="border-b border-slate-100 last:border-0">
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
      const res = await fetch(`/api/ai-schedule-history?${params.toString()}`, { credentials: "include" })
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
        return TYPE_META[a.type].label.localeCompare(TYPE_META[b.type].label, "ko") * mul
      }
      return String(av).localeCompare(String(bv), "ko") * mul
    })
  }, [filteredRows, sortField, sortDir])

  if (!isAdmin) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5">
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-medium text-amber-700">
          <ShieldAlert size={18} /> 관리자만 접근할 수 있는 화면입니다.
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5">
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between md:py-4">
        <div>
          <h1 className="text-base font-bold text-slate-900 sm:text-lg">AI 스케줄 전체 이력</h1>
          <p className="mt-1 text-xs font-medium text-slate-600">
            자동 적재, 오더 수정, 담당자 변경 내역을 시간순으로 확인합니다.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          새로고침
        </button>
      </div>

      {msg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{msg}</div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="전체 이력" value={stats.total} tone="text-slate-900" />
        <StatCard title="오더 수정" value={stats.edits} tone="text-blue-700" />
        <StatCard title="담당자 변경" value={stats.reassignments} tone="text-violet-700" />
        <StatCard title="자동 적재" value={stats.ingests} tone="text-emerald-700" />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(item => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                className={cn(
                  "h-8 rounded-md border px-3 text-xs font-semibold transition-colors",
                  filter === item.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-[280px] flex-1">
              <DateRangeField
                label="조회기간"
                startDate={fromDate}
                endDate={toDate}
                onChange={(start, end) => {
                  setFromDate(start)
                  setToDate(end)
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setFromDate(daysAgoDate(30)); setToDate(todayDate()) }}
            >
              <CalendarDays />
              최근 30일
            </Button>
          </div>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="품목명, 제조번호, 변경내용 검색"
            className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white py-0 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <History className="size-4 text-slate-400" />
            <span className="text-sm font-bold text-slate-900">타임라인</span>
          </div>
          <span className="text-xs font-medium text-slate-500">표시 {filteredRows.length.toLocaleString("ko-KR")}건</span>
        </div>
        <Table className="text-sm">
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
              <TableRow>
                <TableCell colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">
                  표시할 AI 스케줄 이력이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              displayedRows.map(row => (
                <TableRow key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
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
                      primaryClass="font-semibold text-slate-900"
                      title={[row.productName, row.productCode, row.batchNo].filter(Boolean).join(" / ")}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <CellStack
                      primary={row.title}
                      secondary={row.reason ? `${row.summary} · 사유: ${row.reason}` : row.summary}
                      primaryClass="font-medium text-slate-900"
                      title={[row.title, row.summary, row.reason ? `사유: ${row.reason}` : ""].filter(Boolean).join(" / ")}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                    {row.actorName ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <TesterAvatar name={row.actorName} size="xs" />
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
    </div>
  )
}
