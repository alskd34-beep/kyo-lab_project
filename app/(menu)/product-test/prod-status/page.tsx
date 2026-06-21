"use client"

import { useEffect, useMemo, useState } from "react"
import { format, subMonths } from "date-fns"
import { ko } from "date-fns/locale"
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Download,
  Search,
  TriangleAlert,
} from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import type { DateRange } from "react-day-picker"

import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Calendar } from "@frontend/components/ui/calendar"
import { Input } from "@frontend/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import type { BatchStatus, BatchSummary, DashboardStats } from "@shared/pqm"

const DEMO_BATCHES: BatchSummary[] = [
  {
    id: 1,
    product_code: "21081",
    product_name: "(사향)광동우황청심원현탁액(신)",
    spec: "50ML",
    batch_no: "26002",
    dosage_form: "현탁제",
    packaging_date: "2026-04-10",
    record_review_deadline: "2026-04-24",
    qc_completion_deadline: "2026-04-24",
    is_urgent: false,
    status: "completed",
    dDayRecord: -13,
    dDayQc: -13,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
  {
    id: 2,
    product_code: "21350",
    product_name: "슬라임캡슐",
    spec: "120C",
    batch_no: "26001",
    dosage_form: "내용고형제",
    packaging_date: "2026-03-30",
    record_review_deadline: "2026-04-27",
    qc_completion_deadline: "2026-04-27",
    is_urgent: false,
    status: "completed",
    dDayRecord: -10,
    dDayQc: -10,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
  {
    id: 3,
    product_code: "23263",
    product_name: "베니톨정",
    spec: "500T",
    batch_no: "26023",
    dosage_form: "내용고형제",
    packaging_date: "2026-04-16",
    record_review_deadline: "2026-04-30",
    qc_completion_deadline: "2026-04-30",
    is_urgent: false,
    status: "in_progress",
    dDayRecord: -7,
    dDayQc: -7,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
  {
    id: 4,
    product_code: "23263",
    product_name: "베니톨정",
    spec: "500T",
    batch_no: "26024",
    dosage_form: "내용고형제",
    packaging_date: "2026-04-16",
    record_review_deadline: "2026-04-30",
    qc_completion_deadline: "2026-04-30",
    is_urgent: false,
    status: "pending",
    dDayRecord: -7,
    dDayQc: -7,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
  {
    id: 5,
    product_code: "21391",
    product_name: "알도셉트정5mg",
    spec: "30T",
    batch_no: "26001-A",
    dosage_form: "내용고형제",
    packaging_date: "2026-04-06",
    record_review_deadline: "2026-04-30",
    qc_completion_deadline: "2026-04-30",
    is_urgent: false,
    status: "in_progress",
    dDayRecord: -7,
    dDayQc: -7,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
  {
    id: 6,
    product_code: "21080",
    product_name: "(사향)광동우황청심원(신)",
    spec: "1환",
    batch_no: "26010",
    dosage_form: "환제",
    packaging_date: "2026-04-25",
    record_review_deadline: "2026-05-07",
    qc_completion_deadline: "2026-05-07",
    is_urgent: false,
    status: "pending",
    dDayRecord: 0,
    dDayQc: 0,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
  {
    id: 7,
    product_code: "27045",
    product_name: "(베트남수출용)광동우황청심원(영묘향)",
    spec: "1환",
    batch_no: "26011",
    dosage_form: "환제",
    packaging_date: "2026-04-28",
    record_review_deadline: "2026-05-10",
    qc_completion_deadline: "2026-05-10",
    is_urgent: false,
    status: "pending",
    dDayRecord: 3,
    dDayQc: 3,
    note: null,
    created_at: "",
    process_order: null,
    validation_type: "일반",
  },
]

const DEMO_STATS: DashboardStats = {
  totalBatches: 129,
  pending: 97,
  inProgress: 15,
  completed: 17,
  dueSoon7: 23,
  dueSoon3: 8,
  overdueCount: 5,
}

// 상태 — outline 뱃지 + 컬러 도트 (베이스 디자인)
const STATUS_META: Record<BatchStatus, { label: string; dot: string }> = {
  pending:     { label: "대기중", dot: "bg-muted-foreground" },
  in_progress: { label: "진행중", dot: "bg-violet-500" },
  completed:   { label: "완료",   dot: "bg-emerald-500" },
  on_hold:     { label: "보류",   dot: "bg-amber-500" },
  cancelled:   { label: "취소",   dot: "bg-slate-300" },
}

function StatusBadge({ status }: { status: BatchStatus }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  )
}

const STATUS_FILTERS = ["전체", "대기중", "진행중", "완료"] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const STATUS_FILTER_MAP: Record<StatusFilter, BatchStatus | null> = {
  전체: null,
  대기중: "pending",
  진행중: "in_progress",
  완료: "completed",
}

function DDayCell({
  dDayQc,
  status,
}: {
  dDayQc: number | null
  status: BatchStatus
}) {
  if (status === "completed" || status === "cancelled" || dDayQc === null) {
    return <span className="text-xs text-muted-foreground">-</span>
  }
  const cls =
    dDayQc <= 3 ? "border-red-200 text-red-700"
    : dDayQc <= 7 ? "border-amber-200 text-amber-700"
    : "text-muted-foreground"
  const label = dDayQc <= 0 ? (dDayQc === 0 ? "D-Day" : `D+${Math.abs(dDayQc)}`) : `D-${dDayQc}`
  return <Badge variant="outline" className={cn("font-semibold", cls)}>{label}</Badge>
}

type SortField =
  | "product_code"
  | "product_name"
  | "spec"
  | "batch_no"
  | "dosage_form"
  | "packaging_date"
  | "record_review_deadline"
  | "qc_completion_deadline"
  | "dDayQc"
  | "status"

type SortDir = "asc" | "desc"

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField | null; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronDown className="ml-0.5 size-3 opacity-30" />
  return sortDir === "asc"
    ? <ChevronUp className="ml-0.5 size-3 opacity-80" />
    : <ChevronDown className="ml-0.5 size-3 opacity-80" />
}

export default function ProdStatusPage() {
  const [batches, setBatches] = useState<BatchSummary[]>(DEMO_BATCHES)
  const [stats, setStats] = useState<DashboardStats>(DEMO_STATS)
  const [isLoading, setIsLoading] = useState(false)
  const [usingDemo, setUsingDemo] = useState(true)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [searchValue, setSearchValue] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("전체")
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date()
    return { from: subMonths(today, 1), to: today }
  })

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const params = new URLSearchParams()
      if (dateRange?.from)
        params.set("from", format(dateRange.from, "yyyy-MM-dd"))
      if (dateRange?.to) params.set("to", format(dateRange.to, "yyyy-MM-dd"))
      if (searchValue) params.set("search", searchValue)
      if (statusFilter !== "전체") {
        const mapped = STATUS_FILTER_MAP[statusFilter]
        if (mapped) params.set("status", mapped)
      }

      setIsLoading(true)
      try {
        const [batchRes, statsRes] = await Promise.all([
          fetch(`/api/batches?${params.toString()}`),
          fetch("/api/dashboard"),
        ])

        if (!batchRes.ok) throw new Error(await batchRes.text())
        if (!statsRes.ok) throw new Error(await statsRes.text())

        const batchData = (await batchRes.json()) as { rows: BatchSummary[] }
        const statsData = (await statsRes.json()) as DashboardStats

        if (cancelled) return

        if (batchData.rows.length > 0) {
          setBatches(batchData.rows)
          setUsingDemo(false)
        } else {
          setBatches(DEMO_BATCHES)
          setUsingDemo(true)
        }
        setStats(statsData)
      } catch {
        if (cancelled) return
        setBatches(DEMO_BATCHES)
        setStats(DEMO_STATS)
        setUsingDemo(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [dateRange, searchValue, statusFilter])

  const filtered = useMemo(() => {
    if (!usingDemo) return batches

    let rows = batches
    if (searchValue) {
      rows = rows.filter(
        (row) =>
          row.product_name.includes(searchValue) ||
          row.batch_no.includes(searchValue)
      )
    }
    if (statusFilter !== "전체") {
      const mapped = STATUS_FILTER_MAP[statusFilter]
      if (mapped) rows = rows.filter((row) => row.status === mapped)
    }
    return rows
  }, [batches, usingDemo, searchValue, statusFilter])

  const toggleSort = (field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
        return field
      }
      setSortDir("asc")
      return field
    })
  }

  const sortedData = useMemo(() => {
    if (!sortField) return filtered
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortField === "dDayQc") {
        const av = a.dDayQc ?? Infinity
        const bv = b.dDayQc ?? Infinity
        cmp = av - bv
      } else {
        const av = String(a[sortField] ?? "")
        const bv = String(b[sortField] ?? "")
        cmp = av.localeCompare(bv, "ko")
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [filtered, sortField, sortDir])

  const kpiCards = [
    { label: "전체 배치", value: stats.totalBatches, valueCls: "text-foreground", sub: "취소 제외 전체" },
    { label: "대기중", value: stats.pending, valueCls: "text-foreground", sub: "시험 대기" },
    { label: "진행중", value: stats.inProgress, valueCls: "text-violet-600", sub: "시험 진행 중" },
    { label: "QC 완료", value: stats.completed, valueCls: "text-emerald-600", sub: "시험 완료" },
    { label: "D-7 이내", value: stats.dueSoon7, valueCls: "text-amber-600", sub: "기한 임박" },
    { label: "D-3 이내", value: stats.dueSoon3, valueCls: "text-red-600", sub: "위험" },
  ]

  const selectedCount = selectedRows.size

  const toggleRow = (id: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedRows(
      selectedRows.size === filtered.length
        ? new Set()
        : new Set(filtered.map((row) => row.id))
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((card) => (
          <Card key={card.label} className="gap-1 px-4 py-4">
            <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
            <span className={cn("text-2xl font-semibold tabular-nums", card.valueCls)}>{card.value}</span>
            <span className="text-[11px] text-muted-foreground">{card.sub}</span>
          </Card>
        ))}
      </div>

      {/* 헤더 + 필터 */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">생산시험 현황</h1>
          <Badge variant="secondary" className="tabular-nums">{filtered.length}건</Badge>
          {usingDemo && (
            <Badge variant="outline" className="border-amber-200 text-amber-700">데모 모드</Badge>
          )}
        </div>

        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <CalendarIcon className="size-3.5 text-muted-foreground" />
                  <span className="tabular-nums">
                    {dateRange?.from ? format(dateRange.from, "yyyy.MM.dd") : "시작일"}
                  </span>
                  <span className="text-muted-foreground">~</span>
                  <span className="tabular-nums">
                    {dateRange?.to ? format(dateRange.to, "yyyy.MM.dd") : "종료일"}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  locale={ko}
                  defaultMonth={dateRange?.from}
                />
              </PopoverContent>
            </Popover>

            {/* 상태 필터 — 세그먼트 */}
            <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  className={cn(
                    "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                    statusFilter === filter ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:ml-auto">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="품목명, 제조번호 검색..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              <Download />Excel
            </Button>
          </div>
        </div>
      </div>

      {/* 테이블 (데스크톱) */}
      <Card className="hidden gap-0 overflow-hidden py-0 md:block">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 px-4">
                <input
                  type="checkbox"
                  checked={selectedRows.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                  className="cb-custom"
                />
              </TableHead>
              {(
                [
                  { label: "품목코드", field: "product_code" },
                  { label: "품목명", field: "product_name" },
                  { label: "규격", field: "spec" },
                  { label: "제조번호", field: "batch_no" },
                  { label: "제형", field: "dosage_form" },
                  { label: "포장일", field: "packaging_date" },
                  { label: "기록서검토기한", field: "record_review_deadline" },
                  { label: "QC완료예정일", field: "qc_completion_deadline" },
                  { label: "D-Day", field: "dDayQc" },
                  { label: "상태", field: "status" },
                ] as { label: string; field: SortField }[]
              ).map(({ label, field }) => (
                <TableHead
                  key={field}
                  className="cursor-pointer select-none px-3 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleSort(field)}
                >
                  <span className="inline-flex items-center">
                    {label}
                    <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-4 py-2.5"><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-14" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                  <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={11} className="py-16 text-center text-sm text-muted-foreground">데이터가 없습니다.</TableCell>
              </TableRow>
            ) : (
              sortedData.map((row) => {
                const isSelected = selectedRows.has(row.id)
                return (
                  <TableRow
                    key={row.id}
                    onClick={() => toggleRow(row.id)}
                    className={cn("cursor-pointer", isSelected && "bg-primary/5")}
                  >
                    <TableCell className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(row.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="cb-custom"
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.product_code}</TableCell>
                    <TableCell className="px-3 py-2.5 font-medium text-foreground">{row.product_name}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.spec}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.batch_no}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.dosage_form}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.packaging_date}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.record_review_deadline}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.qc_completion_deadline}</TableCell>
                    <TableCell className="px-3 py-2.5"><DDayCell dDayQc={row.dDayQc} status={row.status} /></TableCell>
                    <TableCell className="px-3 py-2.5"><StatusBadge status={row.status} /></TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2 md:hidden">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-2 px-3 py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <Card className="items-center py-6 text-center text-sm text-muted-foreground">데이터가 없습니다.</Card>
        ) : (
          filtered.map((row) => {
            const isSelected = selectedRows.has(row.id)
            return (
              <Card
                key={row.id}
                onClick={() => toggleRow(row.id)}
                className={cn("gap-0 px-3 py-3", isSelected && "border-primary/40 ring-1 ring-primary/20")}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRow(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="cb-custom"
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">{row.batch_no}</span>
                  <StatusBadge status={row.status} />
                  <DDayCell dDayQc={row.dDayQc} status={row.status} />
                </div>
                <div className="mt-1.5 text-sm font-semibold break-words text-foreground">{row.product_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-mono">{row.product_code}</span>
                  {" / "}{row.spec}{" / "}{row.dosage_form}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground min-[420px]:grid-cols-2">
                  <div><span className="font-medium text-foreground">포장일:</span> <span className="font-mono">{row.packaging_date}</span></div>
                  <div><span className="font-medium text-foreground">QC완료:</span> <span className="font-mono">{row.qc_completion_deadline}</span></div>
                  <div className="min-[420px]:col-span-2"><span className="font-medium text-foreground">기록서검토:</span> <span className="font-mono">{row.record_review_deadline}</span></div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* 푸터 요약 */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {isLoading && <Skeleton className="mr-2 inline-block h-3 w-12" />}
          총 <span className="font-semibold text-foreground tabular-nums">{filtered.length}</span>건
          {selectedCount > 0 && <span className="ml-2 font-medium text-primary">· {selectedCount}건 선택됨</span>}
          {stats.overdueCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-red-700">
              <TriangleAlert className="size-3" />지연 {stats.overdueCount}건
            </span>
          )}
        </p>
        <span>1 / 1 페이지</span>
      </div>
    </div>
  )
}
