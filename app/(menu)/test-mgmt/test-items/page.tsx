'use client'

import { useState, useEffect, useMemo } from 'react'
import { Trash2, Plus, Search } from 'lucide-react'
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

interface TestItemRow {
  id: string
  name: string
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
  const [products, setProducts]               = useState<ProductRow[]>([])
  const [allTestItems, setAllTestItems]       = useState<TestItemRow[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null)
  const [linkedItems, setLinkedItems]         = useState<ProductTestItemRow[]>([])
  const [productSearch, setProductSearch]     = useState('')
  const [addDialogOpen, setAddDialogOpen]     = useState(false)
  const [selectedToAdd, setSelectedToAdd]     = useState<Set<string>>(new Set())
  const [addLoading, setAddLoading]           = useState(false)
  const [error, setError]                     = useState<string | null>(null)

  // ── Load products & test items ───────────────────────────────────────────────
  useEffect(() => {
    loadProducts()
    loadAllTestItems()
  }, [])

  async function loadProducts() {
    try {
      const res = await fetch('/api/products')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: ProductRow[] }
      setProducts(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  async function loadAllTestItems() {
    try {
      const res = await fetch('/api/test-items')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: TestItemRow[] }
      setAllTestItems(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  // ── Load linked items for selected product ───────────────────────────────────
  useEffect(() => {
    if (!selectedProduct) { setLinkedItems([]); return }
    loadLinkedItems(selectedProduct.id)
  }, [selectedProduct])

  async function loadLinkedItems(productId: string) {
    try {
      const res = await fetch(`/api/product-test-items?productId=${productId}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { rows: ProductTestItemRow[] }
      setLinkedItems(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  // ── Filtered product list ────────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q),
    )
  }, [products, productSearch])

  // ── Test items not yet linked ────────────────────────────────────────────────
  const linkedIds = useMemo(
    () => new Set(linkedItems.map(li => li.testItemId)),
    [linkedItems],
  )
  const availableToAdd = useMemo(
    () => allTestItems.filter(ti => !linkedIds.has(ti.id) && ti.isActive),
    [allTestItems, linkedIds],
  )

  // ── Delete linked item ───────────────────────────────────────────────────────
  async function handleDeleteLinked(testItemId: string) {
    if (!selectedProduct) return
    setLinkedItems(prev => prev.filter(li => li.testItemId !== testItemId))
    try {
      const res = await fetch('/api/product-test-items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: selectedProduct.id, testItemId }),
      })
      if (!res.ok) throw new Error(await res.text())
    } catch {
      await loadLinkedItems(selectedProduct.id)
    }
  }

  // ── Add linked items ─────────────────────────────────────────────────────────
  async function handleAddItems() {
    if (!selectedProduct || selectedToAdd.size === 0) return
    setAddLoading(true)
    try {
      const nextOrder = linkedItems.length
      const promises = Array.from(selectedToAdd).map((testItemId, idx) =>
        fetch('/api/product-test-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: selectedProduct.id,
            testItemId,
            sequenceOrder: nextOrder + idx,
          }),
        }),
      )
      await Promise.all(promises)
      await loadLinkedItems(selectedProduct.id)
      setSelectedToAdd(new Set())
      setAddDialogOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setAddLoading(false)
    }
  }

  function toggleSelectAdd(id: string) {
    setSelectedToAdd(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 h-full">
      {/* ── Left panel: product selector ──────────────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        {/* Header */}
        <div className="border-b border-slate-100 px-4 py-3 shrink-0">
          <p className="text-sm font-semibold text-slate-700 mb-2.5">품목 선택</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <Search size={13} className="text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="품목명 / 코드 검색..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {filteredProducts.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-xs text-slate-400">검색 결과 없음</p>
            </div>
          ) : (
            <ul>
              {filteredProducts.map(product => {
                const isSelected = selectedProduct?.id === product.id
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedProduct(product)}
                      className={`w-full px-4 py-2.5 text-left transition-colors border-l-2 ${
                        isSelected
                          ? 'bg-blue-50 border-blue-600'
                          : 'border-transparent hover:bg-slate-50/70'
                      }`}
                    >
                      <p className={`text-[10px] font-mono mb-0.5 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`}>
                        {product.productCode}
                      </p>
                      <p className={`text-xs font-medium leading-snug ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                        {product.name}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-4 py-2 bg-slate-50/50 shrink-0">
          <p className="text-[11px] text-slate-400">
            총 <span className="font-semibold text-slate-600">{filteredProducts.length}</span>개 품목
          </p>
        </div>
      </div>

      {/* ── Right panel: linked test items ────────────────────────────────────── */}
      <div className="flex flex-1 flex-col bg-slate-50 p-5 gap-4 overflow-auto">
        {!selectedProduct ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-slate-400">
              <p className="text-sm">좌측에서 품목을 선택하세요</p>
            </div>
          </div>
        ) : (
          <>
            {/* Panel header */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500 font-mono mb-0.5">{selectedProduct.productCode}</p>
                <h2 className="text-base font-semibold text-slate-800 truncate">{selectedProduct.name}</h2>
              </div>
              <Badge variant="secondary" className="text-xs shrink-0">
                {linkedItems.length}건
              </Badge>
              <Button
                onClick={() => { setSelectedToAdd(new Set()); setAddDialogOpen(true) }}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white h-9 shrink-0"
              >
                <Plus size={15} className="mr-1" />
                시험항목 추가
              </Button>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Linked items table */}
            <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-100 text-xs">
                    <th className="px-4 py-3 text-center font-semibold w-16">순서</th>
                    <th className="px-4 py-3 text-left font-semibold">시험항목명</th>
                    <th className="px-4 py-3 text-center font-semibold w-24">필수여부</th>
                    <th className="px-4 py-3 text-center font-semibold w-20">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-400 text-sm">
                        연결된 시험항목이 없습니다. 우측 상단에서 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    linkedItems
                      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                      .map((li, idx) => (
                        <tr
                          key={li.testItemId}
                          className={`border-t border-slate-100 transition-colors hover:bg-slate-100/60 ${
                            idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                          }`}
                        >
                          <td className="px-4 py-2.5 text-center text-slate-500">{li.sequenceOrder + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{li.testItemName}</td>
                          <td className="px-4 py-2.5 text-center">
                            {li.isMandatory ? (
                              <Badge className="bg-red-50 text-red-600 border-red-200 hover:bg-red-50 text-[11px]">
                                필수
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100 text-[11px]">
                                선택
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => handleDeleteLinked(li.testItemId)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
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
          </>
        )}
      </div>

      {/* ── Add test items dialog ──────────────────────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>시험항목 추가</DialogTitle>
          </DialogHeader>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            {availableToAdd.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">추가할 수 있는 시험항목이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {availableToAdd.map(ti => (
                  <li key={ti.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedToAdd.has(ti.id)}
                        onChange={() => toggleSelectAdd(ti.id)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span className="flex-1 text-sm text-slate-700">{ti.name}</span>
                      {ti.estimatedHours != null && (
                        <span className="text-xs text-slate-400">{ti.estimatedHours}h</span>
                      )}
                      {ti.requiresDuo && (
                        <Badge className="bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-50 text-[10px]">
                          2인
                        </Badge>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-xs text-slate-500 mt-1">
            {selectedToAdd.size > 0 ? `${selectedToAdd.size}개 선택됨` : '시험항목을 선택하세요'}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} disabled={addLoading}>
              취소
            </Button>
            <Button
              onClick={handleAddItems}
              disabled={addLoading || selectedToAdd.size === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {addLoading ? '추가 중...' : `추가 (${selectedToAdd.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
