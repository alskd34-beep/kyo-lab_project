"use client"

/**
 * 시험자 운영 분석 — 성과(계획 준수)와 시간 배분(시험 vs 부업무)을 한 화면에서 읽는다.
 *
 * 예전에는 「운영평가」와 「운영 결과 리포트」 두 화면이었다. 합친 이유는 셋이다.
 *   1. 정작 알고 싶은 질문이 두 화면에 걸쳐 있었다 — "이 사람 공수 준수율이 왜 낮지?"
 *      의 답이 "부업무를 40% 하고 있었다"인데, 그 둘이 다른 화면에 있으면 관리자가
 *      숫자를 머리에 들고 화면을 오가야 한다. 한 행에 있으면 한 줄로 읽힌다.
 *   2. **가동률이 두 화면에서 같은 이름, 다른 뜻이었다.** 한쪽은 배정 공수(계획 DAY)
 *      기준, 다른 쪽은 기록 시간(실측 분) 기준이다. 나란히 놓이지 않으면 지금 보고 있는
 *      것이 계획인지 실적인지 알 방법이 없다. 여기서는 '계획'·'실적'으로 이름을 갈랐다.
 *   3. 시험항목별 소요가 양쪽에 있었다(한쪽은 평균만, 한쪽은 건수·총소요·평균).
 *      상위집합인 뒤쪽만 남긴다.
 *
 * 데이터는 두 곳에서 병렬로 받아 시험자 기준으로 합친다. 한쪽이 실패해도 나머지는
 * 그대로 보여준다 — 부업무 스키마(0041)가 아직 없는 환경에서도 성과 지표는 읽혀야 한다.
 *   GET /api/insights/tester-evaluation?from&to   (성과)
 *   GET /api/insights/operation-report?from&to    (시간 배분)
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend,
} from "recharts"
import {
  AlertCircle, CalendarDays, CheckCircle2, ChartColumn, Clock, FlaskConical,
  Layers, Loader2, Percent, RefreshCw, Wrench,
} from "lucide-react"
import type { OperationReport } from "@shared/side-work"
import { cn } from "@frontend/lib/utils"
import { formatMinutes, minutesToHours } from "@frontend/lib/workload-format"
import { Button } from "@frontend/components/ui/button"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import {
  SortColumnHeader, sortCol, type SortColumnDef, type SortDir,
} from "@frontend/components/ui/table-sort"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@frontend/components/ui/table"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { TesterAvatar } from "@frontend/lib/tester-profiles"

// ─── 서버 응답(성과) ──────────────────────────────────────────────────────────
interface EvalTesterRow {
  testerId: string; name: string; completed: number
  adherenceRate: number | null; avgActualDays: number | null
  weightedThroughput: number; utilization: number | null
}
interface EvalData {
  period: { from: string; to: string; workingDays: number }
  totals: { completedJobs: number; adherenceRate: number | null; avgActualDays: number | null }
  byTester: EvalTesterRow[]
}

/** 두 집계를 시험자 기준으로 합친 한 행. 없는 쪽은 null·0 으로 남는다 */
interface MergedRow {
  testerId: string
  name: string
  // 성과 (완료 작업 기준)
  completed: number
  adherenceRate: number | null
  avgActualDays: number | null
  weightedThroughput: number
  /** 계획 가동률 — 배정 공수(DAY) 합 ÷ 기간 근무일 */
  utilization: number | null
  // 시간 배분 (실측 분 기준)
  testItems: number
  testMinutes: number
  sideMinutes: number
  sideCount: number
  sideRatio: number | null
  /** 실적 가동률 — (시험+부업무) 기록 시간 ÷ 기간 근무시간 */
  coverage: number | null
}

// ─── 색 ───────────────────────────────────────────────────────────────────────
// 시험업무는 브랜드 파랑(이 시스템의 본업), 부업무는 청록(본업이 아닌 것).
const TEST_HEX = "#2563eb" // blue-600
const SIDE_HEX = "#0d9488" // teal-600

// 준수율 색상 (90↑ 브랜드 파랑 / 70↑ 황색 / 그 외 적색 / 값 없음 회색)
// '양호'를 초록으로 두면 브랜드색 밖으로 나가면서 '완료'와도 뜻이 겹친다 — 정상은 파랑이다.
const rateColor = (r: number | null) =>
  r == null ? "#cbd5e1" : r >= 90 ? "#2563eb" : r >= 70 ? "#f59e0b" : "#ef4444"
/*
 * 같은 색을 글자에 그대로 쓰면 앰버가 흰 배경에서 2.1:1, 빨강이 3.8:1 로
 * 본문 기준(4.5:1)에 못 미친다. 막대(그래픽 3:1)와 글자(4.5:1)는 요구가 다르므로
 * 글자용은 한 단 어둡게 따로 둔다. 뜻(색상)은 같다.
 */
const rateTextClass = (r: number | null) =>
  r == null ? "text-muted-foreground"
  : r >= 90 ? "text-blue-700 dark:text-blue-300"
  : r >= 70 ? "text-amber-700 dark:text-amber-400"
  : "text-red-700 dark:text-red-400"

