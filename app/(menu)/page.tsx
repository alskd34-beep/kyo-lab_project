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
import { Avatar, AvatarFallback } from '@frontend/components/ui/avatar'
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
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

// ─── Static Data ──────────────────────────────────────────────────────────────
const ALL_TABS = ['시험현황', '제품시험', '안정성시험', '일탈관리'] as const

const STATUS_CONFIG: Record<StatusKey, { label: string; dot: string }> = {
  completed:  { label: '적합완료', dot: 'bg-emerald-500' },
  reviewing:  { label: '검토중',   dot: 'bg-blue-500' },
  pending:    { label: '승인대기', dot: 'bg-amber-500' },
  fail:       { label: '부적합',   dot: 'bg-destructive' },
  inprogress: { label: '진행중',   dot: 'bg-violet-500' },
}

const KPI_DATA: KpiItem[] = [
  { label: '전체시험',  value: '324',  unit: '건',  sub: '이번 달 전체',   accent: 'text-slate-800',   bg: 'bg-white',          border: 'border-slate-200'  },
  { label: '나의시험',  value: '7',    unit: '건',  sub: '배정된 시험',    accent: 'text-blue-600',    bg: 'bg-blue-50/60',     border: 'border-blue-100'   },
  { label: '진행중',    value: '42',   unit: '건',  sub: '처리 진행 중',   accent: 'text-violet-600',  bg: 'bg-violet-50/60',   border: 'border-violet-100' },
  { label: '완료',      value: '276',  unit: '건',  sub: '시험 완료',      accent: 'text-emerald-600', bg: 'bg-emerald-50/60',  border: 'border-emerald-100'},
  { label: '전달대비',  value: '±0',   unit: '%',   sub: '증감 없음',      accent: 'text-slate-500',   bg: 'bg-slate-50',       border: 'border-slate-200'  },
  { label: 'OOS건수',   value: '3',    unit: '건',  sub: '기준 이탈',      accent: 'text-red-600',     bg: 'bg-red-50/60',      border: 'border-red-100'    },
  { label: '평균처리일', value: '2.4', unit: '일',  sub: '처리 소요일',    accent: 'text-amber-600',   bg: 'bg-amber-50/60',    border: 'border-amber-100'  },
]

const DEMO_TABLE_DATA: TestRow[] = [
  { id:1,  category:'완제품', type:'이화학시험',  product:'경옥고 프리미엄',        testNo:'QC-2024-0312', items:'pH, 점도, 비중',       contractor:'광동제약(주)', manager:'김수현', managerInit:'김', receiveDate:'2024.03.01', dueDate:'2024.03.15', status:'completed'  },
  { id:2,  category:'원료',   type:'미생물시험',  product:'비타500 원액',           testNo:'QC-2024-0318', items:'총균수, 대장균',       contractor:'광동제약(주)', manager:'박지민', managerInit:'박', receiveDate:'2024.03.05', dueDate:'2024.03.20', status:'reviewing'  },
  { id:3,  category:'완제품', type:'안정성시험',  product:'홍삼농축액 에브리타임',  testNo:'QC-2024-0325', items:'함량, 순도',           contractor:'광동제약(주)', manager:'이서연', managerInit:'이', receiveDate:'2024.03.08', dueDate:'2024.04.08', status:'inprogress' },
  { id:4,  category:'완제품', type:'이화학시험',  product:'옥수수수염차 500ml',     testNo:'QC-2024-0331', items:'pH, 탁도, 당도',       contractor:'광동제약(주)', manager:'최준호', managerInit:'최', receiveDate:'2024.03.10', dueDate:'2024.03.25', status:'pending'    },
  { id:5,  category:'원료',   type:'중금속시험',  product:'경옥고 원료 배합',       testNo:'QC-2024-0337', items:'Pb, Cd, As, Hg',      contractor:'광동제약(주)', manager:'김수현', managerInit:'김', receiveDate:'2024.03.12', dueDate:'2024.03.26', status:'completed'  },
  { id:6,  category:'완제품', type:'미생물시험',  product:'비타500W 제로',          testNo:'QC-2024-0342', items:'총균수, 효모',         contractor:'광동제약(주)', manager:'박지민', managerInit:'박', receiveDate:'2024.03.14', dueDate:'2024.03.28', status:'fail'       },
  { id:7,  category:'원료',   type:'이화학시험',  product:'홍삼정 에브리타임 2X',  testNo:'QC-2024-0349', items:'진세노사이드 함량',    contractor:'광동제약(주)', manager:'정다은', managerInit:'정', receiveDate:'2024.03.15', dueDate:'2024.03.29', status:'inprogress' },
  { id:8,  category:'완제품', type:'관능시험',    product:'헛개수 플러스',          testNo:'QC-2024-0356', items:'색상, 향, 맛, 이물',   contractor:'광동제약(주)', manager:'이서연', managerInit:'이', receiveDate:'2024.03.18', dueDate:'2024.04.01', status:'reviewing'  },
]

