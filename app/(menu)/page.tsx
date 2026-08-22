'use client'

import { useState, useEffect, useMemo } from 'react'
import type { StatusKey, TestRow, KpiItem } from '@shared/qc'
import { Button } from '@frontend/components/ui/button'
import { Badge } from '@frontend/components/ui/badge'
import { Input } from '@frontend/components/ui/input'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Card } from '@frontend/components/ui/card'
import { cn } from '@frontend/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@frontend/components/ui/table'
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
import { TesterAvatar } from '@frontend/lib/tester-profiles'
import { Calendar } from '@frontend/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@frontend/components/ui/popover'
import { ko } from 'date-fns/locale'
import { format, subMonths } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import {
  Star,
  Filter,
  Download,
  Calendar as CalendarIcon,
  Search,
  Pin,
  PinOff,
  X,
} from 'lucide-react'

// ─── Static Data ──────────────────────────────────────────────────────────────
const ALL_TABS = ['시험현황', '제품시험', '안정성시험', '일탈관리'] as const

const STATUS_CONFIG: Record<StatusKey, { label: string; dot: string }> = {
  waiting:    { label: '시작대기', dot: 'bg-slate-400' },
  inprogress: { label: '진행중',   dot: 'bg-violet-500' },
  prereview:  { label: '검토대기', dot: 'bg-amber-500' },
  reviewing:  { label: '검토중',   dot: 'bg-blue-500' },
  pending:    { label: '승인대기', dot: 'bg-teal-500' },
  completed:  { label: '적합완료', dot: 'bg-emerald-500' },
  fail:       { label: '부적합',   dot: 'bg-destructive' },
}

/**
 * KPI 카드 — 조회된 실제 행의 진행상태를 집계해 만든다(고정값 없음).
 * '나의시험·전달대비·평균처리일'은 이 응답만으로 산출할 수 없어 제외했다.
 * 추정치를 그럴듯한 숫자로 채우면 실제 수치와 구분되지 않는다.
 */
