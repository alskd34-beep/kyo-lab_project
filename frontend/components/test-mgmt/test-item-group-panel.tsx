"use client"

/**
 * 시험항목 그룹(템플릿) 관리 패널.
 *
 * '전공정'처럼 여러 시험항목을 **순서대로 묶은 템플릿**을 만들고 관리한다.
 * `test_items.category`(대분류)와는 별개 개념이라 대분류 뱃지는 그대로 두고
 * 그룹은 이 화면에서만 다룬다.
 *
 * 서버 계약: `app/api/test-item-groups/*` · `backend/services/testItemGroups.ts`
 *   GET/POST/PATCH/DELETE /api/test-item-groups
 *   GET/PUT               /api/test-item-groups/[id]/items  (PUT 은 통째 교체)
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Layers,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react"

import { api, errorMessage } from "@frontend/lib/api-client"
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
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  SortColumnHeader,
  sortCol,
  type SortColumnDef,
  type SortDir,
} from "@frontend/components/ui/table-sort"
import {
  StatusFilterTabs,
  type StatusFilterValue,
} from "@frontend/components/ui/status-filter-tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"
import { Tag } from "@frontend/components/ui/tag"
import { CategoryBadge } from "@frontend/components/test-mgmt/test-category"

/** 그룹 목록 행 — `GET /api/test-item-groups` 의 `rows` */
export interface TestItemGroupRow {
  id: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  itemCount: number
}

/** 그룹에 담긴 시험항목 — `GET /api/test-item-groups/[id]/items` 의 `rows` */
interface GroupItemRow {
  testItemId: string
  testItemName: string
  category: string
  sequenceOrder: number
}

/** 그룹에 담을 후보(시험항목 마스터). 페이지가 이미 불러온 목록을 그대로 받는다. */
export interface GroupCandidateItem {
  id: string
  name: string
  category: string
  isActive: boolean
}

