'use client'

import { useState, useEffect, useMemo } from 'react'
import { Pencil, Trash2, Plus, Search } from 'lucide-react'
import { Badge } from '@frontend/components/ui/badge'
import { Button } from '@frontend/components/ui/button'
import { Input } from '@frontend/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@frontend/components/ui/dialog'

interface ProductRow {
  id: string
  productCode: string
  name: string
  nameAlt: string | null
  unit: string | null
  productType: string | null
  packageSpec: string | null
  isActive: boolean
  sortOrder: number
}

interface FormState {
  productCode: string
  name: string
  nameAlt: string
  productType: string
  unit: string
  packageSpec: string
}

const EMPTY_FORM: FormState = {
  productCode: '',
  name: '',
  nameAlt: '',
  productType: '',
  unit: '',
  packageSpec: '',
}

export default function ProductsPage() {
  const [rows, setRows]               = useState<ProductRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [editTarget, setEditTarget]   = useState<ProductRow | null>(null)
  const [form, setForm]               = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadProducts()
  }, [])

  async function loadProducts() {
    setLoading(true)
    try {
      const res = await fetch('/api/products')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: ProductRow[] }
      setRows(data.rows)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Filtered rows ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      r =>
        r.name.toLowerCase().includes(q) ||
        r.productCode.toLowerCase().includes(q),
    )
  }, [rows, search])

  // ── Open add dialog ──────────────────────────────────────────────────────────
  function openAdd() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  // ── Open edit dialog ─────────────────────────────────────────────────────────
  function openEdit(row: ProductRow) {
    setEditTarget(row)
    setForm({
      productCode: row.productCode,
      name: row.name,
      nameAlt: row.nameAlt ?? '',
      productType: row.productType ?? '',
      unit: row.unit ?? '',
      packageSpec: row.packageSpec ?? '',
    })
    setDialogOpen(true)
  }

  // ── Save (add or edit) ───────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.productCode.trim() || !form.name.trim()) return
    setSaving(true)
    try {
      if (editTarget) {
        // PATCH
        const res = await fetch('/api/products', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editTarget.id,
            name: form.name,
            nameAlt: form.nameAlt || null,
            productType: form.productType || null,
            unit: form.unit || null,
            packageSpec: form.packageSpec || null,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        setRows(prev =>
          prev.map(r =>
            r.id === editTarget.id
              ? {
                  ...r,
                  name: form.name,
                  nameAlt: form.nameAlt || null,
                  productType: form.productType || null,
                  unit: form.unit || null,
                  packageSpec: form.packageSpec || null,
                }
              : r,
          ),
        )
      } else {
        // POST
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productCode: form.productCode,
            name: form.name,
            nameAlt: form.nameAlt || null,
            productType: form.productType || null,
            unit: form.unit || null,
            packageSpec: form.packageSpec || null,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        await loadProducts()
      }
      setDialogOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Delete (optimistic) ──────────────────────────────────────────────────────
  async function handleDelete(row: ProductRow) {
    setRows(prev => prev.filter(r => r.id !== row.id))
    try {
      const res = await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch {
      // Revert on failure
      await loadProducts()
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col p-5 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-800 shrink-0">품목 마스터 관리</h1>
        <Badge variant="secondary" className="text-xs">
          {filtered.length}건
        </Badge>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="품목명 / 품목코드 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 w-60 text-sm"
          />
        </div>
        <Button onClick={openAdd} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-9">
          <Plus size={15} className="mr-1" />
          품목 추가
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-slate-100 text-xs">
              <th className="px-4 py-3 text-left font-semibold">품목코드</th>
              <th className="px-4 py-3 text-left font-semibold">품목명</th>
              <th className="px-4 py-3 text-left font-semibold">품목명2</th>
              <th className="px-4 py-3 text-left font-semibold">구분</th>
              <th className="px-4 py-3 text-left font-semibold">단위</th>
              <th className="px-4 py-3 text-left font-semibold">포장규격</th>
              <th className="px-4 py-3 text-center font-semibold">상태</th>
              <th className="px-4 py-3 text-center font-semibold">액션</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-400">
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-slate-400">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 transition-colors hover:bg-slate-100/60 ${
                    idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{row.productCode}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{row.name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.nameAlt ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.productType ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.unit ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.packageSpec ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {row.isActive ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                        활성
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100">
                        비활성
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEdit(row)}
                        className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="수정"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(row)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? '품목 수정' : '품목 추가'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                품목코드 <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.productCode}
                onChange={e => setForm(f => ({ ...f, productCode: e.target.value }))}
                placeholder="예) PR-001"
                disabled={!!editTarget}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                품목명 <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="품목명을 입력하세요"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">품목명2</label>
              <Input
                value={form.nameAlt}
                onChange={e => setForm(f => ({ ...f, nameAlt: e.target.value }))}
                placeholder="품목명2 (선택)"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">구분</label>
                <Input
                  value={form.productType}
                  onChange={e => setForm(f => ({ ...f, productType: e.target.value }))}
                  placeholder="예) 완제품"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">단위</label>
                <Input
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="예) mg"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">포장규격</label>
              <Input
                value={form.packageSpec}
                onChange={e => setForm(f => ({ ...f, packageSpec: e.target.value }))}
                placeholder="예) 100정/병"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.productCode.trim() || !form.name.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
