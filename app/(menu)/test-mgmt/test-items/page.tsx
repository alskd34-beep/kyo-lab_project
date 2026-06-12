"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Link2,
  PackagePlus,
  Plus,
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

interface TestItemRow {
  id: string
  name: string
  category: string
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

interface ProductTestItemRow {
  testItemId: string
  testItemName: string
  isMandatory: boolean
  sequenceOrder: number
}

export default function TestItemsPage() {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [allTestItems, setAllTestItems] = useState<TestItemRow[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(
    null
  )
  const [linkedItems, setLinkedItems] = useState<ProductTestItemRow[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [dialogSearch, setDialogSearch] = useState("")
  const [dialogTab, setDialogTab] = useState<"전체" | Category>("전체")
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set())
  const [addLoading, setAddLoading] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [unlinkTarget, setUnlinkTarget] = useState<ProductTestItemRow | null>(
    null
  )
  const [unlinkLoading, setUnlinkLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts()
      void loadAllTestItems()
    })
  }, [])

  useEffect(() => {
    if (!selectedProduct) {
      queueMicrotask(() => {
        setLinkedItems([])
      })
      return
    }
    void loadLinkedItems(selectedProduct.id)
  }, [selectedProduct])

  async function loadProducts() {
    try {
      const res = await fetch("/api/products")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ProductRow[] }
      setProducts(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  async function loadAllTestItems() {
    setItemsLoading(true)
    try {
      const res = await fetch("/api/test-items")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: TestItemRow[] }
      setAllTestItems(data.rows)
    } catch (e) {
      setError(String(e))
    } finally {
      setItemsLoading(false)
    }
  }

  async function loadLinkedItems(productId: string) {
    try {
      const res = await fetch(`/api/product-test-items?productId=${productId}`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ProductTestItemRow[] }
      setLinkedItems(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  async function reorderLinked(items: ProductTestItemRow[]) {
    if (!selectedProduct) return
    const ordered = [...items].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    const orderedTestItemIds = ordered.map((item) => item.testItemId)
    try {
      const res = await fetch("/api/product-test-items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          orderedTestItemIds,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setLinkedItems(
        ordered.map((item, idx) => ({ ...item, sequenceOrder: idx }))
      )
    } catch {
      await loadLinkedItems(selectedProduct.id)
    }
  }

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.productCode.toLowerCase().includes(q)
    )
  }, [products, productSearch])

  const linkedIds = useMemo(
    () => new Set(linkedItems.map((item) => item.testItemId)),
    [linkedItems]
  )

  const availableToAdd = useMemo(
    () =>
      allTestItems.filter((item) => !linkedIds.has(item.id) && item.isActive),
    [allTestItems, linkedIds]
  )

  const dialogFiltered = useMemo(() => {
    const q = dialogSearch.trim().toLowerCase()
    return availableToAdd.filter((item) => {
      if (dialogTab !== "전체" && item.category !== dialogTab) return false
      if (q && !item.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [availableToAdd, dialogSearch, dialogTab])

  const dialogTabCounts = useMemo(() => {
    const counts: Record<string, number> = { 전체: availableToAdd.length }
    for (const category of CATEGORIES) {
      counts[category] = availableToAdd.filter(
        (item) => item.category === category
      ).length
    }
    return counts
  }, [availableToAdd])

  const summary = useMemo(() => {
    const linked = linkedItems.length
    const mandatory = linkedItems.filter((item) => item.isMandatory).length
    const optional = linked - mandatory
    return { linked, mandatory, optional }
  }, [linkedItems])

  function openAddDialog() {
    setSelectedToAdd(new Set())
    setDialogSearch("")
    setDialogTab("전체")
    setError(null)
    if (allTestItems.length === 0) void loadAllTestItems()
    setAddDialogOpen(true)
  }

  function toggleSelectAdd(id: string) {
    setSelectedToAdd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedToAdd(new Set(dialogFiltered.map((item) => item.id)))
  }

  function deselectAll() {
    setSelectedToAdd(new Set())
  }

  async function handleDeleteLinked(testItemId: string) {
    if (!selectedProduct) return
    const remaining = linkedItems.filter(
      (item) => item.testItemId !== testItemId
    )
    setLinkedItems(remaining)
    try {
      const res = await fetch("/api/product-test-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProduct.id, testItemId }),
      })
      if (!res.ok) throw new Error(await res.text())
      if (remaining.length > 0) await reorderLinked(remaining)
    } catch {
      await loadLinkedItems(selectedProduct.id)
    }
  }

  async function confirmUnlink() {
    if (!unlinkTarget) return
    setUnlinkLoading(true)
    try {
      await handleDeleteLinked(unlinkTarget.testItemId)
    } finally {
      setUnlinkLoading(false)
      setUnlinkTarget(null)
    }
  }

  async function handleAddItems() {
    if (!selectedProduct || selectedToAdd.size === 0) return
    setAddLoading(true)
    try {
      const maxOrder = linkedItems.reduce(
        (max, item) => Math.max(max, item.sequenceOrder),
        -1
      )
      const promises = Array.from(selectedToAdd).map((testItemId, idx) =>
        fetch("/api/product-test-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: selectedProduct.id,
            testItemId,
            sequenceOrder: maxOrder + 1 + idx,
          }),
        })
      )
      await Promise.all(promises)
      const refreshed = await loadLinkedItems(selectedProduct.id)
      if (refreshed && refreshed.length > 0) await reorderLinked(refreshed)
      setSelectedToAdd(new Set())
      setAddDialogOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setAddLoading(false)
    }
  }

  const dialogTabs = ["전체", ...CATEGORIES] as const
  const hasSelection = !!selectedProduct

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 bg-slate-200/70 p-3 md:p-5">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
            <Link2 size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="min-w-0 text-base font-bold text-slate-950 sm:text-lg">
              시험항목 연결
            </h1>
            <p className="text-xs font-medium text-slate-600">
              품목별 시험항목 연결과 순서를 관리합니다.
            </p>
          </div>
        </div>
        <div className="hidden flex-1 md:block" />
        {hasSelection && (
          <Button
            onClick={openAddDialog}
            size="sm"
            className="h-9 w-full bg-blue-700 text-white shadow-sm hover:bg-blue-800 md:w-auto"
          >
            <Plus size={15} className="mr-1" />
            시험항목 추가
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="mb-2 text-sm font-bold text-slate-950">품목 선택</p>
            <div className="relative">
              <Search
                size={13}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
              />
              <Input
                placeholder="품목명 / 코드 검색..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="h-9 bg-slate-50 pl-9 text-sm"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <p className="text-sm font-medium text-slate-600">
                  검색 결과가 없습니다.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredProducts.map((product) => {
                  const isSelected = selectedProduct?.id === product.id
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(product)}
                        className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? "border-blue-700 bg-blue-50"
                            : "border-transparent hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-[10px] font-bold ${
                              isSelected ? "text-blue-700" : "text-slate-500"
                            }`}
                          >
                            {product.productCode}
                          </span>
                          {product.isActive ? (
                            <Badge className="border-emerald-700 bg-emerald-700 text-[10px] font-bold text-white hover:bg-emerald-700">
                              활성
                            </Badge>
                          ) : (
                            <Badge className="border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600">
                              비활성
                            </Badge>
                          )}
                        </div>
                        <p
                          className={`mt-0.5 text-sm leading-snug font-medium ${
                            isSelected ? "text-blue-800" : "text-slate-800"
                          }`}
                        >
                          {product.name}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5">
            <p className="text-xs font-medium text-slate-600">
              총{" "}
              <span className="font-bold text-slate-950">
                {filteredProducts.length}
              </span>
              개 품목
            </p>
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md">
          {!selectedProduct ? (
            <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white shadow-sm">
                  <PackagePlus size={22} />
                </div>
                <h2 className="mt-4 text-base font-black text-slate-950">
                  품목을 선택하세요
                </h2>
                <p className="mt-2 text-sm font-medium text-slate-600">
                  좌측에서 품목을 선택하면 연결된 시험항목을 확인하고 추가하거나
                  정리할 수 있습니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-slate-200 px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-bold text-blue-700">
                      {selectedProduct.productCode}
                    </p>
                    <h2 className="truncate text-base font-black text-slate-950">
                      {selectedProduct.name}
                    </h2>
                    <p className="mt-1 text-xs font-medium text-slate-600">
                      {selectedProduct.packageSpec ?? "포장규격 미지정"}
                      {selectedProduct.unit ? ` · ${selectedProduct.unit}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-blue-700 bg-blue-700 text-xs font-bold text-white hover:bg-blue-700">
                      {summary.linked}건 연결
                    </Badge>
                    <Badge className="border-emerald-700 bg-emerald-700 text-xs font-bold text-white hover:bg-emerald-700">
                      필수 {summary.mandatory}
                    </Badge>
                    <Badge className="border-slate-600 bg-slate-600 text-xs font-bold text-white hover:bg-slate-600">
                      선택 {summary.optional}
                    </Badge>
                    <Button
                      onClick={openAddDialog}
                      size="sm"
                      className="h-9 bg-blue-700 text-white shadow-sm hover:bg-blue-800"
                    >
                      <Plus size={15} className="mr-1" />
                      항목 추가
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
                <div className="flex flex-col gap-2 md:hidden">
                  {linkedItems.length === 0 ? (
                    <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
                      연결된 시험항목이 없습니다.
                    </div>
                  ) : (
                    linkedItems
                      .slice()
                      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                      .map((item, idx) => (
                        <div
                          key={item.testItemId}
                          className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-bold text-slate-500">
                                  {idx + 1}
                                </span>
                                {item.isMandatory ? (
                                  <Badge className="border-rose-700 bg-rose-700 text-[10px] font-bold text-white hover:bg-rose-700">
                                    필수
                                  </Badge>
                                ) : (
                                  <Badge className="border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600">
                                    선택
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-sm font-bold text-slate-950">
                                {item.testItemName}
                              </p>
                            </div>
                            <button
                              onClick={() => setUnlinkTarget(item)}
                              className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                              title="연결 해제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                  )}
                </div>

                <div className="hidden overflow-auto rounded-lg border border-slate-300 bg-white shadow-sm md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-950 text-xs text-white">
                        <th className="sticky top-0 z-10 w-16 bg-slate-950 px-4 py-3 text-center font-bold">
                          순서
                        </th>
                        <th className="sticky top-0 z-10 bg-slate-950 px-4 py-3 text-left font-bold">
                          시험항목명
                        </th>
                        <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-center font-bold">
                          필수여부
                        </th>
                        <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-center font-bold">
                          삭제
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkedItems.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-16 text-center text-sm font-medium text-slate-600"
                          >
                            연결된 시험항목이 없습니다. 우측 상단에서
                            추가하세요.
                          </td>
                        </tr>
                      ) : (
                        linkedItems
                          .slice()
                          .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                          .map((item, idx) => (
                            <tr
                              key={item.testItemId}
                              className={`border-t border-slate-200 transition-colors hover:bg-blue-50 ${
                                idx % 2 === 1 ? "bg-slate-100/80" : "bg-white"
                              }`}
                            >
                              <td className="px-4 py-2.5 text-center text-xs font-bold text-slate-700">
                                {idx + 1}
                              </td>
                              <td className="px-4 py-2.5 font-semibold text-slate-950">
                                {item.testItemName}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {item.isMandatory ? (
                                  <Badge className="border-rose-700 bg-rose-700 text-[10px] font-bold text-white hover:bg-rose-700">
                                    필수
                                  </Badge>
                                ) : (
                                  <Badge className="border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600">
                                    선택
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <button
                                  onClick={() => setUnlinkTarget(item)}
                                  className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                                  title="연결 해제"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-2xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
                <PackagePlus size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-black text-slate-950">
                  시험항목 추가
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
                  활성 시험항목 중 현재 품목에 연결할 항목을 선택합니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
                  />
                  <Input
                    type="text"
                    placeholder="시험항목명 검색..."
                    value={dialogSearch}
                    onChange={(e) => setDialogSearch(e.target.value)}
                    className="h-10 bg-slate-50 pl-9"
                    autoFocus
                  />
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="flex flex-wrap gap-1">
                  {dialogTabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setDialogTab(tab as typeof dialogTab)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        dialogTab === tab
                          ? "bg-blue-700 text-white"
                          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {tab}
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                          dialogTab === tab
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {dialogTabCounts[tab] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>

                {dialogFiltered.length > 0 && (
                  <div className="mt-3 flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>
                      {dialogFiltered.length}개 항목
                      {selectedToAdd.size > 0 && (
                        <span className="ml-1 font-bold text-blue-700">
                          ({selectedToAdd.size}개 선택)
                        </span>
                      )}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAll}
                        className="font-bold text-blue-700 hover:underline"
                      >
                        전체선택
                      </button>
                      <button
                        onClick={deselectAll}
                        className="font-bold text-slate-500 hover:underline"
                      >
                        전체해제
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                  {itemsLoading ? (
                    <p className="py-8 text-center text-sm font-medium text-slate-600">
                      불러오는 중...
                    </p>
                  ) : dialogFiltered.length === 0 ? (
                    <p className="py-8 text-center text-sm font-medium text-slate-600">
                      {availableToAdd.length === 0
                        ? "추가할 수 있는 시험항목이 없습니다."
                        : "검색 결과가 없습니다."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {dialogFiltered.map((item) => (
                        <li key={item.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={selectedToAdd.has(item.id)}
                              onChange={() => toggleSelectAdd(item.id)}
                              className="cb-custom"
                            />
                            <span className="flex-1 text-sm font-medium text-slate-800">
                              {item.name}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                                CATEGORY_COLORS[item.category] ??
                                CATEGORY_COLORS["기타"]
                              }`}
                            >
                              {item.category || "기타"}
                            </span>
                            {item.estimatedHours != null && (
                              <span className="text-xs font-medium text-slate-500">
                                {item.estimatedHours}h
                              </span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
              disabled={addLoading}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              onClick={() => void handleAddItems()}
              disabled={addLoading || selectedToAdd.size === 0}
              className="h-10 bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800"
            >
              <Plus size={15} className="mr-1.5" />
              {addLoading ? "추가 중..." : `추가 (${selectedToAdd.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!unlinkTarget}
        onOpenChange={(open) => {
          if (!open && !unlinkLoading) setUnlinkTarget(null)
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
                  연결 해제
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-rose-800">
                  이 품목에서 시험항목 연결을 제거합니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-5">
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4">
              <p className="text-sm font-bold text-slate-950">
                {unlinkTarget?.testItemName}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {selectedProduct?.name}에서 이 시험항목 연결을 해제하시겠습니까?
              </p>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              onClick={() => setUnlinkTarget(null)}
              disabled={unlinkLoading}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              onClick={() => void confirmUnlink()}
              disabled={unlinkLoading}
              className="h-10 bg-rose-700 px-5 font-bold text-white shadow-sm hover:bg-rose-800"
            >
              <Trash2 size={15} className="mr-1.5" />
              {unlinkLoading ? "해제 중..." : "해제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
