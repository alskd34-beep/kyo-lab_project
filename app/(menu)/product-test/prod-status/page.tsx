'use client'

import { useState, useEffect, useMemo } from 'react'
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
import { Calendar } from '@frontend/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@frontend/components/ui/popover'
import { ko } from 'date-fns/locale'
import { format, subMonths } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { Calendar as CalendarIcon, Search, Download } from 'lucide-react'
import type { BatchSummary, BatchStatus, DashboardStats } from '@shared/pqm'

const DEMO_BATCHES: BatchSummary[] = [
  { id: 1, product_code: '21081', product_name: '(사향)광동우황청심원현탁액(신)', spec: '50ML', batch_no: '26002', dosage_form: '현탁제', packaging_date: '2026-04-10', record_review_deadline: '2026-04-24', qc_completion_deadline: '2026-04-24', is_urgent: false, status: 'completed', dDayRecord: -13, dDayQc: -13, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 2, product_code: '21350', product_name: '슬라임캡슐', spec: '120C', batch_no: '26001', dosage_form: '내용고형제', packaging_date: '2026-03-30', record_review_deadline: '2026-04-27', qc_completion_deadline: '2026-04-27', is_urgent: false, status: 'completed', dDayRecord: -10, dDayQc: -10, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 3, product_code: '23263', product_name: '베니톨정', spec: '500T', batch_no: '26023', dosage_form: '내용고형제', packaging_date: '2026-04-16', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 4, product_code: '23263', product_name: '베니톨정', spec: '500T', batch_no: '26024', dosage_form: '내용고형제', packaging_date: '2026-04-16', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'pending', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 5, product_code: '21391', product_name: '알도셉트정5mg', spec: '30T', batch_no: '26001-A', dosage_form: '내용고형제', packaging_date: '2026-04-06', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 6, product_code: '21080', product_name: '(사향)광동우황청심원(신)', spec: '1환', batch_no: '26010', dosage_form: '환제', packaging_date: '2026-04-25', record_review_deadline: '2026-05-07', qc_completion_deadline: '2026-05-07', is_urgent: false, status: 'pending', dDayRecord: 0, dDayQc: 0, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 7, product_code: '27045', product_name: '(베트남수출용)광동우황청심원(영묘향)', spec: '1환', batch_no: '26011', dosage_form: '환제', packaging_date: '2026-04-28', record_review_deadline: '2026-05-10', qc_completion_deadline: '2026-05-10', is_urgent: false, status: 'pending', dDayRecord: 3, dDayQc: 3, note: null, created_at: '', process_order: null, validation_type: '일반' },
]

const DEMO_STATS: DashboardStats = {
  totalBatches: 129, pending: 97, inProgress: 15, completed: 17,
  dueSoon7: 23, dueSoon3: 8, overdueCount: 5,
}

const STATUS_CONFIG: Record<BatchStatus, { label: string; cls: string }> = {
  pending:     { label: '대기중', cls: 'bg-slate-100 text-slate-600 border border-slate-200' },
  in_progress: { label: '진행중', cls: 'bg-violet-50 text-violet-700 border border-violet-200' },
  completed:   { label: '완료',   cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  on_hold:     { label: '보류',   cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  cancelled:   { label: '취소',   cls: 'bg-red-50 text-red-700 border border-red-200' },
}

const STATUS_FILTERS = ['전체', '대기중', '진행중', '완료'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

const STATUS_FILTER_MAP: Record<StatusFilter, BatchStatus | null> = {
  '전체': null, '대기중': 'pending', '진행중': 'in_progress', '완료': 'completed',
}

function DDayCell({ dDayQc, status }: { dDayQc: number | null; status: BatchStatus }) {
  if (status === 'completed' || status === 'cancelled' || dDayQc === null) {
    return <span className="text-xs text-slate-400">-</span>
  }
  if (dDayQc <= 0) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
        {dDayQc === 0 ? 'D-Day' : `D+${Math.abs(dDayQc)}`}
      </span>
    )
  }
  if (dDayQc <= 3) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
        D-{dDayQc}
      </span>
    )
  }
  if (dDayQc <= 7) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        D-{dDayQc}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      D-{dDayQc}
    </span>
  )
}

