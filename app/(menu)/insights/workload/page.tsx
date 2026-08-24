"use client"

/**
 * 품목별 시험공수 관리 — 인사이트 > 품목 공수 대시보드.
 *
 * 품목 → 시험항목 → 작업단계 3계층으로 인적·기기·대기·검토 공수를 관리하고,
 * 향후 시험자/기기 자동배정의 기준 데이터를 구축한다.
 *
 * ⚠️ 공수와 표준 소요일은 다른 개념이다. 화면 어디에서도 공수 합계로 소요일을 계산하지 않는다.
 * 데이터: GET /api/workloads/products · GET /api/workloads/actuals
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  Beaker, CalendarDays, Cpu, Layers, Pencil, Plus, Search, Timer, Trash2, UserRound,
} from "lucide-react"
import { useAuth } from "@frontend/lib/auth-context"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  SortColumnHeader, sortCol, type SortColumnDef, type SortDir,
} from "@frontend/components/ui/table-sort"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import {
  formatHours, formatLeadDays, formatMinutes, formatVarianceMinutes, formatVarianceRate, minutesToHours,
} from "@frontend/lib/workload-format"
import {
  ACTUAL_PERIODS,
  VARIANCE_LEVEL_LABEL,
  VARIANCE_THRESHOLD,
  WORKLOAD_STATUSES,
  WORKLOAD_STATUS_LABEL,
  varianceLevel,
  type ActualPeriodId,
  type ProductWorkload,
  type WorkloadStatus,
  type WorkloadVarianceRow,
} from "@shared/workload"
import {
  KpiCard, SectionCard, WORKLOAD_TYPE_HEX,
} from "@frontend/components/workload/workload-ui"
import { ProductWorkloadDialog } from "@frontend/components/workload/product-workload-dialog"
import { WorkloadDetailSheet } from "@frontend/components/workload/workload-detail-sheet"

const ALL = "__all__"
const TOP_N = 10

/** 표준소요일 구간 필터 */
const LEAD_TIME_BUCKETS = [
  { id: "lt2", label: "2일 미만", match: (d: number) => d < 2 },
  { id: "2to3", label: "2~3일", match: (d: number) => d >= 2 && d <= 3 },
  { id: "3to5", label: "3~5일", match: (d: number) => d > 3 && d <= 5 },
  { id: "gt5", label: "5일 초과", match: (d: number) => d > 5 },
]

type SortField =
  | "productName" | "productCode" | "dosageForm" | "standardLeadTimeDays"
  | "totalHumanMinutes" | "totalEquipmentMinutes" | "totalWaitingMinutes" | "totalReviewMinutes"
  | "testItemCount"

const SORT_COLUMNS: { col: SortColumnDef<SortField>; numeric: boolean }[] = [
  {
    col: {
      key: "product", label: "품목",
      fields: [{ id: "productName", label: "품목명" }, { id: "productCode", label: "품목코드" }],
    },
    numeric: false,
  },
  { col: sortCol<SortField>("dosageForm", "제형"), numeric: false },
  { col: sortCol<SortField>("standardLeadTimeDays", "표준소요일"), numeric: true },
  { col: sortCol<SortField>("totalHumanMinutes", "인적공수"), numeric: true },
  { col: sortCol<SortField>("totalEquipmentMinutes", "기기공수"), numeric: true },
  { col: sortCol<SortField>("totalWaitingMinutes", "대기시간"), numeric: true },
  { col: sortCol<SortField>("totalReviewMinutes", "검토공수"), numeric: true },
  { col: sortCol<SortField>("testItemCount", "시험항목"), numeric: true },
]

const STATUS_DOT: Record<WorkloadStatus, string> = {
  DRAFT: "bg-slate-400",
  ACTIVE: "bg-blue-600",   // '사용중'은 브랜드 파랑 — indigo 는 쓰지 않는다
  INACTIVE: "bg-red-400",
}

