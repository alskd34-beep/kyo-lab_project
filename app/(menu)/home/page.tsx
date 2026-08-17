'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@frontend/components/ui/badge'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@frontend/components/ui/table'
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
import { TesterAvatar } from '@frontend/lib/tester-profiles'
import { useAuth } from '@frontend/lib/auth-context'
import { cn } from '@frontend/lib/utils'
import type { BatchSummary, BatchStatus, DashboardStats } from '@shared/pqm'

// ─── Types ────────────────────────────────────────────────────────────────────

/** /api/qc-jobs/overview 응답 중 이 화면에서 쓰는 부분 (backend listWorkerOverview) */
interface WorkerRow {
  testerId: string
  name: string
  employeeNo: string
  isActive: boolean
  pendingCount: number
  inProgress: number
  reviewing: number
  delayed: number
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_UPCOMING: BatchSummary[] = [
  { id: 1, product_code: '21081', product_name: '(사향)광동우황청심원현탁액(신)', spec: '50ML', batch_no: '26002', dosage_form: '현탁제', packaging_date: '2026-04-10', record_review_deadline: '2026-04-24', qc_completion_deadline: '2026-04-24', is_urgent: false, status: 'completed', dDayRecord: -13, dDayQc: -13, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 2, product_code: '21350', product_name: '슬라임캡슐', spec: '120C', batch_no: '26001', dosage_form: '내용고형제', packaging_date: '2026-03-30', record_review_deadline: '2026-04-27', qc_completion_deadline: '2026-04-27', is_urgent: false, status: 'completed', dDayRecord: -10, dDayQc: -10, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 3, product_code: '23263', product_name: '베니톨정', spec: '500T', batch_no: '26023', dosage_form: '내용고형제', packaging_date: '2026-04-16', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 4, product_code: '23263', product_name: '베니톨정', spec: '500T', batch_no: '26024', dosage_form: '내용고형제', packaging_date: '2026-04-16', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 5, product_code: '21391', product_name: '알도셉트정5mg', spec: '30T', batch_no: '26001-A', dosage_form: '내용고형제', packaging_date: '2026-04-06', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 6, product_code: '21080', product_name: '(사향)광동우황청심원(신)', spec: '1환', batch_no: '26010', dosage_form: '환제', packaging_date: '2026-04-25', record_review_deadline: '2026-05-07', qc_completion_deadline: '2026-05-07', is_urgent: false, status: 'pending', dDayRecord: 0, dDayQc: 0, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 7, product_code: '27045', product_name: '(베트남수출용)광동우황청심원(영묘향)', spec: '1환', batch_no: '26011', dosage_form: '환제', packaging_date: '2026-04-28', record_review_deadline: '2026-05-10', qc_completion_deadline: '2026-05-10', is_urgent: false, status: 'pending', dDayRecord: 3, dDayQc: 3, note: null, created_at: '', process_order: null, validation_type: '일반' },
]

const DEMO_STATS: DashboardStats = {
  totalBatches: 129, pending: 97, inProgress: 15, completed: 17,
  dueSoon7: 23, dueSoon3: 8, overdueCount: 5,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BatchStatus, { label: string; dot: string }> = {
  pending:     { label: '대기중', dot: 'bg-muted-foreground' },
  in_progress: { label: '진행중', dot: 'bg-violet-500' },
  completed:   { label: '완료',   dot: 'bg-emerald-500' },
  on_hold:     { label: '보류',   dot: 'bg-amber-500' },
  cancelled:   { label: '취소',   dot: 'bg-destructive' },
}

function dDayColor(dDayQc: number | null): string {
  if (dDayQc === null || dDayQc < 0) return 'text-muted-foreground'
  if (dDayQc === 0) return 'font-semibold text-destructive'
  if (dDayQc <= 3)  return 'font-medium text-destructive'
  if (dDayQc <= 7)  return 'font-medium text-amber-600'
  return 'text-emerald-600'
}

function dDayLabel(dDayQc: number | null): string {
  if (dDayQc === null) return '-'
  if (dDayQc < 0)  return `D+${Math.abs(dDayQc)}`
  if (dDayQc === 0) return 'D-Day'
  return `D-${dDayQc}`
}

// ─── Main Component ───────────────────────────────────────────────────────────

type SortField = 'product_name' | 'batch_no' | 'qc_completion_deadline' | 'dDayQc' | 'status'

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: 'product',
    label: '품목',
    fields: [
      { id: 'product_name', label: '품목명' },
      { id: 'batch_no', label: '제조번호' },
    ],
  },
  {
    key: 'deadline',
    label: '기한',
    fields: [
      { id: 'qc_completion_deadline', label: 'QC완료예정일' },
      { id: 'dDayQc', label: 'D-Day' },
    ],
  },
  sortCol('status', '상태'),
]

