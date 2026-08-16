"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import {
  ClipboardList,
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
  DialogBody,
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
import { Skeleton } from "@frontend/components/ui/skeleton"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import { StatusFilterTabs, type StatusFilterValue } from "@frontend/components/ui/status-filter-tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"

const CATEGORIES = [
  "성상·포장",
  "이화학",
  "함량시험",
  "확인시험",
  "기기분석",
  "안전성",
  "기타",
] as const

type Category = (typeof CATEGORIES)[number]

const CATEGORY_DOT: Record<string, string> = {
  "성상·포장": "bg-fuchsia-500",
  이화학: "bg-blue-500",
  함량시험: "bg-indigo-500",
  확인시험: "bg-cyan-500",
  기기분석: "bg-amber-500",
  안전성: "bg-red-500",
  기타: "bg-muted-foreground",
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

interface FormState {
  name: string
  category: Category
  estimatedHours: string
  requiresDuo: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "기타",
  estimatedHours: "",
  requiresDuo: false,
}

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



function CategoryBadge({ category }: { category: string }) {
  const dot = CATEGORY_DOT[category] ?? CATEGORY_DOT["기타"]
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {category || "기타"}
    </Badge>
  )
}

function DuoToggleButton({ row, onToggle, className }: { row: TestItemRow; onToggle: () => void; className?: string }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        row.requiresDuo
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          : "border-input bg-background text-muted-foreground hover:bg-muted/50",
        className,
      )}
    >
      {row.requiresDuo ? "2인 사용" : "2인 미사용"}
    </button>
  )
}

function ActiveToggleButton({ row, onToggle, className }: { row: TestItemRow; onToggle: () => void; className?: string }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        row.isActive
          ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          : "border-input bg-background text-muted-foreground hover:bg-muted/50",
        className,
      )}
    >
      {row.isActive ? "활성" : "비활성"}
    </button>
  )
}