const AVATAR_COLORS: Record<string, string> = {
  김: 'bg-blue-500', 박: 'bg-violet-500', 이: 'bg-emerald-500',
  최: 'bg-amber-500', 정: 'bg-rose-500',
}

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
  const [sortField, setSortField]         = useState<keyof TestRow | null>(null)
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    // 서버·클라이언트 타임존 차이로 인한 하이드레이션 불일치를 피하려 마운트 후(클라이언트)에만 기본 기간 설정
    const today = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 클라이언트 전용 시각 동기화(마운트 1회)
    setDateRange({ from: subMonths(today, 1), to: today })
    setIsHydrated(true)
  }, [])
  const [tableData, setTableData]         = useState<TestRow[]>(DEMO_TABLE_DATA)
  const [isLoading, setIsLoading]         = useState(false)
  const [usingDemo, setUsingDemo]         = useState(true)

  // ─── Fetch from API (fallback to demo data on error) ──────────────────────
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
        if (rows.length > 0) {
          setTableData(rows)
          setUsingDemo(false)
        } else {
          setTableData(DEMO_TABLE_DATA)
          setUsingDemo(true)
        }
      })
      .catch(() => {
        if (cancelled) return
        setTableData(DEMO_TABLE_DATA)
        setUsingDemo(true)
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

  // 서버에서 이미 검색이 적용되지만, 데모 모드(서버 미연결)에서도 동작하도록 클라이언트 필터를 유지합니다.
  const filtered = usingDemo
    ? tableData.filter(
        row =>
          !searchValue ||
          row.product.includes(searchValue) ||
          row.testNo.includes(searchValue) ||
          row.manager.includes(searchValue),
      )
    : tableData

  const toggleSort = (field: keyof TestRow) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ field }: { field: keyof TestRow }) => {
    if (sortField !== field) return <span className="ml-1 opacity-40"><ChevronDown size={11} /></span>
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="ml-1 text-primary" />
      : <ChevronDown size={11} className="ml-1 text-primary" />
  }

  const sortedData = useMemo(() => {
    if (!sortField) return filtered
    return [...filtered].sort((a, b) => {
      const av = String(a[sortField] ?? '')
      const bv = String(b[sortField] ?? '')
      const cmp = av.localeCompare(bv, 'ko')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortField, sortDir])

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
              <div className="inline-flex h-9 w-fit items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 text-muted-foreground">
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
              {KPI_DATA.map(kpi => (
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

              {/* Table */}
              <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
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
                    {([
                      ['구분',     'category'   ],
                      ['유형',     'type'       ],
                      ['제품명',   'product'    ],
                      ['시험번호', 'testNo'     ],
                      ['시험항목', 'items'      ],
                      ['수탁사',   'contractor' ],
                      ['담당자',   'manager'    ],
                      ['접수일',   'receiveDate'],
                      ['완료예정일','dueDate'   ],
                      ['진행상태', 'status'     ],
                    ] as [string, keyof TestRow][]).map(([label, field]) => (
                      <TableHead
                        key={field}
                        onClick={() => toggleSort(field)}
                        className="px-3 text-muted-foreground cursor-pointer select-none hover:text-foreground"
                      >
                        {label}<SortIcon field={field} />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedData.map(row => {
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
                        <TableCell className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row.id)}
                            onClick={e => e.stopPropagation()}
                            className="cb-custom"
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2.5">
                          <Badge variant="outline">{row.category}</Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.type}</TableCell>
                        <TableCell className="px-3 py-2.5">
                          <span className="font-medium text-foreground">{row.product}</span>
                        </TableCell>
                        <TableCell className="px-3 py-2.5">
                          <span className="font-mono text-xs text-muted-foreground">{row.testNo}</span>
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.items}</TableCell>
                        <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.contractor}</TableCell>
                        <TableCell className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-6 w-6 shrink-0">
                              <AvatarFallback className={`text-[10px] font-bold text-white ${AVATAR_COLORS[row.managerInit] ?? 'bg-slate-400'}`}>
                                {row.managerInit}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-muted-foreground">{row.manager}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.receiveDate}</TableCell>
                        <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.dueDate}</TableCell>
                        <TableCell className="px-3 py-2.5">
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
              </div>

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
                  {usingDemo && (
                    <Badge variant="outline" className="ml-2 border-amber-200 text-amber-700">데모 모드</Badge>
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
