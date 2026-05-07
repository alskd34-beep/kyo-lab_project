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

interface OptionRow { id: string; code: string; name: string }

interface ProductRow {
  id: string
  productCode: string
  name: string
  nameAlt: string | null
  abbreviation: string | null
  difficulty: string | null
  categoryId: string | null
  categoryName: string | null
  classificationId: string | null
  classificationName: string | null
  productType: string | null
  unit: string | null
  packageSpec: string | null
  isActive: boolean
  sortOrder: number
}

interface FormState {
  productCode: string
  name: string
  nameAlt: string
  abbreviation: string
  difficulty: string
  categoryId: string
  classificationId: string
  productType: string
  unit: string
  packageSpec: string
}

const EMPTY_FORM: FormState = {
  productCode: '',
  name: '',
  nameAlt: '',
  abbreviation: '',
  difficulty: '',
  categoryId: '',
  classificationId: '',
  productType: '',
  unit: '',
  packageSpec: '',
}

const DIFFICULTY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
]

export default function ProductsPage() {
  const [rows, setRows]                     = useState<ProductRow[]>([])
  const [categories, setCategories]         = useState<OptionRow[]>([])
  const [classifications, setClassifications] = useState<OptionRow[]>([])
  const [loading, setLoading]               = useState(true)
  const [search, setSearch]                 = useState('')
  const [dialogOpen, setDialogOpen]         = useState(false)
  const [editTarget, setEditTarget]         = useState<ProductRow | null>(null)
  const [form, setForm]                     = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  useEffect(() => { loadProducts() }, [])

  async function loadProducts() {
    setLoading(true)
    try {
      const res = await fetch('/api/products')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as {
        rows: ProductRow[]
        categories: OptionRow[]
        classifications: OptionRow[]
      }
      setRows(data.rows)
      setCategories(data.categories ?? [])
      setClassifications(data.classifications ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      r =>
        r.name.toLowerCase().includes(q) ||
        r.productCode.toLowerCase().includes(q) ||
        (r.abbreviation ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  function openAdd() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(row: ProductRow) {
    setEditTarget(row)
    setForm({
      productCode:      row.productCode,
      name:             row.name,
      nameAlt:          row.nameAlt ?? '',
      abbreviation:     row.abbreviation ?? '',
      difficulty:       row.difficulty ?? '',
      categoryId:       row.categoryId ?? '',
      classificationId: row.classificationId ?? '',
      productType:      row.productType ?? '',
      unit:             row.unit ?? '',
      packageSpec:      row.packageSpec ?? '',
    })
    setDialogOpen(true)
  }

  function f(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }))
  }

  async function handleSave() {
    if (!form.productCode.trim() || !form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name:             form.name,
        nameAlt:          form.nameAlt || null,
        abbreviation:     form.abbreviation || null,
        difficulty:       form.difficulty || null,
        categoryId:       form.categoryId || null,
        classificationId: form.classificationId || null,
        productType:      form.productType || null,
        unit:             form.unit || null,
        packageSpec:      form.packageSpec || null,
      }
      if (editTarget) {
        const res = await fetch('/api/products', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editTarget.id, ...payload }),
        })
        if (!res.ok) throw new Error(await res.text())
        await loadProducts()
      } else {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productCode: form.productCode, ...payload }),
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

  async function handleDelete(row: ProductRow) {
    setRows(prev => prev.filter(r => r.id !== row.id))
    try {
      const res = await fetch('/api/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch { await loadProducts() }
  }

  const diffColor: Record<string, string> = {
    Low:    'bg-green-100 text-green-700',
    Medium: 'bg-yellow-100 text-yellow-700',
    High:   'bg-red-100 text-red-700',
  }

  // ── Summary stats ─────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = rows.length
    const active = rows.filter(r => r.isActive).length

    const byCat: Record<string, number> = {}
    rows.forEach(r => {
      const key = r.categoryName ?? '미분류'
      byCat[key] = (byCat[key] ?? 0) + 1
    })

    const byCls: Record<string, number> = {}
    rows.forEach(r => {
      const key = r.classificationName ?? '미분류'
      byCls[key] = (byCls[key] ?? 0) + 1
    })

    const byDiff: Record<string, number> = { Low: 0, Medium: 0, High: 0, '미설정': 0 }
    rows.forEach(r => {
      const key = r.difficulty ?? '미설정'
      byDiff[key] = (byDiff[key] ?? 0) + 1
    })

    return { total, active, byCat, byCls, byDiff }
  }, [rows])

  return (
    <div className="flex flex-1 flex-col p-3 md:p-5 gap-4">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
        <div className="flex items-center gap-2 md:gap-3">
          <h1 className="text-lg font-semibold text-slate-800 shrink-0">품목 마스터 관리</h1>
          <Badge variant="secondary" className="text-xs">{filtered.length}건</Badge>
        </div>
        <div className="hidden md:block flex-1" />
        <div className="relative w-full md:w-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="품목명 / 코드 / 약호 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 w-full md:w-64 text-sm"
          />
        </div>
        <Button onClick={openAdd} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-9 w-full md:w-auto">
          <Plus size={15} className="mr-1" />품목 추가
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 전체 건수 */}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium text-slate-400 mb-1.5">전체 품목</p>
            <p className="text-2xl font-bold text-slate-800">{summary.total}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              활성 <span className="font-semibold text-emerald-600">{summary.active}</span>
              {' / '}
              비활성 <span className="font-semibold text-slate-500">{summary.total - summary.active}</span>
            </p>
          </div>

          {/* 품목구분 */}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium text-slate-400 mb-2">품목구분</p>
            <div className="flex flex-col gap-1">
              {Object.entries(summary.byCat)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, cnt]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div
                      className="h-1.5 rounded-full bg-blue-400"
                      style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: '60%' }}
                    />
                    <span className="text-[11px] text-slate-600 truncate flex-1">{name}</span>
                    <span className="text-[11px] font-semibold text-slate-700 shrink-0">{cnt}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* 전문분류 */}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium text-slate-400 mb-2">전문분류</p>
            <div className="flex flex-col gap-1">
              {Object.entries(summary.byCls)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, cnt]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div
                      className="h-1.5 rounded-full bg-purple-400"
                      style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: '60%' }}
                    />
                    <span className="text-[11px] text-slate-600 truncate flex-1">{name}</span>
                    <span className="text-[11px] font-semibold text-slate-700 shrink-0">{cnt}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* 난이도 */}
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-medium text-slate-400 mb-2">난이도</p>
            <div className="flex flex-col gap-1.5">
              {[
                { key: 'High',   label: 'High',   color: 'bg-red-400' },
                { key: 'Medium', label: 'Medium', color: 'bg-yellow-400' },
                { key: 'Low',    label: 'Low',    color: 'bg-green-400' },
                { key: '미설정', label: '미설정', color: 'bg-slate-200' },
              ].map(({ key, label, color }) => {
                const cnt = summary.byDiff[key] ?? 0
                if (!cnt) return null
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <div
                      className={`h-1.5 rounded-full ${color}`}
                      style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: '60%' }}
                    />
                    <span className="text-[11px] text-slate-600 flex-1">{label}</span>
                    <span className="text-[11px] font-semibold text-slate-700 shrink-0">{cnt}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Table (desktop/tablet) */}
      <div className="hidden md:block flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-slate-100 text-xs">
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold">품목코드</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold">품목명</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold w-20">약호</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold w-24">품목구분</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold w-28">전문분류</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-center font-semibold w-20">난이도</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold w-16">단위</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-left font-semibold">포장규격</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-center font-semibold w-16">상태</th>
              <th className="sticky top-0 z-10 bg-slate-900 px-4 py-3 text-center font-semibold w-20">액션</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-16 text-center text-slate-400">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="py-16 text-center text-slate-400">데이터가 없습니다.</td></tr>
            ) : (
              filtered.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 transition-colors hover:bg-slate-100/60 ${
                    idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{row.productCode}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {row.name}
                    {row.nameAlt && <span className="ml-1.5 text-xs text-slate-400">{row.nameAlt}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">{row.abbreviation ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{row.categoryName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{row.classificationName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {row.difficulty ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${diffColor[row.difficulty] ?? ''}`}>
                        {row.difficulty}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{row.unit ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{row.packageSpec ?? '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {row.isActive ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-[10px]">활성</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100 text-[10px]">비활성</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEdit(row)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="수정">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(row)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors" title="삭제">
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

      {/* Mobile cards */}
      <div className="md:hidden flex flex-col gap-2">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">데이터가 없습니다.</div>
        ) : (
          filtered.map(row => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[11px] text-slate-500">{row.productCode}</span>
                    {row.isActive ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-[10px]">활성</Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100 text-[10px]">비활성</Badge>
                    )}
                    {row.difficulty && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${diffColor[row.difficulty] ?? ''}`}>
                        {row.difficulty}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-800 break-words">
                    {row.name}
                    {row.nameAlt && <span className="ml-1.5 text-xs text-slate-400">{row.nameAlt}</span>}
                  </div>
                  {row.abbreviation && (
                    <div className="text-[11px] font-mono text-slate-500">약호: {row.abbreviation}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(row)} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="수정">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(row)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors" title="삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                <div><span className="text-slate-400">품목구분:</span> {row.categoryName ?? '—'}</div>
                <div><span className="text-slate-400">전문분류:</span> {row.classificationName ?? '—'}</div>
                <div><span className="text-slate-400">단위:</span> {row.unit ?? '—'}</div>
                <div className="truncate"><span className="text-slate-400">포장:</span> {row.packageSpec ?? '—'}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? '품목 수정' : '품목 추가'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1 max-h-[70vh] overflow-y-auto pr-1">
            {/* 코드 + 약호 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">품목코드 <span className="text-red-500">*</span></label>
                <Input value={form.productCode} onChange={f('productCode')} placeholder="예) PR-001" disabled={!!editTarget} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">약호</label>
                <Input value={form.abbreviation} onChange={f('abbreviation')} placeholder="예) ABC" />
              </div>
            </div>

            {/* 품목명 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-700">품목명 <span className="text-red-500">*</span></label>
              <Input value={form.name} onChange={f('name')} placeholder="품목명을 입력하세요" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-700">품목명2</label>
              <Input value={form.nameAlt} onChange={f('nameAlt')} placeholder="품목명2 (선택)" />
            </div>

            {/* 품목구분 + 전문분류 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">품목구분</label>
                <select
                  value={form.categoryId}
                  onChange={f('categoryId')}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-blue-400 focus-visible:ring-blue-400/40 focus-visible:ring-[3px]"
                >
                  <option value="">—</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">전문분류</label>
                <select
                  value={form.classificationId}
                  onChange={f('classificationId')}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-blue-400 focus-visible:ring-blue-400/40 focus-visible:ring-[3px]"
                >
                  <option value="">—</option>
                  {classifications.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 난이도 + 단위 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">난이도</label>
                <select
                  value={form.difficulty}
                  onChange={f('difficulty')}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-blue-400 focus-visible:ring-blue-400/40 focus-visible:ring-[3px]"
                >
                  {DIFFICULTY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">단위</label>
                <Input value={form.unit} onChange={f('unit')} placeholder="예) mg" />
              </div>
            </div>

            {/* 구분 + 포장규격 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">구분</label>
                <Input value={form.productType} onChange={f('productType')} placeholder="예) 완제품" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">포장규격</label>
                <Input value={form.packageSpec} onChange={f('packageSpec')} placeholder="예) 100정/병" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>취소</Button>
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
