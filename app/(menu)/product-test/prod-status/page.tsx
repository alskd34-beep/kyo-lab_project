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
import { format, differenceInCalendarDays, subMonths } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { Calendar as CalendarIcon, Search, Download } from 'lucide-react'

type BatchStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED'

interface Batch {
  id: number
  productCode: string
  productName: string
  spec: string
  batchNo: string
  dosageForm: string
  packagingDate: string
  recordReviewDeadline: string
  qcPlannedDate: string
  status: BatchStatus
}

const DEMO_BATCHES: Batch[] = [
  { id: 1, productCode: '21081', productName: '(사향)광동우황청심원현탁액(신)', spec: '50ML', batchNo: '26002', dosageForm: '현탁제', packagingDate: '2026.04.10', recordReviewDeadline: '2026.04.24', qcPlannedDate: '2026.04.24', status: 'COMPLETED' },
  { id: 2, productCode: '21350', productName: '슬라임캡슐', spec: '120C', batchNo: '26001', dosageForm: '내용고형제', packagingDate: '2026.03.30', recordReviewDeadline: '2026.04.27', qcPlannedDate: '2026.04.27', status: 'COMPLETED' },
  { id: 3, productCode: '23263', productName: '베니톨정', spec: '500T', batchNo: '26023', dosageForm: '내용고형제', packagingDate: '2026.04.16', recordReviewDeadline: '2026.04.30', qcPlannedDate: '2026.04.30', status: 'IN_PROGRESS' },
  { id: 4, productCode: '23263', productName: '베니톨정', spec: '500T', batchNo: '26024', dosageForm: '내용고형제', packagingDate: '2026.04.16', recordReviewDeadline: '2026.04.30', qcPlannedDate: '2026.04.30', status: 'IN_PROGRESS' },
  { id: 5, productCode: '23262', productName: '베니톨정', spec: '90T', batchNo: '26027', dosageForm: '내용고형제', packagingDate: '2026.04.21', recordReviewDeadline: '2026.04.30', qcPlannedDate: '2026.04.30', status: 'PLANNED' },
  { id: 6, productCode: '21391', productName: '알도셉트정5mg', spec: '30T', batchNo: '26001', dosageForm: '내용고형제', packagingDate: '2026.04.06', recordReviewDeadline: '2026.04.30', qcPlannedDate: '2026.04.30', status: 'IN_PROGRESS' },
  { id: 7, productCode: '24101', productName: '개풍경옥고', spec: '100G', batchNo: '26005', dosageForm: '전제', packagingDate: '2026.04.20', recordReviewDeadline: '2026.05.07', qcPlannedDate: '2026.05.07', status: 'PLANNED' },
  { id: 8, productCode: '22301', productName: '광동우황청심원', spec: '1환', batchNo: '26010', dosageForm: '환제', packagingDate: '2026.04.25', recordReviewDeadline: '2026.05.10', qcPlannedDate: '2026.05.10', status: 'PLANNED' },
]

const STATUS_CONFIG: Record<BatchStatus, { label: string; cls: string }> = {
  PLANNED:     { label: '계획',  cls: 'bg-slate-100 text-slate-600 border border-slate-200' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-violet-50 text-violet-700 border border-violet-200' },
  COMPLETED:   { label: '완료',  cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  ON_HOLD:     { label: '보류',  cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  CANCELLED:   { label: '취소',  cls: 'bg-red-50 text-red-700 border border-red-200' },
}

const STATUS_FILTERS = ['전체', '계획', '진행중', '완료'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

function parseDateStr(dateStr: string): Date {
  return new Date(dateStr.replace(/\./g, '-'))
}

function calcDDay(qcPlannedDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = parseDateStr(qcPlannedDate)
  return differenceInCalendarDays(target, today)
}

function DDayCell({ dDay, status }: { dDay: number; status: BatchStatus }) {
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return <span className="text-xs text-slate-400">-</span>
  }
  if (dDay <= 0) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
        D+{Math.abs(dDay)}
      </span>
    )
  }
  if (dDay <= 3) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
        D-{dDay}
      </span>
    )
  }
  if (dDay <= 7) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        D-{dDay}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      D-{dDay}
    </span>
  )
}

