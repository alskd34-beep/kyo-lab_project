'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { addDays, format, parse, isValid } from 'date-fns'
import { Button } from '@frontend/components/ui/button'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@frontend/components/ui/dialog'
import { Search, ChevronDown, X } from 'lucide-react'
import type { ProductRow } from '@backend/services/products'
import type { ProductTestItemRow } from '@backend/services/productTestItems'

type DosageForm = '현탁제' | '내용고형제' | '전제' | '환제' | '액제' | '주사제'
type ValidationType = '일반' | 'PV' | 'CV'

interface TestItemRow {
  name: string
  checked: boolean
  assignee: string
}

const DEMO_TESTERS = ['김태훈', '박성호', '권택균', '장재훈', '지건희']
const DOSAGE_FORMS: DosageForm[] = ['현탁제', '내용고형제', '전제', '환제', '액제', '주사제']
const VALIDATION_TYPES: ValidationType[] = ['일반', 'PV', 'CV']

function autoDate(packagingDate: string): string {
  if (!packagingDate) return ''
  const d = parse(packagingDate, 'yyyy-MM-dd', new Date())
  return isValid(d) ? format(addDays(d, 14), 'yyyy-MM-dd') : ''
}

// ─── 품목 검색 팝업 ────────────────────────────────────────────────────────────
function ProductPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (p: ProductRow) => void
}) {
  const [keyword, setKeyword]   = useState('')
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setKeyword('')
      setProducts([])
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  useEffect(() => {
    const trimmed = keyword.trim()
    if (!trimmed) { setProducts([]); return }
    const tid = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(trimmed)}&limit=100`)
        const data = await res.json() as { rows: ProductRow[] }
        setProducts(data.rows ?? [])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(tid)
  }, [keyword])

  // 팝업 처음 열릴 때 전체 목록 로드
  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/products?limit=200')
      .then(r => r.json())
      .then((d: { rows: ProductRow[] }) => setProducts(d.rows ?? []))
      .finally(() => setLoading(false))
  }, [open])

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-slate-100">
          <DialogTitle className="text-sm font-semibold text-slate-800">품목 검색</DialogTitle>
        </DialogHeader>

        {/* 검색 인풋 */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="품목명 또는 품목코드 입력..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            className="flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          {keyword && (
            <button onClick={() => setKeyword('')} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* 목록 */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400">로딩중...</div>
          ) : products.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">검색 결과가 없습니다.</div>
          ) : (
            products.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect(p); onClose() }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0"
              >
                <span className="w-16 shrink-0 font-mono text-[11px] text-slate-400">{p.productCode}</span>
                <span className="flex-1 text-sm text-slate-800">{p.name}</span>
                {p.unit && <span className="shrink-0 text-[11px] text-slate-400">{p.unit}</span>}
              </button>
            ))
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-2 text-right">
          <span className="text-[11px] text-slate-400">총 {products.length}건</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 자동완성 드롭다운 ────────────────────────────────────────────────────────
function Autocomplete({
  value,
  onChange,
  onSelect,
  onSearch,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (p: ProductRow) => void
  onSearch: () => void
}) {
  const [suggestions, setSuggestions] = useState<ProductRow[]>([])
  const [open, setOpen]               = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 3글자 이상 입력 시 자동완성
  useEffect(() => {
    const trimmed = value.trim()
    if (trimmed.length < 3) { setSuggestions([]); setOpen(false); return }
    const tid = setTimeout(async () => {
      const res  = await fetch(`/api/products?search=${encodeURIComponent(trimmed)}&limit=10`)
      const data = await res.json() as { rows: ProductRow[] }
      const rows = data.rows ?? []
      setSuggestions(rows)
      setOpen(rows.length > 0)
    }, 250)
    return () => clearTimeout(tid)
  }, [value])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} className="relative flex-1">
      <div className="flex items-center rounded-lg border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all overflow-hidden">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setOpen(false); onSearch() } }}
          placeholder="품목코드 또는 품목명 3자 이상 입력"
          className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setSuggestions([]); setOpen(false) }}
            className="px-2 text-slate-400 hover:text-slate-600"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 자동완성 드롭다운 */}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          {suggestions.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onSelect(p); setOpen(false) }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0"
            >
              <span className="w-14 shrink-0 font-mono text-[11px] text-slate-400">{p.productCode}</span>
              <span className="flex-1 text-sm text-slate-800 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function TestRegPage() {
  const router = useRouter()

  const [searchText, setSearchText]     = useState('')
  const [productId, setProductId]       = useState('')
  const [productCode, setProductCode]   = useState('')
  const [productName, setProductName]   = useState('')
  const [spec, setSpec]                 = useState('')
  const [batchNo, setBatchNo]           = useState('')
  const [dosageForm, setDosageForm]     = useState<DosageForm | ''>('')
  const [packagingDate, setPackagingDate]   = useState('')
  const [reviewDeadline, setReviewDeadline] = useState('')
  const [qcPlannedDate, setQcPlannedDate]   = useState('')
  const [validationType, setValidationType] = useState<ValidationType>('일반')
  const [testItems, setTestItems]           = useState<TestItemRow[]>([])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [isSaving, setIsSaving]       = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [productFound, setProductFound] = useState(false)

  useEffect(() => {
    const auto = autoDate(packagingDate)
    setReviewDeadline(auto)
    setQcPlannedDate(auto)
  }, [packagingDate])

  const loadTestItems = useCallback(async (pid: string) => {
    if (!pid) return
    setIsLookingUp(true)
    setLookupError('')
    setTestItems([])
    try {
      const res  = await fetch(`/api/product-test-items?productId=${encodeURIComponent(pid)}`)
      const data = await res.json() as { rows: ProductTestItemRow[] }
      const rows = data.rows ?? []
      if (rows.length > 0) {
        setTestItems(rows.map(r => ({ name: r.testItemName, checked: true, assignee: '' })))
        setProductFound(true)
      } else {
        setLookupError('등록된 시험항목이 없습니다. 시험항목관리에서 먼저 등록해주세요.')
        setProductFound(true)
      }
    } catch {
      setLookupError('시험항목 조회 중 오류가 발생했습니다.')
    } finally {
      setIsLookingUp(false)
    }
  }, [])

  const selectProduct = useCallback((p: ProductRow) => {
    setSearchText(p.name)
    setProductId(p.id)
    setProductCode(p.productCode)
    setProductName(p.name)
    setLookupError('')
    setProductFound(false)
    loadTestItems(p.id)
  }, [loadTestItems])

  // 코드로 직접 조회 (Enter 또는 조회 버튼)
  const lookupByText = useCallback(async () => {
    const text = searchText.trim()
    if (!text) return
    setIsLookingUp(true)
    setLookupError('')
    setProductFound(false)
    setTestItems([])
    try {
      const res  = await fetch(`/api/products?search=${encodeURIComponent(text)}&limit=1`)
      const data = await res.json() as { rows: ProductRow[] }
      const p    = data.rows?.[0]
      if (!p) throw new Error('not found')
      selectProduct(p)
    } catch {
      setLookupError(`'${text}'에 해당하는 품목을 찾을 수 없습니다.`)
      setIsLookingUp(false)
    }
  }, [searchText, selectProduct])

  const toggleItem = (idx: number) =>
    setTestItems(prev => prev.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it))

  const setItemAssignee = (idx: number, assignee: string) =>
    setTestItems(prev => prev.map((it, i) => i === idx ? { ...it, assignee } : it))

  const handleSave = async () => {
    if (!productCode.trim() || !batchNo.trim()) return
    setIsSaving(true)
    try {
      const payload = {
        productId,
        product_code: productCode,
        product_name: productName,
        spec: spec.trim(),
        batchNo: batchNo.trim(),
        dosageFormId: null,
        packagingPlannedDate: packagingDate || null,
        recordReviewDeadline: reviewDeadline || null,
        qcPlannedCompletionDate: qcPlannedDate || null,
        status: 'pending',
      }
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      router.push('/product-test/prod-status')
    } catch (err) {
      console.error('[test-reg] save error', err)
    } finally {
      setIsSaving(false)
    }
  }

  const isFormValid = productFound && productCode.trim() && batchNo.trim()

  return (
    <div className="flex flex-col gap-5 p-5 max-w-3xl">

      <div>
        <h1 className="text-base font-bold text-slate-800">시험등록</h1>
        <p className="mt-0.5 text-xs text-slate-500">생산배치를 시스템에 등록합니다.</p>
      </div>

      {/* 기본 정보 */}
      <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0">
        <div className="border-b border-slate-100 px-5 py-3">
          <span className="text-sm font-semibold text-slate-800">기본 정보</span>
        </div>
        <CardContent className="px-5 py-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">

            {/* 품목 검색 */}
            <div className="col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                품목 <span className="text-red-500">*</span>
                <span className="ml-1.5 font-normal text-slate-400">— 코드·한글명 3자 이상 입력 또는 🔍로 목록 검색</span>
              </label>
              <div className="flex gap-2">
                <Autocomplete
                  value={searchText}
                  onChange={setSearchText}
                  onSelect={selectProduct}
                  onSearch={lookupByText}
                />
                {/* 목록 팝업 버튼 */}
                <Button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  variant="outline"
                  className="h-9 w-9 shrink-0 p-0 border-slate-200 rounded-lg shadow-none hover:bg-slate-50"
                  title="품목 목록에서 선택"
                >
                  <Search size={15} className="text-slate-500" />
                </Button>
                {/* 직접 조회 버튼 */}
                <Button
                  type="button"
                  onClick={lookupByText}
                  disabled={isLookingUp || !searchText.trim()}
                  className="h-9 shrink-0 gap-1.5 bg-blue-600 px-4 text-xs font-medium hover:bg-blue-700 rounded-lg shadow-none disabled:opacity-50"
                >
                  {isLookingUp ? '조회중...' : '조회'}
                </Button>
              </div>
              {lookupError && <p className="mt-1.5 text-xs text-red-500">{lookupError}</p>}
            </div>

            {/* 품목코드 / 품목명 (읽기 전용) */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">품목코드</label>
              <input readOnly value={productCode} placeholder="자동 입력"
                className="w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 cursor-not-allowed font-mono" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">품목명</label>
              <input readOnly value={productName} placeholder="자동 입력"
                className="w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 cursor-not-allowed" />
            </div>

            {/* 규격 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">규격</label>
              <input type="text" value={spec} onChange={e => setSpec(e.target.value)} placeholder="예: 10mL/병"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
            </div>

            {/* 제조번호 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                제조번호 <span className="text-red-500">*</span>
              </label>
              <input type="text" value={batchNo} onChange={e => setBatchNo(e.target.value)} placeholder="예: 26002"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
            </div>

            {/* 제형 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">제형</label>
              <div className="relative">
                <select value={dosageForm} onChange={e => setDosageForm(e.target.value as DosageForm)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all">
                  <option value="">선택</option>
                  {DOSAGE_FORMS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* 밸리데이션구분 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">밸리데이션구분</label>
              <div className="relative">
                <select value={validationType} onChange={e => setValidationType(e.target.value as ValidationType)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all">
                  {VALIDATION_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* 날짜 필드들 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">포장일(예정)</label>
              <input type="date" value={packagingDate} onChange={e => setPackagingDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                기록서검토기한
                <span className="ml-1 text-[10px] font-normal text-slate-400">(포장일+14일)</span>
              </label>
              <input type="date" value={reviewDeadline} onChange={e => setReviewDeadline(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                QC완료예정일
                <span className="ml-1 text-[10px] font-normal text-slate-400">(편집 가능)</span>
              </label>
              <div className="relative">
                <input type="date" value={qcPlannedDate} onChange={e => setQcPlannedDate(e.target.value)}
                  className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all ${
                    qcPlannedDate ? '' : '[&::-webkit-datetime-edit]:text-transparent'
                  }`} />
                {!qcPlannedDate && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    년-월-일
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 시험항목 */}
      {productFound && testItems.length > 0 && (
        <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">시험항목</span>
              <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                {testItems.filter(it => it.checked).length}/{testItems.length}
              </span>
            </div>
            <button type="button"
              onClick={() => { const all = testItems.every(it => it.checked); setTestItems(p => p.map(it => ({ ...it, checked: !all }))) }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              {testItems.every(it => it.checked) ? '전체 해제' : '전체 선택'}
            </button>
          </div>
          <CardContent className="px-5 py-4">
            <div className="flex flex-col gap-2">
              {testItems.map((item, idx) => (
                <div key={idx}
                  className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                    item.checked ? 'border-blue-100 bg-blue-50/40' : 'border-slate-100 bg-slate-50/40'
                  }`}>
                  <input type="checkbox" checked={item.checked} onChange={() => toggleItem(idx)} className="cb-custom shrink-0" />
                  <span className={`flex-1 text-sm font-medium ${item.checked ? 'text-slate-800' : 'text-slate-400'}`}>
                    {item.name}
                  </span>
                  <div className="relative w-36 shrink-0">
                    <select value={item.assignee} onChange={e => setItemAssignee(idx, e.target.value)} disabled={!item.checked}
                      className="w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 py-1.5 pr-7 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      <option value="">시험자 미배정</option>
                      {DEMO_TESTERS.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 버튼 */}
      <div className="flex items-center justify-end gap-2 pb-2">
        <Button type="button" variant="outline" onClick={() => router.back()}
          className="h-9 px-5 text-sm text-slate-600 border-slate-200 hover:bg-slate-50 rounded-lg shadow-none">
          취소
        </Button>
        <Button type="button" onClick={handleSave} disabled={!isFormValid || isSaving}
          className="h-9 bg-blue-600 px-6 text-sm font-medium hover:bg-blue-700 rounded-lg shadow-none disabled:opacity-50">
          {isSaving ? '저장중...' : '저장'}
        </Button>
      </div>

      {/* 품목 팝업 */}
      <ProductPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={selectProduct}
      />
    </div>
  )
}
