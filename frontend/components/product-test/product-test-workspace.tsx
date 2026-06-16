"use client"

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react"
import {
  AlertTriangle,
  Box,
  Gauge,
  PackagePlus,
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

interface LookupOptionRow {
  id: string
  code: string
  name: string
}

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
  avgHours: number | null
  avgHoursPackageUnit: string | null
  avgWorkdays: number | null
  isActive: boolean
  sortOrder: number
}

interface ProductFormState {
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
  avgWorkdays: string
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  productCode: "",
  name: "",
  nameAlt: "",
  abbreviation: "",
  difficulty: "",
  categoryId: "",
  classificationId: "",
  productType: "",
  unit: "",
  packageSpec: "",
  avgWorkdays: "",
}

const DIFFICULTY_OPTIONS = [
  { value: "", label: "—" },
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
]
export function ProductTestWorkspace() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 bg-white p-3 md:p-5">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-blue-50/40 to-emerald-50/50 px-4 py-4 shadow-sm md:px-5 md:py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                <Box size={13} />
                품목 마스터
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                <Gauge size={13} />
                평균공수 통합
              </span>
            </div>
            <h1 className="mt-3 text-[clamp(1.4rem,2vw,2.2rem)] font-black tracking-tight text-slate-950">
              품목마스터와 평균공수를 하나의 흐름으로 관리합니다.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              품목을 먼저 정리하고, 아래 공수 섹션에서 바로 연결하세요.
              별도 메뉴를 없애고 한 화면에서 조회, 등록, 수정이 이어지도록 구성했습니다.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-2xl">
            <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
                핵심
              </p>
              <p className="mt-2 text-lg font-black text-blue-700">통합</p>
              <p className="text-[11px] text-slate-500">별도 화면 제거</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
                흐름
              </p>
              <p className="mt-2 text-lg font-black text-emerald-700">품목 → 공수</p>
              <p className="text-[11px] text-slate-500">연결 중심</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
                스타일
              </p>
              <p className="mt-2 text-lg font-black text-slate-900">화이트</p>
              <p className="text-[11px] text-slate-500">깔끔한 배경</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
                액션
              </p>
              <p className="mt-2 text-lg font-black text-slate-900">빠른 등록</p>
              <p className="text-[11px] text-slate-500">아래 섹션 바로 이동</p>
            </div>
          </div>
        </div>
      </div>

      <ProductsPanel />
      <ManhoursPanel />
    </div>
  )
}