export default function TestMasterPage() {
  const [rows, setRows] = useState<TestItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"전체" | Category>("전체")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<TestItemRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TestItemRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all")
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
      if (activeTab !== "전체" && row.category !== activeTab) return false
      if (q && !row.name.toLowerCase().includes(q)) return false
      if (statusFilter !== "all" && row.isActive !== (statusFilter === "active")) return false
      return true
    })
  }, [rows, search, activeTab, statusFilter])

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

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { 전체: rows.length }
    for (const category of CATEGORIES) {
      counts[category] = rows.filter((row) => row.category === category).length
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

  async function toggleDuo(row: TestItemRow) {
    const next = !row.requiresDuo
    setRows((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, requiresDuo: next } : item
      )
    )
    try {
      await patchItem(row.id, { requiresDuo: next })
    } catch {
      await loadItems()
    }
  }

  async function toggleActive(row: TestItemRow) {
    const next = !row.isActive
    setRows((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, isActive: next } : item
      )
    )
    try {
      await patchItem(row.id, { isActive: next })
    } catch {
      await loadItems()
    }
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

  const allTabs = ["전체", ...CATEGORIES] as const

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* KPI 카드 */}
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Card className="gap-0.5 px-3 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">전체 항목</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">{rows.length}</span>
          <span className="text-[11px] text-muted-foreground">
            현재 표시{" "}
            <span className="font-semibold text-foreground tabular-nums">{filtered.length}</span>건
          </span>
        </Card>
        <Card className="gap-0.5 px-3 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">활성 항목</span>
          <span className="text-lg font-semibold tabular-nums text-indigo-600">{summary.active}</span>
        </Card>
        <Card className="gap-0.5 px-3 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">평균 예상시간</span>
          <span className="text-lg font-semibold tabular-nums text-amber-600">
            {summary.avgHours.toFixed(1)}
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
              2인 {summary.duo}건
            </span>
          </span>
        </Card>
      </div>

      <StatusFilterTabs
        value={statusFilter}
        onChange={setStatusFilter}
        counts={{ all: rows.length, active: summary.active, inactive: rows.length - summary.active }}
        activeLabel="활성 항목"
        inactiveLabel="비활성 항목"
        className="shrink-0"
      />

      {/* 헤더 + 검색 + 추가 버튼 */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ClipboardList className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">시험항목 마스터</h1>
          <Badge variant="secondary" className="tabular-nums">{filtered.length}건</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          시험항목 분류와 예상시간, 2인시험 여부를 관리합니다.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* 탭 세그먼트 */}
          <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground flex-wrap">
            {allTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab as typeof activeTab)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm font-medium transition-colors inline-flex items-center gap-1",
                  activeTab === tab ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
                )}
              >
                {tab}
                <Badge variant="secondary" className="tabular-nums text-[10px] px-1.5 py-0">
                  {tabCounts[tab] ?? 0}
                </Badge>
              </button>
            ))}
          </div>

          <div className="flex gap-2 sm:ml-auto">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="시험항목명 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
            <Button onClick={openAddDialog} size="lg">
              <Plus />
              항목 추가
            </Button>
          </div>
        </div>
      </div>

      {error && !dialogOpen && !deleteOpen && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
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
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
          ))
        ) : filtered.length === 0 ? (
          <Card className="items-center py-6 text-center text-sm text-muted-foreground">
            데이터가 없습니다.
          </Card>
        ) : (
          filtered.map((row) => (
            <Card key={row.id} className="gap-0 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryBadge category={row.category} />
                    <Badge variant="outline" className={cn("gap-1.5", row.isActive ? "" : "text-muted-foreground")}>
                      <span className={cn("size-1.5 rounded-full", row.isActive ? "bg-indigo-500" : "bg-muted-foreground")} />
                      {row.isActive ? "활성" : "비활성"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm font-semibold break-words text-foreground">
                    {row.name}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(row)}
                    title="수정"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openDeleteDialog(row)}
                    title="삭제"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
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

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  onClick={() => void toggleDuo(row)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    row.requiresDuo
                      ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {row.requiresDuo ? "2인시험 사용" : "2인시험 미사용"}
                </button>
                <button
                  onClick={() => void toggleActive(row)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    row.isActive
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {row.isActive ? "활성 유지" : "활성 전환"}
                </button>
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
              <TableHead className="px-1 text-center text-muted-foreground">
                <span className="sr-only">액션</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-8 w-16" /></TableCell>
                  <TableCell className="px-1 py-2"><Skeleton className="mx-auto h-6 w-14" /></TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                  데이터가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((row) => (
                <TableRow key={row.id}>
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
                      primary={<DuoToggleButton row={row} onToggle={() => void toggleDuo(row)} />}
                      secondary={<ActiveToggleButton row={row} onToggle={() => void toggleActive(row)} />}
                    />
                  </TableCell>
                  <TableCell className="px-1 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(row)}
                        title="수정"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDeleteDialog(row)}
                        title="삭제"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 추가/수정 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "시험항목 수정" : "시험항목 추가"}
            </DialogTitle>
            <DialogDescription>
              시험항목 기본 정보와 2인시험 여부를 관리합니다.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
              <section className="rounded-lg border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      시험항목명 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="시험항목명을 입력하세요"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">대분류</label>
                    <Select
                      value={form.category}
                      onValueChange={(value) =>
                        setForm((prev) => ({ ...prev, category: value as Category }))
                      }
                    >
                      <SelectTrigger className="!h-9 px-3">
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
                    <label className="text-xs font-medium text-muted-foreground">
                      예상시간 (h)
                    </label>
                    <Input
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

              <section className="rounded-lg border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">시험 설정</h3>
                </div>
                <label className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground">
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
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>시험항목 삭제</DialogTitle>
            <DialogDescription>
              삭제 후에는 목록에서 즉시 제거됩니다. 연결된 품목 시험 기준이 있으면 영향이 있을 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/50 p-3">
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
