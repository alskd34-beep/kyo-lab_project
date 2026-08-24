"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  Copy,
  Layers,
  Link2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { useVirtualWindow } from "@frontend/hooks/use-virtual-window"
import { api, errorMessage } from "@frontend/lib/api-client"
import { useToastMessage } from "@frontend/components/common/toast-message"

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
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { PageHeader } from "@frontend/components/common/page-header"
import { CATEGORIES, CategoryBadge, type Category } from "@frontend/components/test-mgmt/test-category"
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

/* 대분류 목록·색은 `test-mgmt/test-category` 하나만 쓴다.
   여기에 같은 분류를 다른 색으로 복사해 두면 마스터 화면과 이 화면의 같은 분류가 다른 색으로 보인다. */

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

/** 시험항목 그룹('전공정' 등) — 품목에 통째로 넣는 템플릿 */
interface TestItemGroupRow {
  id: string
  name: string
  description: string | null
  itemCount: number
}

/** 그룹에 속한 시험항목 (그룹 내 순번 오름차순) */
interface TestItemGroupItemRow {
  testItemId: string
  testItemName: string
  category: string
  sequenceOrder: number
}

/** 품목 사이드바 한 줄의 고정 높이(px). 가상 스크롤 계산의 기준이라 마크업과 반드시 일치해야 한다. */
/**
 * 첫 페인트에서 아직 실측값이 없을 때만 쓰는 대략치.
 * 실제 높이는 useVirtualWindow 가 렌더된 행(itemRef)을 재서 쓴다.
 * 루트 폰트가 18px 이라 목록 행의 `h-16` 은 64px 이 아니라 72px 이다.
 */
const PRODUCT_ITEM_FALLBACK = 72

