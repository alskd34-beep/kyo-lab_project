'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@frontend/components/ui/badge'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@frontend/components/ui/table'
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
import { AssigneeDetailModal } from '@frontend/components/schedule/assignee-detail-modal'
import { TesterAvatar, primeTesterProfileCache } from '@frontend/lib/tester-profiles'
import { cn } from '@frontend/lib/utils'
import {
  ACTIVE_JOB_STATUSES,
  CLOSED_STAGE,
  OPEN_STATUSES,
  PENDING_STATUS,
  stageStyle,
} from '@shared/qc-status'

/** 시험자 카드에 나열할 개별 작업(오더) */
interface TesterWorkItem {
  id: string
  productName: string
  batchNo: string
  status: string
  dueDate: string | null
  dDay: number | null
  isUrgent: boolean
}

interface TesterLoad {
  id: string
  name: string
  /** 착수한 작업(진행중·검토전·검토중·승인전·지연) 건수 */
  activeCount: number
  /** 배정만 되고 아직 시작 전인 '대기' 건수 */
  pendingCount: number
  /** 화면에 나열할 작업 — 착수분이 먼저, 그 뒤에 대기분 */
  items: TesterWorkItem[]
}

interface TesterApiRow {
  id: string
  name: string
  employeeNo?: string | null
  avatarUrl?: string | null
  userId?: string | null
}

interface PctOrderApiRow {
  id: string
  productName: string
  batchNo: string
  dueDate: string | null
  status: string
  isUrgent?: boolean
  assigneeTesterId: string | null
}

interface UpcomingRow {
  id: string
  productName: string
  batchNo: string
  dueDate: string | null
  dDay: number | null
  status: string
}

interface HomeStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  dueSoon7: number
  overdueCount: number
}

const EMPTY_STATS: HomeStats = {
  total: 0,
  pending: 0,
  inProgress: 0,
  completed: 0,
  dueSoon7: 0,
  overdueCount: 0,
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr)
  due.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

function dDayColor(dDay: number | null): string {
  if (dDay === null) return 'text-muted-foreground'
  if (dDay < 0) return 'font-semibold text-destructive'
  if (dDay === 0) return 'font-semibold text-destructive'
  if (dDay <= 3)  return 'font-medium text-destructive'
  if (dDay <= 7)  return 'font-medium text-amber-600'
  return 'text-emerald-600'
}

function dDayLabel(dDay: number | null): string {
  if (dDay === null) return '-'
  if (dDay < 0)  return `D+${Math.abs(dDay)}`
  if (dDay === 0) return 'D-Day'
  return `D-${dDay}`
}

function buildStats(orders: PctOrderApiRow[]): HomeStats {
  const stats = { ...EMPTY_STATS }
  stats.total = orders.length
  for (const order of orders) {
    if (order.status === '대기') stats.pending += 1
    else if (order.status === CLOSED_STAGE) stats.completed += 1
    else if (OPEN_STATUSES.has(order.status)) stats.inProgress += 1

    const dDay = calcDday(order.dueDate)
    if (dDay === null || order.status === CLOSED_STAGE) continue
    if (dDay < 0) stats.overdueCount += 1
    else if (dDay <= 7) stats.dueSoon7 += 1
  }
  return stats
}

function buildUpcoming(orders: PctOrderApiRow[]): UpcomingRow[] {
  return orders
    .map(order => ({
      id: order.id,
      productName: order.productName,
      batchNo: order.batchNo,
      dueDate: order.dueDate,
      dDay: calcDday(order.dueDate),
      status: order.status,
    }))
    .filter(row => row.status !== CLOSED_STAGE && row.dDay !== null && row.dDay >= 0 && row.dDay <= 7)
}

/** 시험자 카드에 한 번에 펼쳐 보여줄 작업 수. 넘치면 '외 N건'으로 접는다. */
const MAX_ITEMS_PER_TESTER = 4

/** 긴급 먼저, 그 다음 기한이 임박한 순. */
function byUrgencyThenDue(a: TesterWorkItem, b: TesterWorkItem): number {
  if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1
  return (a.dDay ?? Infinity) - (b.dDay ?? Infinity)
}

