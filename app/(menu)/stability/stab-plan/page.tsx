'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@frontend/components/ui/badge'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { Input } from '@frontend/components/ui/input'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@frontend/components/ui/table'
import {
  STABILITY_SHEET_ID,
  getStabilityStatusClass,
  isStabilitySummaryRow,
  mapRow,
  type StabilitySheetRow,
} from '@frontend/lib/stability-sheet'

interface StabilityResponse { rows: Record<string, string>[] }

export default function StabPlanPage() {
  const [rows, setRows] = useState<StabilitySheetRow[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRows = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/google-sheet/stability?fileId=${encodeURIComponent(STABILITY_SHEET_ID)}`, { credentials: 'include' })
      const json = await response.json() as StabilityResponse & { error?: string }
      if (!response.ok) throw new Error(json.error ?? '안정성 시험계획을 불러오지 못했습니다')
      setRows((json.rows ?? []).map(mapRow).filter(row => !isStabilitySummaryRow(row) && (row.productCode || row.productName || row.batchNo)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '안정성 시험계획 연동 오류')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRows() }, [])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row => [row.productCode, row.productName, row.testType, row.batchNo, row.period, row.requestNo, row.status, ...(!row.approved ? ['미승인'] : [])].some(value => value.toLowerCase().includes(q)))
  }, [query, rows])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">안정성시험 · 시험계획</h1>
          <p className="mt-1 text-xs leading-normal text-muted-foreground">승인 전 품목을 포함한 전체 안정성 시험계획 정보입니다.</p>
        </div>
        <Button className="h-9 gap-2" onClick={loadRows} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> 새로고침
        </Button>
      </header>
      <Card className="shrink-0 gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-semibold">시험계획 목록 {!loading && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{filteredRows.length}건</span>}</h2>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="품목코드, 품목, 제조번호, 상태 검색" className="h-9 pl-9" />
          </div>
        </div>
        {error ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-destructive"><AlertCircle size={18} />{error}</div>
        ) : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>품목</TableHead><TableHead>시험</TableHead><TableHead>제조번호</TableHead><TableHead>기간·의뢰</TableHead><TableHead>상태</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? Array.from({ length: 5 }).map((_, index) => <TableRow key={index}>{Array.from({ length: 5 }).map((__, cell) => <TableCell key={cell}><Skeleton className="h-8 w-full" /></TableCell>)}</TableRow>)
                : filteredRows.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-sm text-muted-foreground">표시할 안정성 품목이 없습니다.</TableCell></TableRow>
                : filteredRows.map(row => <TableRow key={row.id}>
                  <TableCell><div className="min-w-0"><div className="truncate font-medium">{row.productName || '—'}</div><div className="truncate text-xs leading-normal text-muted-foreground">{row.productCode || '품목코드 없음'}</div></div></TableCell>
                  <TableCell><div className="truncate">{row.testType || '미분류'}</div><div className="truncate text-xs leading-normal text-muted-foreground">{row.period || '기간 없음'}</div></TableCell>
                  <TableCell className="text-xs leading-normal">{row.batchNo || '—'}</TableCell>
                  <TableCell className="text-xs leading-normal text-muted-foreground"><div>{row.manufacturedAt || '제조일 없음'} · {row.expiryDate || '사용기한 없음'}</div><div>{row.requestNo || '의뢰번호 없음'} · {row.requestedAt || '의뢰일 없음'}</div></TableCell>
                  <TableCell>
                    <Badge className={getStabilityStatusClass(row.status, row.approved)} variant="outline">{row.status || '미확인'}</Badge>
                    {!row.approved && <div className="mt-1 text-xs leading-normal text-amber-700 dark:text-amber-300">현재 상태: {row.status} · 계획 수립 가능</div>}
                  </TableCell>
                </TableRow>)}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
