'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
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
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
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
    id: `${productCode || 'unknown'}-${batchNo || 'no-batch'}-${requestNo || 'no-request'}-${idx}`,
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

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: 'product',
    label: '품목',
    fields: [
      { id: 'productName', label: '품목' },
      { id: 'productCode', label: '품목코드' },
    ],
  },
  {
    key: 'test',
    label: '시험',
    fields: [
      { id: 'testType', label: '시험종류' },
      { id: 'period', label: '기간' },
    ],
  },
  {
    key: 'dates',
    label: '일자',
    // 본문이 제조/기한/의뢰 3줄을 한 칸에 그리므로 칸을 나누지 않는다.
    // (정렬 선택지는 3개 그대로 유지)
    noSplit: true,
    fields: [
      { id: 'manufacturedAt', label: '제조일자' },
      { id: 'expiryDate', label: '사용기한' },
      { id: 'requestedAt', label: '의뢰일자' },
    ],
  },
  sortCol('status', '상태'),
]

const STAB_COL_COUNT = 4

export default function StabStatusPage() {
  const [rows, setRows] = useState<StabilitySheetRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [changeState, setChangeState] = useState<ChangeState>('unchanged')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function pickSort(field: SortField, dir: SortDir) {
    setSortField(field)
    setSortDir(dir)
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">안정성 현황</h1>
            <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
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
        <Card className="rounded-md border-slate-200 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">전체 건수</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{rows.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-md border-blue-100 bg-blue-50/50 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-blue-700">
              <CalendarClock size={13} /> 스케줄 후보
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-700">{stats.active}</p>
          </CardContent>
        </Card>
        <Card className="rounded-md border-emerald-100 bg-emerald-50/50 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 size={13} /> 완료
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card className="rounded-md border-blue-100 bg-blue-50/50 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-blue-700">
              <FlaskConical size={13} /> 품목코드
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-700">{stats.uniqueProducts}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 rounded-md border-slate-200 py-0 shadow-none lg:col-span-1">
          <CardContent className="px-4 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <DatabaseZap size={13} /> 의뢰 정보
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-800">{stats.requestCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="min-h-0 gap-0 overflow-hidden rounded-md border-slate-200 bg-white py-0 shadow-none">
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
            {/* 논리 열 4개(품목·시험·일자·상태) + 다필드 묶음 3개 → 최대 7칸.
                칸 순서(펼침 / 합침):
                품목명/품목 · 품목코드/시험 · 시험종류/일자 · 기간/상태 · 제조일자 · 유효일 · 상태 */}
            {/* 논리 열 4개(품목·시험·일자·상태) + 2필드 묶음 2개 → 최대 6칸.
                일자는 noSplit 이라 나뉘지 않는다.
                칸 순서(펼침 / 합침): 품목/품목 · 품목코드/시험 · 시험종류/일자 · 기간/상태 · 일자 · 상태 */}
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[15%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
              <col className="w-[15%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {SORT_COLUMNS.map(col => (
                  <TableHead key={col.key} className="px-3 text-muted-foreground">
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
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-8 w-40" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-8 w-24" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-8 w-28" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-8 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={STAB_COL_COUNT} className="h-32 text-center text-sm text-muted-foreground">
                    표시할 안정성 품목이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="px-3 py-2.5">
                      <CellStack
                        primary={row.productName || '—'}
                        secondary={row.productCode || undefined}
                        primaryClass="font-medium text-foreground"
                        title={[row.productName, row.productCode].filter(Boolean).join(' / ')}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <CellStack
                        primary={row.testType || '미분류'}
                        secondary={row.period || undefined}
                        title={[row.testType, row.period].filter(Boolean).join(' / ')}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="min-w-0 text-[11px] leading-4 text-muted-foreground" title={`제조 ${row.manufacturedAt || '—'} / 기한 ${row.expiryDate || '—'} / 의뢰 ${row.requestedAt || '—'}`}>
                        <div className="truncate">제조 {row.manufacturedAt || '—'}</div>
                        <div className="truncate">기한 {row.expiryDate || '—'}</div>
                        <div className="truncate">의뢰 {row.requestedAt || '—'}</div>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="min-w-0">
                        <Badge className={getStatusClass(row.status)} variant="outline">
                          {row.status}
                        </Badge>
                        <div className="mt-1">
                          {isScheduleCandidate(row) ? (
                            <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
                              동시분석 후보
                            </Badge>
                          ) : (
                            <Badge className="border-slate-200 bg-slate-50 text-slate-500" variant="outline">
                              제외
                            </Badge>
                          )}
                        </div>
                      </div>
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
