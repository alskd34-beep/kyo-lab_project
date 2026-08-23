"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import {
  ClipboardList,
  FilterX,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react"

import {
  CATEGORIES,
  CategoryBadge,
  type Category,
} from "@frontend/components/test-mgmt/test-category"

import { cn } from "@frontend/lib/utils"
import { Tag } from "@frontend/components/ui/tag"
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
import { FilterBar, PageHeader } from "@frontend/components/common/page-header"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { Input } from "@frontend/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/components/ui/select"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"

interface TestItemRow {
  id: string
  name: string
  category: string
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

interface FormState {
  name: string
  category: Category
  estimatedHours: string
  requiresDuo: boolean
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "기타",
  estimatedHours: "",
  requiresDuo: false,
  isActive: true,
}

/** 대분류 필터 값. `all` 은 전체. */
type CategoryFilter = "all" | Category
/** 활성 상태 필터 값. */
type StatusFilter = "all" | "active" | "inactive"

type SortField = "name" | "category" | "estimatedHours" | "requiresDuo" | "isActive"

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  sortCol("name", "시험항목명"),
  sortCol("category", "대분류"),
  sortCol("estimatedHours", "예상시간"),
  {
    key: "attrs",
    label: "2인시험",
    fields: [
      { id: "requiresDuo", label: "2인시험" },
      { id: "isActive", label: "활성" },
    ],
  },
]


