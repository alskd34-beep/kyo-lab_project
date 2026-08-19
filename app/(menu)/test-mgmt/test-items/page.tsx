"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Copy,
  Link2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"

import { Badge } from "@frontend/components/ui/badge"
import { Tag } from "@frontend/components/ui/tag"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"
import { SortColumnHeader, sortCol, type SortDir } from "@frontend/components/ui/table-sort"
import { StatusFilterTabs, type StatusFilterValue } from "@frontend/components/ui/status-filter-tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"

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
  함량시험: "border-blue-300 bg-blue-100 text-blue-800",
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
  const [productStatusFilter, setProductStatusFilter] = useState<StatusFilterValue>("all")
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
  // 선택 일괄 삭제
  const [selectedLinked, setSelectedLinked] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false)
  // 테이블 정렬
  type LinkedSortField = "sequenceOrder" | "testItemName" | "isMandatory"
  const LINKED_SORT_COLUMNS = [
    sortCol<LinkedSortField>("sequenceOrder", "순서"),
    sortCol<LinkedSortField>("testItemName", "시험항목명"),
    sortCol<LinkedSortField>("isMandatory", "필수여부"),
  ]
  const [sortField, setSortField] = useState<LinkedSortField>("sequenceOrder")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const pickSort = (field: LinkedSortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }
  // 다른 품목에서 시험항목 복사
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  const [copySourceSearch, setCopySourceSearch] = useState("")
  const [copySource, setCopySource] = useState<ProductRow | null>(null)
  const [copySourceItems, setCopySourceItems] = useState<ProductTestItemRow[]>([])
  const [copySelected, setCopySelected] = useState<Set<string>>(new Set())
  const [copyLoading, setCopyLoading] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts()
      void loadAllTestItems()
    })
  }, [])

  useEffect(() => {
    setSelectedLinked(new Set())
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

  async function loadLinkedItems(productId: string): Promise<ProductTestItemRow[]> {
    try {
      const res = await fetch(`/api/product-test-items?productId=${productId}`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ProductTestItemRow[] }
      setLinkedItems(data.rows)
      return data.rows
    } catch (e) {
      setError(String(e))
      return []
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
    let list = q
      ? products.filter(
          (product) =>
            product.name.toLowerCase().includes(q) ||
            product.productCode.toLowerCase().includes(q)
        )
      : products
    if (productStatusFilter !== "all") {
      list = list.filter((p) => p.isActive === (productStatusFilter === "active"))
    }
    // 활성 품목을 항상 위로 올린다. 원래 정렬(sort_order)은 그룹 안에서 그대로 유지된다(stable sort).
    return [...list].sort((a, b) => Number(b.isActive) - Number(a.isActive))
  }, [products, productSearch, productStatusFilter])

  const productStatusCounts = useMemo(() => {
    const active = products.filter((p) => p.isActive).length
    return { all: products.length, active, inactive: products.length - active }
  }, [products])

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

  // 복사 원본 품목 후보(현재 품목 제외 + 검색)
  const copyFilteredProducts = useMemo(() => {
    const q = copySourceSearch.trim().toLowerCase()
    return products
      .filter((p) => p.id !== selectedProduct?.id)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.productCode.toLowerCase().includes(q)
      )
  }, [products, copySourceSearch, selectedProduct])

  const sortedLinkedItems = useMemo(() => {
    const items = linkedItems.slice()
    items.sort((a, b) => {
      let cmp = 0
      if (sortField === "sequenceOrder") {
        cmp = a.sequenceOrder - b.sequenceOrder
      } else if (sortField === "testItemName") {
        cmp = a.testItemName.localeCompare(b.testItemName, "ko")
      } else if (sortField === "isMandatory") {
        // 필수(true) 먼저
        cmp = (b.isMandatory ? 1 : 0) - (a.isMandatory ? 1 : 0)
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return items
  }, [linkedItems, sortField, sortDir])

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
      if (refreshed.length > 0) await reorderLinked(refreshed)
      setSelectedToAdd(new Set())
      setAddDialogOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setAddLoading(false)
    }
  }

  // ── 선택 일괄 삭제 ──
  function toggleSelectLinked(testItemId: string) {
    setSelectedLinked((prev) => {
      const next = new Set(prev)
      if (next.has(testItemId)) next.delete(testItemId)
      else next.add(testItemId)
      return next
    })
  }
  function toggleSelectAllLinked() {
    setSelectedLinked((prev) =>
      prev.size === linkedItems.length && linkedItems.length > 0
        ? new Set()
        : new Set(linkedItems.map((i) => i.testItemId))
    )
  }
  async function handleBulkDelete() {
    if (!selectedProduct || selectedLinked.size === 0) return
    setBulkDeleteLoading(true)
    const ids = Array.from(selectedLinked)
    const remaining = linkedItems.filter(
      (i) => !selectedLinked.has(i.testItemId)
    )
    setLinkedItems(remaining)
    try {
      await Promise.all(
        ids.map((testItemId) =>
          fetch("/api/product-test-items", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: selectedProduct.id,
              testItemId,
            }),
          })
        )
      )
      if (remaining.length > 0) await reorderLinked(remaining)
      setSelectedLinked(new Set())
      setBulkDeleteOpen(false)
    } catch (e) {
      setError(String(e))
      await loadLinkedItems(selectedProduct.id)
    } finally {
      setBulkDeleteLoading(false)
    }
  }

  // ── 다른 품목에서 복사 ──
  function openCopyDialog() {
    setCopySource(null)
    setCopySourceItems([])
    setCopySelected(new Set())
    setCopySourceSearch("")
    setError(null)
    setCopyDialogOpen(true)
  }
  async function selectCopySource(product: ProductRow) {
    setCopySource(product)
    setCopySourceItems([])
    setCopySelected(new Set())
    try {
      const res = await fetch(`/api/product-test-items?productId=${product.id}`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ProductTestItemRow[] }
      setCopySourceItems(data.rows)
      // 현재 품목에 아직 없는 항목만 기본 선택(중복 제외)
      setCopySelected(
        new Set(
          data.rows
            .filter((r) => !linkedIds.has(r.testItemId))
            .map((r) => r.testItemId)
        )
      )
    } catch (e) {
      setError(String(e))
    }
  }
  function toggleCopySelect(testItemId: string) {
    setCopySelected((prev) => {
      const next = new Set(prev)
      if (next.has(testItemId)) next.delete(testItemId)
      else next.add(testItemId)
      return next
    })
  }
  async function handleCopy() {
    if (!selectedProduct || copySelected.size === 0) return
    setCopyLoading(true)
    try {
      const toAdd = Array.from(copySelected).filter((id) => !linkedIds.has(id))
      const maxOrder = linkedItems.reduce(
        (max, item) => Math.max(max, item.sequenceOrder),
        -1
      )
      await Promise.all(
        toAdd.map((testItemId, idx) =>
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
      )
      const refreshed = await loadLinkedItems(selectedProduct.id)
      if (refreshed.length > 0) await reorderLinked(refreshed)
      setCopyDialogOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setCopyLoading(false)
    }
  }

  const dialogTabs = ["전체", ...CATEGORIES] as const
  const hasSelection = !!selectedProduct

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 md:p-6">
      {/* 페이지 헤더 */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link2 className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">
              품목별 시험항목 관리
            </h1>
            <p className="text-sm text-muted-foreground">
              품목 마스터와 시험항목 마스터를 연결하고 순서를 관리합니다.
            </p>
          </div>
        </div>
        <div className="hidden flex-1 md:block" />
        {hasSelection && (
          <Button onClick={openAddDialog} size="lg">
            <Plus />
            시험항목 추가
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 품목 사이드바 */}
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0 max-h-[40vh] lg:max-h-none">
          <div className="border-b px-4 py-3">
            <p className="mb-2 text-sm font-medium text-foreground">품목 선택</p>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="품목명 / 코드 검색..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
            <StatusFilterTabs
              value={productStatusFilter}
              onChange={setProductStatusFilter}
              counts={productStatusCounts}
              activeLabel="활성"
              inactiveLabel="비활성"
              className="mt-2 w-full"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <p className="text-sm text-muted-foreground">
                  검색 결과가 없습니다.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {filteredProducts.map((product) => {
                  const isSelected = selectedProduct?.id === product.id
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(product)}
                        className={cn(
                          "w-full border-l-2 px-4 py-3 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-mono text-[10px] font-medium",
                              isSelected ? "text-primary" : "text-muted-foreground"
                            )}
                          >
                            {product.productCode}
                          </span>
                          {product.isActive ? (
                            <Tag color="green" className="text-[10px]">활성</Tag>
                          ) : (
                            <Tag color="mono" className="text-[10px]">비활성</Tag>
                          )}
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 text-sm leading-snug font-medium",
                            isSelected ? "text-foreground" : "text-foreground"
                          )}
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

          <div className="border-t bg-muted/30 px-4 py-2.5">
            <p className="text-xs text-muted-foreground">
              총{" "}
              <span className="font-semibold text-foreground">
                {filteredProducts.length}
              </span>
              개 품목
            </p>
          </div>
        </Card>

        {/* 시험항목 패널 */}
        <Card className="gap-0 overflow-hidden py-0">
          {!selectedProduct ? (
            <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <PackagePlus className="size-6" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-foreground">
                  품목을 선택하세요
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  좌측에서 품목을 선택하면 연결된 시험항목을 확인하고 추가하거나
                  정리할 수 있습니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-medium text-muted-foreground">
                      {selectedProduct.productCode}
                    </p>
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {selectedProduct.name}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedProduct.packageSpec ?? "포장규격 미지정"}
                      {selectedProduct.unit ? ` · ${selectedProduct.unit}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{summary.linked}건 연결</Badge>
                    <Badge variant="outline" className="gap-1">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      필수 {summary.mandatory}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <span className="size-1.5 rounded-full bg-muted-foreground" />
                      선택 {summary.optional}
                    </Badge>
                    {selectedLinked.size > 0 && (
                      <Button
                        onClick={() => setBulkDeleteOpen(true)}
                        size="sm"
                        variant="destructive"
                      >
                        <Trash2 />
                        선택 삭제 ({selectedLinked.size})
                      </Button>
                    )}
                    <Button
                      onClick={openCopyDialog}
                      size="sm"
                      variant="outline"
                    >
                      <Copy />
                      다른 품목에서 복사
                    </Button>
                    <Button
                      onClick={openAddDialog}
                      size="sm"
                    >
                      <Plus />
                      항목 추가
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
                {/* 모바일 카드 목록 */}
                <div className="flex flex-col gap-2 md:hidden">
                  {linkedItems.length === 0 ? (
                    <Card className="items-center py-6 text-center text-sm text-muted-foreground">
                      연결된 시험항목이 없습니다.
                    </Card>
                  ) : (
                    sortedLinkedItems
                      .map((item, idx) => (
                        <Card
                          key={item.testItemId}
                          className="gap-0 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="cb-custom"
                                  checked={selectedLinked.has(item.testItemId)}
                                  onChange={() =>
                                    toggleSelectLinked(item.testItemId)
                                  }
                                />
                                <span className="text-[11px] text-muted-foreground">
                                  {idx + 1}
                                </span>
                                {item.isMandatory ? (
                                  <Badge variant="outline" className="gap-1 text-[10px]">
                                    <span className="size-1.5 rounded-full bg-red-500" />
                                    필수
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="gap-1 text-[10px]">
                                    <span className="size-1.5 rounded-full bg-muted-foreground" />
                                    선택
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-sm font-medium text-foreground">
                                {item.testItemName}
                              </p>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setUnlinkTarget(item)}
                              title="연결 해제"
                              className="size-8 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </Card>
                      ))
                  )}
                </div>

                {/* 데스크톱 테이블 */}
                <Card className="hidden gap-0 overflow-hidden py-0 md:block">
                  <Table>
                    <colgroup>
                      <col className="w-[8%]" />
                      <col className="w-[10%]" />
                      <col />
                      <col className="w-[16%]" />
                      <col className="w-[10%]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10 px-3 text-muted-foreground">
                          <input
                            type="checkbox"
                            className="cb-custom"
                            checked={
                              linkedItems.length > 0 &&
                              selectedLinked.size === linkedItems.length
                            }
                            onChange={toggleSelectAllLinked}
                            title="전체 선택"
                          />
                        </TableHead>
                        {LINKED_SORT_COLUMNS.map((col) => (
                          <TableHead
                            key={col.key}
                            className={cn(
                              "px-3 text-muted-foreground",
                              col.key !== "testItemName" && "text-center",
                            )}
                          >
                            <div className={cn(col.key !== "testItemName" && "flex justify-center")}>
                              <SortColumnHeader
                                col={col}
                                sortField={sortField}
                                sortDir={sortDir}
                                onPick={pickSort}
                              />
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="w-20 px-3 text-center text-muted-foreground">
                          삭제
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedItems.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={5}
                            className="py-16 text-center text-sm text-muted-foreground"
                          >
                            연결된 시험항목이 없습니다. 우측 상단에서
                            추가하세요.
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedLinkedItems
                          .map((item, idx) => {
                            const isSelected = selectedLinked.has(item.testItemId)
                            return (
                              <TableRow
                                key={item.testItemId}
                                className={cn(isSelected && "bg-primary/5")}
                              >
                                <TableCell className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    className="cb-custom"
                                    checked={isSelected}
                                    onChange={() =>
                                      toggleSelectLinked(item.testItemId)
                                    }
                                  />
                                </TableCell>
                                <TableCell className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                                  {idx + 1}
                                </TableCell>
                                <TableCell className="px-3 py-2.5 font-medium text-foreground">
                                  <span className="block truncate" title={item.testItemName}>
                                    {item.testItemName}
                                  </span>
                                </TableCell>
                                <TableCell className="px-3 py-2.5 text-center">
                                  {item.isMandatory ? (
                                    <Badge variant="outline" className="gap-1">
                                      <span className="size-1.5 rounded-full bg-red-500" />
                                      필수
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="gap-1">
                                      <span className="size-1.5 rounded-full bg-muted-foreground" />
                                      선택
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="px-3 py-2.5 text-center">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setUnlinkTarget(item)}
                                    title="연결 해제"
                                    className="size-8 text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          })
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 시험항목 추가 다이얼로그 */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>시험항목 추가</DialogTitle>
            <DialogDescription>
              활성 시험항목 중 현재 품목에 연결할 항목을 선택합니다.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="시험항목명 검색..."
                  value={dialogSearch}
                  onChange={(e) => setDialogSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="flex flex-wrap gap-1">
                {dialogTabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDialogTab(tab as typeof dialogTab)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      dialogTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "border bg-background text-foreground hover:bg-muted/50"
                    )}
                  >
                    {tab}
                    <span
                      className={cn(
                        "ml-1.5 rounded-md px-1.5 py-0.5 text-[10px]",
                        dialogTab === tab
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {dialogTabCounts[tab] ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              {dialogFiltered.length > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {dialogFiltered.length}개 항목
                    {selectedToAdd.size > 0 && (
                      <span className="ml-1 font-medium text-primary">
                        ({selectedToAdd.size}개 선택)
                      </span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAll}
                      className="font-medium text-primary hover:underline"
                    >
                      전체선택
                    </button>
                    <button
                      onClick={deselectAll}
                      className="font-medium text-muted-foreground hover:underline"
                    >
                      전체해제
                    </button>
                  </div>
                </div>
              )}

              <Card className="gap-0 overflow-hidden py-0">
                <div className="max-h-72 overflow-y-auto">
                  {itemsLoading ? (
                    <ul className="divide-y">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                          <Skeleton className="h-4 w-4 rounded" />
                          <Skeleton className="h-4 flex-1" />
                          <Skeleton className="h-4 w-14 rounded-md" />
                        </li>
                      ))}
                    </ul>
                  ) : dialogFiltered.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {availableToAdd.length === 0
                        ? "추가할 수 있는 시험항목이 없습니다."
                        : "검색 결과가 없습니다."}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {dialogFiltered.map((item) => (
                        <li key={item.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={selectedToAdd.has(item.id)}
                              onChange={() => toggleSelectAdd(item.id)}
                              className="cb-custom"
                            />
                            <span className="flex-1 text-sm font-medium text-foreground">
                              {item.name}
                            </span>
                            <span
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                                CATEGORY_COLORS[item.category] ??
                                  CATEGORY_COLORS["기타"]
                              )}
                            >
                              {item.category || "기타"}
                            </span>
                            {item.estimatedHours != null && (
                              <span className="text-xs text-muted-foreground">
                                {item.estimatedHours}h
                              </span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddDialogOpen(false)}
              disabled={addLoading}
            >
              취소
            </Button>
            <Button
              onClick={() => void handleAddItems()}
              disabled={addLoading || selectedToAdd.size === 0}
            >
              <Plus />
              {addLoading ? "추가 중..." : `추가 (${selectedToAdd.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 연결 해제 확인 다이얼로그 */}
      <Dialog
        open={!!unlinkTarget}
        onOpenChange={(open) => {
          if (!open && !unlinkLoading) setUnlinkTarget(null)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>연결 해제</DialogTitle>
            <DialogDescription>
              이 품목에서 시험항목 연결을 제거합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium">
              {unlinkTarget?.testItemName}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {selectedProduct?.name}에서 이 시험항목 연결을 해제하시겠습니까?
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUnlinkTarget(null)}
              disabled={unlinkLoading}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmUnlink()}
              disabled={unlinkLoading}
            >
              <Trash2 />
              {unlinkLoading ? "해제 중..." : "해제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 다른 품목에서 시험항목 복사 */}
      <Dialog
        open={copyDialogOpen}
        onOpenChange={(open) => {
          if (!open && !copyLoading) setCopyDialogOpen(false)
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>다른 품목에서 시험항목 복사</DialogTitle>
            <DialogDescription>
              비슷한 품목을 선택하면 그 품목의 시험항목을{" "}
              <span className="font-medium text-foreground">
                {selectedProduct?.name}
              </span>
              에 복사합니다. (이미 연결된 항목은 자동 제외)
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">
                  1. 복사할 원본 품목 선택
                </p>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="품목명 / 코드 검색..."
                    value={copySourceSearch}
                    onChange={(e) => setCopySourceSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Card className="mt-3 gap-0 overflow-hidden py-0">
                  <div className="max-h-48 overflow-y-auto">
                    {copyFilteredProducts.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        검색 결과가 없습니다.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {copyFilteredProducts.slice(0, 100).map((p) => (
                          <li key={p.id}>
                            <button
                              onClick={() => void selectCopySource(p)}
                              className={cn(
                                "flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50",
                                copySource?.id === p.id && "bg-primary/5"
                              )}
                            >
                              <span className="font-mono text-[10px] font-medium text-muted-foreground">
                                {p.productCode}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium text-foreground">
                                {p.name}
                              </span>
                              {copySource?.id === p.id && (
                                <span className="text-xs font-medium text-primary">
                                  선택됨
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              </div>

              {copySource && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">
                      2. 복사할 시험항목
                      {copySelected.size > 0 && (
                        <span className="ml-1 font-medium text-primary">
                          ({copySelected.size}개 선택)
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() =>
                          setCopySelected(
                            new Set(
                              copySourceItems
                                .filter((r) => !linkedIds.has(r.testItemId))
                                .map((r) => r.testItemId)
                            )
                          )
                        }
                        className="font-medium text-primary hover:underline"
                      >
                        미연결 전체
                      </button>
                      <button
                        onClick={() => setCopySelected(new Set())}
                        className="font-medium text-muted-foreground hover:underline"
                      >
                        전체해제
                      </button>
                    </div>
                  </div>
                  <Card className="gap-0 overflow-hidden py-0">
                    <div className="max-h-56 overflow-y-auto">
                      {copySourceItems.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          이 품목에는 연결된 시험항목이 없습니다.
                        </p>
                      ) : (
                        <ul className="divide-y">
                          {copySourceItems
                            .slice()
                            .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                            .map((r) => {
                              const already = linkedIds.has(r.testItemId)
                              return (
                                <li key={r.testItemId}>
                                  <label
                                    className={cn(
                                      "flex items-center gap-3 px-4 py-2.5",
                                      already
                                        ? "opacity-50"
                                        : "cursor-pointer hover:bg-muted/50"
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      className="cb-custom"
                                      disabled={already}
                                      checked={copySelected.has(r.testItemId)}
                                      onChange={() =>
                                        toggleCopySelect(r.testItemId)
                                      }
                                    />
                                    <span className="flex-1 text-sm font-medium text-foreground">
                                      {r.testItemName}
                                    </span>
                                    {already && (
                                      <span className="text-[10px] text-muted-foreground">
                                        이미 연결됨
                                      </span>
                                    )}
                                  </label>
                                </li>
                              )
                            })}
                        </ul>
                      )}
                    </div>
                  </Card>
                </div>
              )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCopyDialogOpen(false)}
              disabled={copyLoading}
            >
              취소
            </Button>
            <Button
              onClick={() => void handleCopy()}
              disabled={copyLoading || copySelected.size === 0}
            >
              <Copy />
              {copyLoading ? "복사 중..." : `복사 (${copySelected.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 선택 일괄 삭제 확인 */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !bulkDeleteLoading) setBulkDeleteOpen(false)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>선택 항목 일괄 삭제</DialogTitle>
            <DialogDescription>
              선택한 시험항목 연결을 한 번에 제거합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium">
              {selectedLinked.size}개 시험항목
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {selectedProduct?.name}에서 선택한 {selectedLinked.size}개
              시험항목 연결을 해제하시겠습니까?
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleteLoading}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleBulkDelete()}
              disabled={bulkDeleteLoading}
            >
              <Trash2 />
              {bulkDeleteLoading ? "삭제 중..." : `삭제 (${selectedLinked.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
