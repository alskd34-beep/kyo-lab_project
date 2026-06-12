"use client"

import { useEffect, useMemo, useState } from "react"
import { format, subMonths } from "date-fns"
import { ko } from "date-fns/locale"
import {
  Calendar as CalendarIcon,
  Download,
  Search,
  TriangleAlert,
} from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Calendar } from "@frontend/components/ui/calendar"
import { Input } from "@frontend/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"
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

const STATUS_CONFIG: Record<BatchStatus, { label: string; cls: string }> = {
  pending: {
    label: "대기중",
    cls: "border-slate-300 bg-slate-100 text-slate-700",
  },
  in_progress: {
    label: "진행중",
    cls: "border-violet-300 bg-violet-700 text-white",
  },
  completed: {
    label: "완료",
    cls: "border-emerald-300 bg-emerald-700 text-white",
  },
  on_hold: {
    label: "보류",
    cls: "border-amber-300 bg-amber-600 text-white",
  },
  cancelled: {
    label: "취소",
    cls: "border-rose-300 bg-rose-700 text-white",
  },
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
    return <span className="text-xs font-semibold text-slate-500">-</span>
  }
  if (dDayQc <= 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-700 px-2.5 py-0.5 text-[11px] font-bold text-white">
        {dDayQc === 0 ? "D-Day" : `D+${Math.abs(dDayQc)}`}
      </span>
    )
  }
  if (dDayQc <= 3) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-700 px-2.5 py-0.5 text-[11px] font-bold text-white">
        D-{dDayQc}
      </span>
    )
  }
  if (dDayQc <= 7) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
        D-{dDayQc}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
      D-{dDayQc}
    </span>
  )
}

