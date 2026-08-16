"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Grid2x2,
  Lock,
  Save,
  Trash2,
  Users,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { SortColumnHeader, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import { StatusFilterTabs, type StatusFilterValue } from "@frontend/components/ui/status-filter-tabs"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@frontend/components/ui/sheet"
import { Input } from "@frontend/components/ui/input"
import { TesterAvatar, primeTesterProfileCache } from "@frontend/lib/tester-profiles"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"

interface TesterRow {
  id: string
  employeeNo: string
  name: string
  avatarUrl?: string | null
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
  userId: string | null
  username: string | null
  customerNo: number | null
}

interface CapabilityRow {
  id: string
  code: string
  name: string
  sortOrder: number
}

type ProficiencyLevel = "Y" | "N" | "X" | "O"

interface MatrixRow {
  testerId: string
  capabilityId: string
  proficiencyLevel: ProficiencyLevel
}

const LEVEL_CYCLE: ProficiencyLevel[] = ["X", "Y", "O", "N"]

const LEVEL_STYLE: Record<ProficiencyLevel, string> = {
  O: "border-blue-300 bg-blue-700 text-white",
  Y: "border-emerald-300 bg-emerald-700 text-white",
  N: "border-rose-300 bg-rose-700 text-white",
  X: "border bg-muted text-muted-foreground",
}

const LEVEL_LABEL: Record<ProficiencyLevel, string> = {
  O: "우수",
  Y: "가능",
  N: "불가",
  X: "-",
}

type TabId = "testers" | "capability"

type SortField = "name" | "employeeNo" | "canSolo" | "canDuo" | "isActive"

const TESTER_SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: "tester",
    label: "시험자",
    fields: [
      { id: "name", label: "이름" },
      { id: "employeeNo", label: "사번" },
    ],
  },
  {
    key: "capability",
    label: "시험가능",
    fields: [
      { id: "canSolo", label: "단독" },
      { id: "canDuo", label: "2인" },
    ],
  },
  {
    key: "status",
    label: "상태",
    fields: [{ id: "isActive", label: "활성" }],
  },
]

function StatusLine({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", color)} />
      <span className="min-w-0 truncate text-xs text-foreground">{label}</span>
    </div>
  )
}

