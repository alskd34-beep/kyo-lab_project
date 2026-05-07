'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, CardContent } from '@frontend/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@frontend/components/ui/table'
import { Search, Trash2 } from 'lucide-react'
import type { ManhoursRow } from '@backend/services/manhours'

// ─── 인라인 수정 셀 ────────────────────────────────────────────────────────────
function EditableHoursCell({
  row,
  onSave,
}: {
  row: ManhoursRow
  onSave: (id: string, avgHours: number) => Promise<void>
}) {
  const [editing, setEditing]   = useState(false)
  const [value, setValue]       = useState(String(row.avgHours))
  const [saving, setSaving]     = useState(false)
  const inputRef                = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = async () => {
    const parsed = parseFloat(value)
    if (isNaN(parsed) || parsed < 0) {
      setValue(String(row.avgHours))
      setEditing(false)
      return
    }
    if (parsed === row.avgHours) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(row.id, parsed)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        step={0.01}
        value={value}
        disabled={saving}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setValue(String(row.avgHours)); setEditing(false) }
        }}
        className="w-24 rounded border border-blue-400 bg-white px-2 py-0.5 text-xs text-slate-800 outline-none ring-2 ring-blue-100 tabular-nums"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setValue(String(row.avgHours)); setEditing(true) }}
      title="클릭하여 수정"
      className="rounded px-2 py-0.5 text-xs tabular-nums text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer"
    >
      {row.avgHours.toFixed(2)}
    </button>
  )
}

// ─── 페이지 ────────────────────────────────────────────────────────────────────
export default function ManhoursPage() {
  const [rows, setRows]           = useState<ManhoursRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchValue, setSearch]  = useState('')

  // 초기 데이터 로드
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch('/api/manhours')
      .then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: ManhoursRow[] }>
      })
      .then(data => { if (!cancelled) setRows(data.rows) })
      .catch(err => console.error('[manhours] 목록 로드 실패', err))
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 클라이언트 필터링
  const filtered = useMemo(() => {
    if (!searchValue.trim()) return rows
    const q = searchValue.toLowerCase()
    return rows.filter(r =>
      r.productName.toLowerCase().includes(q) ||
      r.productCode.toLowerCase().includes(q)
    )
  }, [rows, searchValue])

  // 인라인 저장 (낙관적 업데이트)
  const handleSave = async (id: string, avgHours: number) => {
    const prev = rows
    setRows(prev => prev.map(r => r.id === id ? { ...r, avgHours, updatedAt: new Date().toISOString() } : r))
    try {
      const res = await fetch('/api/manhours', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, avgHours }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      console.error('[manhours] 저장 실패', err)
      setRows(prev) // 롤백
    }
  }

  // 삭제
  const handleDelete = async (id: string) => {
    const prev = rows
    setRows(r => r.filter(row => row.id !== id))
    try {
      const res = await fetch('/api/manhours', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      console.error('[manhours] 삭제 실패', err)
      setRows(prev) // 롤백
    }
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '-'
    return iso.slice(0, 10)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 p-5">
        <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0 overflow-hidden">

          {/* 툴바 */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            {/* 제목 + 건수 배지 */}
            <h1 className="text-sm font-semibold text-slate-800 shrink-0">평균공수 관리</h1>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200">
              {filtered.length}건
            </span>

            {/* 검색 */}
            <div className="flex max-w-[240px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all ml-auto">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="품목명, 품목코드..."
                value={searchValue}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* 테이블 */}
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-900 hover:bg-slate-900 border-0">
                {['품목코드', '품목명', '포장단위', '평균공수(시간)', '수정일', '액션'].map(h => (
                  <TableHead
                    key={h}
                    className="text-[11px] font-semibold text-white uppercase tracking-wide px-4 py-3 border-0"
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-slate-400">
                    로딩중...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-slate-400">
                    데이터가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row, idx) => (
                  <TableRow
                    key={row.id}
                    className={`border-slate-100 transition-colors ${
                      idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                    } hover:bg-blue-50/40`}
                  >
                    <TableCell className="px-4 font-mono text-xs text-slate-500">
                      {row.productCode}
                    </TableCell>
                    <TableCell className="px-4 text-sm font-medium text-slate-800">
                      {row.productName}
                    </TableCell>
                    <TableCell className="px-4 text-xs text-slate-600">
                      {row.packageUnit}
                    </TableCell>
                    <TableCell className="px-4">
                      <EditableHoursCell row={row} onSave={handleSave} />
                    </TableCell>
                    <TableCell className="px-4 font-mono text-xs text-slate-400">
                      {formatDate(row.updatedAt)}
                    </TableCell>
                    <TableCell className="px-4">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        title="삭제"
                      >
                        <Trash2 size={13} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* 푸터 */}
          <div className="flex items-center border-t border-slate-100 px-4 py-2.5 bg-slate-50/50">
            <p className="text-xs text-slate-500">
              총 <span className="font-semibold text-slate-700">{filtered.length}</span>건
              {searchValue && rows.length !== filtered.length && (
                <span className="ml-1.5 text-slate-400">
                  (전체 {rows.length}건 중 필터됨)
                </span>
              )}
            </p>
          </div>

        </Card>
      </div>
    </div>
  )
}
