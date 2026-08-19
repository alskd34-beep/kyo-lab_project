"use client"

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react"
import {
  AlertTriangle,
  Box,
  Lock,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { useIsMobile } from "@frontend/hooks/use-mobile"
import { useVirtualWindow } from "@frontend/hooks/use-virtual-window"

import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
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
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { SortColumnHeader, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import { StatusFilterTabs, type StatusFilterValue } from "@frontend/components/ui/status-filter-tabs"
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
  useTableColSpan,
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

/**
 * 정렬용 콜레이터.
 * String.localeCompare(v, "ko") 는 호출마다 콜레이터를 새로 만들어 목록이 커지면 급격히 느려진다.
 * (품목 700건 정렬 시 비교 6,800여 회) 한 번 만들어 재사용한다.
 */
const KO_COLLATOR = new Intl.Collator("ko")

type SortField =
  | "productCode"
  | "abbreviation"
  | "name"
  | "nameAlt"
  | "categoryName"
  | "classificationName"
  | "unit"
  | "packageSpec"
  | "difficulty"
  | "avgWorkdays"
  | "isActive"

// ─── 컬럼 정의 ────────────────────────────────────────────────────────────────
// 좁을 때는 두 필드를 한 셀에 쌓아 보여주고(묶음), 넓어지면 별도 컬럼으로 갈라진다.

const PRODUCT_COLUMNS: { key: string; def?: SortColumnDef<SortField> }[] = [
  {
    key: "code",
    def: {
      key: "code",
      label: "품목코드",
      fields: [
        { id: "productCode", label: "품목코드" },
        { id: "abbreviation", label: "약호" },
      ],
    },
  },
  {
    key: "name",
    def: {
      key: "name",
      label: "품목명",
      fields: [
        { id: "name", label: "품목명" },
        { id: "nameAlt", label: "품목명2" },
      ],
    },
  },
  {
    key: "class",
    def: {
      key: "class",
      label: "분류",
      fields: [
        { id: "categoryName", label: "품목구분" },
        { id: "classificationName", label: "전문분류" },
      ],
    },
  },
  {
    key: "spec",
    def: {
      key: "spec",
      label: "규격",
      fields: [
        { id: "unit", label: "단위" },
        { id: "packageSpec", label: "포장규격" },
      ],
    },
  },
  {
    key: "load",
    def: {
      key: "load",
      label: "난이도",
      fields: [
        { id: "difficulty", label: "난이도" },
        { id: "avgWorkdays", label: "공수" },
      ],
    },
  },
  {
    key: "status",
    def: { key: "status", label: "상태", fields: [{ id: "isActive", label: "활성/비활성" }] },
  },
]

const DIFF_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 }

function textOf(row: ProductRow, field: SortField): string {
  if (field === "avgWorkdays" || field === "isActive" || field === "difficulty") return ""
  const value = row[field]
  return value == null ? "" : String(value)
}

function compareProducts(a: ProductRow, b: ProductRow, field: SortField, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1
  if (field === "avgWorkdays") {
    const na = a.avgWorkdays
    const nb = b.avgWorkdays
    if (na == null && nb == null) return 0
    if (na == null) return 1
    if (nb == null) return -1
    return (na - nb) * mul
  }
  if (field === "isActive") return (Number(a.isActive) - Number(b.isActive)) * mul
  if (field === "difficulty") {
    const ra = DIFF_RANK[a.difficulty ?? ""] ?? 0
    const rb = DIFF_RANK[b.difficulty ?? ""] ?? 0
    return (ra - rb) * mul
  }
  const sa = textOf(a, field).trim()
  const sb = textOf(b, field).trim()
  if (!sa && !sb) return 0
  if (!sa) return 1
  if (!sb) return -1
  return KO_COLLATOR.compare(sa, sb) * mul
}

const DIFF_DOT: Record<string, string> = {
  High: "bg-red-500",
  Medium: "bg-amber-500",
  Low: "bg-emerald-500",
}

const DifficultyBadge = memo(function DifficultyBadge({ difficulty }: { difficulty: string | null }) {
  if (!difficulty) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", DIFF_DOT[difficulty] ?? "bg-muted-foreground")} />
      {difficulty}
    </Badge>
  )
})

