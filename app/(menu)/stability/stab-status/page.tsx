'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  ChartColumn,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  FlaskConical,
  RefreshCw,
  Search,
  Sheet,
} from 'lucide-react'
import { MobileFilterPanel } from '@frontend/components/common/mobile-filter-panel'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Badge } from '@frontend/components/ui/badge'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { Input } from '@frontend/components/ui/input'
import { cn } from '@frontend/lib/utils'
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
  // 완료·승인은 파랑 램프의 끝(짙은 파랑)이다 — 진행(연한 파랑)에서 색이 진해지며 끝난다.
  // 연한 칩은 밝은 배경 전제라 다크에서 흰 알약처럼 뜬다 — 명도만 뒤집은 `dark:` 짝을 함께 둔다.
  if (/(완료|종료|승인)/.test(value)) return 'border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-600 dark:bg-blue-900/60 dark:text-blue-200'
  if (/(진행|시험중|분석중|의뢰)/.test(value)) return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300'
  if (/(대기|예정|준비)/.test(value)) return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
  if (/(보류|지연|중단|취소)/.test(value)) return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
  // 분류되지 않은 상태는 색을 주지 않고 중립 토큰으로 둔다.
  return 'border bg-muted/50 text-muted-foreground'
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 머리말 — 제목 옆의 'Google Sheet 기준' 배지는 옆의 '원본 시트' 버튼이 이미
          말하고 있어 뺐다. 배지는 상태(변경 감지·최초 동기화)에만 남긴다. */}
      <header className="flex min-w-0 shrink-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">안정성 현황</h1>
            {changeState === 'changed' && (
              <Badge className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" variant="outline">
                변경 감지
              </Badge>
            )}
            {changeState === 'new' && (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" variant="outline">
                최초 동기화
              </Badge>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs leading-normal break-keep text-muted-foreground">
            <Clock3 size={12} className="shrink-0" />
            <span className="tabular-nums">최종 확인 {formatSyncTime(syncedAt)}</span>
            <span className="px-0.5 text-border">·</span>
            품목코드가 맞는 건은 스케줄 동시분석 후보로 표시합니다
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9 gap-2"
            onClick={() => window.open(STABILITY_SHEET_URL, '_blank', 'noopener,noreferrer')}
          >
            <Sheet size={15} />
            원본 시트
            <ArrowUpRight size={13} />
          </Button>
          {/* 검정 버튼은 브랜드색이 아니다 — 기본(파랑) 버튼으로 되돌린다 */}
          <Button className="h-9 gap-2" onClick={loadSheet} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            새로고침
          </Button>
        </div>
      </header>

      {/* 지표 칸 — 칸마다 파랑·초록 배경을 깔던 것을 걷어냈다. 여기엔 경보가 없고,
          다섯 칸이 서로 다른 색을 두르면 색이 의미를 잃는다. 위계는 숫자 크기가 만든다.

          모바일에서는 이 다섯 칸이 세로로 세 줄(280px 가까이) 쌓여 정작 봐야 할
          시트 목록을 화면 밖으로 밀어냈다. 접어 두고 가장 중요한 두 수치만 막대에 남긴다 —
          목록이 몇 건인지는 아래 「시트 반영 목록」 제목이 따로 말하고 있다. */}
      <MobileFilterPanel
        icon={ChartColumn}
        label="요약"
        summary={`전체 ${rows.length}건 · 스케줄 후보 ${stats.active}건`}
      >
      <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:grid-cols-5">
        {[
          { label: '전체 건수', value: rows.length, icon: null },
          { label: '스케줄 후보', value: stats.active, icon: <CalendarClock size={13} /> },
          { label: '완료', value: stats.completed, icon: <CheckCircle2 size={13} /> },
          { label: '품목코드', value: stats.uniqueProducts, icon: <FlaskConical size={13} /> },
          { label: '의뢰 정보', value: stats.requestCount, icon: <DatabaseZap size={13} /> },
        ].map((tile, i, all) => (
          <Card
            key={tile.label}
            className={cn(
              /* 펼쳤을 때도 모바일은 라벨·숫자를 한 줄로 눕힌다. sm 부터는 원래의 세로 쌓기. */
              'min-h-8 min-w-0 flex-row items-center justify-between gap-1 px-2 py-1 shadow-none',
              /* sm:justify-start — 격자는 칸 높이를 서로 맞추므로(stretch), justify-between 을
                 남겨 두면 짧은 칸에서 숫자가 바닥에 붙어 원래 모양과 달라진다. */
              'sm:flex-col sm:items-stretch sm:justify-start sm:gap-0 sm:px-4 sm:py-3',
              i === all.length - 1 && 'col-span-2 lg:col-span-1',
            )}
          >
            <p className="flex min-w-0 items-center gap-1 text-xs leading-normal font-medium text-muted-foreground">
              {tile.icon}
              <span className="min-w-0 truncate">{tile.label}</span>
            </p>
            {loading ? (
              <Skeleton className="h-4 w-8 shrink-0 sm:mt-1.5 sm:h-7 sm:w-12" />
            ) : (
              <p className="min-w-0 shrink-0 truncate text-sm font-semibold tabular-nums text-foreground sm:mt-1 sm:text-2xl">{tile.value}</p>
            )}
          </Card>
        ))}
      </div>
      </MobileFilterPanel>

      {/* shrink-0: Card 는 overflow-hidden 이라 세로 스크롤 컨테이너 안에서
          min-height 가 0 이 되고, 행이 늘어나는 순간 선 하나로 찌부러진다. */}
      <Card className="shrink-0 gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          {/* 건수 배지는 제목이 이미 하는 말을 되풀이한다 — 배지를 빼고 잔글씨로 내린다 */}
          <h2 className="text-sm font-semibold text-foreground">
            시트 반영 목록
            {!loading && (
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                {filteredRows.length}건{filteredRows.length !== rows.length ? ` / 전체 ${rows.length}건` : ''}
              </span>
            )}
          </h2>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="품목코드, 품목, 제조번호, 상태 검색"
              className="h-9 pl-9"
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm break-keep text-destructive">
            <AlertCircle size={18} className="shrink-0" />
            {error}
          </div>
        ) : (
          <>
          {/* ── 모바일: 표 대신 카드 목록 ────────────────────────────────────
              6칸짜리 표는 320px 에 못 들어간다. 품목·상태·시험종류·후보 여부만 남긴다. */}
          <div className="divide-y md:hidden">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-2 px-4 py-3">
                    <Skeleton className="h-4 w-2/3" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))
              : filteredRows.length === 0
                ? <p className="px-4 py-10 text-center text-sm break-keep text-muted-foreground">표시할 안정성 품목이 없습니다.</p>
                : sortedRows.map(row => (
                    <div key={row.id} className="px-4 py-3">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {row.productName || '—'}
                        </p>
                        <Badge className={getStatusClass(row.status)} variant="outline">{row.status}</Badge>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal text-muted-foreground">
                        {row.productCode && <span className="shrink-0 font-mono">{row.productCode}</span>}
                        <span className="min-w-0 truncate">{row.testType || '미분류'}</span>
                        <span className="ml-auto shrink-0">
                          {isScheduleCandidate(row)
                            ? <span className="font-medium text-blue-700 dark:text-blue-300">동시분석 후보</span>
                            : '후보 제외'}
                        </span>
                      </div>
                    </div>
                  ))}
          </div>

          {/* ── 데스크톱: 표 ─────────────────────────────────────────────── */}
          <div className="hidden md:block">
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
                      <div className="min-w-0 text-xs leading-4 tabular-nums text-muted-foreground" title={`제조 ${row.manufacturedAt || '—'} / 기한 ${row.expiryDate || '—'} / 의뢰 ${row.requestedAt || '—'}`}>
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
                        {/* 배지를 두 개 겹치면 무엇이 상태인지 흐려진다.
                            해당될 때만 배지를 달고, 아닐 때는 잔글씨로 남긴다. */}
                        <div className="mt-1">
                          {isScheduleCandidate(row) ? (
                            <Badge className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" variant="outline">
                              동시분석 후보
                            </Badge>
                          ) : (
                            <span className="text-xs leading-normal text-muted-foreground">후보 제외</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
          </>
        )}
      </Card>
    </div>
  )
}
