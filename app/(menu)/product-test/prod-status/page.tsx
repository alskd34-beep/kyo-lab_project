"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  RefreshCw, Search, Users, TriangleAlert, CheckCircle2, ClipboardList, ChartColumn,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { MobileFilterPanel } from "@frontend/components/common/mobile-filter-panel"
import { JobDetailModal } from "@frontend/components/product-test/job-detail-modal"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import { PARALLEL_BADGE_LABEL } from "@shared/assignment"
import {
  WorkerStageLane, type OverviewJob, type WorkerRow,
} from "@frontend/components/product-test/worker-stage-lane"

interface Overview {
  totals: {
    workingTesters: number; activeJobs: number; pending: number
    delayed: number; completedToday: number; completedTotal: number
  }
  workers: WorkerRow[]
  /** 'admin' = 전체 시험자, 'tester' = 본인 + 병렬 배정 동료(공유 오더 한정) */
  scope?: "admin" | "tester"
}

/** 보기 모드 — 진행 중심(작업 있는 인원/전체) 과 완료 이력을 분리한다. */
type ViewMode = "working" | "all" | "completed"

/** 보기 탭. 모바일 접힘 막대의 요약 문구가 같은 라벨을 써야 해서 밖으로 뺀다. */
const VIEW_TABS: { key: ViewMode; label: string }[] = [
  { key: "working", label: "진행 중" },
  { key: "all", label: "전체" },
  { key: "completed", label: "완료" },
]

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
  const [selectedTesterId, setSelectedTesterId] = useState<string | null>(null)
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
        // 시험자도 본인 현황을 보므로 더 이상 "관리자 전용"이 아니다.
        // 서버가 돌려준 사유(시험자 미연결 등)를 그대로 보여준다.
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
    // 본인 행은 어떤 필터에서도 빼지 않는다. 시험자 화면의 목적이 "내 현황"이라,
    // 오늘 할 일이 없다는 이유로 내가 목록에서 사라지면 화면이 고장난 것처럼 보인다.
    let rows = (data?.workers ?? []).filter(w => w.isActive || w.isSelf)
    if (view === "working") rows = rows.filter(w => w.isSelf || (w.activeJobs?.length ?? 0) > 0 || w.pendingCount > 0)
    if (view === "completed") rows = rows.filter(w => w.isSelf || (completedByTester.get(w.testerId)?.length ?? 0) > 0)
    if (search.trim()) {
      const q = search.trim()
      rows = rows.filter(w => w.name.includes(q) || w.employeeNo.includes(q))
    }
    return rows
  }, [data, view, search, completedByTester])

  useEffect(() => {
    if (workers.length === 0) {
      setSelectedTesterId(null)
      return
    }
    if (!selectedTesterId || !workers.some(w => w.testerId === selectedTesterId)) {
      setSelectedTesterId(workers[0].testerId)
    }
  }, [workers, selectedTesterId])

  const selectedWorker = workers.find(w => w.testerId === selectedTesterId) ?? workers[0]

  /** 시험자 시점 — 본인과 병렬 배정 동료만 담긴 응답이다 */
  const isTesterScope = data?.scope === "tester"
  const coAssigneeCount = (data?.workers ?? []).filter(w => w.isCoAssignee).length
  /** 시험자 시점의 지표는 **본인 숫자**여야 한다. 동료의 공유 작업까지 합치면
      "내 진행은 1건인데 지표는 2건" 이 되어 화면이 자기 얘기를 하지 않는다. */
  const selfRow = (data?.workers ?? []).find(w => w.isSelf) ?? null
  const selfCompletedToday =
    (selfRow?.completedJobs ?? []).filter(j => j.workEndDate === daysAgo(0)).length

  /** 진행 중 작업들의 시험항목 소화율 — '진행 중 작업' 카드의 막대 */
  const itemProgress = useMemo(() => {
    // 시험자 시점에서는 본인 작업만 센다(지표는 본인 얘기여야 한다).
    const rows = isTesterScope ? (selfRow ? [selfRow] : []) : (data?.workers ?? [])
    let total = 0, cleared = 0
    for (const w of rows) {
      for (const j of w.activeJobs ?? []) { total += j.itemsTotal; cleared += j.itemsCleared }
    }
    return { total, cleared, pct: total > 0 ? Math.round((cleared / total) * 100) : 0 }
  }, [data, isTesterScope, selfRow])

  const totals = data?.totals

  /** 조회 옵션 막대에 남길 한 줄 — 어떤 보기로 몇 명을 보고 있는지 */
  const filterSummary = [
    VIEW_TABS.find(t => t.key === view)?.label ?? "",
    isTesterScope ? (coAssigneeCount > 0 ? `나 + 동료 ${coAssigneeCount}명` : "내 작업") : `작업자 ${workers.length}명`,
    view === "completed" ? `완료 ${completedShown}건` : null,
    search.trim() ? `"${search.trim()}"` : null,
  ].filter(Boolean).join(" · ")

  /** 지표 요약 막대 — 네 칸 중 먼저 봐야 할 값 셋만 남긴다 */
  const kpiSummary = isTesterScope
    ? `내 진행 ${selfRow?.activeJobs.length ?? 0}건 · 대기 ${selfRow?.pendingCount ?? 0}건 · 지연 ${selfRow?.delayed ?? 0}건`
    : `작업 중 ${totals?.workingTesters ?? 0}명 · 진행 ${totals?.activeJobs ?? 0}건 · 지연 ${totals?.delayed ?? 0}건`

  /** onClick 이 있는 카드는 눌러서 해당 보기로 바로 넘어간다. */
  const kpiCards: Array<{
    label: string; value: number; valueCls: string; icon: typeof Users
    foot?: React.ReactNode; onClick?: () => void; hint?: string
  }> = [
    {
      label: isTesterScope ? "함께 작업" : "작업 중 인원",
      value: isTesterScope ? coAssigneeCount : (totals?.workingTesters ?? 0),
      valueCls: "text-foreground", icon: Users,
      foot: (
        <span className="text-xs leading-normal break-keep tabular-nums text-muted-foreground">
          {isTesterScope
            ? "병렬 배정 동료"
            : `전체 ${data?.workers.filter(w => w.isActive).length ?? 0}명 중`}
        </span>
      ),
    },
    {
      label: isTesterScope ? "내 진행 작업" : "진행 중 작업",
      value: isTesterScope ? (selfRow?.activeJobs.length ?? 0) : (totals?.activeJobs ?? 0),
      valueCls: "text-blue-700 dark:text-blue-300", icon: ClipboardList,
      foot: itemProgress.total > 0 ? (
        /* 좁은 칸에서 막대와 글자가 한 줄에 안 들어가면 아랫줄로 접힌다 */
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
            <span className="block h-full rounded-md bg-blue-500" style={{ width: `${itemProgress.pct}%` }} />
          </span>
          <span className="text-xs leading-normal break-keep tabular-nums text-muted-foreground">
            시험항목 {itemProgress.cleared}/{itemProgress.total}
          </span>
        </span>
      ) : undefined,
    },
    {
      label: isTesterScope ? "내 지연 작업" : "지연 작업",
      value: isTesterScope ? (selfRow?.delayed ?? 0) : (totals?.delayed ?? 0),
      valueCls: (isTesterScope ? (selfRow?.delayed ?? 0) : (totals?.delayed ?? 0)) > 0 ? "text-destructive" : "text-foreground",
      icon: TriangleAlert,
      foot: <span className="text-xs leading-normal break-keep text-muted-foreground">완료예정일 경과</span>,
    },
    {
      label: isTesterScope ? "내 완료 작업" : "완료 작업",
      value: isTesterScope ? selfCompletedToday : (totals?.completedToday ?? 0),
      valueCls: "text-blue-800 dark:text-blue-200", icon: CheckCircle2,
      foot: (
        <span className="text-xs leading-normal break-keep tabular-nums text-muted-foreground">
          오늘 · 누적 {(isTesterScope ? selfRow?.completedTotal : totals?.completedTotal) ?? 0}건
        </span>
      ),
      onClick: () => { setView("completed"); setCompletedRange("today") },
      hint: "클릭하면 오늘 완료한 작업 목록으로 이동합니다",
    },
  ]

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 md:p-6">
      {/* 머리말 — 지표 아래에 있던 화면 제목을 맨 위로 올렸다. 무엇을 보는 화면인지가
          숫자보다 먼저 읽혀야 한다. 제목 옆 배지(인원수·완료건수)는 잔글씨 한 줄로 합쳤다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-foreground">
          {isTesterScope ? "내 작업 현황" : "작업자 작업 현황"}
        </h1>
        {/* 부제 — 모바일에서는 접는다. 건수는 아래 조회 옵션 막대가 한 줄로 이미 말하고,
            "작업자를 고르면 …" 안내문은 375px 에서 두 줄을 먹으며 목록을 밀어냈다. */}
        <p className="hidden text-xs leading-normal break-keep text-muted-foreground sm:block">
          {isTesterScope
            ? <>병렬 배정 동료 <span className="font-semibold tabular-nums text-foreground">{coAssigneeCount}</span>명</>
            : <>작업자 <span className="font-semibold tabular-nums text-foreground">{workers.length}</span>명</>}
          {view === "completed" && (
            <>
              <span className="px-1 text-border">·</span>
              완료 <span className="font-semibold tabular-nums text-foreground">{completedShown}</span>건
            </>
          )}
          <span className="px-1 text-border">·</span>
          {isTesterScope
            ? (coAssigneeCount > 0
                ? "본인 현황과, 병렬 배정으로 함께 맡은 동료의 해당 작업만 표시됩니다"
                : "본인 현황입니다. 병렬 배정 작업이 생기면 동료 현황도 함께 표시됩니다")
            : view === "completed"
              ? "승인완료된 작업을 작업자·기간별로 봅니다 (작업자당 최근 50건까지)"
              : "작업자를 고르면 보유 작업이 지금 서 있는 단계 위에 표시됩니다"}
        </p>
      </header>

      {/* KPI — 2x2 격자가 모바일에서 240px 을 먹어 작업자 띠를 화면 밖(y≈510)으로 밀어냈다.
          지표는 조회 옵션과 별개로 한 번 더 접고, 펼쳤을 때도 타일을 한 줄로 눕힌다. */}
      <MobileFilterPanel icon={ChartColumn} label="요약" summary={kpiSummary}>
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
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
                /* 모바일은 라벨·숫자를 한 줄로 눕혀 타일 높이를 절반으로 줄인다.
                   sm:justify-start — 격자는 칸 높이를 서로 맞추므로(stretch) justify-between 을
                   남겨 두면 짧은 칸에서 숫자가 바닥에 붙어 원래 모양과 달라진다. */
                "min-h-8 min-w-0 flex-row items-center justify-between gap-1 px-2 py-1",
                "sm:flex-col sm:items-stretch sm:justify-start sm:gap-1 sm:px-4 sm:py-3",
                card.onClick && "cursor-pointer transition-colors hover:border-blue-300 dark:hover:border-blue-700 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {/* 눕힌 한 줄에서 아이콘 20px 를 빼야 '작업 중 인원' 라벨이 잘리지 않는다 */}
                <Icon className="hidden size-3.5 shrink-0 sm:block" />
                <span className="min-w-0 truncate">{card.label}</span>
              </span>
              {loading
                ? <Skeleton className="h-4 w-10 shrink-0 sm:h-8 sm:w-12" />
                : <span className={cn("min-w-0 shrink-0 truncate text-sm font-semibold tabular-nums sm:text-2xl", card.valueCls)}>{card.value}</span>}
              {/* 한 줄로 눕힌 모바일에는 셋째 조각이 들어갈 자리가 없다 — 요약 막대가 대신 말한다 */}
              {!loading && card.foot && <span className="hidden min-w-0 sm:block">{card.foot}</span>}
            </Card>
          )
        })}
      </div>
      </MobileFilterPanel>

      {/* 조회 옵션 — 탭 · 검색 · 새로고침이 모바일에서 세 줄로 쌓였다. 통째로 접고
          지금 무엇을 보고 있는지만 한 줄 남긴다. sm 이상에서는 접기 자체가 없다. */}
      <MobileFilterPanel summary={filterSummary}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* 탭 묶음이 화면보다 넓어지면 페이지가 아니라 이 상자 안에서만 밀린다 */}
          <div className="inline-flex h-9 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5 text-muted-foreground">
            {VIEW_TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                className={cn("h-8 shrink-0 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  view === t.key ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 완료 보기에서만 기간을 고른다 */}
          {view === "completed" && (
            <div className="inline-flex h-9 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5 text-muted-foreground">
              {COMPLETED_RANGES.map(r => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setCompletedRange(r.key)}
                  className={cn("h-8 shrink-0 rounded-md px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    completedRange === r.key ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {/* 시험자 시점에는 본인과 동료 몇 명뿐이라 검색이 자리만 차지한다 */}
          {!isTesterScope && (
            <div className="relative w-full sm:ml-auto sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="작업자명, 사번 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
          )}
          <Button variant="outline" onClick={() => void load()} disabled={loading} className={cn("w-full sm:w-auto", isTesterScope && "sm:ml-auto")}>
            <RefreshCw className={cn(loading && "animate-spin")} />새로고침
          </Button>
        </div>
      </MobileFilterPanel>

      {error && (
        <Card className="shrink-0 items-center gap-1 border-amber-200 bg-amber-50 py-8 text-center dark:border-amber-800 dark:bg-amber-950">
          <TriangleAlert className="mb-1 size-6 text-amber-500" />
          <p className="text-sm font-semibold break-keep text-amber-800 dark:text-amber-200">{error}</p>
        </Card>
      )}

      {/* 작업자 레인 */}
      {loading ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex min-w-0 gap-4 rounded-md border bg-card p-4 shadow-sm">
              <div className="flex w-28 shrink-0 items-center gap-2 sm:w-40">
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
        <p className="py-16 text-center text-sm break-keep text-muted-foreground">
          {isTesterScope
            ? "표시할 작업이 없습니다. 배정된 작업이 생기면 여기에 나타납니다."
            : view === "working"
              ? "진행 중이거나 대기 중인 작업이 있는 작업자가 없습니다."
              : view === "completed"
                ? "선택한 기간에 완료된 작업이 없습니다. 기간을 넓혀 보세요."
                : "작업자가 없습니다."}
        </p>
      ) : !error ? (
        /* 모바일은 위아래 2행(작업자 띠 + 레일). 레일 행에 minmax(0,1fr) 을 줘야
           남은 높이를 정확히 차지하고 자기 안에서 스크롤된다. */
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden md:grid-cols-[190px_minmax(0,1fr)] md:grid-rows-1">
          {/* 작업자 고르는 칸. 모바일에서는 세로 목록이 화면을 다 먹으므로
              가로로 눕혀 칩처럼 훑고, md 이상에서만 왼쪽 세로 목록이 된다. */}
          <div className="min-h-0 min-w-0 shrink-0 overflow-x-auto overflow-y-hidden rounded-md border bg-card p-2 md:shrink md:overflow-x-hidden md:overflow-y-auto">
            <div className="flex gap-1.5 md:flex-col">
              {workers.map((w) => (
                <button
                  key={w.testerId}
                  type="button"
                  onClick={() => setSelectedTesterId(w.testerId)}
                  aria-pressed={selectedWorker?.testerId === w.testerId}
                  className={cn(
                    /* transition-all → 실제로 바뀌는 색만 애니메이션한다 */
                    "flex min-w-0 shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:w-full md:shrink",
                    selectedWorker?.testerId === w.testerId
                      ? "border-blue-300 bg-blue-50 text-foreground dark:border-blue-700 dark:bg-blue-950"
                      : "border-transparent text-foreground hover:bg-muted/60",
                  )}
                >
                  <TesterAvatar testerId={w.testerId} name={w.name} size="md" />
                  {/* 이름과 사번을 같은 크기로 붙여 놓으면 위계가 없다 — 이름을 주 값으로 올린다 */}
                  <div className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{w.name}</span>
                      {/* 동료 행은 "함께 맡은 오더만" 담고 있다 — 전체 업무로 오해하지 않게 이름 옆에 밝힌다 */}
                      {w.isSelf && (
                        <span className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-1 text-xs leading-normal font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">나</span>
                      )}
                      {w.isCoAssignee && (
                        <span className="shrink-0 rounded-md border px-1 text-xs leading-normal font-medium text-muted-foreground">{PARALLEL_BADGE_LABEL}</span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-xs leading-normal tabular-nums text-muted-foreground">
                      {w.employeeNo}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {/* WorkerStageLane 이 모바일에서 스스로 세로 단계 목록으로 접히므로
              최소 폭을 강제하던 임시 방편은 걷어냈다. overflow-x-auto 는 md 근처에서
              레일이 빠듯할 때를 대비해 남겨 둔다(밀려도 이 상자 안에서만). */}
          <div className="min-h-0 min-w-0 overflow-x-auto overflow-y-auto">
            {/* 동료 행을 열었을 때 이 목록이 동료의 전부가 아님을 밝힌다.
                밝히지 않으면 "저 사람 일이 이것뿐인가" 로 읽힌다. */}
            {selectedWorker?.isCoAssignee && (
              <p className="mb-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs leading-normal break-keep text-muted-foreground">
                병렬 배정으로 <span className="font-medium text-foreground">함께 맡은 작업</span>만 표시됩니다. {selectedWorker.name} 님의 다른 업무는 포함되지 않습니다.
              </p>
            )}
            {selectedWorker && (
              <WorkerStageLane
                worker={selectedWorker}
                mode={view === "completed" ? "completed" : "active"}
                completedJobs={completedByTester.get(selectedWorker.testerId) ?? []}
                onOpenJob={openDetail}
                showWorker={false}
              />
            )}
          </div>
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