const ROW_HEIGHT = 52
const CARD_HEIGHT = 156

function StatusLine({
  color,
  label,
  extra,
}: {
  color: string
  label: string
  extra?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", color)} />
      <span className="min-w-0 truncate text-xs text-foreground">{label}</span>
      {extra ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{extra}</span> : null}
    </div>
  )
}

const ProductTableRow = memo(function ProductTableRow({
  row,
  onEdit,
  onDelete,
}: {
  row: ProductRow
  onEdit: (row: ProductRow) => void
  onDelete: (row: ProductRow) => void
}) {
  return (
    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => onEdit(row)}>
      <TableCell className="px-3 py-2">
        <CellStack
          primary={row.productCode}
          secondary={row.abbreviation}
          primaryClass="font-mono text-xs text-muted-foreground"
          title={[row.productCode, row.abbreviation].filter(Boolean).join(" / ")}
        />
      </TableCell>
      <TableCell className="px-3 py-2">
        <CellStack
          primary={row.name}
          secondary={row.nameAlt}
          primaryClass="font-medium text-foreground"
          title={row.nameAlt ? `${row.name} ${row.nameAlt}` : row.name}
        />
      </TableCell>
      <TableCell className="px-3 py-2">
        <CellStack
          primary={row.categoryName || "—"}
          secondary={row.classificationName}
          primaryClass="text-xs text-foreground"
          title={[row.categoryName, row.classificationName].filter(Boolean).join(" / ")}
        />
      </TableCell>
      <TableCell className="px-3 py-2">
        <CellStack
          primary={row.unit || "—"}
          secondary={row.packageSpec}
          primaryClass="text-xs text-foreground"
          title={[row.unit, row.packageSpec].filter(Boolean).join(" / ")}
        />
      </TableCell>
      <TableCell className="px-3 py-2">
        <CellStack
          primary={
            <StatusLine
              color={row.difficulty ? (DIFF_DOT[row.difficulty] ?? "bg-muted-foreground") : "bg-muted-foreground"}
              label={row.difficulty ?? "—"}
            />
          }
          secondary={row.avgWorkdays != null ? `${row.avgWorkdays}일` : undefined}
          secondaryLabel="공수"
        />
      </TableCell>
      <TableCell className="px-3 py-2">
        <StatusLine
          color={row.isActive ? "bg-blue-500" : "bg-muted-foreground"}
          label={row.isActive ? "활성" : "비활성"}
        />
      </TableCell>

      <TableCell className="px-1 py-2 text-center">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => { e.stopPropagation(); onDelete(row) }}
          className="text-destructive hover:text-destructive"
          title="삭제"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  )
})

function VirtualPad({ height }: { height: number }) {
  const colSpan = useTableColSpan()
  if (height <= 0) return null
  return (
    <tr aria-hidden className="border-0 hover:bg-transparent">
      <td colSpan={colSpan} className="p-0" style={{ height, border: 0, padding: 0 }} />
    </tr>
  )
}

function EmptyRow({ children }: { children: ReactNode }) {
  const colSpan = useTableColSpan()
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-16 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  )
}

