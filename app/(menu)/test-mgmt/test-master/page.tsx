"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ClipboardList,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"

import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"

const CATEGORIES = [
  "성상·포장",
  "이화학",
  "함량시험",
  "확인시험",
  "기기분석",
  "안전성",
  "기타",
] as const

type Category = (typeof CATEGORIES)[number]

const CATEGORY_COLORS: Record<string, string> = {
  "성상·포장": "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800",
  이화학: "border-blue-300 bg-blue-100 text-blue-800",
  함량시험: "border-emerald-300 bg-emerald-100 text-emerald-800",
  확인시험: "border-cyan-300 bg-cyan-100 text-cyan-800",
  기기분석: "border-amber-300 bg-amber-100 text-amber-800",
  안전성: "border-rose-300 bg-rose-100 text-rose-800",
  기타: "border-slate-300 bg-slate-100 text-slate-700",
}

interface TestItemRow {
  id: string
  name: string
  category: string
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

interface FormState {
  name: string
  category: Category
  estimatedHours: string
  requiresDuo: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "기타",
  estimatedHours: "",
  requiresDuo: false,
}

export default function TestMasterPage() {
  const [rows, setRows] = useState<TestItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"전체" | Category>("전체")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<TestItemRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TestItemRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    queueMicrotask(() => {
      void loadItems()
    })
  }, [])

  async function loadItems() {
    setLoading(true)
    try {
      const res = await fetch("/api/test-items")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: TestItemRow[] }
      setRows(data.rows)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (activeTab !== "전체" && row.category !== activeTab) return false
      if (q && !row.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, activeTab])

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { 전체: rows.length }
    for (const category of CATEGORIES) {
      counts[category] = rows.filter((row) => row.category === category).length
    }
    return counts
  }, [rows])

  const summary = useMemo(() => {
    const active = rows.filter((row) => row.isActive).length
    const duo = rows.filter((row) => row.requiresDuo && row.isActive).length
    const estimated = rows.filter((row) => row.estimatedHours != null)
    const avgHours = estimated.length
      ? estimated.reduce((sum, row) => sum + (row.estimatedHours ?? 0), 0) /
        estimated.length
      : 0
    return { active, duo, avgHours }
  }, [rows])

  async function patchItem(id: string, payload: Partial<TestItemRow>) {
    const res = await fetch("/api/test-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    })
    if (!res.ok) throw new Error(await res.text())
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...payload } : row))
    )
  }

  async function toggleDuo(row: TestItemRow) {
    const next = !row.requiresDuo
    setRows((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, requiresDuo: next } : item
      )
    )
    try {
      await patchItem(row.id, { requiresDuo: next })
    } catch {
      await loadItems()
    }
  }

  async function toggleActive(row: TestItemRow) {
    const next = !row.isActive
    setRows((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, isActive: next } : item
      )
    )
    try {
      await patchItem(row.id, { isActive: next })
    } catch {
      await loadItems()
    }
  }

  function openAddDialog() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setError(null)
    setDialogOpen(true)
  }

  function openEditDialog(row: TestItemRow) {
    setEditTarget(row)
    setForm({
      name: row.name,
      category: (CATEGORIES.includes(row.category as Category)
        ? row.category
        : "기타") as Category,
      estimatedHours:
        row.estimatedHours != null ? String(row.estimatedHours) : "",
      requiresDuo: row.requiresDuo,
    })
    setError(null)
    setDialogOpen(true)
  }

  function openDeleteDialog(row: TestItemRow) {
    setDeleteTarget(row)
    setError(null)
    setDeleteOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("시험항목명을 입력하세요.")
      return
    }

    const estimatedHours =
      form.estimatedHours.trim() === "" ? null : Number(form.estimatedHours)
    if (estimatedHours !== null && Number.isNaN(estimatedHours)) {
      setError("예상시간은 숫자로 입력하세요.")
      return
    }

    setSaving(true)
    try {
      if (editTarget) {
        await patchItem(editTarget.id, {
          name: form.name.trim(),
          category: form.category,
          estimatedHours,
          requiresDuo: form.requiresDuo,
        })
      } else {
        const res = await fetch("/api/test-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category,
            estimatedHours,
            requiresDuo: form.requiresDuo,
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        await loadItems()
      }

      setDialogOpen(false)
      setForm(EMPTY_FORM)
      setEditTarget(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    setRows((prev) => prev.filter((row) => row.id !== deleteTarget.id))
    try {
      const res = await fetch("/api/test-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDeleteOpen(false)
      setDeleteTarget(null)
    } catch {
      await loadItems()
    } finally {
      setSaving(false)
    }
  }

  const allTabs = ["전체", ...CATEGORIES] as const

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 bg-slate-200/70 p-3 md:p-5">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
            <ClipboardList size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="min-w-0 text-base font-bold text-slate-950 sm:text-lg">
              시험항목 마스터
            </h1>
            <p className="text-xs font-medium text-slate-600">
              시험항목 분류와 예상시간, 2인시험 여부를 관리합니다.
            </p>
          </div>
        </div>
        <div className="hidden flex-1 md:block" />
        <div className="relative w-full md:w-auto">
          <Search
            size={14}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
          />
          <Input
            placeholder="시험항목명 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full bg-slate-50 pl-9 md:w-56"
          />
        </div>
        <Button
          onClick={openAddDialog}
          size="sm"
          className="h-9 w-full bg-blue-700 text-white shadow-sm hover:bg-blue-800 md:w-auto"
        >
          <Plus size={15} className="mr-1" />
          항목 추가
        </Button>
      </div>

      {error && !dialogOpen && !deleteOpen && (
        <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-l-4 border-slate-300 border-l-blue-700 bg-white px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
            전체 항목
          </p>
          <p className="text-3xl font-black text-slate-950">{rows.length}</p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">
            현재 표시{" "}
            <span className="font-bold text-blue-700">{filtered.length}</span>건
          </p>
        </div>
        <div className="rounded-lg border border-l-4 border-slate-300 border-l-emerald-700 bg-white px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
            활성 항목
          </p>
          <p className="text-3xl font-black text-emerald-700">
            {summary.active}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">
            운영 중 항목
          </p>
        </div>
        <div className="rounded-lg border border-l-4 border-slate-300 border-l-amber-600 bg-white px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
            평균 예상시간
          </p>
          <p className="text-3xl font-black text-amber-700">
            {summary.avgHours.toFixed(1)}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">
            2인시험{" "}
            <span className="font-bold text-slate-950">{summary.duo}</span>건
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {allTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === tab
                ? "bg-blue-700 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
          >
            {tab}
            <span
              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                activeTab === tab
                  ? "bg-white/20 text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {tabCounts[tab] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {loading ? (
          <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
            불러오는 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
            데이터가 없습니다.
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        CATEGORY_COLORS[row.category] ?? CATEGORY_COLORS["기타"]
                      }`}
                    >
                      {row.category || "기타"}
                    </span>
                    <Badge
                      className={
                        row.isActive
                          ? "border-emerald-700 bg-emerald-700 text-[10px] font-bold text-white hover:bg-emerald-700"
                          : "border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600"
                      }
                    >
                      {row.isActive ? "활성" : "비활성"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm font-bold break-words text-slate-950">
                    {row.name}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEditDialog(row)}
                    className="rounded-md bg-blue-100 p-1.5 text-blue-700 transition-colors hover:bg-blue-700 hover:text-white"
                    title="수정"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => openDeleteDialog(row)}
                    className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                    title="삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-800 min-[420px]:grid-cols-2">
                <div>
                  <span className="font-bold text-slate-600">예상시간:</span>{" "}
                  {row.estimatedHours != null ? `${row.estimatedHours}h` : "—"}
                </div>
                <div>
                  <span className="font-bold text-slate-600">2인시험:</span>{" "}
                  {row.requiresDuo ? "필요" : "미사용"}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => void toggleDuo(row)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                    row.requiresDuo
                      ? "border-amber-300 bg-amber-600 text-white hover:bg-amber-700"
                      : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {row.requiresDuo ? "2인시험 사용" : "2인시험 미사용"}
                </button>
                <button
                  onClick={() => void toggleActive(row)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                    row.isActive
                      ? "border-emerald-300 bg-emerald-700 text-white hover:bg-emerald-800"
                      : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {row.isActive ? "활성 유지" : "활성 전환"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden overflow-auto rounded-lg border border-slate-300 bg-white shadow-md md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-950 text-xs text-white">
              <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                시험항목명
              </th>
              <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-left font-bold">
                대분류
              </th>
              <th className="sticky top-0 z-10 w-32 bg-slate-950 px-4 py-3 text-center font-bold">
                예상시간(h)
              </th>
              <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-center font-bold">
                2인시험
              </th>
              <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-center font-bold">
                활성
              </th>
              <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-center font-bold">
                액션
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-16 text-center font-medium text-slate-600"
                >
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-16 text-center font-medium text-slate-600"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-200 transition-colors hover:bg-blue-50 ${
                    idx % 2 === 1 ? "bg-slate-100/80" : "bg-white"
                  }`}
                >
                  <td className="px-4 py-2.5 font-semibold text-slate-950">
                    {row.name}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        CATEGORY_COLORS[row.category] ?? CATEGORY_COLORS["기타"]
                      }`}
                    >
                      {row.category || "기타"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs font-bold text-slate-950 tabular-nums">
                    {row.estimatedHours != null ? `${row.estimatedHours}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => void toggleDuo(row)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                        row.requiresDuo
                          ? "border-amber-300 bg-amber-600 text-white hover:bg-amber-700"
                          : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {row.requiresDuo ? "사용" : "미사용"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => void toggleActive(row)}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                        row.isActive
                          ? "border-emerald-300 bg-emerald-700 text-white hover:bg-emerald-800"
                          : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {row.isActive ? "활성" : "비활성"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEditDialog(row)}
                        className="rounded-md bg-blue-100 p-1.5 text-blue-700 transition-colors hover:bg-blue-700 hover:text-white"
                        title="수정"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => openDeleteDialog(row)}
                        className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
            <DialogTitle className="text-lg font-black text-slate-950">
              {editTarget ? "시험항목 수정" : "시험항목 추가"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
              시험항목 기본 정보와 2인시험 여부를 관리합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    기본 정보
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      시험항목명 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      className="h-10 border-slate-300 bg-white text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-200"
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="시험항목명을 입력하세요"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      대분류
                    </label>
                    <select
                      value={form.category}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          category: e.target.value as Category,
                        }))
                      }
                      className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 transition-[color,box-shadow] outline-none focus-visible:border-blue-600 focus-visible:ring-[3px] focus-visible:ring-blue-200"
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      예상시간 (h)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      className="h-10 border-slate-300 bg-white text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-200"
                      value={form.estimatedHours}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          estimatedHours: e.target.value,
                        }))
                      }
                      placeholder="예) 2"
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    시험 설정
                  </h3>
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={form.requiresDuo}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        requiresDuo: e.target.checked,
                      }))
                    }
                    className="cb-custom"
                  />
                  2인시험 여부
                </label>
              </section>

              {error && (
                <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
                  {error}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-10 bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800"
            >
              <Save size={15} className="mr-1.5" />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-white p-0 shadow-2xl sm:max-w-md">
          <DialogHeader className="border-b border-slate-200 bg-rose-50 px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-700 text-white shadow-sm">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-black text-slate-950">
                  시험항목 삭제
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-rose-800">
                  삭제 후에는 목록에서 즉시 제거됩니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-5">
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4">
              <p className="text-sm font-bold text-slate-950">
                {deleteTarget?.name}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                이 시험항목을 삭제하시겠습니까? 연결된 품목 시험 기준이 있으면
                영향이 있을 수 있습니다.
              </p>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={saving}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              onClick={handleDelete}
              disabled={saving}
              className="h-10 bg-rose-700 px-5 font-bold text-white shadow-sm hover:bg-rose-800"
            >
              <Trash2 size={15} className="mr-1.5" />
              {saving ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