export default function ProdStatusPage() {
  const [batches, setBatches] = useState<BatchSummary[]>(DEMO_BATCHES)
  const [stats, setStats] = useState<DashboardStats>(DEMO_STATS)
  const [isLoading, setIsLoading] = useState(false)
  const [usingDemo, setUsingDemo] = useState(true)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [searchValue, setSearchValue] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("전체")
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

  const kpiCards = [
    {
      label: "전체 배치",
      value: stats.totalBatches,
      accent: "border-l-blue-700",
      text: "text-blue-700",
      sub: "취소 제외 전체",
    },
    {
      label: "대기중",
      value: stats.pending,
      accent: "border-l-slate-700",
      text: "text-slate-950",
      sub: "시험 대기",
    },
    {
      label: "진행중",
      value: stats.inProgress,
      accent: "border-l-violet-700",
      text: "text-violet-700",
      sub: "시험 진행 중",
    },
    {
      label: "QC 완료",
      value: stats.completed,
      accent: "border-l-emerald-700",
      text: "text-emerald-700",
      sub: "시험 완료",
    },
    {
      label: "D-7 이내",
      value: stats.dueSoon7,
      accent: "border-l-amber-600",
      text: "text-amber-700",
      sub: "기한 임박",
    },
    {
      label: "D-3 이내",
      value: stats.dueSoon3,
      accent: "border-l-rose-700",
      text: "text-rose-700",
      sub: "위험",
    },
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
    <div className="flex min-w-0 flex-1 flex-col gap-4 bg-slate-200/70 p-3 md:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-lg border border-l-4 border-slate-300 ${card.accent} bg-white px-4 py-3 shadow-sm transition-transform hover:-translate-y-0.5`}
          >
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
              {card.label}
            </p>
            <p className={`text-3xl font-black ${card.text}`}>{card.value}</p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              {card.sub}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-300 bg-white shadow-md">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-3 py-3 md:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
            <h1 className="min-w-0 text-base font-bold text-slate-950 sm:text-lg">
              생산시험 현황
            </h1>
            <Badge className="border-blue-700 bg-blue-700 text-xs font-bold text-white shadow-sm">
              {filtered.length}건
            </Badge>
            {usingDemo && (
              <Badge className="border-amber-300 bg-amber-100 text-xs font-bold text-amber-800 shadow-sm hover:bg-amber-100">
                데모 모드
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800 transition-colors hover:bg-slate-100"
                  >
                    <CalendarIcon size={14} className="text-slate-600" />
                    <span className="tabular-nums">
                      {dateRange?.from
                        ? format(dateRange.from, "yyyy.MM.dd")
                        : "시작일"}
                    </span>
                    <span className="text-slate-400">~</span>
                    <span className="tabular-nums">
                      {dateRange?.to
                        ? format(dateRange.to, "yyyy.MM.dd")
                        : "종료일"}
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

              <div className="flex flex-wrap items-center gap-1">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      statusFilter === filter
                        ? "bg-blue-700 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row xl:ml-auto">
              <div className="relative w-full sm:w-72">
                <Search
                  size={14}
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
                />
                <Input
                  placeholder="품목명, 제조번호 검색..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="h-9 bg-slate-50 pl-9"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-emerald-300 bg-emerald-50 font-bold text-emerald-800 hover:bg-emerald-100"
              >
                <Download size={13} className="mr-1" />
                Excel
              </Button>
            </div>
          </div>
        </div>

        <div className="hidden overflow-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-950 text-xs text-white">
                <th className="sticky top-0 z-10 w-10 bg-slate-950 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={
                      selectedRows.size === filtered.length &&
                      filtered.length > 0
                    }
                    onChange={toggleAll}
                    className="cb-custom"
                  />
                </th>
                {[
                  "품목코드",
                  "품목명",
                  "규격",
                  "제조번호",
                  "제형",
                  "포장일",
                  "기록서검토기한",
                  "QC완료예정일",
                  "D-Day",
                  "상태",
                ].map((header) => (
                  <th
                    key={header}
                    className="sticky top-0 z-10 bg-slate-950 px-3 py-3 text-left font-bold"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-16 text-center font-medium text-slate-600"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-16 text-center font-medium text-slate-600"
                  >
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => {
                  const isSelected = selectedRows.has(row.id)
                  const statusCfg = STATUS_CONFIG[row.status]
                  return (
                    <tr
                      key={row.id}
                      data-state={isSelected ? "selected" : undefined}
                      onClick={() => toggleRow(row.id)}
                      className={`cursor-pointer border-t border-slate-200 transition-colors ${
                        isSelected
                          ? "bg-blue-50"
                          : idx % 2 === 1
                            ? "bg-slate-100/80 hover:bg-blue-50"
                            : "bg-white hover:bg-blue-50"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="cb-custom"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-bold text-blue-800">
                        {row.product_code}
                      </td>
                      <td className="px-3 py-2.5 text-sm font-semibold text-slate-950">
                        {row.product_name}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-800">
                        {row.spec}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800">
                        {row.batch_no}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-800">
                        {row.dosage_form}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-medium text-slate-700">
                        {row.packaging_date}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-medium text-slate-700">
                        {row.record_review_deadline}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-medium text-slate-700">
                        {row.qc_completion_deadline}
                      </td>
                      <td className="px-3 py-2.5">
                        <DDayCell dDayQc={row.dDayQc} status={row.status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusCfg.cls}`}
                        >
                          {statusCfg.label}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-2 p-3 md:hidden">
          {isLoading ? (
            <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
              불러오는 중...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
              데이터가 없습니다.
            </div>
          ) : (
            filtered.map((row) => {
              const isSelected = selectedRows.has(row.id)
              const statusCfg = STATUS_CONFIG[row.status]
              return (
                <div
                  key={row.id}
                  onClick={() => toggleRow(row.id)}
                  className={`rounded-lg border p-3 shadow-sm transition-colors ${
                    isSelected
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="cb-custom"
                        />
                        <span className="font-mono text-[11px] font-bold text-blue-800">
                          {row.batch_no}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusCfg.cls}`}
                        >
                          {statusCfg.label}
                        </span>
                        <DDayCell dDayQc={row.dDayQc} status={row.status} />
                      </div>
                      <div className="mt-1 text-sm font-bold break-words text-slate-950">
                        {row.product_name}
                      </div>
                      <div className="text-[11px] font-medium text-slate-700">
                        <span className="font-mono font-bold text-slate-800">
                          {row.product_code}
                        </span>
                        {" / "}
                        {row.spec}
                        {" / "}
                        {row.dosage_form}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-800 min-[420px]:grid-cols-2">
                    <div>
                      <span className="font-bold text-slate-600">포장일:</span>{" "}
                      <span className="font-mono">{row.packaging_date}</span>
                    </div>
                    <div>
                      <span className="font-bold text-slate-600">QC완료:</span>{" "}
                      <span className="font-mono">
                        {row.qc_completion_deadline}
                      </span>
                    </div>
                    <div className="min-[420px]:col-span-2">
                      <span className="font-bold text-slate-600">
                        기록서검토:
                      </span>{" "}
                      <span className="font-mono">
                        {row.record_review_deadline}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2.5 md:px-4">
          <p className="text-xs font-medium text-slate-600">
            {isLoading && (
              <span className="mr-2 text-slate-500">로딩 중...</span>
            )}
            총{" "}
            <span className="font-bold text-slate-950">{filtered.length}</span>
            건
            {selectedCount > 0 && (
              <span className="ml-2 font-bold text-blue-700">
                · {selectedCount}건 선택됨
              </span>
            )}
            {stats.overdueCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-rose-700">
                <TriangleAlert size={12} />
                지연 {stats.overdueCount}건
              </span>
            )}
          </p>
          <span className="text-xs font-medium text-slate-500">
            1 / 1 페이지
          </span>
        </div>
      </div>
    </div>
  )
}