export default function TestItemsPage() {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [allTestItems, setAllTestItems] = useState<TestItemRow[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(
    null
  )
  const [linkedItems, setLinkedItems] = useState<ProductTestItemRow[]>([])
  /** 품목을 바꿀 때 연결 목록을 다시 받는 동안 — 빈 목록 문구가 먼저 번쩍이지 않게 Skeleton 을 세운다. */
  const [linkedLoading, setLinkedLoading] = useState(false)
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
  const [linkedDetailTarget, setLinkedDetailTarget] = useState<ProductTestItemRow | null>(null)
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
  // 그룹 넣기 (시험항목 그룹을 품목에 통째로 추가)
  const { showToast } = useToastMessage()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [groups, setGroups] = useState<TestItemGroupRow[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupSearch, setGroupSearch] = useState("")
  const [selectedGroup, setSelectedGroup] = useState<TestItemGroupRow | null>(null)
  const [groupItems, setGroupItems] = useState<TestItemGroupItemRow[]>([])
  const [groupItemsLoading, setGroupItemsLoading] = useState(false)
  const [groupApplyLoading, setGroupApplyLoading] = useState(false)

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
    setLinkedLoading(true)
    void loadLinkedItems(selectedProduct.id).finally(() => setLinkedLoading(false))
  }, [selectedProduct])

  /* 읽기 호출은 공용 `api` 클라이언트를 쓴다 — 서버의 `{ error }` 를 한국어 문장으로 뽑아
     주므로 배너에 `Error: {...}` 같은 원시 문자열이 뜨지 않는다(이 파일의 그룹 관련 함수와 동일). */
  async function loadProducts() {
    try {
      const data = await api.get<{ rows: ProductRow[] }>("/api/products")
      setProducts(data.rows)
    } catch (e) {
      setError(errorMessage(e, "품목 목록을 불러오지 못했습니다."))
    }
  }

  async function loadAllTestItems() {
    setItemsLoading(true)
    try {
      const data = await api.get<{ rows: TestItemRow[] }>("/api/test-items")
      setAllTestItems(data.rows)
    } catch (e) {
      setError(errorMessage(e, "시험항목 목록을 불러오지 못했습니다."))
    } finally {
      setItemsLoading(false)
    }
  }

  async function loadLinkedItems(productId: string): Promise<ProductTestItemRow[]> {
    try {
      const data = await api.get<{ rows: ProductTestItemRow[] }>(
        `/api/product-test-items?productId=${productId}`
      )
      setLinkedItems(data.rows)
      return data.rows
    } catch (e) {
      setError(errorMessage(e, "연결된 시험항목을 불러오지 못했습니다."))
      return []
    }
  }

  async function reorderLinked(items: ProductTestItemRow[]) {
    if (!selectedProduct) return
    const ordered = [...items].sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    const orderedTestItemIds = ordered.map((item) => item.testItemId)
    try {
      await api.post("/api/product-test-items/reorder", {
        productId: selectedProduct.id,
        orderedTestItemIds,
      })
      setLinkedItems(
        ordered.map((item, idx) => ({ ...item, sequenceOrder: idx }))
      )
    } catch (e) {
      /* 되돌리기만 하면 사용자는 "왜 원래대로 돌아갔지?" 만 남는다 — 이유를 말한다. */
      setError(errorMessage(e, "순서를 저장하지 못했습니다."))
      await loadLinkedItems(selectedProduct.id)
    }
  }

  const deferredProductSearch = useDeferredValue(productSearch)

  const filteredProducts = useMemo(() => {
    const q = deferredProductSearch.trim().toLowerCase()
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
  }, [products, deferredProductSearch, productStatusFilter])

  /** 품목이 2,000건까지 오므로 보이는 구간만 그린다. 행 높이는 훅이 실제로 재서 쓴다(itemRef). */
  const {
    containerRef: productListRef,
    start: productStart,
    end: productEnd,
    padTop: productPadTop,
    padBottom: productPadBottom,
    itemRef: productItemRef,
  } = useVirtualWindow(filteredProducts.length, PRODUCT_ITEM_FALLBACK)
  const windowedProducts = filteredProducts.slice(productStart, productEnd)

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

  // 그룹 후보(검색). 이름·설명 모두에서 찾는다.
  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description ?? "").toLowerCase().includes(q)
    )
  }, [groups, groupSearch])

  // 그룹 미리보기 요약 — 이미 있는 항목은 건너뛰므로 실제 추가될 개수만 따로 센다.
  const groupPreview = useMemo(() => {
    const already = groupItems.filter((i) => linkedIds.has(i.testItemId)).length
    return { total: groupItems.length, already, toAdd: groupItems.length - already }
  }, [groupItems, linkedIds])

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
      await api.del("/api/product-test-items", {
        productId: selectedProduct.id,
        testItemId,
      })
      if (remaining.length > 0) await reorderLinked(remaining)
    } catch (e) {
      setError(errorMessage(e, "시험항목 연결을 해제하지 못했습니다."))
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
      /* 날 fetch 를 Promise.all 에 넘기면 서버가 500 을 줘도 resolve 라
         실패가 조용히 삼켜진다(다이얼로그가 닫히고 성공처럼 보인다).
         api.post 는 !res.ok 를 에러로 올려 아래 catch 가 배너에 띄운다. */
      await Promise.all(
        Array.from(selectedToAdd).map((testItemId, idx) =>
          api.post("/api/product-test-items", {
            productId: selectedProduct.id,
            testItemId,
            sequenceOrder: maxOrder + 1 + idx,
          })
        )
      )
      const refreshed = await loadLinkedItems(selectedProduct.id)
      if (refreshed.length > 0) await reorderLinked(refreshed)
      setSelectedToAdd(new Set())
      setAddDialogOpen(false)
    } catch (e) {
      setError(errorMessage(e, "시험항목을 추가하지 못했습니다."))
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
      /* api.del 로 바꿔 실패를 catch 까지 올린다(날 fetch 는 500 도 resolve). */
      await Promise.all(
        ids.map((testItemId) =>
          api.del("/api/product-test-items", {
            productId: selectedProduct.id,
            testItemId,
          })
        )
      )
      if (remaining.length > 0) await reorderLinked(remaining)
      setSelectedLinked(new Set())
      setBulkDeleteOpen(false)
    } catch (e) {
      setError(errorMessage(e, "선택한 시험항목을 삭제하지 못했습니다."))
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
      const data = await api.get<{ rows: ProductTestItemRow[] }>(
        `/api/product-test-items?productId=${product.id}`
      )
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
      setError(errorMessage(e, "원본 품목의 시험항목을 불러오지 못했습니다."))
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
      /* api.post 로 바꿔 실패를 catch 까지 올린다(날 fetch 는 500 도 resolve). */
      await Promise.all(
        toAdd.map((testItemId, idx) =>
          api.post("/api/product-test-items", {
            productId: selectedProduct.id,
            testItemId,
            sequenceOrder: maxOrder + 1 + idx,
          })
        )
      )
      const refreshed = await loadLinkedItems(selectedProduct.id)
      if (refreshed.length > 0) await reorderLinked(refreshed)
      setCopyDialogOpen(false)
    } catch (e) {
      setError(errorMessage(e, "시험항목을 복사하지 못했습니다."))
    } finally {
      setCopyLoading(false)
    }
  }

  // ── 그룹 넣기 ──
  function openGroupDialog() {
    setSelectedGroup(null)
    setGroupItems([])
    setGroupSearch("")
    setError(null)
    setGroupDialogOpen(true)
    void loadGroups()
  }

  async function loadGroups() {
    setGroupsLoading(true)
    try {
      const data = await api.get<{ rows: TestItemGroupRow[] }>("/api/test-item-groups")
      setGroups(data.rows)
    } catch (e) {
      setError(errorMessage(e, "그룹 목록을 불러오지 못했습니다."))
    } finally {
      setGroupsLoading(false)
    }
  }

  async function selectGroup(group: TestItemGroupRow) {
    setSelectedGroup(group)
    setGroupItems([])
    setGroupItemsLoading(true)
    try {
      const data = await api.get<{ rows: TestItemGroupItemRow[] }>(
        `/api/test-item-groups/${group.id}/items`
      )
      setGroupItems(
        data.rows.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder)
      )
    } catch (e) {
      setError(errorMessage(e, "그룹 항목을 불러오지 못했습니다."))
    } finally {
      setGroupItemsLoading(false)
    }
  }

  async function handleApplyGroup() {
    if (!selectedProduct || !selectedGroup) return
    setGroupApplyLoading(true)
    try {
      // 서버가 이미 있는 항목은 건너뛰고 없는 것만 품목 끝에 그룹 순서대로 덧붙인다.
      const { added } = await api.post<{ ok: boolean; added: number }>(
        `/api/test-item-groups/${selectedGroup.id}/apply`,
        { productId: selectedProduct.id }
      )
      await loadLinkedItems(selectedProduct.id)
      setGroupDialogOpen(false)
      if (added > 0) {
        showToast({
          title: `${added}개 추가됨`,
          description: `'${selectedGroup.name}' 그룹을 ${selectedProduct.name}에 넣었습니다.`,
          variant: "success",
        })
      } else {
        showToast({
          title: "추가할 항목이 없습니다.",
          description: `'${selectedGroup.name}' 그룹의 항목이 이미 모두 연결되어 있습니다.`,
          variant: "info",
        })
      }
    } catch (e) {
      const message = errorMessage(e, "그룹을 넣지 못했습니다.")
      setError(message)
      showToast({ title: "그룹 넣기 실패", description: message, variant: "error" })
    } finally {
      setGroupApplyLoading(false)
    }
  }

  const dialogTabs = ["전체", ...CATEGORIES] as const
  const hasSelection = !!selectedProduct

  return (
    /* md 이상: 페이지는 고정 높이고 좌(목록)·우(연결 항목) 두 판이 각자 스크롤한다 —
       그래야 가상 스크롤이 실제로 보이는 높이를 잰다(예전에는 바깥이 통째로 늘어나
       사이드바가 품목 수만큼 세로로 자라 가상화가 무력해졌다).
       md 미만: 두 판을 각각 반쪽 높이로 눌러 놓으면 툴바만으로 화면이 차 버린다.
       모바일에서는 페이지 자체가 스크롤하고 두 판은 내용만큼 자란다. */
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:overflow-hidden md:p-6">
      {/* 화면 이름을 되풀이하는 부제 대신 지금 다루는 품목 수를 적는다 */}
      <PageHeader
        icon={Link2}
        title="품목별 시험항목 관리"
        count={products.length}
        countSuffix="개"
        actions={hasSelection ? (
          <Button onClick={openAddDialog} size="lg">
            <Plus />
            시험항목 추가
          </Button>
        ) : undefined}
      />

      {error && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm break-keep text-destructive">
          {error}
        </div>
      )}

      {/* 모바일은 세로로 쌓고(1단) 페이지가 스크롤, md 부터 판을 나눠 각자 스크롤,
          lg 부터 좌우 2단. 사이드바 폭 320px 은 lg(1024px) 이상에서만 쓴다. */}
      <div className="grid min-h-0 shrink-0 grid-cols-1 gap-4 md:flex-1 md:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-1">
        {/* 품목 사이드바 */}
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0 max-h-[40vh] lg:max-h-none">
          <div className="shrink-0 border-b px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-foreground">품목 선택</p>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="품목명 / 코드 검색..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
            {/* 320px 폭에서는 세그먼트 3칸의 기본 좌우 여백(px-3)만으로 사이드바를 넘어
                '비활성' 칸이 잘렸다. 글자를 줄이는 대신 칸 여백을 좁히고 폭을 3등분한다. */}
            <StatusFilterTabs
              value={productStatusFilter}
              onChange={setProductStatusFilter}
              counts={productStatusCounts}
              activeLabel="활성"
              inactiveLabel="비활성"
              className="mt-2 flex w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1.5 [&>button]:whitespace-nowrap sm:[&>button]:px-3"
            />
          </div>

          <div ref={productListRef} className="min-h-0 flex-1 overflow-y-auto">
            {filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <p className="text-sm text-muted-foreground">
                  검색 결과가 없습니다.
                </p>
              </div>
            ) : (
              <ul>
                {productPadTop > 0 && <li aria-hidden style={{ height: productPadTop }} />}
                {windowedProducts.map((product, i) => {
                  const isSelected = selectedProduct?.id === product.id
                  return (
                    /* 첫 행에 itemRef 를 달면 훅이 실제 높이를 재서 창을 계산한다 —
                       클래스(h-16)와 상수가 어긋날 일이 없어진다. */
                    <li key={product.id} ref={i === 0 ? productItemRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(product)}
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                          "h-16 w-full overflow-hidden border-b border-l-2 px-4 py-3 text-left transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
                          isSelected
                            ? "border-l-primary bg-primary/5"
                            : "border-l-transparent hover:bg-muted/50"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "shrink-0 font-mono text-xs leading-normal font-medium",
                              isSelected ? "text-primary" : "text-muted-foreground"
                            )}
                          >
                            {product.productCode}
                          </span>
                          {product.isActive ? (
                            <Tag color="blue" className="text-xs leading-normal">활성</Tag>
                          ) : (
                            <Tag color="mono" className="text-xs leading-normal">비활성</Tag>
                          )}
                        </div>
                        <p className="mt-0.5 min-w-0 truncate text-sm leading-snug font-medium text-foreground">
                          {product.name}
                        </p>
                      </button>
                    </li>
                  )
                })}
                {productPadBottom > 0 && <li aria-hidden style={{ height: productPadBottom }} />}
              </ul>
            )}
          </div>

          {/* 머리말이 이미 전체 품목 수를 말하므로 여기는 '지금 몇 개가 걸러져 보이는가'를 적는다.
              다른 마스터 화면 필터 줄과 같은 표기(N / M)로 맞췄다. */}
          <div className="shrink-0 border-t bg-muted/30 px-4 py-2.5">
            <p className="text-xs tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{filteredProducts.length}</span>
              {" / "}
              {products.length}개 표시
            </p>
          </div>
        </Card>

        {/* 시험항목 패널 */}
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0">
          {!selectedProduct ? (
            /* 빈 상태 — 아이콘을 원형 칩에 담지 않는다(원형은 아바타·점·원형 버튼만).
               문구도 화면 사용법 설명을 늘어놓는 대신 한 줄로 줄였다. */
            <div className="flex min-h-40 flex-1 items-center justify-center p-6 text-center">
              <div className="max-w-xs">
                <PackagePlus className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium text-foreground">품목을 선택하세요</p>
                <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
                  왼쪽 목록에서 품목을 고르면 연결된 시험항목이 여기에 나옵니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs leading-normal font-medium text-muted-foreground">
                      {selectedProduct.productCode}
                    </p>
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {selectedProduct.name}
                    </h2>
                    {/* 배지로 되풀이하던 연결·필수·선택 건수를 한 줄 사실로 내렸다.
                        같은 '필수'를 헤더는 초록, 표는 빨강 점으로 칠하던 어긋남도 함께 사라진다. */}
                    <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
                      {selectedProduct.packageSpec ?? "포장규격 미지정"}
                      {selectedProduct.unit ? ` · ${selectedProduct.unit}` : ""}
                      <span className="px-1 text-border">·</span>
                      연결 <span className="font-semibold tabular-nums text-foreground">{summary.linked}</span>건
                      <span className="px-1 text-border">·</span>
                      필수 <span className="tabular-nums">{summary.mandatory}</span>
                      <span className="px-1 text-border">·</span>
                      선택 <span className="tabular-nums">{summary.optional}</span>
                    </p>
                  </div>
                  {/* '시험항목 추가'는 페이지 머리(다른 마스터 화면과 같은 자리)에만 둔다.
                      같은 동작을 여기에 한 번 더 두면 좁은 폭에서 툴바만 두 줄로 늘어난다. */}
                  <div className="flex flex-wrap items-center gap-2">
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
                      onClick={openGroupDialog}
                      size="sm"
                      variant="outline"
                    >
                      <Layers />
                      그룹 넣기
                    </Button>
                    <Button
                      onClick={openCopyDialog}
                      size="sm"
                      variant="outline"
                    >
                      <Copy />
                      다른 품목에서 복사
                    </Button>
                  </div>
                </div>
              </div>

              {/* 모바일 — 칸마다 카드를 두르면 패널 Card 안에 카드가 또 생긴다.
                  실선 하나로 나누고, 항목명을 주 값으로 세운다.
                  md 미만에서는 페이지가 스크롤하므로 여기에 flex-1/자체 스크롤을 걸지 않는다
                  (높이 auto 인 flex 열에서 flex-1 은 0 으로 접힌다). */}
              <div className="shrink-0 md:hidden">
                {linkedLoading ? (
                  <div className="divide-y">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex flex-col gap-2 px-4 py-3">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    ))}
                  </div>
                ) : sortedLinkedItems.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm break-keep text-muted-foreground">
                    연결된 시험항목이 없습니다.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {sortedLinkedItems.map((item, idx) => (
                      <li
                        key={item.testItemId}
                        className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                        onClick={() => setLinkedDetailTarget(item)}
                      >
                        {/* 체크박스 자체는 14px 이라 손가락으로 못 누른다 —
                            라벨로 감싸 여백까지 탭 영역으로 넓힌다(약 32px). */}
                        <label
                          className="-m-2 flex shrink-0 cursor-pointer p-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="cb-custom mt-0.5"
                            checked={selectedLinked.has(item.testItemId)}
                            onChange={() => toggleSelectLinked(item.testItemId)}
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {item.testItemName}
                          </p>
                          <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
                            <span className="tabular-nums">{idx + 1}</span>번
                            <span className="px-1 text-border">·</span>
                            {item.isMandatory ? "필수" : "선택"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 데스크톱 표 — 바깥 패널 Card 가 이미 테두리를 가지므로 표를 한 겹 더 감싸지 않는다 */}
              <div className="hidden min-h-0 flex-1 flex-col md:flex">
                  <Table>
                    <colgroup>
                      <col className="w-[8%]" />
                      <col className="w-[10%]" />
                      <col />
                      <col className="w-[16%]" />
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedLoading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <TableRow key={i} className="hover:bg-transparent">
                            <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-4 rounded-md" /></TableCell>
                            <TableCell className="px-3 py-2.5"><Skeleton className="mx-auto h-4 w-5" /></TableCell>
                            <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-48" /></TableCell>
                            <TableCell className="px-3 py-2.5"><Skeleton className="mx-auto h-5 w-12 rounded-md" /></TableCell>
                          </TableRow>
                        ))
                      ) : sortedLinkedItems.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={4}
                            className="py-16 text-center text-sm break-keep text-muted-foreground"
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
                                className={cn("cursor-pointer hover:bg-muted/40", isSelected && "bg-primary/5")}
                                onClick={() => setLinkedDetailTarget(item)}
                              >
                                <TableCell className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    className="cb-custom"
                                    checked={isSelected}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={() => toggleSelectLinked(item.testItemId)}
                                  />
                                </TableCell>
                                <TableCell className="px-3 py-2.5 text-center text-xs tabular-nums text-muted-foreground">
                                  {idx + 1}
                                </TableCell>
                                <TableCell className="px-3 py-2.5 font-medium text-foreground">
                                  <span className="block truncate" title={item.testItemName}>
                                    {item.testItemName}
                                  </span>
                                </TableCell>
                                {/* 배지는 눈에 띄어야 할 '필수'에만 쓴다 — 기본값인 '선택'까지 배지로 두르면
                                    둘 다 안 읽힌다. 임의로 고른 빨강·초록 점도 함께 걷어냈다. */}
                                <TableCell className="px-3 py-2.5 text-center">
                                  {item.isMandatory ? (
                                    <Badge variant="outline">필수</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">선택</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })
                      )}
                    </TableBody>
                  </Table>
              </div>
            </div>
          )}
        </Card>
      </div>

      {linkedDetailTarget && (
        <ManagementDrawer
          open
          onOpenChange={(open) => { if (!open) setLinkedDetailTarget(null) }}
          size="sm"
          title="시험항목 연결 상세"
          description="현재 품목과 연결된 시험항목을 확인하고 연결을 해제합니다."
          footer={(
            <>
              <Button
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => {
                  setUnlinkTarget(linkedDetailTarget)
                  setLinkedDetailTarget(null)
                }}
              >
                <Trash2 /> 연결 해제
              </Button>
              <Button variant="outline" onClick={() => setLinkedDetailTarget(null)}>닫기</Button>
            </>
          )}
        >
          {/* 값마다 칸을 두르지 않고 실선으로만 나눈다 */}
          <dl className="divide-y rounded-md border px-4 text-sm">
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-xs text-muted-foreground">시험항목</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{linkedDetailTarget.testItemName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-xs text-muted-foreground">순서</dt>
              <dd className="font-medium tabular-nums text-foreground">{linkedDetailTarget.sequenceOrder}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-xs text-muted-foreground">필수 여부</dt>
              <dd>
                {linkedDetailTarget.isMandatory ? (
                  <Badge variant="outline">필수</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">선택</span>
                )}
              </dd>
            </div>
          </dl>
        </ManagementDrawer>
      )}

      {/* 시험항목 추가 다이얼로그 */}
      <ManagementDrawer
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        size="lg"
        title="시험항목 추가"
        description="활성 시험항목 중 현재 품목에 연결할 항목을 선택합니다."
        footer={(
          <>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={addLoading}>취소</Button>
            <Button onClick={() => void handleAddItems()} disabled={addLoading || selectedToAdd.size === 0}>
              <Plus />
              {addLoading ? "추가 중..." : `추가 (${selectedToAdd.size})`}
            </Button>
          </>
        )}
      >
          <div className="grid gap-4">
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

              {/* 칩 안에 칩을 또 넣지 않는다 — 건수는 배경 없는 숫자로 붙인다 */}
              <div className="flex flex-wrap gap-1">
                {dialogTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    aria-pressed={dialogTab === tab}
                    onClick={() => setDialogTab(tab as typeof dialogTab)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      dialogTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "border bg-background text-foreground hover:bg-muted/50"
                    )}
                  >
                    {tab}
                    <span
                      className={cn(
                        "ml-1.5 tabular-nums",
                        dialogTab === tab ? "text-primary-foreground/70" : "text-muted-foreground",
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
                    <span className="tabular-nums">{dialogFiltered.length}</span>개 항목
                    {selectedToAdd.size > 0 && (
                      <span className="ml-1 font-medium text-primary">
                        (<span className="tabular-nums">{selectedToAdd.size}</span>개 선택)
                      </span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAll}
                      className="rounded-md font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      전체선택
                    </button>
                    <button
                      type="button"
                      onClick={deselectAll}
                      className="rounded-md font-medium text-muted-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
                          <Skeleton className="h-4 w-4 rounded-md" />
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
                          {/* 좁은 화면에서는 이름·분류·시간을 한 줄에 세우면 이름이 서너 글자로 잘린다.
                              분류와 예상시간은 이름 아래로 내려 접히게 둔다. */}
                          <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={selectedToAdd.has(item.id)}
                              onChange={() => toggleSelectAdd(item.id)}
                              className="cb-custom mt-1 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {item.name}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                <CategoryBadge category={item.category} />
                                {item.estimatedHours != null && (
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {item.estimatedHours}h
                                  </span>
                                )}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
          </div>
      </ManagementDrawer>

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
            <DialogDescription className="break-keep">
              이 품목에서 시험항목 연결을 제거합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium break-keep">
              {unlinkTarget?.testItemName}
            </p>
            <p className="mt-1.5 text-sm break-keep text-muted-foreground">
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
            <DialogDescription className="break-keep">
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
                              type="button"
                              aria-pressed={copySource?.id === p.id}
                              onClick={() => void selectCopySource(p)}
                              className={cn(
                                "flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
                                copySource?.id === p.id && "bg-primary/5"
                              )}
                            >
                              <span className="shrink-0 font-mono text-xs leading-normal font-medium text-muted-foreground">
                                {p.productCode}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
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
                          (<span className="tabular-nums">{copySelected.size}</span>개 선택)
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setCopySelected(
                            new Set(
                              copySourceItems
                                .filter((r) => !linkedIds.has(r.testItemId))
                                .map((r) => r.testItemId)
                            )
                          )
                        }
                        className="rounded-md font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        미연결 전체
                      </button>
                      <button
                        type="button"
                        onClick={() => setCopySelected(new Set())}
                        className="rounded-md font-medium text-muted-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                                      {r.testItemName}
                                    </span>
                                    {already && (
                                      <span className="shrink-0 text-xs leading-normal text-muted-foreground">
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

      {/* 그룹 넣기 — 시험항목 그룹을 품목에 통째로 추가 */}
      <Dialog
        open={groupDialogOpen}
        onOpenChange={(open) => {
          if (!open && !groupApplyLoading) setGroupDialogOpen(false)
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>그룹 넣기</DialogTitle>
            <DialogDescription className="break-keep">
              시험항목 그룹을{" "}
              <span className="font-medium text-foreground">
                {selectedProduct?.name}
              </span>
              에 통째로 넣습니다. 이미 연결된 항목은 건너뛰고, 없는 항목만 그룹
              순서대로 맨 뒤에 추가합니다.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                1. 그룹 선택
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="그룹명 / 설명 검색..."
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Card className="mt-3 gap-0 overflow-hidden py-0">
                <div className="max-h-48 overflow-y-auto">
                  {groupsLoading ? (
                    <div className="flex flex-col gap-2 p-4">
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-2/3" />
                    </div>
                  ) : filteredGroups.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {groups.length === 0
                        ? "등록된 그룹이 없습니다."
                        : "검색 결과가 없습니다."}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {filteredGroups.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            aria-pressed={selectedGroup?.id === g.id}
                            onClick={() => void selectGroup(g)}
                            className={cn(
                              "flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none",
                              selectedGroup?.id === g.id && "bg-primary/5"
                            )}
                          >
                            {/* 좁은 화면에서 그룹명이 잘리지 않게 항목 수·선택 표시는 아래 줄로 내린다 */}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {g.name}
                              </span>
                              {g.description && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {g.description}
                                </span>
                              )}
                              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="tabular-nums">{g.itemCount}개 항목</Badge>
                                {selectedGroup?.id === g.id && (
                                  <span className="text-xs font-medium text-primary">선택됨</span>
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </div>

            {selectedGroup && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    2. 넣을 항목 미리보기
                  </p>
                  {/* 세 배지가 나란히 서면 무엇이 결과인지 안 보인다 —
                      실제로 추가될 수만 강조하고 나머지는 부가정보로 내린다. */}
                  <p className="text-xs leading-normal break-keep text-muted-foreground">
                    추가 <span className="font-semibold tabular-nums text-foreground">{groupPreview.toAdd}</span>건
                    <span className="px-1 text-border">·</span>
                    이미 있음 <span className="tabular-nums">{groupPreview.already}</span>
                    <span className="px-1 text-border">·</span>
                    전체 <span className="tabular-nums">{groupPreview.total}</span>
                  </p>
                </div>
                <Card className="gap-0 overflow-hidden py-0">
                  <div className="max-h-56 overflow-y-auto">
                    {groupItemsLoading ? (
                      <div className="flex flex-col gap-2 p-4">
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-full" />
                        <Skeleton className="h-6 w-2/3" />
                      </div>
                    ) : groupItems.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        이 그룹에는 시험항목이 없습니다.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {groupItems.map((item, idx) => {
                          const already = linkedIds.has(item.testItemId)
                          return (
                            /* 순번·이름·분류·상태 넷을 한 줄에 세우면 320px 에서 이름이 서너 글자만 남는다.
                               분류와 '추가 예정/이미 있음'은 이름 아래로 내린다. */
                            <li
                              key={item.testItemId}
                              className={cn(
                                "flex items-start gap-3 px-4 py-2.5",
                                already && "opacity-50"
                              )}
                            >
                              <span className="w-5 shrink-0 pt-0.5 text-right text-xs leading-normal text-muted-foreground tabular-nums">
                                {idx + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {item.testItemName}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <CategoryBadge category={item.category} />
                                  {already ? (
                                    <span className="text-xs leading-normal text-muted-foreground">
                                      이미 있음
                                    </span>
                                  ) : (
                                    <span className="text-xs leading-normal font-medium text-primary">
                                      추가 예정
                                    </span>
                                  )}
                                </div>
                              </div>
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
              onClick={() => setGroupDialogOpen(false)}
              disabled={groupApplyLoading}
            >
              취소
            </Button>
            <Button
              onClick={() => void handleApplyGroup()}
              // 미리보기가 0건이어도 누를 수 있게 둔다 — 서버가 최종 판단하고
              // "추가할 항목이 없습니다" 를 토스트로 알린다.
              disabled={groupApplyLoading || !selectedGroup || groupItemsLoading}
            >
              <Layers />
              {groupApplyLoading
                ? "넣는 중..."
                : `그룹 넣기 (${groupPreview.toAdd})`}
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
            <DialogDescription className="break-keep">
              선택한 시험항목 연결을 한 번에 제거합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium">
              <span className="tabular-nums">{selectedLinked.size}</span>개 시험항목
            </p>
            <p className="mt-1.5 text-sm break-keep text-muted-foreground">
              {selectedProduct?.name}에서 선택한 <span className="tabular-nums">{selectedLinked.size}</span>개
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
