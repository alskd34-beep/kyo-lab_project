"use client"

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react"
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@frontend/components/ui/sheet"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"

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

interface AddFormState extends ProductFormState {
  productCode: string
}

const EMPTY_FORM: ProductFormState = {
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

const EMPTY_ADD_FORM: AddFormState = { productCode: "", ...EMPTY_FORM }

const DIFFICULTY_OPTIONS = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
]

const NONE_SENTINEL = "__none__"

const DIFF_DOT: Record<string, string> = {
  High: "bg-red-500",
  Medium: "bg-amber-500",
  Low: "bg-emerald-500",
}

function DifficultyBadge({ difficulty }: { difficulty: string | null }) {
  if (!difficulty) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", DIFF_DOT[difficulty] ?? "bg-muted-foreground")} />
      {difficulty}
    </Badge>
  )
}

const labelClass = "text-xs font-medium text-foreground"

function FormFields({
  form,
  setForm,
  categories,
  classifications,
}: {
  form: ProductFormState
  setForm: (fn: (prev: ProductFormState) => ProductFormState) => void
  categories: LookupOptionRow[]
  classifications: LookupOptionRow[]
}) {
  function f(key: keyof ProductFormState) {
    return (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }
  function setField(key: keyof ProductFormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
      {/* 식별 정보 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">식별 정보</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className={labelClass}>품목명 <span className="text-destructive">*</span></label>
            <Input value={form.name} onChange={f("name")} placeholder="품목명을 입력하세요" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className={labelClass}>품목명2</label>
            <Input value={form.nameAlt} onChange={f("nameAlt")} placeholder="품목명2 (선택)" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>약호</label>
            <Input value={form.abbreviation} onChange={f("abbreviation")} placeholder="예) ABC" />
          </div>
        </div>
      </section>

      {/* 분류 및 시험 속성 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">분류 및 시험 속성</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>품목구분</label>
            <Select
              value={form.categoryId || NONE_SENTINEL}
              onValueChange={(v) => setField("categoryId", v === NONE_SENTINEL ? "" : v)}
            >
              <SelectTrigger className="!h-9 px-3"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>—</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>전문분류</label>
            <Select
              value={form.classificationId || NONE_SENTINEL}
              onValueChange={(v) => setField("classificationId", v === NONE_SENTINEL ? "" : v)}
            >
              <SelectTrigger className="!h-9 px-3"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>—</SelectItem>
                {classifications.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>난이도</label>
            <Select
              value={form.difficulty || NONE_SENTINEL}
              onValueChange={(v) => setField("difficulty", v === NONE_SENTINEL ? "" : v)}
            >
              <SelectTrigger className="!h-9 px-3"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SENTINEL}>—</SelectItem>
                {DIFFICULTY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>단위</label>
            <Input value={form.unit} onChange={f("unit")} placeholder="예) mg" />
          </div>
        </div>
      </section>

      {/* 제품 상세 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">제품 상세</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>구분</label>
            <Input value={form.productType} onChange={f("productType")} placeholder="예) 완제품" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>포장규격</label>
            <Input value={form.packageSpec} onChange={f("packageSpec")} placeholder="예) 100정/병" />
          </div>
        </div>
      </section>

      {/* 공수 정보 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">공수 정보</h3>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>공수(일) <span className="text-destructive">*</span></label>
          <Input
            type="number"
            min={0}
            step={1}
            value={form.avgWorkdays}
            onChange={f("avgWorkdays")}
            placeholder="예) 3"
          />
        </div>
      </section>
    </>
  )
}

export function ProductTestWorkspace() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<LookupOptionRow[]>([])
  const [classifications, setClassifications] = useState<LookupOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)

  const [editTarget, setEditTarget] = useState<ProductRow | null>(null)
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_ADD_FORM)
  const [editForm, setEditForm] = useState<ProductFormState>(EMPTY_FORM)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sortField, setSortField] = useState<"productCode" | "name">("productCode")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

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

  useEffect(() => { void loadProducts() }, [loadProducts])

  function toggleSort(field: "productCode" | "name") {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
  }

  function SortIcon({ field }: { field: "productCode" | "name" }) {
    if (sortField !== field) return <span className="ml-1 opacity-40"><ChevronDown size={11} /></span>
    return sortDir === "asc"
      ? <ChevronUp size={11} className="ml-1 text-primary" />
      : <ChevronDown size={11} className="ml-1 text-primary" />
  }

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.productCode.toLowerCase().includes(q) ||
            (r.abbreviation ?? "").toLowerCase().includes(q)
        )
      : rows
    return [...filtered].sort((a, b) => {
      const va = sortField === "productCode" ? a.productCode : a.name
      const vb = sortField === "productCode" ? b.productCode : b.name
      return sortDir === "asc" ? va.localeCompare(vb, "ko") : vb.localeCompare(va, "ko")
    })
  }, [rows, search, sortField, sortDir])

  const summary = useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.isActive).length
    const byCat: Record<string, number> = {}
    rows.forEach((r) => { const k = r.categoryName ?? "미분류"; byCat[k] = (byCat[k] ?? 0) + 1 })
    const byCls: Record<string, number> = {}
    rows.forEach((r) => { const k = r.classificationName ?? "미분류"; byCls[k] = (byCls[k] ?? 0) + 1 })
    const byDiff: Record<string, number> = { Low: 0, Medium: 0, High: 0, 미설정: 0 }
    rows.forEach((r) => { const k = r.difficulty ?? "미설정"; byDiff[k] = (byDiff[k] ?? 0) + 1 })
    return { total, active, byCat, byCls, byDiff }
  }, [rows])

  function openAdd() {
    setAddForm(EMPTY_ADD_FORM)
    setError(null)
    setAddOpen(true)
  }

  function openEdit(row: ProductRow) {
    setEditTarget(row)
    setEditForm({
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
    setError(null)
    setEditOpen(true)
  }

  async function handleAdd() {
    if (!addForm.productCode.trim() || !addForm.name.trim()) {
      setError("품목코드와 품목명을 입력하세요.")
      return
    }
    const avgWorkdays = Number(addForm.avgWorkdays)
    if (!addForm.avgWorkdays.trim() || Number.isNaN(avgWorkdays) || avgWorkdays < 0) {
      setError("공수는 0 이상의 숫자(일)로 입력하세요.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: addForm.productCode,
          name: addForm.name,
          nameAlt: addForm.nameAlt || null,
          abbreviation: addForm.abbreviation || null,
          difficulty: addForm.difficulty || null,
          categoryId: addForm.categoryId || null,
          classificationId: addForm.classificationId || null,
          productType: addForm.productType || null,
          unit: addForm.unit || null,
          packageSpec: addForm.packageSpec || null,
          avgWorkdays,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      await loadProducts()
      setAddOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editTarget) return
    if (!editForm.name.trim()) { setError("품목명을 입력하세요."); return }
    const avgWorkdays = Number(editForm.avgWorkdays)
    if (!editForm.avgWorkdays.trim() || Number.isNaN(avgWorkdays) || avgWorkdays < 0) {
      setError("공수는 0 이상의 숫자(일)로 입력하세요.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTarget.id,
          name: editForm.name,
          nameAlt: editForm.nameAlt || null,
          abbreviation: editForm.abbreviation || null,
          difficulty: editForm.difficulty || null,
          categoryId: editForm.categoryId || null,
          classificationId: editForm.classificationId || null,
          productType: editForm.productType || null,
          unit: editForm.unit || null,
          packageSpec: editForm.packageSpec || null,
          avgWorkdays,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      await loadProducts()
      setEditOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Box className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">품목 마스터</h1>
        </div>
        <p className="text-sm text-muted-foreground">시험 품목의 기본 정보와 분류 기준을 관리합니다.</p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-1 px-4 py-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-12" />
              <Skeleton className="h-3 w-24" />
            </Card>
          ))
        ) : (
          <>
            <Card className="gap-1 border-l-4 border-l-primary px-4 py-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">전체 품목</span>
              <span className="text-2xl font-semibold tabular-nums text-foreground">{summary.total}</span>
              <span className="text-[11px] text-muted-foreground">
                활성 <span className="font-semibold text-emerald-600">{summary.active}</span>
                {" / "}
                비활성 <span className="font-semibold">{summary.total - summary.active}</span>
              </span>
            </Card>

            <Card className="gap-1 px-4 py-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">품목구분</span>
              <div className="mt-1 flex flex-col gap-1">
                {Object.entries(summary.byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, cnt]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: "55%" }} />
                    <span className="flex-1 truncate text-[11px] text-muted-foreground">{name}</span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">{cnt}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="gap-1 px-4 py-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">전문분류</span>
              <div className="mt-1 flex flex-col gap-1">
                {Object.entries(summary.byCls).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, cnt]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: "55%" }} />
                    <span className="flex-1 truncate text-[11px] text-muted-foreground">{name}</span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">{cnt}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="gap-1 px-4 py-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">난이도</span>
              <div className="mt-1 flex flex-col gap-1.5">
                {[
                  { key: "High", dot: "bg-red-500" },
                  { key: "Medium", dot: "bg-amber-500" },
                  { key: "Low", dot: "bg-emerald-500" },
                  { key: "미설정", dot: "bg-muted-foreground" },
                ].map(({ key, dot }) => {
                  const cnt = summary.byDiff[key] ?? 0
                  if (!cnt) return null
                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <div className={cn("h-1.5 rounded-full", dot)} style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: "55%" }} />
                      <span className="flex-1 text-[11px] text-muted-foreground">{key}</span>
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">{cnt}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* 툴바 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="품목명 / 코드 / 약호 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Badge variant="secondary" className="tabular-nums">{sorted.length}건</Badge>
          <Button onClick={openAdd}>
            <Plus />
            품목 추가
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      {/* 데스크톱 테이블 */}
      <Card className="hidden gap-0 overflow-hidden py-0 md:block">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="cursor-pointer px-3 text-muted-foreground" onClick={() => toggleSort("productCode")}>
                <span className="flex items-center">품목코드 <SortIcon field="productCode" /></span>
              </TableHead>
              <TableHead className="cursor-pointer px-3 text-muted-foreground" onClick={() => toggleSort("name")}>
                <span className="flex items-center">품목명 <SortIcon field="name" /></span>
              </TableHead>
              <TableHead className="px-3 text-muted-foreground">약호</TableHead>
              <TableHead className="px-3 text-muted-foreground">품목구분</TableHead>
              <TableHead className="px-3 text-muted-foreground">전문분류</TableHead>
              <TableHead className="px-3 text-muted-foreground">난이도</TableHead>
              <TableHead className="px-3 text-muted-foreground">단위</TableHead>
              <TableHead className="px-3 text-muted-foreground">포장규격</TableHead>
              <TableHead className="px-3 text-muted-foreground">공수</TableHead>
              <TableHead className="px-3 text-muted-foreground">상태</TableHead>
              <TableHead className="w-14 px-3 text-center text-muted-foreground">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-10" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-10" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="mx-auto h-6 w-6 rounded" /></TableCell>
                  </TableRow>
                ))
              : sorted.length === 0
              ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={11} className="py-16 text-center text-sm text-muted-foreground">
                    데이터가 없습니다.
                  </TableCell>
                </TableRow>
              )
              : sorted.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => openEdit(row)}
                  >
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.productCode}</TableCell>
                    <TableCell className="px-3 py-2.5 font-medium text-foreground">
                      {row.name}
                      {row.nameAlt && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{row.nameAlt}</span>}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.abbreviation ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.categoryName ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.classificationName ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5"><DifficultyBadge difficulty={row.difficulty} /></TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.unit ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.packageSpec ?? "—"}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-foreground">
                      {row.avgWorkdays != null ? `${row.avgWorkdays}일` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge variant="outline" className="gap-1.5">
                        <span className={cn("size-1.5 rounded-full", row.isActive ? "bg-emerald-500" : "bg-muted-foreground")} />
                        {row.isActive ? "활성" : "비활성"}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(row) }}
                        className="text-destructive hover:text-destructive"
                        title="삭제"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
            }
          </TableBody>
        </Table>
      </Card>

      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2 md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="gap-2 px-3 py-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </Card>
            ))
          : sorted.length === 0
          ? (
            <Card className="items-center py-6 text-center text-sm text-muted-foreground">
              데이터가 없습니다.
            </Card>
          )
          : sorted.map((row) => (
              <Card
                key={row.id}
                className="cursor-pointer gap-0 px-3 py-3 transition-colors hover:bg-muted/30"
                onClick={() => openEdit(row)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground">{row.productCode}</span>
                      <Badge variant="outline" className="gap-1.5 text-[10px]">
                        <span className={cn("size-1.5 rounded-full", row.isActive ? "bg-emerald-500" : "bg-muted-foreground")} />
                        {row.isActive ? "활성" : "비활성"}
                      </Badge>
                      <DifficultyBadge difficulty={row.difficulty} />
                    </div>
                    <div className="mt-1 break-words text-sm font-semibold text-foreground">
                      {row.name}
                      {row.nameAlt && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{row.nameAlt}</span>}
                    </div>
                    {row.abbreviation && (
                      <div className="font-mono text-[11px] text-muted-foreground">약호: {row.abbreviation}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(row) }}
                    className="text-destructive hover:text-destructive"
                    title="삭제"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                  <div><span className="font-medium text-foreground">품목구분:</span> {row.categoryName ?? "—"}</div>
                  <div><span className="font-medium text-foreground">전문분류:</span> {row.classificationName ?? "—"}</div>
                  <div><span className="font-medium text-foreground">단위:</span> {row.unit ?? "—"}</div>
                  <div className="truncate"><span className="font-medium text-foreground">포장:</span> {row.packageSpec ?? "—"}</div>
                  <div><span className="font-medium text-foreground">공수:</span> {row.avgWorkdays != null ? `${row.avgWorkdays}일` : "—"}</div>
                </div>
              </Card>
            ))
        }
      </div>

      {/* 품목 추가 Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-4 py-4 pr-12 text-left sm:px-5">
            <DialogTitle className="text-lg font-semibold text-foreground">품목 추가</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              새 시험 품목을 등록합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto bg-muted/30 px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">식별 정보</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>품목코드 <span className="text-destructive">*</span></label>
                    <Input
                      value={addForm.productCode}
                      onChange={(e) => setAddForm((p) => ({ ...p, productCode: e.target.value }))}
                      placeholder="예) PR-001"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>약호</label>
                    <Input
                      value={addForm.abbreviation}
                      onChange={(e) => setAddForm((p) => ({ ...p, abbreviation: e.target.value }))}
                      placeholder="예) ABC"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className={labelClass}>품목명 <span className="text-destructive">*</span></label>
                    <Input
                      value={addForm.name}
                      onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="품목명을 입력하세요"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className={labelClass}>품목명2</label>
                    <Input
                      value={addForm.nameAlt}
                      onChange={(e) => setAddForm((p) => ({ ...p, nameAlt: e.target.value }))}
                      placeholder="품목명2 (선택)"
                    />
                  </div>
                </div>
              </section>

              <FormFields
                form={addForm}
                setForm={(fn) => setAddForm((p) => ({ ...fn(p), productCode: p.productCode }))}
                categories={categories}
                classifications={classifications}
              />

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t bg-card px-4 py-4 sm:px-5">
            <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
            <Button onClick={() => void handleAdd()} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 품목 수정 Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-base font-semibold">품목 수정</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              품목 정보를 수정합니다.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-5 py-4">
            <div className="grid gap-4">
              {/* 품목코드 읽기 전용 */}
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">식별 정보</h3>
                <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
                  <Lock size={13} className="shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">품목코드</span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {editTarget?.productCode ?? "—"}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">변경 불가</span>
                </div>
              </section>

              <FormFields
                form={editForm}
                setForm={setEditForm}
                categories={categories}
                classifications={classifications}
              />

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
            </div>
          </div>

          <SheetFooter className="border-t bg-card px-5 py-4">
            <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
            <Button onClick={() => void handleEdit()} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 삭제 확인 Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b bg-destructive/5 px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground shadow-sm">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-foreground">품목 삭제</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-destructive">
                  연결된 시험 기준이 있으면 삭제가 거부될 수 있습니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-5">
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-sm font-semibold text-foreground">{deleteTarget?.name}</p>
              <p className="mt-1 font-mono text-xs text-destructive">{deleteTarget?.productCode}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                이 품목을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
          </div>

          <DialogFooter className="border-t bg-card px-4 py-4 sm:px-5">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>취소</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              <Trash2 />
              {deleting ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