export default function TestMasterPage() {
  const uid = useId()
  const [rows, setRows] = useState<TestItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<TestItemRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TestItemRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  useEffect(() => {
    queueMicrotask(() => {
      void loadItems()
    })
  }, [])

  // 실패 응답에서 깔끔한 한국어 메시지만 추출 (raw JSON 노출 방지)
  async function readError(res: Response): Promise<string> {
    try {
      const d = await res.json()
      return (d && typeof d.error === "string" && d.error) || "요청 처리 중 오류가 발생했습니다."
    } catch {
      return "요청 처리 중 오류가 발생했습니다."
    }
  }

  async function loadItems() {
    setLoading(true)
    try {
      const res = await fetch("/api/test-items")
      if (!res.ok) throw new Error(await readError(res))
      const data = (await res.json()) as { rows: TestItemRow[] }
      setRows(data.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 처리 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false
      if (q && !row.name.toLowerCase().includes(q)) return false
      if (statusFilter !== "all" && row.isActive !== (statusFilter === "active")) return false
      return true
    })
  }, [rows, search, categoryFilter, statusFilter])

  const pickSort = useCallback((field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }, [])

  const sortedData = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1
    // 활성 항목을 항상 위로 올린다. "활성" 컬럼 정렬만 방향으로 그룹 순서를 뒤집는다.
    const activeRank = (row: TestItemRow) => (row.isActive ? 0 : 1)
    const byName = (a: TestItemRow, b: TestItemRow) => a.name.localeCompare(b.name, "ko")

    return [...filtered].sort((a, b) => {
      const groupDiff = activeRank(a) - activeRank(b)
      if (sortField === "isActive") {
        return groupDiff !== 0 ? groupDiff * mul : byName(a, b)
      }
      if (groupDiff !== 0) return groupDiff

      if (sortField === "estimatedHours") {
        const ah = a.estimatedHours ?? -1
        const bh = b.estimatedHours ?? -1
        const diff = (ah - bh) * mul
        return diff !== 0 ? diff : byName(a, b)
      }
      if (sortField === "requiresDuo") {
        const diff = (Number(a.requiresDuo) - Number(b.requiresDuo)) * mul
        return diff !== 0 ? diff : byName(a, b)
      }
      const diff = a[sortField].localeCompare(b[sortField], "ko") * mul
      return diff !== 0 ? diff : byName(a, b)
    })
  }, [filtered, sortField, sortDir])

  /** 대분류 드롭다운에 함께 보여줄 분류별 건수. */
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const category of CATEGORIES) counts[category] = 0
    for (const row of rows) {
      counts[row.category] = (counts[row.category] ?? 0) + 1
    }
    return counts
  }, [rows])

  const summary = useMemo(() => {
    const active = rows.filter((row) => row.isActive).length
    const duo = rows.filter((row) => row.requiresDuo && row.isActive).length
    const estimated = rows.filter((row) => row.estimatedHours != null)
    const avgHours = estimated.length
      ? estimated.reduce((sum, row) => sum + (row.estimatedHours ?? 0), 0) /
        estimated.length
      : 0
    return { active, duo, avgHours }
  }, [rows])

  const filterActive =
    categoryFilter !== "all" || statusFilter !== "all" || search.trim() !== ""

  function resetFilters() {
    setCategoryFilter("all")
    setStatusFilter("all")
    setSearch("")
  }

  async function patchItem(id: string, payload: Partial<TestItemRow>) {
    const res = await fetch("/api/test-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    })
    if (!res.ok) throw new Error(await readError(res))
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...payload } : row))
    )
  }

  function openAddDialog() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setError(null)
    setDialogOpen(true)
  }

  function openEditDialog(row: TestItemRow) {
    setEditTarget(row)
    setForm({
      name: row.name,
      category: (CATEGORIES.includes(row.category as Category)
        ? row.category
        : "기타") as Category,
      estimatedHours:
        row.estimatedHours != null ? String(row.estimatedHours) : "",
      requiresDuo: row.requiresDuo,
      isActive: row.isActive,
    })
    setError(null)
    setDialogOpen(true)
  }

  function openDeleteDialog(row: TestItemRow) {
    setDeleteTarget(row)
    setError(null)
    setDeleteOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("시험항목명을 입력하세요.")
      return
    }

    const estimatedHours =
      form.estimatedHours.trim() === "" ? null : Number(form.estimatedHours)
    if (estimatedHours !== null && Number.isNaN(estimatedHours)) {
      setError("예상시간은 숫자로 입력하세요.")
      return
    }

    setSaving(true)
    try {
      if (editTarget) {
        await patchItem(editTarget.id, {
          name: form.name.trim(),
          category: form.category,
          estimatedHours,
          requiresDuo: form.requiresDuo,
          isActive: form.isActive,
        })
      } else {
        const res = await fetch("/api/test-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category,
            estimatedHours,
            requiresDuo: form.requiresDuo,
          }),
        })
        if (!res.ok) throw new Error(await readError(res))
        await loadItems()
      }

      setDialogOpen(false)
      setForm(EMPTY_FORM)
      setEditTarget(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 처리 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    setRows((prev) => prev.filter((row) => row.id !== deleteTarget.id))
    try {
      const res = await fetch("/api/test-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error(await readError(res))
      setDeleteOpen(false)
      setDeleteTarget(null)
    } catch {
      await loadItems()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      <PageHeader
        icon={ClipboardList}
        title="시험항목 마스터"
        count={rows.length}
        description="시험항목 분류와 예상시간, 2인시험 여부를 관리합니다."
        stats={[
          { label: "활성", value: summary.active, tone: "blue" },
          { label: "2인시험", value: `${summary.duo}건` },
          { label: "평균 예상시간", value: `${summary.avgHours.toFixed(1)}h`, tone: "amber" },
        ]}
        actions={(
          <Button onClick={openAddDialog} size="lg">
            <Plus />
            항목 추가
          </Button>
        )}
      />

      {/* 필터 한 줄 — 검색 · 대분류 · 상태. (예전의 3중 탭을 대체) */}
      <FilterBar
        trailing={(
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">{filtered.length}</span>
            {" / "}
            {rows.length}건 표시
          </span>
        )}
      >
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="시험항목명 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-9"
          />
        </div>

        <Select
          value={categoryFilter}
          onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}
        >
          <SelectTrigger
            aria-label="대분류 필터"
            className={cn(
              "min-w-40",
              categoryFilter !== "all" && "border-blue-500 bg-blue-50 text-blue-700",
            )}
          >
            <span className="text-muted-foreground">대분류</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 ({rows.length})</SelectItem>
            {CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {category} ({categoryCounts[category] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger
            aria-label="상태 필터"
            className={cn(
              "min-w-32",
              statusFilter !== "all" && "border-blue-500 bg-blue-50 text-blue-700",
            )}
          >
            <span className="text-muted-foreground">상태</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 ({rows.length})</SelectItem>
            <SelectItem value="active">활성 ({summary.active})</SelectItem>
            <SelectItem value="inactive">비활성 ({rows.length - summary.active})</SelectItem>
          </SelectContent>
        </Select>

        {filterActive && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8">
            <FilterX />
            초기화
          </Button>
        )}
      </FilterBar>

      {error && !dialogOpen && !deleteOpen && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-2 px-3 py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-14 rounded-md" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
          ))
        ) : sortedData.length === 0 ? (
          <Card className="items-center py-6 text-center text-sm text-muted-foreground">
            {filterActive ? "조건에 맞는 시험항목이 없습니다." : "데이터가 없습니다."}
          </Card>
        ) : (
          sortedData.map((row) => (
            <Card
              key={row.id}
              className="cursor-pointer gap-0 px-3 py-3"
              onClick={() => openEditDialog(row)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryBadge category={row.category} />
                    <Tag color={row.isActive ? "green" : "mono"}>
                      {row.isActive ? "활성" : "비활성"}
                    </Tag>
                  </div>
                  <div className="mt-1 text-sm font-semibold break-words text-foreground">
                    {row.name}
                  </div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-x-2 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground min-[420px]:grid-cols-2">
                <div>
                  <span className="font-medium text-foreground">예상시간:</span>{" "}
                  {row.estimatedHours != null ? `${row.estimatedHours}h` : "—"}
                </div>
                <div>
                  <span className="font-medium text-foreground">2인시험:</span>{" "}
                  {row.requiresDuo ? "필요" : "미사용"}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
        <Table className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {SORT_COLUMNS.map((col) => (
                <TableHead key={col.key} className="px-3 py-2">
                  <SortColumnHeader
                    col={col}
                    sortField={sortField}
                    sortDir={sortDir}
                    onPick={pickSort}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-5 w-16 rounded-md" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-8 w-16" /></TableCell>
                </TableRow>
              ))
            ) : sortedData.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={SORT_COLUMNS.length} className="py-16 text-center text-sm text-muted-foreground">
                  {filterActive ? "조건에 맞는 시험항목이 없습니다." : "데이터가 없습니다."}
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((row) => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openEditDialog(row)}>
                  <TableCell className="px-3 py-2">
                    <div className="truncate font-medium text-foreground" title={row.name}>
                      {row.name}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <CategoryBadge category={row.category} />
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                    {row.estimatedHours != null ? `${row.estimatedHours}` : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <CellStack
                      primary={(
                        <Tag color={row.requiresDuo ? "yellow" : "mono"}>
                          {row.requiresDuo ? "2인 사용" : "2인 미사용"}
                        </Tag>
                      )}
                      secondary={(
                        <Tag color={row.isActive ? "green" : "mono"}>
                          {row.isActive ? "활성" : "비활성"}
                        </Tag>
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 추가/수정 다이얼로그 */}
      <ManagementDrawer
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        size="lg"
        title={editTarget ? "시험항목 수정" : "시험항목 추가"}
        description="시험항목 기본 정보와 2인시험 여부를 관리합니다."
        footer={(
          <>
            {editTarget && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => { setDialogOpen(false); openDeleteDialog(editTarget) }}
                disabled={saving}
              >
                <Trash2 /> 삭제
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>취소</Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </>
        )}
      >
          <div className="grid gap-4">
              <section className="rounded-md border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label htmlFor={`${uid}-name`} className="text-xs font-medium text-muted-foreground">
                      시험항목명 <span className="text-destructive">*</span>
                  </label>
                    <Input
                      id={`${uid}-name`}
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="시험항목명을 입력하세요"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${uid}-category`} className="text-xs font-medium text-muted-foreground">대분류</label>
                    <Select
                      value={form.category}
                      onValueChange={(value) =>
                        setForm((prev) => ({ ...prev, category: value as Category }))
                      }
                    >
                      <SelectTrigger id={`${uid}-category`} className="!h-9 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${uid}-hours`} className="text-xs font-medium text-muted-foreground">
                      예상시간 (h)
                  </label>
                  <label className="mt-2 flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                      className="cb-custom"
                    />
                    활성 상태
                  </label>
                    <Input
                      id={`${uid}-hours`}
                      type="number"
                      min={0}
                      value={form.estimatedHours}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          estimatedHours: e.target.value,
                        }))
                      }
                      placeholder="예) 2"
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-md border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">시험 설정</h3>
                </div>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={form.requiresDuo}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        requiresDuo: e.target.checked,
                      }))
                    }
                    className="cb-custom"
                  />
                  2인시험 여부
                </label>
              </section>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
          </div>
      </ManagementDrawer>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>시험항목 삭제</DialogTitle>
            <DialogDescription>
              삭제 후에는 목록에서 즉시 제거됩니다. 연결된 품목 시험 기준이 있으면 영향이 있을 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium">{deleteTarget?.name}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
            >
              <Trash2 />
              {saving ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
