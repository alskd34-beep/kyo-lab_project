'use client'

import { useState, useEffect, useMemo } from 'react'
import type { StatusKey, TestRow, KpiItem } from '@shared/qc'
import { Button } from '@frontend/components/ui/button'
import { Card, CardContent } from '@frontend/components/ui/card'
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

const STATUS_CONFIG: Record<StatusKey, { label: string; cls: string }> = {
  completed:  { label: '적합완료', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  reviewing:  { label: '검토중',   cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  pending:    { label: '승인대기', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  fail:       { label: '부적합',   cls: 'bg-red-50 text-red-700 border border-red-200' },
  inprogress: { label: '진행중',   cls: 'bg-violet-50 text-violet-700 border border-violet-200' },
}

/** KPI 카드 배열 — 조회된 실제 행의 진행상태를 집계해 만든다(고정값 없음). */
function buildKpis(rows: TestRow[]): KpiItem[] {
  const by = (s: StatusKey) => rows.filter(r => r.status === s).length
  return [
    { label: '전체시험', value: String(rows.length),     unit: '건', sub: '조회 기간 전체', accent: 'text-slate-800',   bg: 'bg-white',         border: 'border-slate-200'   },
    { label: '진행중',   value: String(by('inprogress')), unit: '건', sub: '처리 진행 중',   accent: 'text-violet-600',  bg: 'bg-violet-50/60',  border: 'border-violet-100'  },
    { label: '검토중',   value: String(by('reviewing')),  unit: '건', sub: '결과 검토 중',   accent: 'text-blue-600',    bg: 'bg-blue-50/60',    border: 'border-blue-100'    },
    { label: '승인대기', value: String(by('pending')),    unit: '건', sub: '승인 대기',      accent: 'text-amber-600',   bg: 'bg-amber-50/60',   border: 'border-amber-100'   },
    { label: '완료',     value: String(by('completed')),  unit: '건', sub: '시험 완료',      accent: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-100' },
    { label: '부적합',   value: String(by('fail')),       unit: '건', sub: '기준 이탈',      accent: 'text-red-600',     bg: 'bg-red-50/60',     border: 'border-red-100'     },
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TestStatusPage() {
  const [activeTab, setActiveTab]         = useState<string>('시험현황')
  const [pinnedTabs, setPinnedTabs]       = useState<Set<string>>(new Set(['시험현황', '제품시험']))
  const [closedTabs, setClosedTabs]       = useState<Set<string>>(new Set())
  const [stickyHeader, setStickyHeader]   = useState(true)
  const [selectedRows, setSelectedRows]   = useState<Set<number>>(new Set())
  const [searchValue, setSearchValue]     = useState('')
  const [dateRange, setDateRange]         = useState<DateRange | undefined>(undefined)

  useEffect(() => {
    // 서버·클라이언트 타임존 차이로 인한 하이드레이션 불일치를 피하려 마운트 후(클라이언트)에만 기본 기간 설정
    const today = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 시각 동기화(마운트 1회)
    setDateRange({ from: subMonths(today, 1), to: today })
  }, [])
  const [tableData, setTableData]         = useState<TestRow[]>([])
  const [isLoading, setIsLoading]         = useState(true)
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [sortField, setSortField]         = useState<SortField>('dueDate')
  const [sortDir, setSortDir]             = useState<SortDir>('asc')

  // ─── Fetch from API — 실제 DB 데이터만 표시한다(데모/목업 폴백 없음) ────────
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (dateRange?.from) params.set('from', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to)   params.set('to',   format(dateRange.to,   'yyyy-MM-dd'))
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

          {/* ── KPI + Tab header (optionally sticky) ─────────────────────── */}
          <div className={`bg-white border-b border-slate-200 shadow-sm z-10 ${stickyHeader ? 'sticky top-0' : ''}`}>

            {/* Tabs */}
            <div className="flex items-center gap-0 px-5 border-b border-slate-100">
              <div className="flex flex-1 items-center gap-0 overflow-x-auto scrollbar-none">
                {sortedTabs.map(tab => {
                  const isPinned = pinnedTabs.has(tab)
                  const isActive = activeTab === tab
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`
                        group relative flex shrink-0 items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors
                        ${isActive
                          ? 'text-indigo-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-600 after:rounded-t-full'
                          : 'text-slate-500 hover:text-slate-700'}
                      `}
                    >
                      <span>{tab}</span>
                      {tab === '일탈관리' && (
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-600">3</span>
                      )}
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
                        className={`
                          ml-0.5 inline-flex rounded p-0.5 transition-all cursor-pointer
                          ${isPinned
                            ? 'text-amber-400 hover:text-amber-500'
                            : 'text-transparent group-hover:text-slate-300 hover:!text-amber-400'}
                        `}
                      >
                        <Star size={11} fill={isPinned ? 'currentColor' : 'none'} />
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
                        className="ml-0.5 inline-flex rounded p-0.5 text-transparent transition-all cursor-pointer group-hover:text-slate-400 hover:!bg-slate-100 hover:!text-slate-700"
                      >
                        <X size={11} />
                      </span>
                    </button>
                  )
                })}
              </div>
              {/* Sticky header toggle — moved here from global header */}
              <button
                onClick={() => setStickyHeader(p => !p)}
                title={stickyHeader ? '헤더 고정 해제' : '헤더 고정'}
                className={`ml-2 shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  stickyHeader
                    ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {stickyHeader ? <Pin size={11} /> : <PinOff size={11} />}
                <span>헤더 {stickyHeader ? '고정' : '해제'}</span>
              </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 px-4 md:px-5 py-3">
              {kpis.map(kpi => (
                <Card
                  key={kpi.label}
                  className={`cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md ${kpi.bg} border ${kpi.border} shadow-none rounded-xl py-0`}
                >
                  <CardContent className="px-3.5 py-3">
                    <p className="text-[10px] font-medium text-slate-500 mb-0.5">{kpi.label}</p>
                    <div className="flex items-baseline gap-0.5">
                      <span className={`text-[22px] font-bold tabular-nums leading-none ${kpi.accent}`}>{kpi.value}</span>
                      <span className="text-xs font-medium text-slate-400 ml-0.5">{kpi.unit}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400 leading-none">{kpi.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* ── Table section ────────────────────────────────────────────── */}
          <div className="flex-1 p-4 md:p-5">
            <Card className="border border-slate-200 shadow-none rounded-xl bg-white gap-0 py-0 overflow-hidden">

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                {/* Date range */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors sm:w-auto"
                    >
                      <CalendarIcon size={13} className="text-slate-400" />
                      <span className="tabular-nums">
                        {dateRange?.from ? format(dateRange.from, 'yyyy.MM.dd') : '시작일'}
                      </span>
                      <span className="text-slate-300">~</span>
                      <span className="tabular-nums">
                        {dateRange?.to ? format(dateRange.to, 'yyyy.MM.dd') : '종료일'}
                      </span>
                    </button>
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

                {/* Search */}
                <div className="flex min-w-0 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all sm:w-auto sm:flex-1 sm:max-w-[240px]">
                  <Search size={13} className="text-slate-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="제품명, 시험번호, 담당자..."
                    value={searchValue}
                    onChange={e => setSearchValue(e.target.value)}
                    className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                  />
                </div>

                <Button size="sm" className="h-7 px-4 text-xs font-medium rounded-lg shadow-none">
                  조회
                </Button>

                <div className="flex items-center gap-1.5 sm:ml-auto">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs text-slate-600 rounded-lg border-slate-200 shadow-none">
                    <Filter size={12} />
                    필터
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 rounded-lg shadow-none">
                    <Download size={12} />
                    Excel
                  </Button>
                </div>
              </div>

              {/* Mobile card view */}
              <div className="md:hidden flex flex-col gap-2 p-3">
                {sortedData.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500">
                    {isLoading
                      ? '불러오는 중…'
                      : loadError
                        ? `목록을 불러오지 못했습니다. ${loadError}`
                        : '조회 조건에 해당하는 시험이 없습니다.'}
                  </p>
                ) : (
                  sortedData.map(row => {
                    const status = STATUS_CONFIG[row.status]
                    const isSelected = selectedRows.has(row.id)
                    return (
                      <div
                        key={row.id}
                        onClick={() => toggleRow(row.id)}
                        className={`rounded-lg border p-3 transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-slate-200 hover:bg-slate-50/70'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row.id)}
                            onClick={e => e.stopPropagation()}
                            className="cb-custom mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium ${
                                row.category === '완제품' ? 'bg-slate-100 text-slate-600' : 'bg-sky-50 text-sky-700'
                              }`}>{row.category}</span>
                              <span className="text-[10px] text-slate-500">{row.type}</span>
                              <span className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>
                                {status.label}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-medium text-slate-800 truncate">{row.product}</p>
                            <p className="text-[11px] font-mono text-slate-500">{row.testNo}</p>
                            <p className="mt-1 text-[11px] text-slate-600 truncate">{row.items}</p>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <TesterAvatar name={row.manager} size="xs" />
                                <span className="text-[11px] text-slate-700">{row.manager}</span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400">~{row.dueDate}</span>
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
              <Table>
                <colgroup>
                  <col className="w-[4%]" />
                  <col className="w-[26%]" />
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-transparent border-slate-100">
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
                  {(isLoading || sortedData.length === 0) && (
                    <TableRow className="hover:bg-transparent border-slate-100">
                      <TableCell colSpan={6} className="py-14 text-center text-sm text-slate-500">
                        {isLoading
                          ? '불러오는 중…'
                          : loadError
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
                        className={`cursor-pointer border-slate-100 text-sm transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                        }`}
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
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.cls}`}>
                            {status.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 bg-slate-50/50">
                <p className="text-xs text-slate-500">
                  {isLoading && <span className="mr-2 text-slate-400">로딩 중…</span>}
                  총 <span className="font-semibold text-slate-700">{sortedData.length}</span>건
                  {selectedRows.size > 0 && (
                    <span className="ml-2 text-blue-600">
                      · <span className="font-semibold">{selectedRows.size}</span>건 선택됨
                    </span>
                  )}
                  {loadError && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 border border-red-200">
                      조회 실패
                    </span>
                  )}
                </p>
                <span className="text-xs text-slate-400">1 / 1 페이지</span>
              </div>
            </Card>
          </div>
      </div>
    </>
  )
}