export default function TestersPage() {
  const [activeTab, setActiveTab] = useState<TabId>("testers")
  const [testers, setTesters] = useState<TesterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([])
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [capLoading, setCapLoading] = useState(false)
  const [capLoaded, setCapLoaded] = useState(false)
  const [savingCell, setSavingCell] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selected, setSelected] = useState<TesterRow | null>(null)
  const [form, setForm] = useState({
    employeeNo: "",
    name: "",
    canSolo: true,
    canDuo: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [sortField, setSortField] = useState<SortField>("employeeNo")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all")

  useEffect(() => {
    void fetchTesters()
  }, [])

  async function fetchTesters() {
    setLoading(true)
    try {
      const res = await fetch("/api/testers")
      const json = (await res.json()) as { rows?: TesterRow[] }
      const rows = json.rows ?? []
      setTesters(rows)
      primeTesterProfileCache(rows)
    } finally {
      setLoading(false)
    }
  }

  const fetchCapabilities = useCallback(async () => {
    if (capLoaded) return
    setCapLoading(true)
    try {
      const res = await fetch("/api/tester-capabilities")
      const json = (await res.json()) as {
        capabilities?: CapabilityRow[]
        matrix?: MatrixRow[]
      }
      setCapabilities(json.capabilities ?? [])
      setMatrix(json.matrix ?? [])
      setCapLoaded(true)
    } finally {
      setCapLoading(false)
    }
  }, [capLoaded])

  useEffect(() => {
    if (activeTab === "capability") void fetchCapabilities()
  }, [activeTab, fetchCapabilities])

  function openAdd() {
    setForm({ employeeNo: "", name: "", canSolo: true, canDuo: false })
    setError("")
    setAddOpen(true)
  }

  function openEdit(row: TesterRow) {
    setSelected(row)
    setForm({
      employeeNo: row.employeeNo,
      name: row.name,
      canSolo: row.canSolo,
      canDuo: row.canDuo,
    })
    setError("")
    setEditOpen(true)
  }

  function openDelete(row: TesterRow) {
    setSelected(row)
    setError("")
    setDeleteOpen(true)
  }

  async function handleAdd() {
    if (!form.employeeNo.trim() || !form.name.trim()) {
      setError("사번과 이름을 입력하세요.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const json = (await res.json()) as { error?: string; row?: TesterRow }
      if (!res.ok) {
        setError(json.error ?? "저장 실패")
        return
      }
      setTesters((prev) => [...prev, json.row as TesterRow])
      setAddOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!selected) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/testers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, canSolo: form.canSolo, canDuo: form.canDuo }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? "저장 실패")
        return
      }
      setTesters((prev) =>
        prev.map((tester) =>
          tester.id === selected.id ? { ...tester, ...form } : tester
        )
      )
      setEditOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch("/api/testers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id }),
      })
      if (res.ok) {
        setTesters((prev) => prev.filter((tester) => tester.id !== selected.id))
        setMatrix((prev) => prev.filter((row) => row.testerId !== selected.id))
        setDeleteOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: TesterRow) {
    const next = !row.isActive
    setTesters((prev) =>
      prev.map((tester) =>
        tester.id === row.id ? { ...tester, isActive: next } : tester
      )
    )
    await fetch("/api/testers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, isActive: next }),
    })
  }

  function getLevel(testerId: string, capabilityId: string): ProficiencyLevel {
    return (
      matrix.find(
        (row) => row.testerId === testerId && row.capabilityId === capabilityId
      )?.proficiencyLevel ?? "X"
    )
  }

  async function cycleLevel(tester: TesterRow, capability: CapabilityRow) {
    const current = getLevel(tester.id, capability.id)
    const next =
      LEVEL_CYCLE[(LEVEL_CYCLE.indexOf(current) + 1) % LEVEL_CYCLE.length]
    const key = `${tester.id}_${capability.id}`
    setSavingCell(key)

    setMatrix((prev) => {
      const exists = prev.find(
        (row) =>
          row.testerId === tester.id && row.capabilityId === capability.id
      )
      if (exists) {
        return prev.map((row) =>
          row.testerId === tester.id && row.capabilityId === capability.id
            ? { ...row, proficiencyLevel: next }
            : row
        )
      }
      return [
        ...prev,
        {
          testerId: tester.id,
          capabilityId: capability.id,
          proficiencyLevel: next,
        },
      ]
    })

    try {
      await fetch("/api/tester-capabilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testerId: tester.id,
          capabilityId: capability.id,
          proficiencyLevel: next,
        }),
      })
    } finally {
      setSavingCell(null)
    }
  }

  const sortedTesters = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1
    // 활성 시험자를 항상 위로 올린다. 선택한 정렬은 활성/비활성 그룹 안에서 적용된다.
    const activeRank = (t: TesterRow) => (t.isActive ? 0 : 1)
    const byName = (a: TesterRow, b: TesterRow) => a.name.localeCompare(b.name, "ko")

    return [...testers].sort((a, b) => {
      const groupDiff = activeRank(a) - activeRank(b)
      // 상태(활성) 컬럼 정렬만 방향으로 그룹 순서를 뒤집는다 (오름차순 = 활성 먼저)
      if (sortField === "isActive") {
        return groupDiff !== 0 ? groupDiff * mul : byName(a, b)
      }
      if (groupDiff !== 0) return groupDiff

      if (sortField === "canSolo" || sortField === "canDuo") {
        const diff = (Number(a[sortField]) - Number(b[sortField])) * mul
        return diff !== 0 ? diff : byName(a, b)
      }
      const diff = a[sortField].localeCompare(b[sortField], "ko") * mul
      return diff !== 0 ? diff : byName(a, b)
    })
  }, [testers, sortDir, sortField])

  const activeTesters = useMemo(
    () => sortedTesters.filter((tester) => tester.isActive),
    [sortedTesters]
  )

  const filteredTesters = useMemo(() => {
    if (statusFilter === "all") return sortedTesters
    return sortedTesters.filter((tester) =>
      statusFilter === "active" ? tester.isActive : !tester.isActive
    )
  }, [sortedTesters, statusFilter])

  const summary = useMemo(() => {
    const active = testers.filter((tester) => tester.isActive).length
    const solo = testers.filter(
      (tester) => tester.isActive && tester.canSolo
    ).length
    const duo = testers.filter(
      (tester) => tester.isActive && tester.canDuo
    ).length
    return { active, solo, duo }
  }, [testers])

  const pickSort = useCallback((field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            {activeTab === "testers" ? (
              <Users className="size-5 text-muted-foreground" />
            ) : (
              <Grid2x2 className="size-5 text-muted-foreground" />
            )}
            <h1 className="text-xl font-semibold text-foreground">
              {activeTab === "testers" ? "시험자 관리" : "시험자 역량"}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {activeTab === "testers"
              ? "시험자 정보와 활성 상태를 관리합니다."
              : "활성 시험자의 역량 매트릭스를 관리합니다."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tab switcher */}
          <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground">
            {[
              { id: "testers", label: "시험자 관리" },
              { id: "capability", label: "시험자 역량" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabId)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-card text-foreground shadow-sm"
                    : "hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "testers" && (
            <p className="ml-auto text-xs text-muted-foreground">
              시험자는 <span className="font-medium text-foreground">사용자 관리</span>에서 역할을 &apos;시험자&apos;로 설정하면 자동 등록됩니다.
            </p>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Card className="gap-0.5 border-l-4 border-l-primary px-3 py-2">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            활성 시험자
          </span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {summary.active}
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
              / {testers.length}명
            </span>
          </span>
        </Card>
        <Card className="gap-0.5 border-l-4 border-l-indigo-500 px-3 py-2">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            단독 가능
          </span>
          <span className="text-lg font-semibold tabular-nums text-indigo-600">
            {summary.solo}
          </span>
        </Card>
        <Card className="gap-0.5 border-l-4 border-l-amber-500 px-3 py-2">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            2인 가능
          </span>
          <span className="text-lg font-semibold tabular-nums text-amber-600">
            {summary.duo}
          </span>
        </Card>
      </div>

      {activeTab === "testers" && (
        <StatusFilterTabs
          value={statusFilter}
          onChange={setStatusFilter}
          counts={{ all: testers.length, active: summary.active, inactive: testers.length - summary.active }}
          activeLabel="활성 시험자"
          inactiveLabel="비활성 시험자"
          className="shrink-0"
        />
      )}

      {activeTab === "testers" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Mobile cards */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:hidden">
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
            ) : filteredTesters.length === 0 ? (
              <Card className="items-center py-6 text-center text-sm text-muted-foreground">
                {statusFilter === "all" ? "등록된 시험자가 없습니다." : "조건에 맞는 시험자가 없습니다."}
              </Card>
            ) : (
              filteredTesters.map((tester, idx) => (
                <Card
                  key={tester.id}
                  className="cursor-pointer gap-0 px-3 py-3 transition-colors hover:bg-muted/30"
                  onClick={() => openEdit(tester)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {tester.employeeNo}
                        </span>
                        <Badge variant="outline" className="gap-1.5 text-[10px]">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              tester.isActive ? "bg-indigo-500" : "bg-muted-foreground"
                            )}
                          />
                          {tester.isActive ? "활성" : "비활성"}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <TesterAvatar testerId={tester.id} name={tester.name} avatarUrl={tester.avatarUrl} size="sm" />
                        <span className="text-sm font-semibold text-foreground">{tester.name}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => { e.stopPropagation(); openDelete(tester) }}
                      title="삭제"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  {/* 가능한 항목만 노출 — '불가'는 표시하지 않는다 */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                    {tester.canSolo && (
                      <Badge variant="outline" className="gap-1.5 border-indigo-200 text-[10px] text-indigo-700">
                        <span className="size-1.5 rounded-full bg-indigo-500" />
                        단독 가능
                      </Badge>
                    )}
                    {tester.canDuo && (
                      <Badge variant="outline" className="gap-1.5 border-amber-200 text-[10px] text-amber-700">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        2인 가능
                      </Badge>
                    )}
                    {!tester.canSolo && !tester.canDuo && (
                      <span className="text-[10px] text-muted-foreground/50">—</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); void toggleActive(tester) }}
                      className="ml-auto rounded-md border border-input bg-background px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-muted/50"
                    >
                      상태 전환
                    </button>
                  </div>
                </Card>
              ))
            )}
          </div>

          {/* Desktop table */}
          <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
            <Table className="w-full">
              <colgroup>
                <col className="w-[8%]" />
                <col className="w-[42%]" />
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground">순번</TableHead>
                  {TESTER_SORT_COLUMNS.map((col) => (
                    <TableHead key={col.key} className="px-3">
                      <SortColumnHeader
                        col={col}
                        sortField={sortField}
                        sortDir={sortDir}
                        onPick={pickSort}
                      />
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
                        <TableCell className="px-3 py-2"><Skeleton className="h-4 w-6" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-28" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-20" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-5 w-12 rounded-full" /></TableCell>
                        <TableCell className="px-1 py-2"><Skeleton className="mx-auto h-6 w-6" /></TableCell>
                      </TableRow>
                    ))
                  : filteredTesters.map((tester, idx) => (
                    <TableRow
                      key={tester.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => openEdit(tester)}
                    >
                      <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        {/* 아바타는 primary 안에 둔다 — CellStack 루트는 @container라 고유 폭이 0이라
                            flex 형제로 두면 폭이 접혀 이름이 잘린다. */}
                        <CellStack
                          primary={
                            <span className="flex min-w-0 items-center gap-2">
                              <TesterAvatar testerId={tester.id} name={tester.name} avatarUrl={tester.avatarUrl} size="sm" />
                              <span className="truncate">{tester.name}</span>
                            </span>
                          }
                          secondary={tester.employeeNo}
                          secondaryLabel="사번"
                          primaryClass="font-medium text-foreground"
                          title={`${tester.name} ${tester.employeeNo}`}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <CellStack
                          primary={tester.canSolo ? <StatusLine color="bg-indigo-500" label="단독 가능" /> : "—"}
                          secondary={tester.canDuo ? <StatusLine color="bg-amber-500" label="2인 가능" /> : undefined}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); void toggleActive(tester) }}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted/50",
                            tester.isActive
                              ? "border-indigo-200 text-indigo-700"
                              : "border-input text-muted-foreground"
                          )}
                        >
                          {tester.isActive ? "활성" : "비활성"}
                        </button>
                      </TableCell>
                      <TableCell className="px-1 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => { e.stopPropagation(); openDelete(tester) }}
                          title="삭제"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                {!loading && filteredTesters.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={5}
                      className="py-16 text-center text-sm text-muted-foreground"
                    >
                      {statusFilter === "all" ? "등록된 시험자가 없습니다." : "조건에 맞는 시험자가 없습니다."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {activeTab === "capability" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Legend */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">범례</span>
            {(["O", "Y", "N", "X"] as ProficiencyLevel[]).map((level) => (
              <span key={level} className="flex items-center gap-1">
                <span
                  className={cn(
                    "inline-flex h-5 w-8 items-center justify-center rounded border text-[11px] font-bold",
                    LEVEL_STYLE[level]
                  )}
                >
                  {level}
                </span>
                <span>{LEVEL_LABEL[level]}</span>
              </span>
            ))}
            <span className="text-muted-foreground">셀 클릭으로 순환 변경</span>
          </div>

          {capLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="gap-2 px-3 py-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </Card>
              ))}
            </div>
          ) : (
            <>
              {/* Mobile capability cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {activeTesters.length === 0 ? (
                  <Card className="items-center py-6 text-center text-sm text-muted-foreground">
                    활성 시험자가 없습니다.
                  </Card>
                ) : (
                  activeTesters.map((tester) => (
                    <Card key={tester.id} className="gap-0 px-3 py-3">
                      <div className="mb-2 flex items-center gap-2 border-b pb-2">
                        <TesterAvatar testerId={tester.id} name={tester.name} avatarUrl={tester.avatarUrl} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {tester.name}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {tester.employeeNo}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
                        {capabilities.map((capability) => {
                          const level = getLevel(tester.id, capability.id)
                          const key = `${tester.id}_${capability.id}`
                          const isSaving = savingCell === key
                          return (
                            <button
                              key={capability.id}
                              onClick={() => void cycleLevel(tester, capability)}
                              disabled={isSaving}
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                                isSaving
                                  ? "cursor-wait opacity-50"
                                  : "hover:border-ring hover:bg-muted/50"
                              )}
                            >
                              <span className="flex-1 truncate text-[11px] font-medium text-foreground">
                                {capability.name}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex h-6 w-8 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
                                  LEVEL_STYLE[level]
                                )}
                              >
                                {level}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </Card>
                  ))
                )}
              </div>

              {/* Desktop capability matrix table */}
              <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
                <Table layout="wide" className="min-w-[700px] border-collapse text-xs">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="sticky top-0 left-0 z-20 min-w-[100px] border-r px-3 text-muted-foreground">
                        이름
                      </TableHead>
                      <TableHead className="sticky top-0 left-[100px] z-20 w-24 border-r px-3 text-center text-muted-foreground">
                        사번
                      </TableHead>
                      {capabilities.map((capability) => (
                        <TableHead
                          key={capability.id}
                          className="sticky top-0 z-10 min-w-[68px] border-r px-2 text-center text-muted-foreground"
                        >
                          {capability.name}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeTesters.map((tester) => (
                      <TableRow key={tester.id}>
                        <TableCell className="sticky left-0 z-10 border-r bg-card px-3 py-2.5 font-medium text-foreground">
                          <div className="flex min-w-0 items-center gap-2">
                            <TesterAvatar testerId={tester.id} name={tester.name} avatarUrl={tester.avatarUrl} size="xs" />
                            <span className="truncate">{tester.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="sticky left-[100px] z-10 border-r px-3 py-2.5 text-center font-mono text-muted-foreground bg-card">
                          {tester.employeeNo}
                        </TableCell>
                        {capabilities.map((capability) => {
                          const level = getLevel(tester.id, capability.id)
                          const key = `${tester.id}_${capability.id}`
                          const isSaving = savingCell === key
                          return (
                            <TableCell
                              key={capability.id}
                              className="border-r p-1.5 text-center"
                            >
                              <button
                                onClick={() => void cycleLevel(tester, capability)}
                                disabled={isSaving}
                                className={cn(
                                  "inline-flex h-7 w-11 items-center justify-center rounded border text-[11px] font-bold transition-transform",
                                  isSaving ? "cursor-wait opacity-50" : "hover:scale-105",
                                  LEVEL_STYLE[level]
                                )}
                                title={`${tester.name} / ${capability.name}: ${LEVEL_LABEL[level]}`}
                              >
                                {level}
                              </button>
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                    {activeTesters.length === 0 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={capabilities.length + 2}
                          className="py-16 text-center text-sm text-muted-foreground"
                        >
                          활성 시험자가 없습니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>시험자 추가</DialogTitle>
            <DialogDescription>
              시험자 기본 정보와 시험 가능 범위를 등록합니다.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
              <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium tracking-wide text-foreground">
                      사번 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="예: 16242"
                      value={form.employeeNo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          employeeNo: e.target.value,
                        }))
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      사번이 로그인 ID로 자동 계정 생성됩니다 (기본 비밀번호 qc1234).
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium tracking-wide text-foreground">
                      이름 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      placeholder="홍길동"
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">시험 가능 범위</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={form.canSolo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          canSolo: e.target.checked,
                        }))
                      }
                      className="cb-custom"
                    />
                    단독 시험 가능
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={form.canDuo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          canDuo: e.target.checked,
                        }))
                      }
                      className="cb-custom"
                    />
                    2인 시험 가능
                  </label>
                </div>
              </section>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
            >
              취소
            </Button>
            <Button
              onClick={() => void handleAdd()}
              disabled={saving}
            >
              <Save />
              {saving ? "저장 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <TesterAvatar testerId={selected?.id} name={selected?.name} avatarUrl={selected?.avatarUrl} size="sm" />
              시험자 수정
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              시험 가능 범위를 수정합니다.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-5 py-4">
            <div className="grid gap-4">
              {/* 기본 정보 — 읽기 전용 */}
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">기본 정보</h3>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
                    <Lock size={13} className="shrink-0 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">사번</span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {selected?.employeeNo ?? '-'}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">변경 불가</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
                    <Lock size={13} className="shrink-0 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">이름</span>
                    <span className="text-sm font-semibold text-foreground">
                      {selected?.name ?? '-'}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">사용자 관리에서 변경</span>
                  </div>
                </div>
              </section>

              {/* 시험 가능 범위 */}
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">시험 가능 범위</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={form.canSolo}
                      onChange={(e) => setForm((prev) => ({ ...prev, canSolo: e.target.checked }))}
                      className="cb-custom"
                    />
                    단독 시험 가능
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={form.canDuo}
                      onChange={(e) => setForm((prev) => ({ ...prev, canDuo: e.target.checked }))}
                      className="cb-custom"
                    />
                    2인 시험 가능
                  </label>
                </div>
              </section>

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

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>시험자 삭제</DialogTitle>
            <DialogDescription>
              역량 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-sm font-medium">{selected?.name}</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {selected?.employeeNo}
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
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