export default function ProductWorkloadPage() {
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
  const canEdit = user?.role === "admin"

  const [rows, setRows] = useState<ProductWorkload[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: "info" | "error" } | null>(null)

  // 필터
  const [keyword, setKeyword] = useState("")
  const [dosageFilter, setDosageFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [leadTimeFilter, setLeadTimeFilter] = useState(ALL)
  const [equipmentFilter, setEquipmentFilter] = useState(ALL)

  // 정렬
  const [sortField, setSortField] = useState<SortField>("totalEquipmentMinutes")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // 다이얼로그 / 상세
  const [detailId, setDetailId] = useState<string | null>(null)
  const [productDialog, setProductDialog] = useState<{ initial: ProductWorkload | null } | null>(null)

  // 표준 vs 실제
  const [period, setPeriod] = useState<ActualPeriodId>("3m")
  const [actual, setActual] = useState<{ hasData: boolean; rows: WorkloadVarianceRow[] } | null>(null)

  const flash = (text: string, type: "info" | "error" = "info") => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/workloads/products", { credentials: "include" })
      const data = (await res.json()) as { rows?: ProductWorkload[]; schemaReady?: boolean; error?: string }
      if (!res.ok) { flash(data.error ?? "목록 로드 실패", "error"); return }
      setRows(data.rows ?? [])
      setSchemaReady(data.schemaReady !== false)
    } catch {
      flash("목록 로드 실패", "error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const months = ACTUAL_PERIODS.find(p => p.id === period)?.months ?? 3
    void (async () => {
      try {
        const res = await fetch(`/api/workloads/actuals?months=${months}`, { credentials: "include" })
        if (!res.ok) { setActual({ hasData: false, rows: [] }); return }
        const data = (await res.json()) as { hasData: boolean; rows: WorkloadVarianceRow[] }
        setActual(data)
      } catch {
        setActual({ hasData: false, rows: [] })
      }
    })()
  }, [period])

  // ─── 파생 데이터 ───────────────────────────────────────────────────────────

  /** 품목이 사용하는 기기 종류 */
  const equipmentsOf = useCallback(
    (p: ProductWorkload) => [
      ...new Set(
        p.testItems
          .flatMap(i => i.steps)
          .filter(s => s.workloadType === "EQUIPMENT")
          .map(s => s.equipmentTypeName)
          .filter((v): v is string => !!v),
      ),
    ],
    [],
  )

  const dosageOptions = useMemo(
    () => [...new Set(rows.map(r => r.dosageForm).filter((v): v is string => !!v))].sort(),
    [rows],
  )
  const equipmentOptions = useMemo(
    () => [...new Set(rows.flatMap(equipmentsOf))].sort(),
    [rows, equipmentsOf],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return rows.filter(r => {
      if (kw && !`${r.productCode} ${r.productName}`.toLowerCase().includes(kw)) return false
      if (dosageFilter !== ALL && r.dosageForm !== dosageFilter) return false
      if (statusFilter !== ALL && r.status !== statusFilter) return false
      if (leadTimeFilter !== ALL) {
        const bucket = LEAD_TIME_BUCKETS.find(b => b.id === leadTimeFilter)
        if (bucket && !bucket.match(r.standardLeadTimeDays)) return false
      }
      if (equipmentFilter !== ALL && !equipmentsOf(r).includes(equipmentFilter)) return false
      return true
    })
  }, [rows, keyword, dosageFilter, statusFilter, leadTimeFilter, equipmentFilter, equipmentsOf])

  const sorted = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[sortField] ?? ""
      const bv = b[sortField] ?? ""
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "ko")
        : Number(av) - Number(bv)
      return cmp !== 0 ? cmp * mul : a.productName.localeCompare(b.productName, "ko")
    })
  }, [filtered, sortField, sortDir])

  /** KPI — 필터가 걸린 목록 기준으로 집계한다 */
  const kpi = useMemo(() => {
    const n = filtered.length
    if (n === 0) return { count: 0, leadTime: null, human: null, equipment: null, review: null }
    const avg = (pick: (p: ProductWorkload) => number) =>
      filtered.reduce((acc, p) => acc + pick(p), 0) / n
    return {
      count: n,
      leadTime: avg(p => p.standardLeadTimeDays),
      human: avg(p => p.totalHumanMinutes),
      equipment: avg(p => p.totalEquipmentMinutes),
      review: avg(p => p.totalReviewMinutes),
    }
  }, [filtered])

  /** 공수 분포 차트 — 공수 합계 기준 상위 품목 (Y축 단위: 시간) */
  const chartData = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => totalWorkload(b) - totalWorkload(a))
        .slice(0, TOP_N)
        .map(p => ({
          name: p.productName,
          인적공수: minutesToHours(p.totalHumanMinutes),
          기기공수: minutesToHours(p.totalEquipmentMinutes),
          대기시간: minutesToHours(p.totalWaitingMinutes),
          검토공수: minutesToHours(p.totalReviewMinutes),
        })),
    [filtered],
  )

  const detailProduct = useMemo(() => rows.find(r => r.id === detailId) ?? null, [rows, detailId])

  // ─── 액션 ─────────────────────────────────────────────────────────────────

  const handleDelete = async (p: ProductWorkload) => {
    const ok = await requestConfirm({
      title: "품목 공수를 삭제할까요?",
      description: `${p.productName}(${p.productCode})의 공수 표준을 목록에서 제외합니다. 과거 시험실적 추적을 위해 데이터는 보관됩니다.`,
      confirmLabel: "품목 삭제",
      variant: "danger",
    })
    if (!ok) return

    setBusyId(p.id)
    try {
      const res = await fetch(`/api/workloads/products/${p.id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        flash(d.error ?? "삭제 실패", "error")
        return
      }
      flash("삭제되었습니다.")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const colCount = canEdit ? SORT_COLUMNS.length + 2 : SORT_COLUMNS.length + 1

  return (
    // 세로 flex 컨테이너로 두면 각 섹션이 flex-shrink 로 눌려 차트·표가 잘린다.
    // 블록 흐름 + space-y 로 쌓아 각 섹션이 내용 높이를 유지하고 페이지 전체가 스크롤되게 한다.
    <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
      {/* ── 헤더 ───────────────────────────────────────────────────────────
          장식용 아이콘 칩과 "…을 관리합니다" 부제를 걷어냈다. 화면 이름을 되풀이하는
          문장 대신 지금 몇 품목을 보고 있는지(필터가 걸렸으면 전체 대비)를 적는다. */}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-foreground">품목별 시험공수 관리</h1>
          {loading ? (
            <Skeleton className="h-3 w-40" />
          ) : (
            <p className="text-xs leading-normal break-keep text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{filtered.length}</span>품목
              {filtered.length !== rows.length && (
                <span className="tabular-nums"> / 전체 {rows.length}품목</span>
              )}
              <span className="px-1 text-border">·</span>
              공수와 표준 소요일은 별개 값입니다
            </p>
          )}
        </div>
        {canEdit && (
          <Button onClick={() => setProductDialog({ initial: null })}>
            <Plus /> 품목 추가
          </Button>
        )}
      </div>

      {/* 마이그레이션 미적용 안내 */}
      {!loading && !schemaReady && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm break-keep text-amber-800">
          공수 표준 테이블이 아직 생성되지 않아 <strong>예제 데이터(쌍화탕)</strong>를 보여주고 있습니다.
          저장은 되지 않습니다 — <code className="font-mono text-xs">supabase/migrations/0026_workload_standard.sql</code> 을 적용해 주세요.
        </div>
      )}

      {msg && (
        <div className={cn(
          "rounded-md border px-4 py-2.5 text-sm font-medium break-keep",
          msg.type === "error"
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-primary/20 bg-primary/5 text-foreground",
        )}>
          {msg.text}
        </div>
      )}

      {/* ── 검색 · 필터 ──────────────────────────────────────────────────
          필터가 5개다. 모바일에서는 검색이 한 줄을 다 쓰고 나머지 넷은 2열로 접힌다. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:min-w-52 sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="품목코드 · 품목명 검색"
            className="h-9 pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <FilterSelect
            value={dosageFilter} onChange={setDosageFilter} placeholder="제형"
            allLabel="제형 전체" options={dosageOptions.map(d => ({ value: d, label: d }))}
          />
          <FilterSelect
            value={statusFilter} onChange={setStatusFilter} placeholder="상태"
            allLabel="상태 전체"
            options={WORKLOAD_STATUSES.map(s => ({ value: s, label: WORKLOAD_STATUS_LABEL[s] }))}
          />
          <FilterSelect
            value={leadTimeFilter} onChange={setLeadTimeFilter} placeholder="표준소요일"
            allLabel="소요일 전체"
            options={LEAD_TIME_BUCKETS.map(b => ({ value: b.id, label: b.label }))}
          />
          <FilterSelect
            value={equipmentFilter} onChange={setEquipmentFilter} placeholder="기기 종류"
            allLabel="기기 전체" options={equipmentOptions.map(e => ({ value: e, label: e }))}
          />
        </div>
      </div>

      {/* ── KPI ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="min-w-0 gap-1 px-4 py-3.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-14" />
              </Card>
            ))
          : (
            <>
              <KpiCard
                icon={<Layers className="size-3.5" />} label="등록 품목"
                value={`${kpi.count} 품목`}
                hint={filtered.length !== rows.length ? `전체 ${rows.length} 품목 중` : undefined}
              />
              <KpiCard
                icon={<CalendarDays className="size-3.5" />} label="평균 표준 소요일"
                value={kpi.leadTime != null ? formatLeadDays(kpi.leadTime) : "—"}
                hint="공수 합계와 무관한 별도 값"
              />
              {/* 아이콘 색을 아래 차트의 막대 색과 맞춰 "이 숫자가 저 막대"임을 잇는다.
                  인적·기기·대기·검토 네 갈래는 색 자체가 구분 의미인 카테고리 팔레트라
                  브랜드 단일색 규칙의 예외다(workload-ui.tsx 의 WORKLOAD_TYPE_HEX 가 정본). */}
              <KpiCard
                icon={<UserRound className="size-3.5" />} label="평균 인적공수"
                value={formatHours(kpi.human)} accent="text-blue-600"
              />
              <KpiCard
                icon={<Cpu className="size-3.5" />} label="평균 기기공수"
                value={formatHours(kpi.equipment)} accent="text-amber-500"
              />
              <KpiCard
                icon={<Beaker className="size-3.5" />} label="평균 검토공수"
                value={formatHours(kpi.review)} accent="text-emerald-500"
              />
            </>
          )}
      </div>

      {/* ── 공수 분포 차트 ───────────────────────────────────────────────
          아래로 테두리 있는 표 카드가 두 번 더 이어진다. 똑같은 헤더 바가 반복되면
          리듬이 죽으므로, 차트만 카드를 벗기고 제목 + 실선으로 담는다.
          '공수 합계 상위 N개' 순위는 이 차트가 유일하게 말한다 — 같은 열 개를 숫자표로
          한 번 더 늘어놓던 「공수가 높은 품목 TOP N」 섹션은 걷어냈다(모바일에서 아래
          「품목 공수 리스트」와 카드 목록이 두 번 그려지던 원인). */}
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
          <h2 className="text-sm font-semibold text-foreground">품목별 공수 분포</h2>
          <p className="text-xs leading-normal break-keep text-muted-foreground">
            공수 합계 상위 <span className="tabular-nums">{TOP_N}</span>개 품목 · 단위 시간
            <span className="px-1 text-border">·</span>
            인적/기기/대기/검토는 각각 독립 값
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : chartData.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">표시할 품목이 없습니다.</p>
        ) : (
          /* 세로 막대 + X축에 한글 품목명 10개는 좁은 폭에서 라벨이 서로 겹친다.
             가로 막대로 눕혀 품목명을 Y축에 세우면 폭과 무관하게 읽히고,
             축 글자도 최소 크기(13.5px) 이상으로 올릴 수 있다. */
          <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 52)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 13.5, fill: "#64748b" }} />
              <YAxis
                type="category"
                dataKey="name"
                width={88}
                interval={0}
                tick={{ fontSize: 13.5, fill: "#334155" }}
                /* 좁은 축에 긴 품목명이 들어오면 그림 밖으로 넘친다 — 잘라서 세운다(전체 이름은 툴팁) */
                tickFormatter={(v: string) => (v.length > 6 ? `${v.slice(0, 6)}…` : v)}
              />
              <Tooltip formatter={(v, name) => [`${v}시간`, name]} cursor={{ fill: "#f8fafc" }} />
              <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
              <Bar dataKey="인적공수" fill={WORKLOAD_TYPE_HEX.HUMAN} radius={[0, 3, 3, 0]} maxBarSize={10} />
              <Bar dataKey="기기공수" fill={WORKLOAD_TYPE_HEX.EQUIPMENT} radius={[0, 3, 3, 0]} maxBarSize={10} />
              <Bar dataKey="대기시간" fill={WORKLOAD_TYPE_HEX.WAITING} radius={[0, 3, 3, 0]} maxBarSize={10} />
              <Bar dataKey="검토공수" fill={WORKLOAD_TYPE_HEX.REVIEW} radius={[0, 3, 3, 0]} maxBarSize={10} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── 품목 공수 리스트 ─────────────────────────────────────────────── */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">
            품목 공수 리스트
            <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
              {sorted.length}{sorted.length !== rows.length ? ` / ${rows.length}` : ""}건
            </span>
          </h2>
          <span className="text-xs leading-normal break-keep text-muted-foreground">행을 클릭하면 시험항목·작업단계를 볼 수 있습니다</span>
        </div>

        {/* ── 모바일: 표 대신 카드 목록 ──────────────────────────────────────
            9칸짜리 표다. 품목·상태·표준소요일·시험항목 수만 남기고 나머지는
            행을 눌러 여는 상세 패널에서 본다. */}
        <div className="divide-y md:hidden">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))
            : sorted.length === 0
              ? (
                  <p className="px-4 py-10 text-center text-sm break-keep text-muted-foreground">
                    {rows.length === 0 ? "등록된 품목 공수가 없습니다." : "조건에 맞는 품목이 없습니다."}
                  </p>
                )
              : sorted.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDetailId(p.id)}
                    className="block w-full px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.productName}</p>
                      <Badge variant="outline" className="shrink-0 gap-1.5 font-normal">
                        <span className={`size-1.5 rounded-full ${STATUS_DOT[p.status]}`} />
                        {WORKLOAD_STATUS_LABEL[p.status]}
                      </Badge>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal tabular-nums text-muted-foreground">
                      <span className="shrink-0 font-mono">{p.productCode}</span>
                      {p.dosageForm && <><span className="text-border">·</span><span className="min-w-0 truncate">{p.dosageForm}</span></>}
                      <span className="text-border">·</span>
                      <span>표준 {formatLeadDays(p.standardLeadTimeDays)}</span>
                      <span className="ml-auto">항목 {p.testItemCount}개</span>
                    </div>
                  </button>
                ))}
        </div>

        {/* ── 데스크톱: 표 ───────────────────────────────────────────────── */}
        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {SORT_COLUMNS.map(({ col, numeric }) => (
                <TableHead key={col.key} className={numeric ? "px-3 text-right text-muted-foreground" : "px-3 text-muted-foreground"}>
                  <div className={numeric ? "flex justify-end" : undefined}>
                    <SortColumnHeader
                      col={col}
                      sortField={sortField}
                      sortDir={sortDir}
                      onPick={(f, d) => { setSortField(f); setSortDir(d) }}
                    />
                  </div>
                </TableHead>
              ))}
              <TableHead className="px-3 text-muted-foreground">버전 · 상태</TableHead>
              {canEdit && (
                <TableHead className="px-3 text-center text-muted-foreground">
                  <span className="sr-only">관리</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <TableCell key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="py-16 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "등록된 품목 공수가 없습니다."
                    : "조건에 맞는 품목이 없습니다."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map(p => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setDetailId(p.id)}
                >
                  <TableCell className="px-3 py-2.5">
                    <CellStack
                      primary={p.productName}
                      secondary={p.productCode}
                      secondaryLabel="품목코드"
                      primaryClass="font-medium text-foreground"
                      title={`${p.productName} / ${p.productCode}`}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                    {p.dosageForm ?? "—"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right text-sm font-medium tabular-nums text-foreground">
                    {formatLeadDays(p.standardLeadTimeDays)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {formatMinutes(p.totalHumanMinutes)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {formatMinutes(p.totalEquipmentMinutes)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {formatMinutes(p.totalWaitingMinutes)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {formatMinutes(p.totalReviewMinutes)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                    {p.testItemCount}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-muted-foreground">v{p.version}</span>
                      <Badge variant="outline" className="gap-1.5 font-normal">
                        <span className={`size-1.5 rounded-full ${STATUS_DOT[p.status]}`} />
                        {WORKLOAD_STATUS_LABEL[p.status]}
                      </Badge>
                    </div>
                  </TableCell>
                  {canEdit && (
                    <TableCell className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          variant="ghost" size="icon-sm" title="수정"
                          className="text-muted-foreground"
                          onClick={e => { e.stopPropagation(); setProductDialog({ initial: p }) }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost" size="icon-sm" title="삭제"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={busyId === p.id}
                          onClick={e => { e.stopPropagation(); void handleDelete(p) }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      {/* ── 표준공수 vs 실제공수 ─────────────────────────────────────────── */}
      <SectionCard
        title="표준공수 vs 실제공수"
        hint={`실적 기반으로 표준공수를 개선하기 위한 비교 영역 · 편차율 ±${VARIANCE_THRESHOLD.warn}% 이내 정상 / ${VARIANCE_THRESHOLD.danger}% 초과 위험`}
        action={
          <Select value={period} onValueChange={v => setPeriod(v as ActualPeriodId)}>
            <SelectTrigger className="!h-9 w-full min-w-0 px-3 sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTUAL_PERIODS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      >
        {actual == null ? (
          <Skeleton className="h-24 w-full" />
        ) : !actual.hasData ? (
          <div className="py-12 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Timer className="size-4" /> 실적 데이터 없음
            </p>
            <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
              시험 수행 실적이 쌓이면 표준공수 대비 편차를 이곳에서 비교합니다.
            </p>
          </div>
        ) : (
          <>
          {/* ── 모바일: 표 대신 카드 목록 ────────────────────────────────
              시험항목명과 편차율(색)이 핵심이다. 건수·표준·실제는 잔글씨 한 줄로.
              편차 등급은 위험=빨강 · 주의=앰버 · 정상=브랜드 파랑이다. '정상'을 초록으로
              두면 브랜드색 밖으로 나가면서 '완료'와도 뜻이 겹친다. */}
          <div className="-mx-4 -my-4 divide-y md:hidden">
            {actual.rows.map(r => {
              const level = varianceLevel(r.varianceRate)
              return (
                <div key={r.key} className="px-4 py-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.label}</p>
                    <Badge
                      variant="outline"
                      className={`shrink-0 gap-1.5 font-normal tabular-nums ${
                        level === "risk" ? "border-red-200 bg-red-50 text-red-700"
                          : level === "caution" ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-blue-200 bg-blue-50 text-blue-700"
                      }`}
                    >
                      {formatVarianceRate(r.varianceRate)}
                      {level && <span>{VARIANCE_LEVEL_LABEL[level]}</span>}
                    </Badge>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal tabular-nums text-muted-foreground">
                    <span>{r.sampleCount}건</span>
                    <span className="text-border">·</span>
                    <span>표준 {formatMinutes(r.standardMinutes)}</span>
                    <span className="text-border">·</span>
                    <span>실제 {formatMinutes(r.actualAvgMinutes)}</span>
                    <span className="ml-auto">{formatVarianceMinutes(r.varianceMinutes)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── 데스크톱: 표 ───────────────────────────────────────────── */}
          <div className="hidden md:block">
          <Table>
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[12%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 text-muted-foreground">시험항목</TableHead>
                <TableHead className="px-3 text-right text-muted-foreground">건수</TableHead>
                <TableHead className="px-3 text-right text-muted-foreground">표준</TableHead>
                <TableHead className="px-3 text-right text-muted-foreground">실제 평균</TableHead>
                <TableHead className="px-3 text-right text-muted-foreground">차이</TableHead>
                <TableHead className="px-3 text-right text-muted-foreground">편차율</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actual.rows.map(r => {
                const level = varianceLevel(r.varianceRate)
                return (
                  <TableRow key={r.key} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-2.5 font-medium text-foreground">{r.label}</TableCell>
                    <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">{r.sampleCount}</TableCell>
                    <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                      {formatMinutes(r.standardMinutes)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                      {formatMinutes(r.actualAvgMinutes)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">
                      {formatVarianceMinutes(r.varianceMinutes)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right">
                      <Badge
                        variant="outline"
                        className={`gap-1.5 font-normal tabular-nums ${
                          level === "risk" ? "border-red-200 bg-red-50 text-red-700"
                            : level === "caution" ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-blue-200 bg-blue-50 text-blue-700"
                        }`}
                      >
                        {formatVarianceRate(r.varianceRate)}
                        {level && <span>{VARIANCE_LEVEL_LABEL[level]}</span>}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
          </>
        )}
      </SectionCard>

      {/* ── 상세 / 다이얼로그 ────────────────────────────────────────────── */}
      {detailProduct && (
        <WorkloadDetailSheet
          open
          product={detailProduct}
          canEdit={canEdit}
          equipmentOptions={equipmentOptions}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
          onEditProduct={() => setProductDialog({ initial: detailProduct })}
          onError={m => flash(m, "error")}
        />
      )}

      {productDialog && (
        <ProductWorkloadDialog
          key={productDialog.initial?.id ?? "add-product"}
          open
          initial={productDialog.initial}
          copySources={rows}
          onClose={() => setProductDialog(null)}
          onSaved={() => {
            const wasEdit = !!productDialog.initial
            setProductDialog(null)
            flash(wasEdit ? "수정되었습니다." : "품목 공수가 등록되었습니다.")
            void load()
          }}
          onError={m => flash(m, "error")}
        />
      )}
    </div>
  )
}

// ─── 보조 ────────────────────────────────────────────────────────────────────

/**
 * 정렬·TOP 순위용 총 소요시간(분).
 * ⚠️ 이 값은 "표준 소요일"이 아니다. 서로 다른 성격의 공수를 한 축에 세우기 위한
 * 순위 지표일 뿐이며, 일정 환산에 쓰지 않는다.
 */
function totalWorkload(p: ProductWorkload): number {
  return p.totalHumanMinutes + p.totalEquipmentMinutes + p.totalWaitingMinutes + p.totalReviewMinutes
}

function FilterSelect({
  value, onChange, placeholder, allLabel, options,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  allLabel: string
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      {/* 모바일에서는 칸을 꽉 채우고, sm 이상에서만 고정 폭 */}
      <SelectTrigger className="!h-9 w-full min-w-0 px-3 sm:w-36">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
