"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Grid2x2,
  Lock,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Tag } from "@frontend/components/ui/tag"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { SortColumnHeader, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import { StatusFilterTabs, type StatusFilterValue } from "@frontend/components/ui/status-filter-tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { Input } from "@frontend/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import { TesterAvatar, primeTesterProfileCache } from "@frontend/lib/tester-profiles"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"
import {
  QualificationEditDrawer, type QualEditTarget,
} from "@frontend/components/qualification/qualification-edit-drawer"
import { QualificationItemsPanel } from "@frontend/components/qualification/qualification-items-panel"
import { QualificationMatrix } from "@frontend/components/qualification/qualification-matrix"
import { TesterQualificationDrawer } from "@frontend/components/qualification/tester-qualification-drawer"
import { useQualificationData } from "@frontend/components/qualification/use-qualification-data"
import {
  STATUS_DOT_STYLE, type QualItem, type QualTester, type TesterQual,
} from "@frontend/components/qualification/types"
import {
  EXPIRING_SOON_DAYS, QUALIFICATION_ROLES, QUALIFICATION_STATUS_LABEL,
} from "@shared/qualification"

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

type TabId = "testers" | "capability" | "qualification" | "qual-items"

const TAB_ORDER: TabId[] = ["testers", "capability", "qualification", "qual-items"]

/** 탭별 머리말 — 아이콘·제목·설명을 한 곳에서 정의해 탭이 늘어도 분기문이 늘지 않게 한다. */
const TAB_META: Record<TabId, { icon: React.ReactNode; label: string; description: string }> = {
  testers: {
    icon: <Users className="size-5 text-muted-foreground" />,
    label: "시험자 관리",
    description: "시험자 정보와 활성 상태를 관리합니다.",
  },
  capability: {
    icon: <Grid2x2 className="size-5 text-muted-foreground" />,
    label: "시험자 역량",
    description: "활성 시험자의 역량 매트릭스를 관리합니다.",
  },
  qualification: {
    icon: <ShieldCheck className="size-5 text-muted-foreground" />,
    label: "시험자 자격",
    description: "시험자별 OJT 자격 보유·만료 현황을 관리합니다.",
  },
  "qual-items": {
    icon: <SlidersHorizontal className="size-5 text-muted-foreground" />,
    label: "자격 항목",
    description: "Qualification List 의 카테고리와 OJT 항목을 관리합니다.",
  },
}

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
    isActive: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [sortField, setSortField] = useState<SortField>("employeeNo")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all")

  // ─── 자격 인증 ──────────────────────────────────────────────────────────────
  const [qualRole, setQualRole] = useState<string>("시험자")
  const qual = useQualificationData(qualRole)
  // 훅이 돌려주는 함수는 useCallback 이라 안정적이다. 객체(qual) 자체를 의존성에 두면
  // 매 렌더마다 새 참조가 되어 memo/effect 가 헛돈다 — 쓰는 함수만 꺼내 쓴다.
  const { ensureLoaded: ensureQualLoaded, countByStatus: countQualByStatus } = qual
  const [qualEditTarget, setQualEditTarget] = useState<QualEditTarget | null>(null)
  const [qualDetailTester, setQualDetailTester] = useState<QualTester | null>(null)

  useEffect(() => {
    void fetchTesters()
  }, [])

  async function fetchTesters() {
    setLoading(true)
    try {
      const res = await fetch("/api/testers?onlyTesterRole=1")
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

  useEffect(() => {
    if (activeTab === "qualification" || activeTab === "qual-items") void ensureQualLoaded()
    // ensureLoaded 는 이미 받아왔으면 아무것도 하지 않는다
  }, [activeTab, ensureQualLoaded])

  function openEdit(row: TesterRow) {
    setSelected(row)
    setForm({
      employeeNo: row.employeeNo,
      name: row.name,
      canSolo: row.canSolo,
      canDuo: row.canDuo,
      isActive: row.isActive,
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
        body: JSON.stringify({ employeeNo: form.employeeNo, name: form.name, canSolo: form.canSolo, canDuo: form.canDuo }),
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
        body: JSON.stringify({ id: selected.id, canSolo: form.canSolo, canDuo: form.canDuo, isActive: form.isActive }),
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

  // ─── 자격 탭 파생값 ─────────────────────────────────────────────────────────

  /**
   * 자격 매트릭스의 행. 정렬은 다른 탭과 같은 `sortedTesters`(활성 우선 + 선택한 정렬)를 그대로 쓴다.
   * 비활성 시험자는 원칙적으로 감추지만 **보유 자격이 있으면 남긴다** — 자격은 유효기간이 있는
   * 인증 기록이라 사람이 비활성으로 바뀐 순간 화면에서 사라지면 만료 관리가 끊긴다.
   */
  const qualTesters = useMemo<QualTester[]>(() => {
    const heldBy = new Set(
      qual.data.quals.filter(q => q.qualificationRole === qualRole).map(q => q.testerId),
    )
    return sortedTesters
      .filter(tester => tester.isActive || heldBy.has(tester.id))
      .map(tester => ({
        id: tester.id,
        employeeNo: tester.employeeNo,
        name: tester.name,
        isActive: tester.isActive,
      }))
  }, [sortedTesters, qual.data.quals, qualRole])

  /**
   * 자격 매트릭스의 열. 미사용 항목·미사용 카테고리는 감추되, 보유자가 있으면 열을 남긴다
   * (만료일을 계속 볼 수 있어야 한다). 열 순서는 서버가 카테고리 정렬순으로 내려준 순서를 따른다.
   */
  const qualItems = useMemo<QualItem[]>(() => {
    const held = new Set(
      qual.data.quals.filter(q => q.qualificationRole === qualRole).map(q => q.qualificationItemId),
    )
    const activeCategories = new Set(qual.data.categories.filter(c => c.isActive).map(c => c.id))
    return qual.data.items.filter(item =>
      (item.isActive && activeCategories.has(item.categoryId)) || held.has(item.id),
    )
  }, [qual.data.items, qual.data.categories, qual.data.quals, qualRole])

  const qualSummary = useMemo(
    () => countQualByStatus(qualTesters.map(tester => tester.id), qualItems),
    [countQualByStatus, qualTesters, qualItems],
  )

  const openQualCell = useCallback(
    (tester: QualTester, item: QualItem, existing: TesterQual | null) => {
      setQualEditTarget({ tester, item, role: qualRole, existing })
    },
    [qualRole],
  )

  /** 시험자 상세 패널의 행을 누르면 그 항목의 편집 패널로 이어준다 */
  const openQualFromDetail = useCallback(
    (item: QualItem, existing: TesterQual | null) => {
      if (!qualDetailTester) return
      setQualEditTarget({ tester: qualDetailTester, item, role: qualRole, existing })
    },
    [qualDetailTester, qualRole],
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            {TAB_META[activeTab].icon}
            <h1 className="text-xl font-semibold text-foreground">
              {TAB_META[activeTab].label}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{TAB_META[activeTab].description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tab switcher */}
          <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
            {TAB_ORDER.map((id) => ({ id, label: TAB_META[id].label })).map((tab) => (
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
        <Card className="gap-0.5 border-l-4 border-l-blue-500 px-3 py-2">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            단독 가능
          </span>
          <span className="text-lg font-semibold tabular-nums text-blue-600">
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
                    <Skeleton className="h-5 w-14 rounded-md" />
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
                        <Tag color={tester.isActive ? "green" : "mono"} className="text-[10px]">
                          {tester.isActive ? "활성" : "비활성"}
                        </Tag>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <TesterAvatar testerId={tester.id} name={tester.name} avatarUrl={tester.avatarUrl} size="sm" />
                        <span className="text-sm font-semibold text-foreground">{tester.name}</span>
                      </div>
                    </div>
                  </div>

                  {/* 가능한 항목만 노출 — '불가'는 표시하지 않는다 */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                    {tester.canSolo && (
                      <Badge variant="outline" className="gap-1.5 border-blue-200 text-[10px] text-blue-700">
                        <span className="size-1.5 rounded-full bg-blue-500" />
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
                  </div>
                </Card>
              ))
            )}
          </div>

          {/* Desktop table */}
          <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
            <Table className="w-full">
              {/* 논리 열은 4개지만 자동 펼침(이름+사번 / 단독+2인)으로 최대 6칸까지 늘어난다.
                  table-fixed 에서 <col> 이 4개(합 100%)뿐이면 5·6번째 칸이 폭 0으로 접혀
                  '2인'과 '상태'가 화면에서 사라진다. 그래서 최대 칸 수(6)만큼 선언하고,
                  폭은 앞 두 칸만 고정한 뒤 나머지는 자동 분배에 맡긴다.
                  합쳐졌을 때(4칸)는 뒤의 <col> 이 무시되고 남은 폭이 다시 나뉜다. */}
              {/* 칸 순서(펼침 / 합침):
                  순번 / 순번 · 이름 / 시험자 · 사번 / 시험가능 · 단독 / 상태 · 2인 · 상태
                  주석을 <colgroup> 안에 두면 공백 텍스트 노드가 생겨 hydration 오류가 난다. */}
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[25%]" />
                <col className="w-[16%]" />
                <col className="w-[17%]" />
                <col className="w-[17%]" />
                <col className="w-[16%]" />
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="px-3 py-2"><Skeleton className="h-4 w-6" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-28" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-20" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-5 w-12 rounded-md" /></TableCell>
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
                          primary={tester.canSolo ? <StatusLine color="bg-blue-500" label="단독 가능" /> : "—"}
                          secondary={tester.canDuo ? <StatusLine color="bg-amber-500" label="2인 가능" /> : undefined}
                        />
                      </TableCell>
                      {/* 헤더는 상태(활성) 열을 선언하는데 본문에 대응 칸이 없어
                          헤더 6칸 / 본문 5칸으로 어긋났고, 남는 칸이 폭 0으로 접혀
                          '2인'과 '상태'가 화면에서 사라졌다. (2026-08-22) */}
                      <TableCell className="px-3 py-2">
                        <Tag color={tester.isActive ? "green" : "mono"} className="text-[10px]">
                          {tester.isActive ? "활성" : "비활성"}
                        </Tag>
                      </TableCell>
                    </TableRow>
                  ))}
                {!loading && filteredTesters.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={4}
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
                    <Skeleton className="h-5 w-14 rounded-md" />
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
                                "flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
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

      {/* ─── 시험자 자격 탭 ─────────────────────────────────────────────────── */}
      {activeTab === "qualification" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* 범례 + 상태 집계 — 역량 탭의 범례 줄과 같은 자리·같은 형식 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">범례</span>
            {(["valid", "expiring", "expired", "none"] as const).map((status) => (
              <span key={status} className="flex items-center gap-1">
                <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLE[status])} />
                <span>{QUALIFICATION_STATUS_LABEL[status]}</span>
                <span className="tabular-nums text-foreground">{qualSummary[status]}</span>
              </span>
            ))}
            <span className="text-muted-foreground">
              만료 임박 = {EXPIRING_SOON_DAYS}일 이내 · 셀 클릭으로 부여·수정, 이름 클릭으로 상세
            </span>

            <div className="ml-auto flex items-center gap-2">
              <span className="font-medium text-foreground">자격종류</span>
              <Select value={qualRole} onValueChange={setQualRole}>
                <SelectTrigger className="!h-8 w-28 px-2 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUALIFICATION_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {qual.error && (
            <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
              {qual.error}
            </div>
          )}

          <QualificationMatrix
            loading={qual.loading}
            testers={qualTesters}
            categories={qual.data.categories}
            items={qualItems}
            qualAt={qual.qualAt}
            onPickCell={openQualCell}
            onPickTester={setQualDetailTester}
          />
        </div>
      )}

      {/* ─── 자격 항목 탭 ───────────────────────────────────────────────────── */}
      {activeTab === "qual-items" && (
        <QualificationItemsPanel
          loading={qual.loading}
          categories={qual.data.categories}
          items={qual.data.items}
          quals={qual.data.quals}
          onChanged={() => void qual.reload()}
        />
      )}

      <QualificationEditDrawer
        target={qualEditTarget}
        onClose={() => setQualEditTarget(null)}
        onSaved={() => void qual.reload()}
      />

      <TesterQualificationDrawer
        tester={qualDetailTester}
        role={qualRole}
        categories={qual.data.categories}
        items={qual.data.items}
        quals={qual.data.quals}
        onClose={() => setQualDetailTester(null)}
        onPickItem={openQualFromDetail}
      />

      {/* Add Dialog */}
      <ManagementDrawer
        open={addOpen}
        onOpenChange={setAddOpen}
        size="lg"
        title="시험자 추가"
        description="시험자 기본 정보와 시험 가능 범위를 등록합니다."
        footer={(
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
            <Button onClick={() => void handleAdd()} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "추가"}
            </Button>
          </>
        )}
      >
          <div className="grid gap-4">
              <section className="rounded-md border bg-card p-3 shadow-sm sm:p-4">
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

              <section className="rounded-md border bg-card p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b pb-3">
                  <h3 className="text-sm font-semibold text-foreground">시험 가능 범위</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground">
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
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground">
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
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
          </div>
      </ManagementDrawer>

      {/* Edit Sheet */}
      <ManagementDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        size="lg"
        title={(
          <span className="flex items-center gap-2">
            <TesterAvatar testerId={selected?.id} name={selected?.name} avatarUrl={selected?.avatarUrl} size="sm" />
            시험자 수정
          </span>
        )}
        description="시험 가능 범위를 수정합니다."
        footer={(
          <>
            {selected && (
              <Button
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => { setEditOpen(false); openDelete(selected) }}
                disabled={saving}
              >
                <Trash2 /> 삭제
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
            <Button onClick={() => void handleEdit()} disabled={saving}>
              <Save />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </>
        )}
      >
          <div className="grid gap-4">
              {/* 기본 정보 — 읽기 전용 */}
              <section className="rounded-md border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">기본 정보</h3>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2.5">
                    <Lock size={13} className="shrink-0 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">사번</span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {selected?.employeeNo ?? '-'}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">변경 불가</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2.5">
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
              <section className="rounded-md border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">시험 가능 범위</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={form.canSolo}
                      onChange={(e) => setForm((prev) => ({ ...prev, canSolo: e.target.checked }))}
                      className="cb-custom"
                    />
                    단독 시험 가능
                  </label>
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={form.canDuo}
                      onChange={(e) => setForm((prev) => ({ ...prev, canDuo: e.target.checked }))}
                      className="cb-custom"
                    />
                    2인 시험 가능
                  </label>
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/30 sm:col-span-2">
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
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
          </div>
      </ManagementDrawer>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>시험자 삭제</DialogTitle>
            <DialogDescription>
              역량 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/50 p-3">
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