/**
 * 시험자별 "지금 무엇을 들고 있는가"를 만든다.
 *
 * 착수분(ACTIVE_JOB_STATUSES)을 먼저, 아직 시작 전인 '대기'를 뒤에 이어 붙인다.
 * 착수분만 나열하면 배정은 있는데 아무도 시작하지 않은 시기에 카드가 전부 비어
 * 보여, "배정이 없다"로 오독된다. 상태 배지 색으로 둘을 구분한다.
 * 종결(승인완료)·삭제 오더는 OPEN_STATUSES 에서 걸러진다.
 */
function buildTesterLoads(orders: PctOrderApiRow[], testerRows: TesterApiRow[]): TesterLoad[] {
  const byTester = new Map<string, { active: TesterWorkItem[]; pending: TesterWorkItem[] }>()

  for (const order of orders) {
    const testerId = order.assigneeTesterId
    if (!testerId || !OPEN_STATUSES.has(order.status)) continue
    if (order.status !== PENDING_STATUS && !ACTIVE_JOB_STATUSES.has(order.status)) continue

    let bucket = byTester.get(testerId)
    if (!bucket) {
      bucket = { active: [], pending: [] }
      byTester.set(testerId, bucket)
    }

    const item: TesterWorkItem = {
      id: order.id,
      productName: order.productName,
      batchNo: order.batchNo,
      status: order.status,
      dueDate: order.dueDate,
      dDay: calcDday(order.dueDate),
      isUrgent: Boolean(order.isUrgent),
    }
    if (order.status === PENDING_STATUS) bucket.pending.push(item)
    else bucket.active.push(item)
  }

  // 일이 많은 시험자를 앞으로 — 한눈에 부하가 읽히게.
  return testerRows
    .map(row => {
      const bucket = byTester.get(row.id)
      const active = (bucket?.active ?? []).sort(byUrgencyThenDue)
      const pending = (bucket?.pending ?? []).sort(byUrgencyThenDue)
      return {
        id: row.id,
        name: row.name,
        activeCount: active.length,
        pendingCount: pending.length,
        items: [...active, ...pending],
      }
    })
    .sort((a, b) =>
      b.activeCount - a.activeCount
      || b.pendingCount - a.pendingCount
      || a.name.localeCompare(b.name, 'ko'),
    )
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

type SortField = 'productName' | 'batchNo' | 'dueDate' | 'dDay' | 'status'

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: 'product',
    label: '품목',
    fields: [
      { id: 'productName', label: '품목명' },
      { id: 'batchNo', label: '제조번호' },
    ],
  },
  {
    key: 'deadline',
    label: '기한',
    fields: [
      { id: 'dueDate', label: 'QC완료예정일' },
      { id: 'dDay', label: 'D-Day' },
    ],
  },
  sortCol('status', '상태'),
]

