"use client"

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react"
import {
  AlertTriangle,
  Box,
  Gauge,
  PackagePlus,
  Pencil,
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
  productCode: string
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

const EMPTY_PRODUCT_FORM: ProductFormState = {
  productCode: "",
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

const DIFFICULTY_OPTIONS = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
]

// sentinel value for "unset" selects — never matches a real id/value
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

export function ProductTestWorkspace() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      {/* 페이지 헤더 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">품목 마스터</h1>
            <Badge variant="outline" className="gap-1.5 text-muted-foreground">
              <Box className="size-3.5" />
              품목 마스터
            </Badge>
            <Badge variant="outline" className="gap-1.5 text-muted-foreground">
              <Gauge className="size-3.5" />
              평균공수 통합
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            품목을 먼저 정리하고, 아래 공수 섹션에서 바로 연결하세요.
            별도 메뉴를 없애고 한 화면에서 조회, 등록, 수정이 이어지도록 구성했습니다.
          </p>
        </div>
      </div>

      <ProductsPanel />
    </div>
  )
}

function ProductsPanel() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<LookupOptionRow[]>([])
  const [classifications, setClassifications] = useState<LookupOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ProductRow | null>(null)
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts()
    })
  }, [loadProducts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.productCode.toLowerCase().includes(q) ||
        (r.abbreviation ?? "").toLowerCase().includes(q)
    )
  }, [rows, search])

  function openAdd() {
    setEditTarget(null)
    setForm(EMPTY_PRODUCT_FORM)
    setDialogOpen(true)
  }

  function openEdit(row: ProductRow) {
    setEditTarget(row)
    setForm({
      productCode: row.productCode,
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
    setDialogOpen(true)
  }

  function f(key: keyof ProductFormState) {
    return (e: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  function setFormField(key: keyof ProductFormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!form.productCode.trim() || !form.name.trim()) return
    const avgWorkdays = Number(form.avgWorkdays)
    if (!form.avgWorkdays.trim() || Number.isNaN(avgWorkdays) || avgWorkdays < 0) {
      setError("공수는 0 이상의 숫자(일)로 입력하세요.")
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        nameAlt: form.nameAlt || null,
        abbreviation: form.abbreviation || null,
        difficulty: form.difficulty || null,
        categoryId: form.categoryId || null,
        classificationId: form.classificationId || null,
        productType: form.productType || null,
        unit: form.unit || null,
        packageSpec: form.packageSpec || null,
        avgWorkdays,
      }
      if (editTarget) {
        const res = await fetch("/api/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editTarget.id, ...payload }),
        })
        if (!res.ok) throw new Error(await res.text())
        await loadProducts()
      } else {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productCode: form.productCode, ...payload }),
        })
        if (!res.ok) throw new Error(await res.text())
        await loadProducts()
      }
      setDialogOpen(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(row: ProductRow) {
    setDeleteTarget(row)
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

  const summary = useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.isActive).length

    const byCat: Record<string, number> = {}
    rows.forEach((r) => {
      const key = r.categoryName ?? "미분류"
      byCat[key] = (byCat[key] ?? 0) + 1
    })

    const byCls: Record<string, number> = {}
    rows.forEach((r) => {
      const key = r.classificationName ?? "미분류"
      byCls[key] = (byCls[key] ?? 0) + 1
    })

    const byDiff: Record<string, number> = {
      Low: 0,
      Medium: 0,
      High: 0,
      미설정: 0,
    }
    rows.forEach((r) => {
      const key = r.difficulty ?? "미설정"
      byDiff[key] = (byDiff[key] ?? 0) + 1
    })

    return { total, active, byCat, byCls, byDiff }
  }, [rows])

  const labelClass = "text-xs font-semibold text-foreground"

  return (
    <>
      {/* 툴바 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground sm:text-lg">품목 마스터</h2>
          <Badge variant="secondary" className="tabular-nums">{filtered.length}건</Badge>
        </div>
        <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="품목명 / 코드 / 약호 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <Button onClick={openAdd} size="lg">
            <Plus />
            품목 추가
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* KPI 카드 */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="gap-1 px-4 py-4">
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
              {Object.entries(summary.byCat)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([name, cnt]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: "55%" }}
                    />
                    <span className="flex-1 truncate text-[11px] text-muted-foreground">{name}</span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">{cnt}</span>
                  </div>
                ))}
            </div>
          </Card>

          <Card className="gap-1 px-4 py-4">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">전문분류</span>
            <div className="mt-1 flex flex-col gap-1">
              {Object.entries(summary.byCls)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([name, cnt]) => (
                  <div key={name} className="flex items-center gap-1.5">
                    <div
                      className="h-1.5 rounded-full bg-violet-500"
                      style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: "55%" }}
                    />
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
                    <div
                      className={cn("h-1.5 rounded-full", dot)}
                      style={{ width: `${Math.round((cnt / summary.total) * 100)}%`, minWidth: 4, maxWidth: "55%" }}
                    />
                    <span className="flex-1 text-[11px] text-muted-foreground">{key}</span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">{cnt}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      )}

      {/* 테이블 (데스크톱) */}
      <Card className="hidden gap-0 overflow-hidden py-0 md:block">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {["품목코드", "품목명", "약호", "품목구분", "전문분류", "난이도", "단위", "포장규격", "공수", "상태", "액션"].map((h) => (
                <TableHead key={h} className="px-3 text-muted-foreground">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={11} className="py-16 text-center text-sm text-muted-foreground">불러오는 중...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={11} className="py-16 text-center text-sm text-muted-foreground">데이터가 없습니다.</TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.productCode}</TableCell>
                  <TableCell className="px-3 py-2.5 font-medium text-foreground">
                    {row.name}
                    {row.nameAlt && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{row.nameAlt}</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{row.abbreviation ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.categoryName ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.classificationName ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2.5">
                    <DifficultyBadge difficulty={row.difficulty} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.unit ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{row.packageSpec ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-foreground">
                    {row.avgWorkdays != null ? `${row.avgWorkdays}일` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    {row.isActive ? (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="size-1.5 rounded-full bg-emerald-500" />활성
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="size-1.5 rounded-full bg-muted-foreground" />비활성
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(row)} title="수정" className="text-muted-foreground">
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(row)} title="삭제" className="text-muted-foreground hover:text-destructive">
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2 md:hidden">
        {loading ? (
          <Card className="items-center py-6 text-center text-sm text-muted-foreground">불러오는 중...</Card>
        ) : filtered.length === 0 ? (
          <Card className="items-center py-6 text-center text-sm text-muted-foreground">데이터가 없습니다.</Card>
        ) : (
          filtered.map((row) => (
            <Card key={row.id} className="gap-0 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">{row.productCode}</span>
                    {row.isActive ? (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="size-1.5 rounded-full bg-emerald-500" />활성
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1.5">
                        <span className="size-1.5 rounded-full bg-muted-foreground" />비활성
                      </Badge>
                    )}
                    <DifficultyBadge difficulty={row.difficulty} />
                  </div>
                  <div className="mt-1 text-sm font-semibold break-words text-foreground">
                    {row.name}
                    {row.nameAlt && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{row.nameAlt}</span>
                    )}
                  </div>
                  {row.abbreviation && (
                    <div className="font-mono text-[11px] text-muted-foreground">약호: {row.abbreviation}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(row)} title="수정" className="text-muted-foreground">
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(row)} title="삭제" className="text-muted-foreground hover:text-destructive">
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground min-[420px]:grid-cols-2">
                <div><span className="font-medium text-foreground">품목구분:</span> {row.categoryName ?? "—"}</div>
                <div><span className="font-medium text-foreground">전문분류:</span> {row.classificationName ?? "—"}</div>
                <div><span className="font-medium text-foreground">단위:</span> {row.unit ?? "—"}</div>
                <div className="truncate"><span className="font-medium text-foreground">포장:</span> {row.packageSpec ?? "—"}</div>
                <div><span className="font-medium text-foreground">공수:</span> {row.avgWorkdays != null ? `${row.avgWorkdays}일` : "—"}</div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* 등록/수정 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <PackagePlus size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-foreground">
                  {editTarget ? "품목 정보 수정" : "신규 품목 등록"}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                  시험 품목의 기본 정보와 분류 기준을 관리합니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              {/* 식별 정보 */}
              <section className="rounded-lg border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">식별 정보</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    코드와 품목명은 저장에 필요한 필수 항목입니다.
                  </p>
                </div>
                {editTarget && (
                  <div className="mb-3">
                    <Badge variant="secondary">수정 모드</Badge>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>
                      품목코드 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={form.productCode}
                      onChange={f("productCode")}
                      placeholder="예) PR-001"
                      disabled={!!editTarget}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>약호</label>
                    <Input
                      value={form.abbreviation}
                      onChange={f("abbreviation")}
                      placeholder="예) ABC"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className={labelClass}>
                      품목명 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={form.name}
                      onChange={f("name")}
                      placeholder="품목명을 입력하세요"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className={labelClass}>품목명2</label>
                    <Input
                      value={form.nameAlt}
                      onChange={f("nameAlt")}
                      placeholder="품목명2 (선택)"
                    />
                  </div>
                </div>
              </section>

              {/* 분류 및 시험 속성 */}
              <section className="rounded-lg border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">분류 및 시험 속성</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    품목구분, 전문분류, 난이도 기준을 선택합니다.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>품목구분</label>
                    <Select
                      value={form.categoryId || NONE_SENTINEL}
                      onValueChange={(v) => setFormField("categoryId", v === NONE_SENTINEL ? "" : v)}
                    >
                      <SelectTrigger className="!h-9 px-3">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_SENTINEL}>—</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>전문분류</label>
                    <Select
                      value={form.classificationId || NONE_SENTINEL}
                      onValueChange={(v) => setFormField("classificationId", v === NONE_SENTINEL ? "" : v)}
                    >
                      <SelectTrigger className="!h-9 px-3">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_SENTINEL}>—</SelectItem>
                        {classifications.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>난이도</label>
                    <Select
                      value={form.difficulty || NONE_SENTINEL}
                      onValueChange={(v) => setFormField("difficulty", v === NONE_SENTINEL ? "" : v)}
                    >
                      <SelectTrigger className="!h-9 px-3">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_SENTINEL}>—</SelectItem>
                        {DIFFICULTY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>단위</label>
                    <Input
                      value={form.unit}
                      onChange={f("unit")}
                      placeholder="예) mg"
                    />
                  </div>
                </div>
              </section>

              {/* 제품 상세 */}
              <section className="rounded-lg border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">제품 상세</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">제품 구분과 포장규격을 입력합니다.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>구분</label>
                    <Input
                      value={form.productType}
                      onChange={f("productType")}
                      placeholder="예) 완제품"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>포장규격</label>
                    <Input
                      value={form.packageSpec}
                      onChange={f("packageSpec")}
                      placeholder="예) 100정/병"
                    />
                  </div>
                </div>
              </section>

              {/* 공수 정보 */}
              <section className="rounded-lg border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">공수 정보</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">품목과 함께 대표 평균공수를 저장합니다.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className={labelClass}>
                      공수(일) <span className="text-destructive">*</span>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={form.avgWorkdays}
                      onChange={f("avgWorkdays")}
                      placeholder="예) 3"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>

          <DialogFooter className="border-t px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="w-full sm:w-auto"
            >
              취소
            </Button>
            <Button
              size="lg"
              onClick={handleSave}
              disabled={
                saving ||
                !form.productCode.trim() ||
                !form.name.trim() ||
                !form.avgWorkdays.trim()
              }
              className="w-full sm:w-auto"
            >
              <Save size={15} />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-foreground">품목 삭제 확인</DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                  삭제 후에는 목록에서 즉시 제거됩니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-5">
            <div className="rounded-lg border border-red-200 bg-red-50/70 p-4">
              <p className="text-sm font-semibold text-foreground">{deleteTarget?.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{deleteTarget?.productCode}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                이 품목을 삭제하시겠습니까? 연결된 시험 기준이 있는 경우 API에서 삭제를 거부할 수 있습니다.
              </p>
            </div>
          </div>

          <DialogFooter className="border-t px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              size="lg"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="w-full sm:w-auto"
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="lg"
              onClick={confirmDelete}
              disabled={deleting}
              className="w-full sm:w-auto"
            >
              <Trash2 size={15} />
              {deleting ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
