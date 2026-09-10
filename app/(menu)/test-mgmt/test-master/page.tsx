"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { formatMinutes } from "@frontend/lib/workload-format"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import {
  ClipboardList,
  FilterX,
  Info,
  Plus,
  Save,
  Search,
  TrendingUp,
  Trash2,
} from "lucide-react"

import {
  CATEGORIES,
  CategoryBadge,
  type Category,
} from "@frontend/components/test-mgmt/test-category"
import {
  EstimateSourceBadge,
  TimeboxedBadge,
  estimateSourceHelp,
  type EstimateSource,
} from "@frontend/components/test-mgmt/estimate-source"

import { cn } from "@frontend/lib/utils"
import { Tag } from "@frontend/components/ui/tag"
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
  estimatedMinutes: number | null
  estimatedHours: number | null
  /** 예상시간의 출처 — 같은 숫자라도 근거의 강도가 다르다(0046) */
  estimateSource: EstimateSource
  estimateSampleCount: number
  estimateUpdatedAt: string | null
  /** 시간박스(MT 등) — 정확한 공수가 존재하지 않는 항목 */
  isTimeboxed: boolean
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

/** 시험항목별 실적 소요시간 (GET /api/test-items/stats) */
interface TestItemActual {
  testItemId: string | null
  name: string
  sampleCount: number
  ignoredCount: number
  medianMinutes: number
  avgMinutes: number
  minMinutes: number
  maxMinutes: number
  lastClearedAt: string | null
}

interface EstimateSuggestion {
  testItemId: string
  name: string
  category: string
  currentMinutes: number | null
  suggestedMinutes: number
  sampleCount: number
  diffRatio: number | null
  direction: "up" | "down" | "new"
}

interface TestItemStats {
  actuals: TestItemActual[]
  suggestions: EstimateSuggestion[]
  coverage: {
    clearedTotal: number
    validSamples: number
    ignoredSamples: number
    itemsWithActuals: number
    timeboxedSkipped: number
  } | null
}

interface FormState {
  name: string
  category: Category
  estimatedValue: string
  estimatedUnit: "min" | "hour"
  estimateSource: EstimateSource
  isTimeboxed: boolean
  requiresDuo: boolean
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "기타",
  estimatedValue: "",
  estimatedUnit: "min" as "min" | "hour",
  // 새로 만드는 항목의 예상시간은 정의상 가정치다 — 실적이 있을 수 없다.
  estimateSource: "assumed",
  isTimeboxed: false,
  requiresDuo: false,
  isActive: true,
}

const SOURCE_OPTIONS: { value: EstimateSource; label: string }[] = [
  { value: "assumed", label: "가정 — 경험으로 잡은 값" },
  { value: "measured", label: "실적 — 완료 실적에서 나온 값" },
  { value: "confirmed", label: "확정 — 실적을 검토해 확정" },
]

/** 대분류 필터 값. `all` 은 전체. */
type CategoryFilter = "all" | Category
/** 활성 상태 필터 값. */
type StatusFilter = "all" | "active" | "inactive"

/**
 * 분 → 입력 폼의 (값, 단위). 60분 단위로 떨어지면 시간으로 되돌린다.
 * 2시간짜리를 "120분" 으로 보여주면 읽는 사람이 매번 나눗셈을 한다.
 */
function splitMinutes(min: number | null): { estimatedValue: string; estimatedUnit: "min" | "hour" } {
  if (min == null) return { estimatedValue: "", estimatedUnit: "min" }
  if (min >= 60 && min % 60 === 0) return { estimatedValue: String(min / 60), estimatedUnit: "hour" }
  return { estimatedValue: String(min), estimatedUnit: "min" }
}