export default function ProdStatusPage() {
  const [batches, setBatches]           = useState<Batch[]>(DEMO_BATCHES)
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
    if (statusFilter !== '전체') params.set('status', statusFilter)

    setIsLoading(true)
    fetch(`/api/batches?${params.toString()}`)
      .then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: Batch[] }>
      })
      .then(({ rows }) => {
        if (cancelled) return
        if (rows.length > 0) {
          setBatches(rows)
          setUsingDemo(false)
        } else {
          setBatches(DEMO_BATCHES)
          setUsingDemo(true)
        }
      })
      .catch(() => {
        if (cancelled) return
        setBatches(DEMO_BATCHES)
        setUsingDemo(true)
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })

    return () => { cancelled = true }
  }, [dateRange, searchValue, statusFilter])

  const filtered = useMemo(() => {
    let rows = batches
    if (usingDemo) {
      if (searchValue) {
        rows = rows.filter(r =>
          r.productName.includes(searchValue) || r.batchNo.includes(searchValue)
        )
      }
      if (statusFilter !== '전체') {
        const statusMap: Record<StatusFilter, BatchStatus | null> = {
          '전체': null, '계획': 'PLANNED', '진행중': 'IN_PROGRESS', '완료': 'COMPLETED',
        }
        const targetStatus = statusMap[statusFilter]
        if (targetStatus) rows = rows.filter(r => r.status === targetStatus)
      }
    }
    return rows
  }, [batches, usingDemo, searchValue, statusFilter])

  const kpi = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const active = batches.filter(b => b.status !== 'CANCELLED')
    return {
      total:      active.length,
      inProgress: active.filter(b => b.status === 'IN_PROGRESS').length,
      completed:  active.filter(b => b.status === 'COMPLETED').length,
      within7:    active.filter(b => {
        const d = calcDDay(b.qcPlannedDate)
        return b.status !== 'COMPLETED' && d >= 1 && d <= 7
      }).length,
      within3:    active.filter(b => {
        const d = calcDDay(b.qcPlannedDate)
        return b.status !== 'COMPLETED' && d >= 1 && d <= 3
      }).length,
    }
  }, [batches])

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
    { label: '전체 배치',      value: kpi.total,      accent: 'text-slate-800',   bg: 'bg-white',         border: 'border-slate-200',  sub: '취소 제외 전체' },
    { label: '진행중',         value: kpi.inProgress, accent: 'text-violet-600',  bg: 'bg-violet-50/60',  border: 'border-violet-100', sub: '시험 진행 중' },
    { label: 'QC 완료',        value: kpi.completed,  accent: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-100',sub: '시험 완료' },
    { label: 'D-7 이내',       value: kpi.within7,   accent: 'text-amber-600',   bg: 'bg-amber-50/60',   border: 'border-amber-100',  sub: '기한 임박' },
    { label: 'D-3 이내',       value: kpi.within3,   accent: 'text-red-600',     bg: 'bg-red-50/60',     border: 'border-red-100',    sub: '위험' },
  ]

  return (
    <div className="flex flex-1 flex-col">

      {/* KPI */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-5 gap-2.5 px-5 py-3">
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
      <div className="flex-1 p-5">
        <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0 overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 flex-wrap">
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
            <div className="flex items-center gap-1">
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
            <div className="flex max-w-[220px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="품목명, 제조번호..."
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 rounded-lg shadow-none">
                <Download size={12} />
                Excel
              </Button>
            </div>
          </div>

          {/* Table */}
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
                {['품목코드', '품목명', '규격', '제조번호', '제형', '포장일(예정)', '기록서검토기한', 'QC완료예정일', 'D-Day', '상태'].map(h => (
                  <TableHead key={h} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide px-3">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(row => {
                const isSelected = selectedRows.has(row.id)
                const dDay = calcDDay(row.qcPlannedDate)
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
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.productCode}</TableCell>
                    <TableCell className="px-3">
                      <span className="text-sm font-medium text-slate-800">{row.productName}</span>
                    </TableCell>
                    <TableCell className="px-3 text-xs text-slate-600">{row.spec}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.batchNo}</TableCell>
                    <TableCell className="px-3 text-xs text-slate-600">{row.dosageForm}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.packagingDate}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.recordReviewDeadline}</TableCell>
                    <TableCell className="px-3 font-mono text-xs text-slate-500">{row.qcPlannedDate}</TableCell>
                    <TableCell className="px-3">
                      <DDayCell dDay={dDay} status={row.status} />
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

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 bg-slate-50/50">
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