export default function HomePage() {
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([])
  const [stats, setStats] = useState<HomeStats>(EMPTY_STATS)
  const [testers, setTesters] = useState<TesterLoad[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('dDay')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [detailTester, setDetailTester] = useState<{ id: string; name: string } | null>(null)

  const totalActive = useMemo(
    () => testers.reduce((sum, tester) => sum + tester.activeCount, 0),
    [testers],
  )

  function pickSort(field: SortField, dir: SortDir) {
    setSortField(field)
    setSortDir(dir)
  }

  const sortedData = useMemo(() => {
    return [...upcoming].sort((a, b) => {
      let cmp = 0
      if (sortField === 'dDay') {
        cmp = (a.dDay ?? Infinity) - (b.dDay ?? Infinity)
      } else {
        cmp = String(a[sortField] ?? '').localeCompare(String(b[sortField] ?? ''), 'ko')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [upcoming, sortField, sortDir])

  const loadHomeData = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return
    setIsLoading(true)

    try {
      const [orderResult, testerResult] = await Promise.allSettled([
        fetchJson<{ rows: PctOrderApiRow[] }>('/api/pct-orders', signal),
        fetchJson<{ rows: TesterApiRow[] }>('/api/testers?activeOnly=1', signal),
      ])
      if (signal?.aborted) return

      const orders = orderResult.status === 'fulfilled' ? orderResult.value.rows : []
      const testerRows = testerResult.status === 'fulfilled' ? testerResult.value.rows : []

      if (testerRows.length > 0) primeTesterProfileCache(testerRows)
      setStats(orderResult.status === 'fulfilled' ? buildStats(orders) : EMPTY_STATS)
      setUpcoming(orderResult.status === 'fulfilled' ? buildUpcoming(orders) : [])
      setTesters(buildTesterLoads(orders, testerRows))
      setLoadError(orderResult.status === 'rejected' ? '홈 데이터를 불러오지 못했습니다.' : null)
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
    { label: '전체',     value: stats.total,        unit: '건', sub: '총 QC 오더',         accent: 'text-foreground',  bar: 'border-l-primary' },
    { label: '대기중',   value: stats.pending,      unit: '건', sub: '시험 대기',          accent: 'text-foreground',  bar: 'border-l-muted-foreground' },
    { label: '진행중',   value: stats.inProgress,   unit: '건', sub: 'QC 시험 진행',       accent: 'text-blue-600',  bar: 'border-l-blue-500' },
    { label: 'QC완료',   value: stats.completed,    unit: '건', sub: '승인 완료',          accent: 'text-emerald-600', bar: 'border-l-emerald-500' },
    { label: 'D-7 임박', value: stats.dueSoon7,     unit: '건', sub: '기한 임박 오더',     accent: 'text-amber-600',   bar: 'border-l-amber-500' },
    { label: '기한초과', value: stats.overdueCount, unit: '건', sub: 'QC완료예정일 초과', accent: 'text-destructive', bar: 'border-l-destructive' },
  ]

  const statRows = [
    { label: '대기중', key: 'pending' as const,    color: 'bg-muted-foreground' },
    { label: '진행중', key: 'inProgress' as const, color: 'bg-blue-500' },
    { label: '완료',   key: 'completed' as const,  color: 'bg-emerald-500' },
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">홈</h1>
        <p className="text-sm text-muted-foreground">기한 임박 오더와 시험 배정을 한눈에 봅니다.</p>
        {loadError && (
          <Badge variant="outline" className="border-amber-200 text-amber-700">조회 실패</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
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
                <span className="text-xs leading-normal text-muted-foreground">{kpi.sub}</span>
              </Card>
            ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 min-h-0">

        <Card className="flex-[3] gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">기한 임박 오더</span>
              <Badge variant="outline" className="border-amber-200 text-amber-700">D-7 이내</Badge>
            </div>
          </div>
          <div className="flex flex-col gap-2 p-3 md:hidden">
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-16 rounded-md" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                  </div>
                ))
              : sortedData.length === 0
                ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      {loadError
                        ? `목록을 불러오지 못했습니다. ${loadError}`
                        : '마감 임박 오더가 없습니다.'}
                    </p>
                  )
                : sortedData.slice(0, 10).map(row => {
                    const statusCfg = stageStyle(row.status)
                    return (
                      <div key={row.id} className="rounded-md border bg-card p-3">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{row.productName}</p>
                            <p className="mt-0.5 text-xs leading-normal text-muted-foreground">제조번호 {row.batchNo}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0 gap-1.5">
                            <span className={cn('size-1.5 rounded-full', statusCfg.dot)} />
                            {row.status}
                          </Badge>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs leading-normal">
                          <span className="text-muted-foreground">QC 완료예정 {row.dueDate ?? '-'}</span>
                          <span className={cn('tabular-nums', dDayColor(row.dDay))}>{dDayLabel(row.dDay)}</span>
                        </div>
                      </div>
                    )
                  })}
          </div>
          <div className="hidden md:block">
          <Table>
            {/* 논리 열은 3개(품목·기한·상태)지만 자동 펼침으로 최대 5칸이 된다.
                table-fixed 에서 <col> 이 3개(합 100%)뿐이면 4·5번째 칸이 폭 0으로 접혀
                'D-Day'와 '상태'가 화면에서 사라진다. 최대 칸 수만큼 선언한다.
                칸 순서(펼침 / 합침):
                품목명 / 품목 · 제조번호 / 기한 · QC완료예정일 / 상태 · D-Day · 상태 */}
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[20%]" />
              <col className="w-[20%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
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
                      <TableCell className="px-3 py-2"><Skeleton className="h-5 w-14 rounded-md" /></TableCell>
                    </TableRow>
                  ))
                : sortedData.length === 0
                  ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={3} className="py-14 text-center text-sm text-muted-foreground">
                          {loadError
                            ? `목록을 불러오지 못했습니다. ${loadError}`
                            : '기한 임박 오더가 없습니다.'}
                        </TableCell>
                      </TableRow>
                    )
                : sortedData.slice(0, 10).map(row => {
                    const statusCfg = stageStyle(row.status)
                    return (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/40">
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.productName}
                            secondary={row.batchNo}
                            primaryClass="font-medium text-foreground"
                            title={`${row.productName} / ${row.batchNo}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.dueDate ?? '-'}
                            secondary={
                              <span className={cn('tabular-nums', dDayColor(row.dDay))}>
                                {dDayLabel(row.dDay)}
                              </span>
                            }
                            primaryClass="font-mono text-xs text-foreground"
                            title={`${row.dueDate ?? '-'} ${dDayLabel(row.dDay)}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant="outline" className="gap-1.5">
                            <span className={cn('size-1.5 rounded-full', statusCfg.dot)} />
                            {row.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
            </TableBody>
          </Table>
          </div>
        </Card>

        <Card className="flex-[2] gap-0 overflow-hidden py-0">
          <div className="border-b px-4 py-3">
            <span className="text-sm font-semibold text-foreground">오더 상태 현황</span>
          </div>
          <CardContent className="px-4 py-4">
            <div className="mb-4 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-foreground">{stats.total}</span>
              <span className="text-sm text-muted-foreground">건 총 오더</span>
            </div>
            <div className="flex flex-col gap-3">
              {statRows.map(row => {
                const count = stats[row.key]
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
                return (
                  <div key={row.key}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold tabular-nums text-foreground">{count}건</span>
                        <span className="w-7 text-right text-xs leading-normal tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-md bg-muted">
                      <div
                        className={cn('h-full rounded-md transition-all', row.color)}
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">시험자별 작업 현황</span>
            <Badge variant="outline" className="text-muted-foreground">진행중 {totalActive}건</Badge>
          </div>
          <span className="text-xs leading-normal text-muted-foreground">시험자를 클릭하면 배정 상세를 봅니다.</span>
        </div>
        <CardContent className="px-4 py-4">
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border px-3.5 py-3">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="size-8 rounded-md" />
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ))}
            </div>
          ) : testers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              등록된 시험자가 없습니다.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {testers.map(tester => (
                <button
                  key={tester.id}
                  type="button"
                  onClick={() => setDetailTester({ id: tester.id, name: tester.name })}
                  className="flex flex-col gap-2 rounded-md border bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <TesterAvatar testerId={tester.id} name={tester.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">{tester.name}</p>
                      <p className="text-xs leading-normal text-muted-foreground">
                        진행중 <span className="font-semibold text-foreground">{tester.activeCount}</span>건
                        <span className="px-1 text-border">·</span>
                        대기 <span className="font-semibold text-foreground">{tester.pendingCount}</span>건
                      </p>
                    </div>
                  </div>

                  {tester.items.length === 0 ? (
                    <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs leading-normal text-muted-foreground">
                      배정된 작업이 없습니다.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {tester.items.slice(0, MAX_ITEMS_PER_TESTER).map(item => (
                        <li
                          key={item.id}
                          className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5"
                          title={`${item.productName} / ${item.batchNo} · ${item.status} · ${item.dueDate ?? '기한 미정'}`}
                        >
                          <span className={cn('size-1.5 shrink-0 rounded-full', stageStyle(item.status).dot)} />
                          <span className="min-w-0 flex-1 truncate text-xs leading-normal text-foreground">
                            {item.productName}
                            <span className="text-muted-foreground"> / {item.batchNo}</span>
                          </span>
                          {item.isUrgent && (
                            <span className="shrink-0 rounded-md bg-destructive/10 px-1 text-xs leading-normal font-semibold text-destructive">
                              긴급
                            </span>
                          )}
                          <span className="shrink-0 text-xs leading-normal text-muted-foreground">{item.status}</span>
                          <span className={cn('w-9 shrink-0 text-right text-xs leading-normal tabular-nums', dDayColor(item.dDay))}>
                            {dDayLabel(item.dDay)}
                          </span>
                        </li>
                      ))}
                      {tester.items.length > MAX_ITEMS_PER_TESTER && (
                        <li className="px-2.5 pt-0.5 text-xs leading-normal text-muted-foreground">
                          외 {tester.items.length - MAX_ITEMS_PER_TESTER}건
                        </li>
                      )}
                    </ul>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {detailTester && (
        <AssigneeDetailModal
          testerId={detailTester.id}
          testerName={detailTester.name}
          onClose={() => setDetailTester(null)}
        />
      )}

    </div>
  )
}
