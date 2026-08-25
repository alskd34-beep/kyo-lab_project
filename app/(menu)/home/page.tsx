'use client'

/* Hallmark · macrostructure: Workbench · genre: modern-minimal · tone: utilitarian
 * theme: project-locked (Pretendard · blue ramp oklch(.. .. 262.88) · rounded-md)
 * 읽는 순서를 화면 순서로 삼는다 — ①지금 급한 것 ②전체 모양 ③임박 목록 ④사람별 부하.
 * enrichment: none (typography only) · motion: hover 색 전환만
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TesterHome } from '@frontend/components/home/tester-home'
import { useAuth } from '@frontend/lib/auth-context'
import { Badge } from '@frontend/components/ui/badge'
import { Card } from '@frontend/components/ui/card'
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
  /* amber-600 은 흰 배경에서 3.2:1 이라 본문 기준(4.5:1)에 못 미친다.
     한 단 내려 대비를 확보하고, 다크에서는 반대로 올린다. */
  if (dDay <= 7)  return 'font-medium text-amber-700 dark:text-amber-400'
  /* 여유 있는 건은 색을 빼고 중립으로 둔다. 초록으로 칠하면 화면 대부분이
     초록이 되어 정작 급한 빨강·앰버가 묻히고, 브랜드 색에서도 벗어난다. */
  return 'text-muted-foreground'
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

/**
 * 관리자 홈 — 팀 전체 지표. 예전 화면 그대로다.
 * 시험자는 개인 대시보드(TesterHome)를 본다.
 */