const ProductCard = memo(function ProductCard({
  row,
  onEdit,
  onDelete,
}: {
  row: ProductRow
  onEdit: (row: ProductRow) => void
  onDelete: (row: ProductRow) => void
}) {
  return (
    <Card
      className="cursor-pointer gap-0 px-3 py-3 transition-colors hover:bg-muted/30"
      onClick={() => onEdit(row)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">{row.productCode}</span>
            <Badge variant="outline" className="gap-1.5 text-[10px]">
              <span className={cn("size-1.5 rounded-full", row.isActive ? "bg-blue-500" : "bg-muted-foreground")} />
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
          onClick={(e) => { e.stopPropagation(); onDelete(row) }}
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
  )
})

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
      <section className="rounded-md border bg-card p-4 shadow-sm">
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
      <section className="rounded-md border bg-card p-4 shadow-sm">
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
      <section className="rounded-md border bg-card p-4 shadow-sm">
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
      <section className="rounded-md border bg-card p-4 shadow-sm">
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

/**
 * 검색·정렬·가상 스크롤은 여기만 다시 그린다.
 * KPI·추가/수정 모달이 같이 다시 그려지면 목록이 버벅인다.
 */
const ProductMasterList = memo(function ProductMasterList({
  rows,
  loading,
  statusFilter,
  onAdd,
  onEdit,
  onDelete,
}: {
  rows: ProductRow[]
  loading: boolean
  statusFilter: StatusFilterValue
  onAdd: () => void
  onEdit: (row: ProductRow) => void
  onDelete: (row: ProductRow) => void
}) {
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const isMobile = useIsMobile()

  const [sortField, setSortField] = useState<SortField>("productCode")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const pickSort = useCallback((field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }, [])

  const sorted = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    let filtered = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.productCode.toLowerCase().includes(q) ||
            (r.abbreviation ?? "").toLowerCase().includes(q)
        )
      : rows
    if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.isActive === (statusFilter === "active"))
    }
    // 활성 품목을 항상 위로 올린다. "활성" 컬럼 정렬만 방향으로 그룹 순서를 뒤집는다.
    const activeRank = (r: ProductRow) => (r.isActive ? 0 : 1)
    return [...filtered].sort((a, b) => {
      const groupDiff = activeRank(a) - activeRank(b)
      if (sortField === "isActive") {
        const mul = sortDir === "asc" ? 1 : -1
        return groupDiff !== 0 ? groupDiff * mul : compareProducts(a, b, "productCode", "asc")
      }
      if (groupDiff !== 0) return groupDiff
      return compareProducts(a, b, sortField, sortDir)
    })
  }, [rows, deferredSearch, sortField, sortDir, statusFilter])

  const { containerRef: virtualRef, start, end, padTop, padBottom } = useVirtualWindow(
    sorted.length,
    isMobile ? CARD_HEIGHT : ROW_HEIGHT,
  )
  const windowedRows = sorted.slice(start, end)

  const columns = PRODUCT_COLUMNS
  const containerRef = virtualRef

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="품목명 / 코드 / 약호 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Badge variant="secondary" className="tabular-nums">{sorted.length}건</Badge>
          <Button onClick={onAdd}>
            <Plus />
            품목 추가
          </Button>
        </div>
      </div>

      {!isMobile && (
      <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
        <Table
          containerRef={containerRef}
          containerClassName="min-w-0 overflow-x-hidden overflow-y-auto border-b border-border/60"
          className="w-full"
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead key={col.key} className="px-3 py-2">
                  {col.def ? (
                    <SortColumnHeader
                      col={col.def}
                      sortField={sortField}
                      sortDir={sortDir}
                      onPick={pickSort}
                    />
                  ) : null}
                </TableHead>
              ))}
              <TableHead className="px-1 text-center text-muted-foreground">
                <span className="sr-only">관리</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key} className="px-3 py-2"><Skeleton className="h-8 w-full" /></TableCell>
                    ))}
                    <TableCell className="px-1 py-2"><Skeleton className="mx-auto h-6 w-6 rounded" /></TableCell>
                  </TableRow>
                ))
              : sorted.length === 0
              ? (
                <EmptyRow>데이터가 없습니다.</EmptyRow>
              )
              : (
                <>
                  <VirtualPad height={padTop} />
                  {windowedRows.map((row) => (
                    <ProductTableRow
                      key={row.id}
                      row={row}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                  <VirtualPad height={padBottom} />
                </>
              )
            }
          </TableBody>
        </Table>
      </Card>
      )}

      {isMobile && (
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="mb-2 gap-2 px-3 py-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-14 rounded-md" />
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
          : (
            <>
              {padTop > 0 && <div aria-hidden style={{ height: padTop }} />}
              <div className="flex flex-col gap-2">
                {windowedRows.map((row) => (
                  <ProductCard key={row.id} row={row} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </div>
              {padBottom > 0 && <div aria-hidden style={{ height: padBottom }} />}
            </>
          )
        }
      </div>
      )}
    </>
  )
})