/** 부업무 비중은 높을수록 눈에 걸려야 한다 — 40% 넘으면 배정을 다시 봐야 한다는 뜻이다 */
const ratioTextClass = (r: number | null) =>
  r == null ? "text-muted-foreground"
  : r >= 40 ? "text-red-700 dark:text-red-400"
  : r >= 25 ? "text-amber-700 dark:text-amber-400"
  : "text-foreground"

const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`)
/** 분 → "1시간 20분". 동시분석 절감처럼 시간·분이 섞이는 값에 쓴다 */
const fmtMin = (v: number) => formatMinutes(v, "0분")
const fmtDay = (v: number | null) => (v == null ? "—" : `${v}일`)

// ─── 정렬 ─────────────────────────────────────────────────────────────────────
type SortField =
  | "name" | "completed" | "adherenceRate" | "avgActualDays"
  | "testMinutes" | "testItems" | "sideMinutes" | "sideCount"
  | "sideRatio" | "coverage" | "utilization"

/**
 * 표 컬럼. 필드 2개짜리는 좁으면 한 칸에 쌓이고 넓으면 각자 컬럼으로 갈린다
 * (docs/table-adaptive-columns.md). 그 칸의 본문은 반드시 `CellStack` 이어야 한다.
 */
const SORT_COLUMNS: { col: SortColumnDef<SortField>; numeric: boolean }[] = [
  { col: sortCol<SortField>("name", "시험자"), numeric: false },
  { col: sortCol<SortField>("completed", "완료건"), numeric: true },
  { col: sortCol<SortField>("adherenceRate", "공수 준수율"), numeric: true },
  { col: sortCol<SortField>("avgActualDays", "평균 소요일"), numeric: true },
  {
    col: {
      key: "test", label: "시험업무",
      fields: [{ id: "testMinutes", label: "시험업무" }, { id: "testItems", label: "항목수" }],
    },
    numeric: true,
  },
  {
    col: {
      key: "side", label: "부업무",
      fields: [{ id: "sideMinutes", label: "부업무" }, { id: "sideCount", label: "건수" }],
    },
    numeric: true,
  },
  { col: sortCol<SortField>("sideRatio", "부업무 비중"), numeric: true },
  {
    col: {
      key: "util", label: "가동률",
      fields: [{ id: "coverage", label: "실적 가동률" }, { id: "utilization", label: "계획 가동률" }],
    },
    numeric: true,
  },
]

type TabKey = "perf" | "time"

const TABS: { key: TabKey; label: string; icon: typeof ChartColumn; hint: string }[] = [
  { key: "perf", label: "성과", icon: CheckCircle2, hint: "완료 작업 기준 — 계획을 지켰는가" },
  { key: "time", label: "시간 배분", icon: Clock, hint: "실측 기준 — 시간이 어디로 갔는가" },
]

export default function OperationAnalysisPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [evalData, setEvalData] = useState<EvalData | null>(null)
  const [report, setReport] = useState<OperationReport | null>(null)
  const [loading, setLoading] = useState(true)
  /** 두 집계는 따로 실패할 수 있다 — 한쪽이 죽어도 나머지는 보여준다 */
  const [perfError, setPerfError] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  /**
   * 사용자가 직접 고르기 전에는 null 로 두고, 데이터가 있는 쪽을 연다.
   * 완료 작업이 0건인 기간(지금 운영 DB 가 그렇다)에 '성과' 탭을 기본으로 열면
   * 표에는 실적이 가득한데 탭만 "완료된 작업이 없습니다"가 떠서 화면이 고장 난 것처럼 읽힌다.
   * effect 로 되돌리지 않고 렌더에서 파생시킨다 — 마운트 직후 한 번 더 그리지 않는다.
   */
  const [tabPick, setTabPick] = useState<TabKey | null>(null)
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  /* 기본 조회기간(최근 90일)은 **마운트 후에** 정한다.
     이 페이지는 정적 프리렌더 대상이라(build 출력의 ○), useState 초기화로 계산하면
     빌드 시각의 날짜가 HTML 에 박혀 그 다음 날부터 하이드레이션이 어긋난다.
     "여는 시각 기준"이어야 하므로 클라이언트에서만 정할 수 있다. */
  useEffect(() => {
    const t = new Date()
    const f = new Date()
    f.setDate(f.getDate() - 90)
    /* eslint-disable react-hooks/set-state-in-effect -- 클라이언트에서만 정할 수 있는 초기값 */
    setTo(t.toISOString().slice(0, 10))
    setFrom(f.toISOString().slice(0, 10))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    setPerfError(null)
    setTimeError(null)

    const get = async (url: string) => {
      const r = await fetch(url, { credentials: "include" })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error ?? "조회에 실패했습니다.")
      return json
    }

    // allSettled — 부업무 스키마가 없는 환경에서도 성과 지표는 읽혀야 한다.
    const [perf, time] = await Promise.allSettled([
      get(`/api/insights/tester-evaluation?from=${from}&to=${to}`),
      get(`/api/insights/operation-report?from=${from}&to=${to}`),
    ])

    if (perf.status === "fulfilled") setEvalData(perf.value as EvalData)
    else { setEvalData(null); setPerfError(perf.reason instanceof Error ? perf.reason.message : "성과 집계 조회 실패") }

    if (time.status === "fulfilled") setReport(time.value as OperationReport)
    else { setReport(null); setTimeError(time.reason instanceof Error ? time.reason.message : "시간 배분 집계 조회 실패") }

    setLoading(false)
  }, [from, to])

  /* 기간이 바뀌면 다시 읽는다. load 가 시작하자마자 로딩 플래그를 세우는 것은 의도된
     동기 setState 다 — 그래야 새로고침을 누른 즉시 스켈레톤이 뜬다. */
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 데이터 페치 시작: 로딩/에러 상태 초기화
  useEffect(() => { void load() }, [load])

  // ── 기간 · 합계 ────────────────────────────────────────────────────────────
  const period = evalData?.period ?? report?.period ?? null
  const evalTotals = evalData?.totals
  const timeTotals = report?.totals

  // ── 시험자 기준 병합 ───────────────────────────────────────────────────────
  const merged = useMemo<MergedRow[]>(() => {
    const byId = new Map<string, MergedRow>()
    const ensure = (testerId: string, name: string): MergedRow => {
      let row = byId.get(testerId)
      if (!row) {
        row = {
          testerId, name,
          completed: 0, adherenceRate: null, avgActualDays: null, weightedThroughput: 0, utilization: null,
          testItems: 0, testMinutes: 0, sideMinutes: 0, sideCount: 0, sideRatio: null, coverage: null,
        }
        byId.set(testerId, row)
      }
      return row
    }

    for (const e of evalData?.byTester ?? []) {
      const row = ensure(e.testerId, e.name)
      row.completed = e.completed
      row.adherenceRate = e.adherenceRate
      row.avgActualDays = e.avgActualDays
      row.weightedThroughput = e.weightedThroughput
      row.utilization = e.utilization
    }

    for (const r of report?.byTester ?? []) {
      const row = ensure(r.testerId, r.name)
      row.testItems = r.testItems
      row.testMinutes = r.testMinutes
      row.sideMinutes = r.sideMinutes
      row.sideCount = r.sideCount
      row.sideRatio = r.sideRatio
      row.coverage = r.coverage
      // 완료 작업 수는 두 집계의 정의가 같다(승인완료 + 종료일이 기간 안).
      // 성과 쪽이 통째로 실패한 날에도 이 숫자가 비지 않게 채워 둔다.
      if (row.completed === 0) row.completed = r.completedJobs
    }

    return [...byId.values()]
  }, [evalData, report])

  const sorted = useMemo(() => {
    return [...merged].sort((a, b) => {
      const av = a[sortField]; const bv = b[sortField]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "ko")
        : (av as number) - (bv as number)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [merged, sortField, sortDir])

  /** 어느 한쪽이라도 실적이 있으면 화면을 그린다 — 완료 작업 0건이 곧 '아무 일도 없었다'는 아니다 */
  const hasData = merged.length > 0

  // ── 차트 데이터 ────────────────────────────────────────────────────────────
  // 시간 축은 '시간'으로 환산한다. 분 단위 막대는 4자리가 되어 눈금이 읽히지 않는다.
  const timeChart = useMemo(() => merged
    .filter(r => r.testMinutes > 0 || r.sideMinutes > 0)
    .map(r => ({ name: r.name, 시험업무: minutesToHours(r.testMinutes), 부업무: minutesToHours(r.sideMinutes) })),
    [merged])

  const categoryChart = useMemo(() => (report?.byCategory ?? [])
    .slice(0, 12)
    .map(c => ({ name: c.categoryName, 시간: minutesToHours(c.minutes) })),
    [report])

  // 아무 기록도 없는 날은 뺀다 — 90일 중 근무일만 남아야 막대 사이가 벌어지지 않는다.
  const dailyChart = useMemo(() => (report?.daily ?? [])
    .filter(d => d.testMinutes > 0 || d.sideMinutes > 0)
    .map(d => ({
      label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`,
      시험업무: minutesToHours(d.testMinutes),
      부업무:   minutesToHours(d.sideMinutes),
    })),
    [report])

  const perfChartRows = evalData?.byTester ?? []

  /** 실제로 열리는 탭 — 고른 적이 있으면 그것, 없으면 데이터가 있는 쪽 */
  const tab: TabKey = tabPick ?? (perfChartRows.length === 0 && report ? "time" : "perf")
  const setTab = setTabPick

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 헤더 — 부제는 화면 이름을 되풀이하는 대신 집계 기준(기간·근무일)을 적는다 */}
      <header className="flex min-w-0 shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">시험자 운영 분석</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            성과(완료 작업)와 시간 배분(시험 vs 부업무)을 같은 기간으로
            {period && (
              <>
                <span className="px-1 text-border">·</span>
                <span className="tabular-nums">{period.from} ~ {period.to}</span>
                <span className="px-1 text-border">·</span>
                근무일 <span className="font-semibold tabular-nums text-foreground">{period.workingDays}</span>일
              </>
            )}
          </p>
        </div>
        {/* 모바일에서는 기간 입력이 한 줄을 차지하고 새로고침이 아래로 접힌다 */}
        <div className="flex w-full min-w-0 flex-wrap items-end gap-2 md:w-auto md:shrink-0 md:flex-nowrap">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1 md:flex-none">
            <DateRangeField
              label="조회기간"
              startDate={from}
              endDate={to}
              onChange={(s, e) => { setFrom(s); setTo(e) }}
            />
          </div>
          <Button variant="outline" className="h-9 shrink-0" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            새로고침
          </Button>
        </div>
      </header>

      {/* 한쪽만 실패한 경우 — 어느 쪽이 빈 것인지 말해 준다. 화면 전체를 막지 않는다 */}
      {(perfError || timeError) && (
        <div className="flex shrink-0 flex-col gap-1.5">
          {perfError && <PartialError label="성과 지표" message={perfError} />}
          {timeError && <PartialError label="시간 배분" message={timeError} />}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : !hasData ? (
        /* 빈 상태에 테두리를 두르지 않는다 — 없는 것을 상자로 강조할 이유가 없다 */
        <div className="shrink-0 px-3 py-16 text-center">
          <p className="text-sm font-medium break-keep text-muted-foreground">이 기간에 집계할 실적이 없습니다.</p>
          <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
            시험자가 작업을 진행하거나 월간 스케줄에서 부업무를 기록하면 여기에 집계됩니다.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI ──────────────────────────────────────────────────────────
              위 세 칸은 시간 배분, 아래(오른쪽) 세 칸은 성과다. 합친 화면이라는 것이
              맨 윗줄에서 바로 보이도록 두 계열을 나란히 둔다. */}
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              icon={<FlaskConical size={16} />}
              label="시험업무"
              value={formatMinutes(timeTotals?.testMinutes, "—")}
              hint={timeTotals ? `시험항목 ${timeTotals.testItems}건` : undefined}
            />
            <KpiCard
              icon={<Wrench size={16} />}
              label="부업무"
              value={formatMinutes(timeTotals?.sideMinutes, "—")}
              hint={timeTotals ? `기록 ${timeTotals.sideCount}건` : undefined}
            />
            <KpiCard
              icon={<Percent size={16} />}
              label="부업무 비중"
              value={fmtPct(timeTotals?.sideRatio ?? null)}
              hint="전체 기록 시간 중"
              valueClass={ratioTextClass(timeTotals?.sideRatio ?? null)}
            />
            <KpiCard
              icon={<CheckCircle2 size={16} />}
              label="공수 준수율"
              value={fmtPct(evalTotals?.adherenceRate ?? null)}
              hint="지정 공수 이내 완료"
              valueClass={rateTextClass(evalTotals?.adherenceRate ?? null)}
            />
            <KpiCard
              icon={<CalendarDays size={16} />}
              label="평균 소요일"
              value={fmtDay(evalTotals?.avgActualDays ?? null)}
              hint="시작~종료 근무일"
            />
            <KpiCard
              icon={<ChartColumn size={16} />}
              label="완료 작업"
              value={`${evalTotals?.completedJobs ?? timeTotals?.completedJobs ?? 0}건`}
              hint="승인완료 기준"
            />
          </div>

          {/* ── 통합 시험자 표 ───────────────────────────────────────────────
              이 화면을 합친 이유가 이 표다. 준수율과 부업무 비중이 한 행에 있어야
              "준수율이 낮은데 부업무를 40% 하고 있었다"가 한 줄로 읽힌다.
              그래서 차트보다 위에 둔다. */}
          <section className="min-w-0 shrink-0 overflow-hidden rounded-md border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                시험자별 상세
                <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{sorted.length}명</span>
              </h2>
              <p className="text-xs leading-normal break-keep text-muted-foreground">
                가동률 — <span className="font-medium text-foreground">실적</span>은 기록 시간 ÷ 근무시간,
                <span className="font-medium text-foreground"> 계획</span>은 배정 공수 ÷ 근무일
              </p>
            </div>

            {/* ── 모바일: 표 대신 카드 목록 ───────────────────────────────
                여덟 칸짜리 표를 320px 에 우겨넣지 않는다. 이름·부업무 비중을 위로
                올리고 나머지 수치는 잔글씨 두 줄로 내린다. */}
            <div className="divide-y md:hidden">
              {sorted.map(t => (
                <div key={t.testerId} className="px-4 py-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <TesterAvatar testerId={t.testerId} name={t.name} size="sm" />
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.name}</span>
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular-nums", ratioTextClass(t.sideRatio))}>
                      부업무 {fmtPct(t.sideRatio)}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal tabular-nums text-muted-foreground">
                    <span>시험 {formatMinutes(t.testMinutes, "0분")}</span>
                    <span className="text-border">·</span>
                    <span>부업무 {formatMinutes(t.sideMinutes, "0분")}</span>
                    <span className="text-border">·</span>
                    <span>항목 {t.testItems}건</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal tabular-nums text-muted-foreground">
                    <span>완료 {t.completed}건</span>
                    <span className="text-border">·</span>
                    <span className={rateTextClass(t.adherenceRate)}>준수율 {fmtPct(t.adherenceRate)}</span>
                    <span className="text-border">·</span>
                    <span>평균 {fmtDay(t.avgActualDays)}</span>
                    <span className="ml-auto">가동률 {fmtPct(t.coverage)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── 데스크톱: 표 ─────────────────────────────────────────────
                필드 2개짜리 칸(시험업무·부업무·가동률)은 표가 넓으면 스스로 갈라진다.
                그래서 본문을 CellStack 으로 둔다 — 아니면 헤더 칸 수와 어긋난다. */}
            <div className="hidden md:block">
              {/* col 개수는 "합쳐졌을 때(8)"가 아니라 "최대로 펼쳐졌을 때(11)" 기준이다.
                  모자라면 늘어난 칸이 폭 0으로 접혀 열이 통째로 사라진다
                  (docs/table-adaptive-columns.md §4). 순서는 펼친 상태 기준 —
                  시험자 · 완료건 · 준수율 · 소요일 · 시험업무 · 항목수 · 부업무 · 건수 ·
                  부업무비중 · 실적가동률 · 계획가동률.
                  ⚠️ colgroup 안에는 JSX 주석을 넣지 않는다(공백 노드 → 하이드레이션 오류). */}
              <Table className="text-sm">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[7%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
                  <col className="w-[7%]" />
                  <col className="w-[9%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {SORT_COLUMNS.map(({ col, numeric }) => (
                      <TableHead
                        key={col.key}
                        className={numeric ? "px-3 text-right text-muted-foreground" : "px-3 text-muted-foreground"}
                      >
                        <div className={numeric ? "flex justify-end" : undefined}>
                          <SortColumnHeader col={col} sortField={sortField} sortDir={sortDir} onPick={pickSort} />
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(t => (
                    <TableRow key={t.testerId} className="last:border-0 hover:bg-muted/40">
                      <TableCell className="px-3 py-2.5 font-medium text-foreground">
                        <div className="flex min-w-0 items-center gap-2">
                          <TesterAvatar testerId={t.testerId} name={t.name} size="sm" />
                          <span className="block truncate" title={t.name}>{t.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">{t.completed}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">
                        <span className={cn("font-semibold", rateTextClass(t.adherenceRate))}>{fmtPct(t.adherenceRate)}</span>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">{fmtDay(t.avgActualDays)}</TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">
                        <CellStack
                          primary={formatMinutes(t.testMinutes, "0분")}
                          secondary={`${t.testItems}항목`}
                          secondaryLabel="항목수"
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">
                        <CellStack
                          primary={formatMinutes(t.sideMinutes, "0분")}
                          secondary={`${t.sideCount}건`}
                          secondaryLabel="건수"
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">
                        <span className={cn("font-semibold", ratioTextClass(t.sideRatio))}>{fmtPct(t.sideRatio)}</span>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right tabular-nums">
                        <CellStack
                          primary={fmtPct(t.coverage)}
                          secondary={`계획 ${fmtPct(t.utilization)}`}
                          secondaryLabel="계획 가동률"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* ── 동시분석 효과 ────────────────────────────────────────────────
              같은 사실의 다른 얼굴이다. 위 표는 "얼마를 썼나" 를, 여기는 "따로 했으면
              얼마였나" 를 말한다. 계획(공수)과 실적(시간)을 한 줄에 뭉치지 않는다 —
              계획이 좋았는지와 실행이 좋았는지는 다른 질문이다. */}
          {report?.concurrent && report.concurrent.groups > 0 && (
            <section className="flex shrink-0 flex-col gap-2 rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Layers className="size-4 text-primary" />동시분석 효과
                </h2>
                <span className="text-xs leading-normal break-keep text-muted-foreground">
                  묶음 {report.concurrent.groups}개 · 실적 집계 가능 {report.concurrent.groupsWithActual}개
                  {report.concurrent.workdaysMissing > 0 && (
                    <span className="text-amber-700 dark:text-amber-300">
                      {" · 공수 미등록 "}{report.concurrent.workdaysMissing}건은 계획 절감에서 빠짐
                    </span>
                  )}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* 계획 */}
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">계획 — 공수</p>
                  <p className="mt-1 text-sm text-foreground">
                    따로 <span className="font-semibold tabular-nums">{report.concurrent.soloDays}일</span>
                    {" → 함께 "}
                    <span className="font-semibold tabular-nums">{report.concurrent.concurrentDays}일</span>
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-blue-700 dark:text-blue-300">
                    {report.concurrent.savedDays}일 절감
                    <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                      ({report.concurrent.savedDaysRatio}%)
                    </span>
                  </p>
                </div>
                {/* 실적 */}
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground">실적 — 실제 소요</p>
                  <p className="mt-1 text-sm text-foreground">
                    따로였다면 <span className="font-semibold tabular-nums">{fmtMin(report.concurrent.sumMinutes)}</span>
                    {" → 실제 "}
                    <span className="font-semibold tabular-nums">{fmtMin(report.concurrent.spanMinutes)}</span>
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-blue-700 dark:text-blue-300">
                    {fmtMin(report.concurrent.savedMinutes)} 절감
                    <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                      ({report.concurrent.savedMinutesRatio}%)
                    </span>
                  </p>
                </div>
              </div>

              {report.concurrent.top.length > 0 && (
                <ul className="flex flex-col divide-y border-t pt-1">
                  {report.concurrent.top.map(t => (
                    <li key={t.groupKey} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-xs leading-normal">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className={cn(
                          "shrink-0 rounded-md border px-1 font-medium",
                          t.source === "manual"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground",
                        )}>
                          {t.source === "manual" ? "수동" : "자동"} {t.members}건
                        </span>
                        <span className="min-w-0 truncate font-medium text-foreground">{t.label ?? t.productName}</span>
                        <span className="hidden shrink-0 font-mono text-muted-foreground sm:inline">
                          {t.batchNos.slice(0, 3).join(", ")}{t.batchNos.length > 3 ? " …" : ""}
                        </span>
                        {t.testerNames.length > 0 && (
                          <span className="shrink-0 text-muted-foreground">· {t.testerNames.join(", ")}</span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums text-blue-700 dark:text-blue-300">
                        −{t.savedDays}일
                        {t.savedMinutes > 0 && <span className="text-muted-foreground"> / −{fmtMin(t.savedMinutes)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs leading-normal break-keep text-muted-foreground">
                담당자가 둘 이상인 묶음은 계획 절감이 실제로 실현되지 않습니다 — 동시분석은 한 사람이 함께 돌릴 때 이득이 납니다.
              </p>
            </section>
          )}

          {/* ── 탭 ───────────────────────────────────────────────────────────
              표가 답을 주고, 탭은 그 답의 배경을 보여준다. 두 계열을 한 화면에
              세로로 다 쌓으면 차트만 여섯 장이라 아무것도 안 읽힌다. */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="flex w-full flex-wrap items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground sm:inline-flex sm:h-9 sm:w-fit sm:flex-nowrap">
              {TABS.map(t => {
                const active = tab === t.key
                const Icon = t.icon
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      active ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    {t.label}
                  </button>
                )
              })}
            </div>
            <p className="px-1 text-xs leading-normal break-keep text-muted-foreground">
              {TABS.find(t => t.key === tab)?.hint}
            </p>
          </div>

          {/* ── 성과 탭 ─────────────────────────────────────────────────── */}
          {tab === "perf" && (
            perfChartRows.length === 0 ? (
              <EmptyPanel
                title="완료된 작업이 없습니다"
                desc="공수 준수율·처리량은 승인완료된 작업에서만 나옵니다. 진행 중인 일은 [시간 배분] 탭에서 볼 수 있습니다."
              />
            ) : (
              <>
                <ChartCard
                  title="시험자별 공수 준수율 (%)"
                  hint="지정 공수 이내에 끝낸 비율 · 90↑ 파랑 / 70↑ 황색 / 그 외 적색"
                >
                  <ResponsiveContainer width="100%" height={Math.max(160, perfChartRows.length * 38)}>
                    <BarChart data={perfChartRows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 15, fill: "#64748b" }} />
                      <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 15, fill: "#334155" }} />
                      <Tooltip formatter={v => [`${v}%`, "준수율"]} cursor={{ fill: "#f8fafc" }} />
                      <Bar dataKey="adherenceRate" radius={[0, 4, 4, 0]} barSize={18}>
                        {perfChartRows.map(t => <Cell key={t.testerId} fill={rateColor(t.adherenceRate)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                  title="시험자별 처리량 / 난이도 가중"
                  hint="완료 건수와 난이도 가중(High3·Med2·Low1) 처리량"
                >
                  <ResponsiveContainer width="100%" height={Math.max(160, perfChartRows.length * 38)}>
                    <BarChart data={perfChartRows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 15, fill: "#64748b" }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 15, fill: "#334155" }} />
                      <Tooltip cursor={{ fill: "#f8fafc" }} />
                      {/* 어느 막대가 무엇인지 hover 없이도 읽히게 범례를 화면에 내놓는다 */}
                      <Legend
                        wrapperStyle={{ fontSize: "0.75rem" }}
                        /* 범례 글자가 계열 색을 물려받아 흰 배경에서 2.5:1 이었다 — 본문색으로 고정한다. */
                        formatter={value => <span className="text-foreground">{value}</span>}
                      />
                      {/* 두 계열을 다른 색이 아니라 같은 파랑의 농도 차로 구분한다(보라는 브랜드 색이 아니다) */}
                      <Bar dataKey="completed" name="완료건" fill="#60a5fa" radius={[0, 3, 3, 0]} barSize={9} />
                      <Bar dataKey="weightedThroughput" name="가중처리량" fill="#1e40af" radius={[0, 3, 3, 0]} barSize={9} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </>
            )
          )}

          {/* ── 시간 배분 탭 ────────────────────────────────────────────── */}
          {tab === "time" && (
            !report ? (
              <EmptyPanel
                title="시간 배분을 불러오지 못했습니다"
                desc="위의 안내를 확인해 주세요."
              />
            ) : (
              <>
                <ChartCard
                  title="시험자별 시험업무 vs 부업무 (시간)"
                  hint={
                    timeChart.length === 0
                      ? "기록된 실측 시간이 없습니다"
                      : "쌓지 않고 나란히 둔다 — 여기서 알고 싶은 것은 총량이 아니라 둘의 차이다"
                  }
                >
                  {timeChart.length === 0 ? (
                    <p className="py-10 text-center text-sm break-keep text-muted-foreground">데이터 없음</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(180, timeChart.length * 46)}>
                      <BarChart data={timeChart} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                        <CartesianGrid horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" tick={{ fontSize: 15, fill: "#64748b" }} unit="h" />
                        <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 15, fill: "#334155" }} />
                        <Tooltip formatter={(v, n) => [`${v}시간`, n]} cursor={{ fill: "#f8fafc" }} />
                        <Legend
                          wrapperStyle={{ fontSize: "0.75rem" }}
                          formatter={value => <span className="text-foreground">{value}</span>}
                        />
                        <Bar dataKey="시험업무" fill={TEST_HEX} radius={[0, 3, 3, 0]} barSize={11} />
                        <Bar dataKey="부업무"   fill={SIDE_HEX} radius={[0, 3, 3, 0]} barSize={11} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <div className="grid shrink-0 gap-4 lg:grid-cols-2">
                  <ChartCard
                    title="부업무 분류별 소요 (시간)"
                    hint={
                      report.byCategory.length === 0
                        ? "기록된 부업무가 없습니다"
                        : `${report.byCategory.length}개 분류 · 합계 ${formatMinutes(timeTotals?.sideMinutes, "0분")}`
                    }
                  >
                    {report.byCategory.length === 0 ? (
                      <p className="py-10 text-center text-sm break-keep text-muted-foreground">
                        월간 스케줄에서 시험자가 자기 칸을 눌러 기록하면 여기에 쌓입니다.
                      </p>
                    ) : (
                      <ResponsiveContainer width="100%" height={Math.max(160, categoryChart.length * 34)}>
                        <BarChart data={categoryChart} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                          <CartesianGrid horizontal={false} stroke="var(--border)" />
                          <XAxis type="number" tick={{ fontSize: 15, fill: "#64748b" }} unit="h" />
                          {/* 좁은 축에 긴 분류명이 들어오면 그림 밖으로 넘친다 — 잘라서 세운다 */}
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={110}
                            tick={{ fontSize: 15, fill: "#334155" }}
                            tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v)}
                          />
                          <Tooltip formatter={v => [`${v}시간`, "소요"]} cursor={{ fill: "#f8fafc" }} />
                          <Bar dataKey="시간" fill={SIDE_HEX} radius={[0, 4, 4, 0]} barSize={16} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>

                  <ChartCard
                    title="일자별 추이 (시간)"
                    hint="몰리면 그 주 배정을 줄이고, 고르게 깔리면 1인당 가용 공수를 낮춰 잡아야 한다"
                  >
                    {dailyChart.length === 0 ? (
                      <p className="py-10 text-center text-sm break-keep text-muted-foreground">데이터 없음</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={dailyChart} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} minTickGap={24} />
                          <YAxis tick={{ fontSize: 12, fill: "#64748b" }} unit="h" />
                          <Tooltip formatter={(v, n) => [`${v}시간`, n]} cursor={{ fill: "#f8fafc" }} />
                          <Legend
                            wrapperStyle={{ fontSize: "0.75rem" }}
                            formatter={value => <span className="text-foreground">{value}</span>}
                          />
                          <Bar dataKey="시험업무" stackId="d" fill={TEST_HEX} maxBarSize={32} />
                          <Bar dataKey="부업무"   stackId="d" fill={SIDE_HEX} maxBarSize={32} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>
                </div>

                {/* 시험 진행 항목 — 시간만 보면 오래 걸리는 항목 하나가 여러 건을 이긴다.
                    건수와 총소요를 함께 둬야 "무엇을 얼마나 쳤는가"가 읽힌다. */}
                <section className="min-w-0 shrink-0 overflow-hidden rounded-md border bg-card">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
                    <h2 className="text-sm font-semibold text-foreground">시험 진행 항목</h2>
                    <p className="text-xs leading-normal break-keep tabular-nums text-muted-foreground">
                      완료된 시험항목 {timeTotals?.testItems ?? 0}건 · 소요 많은 순
                    </p>
                  </div>
                  {report.byTestItem.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm break-keep text-muted-foreground">
                      이 기간에 완료된 시험항목이 없습니다.
                    </p>
                  ) : (
                    <div className="min-w-0 overflow-x-auto">
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="px-3 text-muted-foreground">시험항목</TableHead>
                            <TableHead className="px-3 text-right text-muted-foreground">진행 건수</TableHead>
                            <TableHead className="px-3 text-right text-muted-foreground">총 소요</TableHead>
                            <TableHead className="px-3 text-right text-muted-foreground">평균 소요</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.byTestItem.slice(0, 30).map(i => (
                            <TableRow key={i.testItemName} className="last:border-0">
                              <TableCell className="px-3 py-2.5 font-medium break-keep">{i.testItemName}</TableCell>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums">{i.count}</TableCell>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums">{formatMinutes(i.minutes, "0분")}</TableCell>
                              <TableCell className="px-3 py-2.5 text-right tabular-nums">{formatMinutes(i.avgMinutes, "0분")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {report.byTestItem.length > 30 && (
                        <p className="border-t px-4 py-2 text-xs break-keep text-muted-foreground">
                          소요 상위 30개만 표시합니다 (전체 {report.byTestItem.length}개).
                        </p>
                      )}
                    </div>
                  )}
                </section>
              </>
            )
          )}
        </>
      )}
    </div>
  )
}

// ─── 조각 컴포넌트 ────────────────────────────────────────────────────────────

/** 한쪽 집계만 실패했을 때의 안내. 파괴적 오류가 아니라 '이 부분이 빈다'는 사실이다 */
function PartialError({ label, message }: { label: string; message: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-semibold">{label}</span>를 불러오지 못했습니다 — {message}
      </span>
    </p>
  )
}

function EmptyPanel({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="shrink-0 px-3 py-12 text-center">
      <p className="text-sm font-medium break-keep text-muted-foreground">{title}</p>
      <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">{desc}</p>
    </div>
  )
}

/**
 * KPI 한 칸.
 * 지표마다 다른 색 아이콘 칩을 두르던 것은 걷어냈다 — 색이 아무 것도 구분하지 않으면
 * 의미를 잃는다. 위계는 숫자 크기가 만들고, 색은 경보(준수율·부업무 비중)에만 쓴다.
 */
function KpiCard({
  icon, label, value, hint, valueClass,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  valueClass?: string
}) {
  return (
    /* 모바일은 라벨·숫자를 한 줄로 눕혀 타일 높이를 절반으로 줄인다 —
       여섯 칸이 세 줄로 쌓여 정작 봐야 할 시험자 목록을 화면 밖으로 밀어내던 자리다. */
    <div className="flex min-h-8 min-w-0 items-center justify-between gap-1 rounded-md border bg-card px-2 py-1 sm:block sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {/* 좁은 칸에서 아이콘 22px 를 빼야 '전체 공수 준수율' 같은 라벨이 잘리지 않는다 */}
        <span className="hidden shrink-0 items-center sm:flex">{icon}</span>
        <span className="min-w-0 truncate" title={label}>{label}</span>
      </div>
      {/* 320px 2열 격자에서 "125분" 같은 값이 칸을 밀어내지 않게 모바일에서 한 단 줄인다 */}
      <p
        className={cn(
          "min-w-0 shrink-0 truncate text-sm font-semibold tabular-nums sm:mt-1.5 sm:text-2xl",
          valueClass ?? "text-foreground",
        )}
        title={value}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 hidden truncate text-xs leading-normal text-muted-foreground sm:block" title={hint}>{hint}</p>}
    </div>
  )
}

function ChartCard({
  title, hint, children, className,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    /* overflow-hidden: recharts 는 툴팁을 절대위치 요소로 차트 옆에 남겨 두는데,
       좁은 폭에서 그 요소가 부모의 스크롤 폭을 587px 까지 늘려 페이지가 옆으로 밀렸다.
       카드 안에서 잘라 내면 툴팁 동작은 그대로면서 폭만 갇힌다. */
    <div className={cn("min-w-0 shrink-0 overflow-hidden rounded-md border bg-card p-4", className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint && <p className="mt-0.5 mb-3 text-xs leading-normal break-keep text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

/** 로딩 뼈대 — 실제로 나올 모양(KPI 여섯 칸 + 표 + 차트)과 같은 자리에 놓는다 */
function LoadingSkeleton() {
  return (
    <>
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-h-8 min-w-0 items-center justify-between gap-1 rounded-md border bg-card px-2 py-1 sm:block sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Skeleton className="hidden h-7 w-7 rounded-md sm:block" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="h-4 w-10 shrink-0 sm:mt-2 sm:h-8 sm:w-16" />
          </div>
        ))}
      </div>

      <div className="min-w-0 shrink-0 overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3"><Skeleton className="h-4 w-24" /></div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 shrink-0 rounded-md border bg-card p-4">
        <Skeleton className="mb-3 h-4 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    </>
  )
}
