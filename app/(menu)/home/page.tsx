'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@frontend/components/ui/badge'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@frontend/components/ui/table'
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
import { TesterAvatar, primeTesterProfileCache } from '@frontend/lib/tester-profiles'
import { cn } from '@frontend/lib/utils'
import { OPEN_STATUSES } from '@shared/qc-status'
import type { BatchSummary, BatchStatus, DashboardStats } from '@shared/pqm'

interface TesterLoad {
  id: string
  name: string
  assigned: number
}

interface TesterApiRow {
  id: string
  name: string
  employeeNo?: string | null
  avatarUrl?: string | null
  userId?: string | null
}

interface PctOrderApiRow {
  assigneeTesterId: string | null
  status: string
}

const EMPTY_STATS: DashboardStats = {
  totalBatches: 0,
  pending: 0,
  inProgress: 0,
  completed: 0,
  dueSoon7: 0,
  dueSoon3: 0,
  overdueCount: 0,
}

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

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

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
  const [upcoming, setUpcoming] = useState<BatchSummary[]>([])
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [testers, setTesters] = useState<TesterLoad[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('qc_completion_deadline')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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
      const [statsResult, batchResult, testerResult, orderResult] = await Promise.allSettled([
        fetchJson<DashboardStats>('/api/dashboard', signal),
        fetchJson<{ rows: BatchSummary[] }>('/api/batches?limit=10', signal),
        fetchJson<{ rows: TesterApiRow[] }>('/api/testers?activeOnly=1', signal),
        fetchJson<{ rows: PctOrderApiRow[] }>('/api/pct-orders', signal),
      ])
      if (signal?.aborted) return

      const statsData = statsResult.status === 'fulfilled' ? statsResult.value : null
      const batchData = batchResult.status === 'fulfilled' ? batchResult.value : null
      const testerData = testerResult.status === 'fulfilled' ? testerResult.value : null
      const orderData = orderResult.status === 'fulfilled' ? orderResult.value : null

      const assignedByTester = new Map<string, number>()
      for (const order of orderData?.rows ?? []) {
        if (!order.assigneeTesterId || !OPEN_STATUSES.has(order.status)) continue
        assignedByTester.set(
          order.assigneeTesterId,
          (assignedByTester.get(order.assigneeTesterId) ?? 0) + 1,
        )
      }

      if (testerData) primeTesterProfileCache(testerData.rows)
      setStats(statsData ?? EMPTY_STATS)
      setUpcoming(batchData?.rows ?? [])
      setTesters((testerData?.rows ?? []).map(row => ({
        id: row.id,
        name: row.name,
        assigned: assignedByTester.get(row.id) ?? 0,
      })))
      setLoadError(
        [statsResult, batchResult, testerResult, orderResult].some(r => r.status === 'rejected')
          ? '홈 데이터를 불러오지 못했습니다.'
          : null,
      )
    } catch {
      if (signal?.aborted) return
      setStats(EMPTY_STATS)
      setUpcoming([])
      setTesters([])
      setLoadError('홈 데이터를 불러오지 못했습니다.')
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const refreshOnVisible = () => {
      if (!document.hidden) void loadHomeData(controller.signal)
    }

    void loadHomeData(controller.signal)

    const refreshTimer = window.setInterval(() => {
      void loadHomeData(controller.signal)
    }, 60_000)

    window.addEventListener('focus', refreshOnVisible)
    document.addEventListener('visibilitychange', refreshOnVisible)

    return () => {
      controller.abort()
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshOnVisible)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [loadHomeData])

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
        {loadError && (
          <Badge variant="outline" className="border-amber-200 text-amber-700">조회 실패</Badge>
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
                : sortedData.length === 0
                  ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={3} className="py-14 text-center text-sm text-muted-foreground">
                          {loadError
                            ? `목록을 불러오지 못했습니다. ${loadError}`
                            : '기한 임박 배치가 없습니다.'}
                        </TableCell>
                      </TableRow>
                    )
                : sortedData.slice(0, 10).map(row => {
                    const statusCfg = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.pending
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

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3">
          <span className="text-sm font-semibold text-foreground">오늘의 시험 배정 현황</span>
        </div>
        <CardContent className="px-4 py-3">
          {isLoading ? (
            <div className="flex flex-wrap items-center gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-md border bg-muted/30 px-3.5 py-2.5">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : testers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loadError ? '시험 배정 현황을 불러오지 못했습니다.' : '등록된 시험자가 없습니다.'}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {testers.map(tester => (
                <div
                  key={tester.id}
                  className="flex items-center gap-2.5 rounded-md border bg-muted/30 px-3.5 py-2.5"
                >
                  <TesterAvatar testerId={tester.id} name={tester.name} size="md" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{tester.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      배정 <span className="font-semibold text-foreground">{tester.assigned}</span>건
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