type SortField = "name" | "category" | "estimatedMinutes" | "requiresDuo" | "isActive"

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  sortCol("name", "시험항목명"),
  sortCol("category", "대분류"),
  sortCol("estimatedMinutes", "예상시간"),
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
  const [stats, setStats] = useState<TestItemStats | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)

  useEffect(() => {
    queueMicrotask(() => {
      void loadItems()
      void loadStats()
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

  /**
   * 실적 통계는 **부가 정보**다. 실패해도 목록 화면은 그대로 써야 하므로 에러를
   * 화면에 띄우지 않고 조용히 넘어간다(라우트도 같은 이유로 200 을 돌려준다).
   */
  async function loadStats() {
    try {
      const res = await fetch("/api/test-items/stats")
      if (!res.ok) return
      setStats((await res.json()) as TestItemStats)
    } catch {
      /* 통계 없이도 화면은 동작한다 */
    }
  }

  /** 마스터 항목 id → 실적. 수정 드로어와 제안 목록이 같은 근거를 본다. */
  const actualById = useMemo(() => {
    const map = new Map<string, TestItemActual>()
    for (const a of stats?.actuals ?? []) if (a.testItemId) map.set(a.testItemId, a)
    return map
  }, [stats])

  /**
   * 아직 반영하지 않은 제안만 남긴다. 적용 직후에는 서버를 다시 부르지 않고
   * rows 의 최신 값으로 걸러 — 같은 제안이 목록에 남아 두 번 눌리는 것을 막는다.
   */
  const pendingSuggestions = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    return (stats?.suggestions ?? []).filter((sug) => {
      const row = byId.get(sug.testItemId)
      if (!row) return false
      if (row.isTimeboxed) return false
      return row.estimatedMinutes !== sug.suggestedMinutes
    })
  }, [stats, rows])

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

      if (sortField === "estimatedMinutes") {
        const ah = a.estimatedMinutes ?? -1
        const bh = b.estimatedMinutes ?? -1
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
    const estimated = rows.filter((row) => row.estimatedMinutes != null)
    const avgMinutes = estimated.length
      ? Math.round(
          estimated.reduce((sum, row) => sum + (row.estimatedMinutes ?? 0), 0) /
            estimated.length,
        )
      : 0
    return { active, duo, avgMinutes }
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
      // 60분 단위로 떨어지면 시간으로 보여준다 — 2시간짜리를 "120분" 으로 보여주면
      // 읽는 사람이 매번 나눗셈을 한다.
      ...splitMinutes(row.estimatedMinutes),
      estimateSource: row.estimateSource,
      isTimeboxed: row.isTimeboxed,
      requiresDuo: row.requiresDuo,
      isActive: row.isActive,
    })
    setError(null)
    setDialogOpen(true)
  }

  /** 폼의 (값, 단위) → 분. 빈 값이면 null. */
  function formMinutes(value: string, unit: "min" | "hour"): number | null {
    const raw = value.trim()
    if (raw === "") return null
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return Math.round(n * (unit === "hour" ? 60 : 1))
  }

  /**
   * 예상시간을 손으로 고치면 출처를 '가정'으로 되돌린다.
   *
   * 되돌리지 않으면 실적으로 잡힌 값을 사람이 바꿔 놓고도 배지는 계속 '실적'이라
   * **출처가 거짓말을 한다**. 숨기지 않고 셀렉트를 눈앞에서 바꿔, 저장되는 값과
   * 화면에 보이는 값이 항상 같게 한다. 원래 값으로 되돌아오면 원래 출처도 복원한다.
   */
  function updateEstimate(next: Partial<Pick<FormState, "estimatedValue" | "estimatedUnit">>) {
    setForm((prev) => {
      const merged = { ...prev, ...next }
      if (!editTarget) return merged
      const minutes = formMinutes(merged.estimatedValue, merged.estimatedUnit)
      return {
        ...merged,
        estimateSource:
          minutes === editTarget.estimatedMinutes ? editTarget.estimateSource : "assumed",
      }
    })
  }

  /**
   * 실적값을 예상시간에 반영한다 — **사람이 눌러야만** 바뀐다.
   *
   * 값만 바꾸고 끝내지 않는다. 출처를 '실적'으로, 표본 수를 근거 건수로 함께 적어야
   * 나중에 "이 4시간은 어디서 나온 값인가" 에 답할 수 있다(GMP 추적성).
   */
  async function applySuggestion(sug: EstimateSuggestion) {
    setApplyingId(sug.testItemId)
    setError(null)
    try {
      await patchItem(sug.testItemId, {
        estimatedMinutes: sug.suggestedMinutes,
        estimateSource: "measured",
        estimateSampleCount: sug.sampleCount,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 처리 중 오류가 발생했습니다.")
    } finally {
      setApplyingId(null)
    }
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

    const raw = form.estimatedValue.trim()
    const estimatedMinutes =
      raw === "" ? null : Math.round(Number(raw) * (form.estimatedUnit === "hour" ? 60 : 1))
    if (estimatedMinutes !== null && (Number.isNaN(estimatedMinutes) || estimatedMinutes <= 0)) {
      setError("예상시간은 0보다 큰 숫자로 입력하세요.")
      return
    }

    setSaving(true)
    try {
      if (editTarget) {
        await patchItem(editTarget.id, {
          name: form.name.trim(),
          category: form.category,
          estimatedMinutes,
          estimateSource: form.estimateSource,
          // 손으로 고친 값에는 실적 근거가 없다. 출처를 '가정'으로 되돌리면 표본 수도
          // 함께 지워야 "가정치인데 실적 12건" 같은 앞뒤 안 맞는 표시가 남지 않는다.
          estimateSampleCount:
            form.estimateSource === "assumed" ? 0 : editTarget.estimateSampleCount,
          isTimeboxed: form.isTimeboxed,
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
            estimatedMinutes,
            isTimeboxed: form.isTimeboxed,
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
      {/* 부제로 화면 이름을 되풀이하지 않는다 — 아래 요약 수치가 이 화면의 사실을 대신 말한다.
          단위도 셋 다 맞춰(건·건·h) 눈이 한 줄로 읽히게 한다. */}
      <PageHeader
        icon={ClipboardList}
        title="시험항목 마스터"
        count={rows.length}
        stats={[
          { label: "활성", value: `${summary.active}건`, tone: "blue" },
          { label: "2인시험", value: `${summary.duo}건` },
          { label: "평균 예상시간", value: formatMinutes(summary.avgMinutes, "—") },
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
            /* 모바일에서는 한 줄을 통째로 쓰고, sm 부터 내용 폭에 맞춘다 */
            className={cn(
              "w-full sm:w-auto sm:min-w-40",
              categoryFilter !== "all" && "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
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
              "w-full sm:w-auto sm:min-w-32",
              statusFilter !== "all" && "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
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
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm break-keep text-destructive">
          {error}
        </div>
      )}

      {/* 실적이 쌓인 항목의 예상시간 조정 제안.
          시스템이 값을 **직접 바꾸지 않는다** — 예상시간은 일정·부하·납기가 모두 올라서
          있는 기준값이라, 몰래 바뀌면 어제와 오늘의 계획이 이유 없이 달라진다.
          제안까지만 만들고 반영은 사람이 근거를 보고 누른다. */}
      {pendingSuggestions.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950">
          <TrendingUp className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
          <p className="min-w-0 flex-1 text-sm break-keep text-blue-900 dark:text-blue-100">
            완료 실적을 반영하면 예상시간이 달라지는 항목이{" "}
            <span className="font-semibold">{pendingSuggestions.length}건</span> 있습니다.
            근거를 확인한 뒤 직접 반영합니다.
          </p>
          <Button size="sm" variant="outline" onClick={() => setSuggestOpen(true)}>
            제안 확인
          </Button>
        </div>
      )}

      {/* 제안할 것이 없는데 측정 실패가 많다면, 문제는 통계가 아니라 **입력**이다.
          시험자가 [시작] 을 누르지 않고 완료만 누르면 소요시간이 0분으로 남는다.
          그 사실을 알려주지 않으면 "실적이 안 쌓인다" 는 결과만 보게 된다. */}
      {pendingSuggestions.length === 0 && stats?.coverage
        && stats.coverage.clearedTotal >= 10
        && stats.coverage.ignoredSamples / stats.coverage.clearedTotal >= 0.3 && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950">
          <Info className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <p className="min-w-0 flex-1 text-sm break-keep text-amber-900 dark:text-amber-100">
            완료 기록 {stats.coverage.clearedTotal}건 중{" "}
            <span className="font-semibold">{stats.coverage.ignoredSamples}건</span>은 소요시간이
            측정되지 않았습니다(시작을 누르지 않고 완료만 누른 경우). 시험자가 항목{" "}
            <span className="font-semibold">[시작]</span>을 눌러야 실적이 쌓이고, 예상시간을
            실측으로 바꿀 수 있습니다.
          </p>
        </div>
      )}

      {/* 모바일 카드 — 바깥이 overflow-hidden 이라 여기서 직접 스크롤을 받아야
          목록이 화면 아래에서 잘리지 않는다. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            /* shrink-0: Card 는 overflow-hidden 이라 세로 스크롤 열 안에서 눌리면 선 하나로 찌부러진다 */
            <Card key={i} className="shrink-0 gap-2 px-3 py-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-14 rounded-md" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
          ))
        ) : sortedData.length === 0 ? (
          <Card className="shrink-0 items-center py-6 text-center text-sm break-keep text-muted-foreground">
            {filterActive ? "조건에 맞는 시험항목이 없습니다." : "데이터가 없습니다."}
          </Card>
        ) : (
          sortedData.map((row) => (
            <Card
              key={row.id}
              className="shrink-0 cursor-pointer gap-0 px-3 py-3"
              onClick={() => openEditDialog(row)}
            >
              {/* 항목명이 행의 주 값이다 — 표와 같은 font-medium 으로 맞추고 분류·상태는 그 아래 보조로 내린다 */}
              <div className="min-w-0 text-sm font-medium break-keep text-foreground">
                {row.name}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <CategoryBadge category={row.category} />
                <Tag color={row.isActive ? "blue" : "mono"}>
                  {row.isActive ? "활성" : "비활성"}
                </Tag>
                {/* 예상시간 옆에는 자리가 없어 분류·상태와 같은 줄에 둔다.
                    숫자만 보여주면 그 값이 감인지 실측인지 구분이 사라진다. */}
                <EstimateSourceBadge
                  source={row.estimateSource}
                  sampleCount={row.estimateSampleCount}
                  hasEstimate={row.estimatedMinutes != null}
                />
                {row.isTimeboxed && <TimeboxedBadge />}
              </div>

              {/* 모바일 카드는 값 네 개(항목명·분류·상태·수치)까지만 — 2열 그리드로 나누는 대신
                  한 줄에 이어 붙여 320px 에서도 접히지 않게 한다 */}
              <div className="mt-2 border-t pt-2 text-xs leading-normal break-keep text-muted-foreground">
                예상시간{" "}
                <span className="tabular-nums text-foreground">
                  {formatMinutes(row.estimatedMinutes, "—")}
                </span>
                <span className="px-1 text-border">·</span>
                2인시험 <span className="text-foreground">{row.requiresDuo ? "필요" : "미사용"}</span>
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
                  <TableCell className="px-3 py-2">
                    {/* 숫자와 출처는 한 몸이다. 떨어뜨려 놓으면 "4시간" 만 읽고 그 값이
                        가정치라는 사실은 놓치게 된다. CellStack 을 쓰지 않는 이유는
                        배지가 truncate 에 잘리기 때문이다. */}
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatMinutes(row.estimatedMinutes, "—")}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        <EstimateSourceBadge
                          source={row.estimateSource}
                          sampleCount={row.estimateSampleCount}
                          hasEstimate={row.estimatedMinutes != null}
                        />
                        {row.isTimeboxed && <TimeboxedBadge />}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <CellStack
                      primary={(
                        <Tag color={row.requiresDuo ? "yellow" : "mono"}>
                          {row.requiresDuo ? "2인 사용" : "2인 미사용"}
                        </Tag>
                      )}
                      secondary={(
                        <Tag color={row.isActive ? "blue" : "mono"}>
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
                    <label htmlFor={`${uid}-est`} className="text-xs font-medium text-muted-foreground">
                      예상시간
                    </label>
                    {/* 예전에는 시간(h) 정수 입력이라 **1시간 미만을 넣을 수 없었다.**
                        성상 확인처럼 10분이면 끝나는 항목을 1시간으로 적으면 부하와 일정이
                        통째로 부풀려진다. 숫자와 단위를 나눠 받아 10분도 2시간도 자연스럽게
                        적게 한다. 저장은 분 하나로 통일한다(0045). */}
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={`${uid}-est`}
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={form.estimatedValue}
                        onChange={(e) => updateEstimate({ estimatedValue: e.target.value })}
                        placeholder={form.estimatedUnit === "hour" ? "예) 2" : "예) 10"}
                        className="flex-1"
                      />
                      <Select
                        value={form.estimatedUnit}
                        onValueChange={(v) => updateEstimate({ estimatedUnit: v as "min" | "hour" })}
                      >
                        <SelectTrigger className="!h-9 w-24 px-3"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="min">분</SelectItem>
                          <SelectItem value="hour">시간</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {/* 입력한 값이 실제로 몇 분으로 저장되는지 바로 보여준다 */}
                    {form.estimatedValue.trim() !== "" && Number(form.estimatedValue) > 0 && (() => {
                      const mins = Math.round(Number(form.estimatedValue) * (form.estimatedUnit === "hour" ? 60 : 1))
                      return (
                        <span className={cn(
                          "text-xs leading-normal break-keep",
                          mins > 1440 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                        )}>
                          = {formatMinutes(mins)} 로 저장됩니다
                          {/* 막지는 않는다 — MT(52시간)처럼 배양·방치 대기가 섞인 항목이 실제로 있다.
                              다만 사람이 붙어 있는 시간으로 오해하기 쉬워 한 줄 덧붙인다. */}
                          {mins > 1440 && " · 하루를 넘습니다. 대기시간이 섞였는지 확인해 주세요"}
                        </span>
                      )
                    })()}
                  </div>

                  {/* 공수 출처 — 같은 "4시간" 이라도 근거의 강도가 다르다(0046).
                      일정·부하·납기가 전부 이 값 위에 서 있어서, 얼마나 믿을 값인지가
                      값 자체만큼 중요하다. GMP 로도 "이 소요시간의 근거는 무엇인가" 에
                      답할 수 있어야 한다. */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${uid}-src`} className="text-xs font-medium text-muted-foreground">
                      공수 출처
                    </label>
                    <Select
                      value={form.estimateSource}
                      onValueChange={(v) =>
                        setForm((prev) => ({ ...prev, estimateSource: v as EstimateSource }))
                      }
                      disabled={form.estimatedValue.trim() === ""}
                    >
                      <SelectTrigger id={`${uid}-src`} className="!h-9 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs leading-normal break-keep text-muted-foreground">
                      {form.estimatedValue.trim() === ""
                        ? "예상시간을 입력하면 출처를 지정할 수 있습니다."
                        : estimateSourceHelp(form.estimateSource)}
                    </span>
                  </div>
                </div>

                {/* 실적 근거 — 숫자만 제안하고 끝내지 않는다. 표본이 몇 건인지, 흩어짐이
                    어느 정도인지, 측정 실패로 몇 건을 버렸는지를 함께 보여줘야 사람이
                    "이 값을 믿을지" 를 판단할 수 있다. 판단 없는 반영은 자동 덮어쓰기와 같다. */}
                {editTarget && (() => {
                  const actual = actualById.get(editTarget.id)
                  if (!actual || (actual.sampleCount === 0 && actual.ignoredCount === 0)) return null
                  const sug = pendingSuggestions.find((x) => x.testItemId === editTarget.id)
                  return (
                    <div className="mt-3 rounded-md border border-dashed bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">완료 실적</span>
                        {sug && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={applyingId === editTarget.id}
                            onClick={() => {
                              // 폼에도 즉시 반영해, 저장을 누르지 않고 닫아도 화면과 값이 어긋나지 않는다.
                              setForm((prev) => ({
                                ...prev,
                                ...splitMinutes(sug.suggestedMinutes),
                                estimateSource: "measured",
                              }))
                              void applySuggestion(sug)
                            }}
                          >
                            <TrendingUp />
                            {applyingId === editTarget.id
                              ? "반영 중..."
                              : `실적값 ${formatMinutes(sug.suggestedMinutes)} 반영`}
                          </Button>
                        )}
                      </div>
                      {actual.sampleCount > 0 ? (
                        <p className="mt-1.5 text-xs leading-normal break-keep text-muted-foreground">
                          유효 표본 <span className="font-medium text-foreground">{actual.sampleCount}건</span>
                          {" · 중앙값 "}
                          <span className="font-medium text-foreground">{formatMinutes(actual.medianMinutes)}</span>
                          {" · 범위 "}
                          {formatMinutes(actual.minMinutes)}~{formatMinutes(actual.maxMinutes)}
                          {actual.ignoredCount > 0 && ` · 측정 실패 ${actual.ignoredCount}건 제외`}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs leading-normal break-keep text-muted-foreground">
                          완료 기록 {actual.ignoredCount}건이 있지만 소요시간이 측정되지 않았습니다
                          (시작을 누르지 않고 완료만 누른 경우). 반영할 실적이 없습니다.
                        </p>
                      )}
                      {editTarget.isTimeboxed && actual.sampleCount > 0 && (
                        <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
                          시간박스 항목이라 조정 제안은 만들지 않습니다 — 실적은 참고용입니다.
                        </p>
                      )}
                    </div>
                  )
                })()}
              </section>

              {/* 체크박스 두 개는 나란히 둔다 — '활성 상태'가 예상시간 입력 사이에 끼어
                  라벨과 입력이 갈라져 있었다. 테두리 칸을 하나씩 두르는 대신 실선으로 나눈다. */}
              <section className="rounded-md border bg-card p-3 sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">시험 설정</h3>
                </div>
                <div className="divide-y">
                  <label className="flex cursor-pointer items-center gap-2 py-2.5 text-sm font-medium text-foreground">
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
                  {/* 시간박스 — MT(Method Transfer) 처럼 **정확한 공수가 존재하지 않는** 항목.
                      목표가 "평균 얼마"가 아니라 "할당한 시간 안에 끝낸다" 라서, 실적을 모아
                      평균을 내도 값이 수렴하지 않고 다른 항목의 통계까지 오염시킨다.
                      초과도 성과 저하가 아니라 재계획 신호로 읽어야 한다.
                      부하 집계에서는 그대로 센다 — 시간은 실제로 쓰이기 때문이다. */}
                  <label className="flex cursor-pointer items-start gap-2 py-2.5 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={form.isTimeboxed}
                      onChange={(e) => setForm((prev) => ({ ...prev, isTimeboxed: e.target.checked }))}
                      className="cb-custom mt-0.5"
                    />
                    <span className="min-w-0">
                      시간박스 항목
                      <span className="mt-0.5 block text-xs leading-normal font-normal break-keep text-muted-foreground">
                        정확한 공수를 낼 수 없는 항목(MT 등). 실적 평균이 수렴하지 않아
                        조정 제안에서 제외하고, 초과는 성과가 아니라 재계획 신호로 읽습니다.
                        부하 집계에는 그대로 포함합니다.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 py-2.5 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                      className="cb-custom"
                    />
                    활성 상태
                  </label>
                </div>
              </section>

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm break-keep text-destructive">
                  {error}
                </div>
              )}
          </div>
      </ManagementDrawer>

      {/* 실적 기반 예상시간 조정 제안.
          한 건씩 근거를 보고 누르게 한다 — '전체 적용' 버튼을 두면 사람이 검토하라고
          만든 단계가 그대로 자동 덮어쓰기가 된다. */}
      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>예상시간 조정 제안</DialogTitle>
            <DialogDescription className="break-keep">
              완료된 시험의 실제 소요시간에서 계산한 값입니다. 대표값은 평균이 아니라
              중앙값을 씁니다 — 배양·방치가 섞인 한 건에 평균이 끌려가기 때문입니다.
              값은 눌러야 반영되며, 반영하면 출처가 「실적」으로 기록됩니다.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-2">
            {stats?.coverage && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-normal break-keep text-muted-foreground">
                완료 기록 {stats.coverage.clearedTotal}건 중 유효 표본{" "}
                <span className="font-medium text-foreground">{stats.coverage.validSamples}건</span>
                {stats.coverage.ignoredSamples > 0
                  && ` · 소요시간이 측정되지 않은 ${stats.coverage.ignoredSamples}건은 제외했습니다`}
                {stats.coverage.timeboxedSkipped > 0
                  && ` · 시간박스 ${stats.coverage.timeboxedSkipped}건은 제안 대상이 아닙니다`}
              </p>
            )}

            {pendingSuggestions.length === 0 ? (
              <p className="py-8 text-center text-sm break-keep text-muted-foreground">
                반영할 제안이 없습니다.
              </p>
            ) : (
              pendingSuggestions.map((sug) => {
                const actual = actualById.get(sug.testItemId)
                return (
                  <div key={sug.testItemId} className="rounded-md border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-keep text-foreground">{sug.name}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm tabular-nums">
                          <span className="text-muted-foreground">
                            {formatMinutes(sug.currentMinutes, "미설정")}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-semibold text-foreground">
                            {formatMinutes(sug.suggestedMinutes)}
                          </span>
                          {sug.diffRatio != null && (
                            <Tag color={sug.direction === "up" ? "red" : "green"}>
                              {sug.diffRatio > 0 ? "+" : ""}
                              {Math.round(sug.diffRatio * 100)}%
                            </Tag>
                          )}
                        </p>
                        {/* 근거를 함께 보여준다. 범위가 한 점에 몰려 있으면(예: 430~430)
                            같은 작업을 한꺼번에 체크한 흔적일 수 있어, 사람이 그것을
                            보고 반영을 미룰 수 있어야 한다. */}
                        {actual && (
                          <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
                            표본 {actual.sampleCount}건 · 중앙값 {formatMinutes(actual.medianMinutes)}
                            {" · 범위 "}
                            {formatMinutes(actual.minMinutes)}~{formatMinutes(actual.maxMinutes)}
                            {actual.ignoredCount > 0 && ` · 측정 실패 ${actual.ignoredCount}건 제외`}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={applyingId === sug.testItemId}
                        onClick={() => void applySuggestion(sug)}
                      >
                        {applyingId === sug.testItemId ? "반영 중..." : "반영"}
                      </Button>
                    </div>
                  </div>
                )
              })
            )}

            {error && suggestOpen && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm break-keep text-destructive">
                {error}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestOpen(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>시험항목 삭제</DialogTitle>
            <DialogDescription className="break-keep">
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
