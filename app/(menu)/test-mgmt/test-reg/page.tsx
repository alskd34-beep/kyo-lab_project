"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { addDays, format, parse, isValid } from "date-fns"
import { Button } from "@frontend/components/ui/button"
import { Badge } from "@frontend/components/ui/badge"
import { Card, CardContent } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { Calendar as CalendarIcon, Search, X } from "lucide-react"
import { Calendar as DateCalendar } from "@frontend/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"
import { cn } from "@frontend/lib/utils"
import type { ProductRow } from "@backend/services/products"
import type { ProductTestItemRow } from "@backend/services/productTestItems"

type DosageForm = "현탁제" | "내용고형제" | "전제" | "환제" | "액제" | "주사제"
type ValidationType = "일반" | "PV" | "CV"

interface TestItemRow {
  name: string
  checked: boolean
  assignee: string
}

interface TesterOption {
  id: string
  name: string
  employeeNo: string
}
const DOSAGE_FORMS: DosageForm[] = [
  "현탁제",
  "내용고형제",
  "전제",
  "환제",
  "액제",
  "주사제",
]
const VALIDATION_TYPES: ValidationType[] = ["일반", "PV", "CV"]

function autoDate(packagingDate: string): string {
  if (!packagingDate) return ""
  const d = parse(packagingDate, "yyyy-MM-dd", new Date())
  return isValid(d) ? format(addDays(d, 14), "yyyy-MM-dd") : ""
}

function parseDateValue(value: string) {
  if (!value) return undefined
  const parsed = parse(value, "yyyy-MM-dd", new Date())
  return isValid(parsed) ? parsed : undefined
}

function formatDateLabel(value: string) {
  const parsed = parseDateValue(value)
  return parsed ? format(parsed, "yyyy.MM.dd") : ""
}