function buildKpis(rows: TestRow[]): KpiItem[] {
  const by = (s: StatusKey) => rows.filter(r => r.status === s).length
  return [
    { label: '전체시험', value: String(rows.length),     unit: '건', sub: '조회 기간 전체', accent: 'text-foreground',  bg: 'bg-white',         border: 'border-slate-200'   },
    { label: '시작대기', value: String(by('waiting')),    unit: '건', sub: '배정 후 미착수', accent: 'text-slate-600',   bg: 'bg-slate-50',      border: 'border-slate-200'   },
    { label: '진행중',   value: String(by('inprogress')), unit: '건', sub: '처리 진행 중',   accent: 'text-violet-600',  bg: 'bg-violet-50/60',  border: 'border-violet-100'  },
    { label: '검토',     value: String(by('prereview') + by('reviewing')), unit: '건', sub: '검토대기·검토중', accent: 'text-blue-600', bg: 'bg-blue-50/60', border: 'border-blue-100' },
    { label: '승인대기', value: String(by('pending')),    unit: '건', sub: '검토 후 승인 대기', accent: 'text-teal-600', bg: 'bg-teal-50/60',    border: 'border-teal-100'    },
    { label: '완료',     value: String(by('completed')),  unit: '건', sub: '승인 완료',      accent: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-100' },
    { label: 'OOS건수',  value: String(by('fail')),       unit: '건', sub: '기준 이탈',      accent: 'text-destructive', bg: 'bg-red-50/60',     border: 'border-red-100'     },
  ]
}

type SortField = 'category' | 'type' | 'product' | 'testNo' | 'items' | 'contractor' | 'manager' | 'receiveDate' | 'dueDate' | 'status'

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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function QCDashboard() {
  const [activeTab, setActiveTab]         = useState<string>('시험현황')
  const [pinnedTabs, setPinnedTabs]       = useState<Set<string>>(new Set(['시험현황', '제품시험']))
  const [closedTabs, setClosedTabs]       = useState<Set<string>>(new Set())
  const [stickyHeader, setStickyHeader]   = useState(true)
  const [selectedRows, setSelectedRows]   = useState<Set<number>>(new Set())
  const [searchValue, setSearchValue]     = useState('')
  const [dateRange, setDateRange]         = useState<DateRange | undefined>(undefined)
  const [isHydrated, setIsHydrated]       = useState(false)
  const [sortField, setSortField]         = useState<SortField>('dueDate')
  const [sortDir, setSortDir]             = useState<SortDir>('asc')

  useEffect(() => {
    // 서버·클라이언트 타임존 차이로 인한 하이드레이션 불일치를 피하려 마운트 후(클라이언트)에만 기본 기간 설정
    const today = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 시각 동기화(마운트 1회)
    setDateRange({ from: subMonths(today, 1), to: today })
    setIsHydrated(true)
  }, [])
  const [tableData, setTableData]         = useState<TestRow[]>([])
  const [isLoading, setIsLoading]         = useState(true)
  const [loadError, setLoadError]         = useState<string | null>(null)

  // ─── Fetch from API — 실제 DB 데이터만 표시한다(데모 폴백 없음) ────────────
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (dateRange?.from) params.set('from', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to)   params.set('to',   format(dateRange.to,   'yyyy-MM-dd'))
    if (searchValue)     params.set('search', searchValue)

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 데이터 페치(외부 시스템) 시작 시 로딩 표시
    setIsLoading(true)
    fetch(`/api/tests?${params.toString()}`)
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
        // 조회 실패 시 가짜 데이터로 채우지 않고 빈 목록 + 사유를 보여준다.
        if (cancelled) return
        setTableData([])
        setLoadError(err instanceof Error ? err.message : '목록을 불러오지 못했습니다.')
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })

    return () => { cancelled = true }
  }, [dateRange, searchValue])

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
      const av = String(a[sortField] ?? '')
      const bv = String(b[sortField] ?? '')
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
      <div className="flex flex-1 flex-col">

          {/* ── KPI + Tab header (optionally sticky) ─────────────────────── */}
          <div className={cn('z-10 border-b bg-background', stickyHeader && 'sticky top-0')}>
            <div className="flex items-center gap-2 px-4 py-3 md:px-6">
              <div className="inline-flex h-9 w-fit items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5 text-muted-foreground">
                {sortedTabs.map(tab => {
                  const isPinned = pinnedTabs.has(tab)
                  const isActive = activeTab === tab
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        'group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                        isActive ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground',
                      )}
                    >
                      <span>{tab}</span>
                      {tab === '일탈관리' && (
                        <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">3</Badge>
                      )}
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
                        className={cn(
                          'inline-flex cursor-pointer rounded p-0.5',
                          isPinned ? 'text-amber-500' : 'text-transparent group-hover:text-muted-foreground',
                        )}
                      >
                        <Star size={11} fill={isPinned ? 'currentColor' : 'none'} />
                      </span>
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
                        className="inline-flex cursor-pointer rounded p-0.5 text-transparent group-hover:text-muted-foreground hover:bg-muted"
                      >
                        <X size={11} />
                      </span>
                    </button>
                  )
                })}
              </div>
              <Button
                type="button"
                variant={stickyHeader ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setStickyHeader(p => !p)}
                title={stickyHeader ? '헤더 고정 해제' : '헤더 고정'}
                className="ml-auto"
              >
                {stickyHeader ? <Pin /> : <PinOff />}
                헤더 {stickyHeader ? '고정' : '해제'}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 md:grid-cols-4 md:px-6 lg:grid-cols-7">
              {kpis.map(kpi => (
                <Card key={kpi.label} className="gap-1 border-l-4 border-l-primary px-4 py-4">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{kpi.label}</span>
                  <span className={cn('text-2xl font-semibold tabular-nums', kpi.accent)}>
                    {kpi.value}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">{kpi.unit}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">{kpi.sub}</span>
                </Card>
              ))}
            </div>
          </div>

          {/* ── Table section ────────────────────────────────────────────── */}
          <div className="flex-1 p-4 md:p-6">
            <Card className="gap-0 overflow-hidden py-0">
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                {isHydrated ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <CalendarIcon />
                        <span className="tabular-nums">
                          {dateRange?.from ? format(dateRange.from, 'yyyy.MM.dd') : '시작일'}
                        </span>
                        <span className="text-muted-foreground">~</span>
                        <span className="tabular-nums">
                          {dateRange?.to ? format(dateRange.to, 'yyyy.MM.dd') : '종료일'}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="range"
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                        locale={ko}
                        defaultMonth={dateRange?.from}
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled aria-label="기간 선택 준비 중">
                    <CalendarIcon />
                    시작일 ~ 종료일
                  </Button>
                )}

                <div className="relative min-w-0 w-full sm:w-auto sm:flex-1 md:max-w-[240px]">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="제품명, 시험번호, 담당자..."
                    value={searchValue}
                    onChange={e => setSearchValue(e.target.value)}
                    className="h-8 pl-9"
                  />
                </div>

                <Button size="sm">조회</Button>

                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="outline">
                    <Filter />
                    필터
                  </Button>
                  <Button size="sm" variant="outline">
                    <Download />
                    Excel
                  </Button>
                </div>
              </div>

              <Table>
                {/* 논리 열 6개(체크·품목·시험·담당·일정·진행상태) + 2필드 묶음 4개 -> 최대 10칸.
                    table-fixed 에서 <col> 이 모자라면 늘어난 칸이 폭 0으로 접혀 사라진다.
                    칸 순서(펼침 / 합침):
                    체크 · 제품명/품목 · 유형/시험 · 시험번호/담당 · 시험항목/일정 ·
                    담당자/진행상태 · 수탁사 · 접수일 · 완료예정일 · 진행상태 */}
                <colgroup>
                  <col className="w-[4%]" />
                  <col className="w-[16%]" />
                  <col className="w-[9%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 px-3">
                      <input
                        type="checkbox"
                        checked={selectedRows.size === tableData.length && tableData.length > 0}
                        onChange={toggleAll}
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
                  {isLoading && Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                      <TableCell className="px-3 py-2"><Skeleton className="h-4 w-4 rounded" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-8 w-40" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-8 w-32" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-8 w-24" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-8 w-24" /></TableCell>
                      <TableCell className="px-3 py-2"><Skeleton className="h-5 w-14 rounded-md" /></TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && sortedData.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                        {loadError
                          ? `목록을 불러오지 못했습니다. ${loadError}`
                          : '조회 조건에 해당하는 시험이 없습니다.'}
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && sortedData.map(row => {
                    const status = STATUS_CONFIG[row.status]
                    const isSelected = selectedRows.has(row.id)
                    return (
                      <TableRow
                        key={row.id}
                        data-state={isSelected ? 'selected' : undefined}
                        onClick={() => toggleRow(row.id)}
                        className={cn(
                          'cursor-pointer',
                          isSelected ? 'bg-primary/5' : 'hover:bg-muted/40',
                        )}
                      >
                        <TableCell className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row.id)}
                            onClick={e => e.stopPropagation()}
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
                          <Badge variant="outline" className="gap-1.5">
                            <span className={cn('size-1.5 rounded-full', status.dot)} />
                            {status.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Footer */}
              <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2.5">
                <p className="text-xs text-muted-foreground">
                  {isLoading && <span className="mr-2">로딩 중…</span>}
                  총 <span className="font-semibold text-foreground">{filtered.length}</span>건
                  {selectedRows.size > 0 && (
                    <span className="ml-2 text-primary">
                      · <span className="font-semibold">{selectedRows.size}</span>건 선택됨
                    </span>
                  )}
                  {loadError && (
                    <Badge variant="outline" className="ml-2 border-amber-200 text-amber-700">조회 실패</Badge>
                  )}
                </p>
                <span className="text-xs text-muted-foreground">1 / 1 페이지</span>
              </div>
            </Card>
          </div>
      </div>
    </>
  )
}
