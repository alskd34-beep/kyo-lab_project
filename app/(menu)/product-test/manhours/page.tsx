"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Gauge,
  PackageSearch,
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

interface ManhoursRow {
  id: string
  productId: string
  productCode: string
  productName: string
  packageUnit: string
  avgHours: number
  updatedAt: string | null
}

interface ProductOption {
  id: string
  productCode: string
  name: string
}

export default function ManhoursPage() {
  const [rows, setRows] = useState<ManhoursRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchValue, setSearchValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductOption[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [productSearch, setProductSearch] = useState("")
  const [selectedProductId, setSelectedProductId] = useState("")
  const [newPackageUnit, setNewPackageUnit] = useState("")
  const [newAvgHours, setNewAvgHours] = useState("")
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<ManhoursRow | null>(null)
  const [editUnit, setEditUnit] = useState("")
  const [editHours, setEditHours] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ManhoursRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      void loadManhours()
    })
  }, [])

  async function loadManhours() {
    setIsLoading(true)
    try {
      const res = await fetch("/api/manhours")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ManhoursRow[] }
      setRows(data.rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  async function loadProducts() {
    if (products.length > 0) return
    try {
      const res = await fetch("/api/products?limit=2000")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ProductOption[] }
      setProducts(data.rows)
    } catch (err) {
      console.error("[manhours] 품목 로드 실패", err)
    }
  }

  const filtered = useMemo(() => {
    const q = searchValue.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (row) =>
        row.productName.toLowerCase().includes(q) ||
        row.productCode.toLowerCase().includes(q) ||
        row.packageUnit.toLowerCase().includes(q)
    )
  }, [rows, searchValue])

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products.slice(0, 200)
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(q) ||
          product.productCode.toLowerCase().includes(q)
      )
      .slice(0, 200)
  }, [products, productSearch])

  const summary = useMemo(() => {
    const total = rows.length
    const totalHours = rows.reduce((sum, row) => sum + row.avgHours, 0)
    const averageHours = total ? totalHours / total : 0
    const maxRow =
      rows.reduce<ManhoursRow | null>(
        (top, row) => (!top || row.avgHours > top.avgHours ? row : top),
        null
      ) ?? null
    const updatedThisMonth = rows.filter((row) => {
      if (!row.updatedAt) return false
      return row.updatedAt.slice(0, 7) === new Date().toISOString().slice(0, 7)
    }).length

    return {
      total,
      totalHours,
      averageHours,
      maxRow,
      updatedThisMonth,
    }
  }, [rows])

  async function openCreate() {
    setError(null)
    setSelectedProductId("")
    setNewPackageUnit("")
    setNewAvgHours("")
    setProductSearch("")
    await loadProducts()
    setCreateOpen(true)
  }

  async function handleCreate() {
    setError(null)
    if (!selectedProductId) {
      setError("품목을 선택하세요.")
      return
    }
    if (!newPackageUnit.trim()) {
      setError("포장단위를 입력하세요.")
      return
    }

    const hours = parseFloat(newAvgHours)
    if (Number.isNaN(hours) || hours < 0) {
      setError("평균공수는 0 이상의 숫자여야 합니다.")
      return
    }

    setCreating(true)
    try {
      const res = await fetch("/api/manhours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProductId,
          packageUnit: newPackageUnit.trim(),
          avgHours: hours,
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(
          (() => {
            try {
              return JSON.parse(body).error
            } catch {
              return body
            }
          })()
        )
      }
      await loadManhours()
      setCreateOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  function openEdit(row: ManhoursRow) {
    setError(null)
    setEditTarget(row)
    setEditUnit(row.packageUnit)
    setEditHours(String(row.avgHours))
  }

  async function handleEdit() {
    if (!editTarget) return

    const unit = editUnit.trim()
    const hours = parseFloat(editHours)
    if (!unit) {
      setError("포장단위를 입력하세요.")
      return
    }
    if (Number.isNaN(hours) || hours < 0) {
      setError("평균공수는 0 이상의 숫자여야 합니다.")
      return
    }

    setEditSaving(true)
    try {
      const res = await fetch("/api/manhours", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTarget.id,
          packageUnit: unit,
          avgHours: hours,
        }),
      })
      if (!res.ok) throw new Error(await res.text())

      setRows((prev) =>
        prev.map((row) =>
          row.id === editTarget.id
            ? {
                ...row,
                packageUnit: unit,
                avgHours: hours,
                updatedAt: new Date().toISOString(),
              }
            : row
        )
      )
      setEditTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEditSaving(false)
    }
  }

  function openDelete(row: ManhoursRow) {
    setError(null)
    setDeleteTarget(row)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch("/api/manhours", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      setRows((prev) => prev.filter((row) => row.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  function formatDate(iso: string | null) {
    return iso ? iso.slice(0, 10) : "-"
  }

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  )

  const inputClass =
    "h-10 border-slate-300 bg-white text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-200"

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 bg-slate-200/70 p-3 md:p-5">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:gap-3">
          <h1 className="min-w-0 text-base font-bold text-slate-950 sm:text-lg">
            평균공수 관리
          </h1>
          <Badge className="border-blue-700 bg-blue-700 text-xs font-bold text-white shadow-sm">
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
            placeholder="품목명 / 코드 / 포장단위 검색..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="h-9 w-full bg-slate-50 pl-9 text-sm md:w-72"
          />
        </div>
        <Button
          onClick={openCreate}
          size="sm"
          className="h-9 w-full bg-blue-700 text-white shadow-sm hover:bg-blue-800 md:w-auto"
        >
          <Plus size={15} className="mr-1" />
          신규 등록
        </Button>
      </div>

      {error && !createOpen && !editTarget && !deleteTarget && (
        <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-l-4 border-slate-300 border-l-blue-700 bg-white px-4 py-3 shadow-sm">
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
              등록 건수
            </p>
            <p className="text-3xl font-black text-slate-950">
              {summary.total}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              이번 달 수정{" "}
              <span className="font-bold text-blue-700">
                {summary.updatedThisMonth}
              </span>
              건
            </p>
          </div>

          <div className="rounded-lg border border-l-4 border-slate-300 border-l-cyan-700 bg-white px-4 py-3 shadow-sm">
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
              평균 공수
            </p>
            <p className="text-3xl font-black text-slate-950">
              {summary.averageHours.toFixed(2)}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              전체 누적{" "}
              <span className="font-bold text-cyan-700">
                {summary.totalHours.toFixed(1)}h
              </span>
            </p>
          </div>

          <div className="rounded-lg border border-l-4 border-slate-300 border-l-violet-700 bg-white px-4 py-3 shadow-sm">
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
              최대 공수 품목
            </p>
            <p className="truncate text-sm font-black text-slate-950">
              {summary.maxRow?.productName ?? "-"}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              {summary.maxRow ? (
                <>
                  <span className="font-mono font-bold text-violet-700">
                    {summary.maxRow.productCode}
                  </span>
                  {" / "}
                  <span className="font-bold text-slate-800">
                    {summary.maxRow.avgHours.toFixed(2)}h
                  </span>
                </>
              ) : (
                "-"
              )}
            </p>
          </div>

          <div className="rounded-lg border border-l-4 border-slate-300 border-l-rose-700 bg-white px-4 py-3 shadow-sm">
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
              검색 결과
            </p>
            <p className="text-3xl font-black text-slate-950">
              {filtered.length}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              전체{" "}
              <span className="font-bold text-rose-700">{rows.length}</span>건
              중
            </p>
          </div>
        </div>
      )}

      <div className="hidden flex-1 overflow-auto rounded-lg border border-slate-300 bg-white shadow-md md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-950 text-xs text-white">
              <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                품목코드
              </th>
              <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                품목명
              </th>
              <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-left font-bold">
                포장단위
              </th>
              <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-left font-bold">
                평균공수
              </th>
              <th className="sticky top-0 z-10 w-28 bg-slate-950 px-4 py-3 text-left font-bold">
                수정일
              </th>
              <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-center font-bold">
                액션
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
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
                  <td className="px-4 py-2.5 font-mono text-xs font-bold text-blue-800">
                    {row.productCode}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-slate-950">
                    {row.productName}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-800">
                    {row.packageUnit}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-bold text-slate-950 tabular-nums">
                    {row.avgHours.toFixed(2)}h
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-700">
                    {formatDate(row.updatedAt)}
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
                        onClick={() => openDelete(row)}
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
        {isLoading ? (
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
                    <span className="inline-flex items-center rounded-full border border-cyan-300 bg-cyan-700 px-2 py-0.5 text-[10px] font-bold text-white">
                      {row.avgHours.toFixed(2)}h
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-bold break-words text-slate-950">
                    {row.productName}
                  </div>
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
                    onClick={() => openDelete(row)}
                    className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                    title="삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t border-slate-200 pt-2 text-[11px] font-medium text-slate-800 min-[420px]:grid-cols-2">
                <div>
                  <span className="font-bold text-slate-600">포장단위:</span>{" "}
                  {row.packageUnit}
                </div>
                <div>
                  <span className="font-bold text-slate-600">수정일:</span>{" "}
                  {formatDate(row.updatedAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <p className="text-xs font-medium text-slate-600">
          총 <span className="font-bold text-slate-950">{filtered.length}</span>
          건
          {searchValue && rows.length !== filtered.length && (
            <span className="ml-1.5 text-slate-500">
              (전체 {rows.length}건 중 필터됨)
            </span>
          )}
        </p>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-2xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
                <PackageSearch size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-black text-slate-950">
                  평균공수 신규 등록
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
                  품목을 선택하고 포장단위별 평균공수를 등록합니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    품목 선택
                  </h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    품목명 또는 코드로 검색한 뒤 항목을 선택하세요.
                  </p>
                </div>

                <div className="relative">
                  <Search
                    size={14}
                    className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
                  />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="품목명 / 코드 검색..."
                    className="bg-slate-50 pl-9"
                  />
                </div>

                {selectedProduct && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                    <p className="font-mono text-[10px] font-bold text-blue-700">
                      {selectedProduct.productCode}
                    </p>
                    <p className="text-sm font-bold text-slate-950">
                      {selectedProduct.name}
                    </p>
                  </div>
                )}

                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                  {filteredProducts.length === 0 ? (
                    <p className="py-8 text-center text-sm font-medium text-slate-600">
                      검색 결과가 없습니다.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filteredProducts.map((product) => {
                        const isSelected = selectedProductId === product.id
                        return (
                          <li key={product.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedProductId(product.id)}
                              className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors ${
                                isSelected
                                  ? "bg-blue-50"
                                  : "hover:bg-slate-100/80"
                              }`}
                            >
                              <span
                                className={`font-mono text-[10px] font-bold ${
                                  isSelected
                                    ? "text-blue-700"
                                    : "text-slate-500"
                                }`}
                              >
                                {product.productCode}
                              </span>
                              <span
                                className={`text-sm ${
                                  isSelected
                                    ? "font-bold text-slate-950"
                                    : "font-medium text-slate-800"
                                }`}
                              >
                                {product.name}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    공수 정보
                  </h3>
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    포장단위와 시간을 입력합니다.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      포장단위 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      className={inputClass}
                      value={newPackageUnit}
                      onChange={(e) => setNewPackageUnit(e.target.value)}
                      placeholder="예) 100mL, 30T"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      평균공수(시간) <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      className={inputClass}
                      value={newAvgHours}
                      onChange={(e) => setNewAvgHours(e.target.value)}
                      placeholder="예) 4.5"
                    />
                  </div>
                </div>
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
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="h-10 w-full border-slate-300 text-slate-800 hover:bg-slate-100 sm:w-auto"
            >
              취소
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                creating ||
                !selectedProductId ||
                !newPackageUnit.trim() ||
                !newAvgHours
              }
              className="h-10 w-full bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800 sm:w-auto"
            >
              <Save size={15} className="mr-1.5" />
              {creating ? "등록 중..." : "등록"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
                <Gauge size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-black text-slate-950">
                  평균공수 수정
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
                  선택한 품목의 공수 기준을 업데이트합니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {editTarget && (
            <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
              <div className="grid gap-4">
                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <div className="mb-3 border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-950">
                      대상 품목
                    </h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      현재 수정 중인 품목 정보입니다.
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="font-mono text-[10px] font-bold text-blue-700">
                      {editTarget.productCode}
                    </p>
                    <p className="text-sm font-bold text-slate-950">
                      {editTarget.productName}
                    </p>
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                  <div className="mb-3 border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-black text-slate-950">
                      공수 정보
                    </h3>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      포장단위와 시간을 수정합니다.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold tracking-wide text-slate-700">
                        포장단위 <span className="text-rose-600">*</span>
                      </label>
                      <Input
                        className={inputClass}
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold tracking-wide text-slate-700">
                        평균공수(시간) <span className="text-rose-600">*</span>
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        className={inputClass}
                        value={editHours}
                        onChange={(e) => setEditHours(e.target.value)}
                      />
                    </div>
                  </div>
                </section>

                {error && (
                  <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
                    {error}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={editSaving}
              className="h-10 w-full border-slate-300 text-slate-800 hover:bg-slate-100 sm:w-auto"
            >
              취소
            </Button>
            <Button
              onClick={handleEdit}
              disabled={editSaving}
              className="h-10 w-full bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800 sm:w-auto"
            >
              <Save size={15} className="mr-1.5" />
              {editSaving ? "저장 중..." : "저장"}
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
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-white p-0 shadow-2xl sm:max-w-md">
          <DialogHeader className="border-b border-slate-200 bg-rose-50 px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-700 text-white shadow-sm">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-black text-slate-950">
                  평균공수 삭제 확인
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-rose-800">
                  선택한 기준은 목록에서 즉시 제거됩니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {deleteTarget && (
            <div className="px-4 py-4 sm:px-5">
              <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4">
                <p className="text-sm font-bold text-slate-950">
                  {deleteTarget.productName}
                </p>
                <p className="mt-1 font-mono text-xs font-semibold text-rose-800">
                  {deleteTarget.productCode}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-700">
                  포장단위 {deleteTarget.packageUnit} / 평균공수{" "}
                  {deleteTarget.avgHours.toFixed(2)}h
                </p>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  이 기준을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                </p>
              </div>
            </div>
          )}

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
              onClick={handleDelete}
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
  )
}
