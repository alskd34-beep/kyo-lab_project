'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Search } from 'lucide-react'

interface ProductRow {
  product_name: string
}

const DEMO_PRODUCTS: ProductRow[] = [
  { product_name: '(미얀마 수출용)타목시펜정20mg' },
  { product_name: '(베트남수출용)광동우황청심원(영묘향)' },
  { product_name: '(사향)광동우황청심원(신)' },
  { product_name: '(사향)광동우황청심원현탁액(신)' },
  { product_name: '슬라임캡슐' },
  { product_name: '베니톨정' },
  { product_name: '알도셉트정5mg' },
  { product_name: '개풍경옥고' },
]

const DEMO_TEST_ITEMS: Record<string, string[]> = {
  '(미얀마 수출용)타목시펜정20mg':       ['성상,포장확인', '용출', '확인(정성)', '에탄올', '함량', '확인,함량균일성'],
  '(베트남수출용)광동우황청심원(영묘향)': ['성상,포장확인', 'GCMS함량', 'GCMS확인', '이화학'],
  '(사향)광동우황청심원(신)':            ['성상,포장확인', 'GCMS함량', 'GCMS확인', '확인(정성)', '함량', 'pH', '이화학'],
  '(사향)광동우황청심원현탁액(신)':      ['성상,포장확인', 'GCMS함량', 'GCMS확인', '이화학'],
  '슬라임캡슐':                          ['성상,포장확인', '용출', '붕해', '함량', '이화학'],
  '베니톨정':                            ['성상,포장확인', 'HPLC함량', 'HPLC확인', '용출', '이화학'],
  '알도셉트정5mg':                       ['성상,포장확인', 'HPLC함량', '용출', '붕해', '이화학'],
  '개풍경옥고':                          ['성상,포장확인', '함량', 'pH', '이화학', '미생물'],
}

const ITEM_BADGE_COLORS = [
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-violet-50 text-violet-700 border-violet-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-rose-50 text-rose-700 border-rose-200',
]

function getItemColor(index: number): string {
  return ITEM_BADGE_COLORS[index % ITEM_BADGE_COLORS.length]
}

export default function TestItemsPage() {
  const [products, setProducts]               = useState<ProductRow[]>(DEMO_PRODUCTS)
  const [testItems, setTestItems]             = useState<Record<string, string[]>>(DEMO_TEST_ITEMS)
  const [selectedProduct, setSelectedProduct] = useState<string>(DEMO_PRODUCTS[0].product_name)
  const [searchValue, setSearchValue]         = useState('')
  const [usingDemo, setUsingDemo]             = useState(true)

  useEffect(() => {
    fetch('/api/products?limit=200')
      .then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: ProductRow[] }>
      })
      .then(({ rows }) => {
        if (rows.length > 0) {
          setProducts(rows)
          setSelectedProduct(rows[0].product_name)
          setUsingDemo(false)
        } else {
          setUsingDemo(true)
        }
      })
      .catch(() => {
        setUsingDemo(true)
      })
  }, [])

  useEffect(() => {
    if (usingDemo) return
    if (!selectedProduct) return
    fetch(`/api/products?productName=${encodeURIComponent(selectedProduct)}`)
      .then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ items: string[] }>
      })
      .then(({ items }) => {
        setTestItems(prev => ({ ...prev, [selectedProduct]: items }))
      })
      .catch(() => {})
  }, [selectedProduct, usingDemo])

  const filteredProducts = useMemo(() => {
    if (!searchValue.trim()) return products
    return products.filter(p => p.product_name.includes(searchValue.trim()))
  }, [products, searchValue])

  const currentItems = testItems[selectedProduct] ?? []

  return (
    <div className="flex flex-1 flex-col p-5">
      <div className="flex flex-1 gap-4 min-h-0">

        {/* Left panel — product list */}
        <Card className="flex w-[280px] shrink-0 flex-col border border-slate-200 shadow-none rounded-xl bg-white py-0 overflow-hidden">
          {/* Panel header */}
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-slate-700">품목 목록</span>
              {usingDemo && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                  데모 모드
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <Search size={13} className="text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="품목명 검색..."
                value={searchValue}
                onChange={e => setSearchValue(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Product list */}
          <div className="flex-1 overflow-y-auto">
            {filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-slate-400">검색 결과 없음</p>
              </div>
            ) : (
              <ul>
                {filteredProducts.map(product => {
                  const isSelected = selectedProduct === product.product_name
                  return (
                    <li key={product.product_name}>
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(product.product_name)}
                        className={`w-full px-4 py-2.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-blue-50 border-l-2 border-blue-600 text-blue-700 font-medium'
                            : 'border-l-2 border-transparent text-slate-700 hover:bg-slate-50/70'
                        }`}
                      >
                        {product.product_name}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-4 py-2 bg-slate-50/50">
            <p className="text-[11px] text-slate-400">
              총 <span className="font-semibold text-slate-600">{filteredProducts.length}</span>개 품목
            </p>
          </div>
        </Card>

        {/* Right panel — test items */}
        <Card className="flex flex-1 flex-col border border-slate-200 shadow-none rounded-xl bg-white py-0 overflow-hidden">
          {/* Panel header */}
          <div className="border-b border-slate-100 px-5 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">선택된 품목</p>
                <h2 className="text-sm font-semibold text-slate-800">{selectedProduct}</h2>
              </div>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
                {currentItems.length}개 항목
              </span>
            </div>
          </div>

          {/* Test item chips */}
          <CardContent className="flex-1 overflow-y-auto p-5">
            {currentItems.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-slate-400">시험항목이 없습니다.</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {currentItems.map((item, idx) => (
                  <div
                    key={`${item}-${idx}`}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-all hover:shadow-sm ${getItemColor(idx)}`}
                  >
                    <span className="text-sm font-medium">{item}</span>
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold border bg-white/60 border-current text-current">
                      {idx % 2 === 0 ? 'Solo' : 'Duo'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>

          {/* Footer */}
          <div className="border-t border-slate-100 px-5 py-2.5 bg-slate-50/50">
            <p className="text-[11px] text-slate-400">
              <span className="font-semibold text-slate-600">{selectedProduct}</span>의 시험항목 목록
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
