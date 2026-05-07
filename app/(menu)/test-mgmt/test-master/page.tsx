'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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

interface TestItemRow {
  id: string
  name: string
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

interface FormState {
  name: string
  estimatedHours: string
  requiresDuo: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  estimatedHours: '',
  requiresDuo: false,
}

export default function TestMasterPage() {
  const [rows, setRows]             = useState<TestItemRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm]             = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Inline edit state
  const [editNameId, setEditNameId]   = useState<string | null>(null)
  const [editNameVal, setEditNameVal] = useState('')
  const [editHoursId, setEditHoursId] = useState<string | null>(null)
  const [editHoursVal, setEditHoursVal] = useState('')

  const nameInputRef  = useRef<HTMLInputElement>(null)
  const hoursInputRef = useRef<HTMLInputElement>(null)

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => { loadItems() }, [])

  async function loadItems() {
    setLoading(true)
    try {
      const res = await fetch('/api/test-items')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: TestItemRow[] }
      setRows(data.rows)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Filter ───────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => r.name.toLowerCase().includes(q))
  }, [rows, search])

  // ── PATCH helper ─────────────────────────────────────────────────────────────
  async function patchItem(id: string, payload: Partial<TestItemRow>) {
    const res = await fetch('/api/test-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    })
    if (!res.ok) throw new Error(await res.text())
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...payload } : r)))
  }

  // ── Toggle duo ───────────────────────────────────────────────────────────────
  async function toggleDuo(row: TestItemRow) {
    const next = !row.requiresDuo
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, requiresDuo: next } : r)))
    try { await patchItem(row.id, { requiresDuo: next }) }
    catch { await loadItems() }
  }

  // ── Toggle active ────────────────────────────────────────────────────────────
  async function toggleActive(row: TestItemRow) {
    const next = !row.isActive
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive: next } : r)))
    try { await patchItem(row.id, { isActive: next }) }
    catch { await loadItems() }
  }

  // ── Inline name edit ─────────────────────────────────────────────────────────
  function startNameEdit(row: TestItemRow) {
    setEditNameId(row.id)
    setEditNameVal(row.name)
    setTimeout(() => nameInputRef.current?.focus(), 0)
  }

  async function commitNameEdit(row: TestItemRow) {
    const val = editNameVal.trim()
    setEditNameId(null)
    if (!val || val === row.name) return
    try { await patchItem(row.id, { name: val }) }
    catch { await loadItems() }
  }

  // ── Inline hours edit ────────────────────────────────────────────────────────
  function startHoursEdit(row: TestItemRow) {
    setEditHoursId(row.id)
    setEditHoursVal(row.estimatedHours != null ? String(row.estimatedHours) : '')
    setTimeout(() => hoursInputRef.current?.focus(), 0)
  }

  async function commitHoursEdit(row: TestItemRow) {
    const raw = editHoursVal.trim()
    setEditHoursId(null)
    const parsed = raw === '' ? null : Number(raw)
    if (isNaN(parsed as number)) return
    if (parsed === row.estimatedHours) return
    try { await patchItem(row.id, { estimatedHours: parsed }) }
    catch { await loadItems() }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete(row: TestItemRow) {
    setRows(prev => prev.filter(r => r.id !== row.id))
    try {
      const res = await fetch('/api/test-items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch { await loadItems() }
  }

  // ── Add ──────────────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/test-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : null,
          requiresDuo: form.requiresDuo,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      await loadItems()
      setDialogOpen(false)
      setForm(EMPTY_FORM)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col p-5 gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-800 shrink-0">시험항목 마스터</h1>
        <Badge variant="secondary" className="text-xs">
          {filtered.length}건
        </Badge>
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="시험항목명 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 w-56 text-sm"
          />
        </div>
        <Button
          onClick={() => { setForm(EMPTY_FORM); setDialogOpen(true) }}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white h-9"
        >
          <Plus size={15} className="mr-1" />
          항목 추가
        </Button>
      </div>

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
              <th className="px-4 py-3 text-left font-semibold">시험항목명</th>
              <th className="px-4 py-3 text-center font-semibold w-32">예상시간(h)</th>
              <th className="px-4 py-3 text-center font-semibold w-24">2인시험</th>
              <th className="px-4 py-3 text-center font-semibold w-20">활성</th>
              <th className="px-4 py-3 text-center font-semibold w-24">액션</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-slate-400">
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-slate-400">
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
                  {/* 시험항목명 — inline edit */}
                  <td className="px-4 py-2.5">
                    {editNameId === row.id ? (
                      <input
                        ref={nameInputRef}
                        value={editNameVal}
                        onChange={e => setEditNameVal(e.target.value)}
                        onBlur={() => commitNameEdit(row)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitNameEdit(row)
                          if (e.key === 'Escape') setEditNameId(null)
                        }}
                        className="w-full rounded border border-blue-400 px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-blue-300"
                      />
                    ) : (
                      <span className="font-medium text-slate-800">{row.name}</span>
                    )}
                  </td>

                  {/* 예상시간 — inline edit */}
                  <td className="px-4 py-2.5 text-center">
                    {editHoursId === row.id ? (
                      <input
                        ref={hoursInputRef}
                        type="number"
                        min={0}
                        value={editHoursVal}
                        onChange={e => setEditHoursVal(e.target.value)}
                        onBlur={() => commitHoursEdit(row)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitHoursEdit(row)
                          if (e.key === 'Escape') setEditHoursId(null)
                        }}
                        className="w-20 rounded border border-blue-400 px-2 py-0.5 text-sm text-center outline-none focus:ring-1 focus:ring-blue-300"
                      />
                    ) : (
                      <button
                        onClick={() => startHoursEdit(row)}
                        className="rounded px-2 py-0.5 text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-text"
                        title="클릭하여 수정"
                      >
                        {row.estimatedHours != null ? row.estimatedHours : '—'}
                      </button>
                    )}
                  </td>

                  {/* 2인시험 toggle */}
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={row.requiresDuo}
                      onChange={() => toggleDuo(row)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                    />
                  </td>

                  {/* 활성 toggle */}
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={() => toggleActive(row)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                    />
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => startNameEdit(row)}
                        className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="이름 수정"
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

      {/* Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>시험항목 추가</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">
                시험항목명 <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="시험항목명을 입력하세요"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">예상시간 (h)</label>
              <Input
                type="number"
                min={0}
                value={form.estimatedHours}
                onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))}
                placeholder="예) 2"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requiresDuo"
                checked={form.requiresDuo}
                onChange={e => setForm(f => ({ ...f, requiresDuo: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <label htmlFor="requiresDuo" className="text-sm text-slate-700 cursor-pointer">
                2인시험 여부
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !form.name.trim()}
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