interface GroupFormState {
  name: string
  description: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_FORM: GroupFormState = {
  name: "",
  description: "",
  sortOrder: "0",
  isActive: true,
}

type GroupSortField = "name" | "description" | "itemCount" | "isActive"

const GROUP_SORT_COLUMNS: SortColumnDef<GroupSortField>[] = [
  sortCol("name", "그룹명"),
  sortCol("description", "설명"),
  sortCol("itemCount", "항목 수"),
  sortCol("isActive", "상태"),
]

export function TestItemGroupPanel({
  candidates,
  candidatesLoading,
}: {
  candidates: GroupCandidateItem[]
  candidatesLoading: boolean
}) {
  const uid = useId()
  const [groups, setGroups] = useState<TestItemGroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all")
  // 기본은 서버 정렬(sortOrder → 이름). 헤더에서 고르면 그때부터 그 기준으로 정렬한다.
  const [sortField, setSortField] = useState<GroupSortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TestItemGroupRow | null>(null)
  const [form, setForm] = useState<GroupFormState>(EMPTY_FORM)
  /** 그룹에 담긴 시험항목 id — **배열 순서가 그대로 그룹 내 순번**이다. */
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [pickerSearch, setPickerSearch] = useState("")

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TestItemGroupRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ rows: TestItemGroupRow[] }>("/api/test-item-groups")
      setGroups(data.rows ?? [])
    } catch (e) {
      setError(errorMessage(e, "그룹을 불러오지 못했습니다."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  const candidateById = useMemo(() => {
    const map = new Map<string, GroupCandidateItem>()
    for (const item of candidates) map.set(item.id, item)
    return map
  }, [candidates])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return groups.filter((row) => {
      if (statusFilter !== "all" && row.isActive !== (statusFilter === "active")) return false
      if (!q) return true
      return (
        row.name.toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q)
      )
    })
  }, [groups, search, statusFilter])

  const sortedGroups = useMemo(() => {
    if (!sortField) return filtered
    const mul = sortDir === "asc" ? 1 : -1
    const byName = (a: TestItemGroupRow, b: TestItemGroupRow) =>
      a.name.localeCompare(b.name, "ko")

    return [...filtered].sort((a, b) => {
      if (sortField === "itemCount") {
        const diff = (a.itemCount - b.itemCount) * mul
        return diff !== 0 ? diff : byName(a, b)
      }
      if (sortField === "isActive") {
        const diff = (Number(a.isActive) - Number(b.isActive)) * -mul
        return diff !== 0 ? diff : byName(a, b)
      }
      const va = sortField === "description" ? (a.description ?? "") : a.name
      const vb = sortField === "description" ? (b.description ?? "") : b.name
      const diff = va.localeCompare(vb, "ko") * mul
      return diff !== 0 ? diff : byName(a, b)
    })
  }, [filtered, sortField, sortDir])

  const activeCount = useMemo(
    () => groups.filter((row) => row.isActive).length,
    [groups],
  )

  const pickSort = useCallback((field: GroupSortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }, [])

  function openAddDrawer() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setMemberIds([])
    setPickerSearch("")
    setError(null)
    setDrawerOpen(true)
  }

  async function openEditDrawer(row: TestItemGroupRow) {
    setEditTarget(row)
    setForm({
      name: row.name,
      description: row.description ?? "",
      sortOrder: String(row.sortOrder ?? 0),
      isActive: row.isActive,
    })
    setMemberIds([])
    setPickerSearch("")
    setError(null)
    setDrawerOpen(true)

    setMembersLoading(true)
    try {
      const data = await api.get<{ rows: GroupItemRow[] }>(
        `/api/test-item-groups/${row.id}/items`,
      )
      setMemberIds((data.rows ?? []).map((r) => r.testItemId))
    } catch (e) {
      setError(errorMessage(e, "그룹 시험항목을 불러오지 못했습니다."))
    } finally {
      setMembersLoading(false)
    }
  }

  function openDeleteDialog(row: TestItemGroupRow) {
    setDeleteTarget(row)
    setError(null)
    setDeleteOpen(true)
  }

  function addMember(itemId: string) {
    setMemberIds((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]))
  }

  function removeMember(itemId: string) {
    setMemberIds((prev) => prev.filter((id) => id !== itemId))
  }

  /** 위/아래 한 칸 이동. 배열 순서가 곧 순번이므로 자리만 바꾸면 된다. */
  function moveMember(index: number, delta: number) {
    setMemberIds((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSave() {
    const name = form.name.trim()
    if (!name) {
      setError("그룹명을 입력하세요.")
      return
    }
    const sortOrder = form.sortOrder.trim() === "" ? 0 : Number(form.sortOrder)
    if (Number.isNaN(sortOrder)) {
      setError("정렬 순서는 숫자로 입력하세요.")
      return
    }

    setSaving(true)
    setError(null)
    try {
      let groupId = editTarget?.id
      if (editTarget) {
        await api.patch("/api/test-item-groups", {
          id: editTarget.id,
          name,
          description: form.description.trim() || null,
          sortOrder,
          isActive: form.isActive,
        })
      } else {
        const created = await api.post<{ row: TestItemGroupRow }>("/api/test-item-groups", {
          name,
          description: form.description.trim() || null,
          sortOrder,
        })
        groupId = created.row.id
        // 생성 API 는 활성 상태를 받지 않는다(기본 활성). 비활성으로 만들 때만 이어서 수정한다.
        if (!form.isActive) {
          await api.patch("/api/test-item-groups", { id: groupId, isActive: false })
        }
      }

      if (groupId) {
        await api.put(`/api/test-item-groups/${groupId}/items`, { testItemIds: memberIds })
      }

      await loadGroups()
      setDrawerOpen(false)
      setEditTarget(null)
      setForm(EMPTY_FORM)
      setMemberIds([])
    } catch (e) {
      setError(errorMessage(e, "그룹을 저장하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await api.del("/api/test-item-groups", { id: deleteTarget.id })
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadGroups()
    } catch (e) {
      setError(errorMessage(e, "그룹을 삭제하지 못했습니다."))
    } finally {
      setSaving(false)
    }
  }

  /** 아직 담기지 않은 활성 시험항목 (검색어 적용) */
  const pickerItems = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    const picked = new Set(memberIds)
    return candidates.filter((item) => {
      if (picked.has(item.id)) return false
      if (!item.isActive) return false
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [candidates, memberIds, pickerSearch])

  return (
    <>
      {/* KPI 카드 */}
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Card className="gap-0.5 px-3 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">전체 그룹</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">{groups.length}</span>
          <span className="text-[11px] text-muted-foreground">
            현재 표시{" "}
            <span className="font-semibold tabular-nums text-foreground">{filtered.length}</span>건
          </span>
        </Card>
        <Card className="gap-0.5 px-3 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">활성 그룹</span>
          <span className="text-lg font-semibold tabular-nums text-blue-600">{activeCount}</span>
        </Card>
        <Card className="gap-0.5 px-3 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">담긴 항목 합계</span>
          <span className="text-lg font-semibold tabular-nums text-amber-600">
            {groups.reduce((sum, row) => sum + row.itemCount, 0)}
          </span>
        </Card>
      </div>

      <StatusFilterTabs
        value={statusFilter}
        onChange={setStatusFilter}
        counts={{
          all: groups.length,
          active: activeCount,
          inactive: groups.length - activeCount,
        }}
        activeLabel="활성 그룹"
        inactiveLabel="비활성 그룹"
        className="shrink-0"
      />

      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Layers className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">시험항목 그룹</h1>
          <Badge variant="secondary" className="tabular-nums">{filtered.length}건</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          &lsquo;전공정&rsquo;처럼 여러 시험항목을 순서대로 묶은 템플릿입니다. 대분류와는 별개 개념입니다.
        </p>

        <div className="flex gap-2 sm:ml-auto">
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="그룹명·설명 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <Button onClick={openAddDrawer} size="lg">
            <Plus />
            그룹 추가
          </Button>
        </div>
      </div>

      {error && !drawerOpen && !deleteOpen && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-2 px-3 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))
        ) : sortedGroups.length === 0 ? (
          <Card className="items-center py-6 text-center text-sm text-muted-foreground">
            데이터가 없습니다.
          </Card>
        ) : (
          sortedGroups.map((row) => (
            <Card
              key={row.id}
              className="cursor-pointer gap-0 px-3 py-3"
              onClick={() => void openEditDrawer(row)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-sm font-semibold break-words text-foreground">
                  {row.name}
                </div>
                <Tag color={row.isActive ? "green" : "mono"}>
                  {row.isActive ? "활성" : "비활성"}
                </Tag>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {row.description || "설명 없음"}
              </div>
              <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">항목 수:</span>{" "}
                <span className="tabular-nums">{row.itemCount}</span>개
              </div>
            </Card>
          ))
        )}
      </div>

      <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
        {/* 논리 열 4개(그룹명·설명·항목 수·상태), 2필드 묶음 없음 → 최대 4칸.
            table-fixed 에서 <col> 이 모자라면 늘어난 칸이 폭 0으로 접혀 사라진다. */}
        <Table className="w-full">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[44%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {GROUP_SORT_COLUMNS.map((col) => (
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
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-5 w-12 rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : sortedGroups.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-16 text-center text-sm text-muted-foreground">
                  등록된 그룹이 없습니다. &lsquo;그룹 추가&rsquo;로 템플릿을 만들어 보세요.
                </TableCell>
              </TableRow>
            ) : (
              sortedGroups.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => void openEditDrawer(row)}
                >
                  <TableCell className="px-3 py-2">
                    <div className="truncate font-medium text-foreground" title={row.name}>
                      {row.name}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={row.description ?? ""}
                    >
                      {row.description || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                    {row.itemCount}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <Tag color={row.isActive ? "green" : "mono"}>
                      {row.isActive ? "활성" : "비활성"}
                    </Tag>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 그룹 추가/수정 패널 */}
      <ManagementDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        size="xl"
        title={editTarget ? "시험항목 그룹 수정" : "시험항목 그룹 추가"}
        description="그룹 기본 정보와 그룹에 담을 시험항목·순서를 관리합니다."
        footer={(
          <>
            {editTarget && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => { setDrawerOpen(false); openDeleteDialog(editTarget) }}
                disabled={saving}
              >
                <Trash2 /> 삭제
              </Button>
            )}
            <Button variant="outline" onClick={() => setDrawerOpen(false)} disabled={saving}>
              취소
            </Button>
            {/* 항목을 아직 불러오는 중이면 저장을 막는다 — PUT 은 통째 교체라 빈 배열로 저장하면 전부 지워진다. */}
            <Button onClick={handleSave} disabled={saving || membersLoading}>
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
                  그룹명 <span className="text-destructive">*</span>
                </label>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="예) 전공정"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor={`${uid}-description`} className="text-xs font-medium text-muted-foreground">설명</label>
                <Input
                  id={`${uid}-description`}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="그룹을 어떤 상황에 쓰는지 적어 주세요"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-sortOrder`} className="text-xs font-medium text-muted-foreground">정렬 순서</label>
                <Input
                  id={`${uid}-sortOrder`}
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: e.target.value }))}
                  placeholder="예) 0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">상태</span>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                    className="cb-custom"
                  />
                  활성 상태
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-md border bg-card p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">그룹 시험항목</h3>
              <Badge variant="secondary" className="tabular-nums">{memberIds.length}개</Badge>
              <span className="text-xs text-muted-foreground">
                위/아래 버튼으로 순서를 바꿉니다. 저장 시 이 순서가 그대로 순번이 됩니다.
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* 담긴 항목 (순서대로) */}
              <div className="flex min-h-0 flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  담긴 항목 <span className="tabular-nums">({memberIds.length})</span>
                </div>
                <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                  {membersLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))
                  ) : memberIds.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      오른쪽 목록에서 시험항목을 골라 담아 주세요.
                    </p>
                  ) : (
                    memberIds.map((itemId, index) => {
                      const item = candidateById.get(itemId)
                      return (
                        <div
                          key={itemId}
                          className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                        >
                          <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-xs font-medium text-foreground"
                              title={item?.name ?? itemId}
                            >
                              {item?.name ?? "삭제된 시험항목"}
                            </div>
                          </div>
                          {item && !item.isActive && <Tag color="mono">비활성</Tag>}
                          {item && <CategoryBadge category={item.category} />}
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="위로"
                              disabled={index === 0}
                              onClick={() => moveMember(index, -1)}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="아래로"
                              disabled={index === memberIds.length - 1}
                              onClick={() => moveMember(index, 1)}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="빼기"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeMember(itemId)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* 시험항목 마스터에서 담기 */}
              <div className="flex min-h-0 flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">
                  시험항목 마스터 <span className="tabular-nums">({pickerItems.length})</span>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="시험항목 검색..."
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    className="h-9 pl-9"
                  />
                </div>
                <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
                  {candidatesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))
                  ) : pickerItems.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      담을 수 있는 시험항목이 없습니다.
                    </p>
                  ) : (
                    pickerItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addMember(item.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left transition-colors",
                          "hover:border-primary hover:bg-primary/5",
                        )}
                      >
                        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                        <span
                          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        <CategoryBadge category={item.category} />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </ManagementDrawer>

      {/* 삭제 확인 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>시험항목 그룹 삭제</DialogTitle>
            <DialogDescription>
              그룹과 그룹에 담긴 항목 목록이 함께 삭제됩니다. 이미 품목에 넣은 시험항목은 영향받지 않습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
            <p className="text-sm font-medium">{deleteTarget?.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              담긴 항목 <span className="tabular-nums">{deleteTarget?.itemCount ?? 0}</span>개
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              <Trash2 />
              {saving ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
