"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  RefreshCw, Search, Users, TriangleAlert, CheckCircle2, CheckCheck, ClipboardList, Clock, ListChecks,
  CalendarCheck,
} from "lucide-react"
import { stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import { JobDetailModal } from "@frontend/components/product-test/job-detail-modal"

// ─── Types (백엔드 listWorkerOverview 와 동일) ───────────────────────────────
interface OverviewJob {
  jobId: string; qcNo: string; productName: string; batchNo: string
  status: string; dueDate: string | null; isUrgent: boolean
  itemsTotal: number; itemsCleared: number
  workStartDate: string | null; workEndDate: string | null
}
interface OverviewPending {
  orderId: string; productName: string; batchNo: string
  dueDate: string | null; isUrgent: boolean
}
interface WorkerRow {
  testerId: string; name: string; employeeNo: string; isActive: boolean
  pendingCount: number; inProgress: number; reviewing: number; delayed: number
  completedTotal: number
  activeJobs: OverviewJob[]; completedJobs: OverviewJob[]; pendingOrders: OverviewPending[]
}
interface Overview {
  totals: {
    workingTesters: number; activeJobs: number; pending: number
    delayed: number; completedToday: number; completedTotal: number
  }
  workers: WorkerRow[]
}

/** 보기 모드 — 진행 중심(작업 있는 인원/전체) 과 완료 이력을 분리한다. */
type ViewMode = "working" | "all" | "completed"

/** 완료 작업 조회 기간. 서버는 시험자당 최근 50건까지 내려주고 여기서 더 좁힌다. */
const COMPLETED_RANGES = [
  { key: "today", label: "오늘",     days: 0 },
  { key: "7d",    label: "최근 7일",  days: 6 },
  { key: "30d",   label: "최근 30일", days: 29 },
  { key: "all",   label: "전체",     days: null },
] as const
type CompletedRangeKey = (typeof COMPLETED_RANGES)[number]["key"]

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** Date → 'YYYY-MM-DD' (work_end_date 가 date 컬럼이라 문자열끼리 비교한다) */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** days 일 전 날짜 문자열 (0 = 오늘) */
function daysAgo(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return ymd(d)
}

function JobStatusBadge({ status }: { status: string }) {
  const meta = stageStyle(status)
  return (
    <Badge variant="outline" className={cn("gap-1.5", meta.cls)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {status}
    </Badge>
  )
}

function dDay(due: string | null): number | null {
  if (!due) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

function DDay({ due }: { due: string | null }) {
  const dd = dDay(due)
  if (dd === null) return null
  const label = dd === 0 ? "D-Day" : dd > 0 ? `D-${dd}` : `D+${-dd}`
  const cls =
    dd <= 0 ? "border-red-200 text-red-700"
    : dd <= 3 ? "border-red-200 text-red-700"
    : dd <= 7 ? "border-amber-200 text-amber-700"
    : "text-muted-foreground"
  return (
    <Badge variant="outline" className={cn("gap-1 font-semibold tabular-nums", cls)}>
      <Clock className="size-3" />{label}
    </Badge>
  )
}

function ProgressBar({ cleared, total }: { cleared: number; total: number }) {
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0
  const done = total > 0 && cleared === total
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-md bg-muted">
        <div
          className={cn("h-full rounded-md transition-all", done ? "bg-blue-700" : "bg-blue-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
        {cleared}/{total}
      </span>
    </div>
  )
}

// ─── 페이지 ──────────────────────────────────────────────────────────────────
export default function ProdStatusPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [view, setView] = useState<ViewMode>("working")
  const [completedRange, setCompletedRange] = useState<CompletedRangeKey>("30d")
  const [detailJobId, setDetailJobId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  function openDetail(jobId: string) {
    setDetailJobId(jobId)
    setDetailOpen(true)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/qc-jobs/overview", { credentials: "include" })
      if (!res.ok) {
        if (res.status === 403) throw new Error("관리자만 볼 수 있는 화면입니다.")
        throw new Error((await res.json().catch(() => ({}))).error ?? "불러오기 실패")
      }
      setData((await res.json()) as Overview)
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 시험자별 "기간 안에 완료한 작업" — 완료 보기의 표시 대상이자 필터 기준 */
  const completedByTester = useMemo(() => {
    const days = COMPLETED_RANGES.find(r => r.key === completedRange)?.days ?? null
    const since = days === null ? null : daysAgo(days)
    const map = new Map<string, OverviewJob[]>()
    for (const w of data?.workers ?? []) {
      map.set(
        w.testerId,
        (w.completedJobs ?? []).filter(j => {
          if (since === null) return true
          // 완료일이 비어 있으면 기간을 판정할 수 없다 — '전체'에서만 보여준다.
          return j.workEndDate !== null && j.workEndDate >= since
        }),
      )
    }
    return map
  }, [data, completedRange])

  const completedShown = useMemo(
    () => [...completedByTester.values()].reduce((s, list) => s + list.length, 0),
    [completedByTester],
  )

  const workers = useMemo(() => {
    let rows = (data?.workers ?? []).filter(w => w.isActive)
    if (view === "working") rows = rows.filter(w => w.activeJobs.length > 0 || w.pendingCount > 0)
    if (view === "completed") rows = rows.filter(w => (completedByTester.get(w.testerId)?.length ?? 0) > 0)
    if (search.trim()) {
      const q = search.trim()
      rows = rows.filter(w => w.name.includes(q) || w.employeeNo.includes(q))
    }
    return rows
  }, [data, view, search, completedByTester])

  const totals = data?.totals
  /** onClick 이 있는 카드는 눌러서 완료 보기로 바로 넘어간다. */
  const kpiCards: Array<{
    label: string; value: number; valueCls: string; icon: typeof Users; onClick?: () => void
  }> = [
    { label: "작업 중 인원", value: totals?.workingTesters ?? 0, valueCls: "text-foreground", icon: Users },
    { label: "진행 중 작업", value: totals?.activeJobs ?? 0, valueCls: "text-blue-600", icon: ClipboardList },
    { label: "시작 대기", value: totals?.pending ?? 0, valueCls: "text-foreground", icon: Clock },
    { label: "지연", value: totals?.delayed ?? 0, valueCls: "text-red-600", icon: TriangleAlert },
    {
      label: "오늘 완료", value: totals?.completedToday ?? 0, valueCls: "text-blue-800", icon: CheckCircle2,
      onClick: () => { setView("completed"); setCompletedRange("today") },
    },
    {
      label: "누적 완료", value: totals?.completedTotal ?? 0, valueCls: "text-blue-800", icon: CheckCheck,
      onClick: () => { setView("completed"); setCompletedRange("all") },
    },
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* KPI */}
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <Card
              key={card.label}
              {...(card.onClick
                ? {
                    role: "button" as const,
                    tabIndex: 0,
                    onClick: card.onClick,
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.onClick?.() }
                    },
                    title: "클릭하면 완료 작업 목록으로 이동합니다",
                  }
                : {})}
              className={cn(
                "gap-0.5 px-3 py-2",
                card.onClick && "cursor-pointer transition-colors hover:border-blue-300 hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                <Icon className="size-3" />{card.label}
              </span>
              {loading
                ? <Skeleton className="h-5 w-10" />
                : <span className={cn("text-lg font-semibold tabular-nums", card.valueCls)}>{card.value}</span>}
            </Card>
          )
        })}
      </div>

      {/* 헤더 + 필터 */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">작업자 작업 현황</h1>
          <Badge variant="secondary" className="tabular-nums">{workers.length}명</Badge>
          {view === "completed" && (
            <Badge variant="outline" className="gap-1 border-blue-300 text-blue-800 tabular-nums">
              <CheckCircle2 className="size-3" />완료 {completedShown}건
            </Badge>
          )}
          <p className="w-full text-xs text-muted-foreground sm:w-auto">
            {view === "completed"
              ? "승인완료된 작업을 작업자·기간별로 확인합니다. (작업자당 최근 50건까지)"
              : "“내 작업”을 수행 중인 작업자별 진행 상황을 한눈에 봅니다."}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
            {([
              { key: "working", label: "작업 있는 인원" },
              { key: "all", label: "전체" },
              { key: "completed", label: "완료 작업" },
            ] as const).map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                className={cn("h-8 rounded-md px-3 text-sm font-medium transition-colors",
                  view === t.key ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 완료 보기에서만 기간을 고른다 */}
          {view === "completed" && (
            <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
              {COMPLETED_RANGES.map(r => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setCompletedRange(r.key)}
                  className={cn("h-8 rounded-md px-3 text-xs font-medium transition-colors",
                    completedRange === r.key ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative w-full sm:ml-auto sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="작업자명, 사번 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="w-full sm:w-auto">
            <RefreshCw className={cn(loading && "animate-spin")} />새로고침
          </Button>
        </div>
      </div>

      {error && (
        <Card className="items-center gap-1 border-amber-200 bg-amber-50 py-8 text-center">
          <TriangleAlert className="mb-1 size-6 text-amber-500" />
          <p className="text-sm font-semibold text-amber-800">{error}</p>
          {!isAdmin && <p className="text-xs text-amber-700">관리자 계정으로 로그인하세요.</p>}
        </Card>
      )}

      {/* 작업자 카드 그리드 */}
      {loading ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="gap-3 px-4 py-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-20 rounded-md" />
              </div>
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </Card>
          ))}
        </div>
      ) : !error && workers.length === 0 ? (
        <Card className="items-center py-16 text-center text-sm text-muted-foreground">
          {view === "working" ? "진행 중이거나 대기 중인 작업이 있는 작업자가 없습니다."
            : view === "completed" ? "선택한 기간에 완료된 작업이 없습니다. 기간을 넓혀 보세요."
            : "작업자가 없습니다."}
        </Card>
      ) : !error ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
          {workers.map((w) => (
            <Card key={w.testerId} className="gap-0 overflow-hidden py-0">
              {/* 카드 헤더 */}
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <TesterAvatar testerId={w.testerId} name={w.name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">{w.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{w.employeeNo}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {view === "completed" ? (
                    <>
                      <Badge variant="outline" className="gap-1 border-blue-300 text-blue-800 tabular-nums">
                        <CheckCircle2 className="size-3" />완료 {completedByTester.get(w.testerId)?.length ?? 0}
                      </Badge>
                      <Badge variant="secondary" className="tabular-nums">누적 {w.completedTotal}</Badge>
                    </>
                  ) : (
                    <>
                      {w.inProgress > 0 && <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700"><span className="size-1.5 rounded-full bg-blue-500" />진행 {w.inProgress}</Badge>}
                      {w.reviewing > 0 && <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700"><span className="size-1.5 rounded-full bg-blue-500" />검토 {w.reviewing}</Badge>}
                      {w.delayed > 0 && <Badge variant="outline" className="gap-1 border-red-200 text-red-700"><span className="size-1.5 rounded-full bg-red-500" />지연 {w.delayed}</Badge>}
                      {w.pendingCount > 0 && <Badge variant="secondary" className="tabular-nums">대기 {w.pendingCount}</Badge>}
                    </>
                  )}
                </div>
              </div>

              {/* 완료 작업 — 완료 보기에서만 */}
              {view === "completed" ? (
                <div className="flex flex-col gap-2 px-4 py-3">
                  {(completedByTester.get(w.testerId) ?? []).map((j) => (
                    <div
                      key={j.jobId}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail(j.jobId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(j.jobId) }
                      }}
                      className="cursor-pointer rounded-md border border-blue-200 bg-blue-50/40 p-2.5 transition-colors hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-blue-700">QC {j.qcNo}</span>
                          {j.isUrgent && <Badge variant="outline" className="border-red-200 px-1.5 text-[10px] text-red-700">긴급</Badge>}
                        </div>
                        <JobStatusBadge status={j.status} />
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">
                        {j.productName}
                        <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">/ {j.batchNo}</span>
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarCheck className="size-3" />
                          완료 <span className="font-mono tabular-nums">{j.workEndDate ?? "-"}</span>
                        </span>
                        {j.workStartDate && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            시작 <span className="font-mono tabular-nums">{j.workStartDate}</span>
                          </span>
                        )}
                        {j.itemsTotal > 0 && (
                          <span className="flex items-center gap-1">
                            <ListChecks className="size-3" />
                            시험항목 <span className="tabular-nums">{j.itemsCleared}/{j.itemsTotal}</span>
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
              /* 진행 중 작업 */
              <div className="flex flex-col gap-2 px-4 py-3">
                {w.activeJobs.length === 0 ? (
                  <p className="py-1 text-xs text-muted-foreground">진행 중인 작업이 없습니다.</p>
                ) : (
                  w.activeJobs.map((j) => (
                    <div
                      key={j.jobId}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail(j.jobId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(j.jobId) }
                      }}
                      className="cursor-pointer rounded-md border bg-card p-2.5 transition-colors hover:border-blue-300 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-blue-700">QC {j.qcNo}</span>
                          {j.isUrgent && <Badge variant="outline" className="border-red-200 px-1.5 text-[10px] text-red-700">긴급</Badge>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <DDay due={j.dueDate} />
                          <JobStatusBadge status={j.status} />
                        </div>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">
                        {j.productName}
                        <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">/ {j.batchNo}</span>
                      </p>
                      {j.itemsTotal > 0 && <div className="mt-2"><ProgressBar cleared={j.itemsCleared} total={j.itemsTotal} /></div>}
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ListChecks className="size-3" />
                        클릭하면 수행 중인 시험항목을 확인할 수 있습니다.
                      </p>
                    </div>
                  ))
                )}

                {/* 시작 대기 오더 */}
                {w.pendingOrders.length > 0 && (
                  <div className="mt-1 rounded-md border border-dashed bg-muted/40 p-2.5">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                      <Clock className="size-3" />시작 대기 {w.pendingCount}건
                    </p>
                    <ul className="flex flex-col gap-1">
                      {w.pendingOrders.slice(0, 4).map((o) => (
                        <li key={o.orderId} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-foreground">
                            {o.productName}
                            <span className="ml-1 font-mono text-muted-foreground">{o.batchNo}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {o.isUrgent && <span className="text-[10px] font-semibold text-red-600">긴급</span>}
                            <DDay due={o.dueDate} />
                          </span>
                        </li>
                      ))}
                      {w.pendingOrders.length > 4 && (
                        <li className="text-[11px] text-muted-foreground">외 {w.pendingOrders.length - 4}건</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              )}
            </Card>
          ))}
        </div>
      ) : null}

      <JobDetailModal
        jobId={detailJobId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isAdmin={isAdmin}
        onAdvanced={() => void load()}
      />
    </div>
  )
}