export default function ProdStatusPage() {
  const [batches, setBatches]           = useState<BatchSummary[]>(DEMO_BATCHES)
  const [stats, setStats]               = useState<DashboardStats>(DEMO_STATS)
  const [isLoading, setIsLoading]       = useState(false)
  const [usingDemo, setUsingDemo]       = useState(true)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [searchValue, setSearchValue]   = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('전체')
  const [dateRange, setDateRange]       = useState<DateRange | undefined>(undefined)

  useEffect(() => {
    const today = new Date()
    setDateRange({ from: subMonths(today, 1), to: today })
  }, [])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (dateRange?.from) params.set('from', format(dateRange.from, 'yyyy-MM-dd'))
    if (dateRange?.to)   params.set('to',   format(dateRange.to,   'yyyy-MM-dd'))
    if (searchValue)     params.set('search', searchValue)
    if (statusFilter !== '전체') {
      const mapped = STATUS_FILTER_MAP[statusFilter]
      if (mapped) params.set('status', mapped)
    }

    setIsLoading(true)
    Promise.all([
      fetch(`/api/batches?${params.toString()}`).then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: BatchSummary[] }>
      }),
      fetch('/api/dashboard').then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<DashboardStats>
      }),
    ])
      .then(([batchData, statsData]) => {
        if (cancelled) return
        if (batchData.rows.length > 0) {
          setBatches(batchData.rows)
          setUsingDemo(false)
        } else {
          setBatches(DEMO_BATCHES)
          setUsingDemo(true)
        }
        setStats(statsData)
      })
      .catch(() => {
        if (cancelled) return
        setBatches(DEMO_BATCHES)
        setStats(DEMO_STATS)
        setUsingDemo(true)
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })

    return () => { cancelled = true }
  }, [dateRange, searchValue, statusFilter])

  const filtered = useMemo(() => {
    if (!usingDemo) return batches
    let rows = batches
    if (searchValue) {
      rows = rows.filter(r =>
        r.product_name.includes(searchValue) || r.batch_no.includes(searchValue)
      )
    }
    if (statusFilter !== '전체') {
      const mapped = STATUS_FILTER_MAP[statusFilter]
      if (mapped) rows = rows.filter(r => r.status === mapped)
    }
    return rows
  }, [batches, usingDemo, searchValue, statusFilter])

  const toggleRow = (id: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedRows(selectedRows.size === filtered.length ? new Set() : new Set(filtered.map(r => r.id)))
  }

  const KPI_CARDS = [
    { label: '전체 배치',  value: stats.totalBatches, accent: 'text-slate-800',   bg: 'bg-white',         border: 'border-slate-200',  sub: '취소 제외 전체' },
    { label: '대기중',     value: stats.pending,       accent: 'text-slate-600',   bg: 'bg-slate-50/60',   border: 'border-slate-200',  sub: '시험 대기' },
    { label: '진행중',     value: stats.inProgress,    accent: 'text-violet-600',  bg: 'bg-violet-50/60',  border: 'border-violet-100', sub: '시험 진행 중' },
    { label: 'QC 완료',   value: stats.completed,     accent: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-100', sub: '시험 완료' },
    { label: 'D-7 이내',  value: stats.dueSoon7,      accent: 'text-amber-600',   bg: 'bg-amber-50/60',   border: 'border-amber-100',  sub: '기한 임박' },
    { label: 'D-3 이내',  value: stats.dueSoon3,      accent: 'text-red-600',     bg: 'bg-red-50/60',     border: 'border-red-100',    sub: '위험' },
  ]

  return (
    <div className="flex flex-1 flex-col">

      {/* KPI */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-2.5 px-3 md:px-5 py-3">
          {KPI_CARDS.map(kpiCard => (
            <Card
              key={kpiCard.label}
              className={`cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md ${kpiCard.bg} border ${kpiCard.border} shadow-none rounded-xl py-0`}
            >
              <CardContent className="px-3.5 py-3">
                <p className="text-[10px] font-medium text-slate-500 mb-0.5">{kpiCard.label}</p>
                <div className="flex items-baseline gap-0.5">
                  <span className={`text-[22px] font-bold tabular-nums leading-none ${kpiCard.accent}`}>{kpiCard.value}</span>
                  <span className="text-xs font-medium text-slate-400 ml-0.5">건</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-400 leading-none">{kpiCard.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Table Section */}
      <div className="flex-1 p-3 md:p-5">
        <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0 overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center gap-2 border-b border-slate-100 px-3 md:px-4 py-2.5 md:flex-wrap">
            {/* Date range */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
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

            {/* Status filter buttons */}
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === f
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="flex w-full md:max-w-[220px] md:flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="품목명, 제조번호..."
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>

            <div className="md:ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 rounded-lg shadow-none">
                <Download size={12} />
                Excel
              </Button>
            </div>
          </div>

          {/* Table (desktop/tablet) */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 border-slate-100">
                <TableHead className="w-10 px-4">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="cb-custom"
                  />
                </TableHead>
                {['품목코드', '품목명', '규격', '제조번호', '제형', '포장일', '기록서검토기한', 'QC완료예정일', 'D-Day', '상태'].map(h => (
                  <TableHead key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-3">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(row => {
                const isSelected = selectedRows.has(row.id)
                const statusCfg = STATUS_CONFIG[row.status]
                return (
                  <TableRow
                    key={row.id}
                    data-state={isSelected ? 'selected' : undefined}
                    onClick={() => toggleRow(row.id)}
                    className={`cursor-pointer border-slate-100 text-sm transition-colors ${
                      isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <TableCell className="px-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(row.id)}
                        onClick={e => e.stopPropagation()}
                        className="cb-custom"
                      />
                    </TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.product_code}</TableCell>
                    <TableCell className="px-3">
                      <span className="text-sm font-medium text-slate-800">{row.product_name}</span>
                    </TableCell>
                    <TableCell className="px-3 text-xs text-slate-600">{row.spec}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.batch_no}</TableCell>
                    <TableCell className="px-3 text-xs text-slate-600">{row.dosage_form}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.packaging_date}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.record_review_deadline}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.qc_completion_deadline}</TableCell>
                    <TableCell className="px-3">
                      <DDayCell dDayQc={row.dDayQc} status={row.status} />
                    </TableCell>
                    <TableCell className="px-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusCfg.cls}`}>
                        {statusCfg.label}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden flex flex-col gap-2 p-3">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">데이터가 없습니다.</div>
            ) : (
              filtered.map(row => {
                const isSelected = selectedRows.has(row.id)
                const statusCfg = STATUS_CONFIG[row.status]
                return (
                  <div
                    key={row.id}
                    onClick={() => toggleRow(row.id)}
                    className={`rounded-xl border p-3 transition-colors ${
                      isSelected ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row.id)}
                            onClick={e => e.stopPropagation()}
                            className="cb-custom"
                          />
                          <span className="font-mono text-[11px] text-slate-500">{row.batch_no}</span>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCfg.cls}`}>
                            {statusCfg.label}
                          </span>
                          <DDayCell dDayQc={row.dDayQc} status={row.status} />
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-800 break-words">{row.product_name}</div>
                        <div className="text-[11px] text-slate-500">
                          <span className="font-mono">{row.product_code}</span>
                          {' · '}{row.spec}
                          {' · '}{row.dosage_form}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2 font-mono">
                      <div><span className="text-slate-400 font-sans">포장일:</span> {row.packaging_date}</div>
                      <div><span className="text-slate-400 font-sans">QC완료:</span> {row.qc_completion_deadline}</div>
                      <div className="col-span-2"><span className="text-slate-400 font-sans">기록서검토:</span> {row.record_review_deadline}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 md:px-4 py-2.5 bg-slate-50/50">
            <p className="text-xs text-slate-500">
              {isLoading && <span className="mr-2 text-slate-400">로딩 중…</span>}
              총 <span className="font-semibold text-slate-700">{filtered.length}</span>건
              {selectedRows.size > 0 && (
                <span className="ml-2 text-blue-600">
                  · <span className="font-semibold">{selectedRows.size}</span>건 선택됨
                </span>
              )}
              {usingDemo && (
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                  데모 모드
                </span>
              )}
            </p>
            <span className="text-xs text-slate-400">1 / 1 페이지</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
