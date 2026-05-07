'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card } from '@frontend/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@frontend/components/ui/table'
import { Button } from '@frontend/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@frontend/components/ui/dialog'
import { Search, Trash2, Plus, Pencil } from 'lucide-react'
import type { ManhoursRow } from '@backend/services/manhours'

interface ProductOption { id: string; productCode: string; name: string }

// ─── 페이지 ────────────────────────────────────────────────────────────────────
export default function ManhoursPage() {
  const [rows, setRows]           = useState<ManhoursRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchValue, setSearch]  = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [products, setProducts]   = useState<ProductOption[]>([])

  // 신규 다이얼로그
  const [createOpen, setCreateOpen]         = useState(false)
  const [productSearch, setProductSearch]   = useState('')
  const [selectedProductId, setSelectedPid] = useState('')
  const [newPackageUnit, setNewPkgUnit]     = useState('')
  const [newAvgHours, setNewAvgHours]       = useState('')
  const [creating, setCreating]             = useState(false)

  // 수정 다이얼로그
  const [editTarget, setEditTarget]   = useState<ManhoursRow | null>(null)
  const [editUnit, setEditUnit]       = useState('')
  const [editHours, setEditHours]     = useState('')
  const [editSaving, setEditSaving]   = useState(false)

  // 삭제 확인 다이얼로그
  const [deleteTarget, setDeleteTarget] = useState<ManhoursRow | null>(null)
  const [deleting, setDeleting]         = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────────
  useEffect(() => { loadManhours() }, [])

  async function loadManhours() {
    setIsLoading(true)
    try {
      const res = await fetch('/api/manhours')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: ManhoursRow[] }
      setRows(data.rows)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  async function loadProducts() {
    if (products.length > 0) return
    try {
      const res = await fetch('/api/products?limit=2000')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: ProductOption[] }
      setProducts(data.rows)
    } catch (err) {
      console.error('[manhours] 품목 로드 실패', err)
    }
  }

  // ── 필터 ──────────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!searchValue.trim()) return rows
    const q = searchValue.toLowerCase()
    return rows.filter(r =>
      r.productName.toLowerCase().includes(q) ||
      r.productCode.toLowerCase().includes(q),
    )
  }, [rows, searchValue])

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products.slice(0, 200)
    return products
      .filter(p => p.name.toLowerCase().includes(q) || p.productCode.toLowerCase().includes(q))
      .slice(0, 200)
  }, [products, productSearch])

  // ── 신규 ──────────────────────────────────────────────────────────────────────
  async function openCreate() {
    setSelectedPid(''); setNewPkgUnit(''); setNewAvgHours('')
    setProductSearch(''); setError(null)
    await loadProducts()
    setCreateOpen(true)
  }

  async function handleCreate() {
    setError(null)
    if (!selectedProductId) { setError('품목을 선택하세요.'); return }
    if (!newPackageUnit.trim()) { setError('포장단위를 입력하세요.'); return }
    const hours = parseFloat(newAvgHours)
    if (isNaN(hours) || hours < 0) { setError('평균공수는 0 이상의 숫자여야 합니다.'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/manhours', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selectedProductId, packageUnit: newPackageUnit.trim(), avgHours: hours }),
      })
      if (!res.ok) { const b = await res.text(); throw new Error((() => { try { return JSON.parse(b).error } catch { return b } })()) }
      await loadManhours()
      setCreateOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  // ── 수정 ──────────────────────────────────────────────────────────────────────
  function openEdit(row: ManhoursRow) {
    setEditTarget(row)
    setEditUnit(row.packageUnit)
    setEditHours(String(row.avgHours))
    setError(null)
  }

  async function handleEdit() {
    if (!editTarget) return
    const unit = editUnit.trim()
    const hours = parseFloat(editHours)
    if (!unit) { setError('포장단위를 입력하세요.'); return }
    if (isNaN(hours) || hours < 0) { setError('평균공수는 0 이상의 숫자여야 합니다.'); return }
    setEditSaving(true)
    try {
      const res = await fetch('/api/manhours', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editTarget.id, packageUnit: unit, avgHours: hours }),
      })
      if (!res.ok) throw new Error(await res.text())
      setRows(prev => prev.map(r =>
        r.id === editTarget.id ? { ...r, packageUnit: unit, avgHours: hours, updatedAt: new Date().toISOString() } : r
      ))
      setEditTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEditSaving(false)
    }
  }

  // ── 삭제 ──────────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch('/api/manhours', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      setRows(prev => prev.filter(r => r.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  const formatDate = (iso: string | null) => iso ? iso.slice(0, 10) : '-'

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 p-5">
        <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0 overflow-hidden">

          {/* 툴바 */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <h1 className="text-sm font-semibold text-slate-800 shrink-0">평균공수 관리</h1>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200">
              {filtered.length}건
            </span>
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
            <Button onClick={openCreate} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-8 shrink-0">
              <Plus size={14} className="mr-1" />신규
            </Button>
          </div>

          {error && !createOpen && !editTarget && !deleteTarget && (
            <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {/* 테이블 */}
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-900 hover:bg-slate-900 border-0">
                {['품목코드', '품목명', '포장단위', '평균공수(시간)', '수정일', '액션'].map(h => (
                  <TableHead key={h} className="sticky top-0 z-10 bg-slate-900 text-[11px] font-semibold text-white uppercase tracking-wide px-4 py-3 border-0">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-slate-400">로딩중...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-slate-400">데이터가 없습니다.</TableCell></TableRow>
              ) : (
                filtered.map((row, idx) => (
                  <TableRow
                    key={row.id}
                    className={`border-slate-100 transition-colors ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'} hover:bg-blue-50/40`}
                  >
                    <TableCell className="px-4 font-mono text-xs text-slate-500">{row.productCode}</TableCell>
                    <TableCell className="px-4 text-sm font-medium text-slate-800">{row.productName}</TableCell>
                    <TableCell className="px-4 text-xs text-slate-700">{row.packageUnit}</TableCell>
                    <TableCell className="px-4 text-xs font-semibold tabular-nums text-slate-700">{row.avgHours.toFixed(2)}</TableCell>
                    <TableCell className="px-4 font-mono text-xs text-slate-400">{formatDate(row.updatedAt)}</TableCell>
                    <TableCell className="px-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(row)}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          title="수정"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => { setError(null); setDeleteTarget(row) }}
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title="삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
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
                <span className="ml-1.5 text-slate-400">(전체 {rows.length}건 중 필터됨)</span>
              )}
            </p>
          </div>
        </Card>
      </div>

      {/* ── 신규 등록 다이얼로그 ─────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>평균공수 신규 등록</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">품목 <span className="text-red-500">*</span></label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 mb-1.5">
                <Search size={13} className="text-slate-400 shrink-0" />
                <input
                  type="text" placeholder="품목명 / 코드 검색..."
                  value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {filteredProducts.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">검색 결과 없음</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredProducts.map(p => {
                      const sel = selectedProductId === p.id
                      return (
                        <li key={p.id}>
                          <button
                            type="button" onClick={() => setSelectedPid(p.id)}
                            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors ${sel ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                          >
                            <span className={`text-[10px] font-mono ${sel ? 'text-blue-500' : 'text-slate-400'}`}>{p.productCode}</span>
                            <span className={`text-xs ${sel ? 'text-blue-700 font-semibold' : 'text-slate-700'}`}>{p.name}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">포장단위 <span className="text-red-500">*</span></label>
                <input
                  type="text" value={newPackageUnit} onChange={e => setNewPkgUnit(e.target.value)}
                  placeholder="예: 100mL, 30T"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">평균공수(시간) <span className="text-red-500">*</span></label>
                <input
                  type="number" min={0} step={0.01} value={newAvgHours} onChange={e => setNewAvgHours(e.target.value)}
                  placeholder="예: 4.5"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
            </div>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>취소</Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !selectedProductId || !newPackageUnit.trim() || !newAvgHours}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {creating ? '등록 중...' : '등록'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 수정 다이얼로그 ──────────────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onOpenChange={v => { if (!v) setEditTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>평균공수 수정</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                <p className="text-[10px] font-mono text-slate-400">{editTarget.productCode}</p>
                <p className="text-sm font-semibold text-slate-800">{editTarget.productName}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">포장단위 <span className="text-red-500">*</span></label>
                  <input
                    type="text" value={editUnit} onChange={e => setEditUnit(e.target.value)}
                    autoFocus
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600">평균공수(시간) <span className="text-red-500">*</span></label>
                  <input
                    type="number" min={0} step={0.01} value={editHours} onChange={e => setEditHours(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
              </div>
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>취소</Button>
            <Button onClick={handleEdit} disabled={editSaving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {editSaving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 삭제 확인 다이얼로그 ─────────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>삭제 확인</DialogTitle></DialogHeader>
          {deleteTarget && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-slate-600">아래 항목을 삭제하시겠습니까?</p>
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-sm">
                <p className="font-semibold text-slate-800">{deleteTarget.productName}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  포장단위: {deleteTarget.packageUnit} · 평균공수: {deleteTarget.avgHours.toFixed(2)}h
                </p>
              </div>
              <p className="text-xs text-red-500">이 작업은 되돌릴 수 없습니다.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>취소</Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