export default function HomePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [upcoming, setUpcoming]   = useState<BatchSummary[]>(DEMO_UPCOMING)
  const [stats, setStats]         = useState<DashboardStats>(DEMO_STATS)
  const [usingDemo, setUsingDemo] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('qc_completion_deadline')
  const [sortDir, setSortDir]     = useState<SortDir>('asc')

  // 시험자별 작업 배정 — /api/qc-jobs/overview (관리자 전용)
  const [workers, setWorkers]           = useState<WorkerRow[] | null>(null)
  const [workersError, setWorkersError] = useState<string | null>(null)

  function pickSort(field: SortField, dir: SortDir) {
    setSortField(field)
    setSortDir(dir)
  }

  const sortedData = useMemo(() => {
    return [...upcoming].sort((a, b) => {
      let cmp = 0
      if (sortField === 'dDayQc') {
        const av = a.dDayQc ?? Infinity
        const bv = b.dDayQc ?? Infinity
        cmp = av - bv
      } else {
        const av = (a[sortField] ?? '') as string
        const bv = (b[sortField] ?? '') as string
        cmp = av.localeCompare(bv, 'ko')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [upcoming, sortField, sortDir])

  const loadHomeData = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return
    setIsLoading(true)

    try {
      const [statsData, batchData] = await Promise.all([
        fetch('/api/dashboard', { signal }).then(async r => {
          if (!r.ok) throw new Error(await r.text())
          return r.json() as Promise<DashboardStats>
        }),
        fetch('/api/batches?limit=10', { signal }).then(async r => {
          if (!r.ok) throw new Error(await r.text())
          return r.json() as Promise<{ rows: BatchSummary[] }>
        }),
      ])
      if (!signal?.aborted) {
        setStats(statsData)
        setUpcoming(batchData.rows.length > 0 ? batchData.rows : DEMO_UPCOMING)
        setUsingDemo(false)
      }
    } catch {
      if (!signal?.aborted) setUsingDemo(true)
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [])

  /**
   * 시험자별 배정 현황.
   * 관리자 전용 API라 시험자 계정에서는 호출하지 않는다.
   * 위 배치 조회와 분리해 실패해도 화면 나머지에 영향을 주지 않게 한다.
   */
  const loadWorkers = useCallback(async (signal?: AbortSignal) => {
    if (!isAdmin) return
    try {
      const res = await fetch('/api/qc-jobs/overview', { credentials: 'include', signal })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '불러오기 실패')
      const data = await res.json() as { workers: WorkerRow[] }
      if (!signal?.aborted) { setWorkers(data.workers); setWorkersError(null) }
    } catch (e) {
      if (signal?.aborted) return
      // 조회 실패 시 가짜 데이터로 채우지 않고 사유를 보여준다
      setWorkers([])
      setWorkersError(e instanceof Error ? e.message : '불러오기 실패')
    }
  }, [isAdmin])

  useEffect(() => {
    const controller = new AbortController()
    const refreshAll = () => {
      void loadHomeData(controller.signal)
      void loadWorkers(controller.signal)
    }
    const refreshOnVisible = () => {
      if (!document.hidden) refreshAll()
    }

    refreshAll()

    const refreshTimer = window.setInterval(refreshAll, 60_000)

    window.addEventListener('focus', refreshOnVisible)
    document.addEventListener('visibilitychange', refreshOnVisible)

    return () => {
      controller.abort()
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshOnVisible)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [loadHomeData, loadWorkers])

  /**
   * 카드에 노출할 시험자 — 활성 시험자 중 담당 작업(진행/검토/지연 + 시작 대기)이 있는 사람만,
   * 담당량이 많은 순으로. 담당이 없는 시험자까지 늘어놓으면 "배정 현황"이 읽히지 않는다.
   */
  const assignedWorkers = useMemo(() => {
    const load = (w: WorkerRow) => w.inProgress + w.reviewing + w.delayed + w.pendingCount
    return (workers ?? [])
      .filter(w => w.isActive && load(w) > 0)
      .sort((a, b) => load(b) - load(a) || a.employeeNo.localeCompare(b.employeeNo))
  }, [workers])

  const KPI_CARDS = [
    { label: '전체 배치', value: stats.totalBatches, unit: '건', sub: '총 생산배치 수',     accent: 'text-foreground',  bar: 'border-l-primary' },
    { label: '대기중',    value: stats.pending,      unit: '건', sub: '시험 대기',          accent: 'text-foreground',  bar: 'border-l-muted-foreground' },
    { label: '진행중',    value: stats.inProgress,   unit: '건', sub: 'QC 시험 진행',       accent: 'text-violet-600',  bar: 'border-l-violet-500' },
    { label: 'QC완료',    value: stats.completed,    unit: '건', sub: '이번달 완료',        accent: 'text-emerald-600', bar: 'border-l-emerald-500' },
    { label: 'D-7 임박',  value: stats.dueSoon7,     unit: '건', sub: '기한 임박 배치',     accent: 'text-amber-600',   bar: 'border-l-amber-500' },
    { label: '기한초과',  value: stats.overdueCount, unit: '건', sub: 'QC완료예정일 초과', accent: 'text-destructive', bar: 'border-l-destructive' },
  ]

  const statRows = [
    { label: '대기중', key: 'pending' as const,    color: 'bg-muted-foreground' },
    { label: '진행중', key: 'inProgress' as const, color: 'bg-violet-500' },
    { label: '완료',   key: 'completed' as const,  color: 'bg-emerald-500' },
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">홈</h1>
        <p className="text-sm text-muted-foreground">기한 임박 배치와 오늘 시험 배정을 한눈에 봅니다.</p>
        {usingDemo && (
          <Badge variant="outline" className="border-amber-200 text-amber-700">데모 모드</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="gap-1 border-l-4 border-l-muted px-4 py-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-3 w-24" />
              </Card>
            ))
          : KPI_CARDS.map(kpi => (
              <Card key={kpi.label} className={cn('gap-1 border-l-4 px-4 py-4', kpi.bar)}>
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {kpi.label}
                </span>
                <span className={cn('text-2xl font-semibold tabular-nums', kpi.accent)}>
                  {kpi.value}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">{kpi.unit}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">{kpi.sub}</span>
              </Card>
            ))}
      </div>

      {/* ── 중단: 기한임박 배치 + 상태 요약 ──────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 min-h-0">

        <Card className="flex-[3] gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">기한 임박 배치</span>
              <Badge variant="outline" className="border-amber-200 text-amber-700">D-7 이내</Badge>
            </div>
          </div>
          <Table>
            <colgroup>
              <col className="w-[48%]" />
              <col className="w-[28%]" />
              <col className="w-[24%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {SORT_COLUMNS.map((col) => (
                  <TableHead key={col.key} className="px-3 py-2">
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
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-3 py-2"><Skeleton className="h-8 w-40" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-8 w-24" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    </TableRow>
                  ))
                : sortedData.slice(0, 10).map(row => {
                    const statusCfg = STATUS_CONFIG[row.status]
                    return (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/40">
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.product_name}
                            secondary={row.batch_no}
                            primaryClass="font-medium text-foreground"
                            title={`${row.product_name} / ${row.batch_no}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.qc_completion_deadline}
                            secondary={
                              <span className={cn('tabular-nums', dDayColor(row.dDayQc))}>
                                {dDayLabel(row.dDayQc)}
                              </span>
                            }
                            primaryClass="font-mono text-xs text-foreground"
                            title={`${row.qc_completion_deadline} ${dDayLabel(row.dDayQc)}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant="outline" className="gap-1.5">
                            <span className={cn('size-1.5 rounded-full', statusCfg.dot)} />
                            {statusCfg.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
            </TableBody>
          </Table>
        </Card>

        <Card className="flex-[2] gap-0 overflow-hidden py-0">
          <div className="border-b px-4 py-3">
            <span className="text-sm font-semibold text-foreground">배치 상태 현황</span>
          </div>
          <CardContent className="px-4 py-4">
            <div className="mb-4 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-foreground">{stats.totalBatches}</span>
              <span className="text-sm text-muted-foreground">건 총 배치</span>
            </div>
            <div className="flex flex-col gap-3">
              {statRows.map(row => {
                const count = stats[row.key]
                const pct = stats.totalBatches > 0 ? Math.round((count / stats.totalBatches) * 100) : 0
                return (
                  <div key={row.key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold tabular-nums text-foreground">{count}건</span>
                        <span className="w-7 text-right text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full transition-all', row.color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 시험자별 배정 현황 — 관리자에게만 보인다(overview API가 관리자 전용) */}
      {isAdmin && (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <span className="text-sm font-semibold text-foreground">오늘의 시험 배정 현황</span>
            {assignedWorkers.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">{assignedWorkers.length}명</Badge>
            )}
            {workersError && (
              <Badge variant="outline" className="border-amber-200 text-amber-700">조회 실패</Badge>
            )}
          </div>
          <CardContent className="px-4 py-3">
            {workers === null ? (
              <div className="flex flex-wrap items-center gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[52px] w-44 rounded-lg" />
                ))}
              </div>
            ) : workersError ? (
              <p className="py-2 text-xs text-muted-foreground">
                배정 현황을 불러오지 못했습니다. {workersError}
              </p>
            ) : assignedWorkers.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                현재 배정된 작업이 있는 시험자가 없습니다.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {assignedWorkers.map(w => {
                  const load = w.inProgress + w.reviewing + w.delayed + w.pendingCount
                  return (
                    <div
                      key={w.testerId}
                      className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3.5 py-2.5"
                    >
                      <TesterAvatar testerId={w.testerId} name={w.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {w.name}
                          <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                            {w.employeeNo}
                          </span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground">{load}</span>건 담당
                          <span className="ml-1">
                            (진행 {w.inProgress + w.reviewing + w.delayed} · 대기 {w.pendingCount})
                          </span>
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  )
}
