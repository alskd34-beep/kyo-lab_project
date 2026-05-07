'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { addDays, format, parse, isValid } from 'date-fns'
import { Button } from '@frontend/components/ui/button'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Search, ChevronDown } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type DosageForm = '현탁제' | '내용고형제' | '전제' | '환제' | '액제' | '주사제'
type ValidationType = '일반' | 'PV' | 'CV'

interface ProductLookup {
  name: string
  testItems: string[]
}

interface TestItemRow {
  name: string
  checked: boolean
  assignee: string
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_PRODUCT_LOOKUP: Record<string, ProductLookup> = {
  '21081': { name: '(사향)광동우황청심원현탁액(신)', testItems: ['성상,포장확인', 'GCMS함량', 'GCMS확인', '확인(정성)', '함량', 'pH', '이화학'] },
  '23263': { name: '베니톨정', testItems: ['성상,포장확인', 'HPLC함량', 'HPLC확인', '용출', '이화학'] },
  '21391': { name: '알도셉트정5mg', testItems: ['성상,포장확인', 'HPLC함량', '용출', '붕해', '이화학'] },
  '21350': { name: '슬라임캡슐', testItems: ['성상,포장확인', '용출', '붕해', '함량', '이화학'] },
}

const DEMO_TESTERS = ['', '김태훈', '박성호', '권택균', '장재훈', '지건희']

const DOSAGE_FORMS: DosageForm[] = ['현탁제', '내용고형제', '전제', '환제', '액제', '주사제']
const VALIDATION_TYPES: ValidationType[] = ['일반', 'PV', 'CV']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function autoDateFromPackaging(packagingDate: string): string {
  if (!packagingDate) return ''
  const d = parse(packagingDate, 'yyyy-MM-dd', new Date())
  if (!isValid(d)) return ''
  return format(addDays(d, 14), 'yyyy-MM-dd')
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TestRegPage() {
  const router = useRouter()

  // Form state
  const [productCode, setProductCode]           = useState('')
  const [productName, setProductName]           = useState('')
  const [spec, setSpec]                         = useState('')
  const [batchNo, setBatchNo]                   = useState('')
  const [dosageForm, setDosageForm]             = useState<DosageForm | ''>('')
  const [packagingDate, setPackagingDate]       = useState('')
  const [reviewDeadline, setReviewDeadline]     = useState('')
  const [qcPlannedDate, setQcPlannedDate]       = useState('')
  const [validationType, setValidationType]     = useState<ValidationType>('일반')
  const [testItems, setTestItems]               = useState<TestItemRow[]>([])

  // UI state
  const [isLookingUp, setIsLookingUp]           = useState(false)
  const [isSaving, setIsSaving]                 = useState(false)
  const [lookupError, setLookupError]           = useState('')
  const [usingDemo, setUsingDemo]               = useState(false)
  const [productFound, setProductFound]         = useState(false)

  // Auto-calculate dates when packagingDate changes
  useEffect(() => {
    const auto = autoDateFromPackaging(packagingDate)
    setReviewDeadline(auto)
    setQcPlannedDate(auto)
  }, [packagingDate])

  const lookupProduct = useCallback(async () => {
    const code = productCode.trim()
    if (!code) return
    setIsLookingUp(true)
    setLookupError('')
    setProductFound(false)
    setTestItems([])
    setProductName('')

    try {
      const [productRes, itemsRes] = await Promise.all([
        fetch(`/api/products?search=${encodeURIComponent(code)}`),
        fetch(`/api/products/${encodeURIComponent(code)}/test-items`),
      ])

      if (!productRes.ok || !itemsRes.ok) throw new Error('API error')

      const productData = await productRes.json() as { name?: string }
      const itemsData = await itemsRes.json() as { items?: string[] }

      const name = productData.name ?? ''
      const items = itemsData.items ?? []

      if (name) {
        setProductName(name)
        setTestItems(items.map(item => ({ name: item, checked: true, assignee: '' })))
        setProductFound(true)
        setUsingDemo(false)
      } else {
        throw new Error('not found')
      }
    } catch {
      const demo = DEMO_PRODUCT_LOOKUP[code]
      if (demo) {
        setProductName(demo.name)
        setTestItems(demo.testItems.map(item => ({ name: item, checked: true, assignee: '' })))
        setProductFound(true)
        setUsingDemo(true)
      } else {
        setLookupError(`품목코드 '${code}'를 찾을 수 없습니다.`)
        setProductFound(false)
      }
    } finally {
      setIsLookingUp(false)
    }
  }, [productCode])

  const toggleItem = (idx: number) => {
    setTestItems(prev => prev.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it))
  }

  const setItemAssignee = (idx: number, assignee: string) => {
    setTestItems(prev => prev.map((it, i) => i === idx ? { ...it, assignee } : it))
  }

  const handleSave = async () => {
    if (!productCode.trim() || !batchNo.trim()) return
    setIsSaving(true)
    try {
      const payload = {
        product_code: productCode.trim(),
        spec: spec.trim(),
        batch_no: batchNo.trim(),
        dosage_form: dosageForm,
        packaging_planned_date: packagingDate || null,
        record_review_deadline: reviewDeadline || null,
        qc_planned_completion_date: qcPlannedDate || null,
        validation_type: validationType,
        test_items: testItems
          .filter(it => it.checked)
          .map(it => ({ name: it.name, assignee: it.assignee || null })),
      }
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      router.push('/product-test/prod-status')
    } catch {
      // Demo mode: navigate anyway
      if (usingDemo) {
        router.push('/product-test/prod-status')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    router.back()
  }

  const isFormValid = productCode.trim() && batchNo.trim() && productFound

  return (
    <div className="flex flex-col gap-5 p-5 max-w-3xl">

      {/* ── 페이지 헤더 ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-800">시험등록</h1>
          <p className="mt-0.5 text-xs text-slate-500">생산배치를 시스템에 등록합니다.</p>
        </div>
        {usingDemo && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-200">
            데모 모드
          </span>
        )}
      </div>

      {/* ── 기본 정보 ─────────────────────────────────────────────────── */}
      <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0">
        <div className="border-b border-slate-100 px-5 py-3">
          <span className="text-sm font-semibold text-slate-800">기본 정보</span>
        </div>
        <CardContent className="px-5 py-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">

            {/* 품목코드 */}
            <div className="col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                품목코드 <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={productCode}
                  onChange={e => setProductCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && lookupProduct()}
                  placeholder="품목코드 입력 (예: 21081)"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
                <Button
                  type="button"
                  onClick={lookupProduct}
                  disabled={isLookingUp || !productCode.trim()}
                  className="h-9 gap-1.5 bg-blue-600 px-4 text-xs font-medium hover:bg-blue-700 rounded-lg shadow-none disabled:opacity-50"
                >
                  <Search size={13} />
                  {isLookingUp ? '조회중...' : '조회'}
                </Button>
              </div>
              {lookupError && (
                <p className="mt-1.5 text-xs text-red-500">{lookupError}</p>
              )}
            </div>

            {/* 품목명 */}
            <div className="col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">품목명</label>
              <input
                type="text"
                value={productName}
                readOnly
                placeholder="품목코드 조회 후 자동 표시"
                className="w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 cursor-not-allowed"
              />
            </div>

            {/* 규격 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">규격</label>
              <input
                type="text"
                value={spec}
                onChange={e => setSpec(e.target.value)}
                placeholder="예: 10mL/병"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {/* 제조번호 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                제조번호 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={batchNo}
                onChange={e => setBatchNo(e.target.value)}
                placeholder="예: 26002"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {/* 제형 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">제형</label>
              <div className="relative">
                <select
                  value={dosageForm}
                  onChange={e => setDosageForm(e.target.value as DosageForm)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                >
                  <option value="">선택</option>
                  {DOSAGE_FORMS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* 밸리데이션구분 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">밸리데이션구분</label>
              <div className="relative">
                <select
                  value={validationType}
                  onChange={e => setValidationType(e.target.value as ValidationType)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                >
                  {VALIDATION_TYPES.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {/* 포장일_예정일 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">포장일(예정)</label>
              <input
                type="date"
                value={packagingDate}
                onChange={e => setPackagingDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {/* 기록서검토기한 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                기록서검토기한
                <span className="ml-1 text-[10px] font-normal text-slate-400">(포장일+14일)</span>
              </label>
              <input
                type="date"
                value={reviewDeadline}
                onChange={e => setReviewDeadline(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {/* QC완료예정일 */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                QC완료예정일
                <span className="ml-1 text-[10px] font-normal text-slate-400">(포장일+14일, 편집 가능)</span>
              </label>
              <input
                type="date"
                value={qcPlannedDate}
                onChange={e => setQcPlannedDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

          </div>
        </CardContent>
      </Card>

      {/* ── 시험항목 섹션 ────────────────────────────────────────────── */}
      {productFound && testItems.length > 0 && (
        <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">시험항목</span>
              <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                {testItems.filter(it => it.checked).length}/{testItems.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const allChecked = testItems.every(it => it.checked)
                setTestItems(prev => prev.map(it => ({ ...it, checked: !allChecked })))
              }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              {testItems.every(it => it.checked) ? '전체 해제' : '전체 선택'}
            </button>
          </div>
          <CardContent className="px-5 py-4">
            <div className="flex flex-col gap-2">
              {testItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
                    item.checked
                      ? 'border-blue-100 bg-blue-50/40'
                      : 'border-slate-100 bg-slate-50/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleItem(idx)}
                    className="cb-custom shrink-0"
                  />
                  <span className={`flex-1 text-sm font-medium ${item.checked ? 'text-slate-800' : 'text-slate-400'}`}>
                    {item.name}
                  </span>
                  <div className="relative w-36 shrink-0">
                    <select
                      value={item.assignee}
                      onChange={e => setItemAssignee(idx, e.target.value)}
                      disabled={!item.checked}
                      className="w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 py-1.5 pr-7 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <option value="">시험자 미배정</option>
                      {DEMO_TESTERS.slice(1).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 하단 버튼 ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pb-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          className="h-9 px-5 text-sm text-slate-600 border-slate-200 hover:bg-slate-50 rounded-lg shadow-none"
        >
          취소
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isFormValid || isSaving}
          className="h-9 bg-blue-600 px-6 text-sm font-medium hover:bg-blue-700 rounded-lg shadow-none disabled:opacity-50"
        >
          {isSaving ? '저장중...' : '저장'}
        </Button>
      </div>

    </div>
  )
}