function DateField({
  label,
  helper,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selectedDate = parseDateValue(value)

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {helper && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">
            {helper}
          </span>
        )}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-9 w-full justify-between px-3 text-sm font-normal shadow-none"
          >
            <span
              className={cn(
                "truncate",
                value ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {value ? formatDateLabel(value) : placeholder}
            </span>
            <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[calc(100vw-1rem)] max-w-sm rounded-2xl p-3"
        >
          <div className="flex items-start justify-between gap-3 px-1 pb-2">
            <div>
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <p className="text-[11px] text-muted-foreground">
                {helper ?? "날짜를 선택하면 바로 반영됩니다."}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const today = format(new Date(), "yyyy-MM-dd")
                onChange(today)
                setOpen(false)
              }}
              className="h-8 px-2.5 text-xs"
            >
              오늘
            </Button>
          </div>
          <DateCalendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              onChange(date ? format(date, "yyyy-MM-dd") : "")
              setOpen(false)
            }}
            className="w-full shadow-none"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
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
  const [keyword, setKeyword] = useState("")
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setKeyword("")
      setProducts([])
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  useEffect(() => {
    const trimmed = keyword.trim()
    if (!trimmed) {
      setProducts([])
      return
    }
    const tid = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/products?search=${encodeURIComponent(trimmed)}&limit=100`
        )
        const data = (await res.json()) as { rows: ProductRow[] }
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
    fetch("/api/products?limit=200")
      .then((r) => r.json())
      .then((d: { rows: ProductRow[] }) => setProducts(d.rows ?? []))
      .finally(() => setLoading(false))
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg gap-0 overflow-hidden p-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm font-semibold text-foreground">
            품목 검색
          </DialogTitle>
        </DialogHeader>

        {/* 검색 인풋 */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="품목명 또는 품목코드 입력..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {keyword && (
            <button
              onClick={() => setKeyword("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* 목록 */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              로딩중...
            </div>
          ) : products.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다.
            </div>
          ) : (
            products.map((p) => {
              const hasItems = (p.testItemCount ?? 0) > 0
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelect(p)
                    onClose()
                  }}
                  className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/50"
                >
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {p.productCode}
                  </span>
                  <span className="flex-1 text-sm text-foreground">
                    {p.name}
                  </span>
                  <Badge
                    variant={hasItems ? "secondary" : "outline"}
                    className="shrink-0 text-[10px]"
                  >
                    시험 {p.testItemCount ?? 0}건
                  </Badge>
                  {p.unit && (
                    <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground">
                      {p.unit}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="border-t px-4 py-2 text-right">
          <span className="text-[11px] text-muted-foreground">
            총 {products.length}건
          </span>
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
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 1글자 이상 입력 시 자동완성
  useEffect(() => {
    const trimmed = value.trim()
    if (trimmed.length < 1) {
      const tid = window.setTimeout(() => {
        setSuggestions([])
        setOpen(false)
        setActiveIdx(-1)
      }, 0)
      return () => window.clearTimeout(tid)
    }
    const tid = setTimeout(async () => {
      const res = await fetch(
        `/api/products?search=${encodeURIComponent(trimmed)}&limit=10`
      )
      const data = (await res.json()) as { rows: ProductRow[] }
      const rows = data.rows ?? []
      setSuggestions(rows)
      setOpen(rows.length > 0)
      setActiveIdx(-1)
    }, 200)
    return () => clearTimeout(tid)
  }, [value])

  // 활성 항목 스크롤
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIdx])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Enter") {
        setOpen(false)
        onSearch()
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (activeIdx >= 0) {
        onSelect(suggestions[activeIdx])
        setOpen(false)
        setActiveIdx(-1)
      } else {
        setOpen(false)
        onSearch()
      }
    } else if (e.key === "Escape") {
      setOpen(false)
      setActiveIdx(-1)
    }
  }

  return (
    <div ref={wrapRef} className="relative flex-1">
      <div className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background transition-all focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="품목코드 또는 품목명 입력"
          className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("")
              setSuggestions([])
              setOpen(false)
              setActiveIdx(-1)
            }}
            className="px-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* 자동완성 드롭다운 */}
      {open && suggestions.length > 0 && (
        <div
          ref={listRef}
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border bg-card shadow-lg"
        >
          {suggestions.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => {
                onSelect(p)
                setOpen(false)
                setActiveIdx(-1)
              }}
              className={cn(
                "flex w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-0",
                idx === activeIdx ? "bg-primary/5" : "hover:bg-muted/50"
              )}
            >
              <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">
                {p.productCode}
              </span>
              <span
                className={cn(
                  "flex-1 truncate text-sm",
                  idx === activeIdx ? "font-medium text-foreground" : "text-foreground"
                )}
              >
                {p.name}
              </span>
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

  const [searchText, setSearchText] = useState("")
  const [productId, setProductId] = useState("")
  const [productCode, setProductCode] = useState("")
  const [productName, setProductName] = useState("")
  const [spec, setSpec] = useState("")
  const [batchNo, setBatchNo] = useState("")
  const [dosageForm, setDosageForm] = useState<DosageForm | "">("")
  const [packagingDate, setPackagingDate] = useState("")
  const [reviewDeadline, setReviewDeadline] = useState("")
  const [qcPlannedDate, setQcPlannedDate] = useState("")
  const [validationType, setValidationType] = useState<ValidationType>("일반")
  const [testItems, setTestItems] = useState<TestItemRow[]>([])
  const [testerOptions, setTesterOptions] = useState<TesterOption[]>([])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lookupError, setLookupError] = useState("")
  const [productFound, setProductFound] = useState(false)

  useEffect(() => {
    const auto = autoDate(packagingDate)
    setReviewDeadline(auto)
    setQcPlannedDate(auto)
  }, [packagingDate])

  // 활성 시험자 목록 로드 (DB)
  useEffect(() => {
    let cancelled = false
    fetch("/api/testers")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              rows: {
                id: string
                name: string
                employeeNo: string
                isActive: boolean
              }[]
            }>)
          : Promise.reject(r)
      )
      .then((data) => {
        if (cancelled) return
        const active = (data.rows ?? [])
          .filter((t) => t.isActive)
          .map((t) => ({ id: t.id, name: t.name, employeeNo: t.employeeNo }))
        setTesterOptions(active)
      })
      .catch((err) => console.error("[test-reg] 시험자 목록 로드 실패", err))
    return () => {
      cancelled = true
    }
  }, [])

  const loadTestItems = useCallback(async (pid: string) => {
    if (!pid) return
    setIsLookingUp(true)
    setLookupError("")
    setTestItems([])
    try {
      const res = await fetch(
        `/api/product-test-items?productId=${encodeURIComponent(pid)}`
      )
      const data = (await res.json()) as { rows: ProductTestItemRow[] }
      const rows = data.rows ?? []
      if (rows.length > 0) {
        setTestItems(
          rows.map((r) => ({
            name: r.testItemName,
            checked: true,
            assignee: "",
          }))
        )
        setProductFound(true)
      } else {
        setLookupError(
          "등록된 시험항목이 없습니다. 시험항목 마스터에서 먼저 등록해주세요."
        )
        setProductFound(true)
      }
    } catch {
      setLookupError("시험항목 조회 중 오류가 발생했습니다.")
    } finally {
      setIsLookingUp(false)
    }
  }, [])

  const selectProduct = useCallback(
    (p: ProductRow) => {
      setSearchText(p.name)
      setProductId(p.id)
      setProductCode(p.productCode)
      setProductName(p.name)
      setLookupError("")
      setProductFound(false)
      loadTestItems(p.id)
    },
    [loadTestItems]
  )

  // 코드로 직접 조회 (Enter 또는 조회 버튼)
  const lookupByText = useCallback(async () => {
    const text = searchText.trim()
    if (!text) return
    setIsLookingUp(true)
    setLookupError("")
    setProductFound(false)
    setTestItems([])
    try {
      const res = await fetch(
        `/api/products?search=${encodeURIComponent(text)}&limit=1`
      )
      const data = (await res.json()) as { rows: ProductRow[] }
      const p = data.rows?.[0]
      if (!p) throw new Error("not found")
      selectProduct(p)
    } catch {
      setLookupError(`'${text}'에 해당하는 품목을 찾을 수 없습니다.`)
      setIsLookingUp(false)
    }
  }, [searchText, selectProduct])

  const toggleItem = (idx: number) =>
    setTestItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it))
    )

  const setItemAssignee = (idx: number, assignee: string) =>
    setTestItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, assignee } : it))
    )

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
        status: "pending",
      }
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      router.push("/product-test/prod-status")
    } catch (err) {
      console.error("[test-reg] save error", err)
    } finally {
      setIsSaving(false)
    }
  }

  const isFormValid =
    productFound && productCode.trim() && batchNo.trim() && testItems.length > 0

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">시험등록</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          생산배치를 시스템에 등록합니다.
        </p>
      </div>

      {/* 기본 정보 */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-5 py-3">
          <span className="text-sm font-semibold text-foreground">
            기본 정보
          </span>
        </div>
        <CardContent className="px-5 py-5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            {/* 품목 검색 */}
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                품목 <span className="text-red-500">*</span>
                <span className="ml-1.5 font-normal">
                  — 코드·한글명 입력 또는 🔍로 목록 검색
                </span>
              </label>
              <div className="flex flex-col gap-2 md:flex-row">
                <Autocomplete
                  value={searchText}
                  onChange={setSearchText}
                  onSelect={selectProduct}
                  onSearch={lookupByText}
                />
                <div className="flex gap-2">
                  {/* 목록 팝업 버튼 */}
                  <Button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 shadow-none"
                    title="품목 목록에서 선택"
                  >
                    <Search className="size-3.5 text-muted-foreground" />
                  </Button>
                  {/* 직접 조회 버튼 */}
                  <Button
                    type="button"
                    onClick={lookupByText}
                    disabled={isLookingUp || !searchText.trim()}
                    className="h-9 flex-1 shrink-0 gap-1.5 px-4 text-xs font-medium shadow-none md:flex-none"
                  >
                    {isLookingUp ? "조회중..." : "조회"}
                  </Button>
                </div>
              </div>
              {lookupError && (
                <p className="mt-1.5 text-xs text-red-500">{lookupError}</p>
              )}
            </div>

            {/* 품목코드 / 품목명 (읽기 전용) */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                품목코드
              </label>
              <Input
                readOnly
                value={productCode}
                placeholder="자동 입력"
                className="h-9 cursor-not-allowed bg-muted font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                품목명
              </label>
              <Input
                readOnly
                value={productName}
                placeholder="자동 입력"
                className="h-9 cursor-not-allowed bg-muted text-sm"
              />
            </div>

            {/* 규격 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                규격
              </label>
              <Input
                type="text"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="예: 10mL/병"
                className="h-9 text-sm"
              />
            </div>

            {/* 제조번호 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                제조번호 <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                placeholder="예: 26002"
                className="h-9 text-sm"
              />
            </div>

            {/* 제형 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                제형
              </label>
              <Select
                value={dosageForm || "none"}
                onValueChange={(v) =>
                  setDosageForm(v === "none" ? "" : (v as DosageForm))
                }
              >
                <SelectTrigger className="!h-9 px-3">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택</SelectItem>
                  {DOSAGE_FORMS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 밸리데이션구분 */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                밸리데이션구분
              </label>
              <Select
                value={validationType}
                onValueChange={(v) => setValidationType(v as ValidationType)}
              >
                <SelectTrigger className="!h-9 px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALIDATION_TYPES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 날짜 필드들 */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:col-span-2 md:grid-cols-3">
              <DateField
                label="포장일(예정)"
                helper="기록서검토기한과 QC완료예정일 계산 기준"
                value={packagingDate}
                onChange={setPackagingDate}
                placeholder="날짜를 선택하세요"
              />
              <DateField
                label="기록서검토기한"
                helper="포장일 + 14일"
                value={reviewDeadline}
                onChange={setReviewDeadline}
                placeholder="날짜를 선택하세요"
              />
              <DateField
                label="QC완료예정일"
                helper="편집 가능"
                value={qcPlannedDate}
                onChange={setQcPlannedDate}
                placeholder="날짜를 선택하세요"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 시험항목 */}
      {productFound && testItems.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                시험항목
              </span>
              <Badge variant="secondary" className="tabular-nums">
                {testItems.filter((it) => it.checked).length}/{testItems.length}
              </Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const all = testItems.every((it) => it.checked)
                setTestItems((p) => p.map((it) => ({ ...it, checked: !all })))
              }}
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {testItems.every((it) => it.checked) ? "전체 해제" : "전체 선택"}
            </Button>
          </div>
          <CardContent className="px-5 py-4">
            <div className="flex flex-col gap-2">
              {testItems.map((item, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border px-3.5 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3",
                    item.checked
                      ? "border-primary/20 bg-primary/5"
                      : "border bg-muted/30"
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => toggleItem(idx)}
                      className="cb-custom shrink-0"
                    />
                    <span
                      className={cn(
                        "flex-1 text-sm font-medium",
                        item.checked ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {item.name}
                    </span>
                  </div>
                  <div className="w-full pl-7 sm:w-36 sm:shrink-0 sm:pl-0">
                    <Select
                      value={item.assignee || "none"}
                      onValueChange={(v) =>
                        setItemAssignee(idx, v === "none" ? "" : v)
                      }
                      disabled={!item.checked}
                    >
                      <SelectTrigger className="!h-8 px-2.5 text-xs">
                        <SelectValue placeholder="시험자 미배정" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">시험자 미배정</SelectItem>
                        {testerOptions.map((t) => (
                          <SelectItem key={t.id} value={t.name}>
                            {t.name} ({t.employeeNo})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 버튼 */}
      <div className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          className="h-9 w-full shadow-none sm:w-auto"
        >
          취소
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isFormValid || isSaving}
          className="h-9 w-full shadow-none sm:w-auto"
        >
          {isSaving ? "저장중..." : "저장"}
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