function AdminHome() {

  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([])
  const [stats, setStats] = useState<HomeStats>(EMPTY_STATS)
  const [testers, setTesters] = useState<TesterLoad[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('dDay')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [detailTester, setDetailTester] = useState<{ id: string; name: string } | null>(null)
  /** 마지막으로 데이터를 받은 시각(HH:MM). 화면이 1분마다 조용히 갱신되므로 머리말에 적는다. */
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)

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
      if (orderResult.status === 'fulfilled') {
        setRefreshedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
      }
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

  /** 이 화면이 가장 먼저 답해야 할 질문 — 지금 손대야 할 오더가 몇 건인가. */
  const alerts = [
    {
      label: '기한초과',
      value: stats.overdueCount,
      hint: 'QC완료예정일이 지났습니다',
      tone: stats.overdueCount > 0 ? 'text-destructive' : 'text-muted-foreground',
    },
    {
      label: 'D-7 임박',
      value: stats.dueSoon7,
      hint: '7일 안에 완료해야 합니다',
      tone: stats.dueSoon7 > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
    },
  ]

  /**
   * 전체 오더 구성.
   *
   * 상태별 막대를 따로 그리면 각 막대가 전체 대비 비율이라 합이 100% 가 되지 않고,
   * 남은 빈 칸이 무엇인지 알 수 없어 비율을 오독시킨다. 세 상태로 나뉘지 않는
   * 나머지(삭제 등)를 '기타'로 남겨 **막대 하나가 전체를 정확히 채우게** 한다.
   * 색은 상태 배지와 같은 파랑 램프(농도 = 진척도)를 그대로 쓴다.
   */
  const etcCount = Math.max(0, stats.total - stats.pending - stats.inProgress - stats.completed)
  const composition = [
    { label: '대기중', value: stats.pending,    bar: 'bg-slate-400' },
    { label: '진행중', value: stats.inProgress, bar: 'bg-blue-500' },
    { label: 'QC완료', value: stats.completed,  bar: 'bg-blue-800' },
    ...(etcCount > 0 ? [{ label: '기타', value: etcCount, bar: 'bg-slate-200' }] : []),
  ]
  const share = (value: number) => (stats.total > 0 ? (value / stats.total) * 100 : 0)

  /**
   * 범례에 적을 백분율. 조각마다 따로 반올림하면 합이 101% 가 되기도 한다 —
   * 내림한 뒤 남는 몫을 소수부가 큰 조각부터 하나씩 나눠 줘 **합이 정확히 100** 이 되게 한다.
   */
  const sharePcts = (() => {
    if (stats.total === 0) return composition.map(() => 0)
    const raw = composition.map(seg => share(seg.value))
    const out = raw.map(Math.floor)
    const rest = 100 - out.reduce((sum, n) => sum + n, 0)
    const byFraction = raw
      .map((value, i) => ({ frac: value - Math.floor(value), i }))
      .sort((a, b) => b.frac - a.frac)
    for (let k = 0; k < rest; k += 1) out[byFraction[k % byFraction.length].i] += 1
    return out
  })()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-6">
      {/* ── 페이지 머리 ─────────────────────────────────────────────────────
          부제 대신 "언제 기준 데이터인가"를 적는다. 1분마다 조용히 다시 불러오는
          화면이라 갱신 시각이야말로 머리말이 실어야 할 사실이다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-foreground">홈</h1>
        {isLoading && !refreshedAt ? (
          <Skeleton className="h-3 w-44" />
        ) : (
          <p
            className={cn(
              'text-xs leading-normal tabular-nums',
              loadError ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {loadError ?? `${refreshedAt} 기준 · 1분마다 자동 갱신`}
          </p>
        )}
      </header>

      {/* ── 조치가 필요한 수 + 전체 구성 ────────────────────────────────────
          왼쪽은 "지금 손대야 할 것"(기한초과·임박), 오른쪽은 "전체가 어떤 모양인가".
          여섯 칸을 똑같은 크기로 늘어놓으면 무엇이 급한지 화면이 말해 주지 못한다. */}
      {/* shrink-0: Card 는 overflow-hidden 이라 flex 열 안에서 min-height 가 0 이 된다.
          내용이 세로로 넘치는 순간 카드가 선 하나로 찌부러지므로 줄어들지 않게 못 박는다. */}
      <Card className="shrink-0 gap-0 py-0">
        <div className="flex flex-col divide-y lg:flex-row lg:divide-x lg:divide-y-0">
          {/* 이 카드는 홈의 본문이다 — 접지 않는다. 대신 눕혀서 줄인다.
              375px 에서 이 한 장이 290px, 화면의 절반을 먹어 아래 「기한 임박 오더」를
              y=376 까지 밀어냈다. 숫자 한 단(4xl→3xl)과 설명 한 줄을 모바일에서 덜어낸다. */}
          <div className="grid grid-cols-2 gap-5 px-4 py-3 md:px-5 md:py-4 lg:w-[38%] lg:shrink-0">
            {isLoading
              ? Array.from({ length: 2 }).map((_, i) => (
                  /* 뼈대도 실제 타일과 같은 모양으로 — 모바일에는 설명 줄이 없다 */
                  <div key={i} className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-7 w-16 sm:h-9" />
                    <Skeleton className="hidden h-3 w-32 sm:block" />
                  </div>
                ))
              : alerts.map(alert => (
                  <div key={alert.label} className="flex min-w-0 flex-col">
                    <span className="text-xs font-medium text-muted-foreground">{alert.label}</span>
                    <span className={cn('mt-0.5 text-3xl font-semibold tabular-nums sm:text-4xl', alert.tone)}>
                      {alert.value}
                      <span className="ml-1 text-sm font-medium text-muted-foreground">건</span>
                    </span>
                    {/* 설명 줄은 모바일에서 접는다 — 좁은 2열에서 두 줄로 늘어지는데,
                        '기한초과'·'D-7 임박'이라는 라벨이 이미 같은 말을 하고 있다.
                        break-keep: 한글은 단어 중간에서 끊으면 안 읽힌다("지났습/니다") */}
                    <span className="mt-1 hidden text-xs leading-normal break-keep text-muted-foreground sm:block">
                      {alert.hint}
                    </span>
                  </div>
                ))}
          </div>

          <div className="min-w-0 flex-1 px-4 py-3 md:px-5 md:py-4">
            {isLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">전체 오더</span>
                  <span className="text-xl font-semibold tabular-nums text-foreground">{stats.total}</span>
                  <span className="text-xs text-muted-foreground">건</span>
                </div>
                <div
                  className="mt-2.5 flex h-2 w-full overflow-hidden rounded-md bg-muted"
                  role="img"
                  aria-label={composition.map(seg => `${seg.label} ${seg.value}건`).join(', ')}
                >
                  {composition.map(seg => (
                    <div key={seg.label} className={cn('h-full', seg.bar)} style={{ width: `${share(seg.value)}%` }} />
                  ))}
                </div>
                <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
                  {composition.map((seg, i) => (
                    <div key={seg.label} className="flex min-w-0 items-center gap-1.5">
                      <span className={cn('size-1.5 shrink-0 rounded-full', seg.bar)} />
                      <dt className="text-xs text-muted-foreground">{seg.label}</dt>
                      <dd className="text-xs font-semibold tabular-nums text-foreground">
                        {seg.value}
                        <span className="ml-0.5 font-normal text-muted-foreground">({sharePcts[i]}%)</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── 기한 임박 오더 ─────────────────────────────────────────────── */}
      <Card className="shrink-0 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">기한 임박 오더</h2>
          <p className="text-xs leading-normal break-keep text-muted-foreground">
            QC완료예정일 D-7 이내
            {!isLoading && !loadError && (
              <>
                <span className="px-1 text-border">·</span>
                <span className="tabular-nums">{sortedData.length}</span>건
              </>
            )}
          </p>
        </div>

        {/* 모바일 — 칸마다 테두리를 두르는 대신 실선 하나로 나눈다(카드 안 카드 금지) */}
        <div className="divide-y md:hidden">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))
            : sortedData.length === 0
              ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {loadError ? '목록을 불러오지 못했습니다.' : '기한 임박 오더가 없습니다.'}
                  </p>
                )
              : sortedData.slice(0, 10).map(row => {
                  const statusCfg = stageStyle(row.status)
                  return (
                    <div key={row.id} className="px-4 py-3">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {row.productName}
                        </p>
                        <span className={cn('shrink-0 text-sm tabular-nums', dDayColor(row.dDay))}>
                          {dDayLabel(row.dDay)}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                        <span className="inline-flex shrink-0 items-center gap-1.5">
                          <span className={cn('size-1.5 rounded-full', statusCfg.dot)} />
                          {row.status}
                        </span>
                        <span className="min-w-0 truncate">제조번호 {row.batchNo}</span>
                        <span className="ml-auto shrink-0 tabular-nums">{row.dueDate ?? '-'}</span>
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
            {/* 표가 전체 폭을 쓰게 되면서 품목명에 자리를 더 준다 — 제조번호·날짜는
                고정 길이(KD26103 / 2026-08-24)라 남는 폭이 그냥 빈 칸이었다. */}
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[14%]" />
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
                          {loadError ? '목록을 불러오지 못했습니다.' : '기한 임박 오더가 없습니다.'}
                        </TableCell>
                      </TableRow>
                    )
                : sortedData.slice(0, 10).map(row => {
                    const statusCfg = stageStyle(row.status)
                    return (
                      /* 눌러도 열리는 화면이 없는 행이다 — 손가락 커서는 달지 않는다. */
                      <TableRow key={row.id} className="hover:bg-muted/40">
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

      {/* ── 시험자별 작업 현황 ──────────────────────────────────────────────
          카드 안에 카드를 또 넣지 않는다. 바깥 테두리를 걷어내고 제목 밑 실선만
          남겨, 테두리를 가진 층이 시험자 타일 하나뿐이 되게 한다. */}
      <section className="flex min-w-0 shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
          <h2 className="text-sm font-semibold text-foreground">시험자별 작업 현황</h2>
          {isLoading ? (
            <Skeleton className="h-3 w-56" />
          ) : (
            <p className="text-xs leading-normal break-keep text-muted-foreground">
              진행중 <span className="font-semibold tabular-nums text-foreground">{totalActive}</span>건
              <span className="px-1 text-border">·</span>
              시험자를 누르면 배정 상세를 봅니다
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col rounded-md border">
                <div className="flex items-center gap-2.5 px-3.5 py-3">
                  <Skeleton className="size-8 rounded-md" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-16" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 border-t px-3.5 py-2.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : testers.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {loadError ? '시험자를 불러오지 못했습니다.' : '등록된 시험자가 없습니다.'}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {testers.map(tester => (
              <button
                key={tester.id}
                type="button"
                onClick={() => setDetailTester({ id: tester.id, name: tester.name })}
                /* min-w-0: 그리드 칸의 기본 최소폭은 내용 크기라, 긴 품목명 한 줄이
                   칸을 화면 밖까지 밀어낸다. 0 으로 낮춰야 안쪽 truncate 가 동작한다. */
                className="flex min-w-0 flex-col rounded-md border bg-card text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex min-w-0 items-center gap-2.5 px-3.5 py-3">
                  <TesterAvatar testerId={tester.id} name={tester.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{tester.name}</p>
                    <p className="text-xs leading-normal text-muted-foreground">
                      진행중 <span className="font-semibold tabular-nums text-foreground">{tester.activeCount}</span>건
                      <span className="px-1 text-border">·</span>
                      대기 <span className="font-semibold tabular-nums text-foreground">{tester.pendingCount}</span>건
                    </p>
                  </div>
                </div>

                {tester.items.length === 0 ? (
                  <p className="border-t px-3.5 py-2.5 text-xs leading-normal text-muted-foreground">
                    배정된 작업이 없습니다.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 border-t px-3.5 py-2.5">
                    {tester.items.slice(0, MAX_ITEMS_PER_TESTER).map(item => (
                      <li
                        key={item.id}
                        className="flex items-center gap-1.5"
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
                      <li className="pt-0.5 text-xs leading-normal text-muted-foreground">
                        외 {tester.items.length - MAX_ITEMS_PER_TESTER}건
                      </li>
                    )}
                  </ul>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

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

/**
 * 홈은 역할에 따라 다른 화면이다.
 *   - 관리자: 팀 전체 지표(AdminHome) — 기존 화면을 그대로 유지한다.
 *   - 시험자: 내 작업과 팀 휴가를 중심으로 한 개인 대시보드(TesterHome).
 */
export default function HomePage() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 md:gap-5 md:p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return user?.role === 'admin' ? <AdminHome /> : <TesterHome />
}