function ProductsPanel() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<LookupOptionRow[]>([])
  const [classifications, setClassifications] = useState<LookupOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ProductRow | null>(null)
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/products")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as {
        rows: ProductRow[]
        categories: LookupOptionRow[]
        classifications: LookupOptionRow[]
      }
      setRows(data.rows)
      setCategories(data.categories ?? [])
      setClassifications(data.classifications ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts()
    })
  }, [loadProducts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.productCode.toLowerCase().includes(q) ||
        (r.abbreviation ?? "").toLowerCase().includes(q)
    )
  }, [rows, search])

  function openAdd() {
    setEditTarget(null)
    setForm(EMPTY_PRODUCT_FORM)
    setDialogOpen(true)
  }

  function openEdit(row: ProductRow) {
    setEditTarget(row)
    setForm({
      productCode: row.productCode,
      name: row.name,
      nameAlt: row.nameAlt ?? "",
      abbreviation: row.abbreviation ?? "",
      difficulty: row.difficulty ?? "",
      categoryId: row.categoryId ?? "",
      classificationId: row.classificationId ?? "",
      productType: row.productType ?? "",
      unit: row.unit ?? "",
      packageSpec: row.packageSpec ?? "",
      avgWorkdays: row.avgWorkdays != null ? String(row.avgWorkdays) : "",
    })
    setDialogOpen(true)
  }

  function f(key: keyof ProductFormState) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  async function handleSave() {
    if (!form.productCode.trim() || !form.name.trim()) return
    const avgWorkdays = Number(form.avgWorkdays)
    if (!form.avgWorkdays.trim() || Number.isNaN(avgWorkdays) || avgWorkdays < 0) {
      setError("공수는 0 이상의 숫자(일)로 입력하세요.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        nameAlt: form.nameAlt || null,
        abbreviation: form.abbreviation || null,
        difficulty: form.difficulty || null,
        categoryId: form.categoryId || null,
        classificationId: form.classificationId || null,
        productType: form.productType || null,
        unit: form.unit || null,
        packageSpec: form.packageSpec || null,
        avgWorkdays,
      }
      if (editTarget) {
        const res = await fetch("/api/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editTarget.id, ...payload }),
        })
        if (!res.ok) throw new Error(await res.text())
        await loadProducts()
      } else {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

  function handleDelete(row: ProductRow) {
    setDeleteTarget(row)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleting(true)
    setRows((prev) => prev.filter((r) => r.id !== target.id))
    try {
      const res = await fetch("/api/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDeleteTarget(null)
    } catch {
      await loadProducts()
    } finally {
      setDeleting(false)
    }
  }

  const diffColor: Record<string, string> = {
    Low: "border-emerald-300 bg-emerald-600 text-white shadow-sm",
    Medium: "border-amber-300 bg-amber-500 text-white shadow-sm",
    High: "border-rose-300 bg-rose-600 text-white shadow-sm",
  }

  const inputClass =
    "h-10 border-slate-300 bg-white text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-200"
  const selectClass =
    "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-blue-600 focus-visible:ring-[3px] focus-visible:ring-blue-200"
  const labelClass = "text-xs font-bold tracking-wide text-slate-700"

  const summary = useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.isActive).length

    const byCat: Record<string, number> = {}
    rows.forEach((r) => {
      const key = r.categoryName ?? "미분류"
      byCat[key] = (byCat[key] ?? 0) + 1
    })

    const byCls: Record<string, number> = {}
    rows.forEach((r) => {
      const key = r.classificationName ?? "미분류"
      byCls[key] = (byCls[key] ?? 0) + 1
    })

    const byDiff: Record<string, number> = {
      Low: 0,
      Medium: 0,
      High: 0,
      미설정: 0,
    }
    rows.forEach((r) => {
      const key = r.difficulty ?? "미설정"
      byDiff[key] = (byDiff[key] ?? 0) + 1
    })

    return { total, active, byCat, byCls, byDiff }
  }, [rows])

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm md:p-5">
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
            <h2 className="min-w-0 text-base font-bold text-slate-950 sm:text-lg">
              품목 마스터
            </h2>
            <Badge className="border-blue-700 bg-blue-700 text-xs text-white shadow-sm">
              {filtered.length}건
            </Badge>
          </div>
          <div className="hidden flex-1 md:block" />
          <div className="relative w-full md:w-auto">
            <Search
              size={14}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
            />
            <Input
              placeholder="품목명 / 코드 / 약호 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full border-slate-300 bg-slate-50 pl-9 text-sm text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-200 md:w-64"
            />
          </div>
          <Button
            onClick={openAdd}
            size="sm"
            className="h-9 w-full bg-blue-700 text-white shadow-sm hover:bg-blue-800 md:w-auto"
          >
            <Plus size={15} className="mr-1" />
            품목 추가
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
            {error}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-l-4 border-slate-300 border-l-blue-700 bg-white px-4 py-3 shadow-sm">
              <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                전체 품목
              </p>
              <p className="text-3xl font-black text-slate-950">
                {summary.total}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-slate-600">
                활성{" "}
                <span className="font-bold text-emerald-700">
                  {summary.active}
                </span>
                {" / "}
                비활성{" "}
                <span className="font-bold text-slate-700">
                  {summary.total - summary.active}
                </span>
              </p>
            </div>

            <div className="rounded-lg border border-l-4 border-slate-300 border-l-cyan-700 bg-white px-4 py-3 shadow-sm">
              <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                품목구분
              </p>
              <div className="flex flex-col gap-1">
                {Object.entries(summary.byCat)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, cnt]) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <div
                        className="h-2 rounded-full bg-cyan-700"
                        style={{
                          width: `${Math.round((cnt / summary.total) * 100)}%`,
                          minWidth: 4,
                          maxWidth: "60%",
                        }}
                      />
                      <span className="flex-1 truncate text-[11px] font-medium text-slate-700">
                        {name}
                      </span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-950">
                        {cnt}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="rounded-lg border border-l-4 border-slate-300 border-l-violet-700 bg-white px-4 py-3 shadow-sm">
              <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                전문분류
              </p>
              <div className="flex flex-col gap-1">
                {Object.entries(summary.byCls)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, cnt]) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <div
                        className="h-2 rounded-full bg-violet-700"
                        style={{
                          width: `${Math.round((cnt / summary.total) * 100)}%`,
                          minWidth: 4,
                          maxWidth: "60%",
                        }}
                      />
                      <span className="flex-1 truncate text-[11px] font-medium text-slate-700">
                        {name}
                      </span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-950">
                        {cnt}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="rounded-lg border border-l-4 border-slate-300 border-l-rose-700 bg-white px-4 py-3 shadow-sm">
              <p className="mb-2 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                난이도
              </p>
              <div className="flex flex-col gap-1.5">
                {[
                  { key: "High", label: "High", color: "bg-rose-700" },
                  { key: "Medium", label: "Medium", color: "bg-amber-600" },
                  { key: "Low", label: "Low", color: "bg-emerald-700" },
                  { key: "미설정", label: "미설정", color: "bg-slate-500" },
                ].map(({ key, label, color }) => {
                  const cnt = summary.byDiff[key] ?? 0
                  if (!cnt) return null
                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <div
                        className={`h-2 rounded-full ${color}`}
                        style={{
                          width: `${Math.round((cnt / summary.total) * 100)}%`,
                          minWidth: 4,
                          maxWidth: "60%",
                        }}
                      />
                      <span className="flex-1 text-[11px] font-medium text-slate-700">
                        {label}
                      </span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-950">
                        {cnt}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <div className="hidden flex-1 overflow-auto rounded-lg border border-slate-300 bg-white shadow-md md:block">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="bg-slate-950 text-xs text-white">
                <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                  품목코드
                </th>
                <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                  품목명
                </th>
                <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-left font-bold">
                  약호
                </th>
                <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-left font-bold">
                  품목구분
                </th>
                <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-left font-bold">
                  전문분류
                </th>
                <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-center font-bold">
                  난이도
                </th>
                <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-left font-bold">
                  단위
                </th>
                <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                  포장규격
                </th>
                <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-left font-bold">
                  공수
                </th>
                <th className="sticky top-0 z-10 w-16 bg-slate-950 px-4 py-3 text-center font-bold">
                  상태
                </th>
                <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-center font-bold">
                  액션
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={11}
                    className="py-16 text-center font-medium text-slate-600"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
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
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-blue-800">
                      {row.productCode}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-slate-950">
                      {row.name}
                      {row.nameAlt && (
                        <span className="ml-1.5 text-xs font-medium text-slate-600">
                          {row.nameAlt}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800">
                      {row.abbreviation ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                      {row.categoryName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                      {row.classificationName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {row.difficulty ? (
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${diffColor[row.difficulty] ?? ""}`}
                        >
                          {row.difficulty}
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                      {row.unit ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                      {row.packageSpec ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-bold text-slate-950">
                      {row.avgWorkdays != null ? (
                        <span>{row.avgWorkdays}일</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {row.isActive ? (
                        <Badge className="border-emerald-700 bg-emerald-700 text-[10px] font-bold text-white hover:bg-emerald-700">
                          활성
                        </Badge>
                      ) : (
                        <Badge className="border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600">
                          비활성
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(row)}
                          className="rounded-md bg-blue-100 p-1.5 text-blue-700 transition-colors hover:bg-blue-700 hover:text-white"
                          title="수정"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
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
                      <span className="font-mono text-[11px] font-bold text-blue-800">
                        {row.productCode}
                      </span>
                      {row.isActive ? (
                        <Badge className="border-emerald-700 bg-emerald-700 text-[10px] font-bold text-white hover:bg-emerald-700">
                          활성
                        </Badge>
                      ) : (
                        <Badge className="border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600">
                          비활성
                        </Badge>
                      )}
                      {row.difficulty && (
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${diffColor[row.difficulty] ?? ""}`}
                        >
                          {row.difficulty}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-bold break-words text-slate-950">
                      {row.name}
                      {row.nameAlt && (
                        <span className="ml-1.5 text-xs font-medium text-slate-600">
                          {row.nameAlt}
                        </span>
                      )}
                    </div>
                    {row.abbreviation && (
                      <div className="font-mono text-[11px] font-semibold text-slate-700">
                        약호: {row.abbreviation}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => openEdit(row)}
                      className="rounded-md bg-blue-100 p-1.5 text-blue-700 transition-colors hover:bg-blue-700 hover:text-white"
                      title="수정"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(row)}
                      className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                      title="삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-800 min-[420px]:grid-cols-2">
                  <div>
                    <span className="font-bold text-slate-600">품목구분:</span>{" "}
                    {row.categoryName ?? "—"}
                  </div>
                  <div>
                    <span className="font-bold text-slate-600">전문분류:</span>{" "}
                    {row.classificationName ?? "—"}
                  </div>
                  <div>
                    <span className="font-bold text-slate-600">단위:</span>{" "}
                    {row.unit ?? "—"}
                  </div>
                  <div className="truncate">
                    <span className="font-bold text-slate-600">포장:</span>{" "}
                    {row.packageSpec ?? "—"}
                  </div>
                  <div>
                    <span className="font-bold text-slate-600">공수:</span>{" "}
                    {row.avgWorkdays != null ? `${row.avgWorkdays}일` : "—"}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-2xl">
            <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
                  <PackagePlus size={20} />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-black text-slate-950">
                    {editTarget ? "품목 정보 수정" : "신규 품목 등록"}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
                    시험 품목의 기본 정보와 분류 기준을 관리합니다.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
              <div className="grid gap-4">
                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-sm font-black text-slate-950">
                        식별 정보
                      </h3>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">
                        코드와 품목명은 저장에 필요한 필수 항목입니다.
                      </p>
                    </div>
                    {editTarget && (
                      <Badge className="border-blue-700 bg-blue-700 text-[10px] font-bold text-white hover:bg-blue-700">
                        수정 모드
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>
                        품목코드 <span className="text-rose-600">*</span>
                      </label>
                      <Input
                        className={inputClass}
                        value={form.productCode}
                        onChange={f("productCode")}
                        placeholder="예) PR-001"
                        disabled={!!editTarget}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>약호</label>
                      <Input
                        className={inputClass}
                        value={form.abbreviation}
                        onChange={f("abbreviation")}
                        placeholder="예) ABC"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label className={labelClass}>
                        품목명 <span className="text-rose-600">*</span>
                      </label>
                      <Input
                        className={inputClass}
                        value={form.name}
                        onChange={f("name")}
                        placeholder="품목명을 입력하세요"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label className={labelClass}>품목명2</label>
                      <Input
                        className={inputClass}
                        value={form.nameAlt}
                        onChange={f("nameAlt")}
                        placeholder="품목명2 (선택)"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <div className="mb-3 border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-950">
                      분류 및 시험 속성
                    </h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      품목구분, 전문분류, 난이도 기준을 선택합니다.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>품목구분</label>
                      <select
                        value={form.categoryId}
                        onChange={f("categoryId")}
                        className={selectClass}
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>전문분류</label>
                      <select
                        value={form.classificationId}
                        onChange={f("classificationId")}
                        className={selectClass}
                      >
                        <option value="">—</option>
                        {classifications.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>난이도</label>
                      <select
                        value={form.difficulty}
                        onChange={f("difficulty")}
                        className={selectClass}
                      >
                        {DIFFICULTY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>단위</label>
                      <Input
                        className={inputClass}
                        value={form.unit}
                        onChange={f("unit")}
                        placeholder="예) mg"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <div className="mb-3 border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-950">
                      제품 상세
                    </h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      제품 구분과 포장규격을 입력합니다.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>구분</label>
                      <Input
                        className={inputClass}
                        value={form.productType}
                        onChange={f("productType")}
                        placeholder="예) 완제품"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>포장규격</label>
                      <Input
                        className={inputClass}
                        value={form.packageSpec}
                        onChange={f("packageSpec")}
                        placeholder="예) 100정/병"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <div className="mb-3 border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-950">
                      공수 정보
                    </h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      품목과 함께 대표 평균공수를 저장합니다.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label className={labelClass}>
                        공수(일) <span className="text-rose-600">*</span>
                      </label>
                      <Input
                        className={inputClass}
                        type="number"
                        min={0}
                        step={1}
                        value={form.avgWorkdays}
                        onChange={f("avgWorkdays")}
                        placeholder="예) 3"
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="h-10 w-full border-slate-300 text-slate-800 hover:bg-slate-100 sm:w-auto"
              >
                취소
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  saving ||
                  !form.productCode.trim() ||
                  !form.name.trim() ||
                  !form.avgWorkdays.trim()
                }
                className="h-10 w-full bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800 sm:w-auto"
              >
                <Save size={15} className="mr-1.5" />
                {saving ? "저장 중..." : "저장"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open && !deleting) setDeleteTarget(null)
          }}
        >
          <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden border-slate-300 bg-white p-0 shadow-2xl sm:max-w-md">
            <DialogHeader className="border-b border-slate-200 bg-rose-50 px-4 py-4 pr-12 text-left sm:px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-700 text-white shadow-sm">
                  <AlertTriangle size={20} />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-black text-slate-950">
                    품목 삭제 확인
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
                <p className="mt-1 font-mono text-xs font-semibold text-rose-800">
                  {deleteTarget?.productCode}
                </p>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  이 품목을 삭제하시겠습니까? 연결된 시험 기준이 있는 경우
                  API에서 삭제를 거부할 수 있습니다.
                </p>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="h-10 w-full border-slate-300 text-slate-800 hover:bg-slate-100 sm:w-auto"
              >
                취소
              </Button>
              <Button
                onClick={confirmDelete}
                disabled={deleting}
                className="h-10 w-full bg-rose-700 px-5 font-bold text-white shadow-sm hover:bg-rose-800 sm:w-auto"
              >
                <Trash2 size={15} className="mr-1.5" />
                {deleting ? "삭제 중..." : "삭제"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}

function ManhoursPanel() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm md:px-5 md:py-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/30 to-blue-50/40 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
            <Gauge size={13} />
            공수 통합 완료
          </div>
          <h3 className="mt-3 text-lg font-black tracking-tight text-slate-950">
            평균공수는 품목 마스터에 합쳐졌습니다.
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            이제 공수는 위의 품목 목록 `공수` 컬럼과 등록/수정 다이얼로그에서
            함께 관리합니다. 별도의 공수 목록은 유지하지 않습니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:min-w-[360px]">
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
              위치
            </p>
            <p className="mt-2 text-sm font-black text-blue-700">품목 목록</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
              입력
            </p>
            <p className="mt-2 text-sm font-black text-emerald-700">
              등록 / 수정
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">
              상태
            </p>
            <p className="mt-2 text-sm font-black text-slate-900">통합 운영</p>
          </div>
        </div>
      </div>
    </div>
  )
}
