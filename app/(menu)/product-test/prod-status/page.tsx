"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  RefreshCw, Search, Users, TriangleAlert, CheckCircle2, ClipboardList, Clock,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { JobDetailModal } from "@frontend/components/product-test/job-detail-modal"
import {
  WorkerStageLane, type OverviewJob, type WorkerRow,
} from "@frontend/components/product-test/worker-stage-lane"

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

  const openDetail = useCallback((jobId: string) => {
    setDetailJobId(jobId)
    setDetailOpen(true)
  }, [])

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

  /** 진행 중 작업들의 시험항목 소화율 — '진행 중 작업' 카드의 막대 */
  const itemProgress = useMemo(() => {
    let total = 0, cleared = 0
    for (const w of data?.workers ?? []) {
      for (const j of w.activeJobs) { total += j.itemsTotal; cleared += j.itemsCleared }
    }
    return { total, cleared, pct: total > 0 ? Math.round((cleared / total) * 100) : 0 }
  }, [data])

  const totals = data?.totals
  /** onClick 이 있는 카드는 눌러서 해당 보기로 바로 넘어간다. */
  const kpiCards: Array<{
    label: string; value: number; valueCls: string; icon: typeof Users
    foot?: React.ReactNode; onClick?: () => void; hint?: string
  }> = [
    {
      label: "작업 중 인원", value: totals?.workingTesters ?? 0, valueCls: "text-foreground", icon: Users,
      foot: <span className="text-[11px] text-muted-foreground">전체 {data?.workers.filter(w => w.isActive).length ?? 0}명 중</span>,
    },
    {
      label: "진행 중 작업", value: totals?.activeJobs ?? 0, valueCls: "text-blue-700", icon: ClipboardList,
      foot: itemProgress.total > 0 ? (
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-16 overflow-hidden rounded-md bg-muted">
            <span className="block h-full rounded-md bg-blue-500" style={{ width: `${itemProgress.pct}%` }} />
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            시험항목 {itemProgress.cleared}/{itemProgress.total}
          </span>
        </span>
      ) : undefined,
    },
    {
      label: "시작 대기", value: totals?.pending ?? 0, valueCls: "text-foreground", icon: Clock,
      foot: <span className="text-[11px] text-muted-foreground">아직 시작하지 않은 오더</span>,
    },
    {
      label: "지연 작업", value: totals?.delayed ?? 0, valueCls: (totals?.delayed ?? 0) > 0 ? "text-red-600" : "text-foreground",
      icon: TriangleAlert,
      foot: <span className="text-[11px] text-muted-foreground">완료예정일 경과</span>,
    },
    {
      label: "완료 작업", value: totals?.completedToday ?? 0, valueCls: "text-blue-800", icon: CheckCircle2,
      foot: <span className="text-[11px] text-muted-foreground">오늘 · 누적 {totals?.completedTotal ?? 0}건</span>,
      onClick: () => { setView("completed"); setCompletedRange("today") },
      hint: "클릭하면 오늘 완료한 작업 목록으로 이동합니다",
    },
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      {/* KPI */}
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
                    title: card.hint,
                  }
                : {})}
              className={cn(
                "gap-1 px-4 py-3",
                card.onClick && "cursor-pointer transition-colors hover:border-blue-300 hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" />{card.label}
              </span>
              {loading
                ? <Skeleton className="h-8 w-12" />
                : <span className={cn("text-2xl font-semibold tabular-nums", card.valueCls)}>{card.value}</span>}
              {!loading && card.foot}
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
              : "작업자마다 단계 레일을 하나씩 두고, 보유 작업을 지금 서 있는 단계 위에 세웁니다."}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
            {([
              { key: "working", label: "진행 중" },
              { key: "all", label: "전체" },
              { key: "completed", label: "완료" },
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

      {/* 작업자 레인 */}
      {loading ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4 rounded-md border bg-card p-4 shadow-sm">
              <div className="flex w-40 shrink-0 items-center gap-2">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
              <Skeleton className="h-16 flex-1 rounded-md" />
            </div>
          ))}
        </div>
      ) : !error && workers.length === 0 ? (
        <Card className="items-center py-16 text-center text-sm text-muted-foreground">
          {view === "working" ? "진행 중이거나 대기 중인 작업이 있는 작업자가 없습니다."
            : view === "completed" ? "선택한 기간에 완료된 작업이 없습니다. 기간을 넓혀 보세요."
            : "작업자가 없습니다."}
        </Card>
      ) : !error ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {workers.map((w) => (
            <WorkerStageLane
              key={w.testerId}
              worker={w}
              mode={view === "completed" ? "completed" : "active"}
              completedJobs={completedByTester.get(w.testerId) ?? []}
              onOpenJob={openDetail}
            />
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
