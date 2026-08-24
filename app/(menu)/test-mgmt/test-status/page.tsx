'use client'

import { useState, useEffect, useMemo } from 'react'
import type { StatusKey, TestRow, KpiItem } from '@shared/qc'
import { Button } from '@frontend/components/ui/button'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { DateRangeField } from '@frontend/components/ui/date-range-field'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useTableColSpan,
} from '@frontend/components/ui/table'
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
import { TesterAvatar } from '@frontend/lib/tester-profiles'
import { useAuth } from '@frontend/lib/auth-context'
import { TestDetailDrawer } from '@frontend/components/test-mgmt/test-detail-drawer'
import { format, subMonths } from 'date-fns'
import {
  Star,
  Filter,
  Download,
  Search,
  Pin,
  PinOff,
  X,
  Eye,
} from 'lucide-react'

// ─── Static Data ──────────────────────────────────────────────────────────────
const ALL_TABS = ['시험현황', '제품시험', '안정성시험', '일탈관리'] as const

const STATUS_CONFIG: Record<StatusKey, { label: string; cls: string }> = {
  waiting:    { label: '시작대기', cls: 'bg-slate-50 text-slate-600 border border-slate-200' },
  inprogress: { label: '진행중',   cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  prereview:  { label: '검토대기', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  reviewing:  { label: '검토중',   cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  // 승인대기는 파랑 램프의 '승인전'이다(types/qc-status.ts STAGE_STYLE 과 같은 값)
  pending:    { label: '승인대기', cls: 'bg-blue-100/60 text-blue-800 border border-blue-300' },
  completed:  { label: '적합완료', cls: 'bg-blue-100 text-blue-900 border border-blue-400' },
  fail:       { label: '부적합',   cls: 'bg-red-50 text-red-700 border border-red-200' },
}

/**
 * 상태 배지 조회. 서버가 예상 밖의 상태를 내려도 화면이 죽지 않게 기본값을 둔다
 * (`@shared/qc-status` 의 `stageStyle()` 과 같은 방어). 예전에는 `STATUS_CONFIG[row.status]`
 * 를 바로 읽어, 키가 하나만 어긋나도 페이지 전체가 흰 화면이 됐다.
 */
function statusConfig(key: string): { label: string; cls: string } {
  return STATUS_CONFIG[key as StatusKey]
    ?? { label: key || '-', cls: 'bg-muted text-muted-foreground border' }
}

/**
 * KPI 카드 배열 — 조회된 실제 행의 진행상태를 집계해 만든다(고정값 없음).
 *
 * 예전에는 카드마다 파스텔 배경(`bg-*-50/60`)과 같은 계열 테두리를 둘러 일곱 장이 각각
 * 다른 색 타일이었다. 색 일곱 개가 나란히 서면 그것부터 눈에 들어와 정작 숫자가 뒤로 밀린다.
 * 카드는 전부 같은 흰 배경·같은 테두리로 두고, **색은 상태 점과 숫자 잉크에만** 남긴다
 * — 색이 의미(진행상태)를 나르는 자리는 그대로 지키면서 화면은 한 겹 조용해진다.
 * `bg` 필드는 이제 카드 배경이 아니라 라벨 앞 상태 점 색이고, `border` 는 전부 같은 값이다
 * (`KpiItem` 이 `@shared/qc` 의 공유 타입이라 필드 자체를 없애지는 않았다).
 */
function buildKpis(rows: TestRow[]): KpiItem[] {
  const by = (s: StatusKey) => rows.filter(r => r.status === s).length
  return [
    { label: '전체시험', value: String(rows.length),     unit: '건', sub: '조회 기간 전체', accent: 'text-foreground',        bg: 'bg-foreground',  border: 'border' },
    { label: '시작대기', value: String(by('waiting')),    unit: '건', sub: '배정 후 미착수', accent: 'text-muted-foreground',  bg: 'bg-slate-400',   border: 'border' },
    { label: '진행중',   value: String(by('inprogress')), unit: '건', sub: '처리 진행 중',   accent: 'text-blue-600',          bg: 'bg-blue-500',    border: 'border' },
    { label: '검토',     value: String(by('prereview') + by('reviewing')), unit: '건', sub: '검토대기·검토중', accent: 'text-blue-600', bg: 'bg-blue-600', border: 'border' },
    { label: '승인대기', value: String(by('pending')),    unit: '건', sub: '검토 후 승인 대기', accent: 'text-blue-800',       bg: 'bg-blue-700',    border: 'border' },
    { label: '완료',     value: String(by('completed')),  unit: '건', sub: '승인 완료',      accent: 'text-blue-900',          bg: 'bg-blue-800',    border: 'border' },
    { label: '부적합',   value: String(by('fail')),       unit: '건', sub: '기준 이탈',      accent: 'text-red-600',           bg: 'bg-red-500',     border: 'border' },
  ]
}

// ─── Types ────────────────────────────────────────────────────────────────────
type SortField = keyof Pick<TestRow, 'category' | 'type' | 'product' | 'testNo' | 'items' | 'contractor' | 'manager' | 'receiveDate' | 'dueDate' | 'status'>

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: 'product',
    label: '품목',
    fields: [
      { id: 'product', label: '제품명' },
      { id: 'type', label: '유형' },
    ],
  },
  {
    key: 'test',
    label: '시험',
    fields: [
      { id: 'testNo', label: '시험번호' },
      { id: 'items', label: '시험항목' },
    ],
  },
  {
    key: 'owner',
    label: '담당',
    fields: [
      { id: 'manager', label: '담당자' },
      { id: 'contractor', label: '수탁사' },
    ],
  },
  {
    key: 'schedule',
    label: '일정',
    fields: [
      { id: 'receiveDate', label: '접수일' },
      { id: 'dueDate', label: '완료예정일' },
    ],
  },
  sortCol('status', '진행상태'),
]

/** 빈 상태/로딩 행 — 쌍이 펼쳐지면 칸 수가 달라지므로 colSpan 을 표에서 받아 쓴다. */
function FullWidthCell({ children }: { children: React.ReactNode }) {
  const colSpan = useTableColSpan()
  return (
    <TableCell colSpan={colSpan} className="py-14 text-center text-sm break-keep text-muted-foreground">
      {children}
    </TableCell>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TestStatusPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab]         = useState<string>('시험현황')
  const [pinnedTabs, setPinnedTabs]       = useState<Set<string>>(new Set(['시험현황', '제품시험']))
  const [closedTabs, setClosedTabs]       = useState<Set<string>>(new Set())
  const [stickyHeader, setStickyHeader]   = useState(true)
  const [selectedRows, setSelectedRows]   = useState<Set<number>>(new Set())
  const [searchValue, setSearchValue]     = useState('')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')

  useEffect(() => {
    // 서버·클라이언트 타임존 차이로 인한 하이드레이션 불일치를 피하려 마운트 후(클라이언트)에만 기본 기간 설정
    const today = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 시각 동기화(마운트 1회)
    setDateFrom(format(subMonths(today, 1), 'yyyy-MM-dd'))
    setDateTo(format(today, 'yyyy-MM-dd'))
  }, [])
  const [tableData, setTableData]         = useState<TestRow[]>([])
  const [isLoading, setIsLoading]         = useState(true)
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [sortField, setSortField]         = useState<SortField>('dueDate')
  const [sortDir, setSortDir]             = useState<SortDir>('asc')
  // 미리보기 패널 — 행을 클릭하면 열린다(디자인 표준: 행 클릭 → Sheet)
  const [previewRow, setPreviewRow]       = useState<TestRow | null>(null)
  const [previewOpen, setPreviewOpen]     = useState(false)
  // 상태를 바꾸면 목록을 다시 읽어야 진행상태·KPI 가 맞는다
  const [reloadKey, setReloadKey]         = useState(0)

  // ─── Fetch from API — 실제 DB 데이터만 표시한다(데모/목업 폴백 없음) ────────
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to',   dateTo)
    if (searchValue)     params.set('search', searchValue)

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 데이터 페치(외부 시스템) 시작 시 로딩 표시
    setIsLoading(true)
    fetch(`/api/tests?${params.toString()}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: TestRow[] }>
      })
      .then(({ rows }) => {
        if (cancelled) return
        setTableData(rows)
        setLoadError(null)
      })
      .catch(err => {
        if (cancelled) return
        // 조회 실패 시 가짜 데이터로 채우지 않고 빈 목록 + 사유를 보여준다.
        setTableData([])
        setLoadError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.')
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })

    return () => { cancelled = true }
  }, [dateFrom, dateTo, searchValue, reloadKey])

  const toggleTab = (tab: string) => {
    setPinnedTabs(prev => {
      const next = new Set(prev)
      next.has(tab) ? next.delete(tab) : next.add(tab)
      return next
    })
  }

  const toggleRow = (id: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const openPreview = (row: TestRow) => {
    setPreviewRow(row)
    setPreviewOpen(true)
  }

  const toggleAll = () => {
    setSelectedRows(selectedRows.size === tableData.length ? new Set() : new Set(tableData.map(r => r.id)))
  }

  // 검색·기간 필터는 서버(/api/tests)에서 이미 적용되어 내려온다.
  const filtered = tableData

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  const sortedData = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      const cmp = av.localeCompare(bv, 'ko')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortField, sortDir])

  const kpis = useMemo(() => buildKpis(sortedData), [sortedData])

  const closeTab = (tab: string) => {
    setClosedTabs(prev => {
      const next = new Set(prev)
      next.add(tab)
      return next
    })
    if (activeTab === tab) {
      const remaining = ALL_TABS.filter(t => t !== tab && !closedTabs.has(t))
      if (remaining.length > 0) setActiveTab(remaining[0])
    }
  }

  // Sorted tabs: pinned first, then rest. Hide closed tabs.
  const sortedTabs = [
    ...ALL_TABS.filter(t => pinnedTabs.has(t) && !closedTabs.has(t)),
    ...ALL_TABS.filter(t => !pinnedTabs.has(t) && !closedTabs.has(t)),
  ]

  return (
    <>
      {/* ── Scrollable body ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-x-hidden">

          {/* ── KPI + Tab header (optionally sticky) ───────────────────────
              반응형: 고정은 md 이상에서만 건다. 320px 에서는 KPI 7장이 2열 × 4줄로 쌓여
              탭까지 합치면 머리말만 320px 가 넘는다 — 화면 절반을 늘 덮고 있게 된다.
              모바일에서는 머리말이 같이 스크롤돼 올라가는 편이 맞다. */}
          <div className={`bg-card border-b shadow-sm z-10 ${stickyHeader ? 'md:sticky md:top-0' : ''}`}>

            {/* Tabs
                반응형: 탭 줄은 원래도 가로 스크롤이지만, 좌우 여백을 모바일에서 줄이고
                (px-4 md:px-5) 스크롤이 띠 안에서만 일어나도록 overscroll 을 묶는다. */}
            <div className="flex min-w-0 items-center gap-0 border-b px-4 md:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto overscroll-x-contain scrollbar-none">
                {sortedTabs.map(tab => {
                  const isPinned = pinnedTabs.has(tab)
                  const isActive = activeTab === tab
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`
                        group relative flex shrink-0 items-center gap-0.5 py-1.5 pr-1.5 pl-3 text-sm font-medium whitespace-nowrap transition-colors md:gap-1.5 md:py-3 md:pr-2 md:pl-4
                        ${isActive
                          ? 'text-blue-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-600 after:rounded-t-md'
                          : 'text-muted-foreground hover:text-foreground'}
                      `}
                    >
                      <span>{tab}</span>
                      {/* '일탈관리' 탭에 붙어 있던 빨간 카운트 배지 3 을 뺐다 —
                          어디에서도 세지 않는 고정 숫자였다. 없는 숫자는 짓지 않는다. */}
                      {/* Pin / Star toggle */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); toggleTab(tab) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleTab(tab)
                          }
                        }}
                        title={isPinned ? '즐겨찾기 해제' : '즐겨찾기'}
                        aria-label={`${tab} ${isPinned ? '즐겨찾기 해제' : '즐겨찾기'}`}
                        /* 터치 대응: 손가락으로 누를 수 있게 클릭 영역을 size-7(≈32px)로 키우고,
                           hover 가 없는 기기에서도 보이게 모바일에서는 처음부터 잉크를 준다.
                           text-transparent(호버해야 나타남)는 md 이상에서만 쓴다. */
                        className={`
                          inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-6
                          ${isPinned
                            ? 'text-amber-400 hover:text-amber-500'
                            : 'text-muted-foreground/50 md:text-transparent md:group-hover:text-muted-foreground/50 hover:!text-amber-400'}
                        `}
                      >
                        <Star size={13} fill={isPinned ? 'currentColor' : 'none'} />
                      </span>
                      {/* Close (X) button */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); closeTab(tab) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            closeTab(tab)
                          }
                        }}
                        title="탭 닫기"
                        aria-label={`${tab} 탭 닫기`}
                        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:!bg-muted hover:!text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-6 md:text-transparent md:group-hover:text-muted-foreground"
                      >
                        <X size={13} />
                      </span>
                    </button>
                  )
                })}
              </div>
              {/* Sticky header toggle — moved here from global header */}
              <button
                onClick={() => setStickyHeader(p => !p)}
                title={stickyHeader ? '헤더 고정 해제' : '헤더 고정'}
                aria-label={stickyHeader ? '헤더 고정 해제' : '헤더 고정'}
                aria-pressed={stickyHeader}
                /* 머리말 고정은 md 이상에서만 동작하므로 버튼도 md 부터 보인다 —
                   모바일에 눌러도 아무 일이 없는 버튼을 남겨 두지 않는다. */
                className={`ml-2 hidden h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:inline-flex ${
                  stickyHeader
                    ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                    : 'bg-card text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {stickyHeader ? <Pin size={13} /> : <PinOff size={13} />}
                <span>헤더 {stickyHeader ? '고정' : '해제'}</span>
              </button>
            </div>

            {/* KPI Cards
                눌러도 아무 데도 가지 않는 카드였다 — cursor-pointer 와 hover 로 떠오르는 연출
                (-translate-y + shadow)을 걷어냈다. 손가락 커서는 실제로 열리는 것이 있을 때만 쓴다.
                min-w-0: 일곱 칸 그리드에서 칸의 최소폭은 내용 크기라, '검토대기·검토중' 같은
                부가설명 한 줄이 칸을 화면 밖까지 밀어낸다. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5 px-4 md:px-5 py-3">
              {kpis.map(kpi => (
                <Card
                  key={kpi.label}
                  className={`min-w-0 bg-card ${kpi.border} shadow-none rounded-md py-0`}
                >
                  <CardContent className="px-3.5 py-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={`size-1.5 shrink-0 rounded-full ${kpi.bg}`} />
                      <p className="min-w-0 truncate text-xs leading-normal font-medium text-muted-foreground">{kpi.label}</p>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-0.5">
                      <span className={`text-xl font-semibold tabular-nums ${kpi.accent}`}>{kpi.value}</span>
                      <span className="ml-0.5 text-xs font-medium text-muted-foreground">{kpi.unit}</span>
                    </div>
                    {/* break-keep: 한글은 단어 중간에서 끊으면 안 읽힌다 */}
                    <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">{kpi.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* ── Table section ────────────────────────────────────────────── */}
          <div className="flex-1 p-4 md:p-5">
            {/* 색은 하드코딩한 slate 계열 대신 시맨틱 토큰(bg-card · border · muted-foreground)으로 통일했다.
                다른 화면과 같은 잉크를 쓰게 되어 한 사람이 만든 화면처럼 읽힌다. */}
            <Card className="shadow-none rounded-md gap-0 py-0 overflow-hidden">

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                {/* 기간 필터 — 앱 공통 표준 컴포넌트를 쓴다(직접 조립 금지). */}
                <DateRangeField
                  startDate={dateFrom}
                  endDate={dateTo}
                  onChange={(from, to) => { setDateFrom(from); setDateTo(to) }}
                  className="w-full sm:w-auto"
                />

                {/* Search */}
                {/* transition-all → transition-colors: 실제로 바뀌는 건 테두리·링 색뿐이다.
                    전 속성 전환은 폭·높이까지 애니메이션 대상으로 삼아 입력할 때 흔들린다. */}
                <div className="flex min-w-0 w-full items-center gap-2 rounded-md border bg-card px-3 py-1.5 transition-colors focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 sm:w-auto sm:flex-1 sm:max-w-[240px]">
                  <Search size={13} className="shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="제품명, 시험번호, 담당자..."
                    value={searchValue}
                    onChange={e => setSearchValue(e.target.value)}
                    className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>

                <Button size="sm" className="h-7 px-4 text-xs font-medium rounded-md shadow-none">
                  조회
                </Button>

                <div className="flex items-center gap-1.5 sm:ml-auto">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs text-muted-foreground rounded-md shadow-none">
                    <Filter size={12} />
                    필터
                  </Button>
                  {/* 'Excel 은 초록'이라는 관습뿐 뜻이 없던 색이다 — 옆의 필터 버튼과 같은 무게로 맞춘다 */}
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs text-muted-foreground rounded-md shadow-none">
                    <Download size={12} />
                    Excel
                  </Button>
                </div>
              </div>

              {/* Mobile card view */}
              <div className="md:hidden flex flex-col gap-2 p-3">
                {isLoading ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="space-y-3 rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-4 w-40" />
                        </div>
                        <Skeleton className="h-5 w-14" />
                      </div>
                      <Skeleton className="h-3 w-28" />
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))
                ) : sortedData.length === 0 ? (
                  <p className="py-12 text-center text-sm break-keep text-muted-foreground">
                    {loadError
                      ? `목록을 불러오지 못했습니다. ${loadError}`
                      : '조회 조건에 해당하는 시험이 없습니다.'}
                  </p>
                ) : (
                  sortedData.map(row => {
                    const status = statusConfig(row.status)
                    const isSelected = selectedRows.has(row.id)
                    return (
                      <div
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openPreview(row)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreview(row) }
                        }}
                        className={`cursor-pointer rounded-md border p-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                          isSelected ? 'border-blue-200 bg-blue-50/60' : 'bg-card hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row.id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`${row.testNo} ${row.product} 선택`}
                            className="cb-custom mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs leading-normal font-medium ${
                                row.category === '완제품' ? 'bg-muted text-muted-foreground' : 'bg-blue-50 text-blue-700'
                              }`}>{row.category}</span>
                              <span className="text-xs leading-normal text-muted-foreground">{row.type}</span>
                              <span className={`ml-auto inline-flex items-center rounded-md px-2 py-0.5 text-xs leading-normal font-semibold ${status.cls}`}>
                                {status.label}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium text-foreground">{row.product}</p>
                            <p className="font-mono text-xs leading-normal text-muted-foreground">{row.testNo}</p>
                            <p className="mt-1 truncate text-xs leading-normal text-muted-foreground">{row.items}</p>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <TesterAvatar name={row.manager} size="xs" />
                                <span className="truncate text-xs leading-normal text-foreground">{row.manager}</span>
                              </div>
                              <span className="shrink-0 font-mono text-xs leading-normal tabular-nums text-muted-foreground">~{row.dueDate}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Table (desktop) */}
              <div className="hidden md:block">
              {/* colgroup 고정폭 금지 — 쌍이 펼쳐지면 칸 수가 늘어나 폭 배분이 어긋난다.
                  폭은 Table 이 헤더·셀 자수로 계산한다. (docs/table-adaptive-columns.md)
                  pinLastColumn={false} — 마지막 칸이 관리 아이콘이 아니라 진행상태 배지라
                  기본값(48px 고정)이면 배지가 잘린다. */}
              <Table pinLastColumn={false}>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-transparent">
                    <TableHead className="w-10 px-3">
                      <input
                        type="checkbox"
                        checked={selectedRows.size === tableData.length && tableData.length > 0}
                        onChange={toggleAll}
                        aria-label="전체 선택"
                        className="cb-custom"
                      />
                    </TableHead>
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
                  {isLoading && Array.from({ length: 7 }, (_, index) => (
                    <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                      <TableCell className="px-3 py-3"><Skeleton className="size-4" /></TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-36" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="px-3 py-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="px-3 py-3"><Skeleton className="h-5 w-14" /></TableCell>
                    </TableRow>
                  ))}
                  {(!isLoading && sortedData.length === 0) && (
                    <TableRow className="hover:bg-transparent">
                      <FullWidthCell>
                        {loadError
                          ? `목록을 불러오지 못했습니다. ${loadError}`
                          : '조회 조건에 해당하는 시험이 없습니다.'}
                      </FullWidthCell>
                    </TableRow>
                  )}
                  {!isLoading && sortedData.map(row => {
                    const status = statusConfig(row.status)
                    const isSelected = selectedRows.has(row.id)
                    return (
                      <TableRow
                        key={row.id}
                        data-state={isSelected ? 'selected' : undefined}
                        onClick={() => openPreview(row)}
                        title="클릭하면 미리보기가 열립니다"
                        className={`cursor-pointer text-sm transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-muted/40'
                        }`}
                      >
                        <TableCell className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row.id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`${row.testNo} ${row.product} 선택`}
                            className="cb-custom"
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.product}
                            secondary={row.type}
                            primaryClass="font-medium text-foreground"
                            title={`${row.product} / ${row.type}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.testNo}
                            secondary={row.items}
                            primaryClass="font-mono text-xs text-foreground"
                            title={`${row.testNo} / ${row.items}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={
                              <span className="flex min-w-0 items-center gap-1.5">
                                <TesterAvatar name={row.manager} size="xs" />
                                <span className="truncate">{row.manager}</span>
                              </span>
                            }
                            secondary={row.contractor}
                            title={`${row.manager} / ${row.contractor}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <CellStack
                            primary={row.receiveDate}
                            secondary={`완료 ${row.dueDate}`}
                            primaryClass="font-mono text-xs text-foreground"
                            title={`${row.receiveDate} / ${row.dueDate}`}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs leading-normal font-semibold ${status.cls}`}>
                            {status.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              </div>

              {/* Footer
                  '로딩 중…' 글자를 뺐다 — 로딩 표현은 Skeleton 하나로 통일한다(위 표가 이미 그린다).
                  실제로 페이지를 나누지 않는데 '1 / 1 페이지'라고 적어 두던 자리도 지웠다 —
                  세지 않는 숫자를 화면에 두지 않는다. */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5">
                {isLoading ? (
                  <Skeleton className="h-4 w-20" />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    총 <span className="font-semibold tabular-nums text-foreground">{sortedData.length}</span>건
                    {selectedRows.size > 0 && (
                      <span className="ml-2 text-blue-600">
                        · <span className="font-semibold tabular-nums">{selectedRows.size}</span>건 선택됨
                      </span>
                    )}
                    {loadError && (
                      <span className="ml-2 inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs leading-normal font-medium text-red-700">
                        조회 실패
                      </span>
                    )}
                  </p>
                )}
                <span className="hidden items-center gap-1 text-xs break-keep text-muted-foreground sm:flex">
                  <Eye size={12} className="shrink-0" />행을 클릭하면 미리보기·상태 변경·이력을 볼 수 있습니다
                </span>
              </div>
            </Card>
          </div>
      </div>

      <TestDetailDrawer
        row={previewRow}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        isAdmin={isAdmin}
        onChanged={() => setReloadKey(k => k + 1)}
      />
    </>
  )
}