export function ProductTestWorkspace() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<LookupOptionRow[]>([])
  const [classifications, setClassifications] = useState<LookupOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all")

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)

  const [editTarget, setEditTarget] = useState<ProductRow | null>(null)
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_ADD_FORM)
  const [editForm, setEditForm] = useState<ProductFormState>(EMPTY_FORM)

  const [saving, setSaving] = useState(false)
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

  useEffect(() => { void loadProducts() }, [loadProducts])

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

  const openAdd = useCallback(() => {
    setAddForm(EMPTY_ADD_FORM)
    setError(null)
    setAddOpen(true)
  }, [])

  const openEdit = useCallback((row: ProductRow) => {
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
  }, [])

  const requestDelete = useCallback((row: ProductRow) => {
    setDeleteTarget(row)
  }, [])

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
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex shrink-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Box className="size-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">품목 마스터</h1>
        </div>
        <p className="text-xs text-muted-foreground">시험 품목의 기본 정보와 분류 기준을 관리합니다.</p>
      </div>

      {/* KPI 카드 — 한 줄 요약 */}
      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-0.5 px-3 py-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-10" />
            </Card>
          ))
        ) : (
          <>
            <Card className="gap-0.5 border-l-4 border-l-primary px-3 py-2">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">전체 품목</span>
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {summary.total}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  활성 <span className="font-semibold text-blue-600">{summary.active}</span>
                  {" · "}
                  비활성 {summary.total - summary.active}
                </span>
              </span>
            </Card>

            <Card className="gap-0.5 px-3 py-2">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">품목구분</span>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {Object.entries(summary.byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, cnt]) => (
                  <span key={name} className="text-[11px] text-muted-foreground">
                    {name} <span className="font-semibold tabular-nums text-foreground">{cnt}</span>
                  </span>
                ))}
              </div>
            </Card>

            <Card className="gap-0.5 px-3 py-2">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">전문분류</span>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {Object.entries(summary.byCls).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, cnt]) => (
                  <span key={name} className="text-[11px] text-muted-foreground">
                    {name} <span className="font-semibold tabular-nums text-foreground">{cnt}</span>
                  </span>
                ))}
              </div>
            </Card>

            <Card className="gap-0.5 px-3 py-2">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">난이도</span>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {[
                  { key: "High", dot: "bg-red-500" },
                  { key: "Medium", dot: "bg-amber-500" },
                  { key: "Low", dot: "bg-emerald-500" },
                  { key: "미설정", dot: "bg-muted-foreground" },
                ].map(({ key, dot }) => {
                  const cnt = summary.byDiff[key] ?? 0
                  if (!cnt) return null
                  return (
                    <span key={key} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span className={cn("size-1.5 rounded-full", dot)} />
                      {key} <span className="font-semibold tabular-nums text-foreground">{cnt}</span>
                    </span>
                  )
                })}
              </div>
            </Card>
          </>
        )}
      </div>

      <StatusFilterTabs
        value={statusFilter}
        onChange={setStatusFilter}
        counts={{ all: summary.total, active: summary.active, inactive: summary.total - summary.active }}
        activeLabel="활성 품목"
        inactiveLabel="비활성 품목"
        className="shrink-0"
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      <ProductMasterList
        rows={rows}
        loading={loading}
        statusFilter={statusFilter}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      {addOpen && (
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>품목 추가</DialogTitle>
            <DialogDescription>
              새 시험 품목을 등록합니다.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
              <section className="rounded-md border bg-card p-4 shadow-sm">
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
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
            <Button onClick={() => void handleAdd()} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {editOpen && (
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
              <section className="rounded-md border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">식별 정보</h3>
                <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2.5">
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
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
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
      )}

      {deleteTarget && (
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>품목 삭제</DialogTitle>
            <DialogDescription>
              연결된 시험 기준이 있으면 삭제가 거부될 수 있습니다. 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium">{deleteTarget?.name}</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{deleteTarget?.productCode}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>취소</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              <Trash2 />
              {deleting ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </div>
  )
}
