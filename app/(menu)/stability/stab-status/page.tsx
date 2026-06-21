'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  DatabaseZap,
  FlaskConical,
  RefreshCw,
  Search,
  Sheet,
  Sparkles,
} from 'lucide-react'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Badge } from '@frontend/components/ui/badge'
import { Button } from '@frontend/components/ui/button'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Input } from '@frontend/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@frontend/components/ui/table'

const STABILITY_SHEET_ID = '1gvAtB1ETkCol1gM2mmppOUJTgIidEq1IdGaQaiSXdCg'
const STABILITY_SHEET_URL = `https://docs.google.com/spreadsheets/d/${STABILITY_SHEET_ID}/edit?usp=sharing`
const STORAGE_KEY = 'kd-stability-sheet-snapshot-v1'

interface StabilitySheetRow {
  id: string
  productCode: string
  productName: string
  testType: string
  batchNo: string
  manufacturedAt: string
  expiryDate: string
  reason: string
  period: string
  requestedAt: string
  requestNo: string
  status: string
  source: Record<string, string>
}

interface StabilityResponse {
  fileId: string
  columns: string[]
  rows: Record<string, string>[]
}

type ChangeState = 'new' | 'changed' | 'unchanged'

function pick(row: Record<string, string>, candidates: string[]): string {
  for (const key of candidates) {
    const exact = row[key]?.trim()
    if (exact) return exact
  }

  for (const candidate of candidates) {
    const normalized = candidate.includes('/') ? candidate.split('/').at(-1) : candidate
    const foundKey = Object.keys(row).find(key => {
      const tail = key.includes('/') ? key.split('/').at(-1) : key
      return tail?.replace(/\s/g, '') === normalized?.replace(/\s/g, '')
    })
    const value = foundKey ? row[foundKey]?.trim() : ''
    if (value) return value
  }

  return ''
}

function mapRow(row: Record<string, string>, idx: number): StabilitySheetRow {
  const start = pick(row, ['진행정보/시험기간시작일', '시험기간시작일', '기간시작일', '시작일'])
  const end = pick(row, ['진행정보/시험기간종료일', '시험기간종료일', '기간종료일', '종료일'])
  const period = pick(row, ['안정성시험 계획 정보/기간', '진행정보/기간', '기간']) || [start, end].filter(Boolean).join(' ~ ')
  const productCode = pick(row, ['안정성시험 계획 정보/품목코드', '품목코드', '자재코드'])
  const batchNo = pick(row, ['안정성시험 계획 정보/제조번호', '제조번호', 'Lot', 'Lot No'])
  const requestNo = pick(row, ['진행정보/의뢰번호', '상세정보/의뢰번호', '의뢰번호', '외뢰번호'])

  return {
    id: `${productCode || 'unknown'}-${batchNo || requestNo || idx}`,
    productCode,
    productName: pick(row, ['안정성시험 계획 정보/품목', '품목', '품목명', '자재내역']),
    testType: pick(row, ['안정성시험 계획 정보/시험종류', '시험종류', '시험유형']),
    batchNo,
    manufacturedAt: pick(row, ['상세정보/제조일자', '안정성시험 계획 정보/제조일자', '제조일자', '제조일']),
    expiryDate: pick(row, ['상세정보/사용기한', '안정성시험 계획 정보/사용기한', '사용기한', '유효기간']),
    reason: pick(row, ['상세정보/실시사유', '안정성시험 계획 정보/실시사유', '실시사유', '사유']),
    period,
    requestedAt: pick(row, ['진행정보/의뢰일자', '상세정보/의뢰일자', '의뢰일자', '의뢰일']),
    requestNo,
    status: pick(row, ['진행정보/시험상태', '안정성시험 계획 정보/진행상태', '진행상태', '시험상태', '상태']) || '미확인',
    source: row,
  }
}

function makeSignature(rows: StabilitySheetRow[]): string {
  return JSON.stringify(
    rows.map(row => ({
      productCode: row.productCode,
      productName: row.productName,
      testType: row.testType,
      batchNo: row.batchNo,
      manufacturedAt: row.manufacturedAt,
      expiryDate: row.expiryDate,
      reason: row.reason,
      period: row.period,
      requestedAt: row.requestedAt,
      requestNo: row.requestNo,
      status: row.status,
    })),
  )
}

function getStatusClass(status: string): string {
  const value = status.replace(/\s/g, '')
  if (/(완료|종료|승인)/.test(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (/(진행|시험중|분석중|의뢰)/.test(value)) return 'border-blue-200 bg-blue-50 text-blue-700'
  if (/(대기|예정|준비)/.test(value)) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (/(보류|지연|중단|취소)/.test(value)) return 'border-red-200 bg-red-50 text-red-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function isScheduleCandidate(row: StabilitySheetRow): boolean {
  const status = row.status.replace(/\s/g, '')
  return !!row.productCode && !/(완료|종료|취소|중단)/.test(status)
}

function formatSyncTime(date: Date | null): string {
  if (!date) return '-'
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type SortField = keyof Pick<
  StabilitySheetRow,
  'productCode' | 'productName' | 'testType' | 'batchNo' | 'manufacturedAt' | 'expiryDate' | 'reason' | 'period' | 'requestedAt' | 'requestNo' | 'status'
>
type SortDir = 'asc' | 'desc'

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField | null; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronDown size={12} className="ml-0.5 opacity-30" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="ml-0.5 text-foreground" />
    : <ChevronDown size={12} className="ml-0.5 text-foreground" />
}

export default function StabStatusPage() {
  const [rows, setRows] = useState<StabilitySheetRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [changeState, setChangeState] = useState<ChangeState>('unchanged')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const loadSheet = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/google-sheet/stability?fileId=${encodeURIComponent(STABILITY_SHEET_ID)}`, {
        credentials: 'include',
      })
      const json = await res.json() as StabilityResponse & { error?: string }
      if (!res.ok) throw new Error(json.error ?? '안정성 시트를 불러오지 못했습니다')

      const mapped = (json.rows ?? [])
        .map(mapRow)
        .filter(row => row.productCode || row.productName || row.batchNo)
      const signature = makeSignature(mapped)
      const previous = localStorage.getItem(STORAGE_KEY)

      setRows(mapped)
      setSyncedAt(new Date())
      setChangeState(previous ? (previous === signature ? 'unchanged' : 'changed') : 'new')
      localStorage.setItem(STORAGE_KEY, signature)
    } catch (err) {
      setError(err instanceof Error ? err.message : '안정성 시트 연동 오류')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSheet()
  }, [])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row =>
      [
        row.productCode,
        row.productName,
        row.testType,
        row.batchNo,
        row.reason,
        row.requestNo,
        row.status,
      ].some(value => value.toLowerCase().includes(q)),
    )
  }, [query, rows])

  const sortedRows = useMemo(() => {
    if (!sortField) return filteredRows
    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortField] ?? ''
      const bVal = b[sortField] ?? ''
      const cmp = aVal.localeCompare(bVal, 'ko')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredRows, sortField, sortDir])

  const stats = useMemo(() => {
    const active = rows.filter(isScheduleCandidate).length
    const completed = rows.filter(row => /(완료|종료|승인)/.test(row.status.replace(/\s/g, ''))).length
    const uniqueProducts = new Set(rows.map(row => row.productCode).filter(Boolean)).size
    const requestCount = rows.filter(row => row.requestNo || row.requestedAt).length
    return { active, completed, uniqueProducts, requestCount }
  }, [rows])

  return (
    <div className="flex min-h-0 flex-col gap-4 p-3 md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">안정성 현황</h1>
            <Badge className="border-violet-200 bg-violet-50 text-violet-700" variant="outline">
              Google Sheet 기준
            </Badge>
            {changeState === 'changed' && (
              <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
                <DatabaseZap size={12} /> 변경 감지
              </Badge>
            )}
            {changeState === 'new' && (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700" variant="outline">
                <Sparkles size={12} /> 최초 동기화
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            시트의 안정성 품목을 기준으로 품목코드 매칭 시 스케줄 동시분석 후보로 표시합니다.
          </p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
            <Clock3 size={12} /> 최종 확인 {formatSyncTime(syncedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9 gap-2"
            onClick={() => window.open(STABILITY_SHEET_URL, '_blank', 'noopener,noreferrer')}
          >
            <Sheet size={15} />
            원본 시트
            <ArrowUpRight size={13} />
          </Button>
          <Button className="h-9 gap-2 bg-slate-900 hover:bg-slate-800" onClick={loadSheet} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            새로고침
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <Card className="rounded-xl border-slate-200 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">전체 건수</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-blue-100 bg-blue-50/50 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-blue-700">
              <CalendarClock size={13} /> 스케줄 후보
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-700">{stats.active}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-emerald-100 bg-emerald-50/50 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 size={13} /> 완료
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-violet-100 bg-violet-50/50 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-violet-700">
              <FlaskConical size={13} /> 품목코드
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-violet-700">{stats.uniqueProducts}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 rounded-xl border-slate-200 py-0 shadow-none lg:col-span-1">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <DatabaseZap size={13} /> 의뢰 정보
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-800">{stats.requestCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="min-h-0 gap-0 overflow-hidden rounded-xl border-slate-200 bg-white py-0 shadow-none">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">시트 반영 목록</span>
            <Badge className="border-slate-200 bg-slate-50 text-slate-600" variant="outline">
              {filteredRows.length}건 표시
            </Badge>
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="품목코드, 품목, 제조번호, 상태 검색"
              className="h-9 pl-9"
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-red-600">
            <AlertCircle size={18} />
            {error}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('productCode')}>
                  <span className="flex items-center">품목코드<SortIcon field="productCode" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="min-w-[220px] cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('productName')}>
                  <span className="flex items-center">품목<SortIcon field="productName" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('testType')}>
                  <span className="flex items-center">시험종류<SortIcon field="testType" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('batchNo')}>
                  <span className="flex items-center">제조번호<SortIcon field="batchNo" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('manufacturedAt')}>
                  <span className="flex items-center">제조일자<SortIcon field="manufacturedAt" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('expiryDate')}>
                  <span className="flex items-center">사용기한<SortIcon field="expiryDate" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="min-w-[160px] cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('reason')}>
                  <span className="flex items-center">실시사유<SortIcon field="reason" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="min-w-[150px] cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('period')}>
                  <span className="flex items-center">기간<SortIcon field="period" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('requestedAt')}>
                  <span className="flex items-center">의뢰일자<SortIcon field="requestedAt" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('requestNo')}>
                  <span className="flex items-center">의뢰번호<SortIcon field="requestNo" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="cursor-pointer select-none px-3 text-muted-foreground" onClick={() => toggleSort('status')}>
                  <span className="flex items-center">시험상태<SortIcon field="status" sortField={sortField} sortDir={sortDir} /></span>
                </TableHead>
                <TableHead className="px-3 text-muted-foreground">스케줄</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16 rounded-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-14 rounded-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20 rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-32 text-center text-sm text-muted-foreground">
                    표시할 안정성 품목이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="px-3 py-2.5 font-mono text-xs font-medium text-foreground">
                      {row.productCode || '-'}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="max-w-[280px] truncate font-medium text-foreground">
                        {row.productName || '-'}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge className="border-violet-200 bg-violet-50 text-violet-700" variant="outline">
                        {row.testType || '미분류'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.batchNo || '-'}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.manufacturedAt || '-'}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.expiryDate || '-'}</TableCell>
                    <TableCell className="px-3 py-2.5">
                      <span className="block max-w-[220px] truncate text-xs text-muted-foreground">{row.reason || '-'}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.period || '-'}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.requestedAt || '-'}</TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.requestNo || '-'}</TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge className={getStatusClass(row.status)} variant="outline">
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {isScheduleCandidate(row) ? (
                        <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
                          동시분석 후보
                        </Badge>
                      ) : (
                        <Badge className="border-slate-200 bg-slate-50 text-slate-500" variant="outline">
                          제외
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
