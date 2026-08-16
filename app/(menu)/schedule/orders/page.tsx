"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  RefreshCw, Sparkles, History, AlertCircle, X, Loader2, Database, Plus,
  ChevronDown, ChevronRight, ChevronLeft, Lock, LockOpen, Search, CalendarDays, Users, ListChecks, Layers,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { AssigneeDetailModal } from "@frontend/components/schedule/assignee-detail-modal"
import { TesterAvatar, TesterOptionLabel, primeTesterProfileCache } from "@frontend/lib/tester-profiles"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useTableColSpan,
} from "@frontend/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@frontend/components/ui/popover"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateField } from "@frontend/components/ui/date-field"
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
  SheetHeader,
  SheetTitle,
} from "@frontend/components/ui/sheet"

// ─── Types ──────────────────────────────────────────────────────────────────
interface OrderRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  dosageForm: string | null
  packagingDate: string | null
  dueDate: string | null
  isUrgent: boolean
  method: string
  status: string
  assigneeTesterId: string | null
  assigneeName: string | null
  productSynced: boolean
  note: string | null
  ingestState: string
  source: "manual" | "auto"
  workdays: number | null
  hasJob: boolean
  locked: boolean
}
interface Tester { id: string; name: string; avatarUrl?: string | null; employeeNo?: string | null; isActive?: boolean }

/**
 * 담당자 선택 후보 — 비활성(계정 정지) 시험자는 목록에서 제외한다.
 * 단, 이미 그 사람에게 배정된 오더를 수정할 때 값이 빈칸으로 보이지 않도록 현재 담당자(keepId)는 남긴다.
 */
function assignableTesters(testers: Tester[], keepId?: string | null): Tester[] {
  return testers.filter(t => t.isActive !== false || t.id === keepId)
}
interface EditRow {
  id: string; field: string; oldValue: string | null; newValue: string | null
  reason: string; editedAt: string; editedBy: string | null; editedByName: string | null
}

// 화면에 렌더링할 그룹(주차/담당자/상태 공통 형태)
interface RenderGroup {
  key: string; label: string; color: string; rows: OrderRow[]; meta: string; isThisWeek?: boolean; assigneeTesterId?: string | null
}

type TabId = "week" | "assignee" | "status"
const TABS: { id: TabId; label: string; icon: typeof CalendarDays }[] = [
  { id: "week", label: "주차별", icon: CalendarDays },
  { id: "assignee", label: "담당자별", icon: Users },
  { id: "status", label: "상태별", icon: ListChecks },
]

const STATUS_OPTIONS = ["대기", "진행중", "검토중", "완료", "지연"]
const METHOD_OPTIONS = ["전항목", "개별항목"]

// 상태 점 색 (템플릿 스타일의 outline 뱃지 + 컬러 도트)
const STATUS_DOT: Record<string, string> = {
  대기:   "bg-muted-foreground",
  진행중: "bg-violet-500",
  검토중: "bg-blue-500",
  완료:   "bg-emerald-500",
  지연:   "bg-red-500",
  삭제:   "bg-slate-300",
}

const FIELD_LABEL: Record<string, string> = {
  productCode: "품목코드", productName: "품목명", batchNo: "제조번호", dosageForm: "제형",
  packagingDate: "포장일", dueDate: "완료예정일", isUrgent: "긴급",
  method: "진행방법", status: "상태", note: "비고", assigneeTesterId: "담당자",
}

type SortField =
  | "productName"
  | "productCode"
  | "batchNo"
  | "dosageForm"
  | "method"
  | "packagingDate"
  | "dueDate"
  | "isUrgent"
  | "workdays"
  | "assigneeName"
  | "status"

const ORDER_COLUMNS: { key: string; def?: SortColumnDef<SortField>; head?: string }[] = [
  { key: "lock", head: "확정" },
  { key: "name", def: sortCol("productName", "품목명") },
  {
    key: "code",
    def: {
      key: "code",
      label: "품목코드",
      fields: [
        { id: "productCode", label: "품목코드" },
        { id: "batchNo", label: "제조번호" },
      ],
    },
  },
  {
    key: "form",
    def: {
      key: "form",
      label: "제형",
      fields: [
        { id: "dosageForm", label: "제형" },
        { id: "method", label: "진행방법" },
      ],
    },
  },
  {
    key: "dates",
    def: {
      key: "dates",
      label: "일정",
      fields: [
        { id: "packagingDate", label: "포장일" },
        { id: "dueDate", label: "완료예정" },
      ],
    },
  },
  {
    key: "load",
    def: {
      key: "load",
      label: "공수",
      fields: [
        { id: "workdays", label: "공수" },
        { id: "isUrgent", label: "긴급" },
      ],
    },
  },
  {
    key: "assignee",
    def: {
      key: "assignee",
      label: "담당자",
      fields: [
        { id: "assigneeName", label: "담당자" },
        { id: "status", label: "상태" },
      ],
    },
  },
]

const GROUP_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500",
  "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-fuchsia-500",
]

// ─── Utils ───────────────────────────────────────────────────────────────────
function isoToWeek(iso: string | null): { weekKey: string; weekLabel: string } {
  if (!iso) return { weekKey: "no-date", weekLabel: "기간 미정" }
  const d = new Date(iso + "T00:00:00Z")
  const dow = (d.getUTCDay() + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - dow)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
  return {
    weekKey: monday.toISOString().slice(0, 10),
    weekLabel: `${fmt(monday)} ~ ${fmt(sunday)}`,
  }
}

// 오늘이 속한 주차 키 (isoToWeek와 동일한 월요일 기준)
function thisWeekKey(): string {
  const now = new Date()
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  return isoToWeek(iso).weekKey
}

const pushTo = (m: Map<string, OrderRow[]>, k: string, r: OrderRow) => {
  const arr = m.get(k); if (arr) arr.push(r); else m.set(k, [r])
}

function FamilySpanCell({ children }: { children: ReactNode }) {
  const colSpan = useTableColSpan()
  return <TableCell colSpan={colSpan} className="px-3 py-2">{children}</TableCell>
}

// 완료예정일 임박 여부 (오늘 기준 3일 이내·기한 경과 포함, 완료·삭제 제외)
function isDueSoon(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "완료" || status === "삭제") return false
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const due = new Date(`${dueDate}T00:00:00`)
  if (Number.isNaN(due.getTime())) return false
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  return diffDays <= 3
}

// ─── 연도 달력 선택기 (12년 그리드, 데이터 있는 연도만 선택 가능) ────────────────
function YearPicker({ year, years, onChange }: { year: string; years: string[]; onChange: (y: string) => void }) {
  const available = useMemo(() => new Set(years), [years])
  const fallback = years[0] ? Number(years[0]) : new Date().getFullYear()
  const selected = year ? Number(year) : fallback
  const [open, setOpen] = useState(false)
  const [base, setBase] = useState(() => selected - 6)

  // 열 때마다 선택 연도 중심으로 창 재설정
  const handleOpen = (o: boolean) => { setOpen(o); if (o) setBase(selected - 6) }

  const cells = Array.from({ length: 12 }, (_, i) => base + i)

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <CalendarDays className="size-3.5 text-muted-foreground" />
          {year ? `${year}년` : "연도 선택"}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <button onClick={() => setBase(b => b - 12)} title="이전" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs font-semibold text-foreground tabular-nums">{cells[0]} ~ {cells[11]}</span>
          <button onClick={() => setBase(b => b + 12)} title="다음" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {cells.map(y => {
            const has = available.has(String(y))
            const isSel = y === selected
            return (
              <button
                key={y}
                disabled={!has}
                onClick={() => { onChange(String(y)); setOpen(false) }}
                className={cn(
                  "h-9 rounded-md text-sm tabular-nums transition-colors",
                  isSel
                    ? "bg-primary font-semibold text-primary-foreground"
                    : has
                      ? "text-foreground hover:bg-muted"
                      : "cursor-not-allowed text-muted-foreground/40",
                )}
              >
                {y}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<OrderRow[]>([])
  const [testers, setTesters] = useState<Tester[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("")
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<"recent" | "year">("recent")
  const [year, setYear] = useState("")
  const [tab, setTab] = useState<TabId>("week")

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OrderRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<OrderRow | null>(null)
  const [assigneeTarget, setAssigneeTarget] = useState<{ id: string; name: string } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const collapseInited = useRef(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTester, setBulkTester] = useState("")
  const [families, setFamilies] = useState<{ id: string; name: string; codes: string[] }[]>([])
  const [famCollapsed, setFamCollapsed] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const columns = ORDER_COLUMNS

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ""
      const [oRes, tRes, fRes] = await Promise.all([
        fetch(`/api/pct-orders${qs}`, { credentials: "include" }),
        fetch(`/api/testers`, { credentials: "include" }),
        fetch(`/api/concurrent-product-families`, { credentials: "include" }),
      ])
      const oData = await oRes.json()
      const tData = await tRes.json()
      const fData = await fRes.json().catch(() => ({ rows: [] }))
      primeTesterProfileCache(tData.rows ?? [])
      setRows(oData.rows ?? [])
      setTesters(tData.rows ?? [])
      setFamilies((fData.rows ?? []).map((f: { id: string; name: string; members: { productCode: string }[] }) =>
        ({ id: f.id, name: f.name, codes: f.members.map(m => m.productCode) })))
    } catch {
      setMsg("목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { void load() }, [load])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const runIngest = async () => {
    setBusy("ingest")
    try {
      const res = await fetch("/api/cron/ingest-pct", { method: "POST", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash(`적재 완료 — 신규 ${data.created} · 변경 ${data.updated} · 삭제 ${data.deleted} · 미동기화 ${data.unsynced}`)
      await load()
    } catch (e) {
      flash(`적재 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  // 선택된 오더를 일괄 확정/해제 — 새로고침 없이 로컬 상태만 갱신
  const applyLock = async (lock: boolean) => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBusy("lock")
    try {
      const results = await Promise.all(ids.map(async id => {
        const res = await fetch(`/api/pct-orders/${id}/lock`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lock }),
        })
        return { id, ok: res.ok }
      }))
      const okIds = new Set(results.filter(r => r.ok).map(r => r.id))
      const failed = results.length - okIds.size
      // 새로고침 없이 해당 행의 locked 상태만 변경
      setRows(prev => prev.map(r => (okIds.has(r.id) ? { ...r, locked: lock } : r)))
      setSelected(new Set())
      flash(
        `${okIds.size}건 ${lock ? "확정" : "확정 해제"}되었습니다.${failed > 0 ? ` (실패 ${failed}건)` : ""}`,
      )
    } catch (e) {
      flash(`확정/해제 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  // 선택된 오더에 담당자 일괄 배정 — 확정(LOCK)된 건은 제외(확정 해제된 것만 변경 가능)
  const applyAssign = async () => {
    if (!bulkTester) return
    const realId = bulkTester === "none" ? null : bulkTester
    const ids = Array.from(selected).filter(id => {
      const r = rows.find(x => x.id === id)
      return r && !r.locked
    })
    if (ids.length === 0) { flash("확정 해제된 오더만 담당자 변경이 가능합니다."); return }
    setBusy("assign-bulk")
    try {
      const results = await Promise.all(ids.map(async id => {
        const res = await fetch("/api/pct-orders", {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, patch: { assigneeTesterId: realId }, reason: "일괄 담당자 배정" }),
        })
        return { id, ok: res.ok }
      }))
      const okIds = new Set(results.filter(r => r.ok).map(r => r.id))
      const failed = results.length - okIds.size
      const name = realId ? (testers.find(t => t.id === realId)?.name ?? "") : "미배정"
      setRows(prev => prev.map(r => okIds.has(r.id)
        ? { ...r, assigneeTesterId: realId, assigneeName: realId ? name : null }
        : r))
      setSelected(new Set())
      setBulkTester("")
      flash(`${okIds.size}건 담당자 '${name}' 배정 완료${failed > 0 ? ` (실패 ${failed}건)` : ""}`)
    } catch (e) {
      flash(`담당자 배정 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const runAutoAssign = async () => {
    setBusy("assign")
    try {
      const res = await fetch("/api/pct-orders/assign", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const via = data.mode === "codex" ? "Codex" : "규칙엔진"
      flash(`AI 자동배정(${via}) — 배정 ${data.assigned} · 미배정 ${data.unassigned}`)
      await load()
    } catch (e) {
      flash(`자동배정 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const unsyncedCount = rows.filter(r => r.source === "auto" && !r.productSynced).length

  // ─── 이름 검색 (품목명·담당자·품목코드·제조번호) ──────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.productName.toLowerCase().includes(q) ||
      r.productCode.toLowerCase().includes(q) ||
      r.batchNo.toLowerCase().includes(q) ||
      (r.assigneeName ?? "").toLowerCase().includes(q)
    )
  }, [rows, search])

  // ─── 주차별 그룹 (정렬: 이번주 최상단 → 최신순) ────────────────────────────
  const weekGroups = useMemo(() => {
    const buckets = new Map<string, { label: string; color: string; rows: OrderRow[] }>()
    let colorIdx = 0
    for (const r of filteredRows) {
      const { weekKey, weekLabel } = isoToWeek(r.packagingDate)
      if (!buckets.has(weekKey)) {
        const color = weekKey === "no-date" ? "bg-slate-400" : GROUP_COLORS[colorIdx++ % GROUP_COLORS.length]
        buckets.set(weekKey, { label: weekLabel, color, rows: [] })
      }
      buckets.get(weekKey)!.rows.push(r)
    }
    const tw = thisWeekKey()
    const sorted = Array.from(buckets.entries()).sort(([a], [b]) => {
      if (a === "no-date") return 1
      if (b === "no-date") return -1
      if (a === tw) return -1
      if (b === tw) return 1
      return b.localeCompare(a) // 최신부터
    })
    return sorted.map(([key, val]) => ({ key, ...val, isThisWeek: key === tw }))
  }, [filteredRows])

  // 최초 1회: 이번주만 펼치고 나머지 주차는 접어 둔다.
  useEffect(() => {
    if (collapseInited.current || weekGroups.length === 0) return
    const next = new Set<string>()
    for (const g of weekGroups) if (!g.isThisWeek) next.add(g.key)
    setCollapsed(next)
    collapseInited.current = true
  }, [weekGroups])

  // 연단위 보기용 연도 목록 (최신부터)
  const years = useMemo(() => {
    const set = new Set<string>()
    for (const g of weekGroups) if (g.key !== "no-date") set.add(g.key.slice(0, 4))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [weekGroups])

  useEffect(() => {
    if (viewMode === "year" && years.length > 0 && !years.includes(year)) setYear(years[0])
  }, [viewMode, years, year])

  // 기간 범위 적용: 기본 최근 5주 / 연단위는 해당 연도 전체 (모든 탭 공통)
  const scopedWeekGroups = useMemo(() => {
    if (viewMode === "year") {
      return weekGroups.filter(g => g.key !== "no-date" && g.key.slice(0, 4) === year)
    }
    return weekGroups.slice(0, 5)
  }, [weekGroups, viewMode, year])

  // 기간 범위 내 행 모음 (담당자별·상태별 탭의 소스)
  const scopedRows = useMemo(() => scopedWeekGroups.flatMap(g => g.rows), [scopedWeekGroups])

  // 현재 탭 기준으로 렌더링할 그룹
  const renderGroups = useMemo<RenderGroup[]>(() => {
    if (tab === "week") {
      return scopedWeekGroups.map(g => ({
        key: g.key, label: g.label, color: g.color, rows: g.rows, isThisWeek: g.isThisWeek,
        meta: `배정 ${g.rows.filter(r => r.assigneeName).length}/${g.rows.length}건`,
      }))
    }
    if (tab === "assignee") {
      const m = new Map<string, OrderRow[]>()
      for (const r of scopedRows) pushTo(m, r.assigneeTesterId ?? "__none", r)
      let ci = 0
      return Array.from(m.entries())
        .map(([key, rs]) => {
          const assigneeName = rs.find(r => r.assigneeName)?.assigneeName ?? null
          return {
          key: `as:${key}`,
          label: key === "__none" ? "미배정" : assigneeName ?? "이름없음",
          color: key === "__none" ? "bg-slate-400" : GROUP_COLORS[ci++ % GROUP_COLORS.length],
          rows: rs,
          meta: `${rs.length}건`,
          assigneeTesterId: key === "__none" ? null : key,
          }
        })
        .sort((a, b) => {
          const an = a.label === "미배정" ? 1 : 0
          const bn = b.label === "미배정" ? 1 : 0
          return an - bn || a.label.localeCompare(b.label, "ko")
        })
    }
    // status
    const m = new Map<string, OrderRow[]>()
    for (const r of scopedRows) pushTo(m, r.status, r)
    const order = [...STATUS_OPTIONS, "삭제"]
    return Array.from(m.entries())
      .map(([status, rs]) => ({
        key: `st:${status}`, label: status,
        color: STATUS_DOT[status] ?? "bg-slate-400", rows: rs, meta: `${rs.length}건`,
      }))
      .sort((a, b) => {
        const ia = order.indexOf(a.label); const ib = order.indexOf(b.label)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })
  }, [tab, scopedWeekGroups, scopedRows])

  const toggleGroup = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const allCollapsed = renderGroups.length > 0 && renderGroups.every(g => collapsed.has(g.key))
  const toggleAll = () => {
    if (allCollapsed) setCollapsed(new Set())
    else setCollapsed(new Set(renderGroups.map(g => g.key)))
  }

  // 품목코드 → 동시분석 품목군 {id, name}
  const familyByCode = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const f of families) for (const c of f.codes) m.set(c, { id: f.id, name: f.name })
    return m
  }, [families])

  const toggleFamily = (key: string) =>
    setFamCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  // 그룹 내 행을 동시분석 품목군 트리로 묶는다.
  // 같은 품목군이 2건 이상이면 family 노드(접기 가능), 그 외는 단독 행.
  type RowItem =
    | { type: "single"; row: OrderRow }
    | { type: "family"; familyId: string; familyName: string; rows: OrderRow[] }
  // 컬럼 정렬용 행 비교 함수
  const sortRowsBy = useCallback((arr: OrderRow[]): OrderRow[] => {
    if (!sortField) return arr
    const dir = sortDir === "asc" ? 1 : -1
    return [...arr].sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      // null/undefined는 항상 맨 뒤
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === "boolean" && typeof bv === "boolean") return (av === bv ? 0 : av ? -1 : 1) * dir
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv), "ko") * dir
    })
  }, [sortField, sortDir])

  const buildRowTree = (groupKey: string, rows: OrderRow[]): RowItem[] => {
    const famRows = new Map<string, OrderRow[]>()
    for (const r of rows) {
      const fam = familyByCode.get(r.productCode)
      if (fam) {
        const arr = famRows.get(fam.id) ?? []; arr.push(r); famRows.set(fam.id, arr)
      }
    }
    // 한국어(ㄱㄴㄷ) 정렬 헬퍼 — 미배정(빈 담당자)은 맨 뒤로
    const byKo = (a: string, b: string) => a.localeCompare(b, "ko")
    const asgKey = (s: string | null) => s || "￿"
    // 묶음 내부 행은 품목명 ㄱㄴㄷ 정렬
    for (const arr of famRows.values()) arr.sort((a, b) => byKo(a.productName, b.productName))

    // 묶음(그룹)을 위에, 개별 행을 그 다음에. 각 구간 내부는 담당자 → 품목명 순.
    type Sortable = { item: RowItem; assignee: string; name: string }
    const familyItems: Sortable[] = []
    const singleItems: Sortable[] = []
    const emitted = new Set<string>()
    for (const r of rows) {
      const fam = familyByCode.get(r.productCode)
      const group = fam ? famRows.get(fam.id)! : null
      if (fam && group && group.length >= 2) {
        if (emitted.has(fam.id)) continue
        emitted.add(fam.id)
        // 묶음은 보통 한 담당자에게 배정됨 → 대표 담당자 기준 정렬
        const repAssignee = group.find(x => x.assigneeName)?.assigneeName ?? null
        familyItems.push({
          item: { type: "family", familyId: `${groupKey}::${fam.id}`, familyName: fam.name, rows: group },
          assignee: asgKey(repAssignee),
          name: group[0].productName,
        })
      } else {
        singleItems.push({ item: { type: "single", row: r }, assignee: asgKey(r.assigneeName), name: r.productName })
      }
    }
    // 컬럼 정렬이 활성화된 경우 내부 정렬 대신 입력 순서를 보존
    if (!sortField) {
      const byAssigneeThenName = (a: Sortable, b: Sortable) => byKo(a.assignee, b.assignee) || byKo(a.name, b.name)
      familyItems.sort(byAssigneeThenName)
      singleItems.sort(byAssigneeThenName)
    }
    return [...familyItems, ...singleItems].map(x => x.item)
  }

  // 단일 오더 행 렌더 (트리 들여쓰기 옵션)
  const renderOrderCard = (r: OrderRow, indented = false) => {
    const dueSoon = isDueSoon(r.dueDate, r.status)
    return (
      <article
        key={r.id}
        onClick={isAdmin ? () => setEditTarget(r) : undefined}
        className={cn(
          "rounded-lg border bg-card p-3 shadow-xs transition-colors",
          isAdmin && "cursor-pointer active:bg-muted/50",
          dueSoon && "border-orange-200 bg-orange-50/60",
          r.locked && "border-amber-200 bg-amber-50/40",
          selected.has(r.id) && "border-primary/40 bg-primary/5 ring-1 ring-primary/20",
        )}
      >
        <div className="flex items-start gap-2.5">
          <div className="pt-0.5" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              className="cb-custom"
              checked={selected.has(r.id)}
              disabled={!isAdmin}
              onChange={() => setSelected(prev => {
                const next = new Set(prev)
                if (next.has(r.id)) next.delete(r.id)
                else next.add(r.id)
                return next
              })}
              title="선택"
              aria-label="선택"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {indented && <span aria-hidden="true" className="text-muted-foreground/60">↳</span>}
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{r.productName}</p>
              <SourceBadge source={r.source} />
              {r.source === "auto" && !r.productSynced && (
                <Badge variant="outline" className="border-amber-200 text-amber-700">미동기화</Badge>
              )}
              {r.isUrgent && <Badge variant="outline" className="border-red-200 text-red-700">긴급</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="font-mono">품목코드 {r.productCode}</span>
              <span aria-hidden="true" className="text-border">·</span>
              <span className="font-mono">제조번호 {r.batchNo}</span>
            </div>
          </div>

          <Button
            variant="ghost" size="icon-sm"
            onClick={(e) => { e.stopPropagation(); setHistoryTarget(r) }}
            title="수정이력"
            className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
          >
            <History />
          </Button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
          <div className="min-w-0">
            <dt className="text-muted-foreground">제형</dt>
            <dd className="mt-0.5 truncate font-medium text-foreground">{r.dosageForm ?? "-"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">진행방법</dt>
            <dd className="mt-0.5 truncate font-medium text-foreground">{r.method}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">포장일</dt>
            <dd className="mt-0.5 font-medium text-foreground">{r.packagingDate ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">완료예정</dt>
            <dd className={cn("mt-0.5 font-medium text-foreground", dueSoon && "font-semibold text-orange-700")}>
              {r.dueDate ?? "-"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">공수</dt>
            <dd className="mt-0.5 font-medium text-foreground">{r.workdays != null ? `${r.workdays}일` : "-"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">담당자</dt>
            <dd className="mt-0.5 truncate font-medium text-foreground">
              {r.assigneeName && r.assigneeTesterId
                ? <button
                    onClick={(e) => { e.stopPropagation(); setAssigneeTarget({ id: r.assigneeTesterId!, name: r.assigneeName! }) }}
                    title={`${r.assigneeName} 담당 오더 보기`}
                    className="inline-flex max-w-full items-center gap-1.5 hover:text-primary"
                  >
                    <TesterAvatar testerId={r.assigneeTesterId} name={r.assigneeName} size="sm" />
                    <span className="truncate underline-offset-2 hover:underline">{r.assigneeName}</span>
                  </button>
                : <span className="text-muted-foreground">미배정</span>}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
          <div className="flex items-center gap-1">
            <StatusBadge status={r.status} />
            {r.locked && (
              <Badge variant="outline" className="gap-0.5 border-amber-200 text-amber-700">
                <Lock className="size-2.5" />확정
              </Badge>
            )}
          </div>
          {isAdmin && <span className="text-[11px] text-muted-foreground">카드를 눌러 수정</span>}
        </div>
      </article>
    )
  }

  const renderOrderRow = (r: OrderRow, indented = false) => {
    const dueSoon = isDueSoon(r.dueDate, r.status)
    return (
      <TableRow
        key={r.id}
        onClick={isAdmin ? () => setEditTarget(r) : undefined}
        className={cn(
          isAdmin && "cursor-pointer",
          dueSoon && "bg-orange-50 hover:bg-orange-100/70",
          r.locked && "bg-amber-50/40",
          selected.has(r.id) && "bg-primary/5",
        )}
      >
        <TableCell className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            className="cb-custom"
            checked={selected.has(r.id)}
            disabled={!isAdmin}
            onChange={() => setSelected(prev => {
              const next = new Set(prev)
              next.has(r.id) ? next.delete(r.id) : next.add(r.id)
              return next
            })}
            title="선택"
            aria-label="선택"
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <div className={cn("flex min-w-0 items-center gap-1.5", indented && "pl-5")}>
            {indented && <span className="shrink-0 text-muted-foreground/60">└</span>}
            <span className="min-w-0 truncate font-medium text-foreground" title={r.productName}>{r.productName}</span>
            <SourceBadge source={r.source} />
            {r.source === "auto" && !r.productSynced && (
              <Badge variant="outline" className="shrink-0 border-amber-200 text-amber-700">미동기화</Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <CellStack
            primary={r.productCode}
            secondary={r.batchNo}
            primaryClass="font-mono text-xs text-muted-foreground"
            title={`${r.productCode} · ${r.batchNo}`}
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <CellStack
            primary={r.dosageForm ?? "—"}
            secondary={r.method}
            title={[r.dosageForm, r.method].filter(Boolean).join(" / ")}
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <CellStack
            primary={r.packagingDate ?? "—"}
            secondary={
              <span className={cn(dueSoon && "font-semibold text-orange-700")}>{r.dueDate ?? "—"}</span>
            }
            title={`포장 ${r.packagingDate ?? "—"} / 완료 ${r.dueDate ?? "—"}`}
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <CellStack
            primary={r.workdays != null ? `${r.workdays}일` : "—"}
            secondary={r.isUrgent ? "긴급" : "일반"}
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <CellStack
            primary={
              r.assigneeName && r.assigneeTesterId
                ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setAssigneeTarget({ id: r.assigneeTesterId!, name: r.assigneeName! }) }}
                    title={`${r.assigneeName} 담당 오더 보기`}
                    className="inline-flex max-w-full items-center gap-1.5 font-medium text-foreground hover:text-primary"
                  >
                    <TesterAvatar testerId={r.assigneeTesterId} name={r.assigneeName} size="sm" />
                    <span className="min-w-0 truncate underline-offset-2 hover:underline">{r.assigneeName}</span>
                  </button>
                )
                : "미배정"
            }
            secondary={
              <span className="inline-flex items-center gap-1">
                <StatusBadge status={r.status} />
                {r.locked && (
                  <Badge variant="outline" className="gap-0.5 border-amber-200 text-amber-700">
                    <Lock className="size-2.5" />확정
                  </Badge>
                )}
              </span>
            }
            secondaryLabel="상태"
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost" size="icon-sm"
              onClick={(e) => { e.stopPropagation(); setHistoryTarget(r) }}
              title="수정이력" className="text-muted-foreground"
            >
              <History />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  // 카운트 라벨 (탭별 단위)
  const groupUnit =
    tab === "week"
      ? (viewMode === "recent" && weekGroups.length > 5 ? `최근 5주 (전체 ${weekGroups.length}주차)` : `${scopedWeekGroups.length}주차`)
      : tab === "assignee" ? `${renderGroups.length}명`
      : `${renderGroups.length}개 상태`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* 헤더 · 조회조건 — 스크롤하지 않음 */}
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AI 스케줄 · 관리</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            제조부서 PCT 적재 오더의 담당자 배정과 수정을 관리합니다.
            {unsyncedCount > 0 && (
              <Badge variant="outline" className="gap-1 border-amber-200 text-amber-700">
                <AlertCircle className="size-3" /> 미동기화 {unsyncedCount}
              </Badge>
            )}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="lg" onClick={() => setCreateOpen(true)} disabled={busy !== null}>
              <Plus />오더 추가
            </Button>
            <Button variant="outline" size="lg" onClick={runIngest} disabled={busy !== null}>
              {busy === "ingest" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              지금 적재
            </Button>
            <Button size="lg" onClick={runAutoAssign} disabled={busy !== null}>
              {busy === "assign" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              AI 자동배정
            </Button>
          </div>
        )}
      </div>

      {msg && (
        <div className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{msg}</div>
      )}

      {/* 탭 (주차별 / 담당자별 / 상태별) */}
      <div className="inline-flex h-9 w-fit shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
              tab === t.id ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select value={statusFilter || "all"} onValueChange={v => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="!h-9 px-3"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* 보기 모드: 최근 5주 / 연단위 (기간 범위) */}
        <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground">
          <button
            onClick={() => setViewMode("recent")}
            className={cn("h-8 rounded-md px-3 text-sm font-medium transition-colors",
              viewMode === "recent" ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
          >
            최근 5주
          </button>
          <button
            onClick={() => setViewMode("year")}
            className={cn("h-8 rounded-md px-3 text-sm font-medium transition-colors",
              viewMode === "year" ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
          >
            연단위
          </button>
        </div>
        {viewMode === "year" && (
          <YearPicker year={year} years={years} onChange={setYear} />
        )}

        <span className="text-sm text-muted-foreground tabular-nums">
          {search.trim() ? `검색 ${scopedRows.length}건` : `${scopedRows.length}건`} · {groupUnit}
        </span>

        {renderGroups.length > 0 && (
          <Button variant="outline" size="lg" onClick={toggleAll}>
            {allCollapsed ? <ChevronDown /> : <ChevronRight />}
            {allCollapsed ? "전체 펼치기" : "전체 접기"}
          </Button>
        )}

        {/* 이름 검색 */}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="품목명·담당자·코드·제조번호"
            className="h-9 w-56 rounded-lg border border-input bg-background pl-8 pr-7 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              title="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button variant="outline" size="lg" onClick={() => setShowLog(true)}>
          <Database />적재 이력
        </Button>
      </div>

      {/* 그룹 카드 — 조회조건 아래 아코디언만 스크롤 */}
      {loading ? (
        <div className="relative min-h-0 flex-1 basis-0">
        {/* [&>*]:shrink-0 — 없으면 카드들이 컨테이너 높이에 맞춰 찌그러져 스크롤이 생기지 않는다 */}
        <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto overscroll-contain [&>*]:shrink-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-0 overflow-hidden py-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-3 w-1.5 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
              <div className="border-t px-4 py-3">
                <div className="flex flex-col gap-2.5">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-3">
                      <Skeleton className="h-4 w-8" />
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="ml-auto h-5 w-14 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
        </div>
      ) : rows.length === 0 ? (
        <Card className="min-h-0 flex-1 items-center py-10 text-center text-sm text-muted-foreground">
          적재된 오더가 없습니다. &quot;지금 적재&quot;로 시트를 불러오세요.
        </Card>
      ) : renderGroups.length === 0 ? (
        <Card className="min-h-0 flex-1 items-center py-10 text-center text-sm text-muted-foreground">
          {search.trim() ? `"${search.trim()}" 검색 결과가 없습니다.` : "해당 기간에 표시할 오더가 없습니다."}
        </Card>
      ) : (
        <div className="relative min-h-0 flex-1 basis-0">
        {/* [&>*]:shrink-0 — 없으면 카드들이 컨테이너 높이에 맞춰 찌그러져 스크롤이 생기지 않는다 */}
        <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto overscroll-contain [&>*]:shrink-0">
          {renderGroups.map(g => {
            const isCollapsed = collapsed.has(g.key)
            return (
              <Card
                key={g.key}
                className={cn("gap-0 overflow-hidden py-0", g.isThisWeek && "border-primary/40 ring-1 ring-primary/20")}
              >
                {/* 그룹 헤더 */}
                <button
                  onClick={() => toggleGroup(g.key)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    g.isThisWeek && "bg-primary/5",
                  )}
                >
                  {tab === "assignee" && g.label !== "미배정"
                    ? <TesterAvatar testerId={g.assigneeTesterId} name={g.label} size="md" />
                    : <span className={cn("h-3 w-1.5 shrink-0 rounded-full", g.color)} />}
                  <span className="flex-1 text-sm font-semibold text-foreground">
                    {g.label}
                    {g.isThisWeek && (
                      <Badge className="ml-2 align-middle">이번주</Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{g.meta}</span>
                  {isCollapsed
                    ? <ChevronRight className="size-4 text-muted-foreground" />
                    : <ChevronDown className="size-4 text-muted-foreground" />}
                </button>

                {/* 테이블 */}
                {!isCollapsed && (
                  <div className="border-t">
                      <div className="space-y-2 p-3 md:hidden">
                        {buildRowTree(g.key, sortRowsBy(g.rows)).map(item => {
                          if (item.type === "single") return renderOrderCard(item.row)
                          const fc = famCollapsed.has(item.familyId)
                          return (
                            <div key={item.familyId} className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                              <button onClick={() => toggleFamily(item.familyId)} className="flex w-full items-center gap-2 text-left">
                                {fc
                                  ? <ChevronRight className="size-4 text-muted-foreground" />
                                  : <ChevronDown className="size-4 text-muted-foreground" />}
                                <Layers className="size-3.5 text-primary" />
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.familyName}</span>
                                <Badge variant="secondary">동시분석 {item.rows.length}건</Badge>
                              </button>
                              {!fc && (
                                <div className="mt-2 flex flex-col gap-2 border-t border-primary/15 pt-2">
                                  {item.rows.map(r => renderOrderCard(r, true))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="hidden md:block">
                    <Table layout="content">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          {columns.map((col) =>
                            col.def ? (
                              <TableHead key={col.key} className="px-3 text-muted-foreground">
                                <SortColumnHeader
                                  col={col.def}
                                  sortField={sortField}
                                  sortDir={sortDir}
                                  onPick={pickSort}
                                />
                              </TableHead>
                            ) : (
                              <TableHead key={col.key} className="w-12 px-3 text-center text-muted-foreground">{col.head}</TableHead>
                            )
                          )}
                          <TableHead className="px-3 text-right text-muted-foreground">관리</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {buildRowTree(g.key, sortRowsBy(g.rows)).map(item => {
                          if (item.type === "single") return renderOrderRow(item.row)
                          const fc = famCollapsed.has(item.familyId)
                          return (
                            <Fragment key={item.familyId}>
                              <TableRow className="bg-primary/5 hover:bg-primary/10">
                                <FamilySpanCell>
                                  <button onClick={() => toggleFamily(item.familyId)} className="flex items-center gap-2 text-left">
                                    {fc
                                      ? <ChevronRight className="size-4 text-muted-foreground" />
                                      : <ChevronDown className="size-4 text-muted-foreground" />}
                                    <Layers className="size-3.5 text-primary" />
                                    <span className="text-sm font-semibold text-foreground">{item.familyName}</span>
                                    <Badge variant="secondary">동시분석 {item.rows.length}건</Badge>
                                  </button>
                                </FamilySpanCell>
                              </TableRow>
                              {!fc && item.rows.map(r => renderOrderRow(r, true))}
                            </Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                      </div>
                    </div>
                )}
              </Card>
            )
          })}
        </div>
        </div>
      )}

      {createOpen && (
        <CreateModal
          testers={testers}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); flash("오더가 추가되었습니다."); void load() }}
        />
      )}
      {editTarget && (
        <EditModal
          order={editTarget} testers={testers}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); flash("수정되었습니다."); void load() }}
        />
      )}
      {historyTarget && (
        <HistoryModal order={historyTarget} testers={testers} onClose={() => setHistoryTarget(null)} />
      )}
      {assigneeTarget && (
        <AssigneeDetailModal
          testerId={assigneeTarget.id}
          testerName={assigneeTarget.name}
          onClose={() => setAssigneeTarget(null)}
        />
      )}
      {showLog && <IngestLogModal onClose={() => setShowLog(false)} />}

      {/* 선택 시 하단 미니 모달 — 담당자 배정 / 확정·해제 */}
      {selected.size > 0 && (() => {
        const lockedCount = Array.from(selected).filter(id => rows.find(r => r.id === id)?.locked).length
        const unlockedCount = selected.size - lockedCount
        return (
          <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
            <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-foreground tabular-nums">{selected.size}건 선택됨</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">확정 {lockedCount} · 미확정 {unlockedCount}</span>
              </div>

              <span className="h-8 w-px bg-border" />

              {/* 담당자 일괄 배정 — 확정 해제된(미확정) 건만 */}
              {unlockedCount === 0 ? (
                <span className="text-sm font-medium text-amber-700">확정된 대상은 배정불가합니다.</span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Select value={bulkTester} onValueChange={setBulkTester}>
                    <SelectTrigger className="h-9 w-40"><SelectValue placeholder="담당자 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">미배정</SelectItem>
                      {assignableTesters(testers).map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <TesterOptionLabel testerId={t.id} name={t.name} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="default"
                    onClick={applyAssign}
                    disabled={busy !== null || !bulkTester}
                  >
                    {busy === "assign-bulk" ? <Loader2 className="animate-spin" /> : <Users />}배정
                  </Button>
                </div>
              )}

              <span className="h-8 w-px bg-border" />

              <Button size="default" onClick={() => applyLock(true)} disabled={busy !== null}>
                {busy === "lock" ? <Loader2 className="animate-spin" /> : <Lock />}확정
              </Button>
              <Button size="default" variant="outline" onClick={() => applyLock(false)} disabled={busy !== null}>
                <LockOpen />확정 해제
              </Button>
              <Button size="icon" variant="ghost" onClick={() => { setSelected(new Set()); setBulkTester("") }} title="선택 해제" className="ml-auto">
                <X />
              </Button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── 상태 뱃지 (outline + 컬러 도트) ──────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status] ?? "bg-slate-400")} />
      {status}
    </Badge>
  )
}

function SourceBadge({ source }: { source: OrderRow["source"] }) {
  return source === "manual" ? (
    <Badge variant="outline" className="border-blue-200 text-blue-700">수동</Badge>
  ) : (
    <Badge variant="outline" className="border-emerald-200 text-emerald-700">자동</Badge>
  )
}

// ─── 오더 추가 모달 (수동 생성) ───────────────────────────────────────────────
interface ProductHit { id: string; productCode: string; name: string }
function CreateModal({ testers, onClose, onCreated }: {
  testers: Tester[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    productCode: "", productName: "", batchNo: "", dosageForm: "",
    packagingDate: "", dueDate: "", isUrgent: false,
    method: "전항목", status: "대기", assigneeTesterId: "", note: "",
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 품목 검색 (자동완성) — 선택 시 코드·품목명 자동 입력
  const [pq, setPq] = useState("")
  const [hits, setHits] = useState<ProductHit[]>([])
  const [searching, setSearching] = useState(false)
  const [showHits, setShowHits] = useState(false)

  useEffect(() => {
    const q = pq.trim()
    if (!q) { setHits([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=10`, { credentials: "include" })
        const data = await res.json()
        if (alive) { setHits(data.rows ?? []); setShowHits(true) }
      } catch {
        if (alive) setHits([])
      } finally {
        if (alive) setSearching(false)
      }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [pq])

  const pickProduct = (p: ProductHit) => {
    setForm(f => ({ ...f, productCode: p.productCode, productName: p.name }))
    setPq(`${p.name} (${p.productCode})`)
    setShowHits(false)
  }

  const save = async () => {
    if (!form.productCode.trim() || !form.productName.trim() || !form.batchNo.trim()) {
      setErr("품목코드·품목명·제조번호는 필수입니다."); return
    }
    setSaving(true); setErr(null)
    try {
      const res = await fetch("/api/pct-orders", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: form.productCode.trim(),
          productName: form.productName.trim(),
          batchNo: form.batchNo.trim(),
          dosageForm: form.dosageForm.trim() || null,
          packagingDate: form.packagingDate || null,
          dueDate: form.dueDate || null,
          isUrgent: form.isUrgent,
          method: form.method,
          status: form.status,
          assigneeTesterId: form.assigneeTesterId || null,
          note: form.note || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패")
    } finally { setSaving(false) }
  }

  return (
    <SlideOver title="오더 추가" onClose={onClose}>
      <p className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
        제조 시트 적재가 아닌 수동 등록 오더입니다. 등록 후 담당자를 지정하세요.
      </p>

      {/* 품목 검색 (자동완성) */}
      <div className="relative mb-3">
        <label className="mb-1 block text-xs font-semibold text-foreground">품목 검색</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={pq}
            onChange={e => { setPq(e.target.value); setShowHits(true) }}
            onFocus={() => { if (hits.length) setShowHits(true) }}
            placeholder="품목명·품목코드로 검색"
            className={cn(inputCls, "pl-8")}
          />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {showHits && hits.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-card shadow-lg">
            {hits.map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pickProduct(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate font-medium text-foreground">{p.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.productCode}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="품목코드"><input value={form.productCode} onChange={e => setForm({ ...form, productCode: e.target.value })} className={cn(inputCls, "font-mono")} /></Field>
        <Field label="제조번호"><input value={form.batchNo} onChange={e => setForm({ ...form, batchNo: e.target.value })} className={cn(inputCls, "font-mono")} /></Field>
        <Field label="품목명" full><input value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} className={inputCls} /></Field>
        <Field label="제형"><input value={form.dosageForm} onChange={e => setForm({ ...form, dosageForm: e.target.value })} placeholder="예: 내용고형제 (선택)" className={inputCls} /></Field>
        <Field label="포장일"><DateField noLabel value={form.packagingDate} onChange={v => setForm({ ...form, packagingDate: v })} /></Field>
        <Field label="완료예정일"><DateField noLabel value={form.dueDate} onChange={v => setForm({ ...form, dueDate: v })} /></Field>
        <Field label="긴급">
          <Select value={form.isUrgent ? "긴급" : "일반"} onValueChange={v => setForm({ ...form, isUrgent: v === "긴급" })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="일반">일반</SelectItem>
              <SelectItem value="긴급">긴급</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="진행방법">
          <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METHOD_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="상태">
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="담당자">
          <Select value={form.assigneeTesterId || "none"} onValueChange={v => setForm({ ...form, assigneeTesterId: v === "none" ? "" : v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">미배정</SelectItem>
              {assignableTesters(testers, form.assigneeTesterId).map(t => (
                <SelectItem key={t.id} value={t.id}>
                  <TesterOptionLabel testerId={t.id} name={t.name} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="비고" full><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputCls} /></Field>
      </div>

      {err && <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="lg" onClick={onClose}>취소</Button>
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Plus />}오더 추가
        </Button>
      </div>
    </SlideOver>
  )
}

// ─── 수정 모달 (사유 필수) ────────────────────────────────────────────────────
function EditModal({ order, testers, onClose, onSaved }: {
  order: OrderRow; testers: Tester[]; onClose: () => void; onSaved: () => void
}) {
  const isAutoOrder = order.source === "auto"
  const [form, setForm] = useState({
    productCode: order.productCode ?? "",
    productName: order.productName ?? "",
    batchNo: order.batchNo ?? "",
    dosageForm: order.dosageForm ?? "",
    packagingDate: order.packagingDate ?? "",
    dueDate: order.dueDate ?? "",
    isUrgent: order.isUrgent,
    method: order.method,
    status: order.status,
    assigneeTesterId: order.assigneeTesterId ?? "",
    note: order.note ?? "",
  })
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    if (!isAutoOrder && (!form.productCode.trim() || !form.productName.trim() || !form.batchNo.trim())) {
      setErr("품목코드·품목명·제조번호는 비울 수 없습니다."); return
    }
    if (!reason.trim()) { setErr("수정 사유는 필수입니다."); return }
    setSaving(true); setErr(null)
    try {
      const patch: Record<string, string | boolean | null> = {
        dosageForm: form.dosageForm.trim() || null,
        packagingDate: form.packagingDate || null,
        dueDate: form.dueDate || null,
        isUrgent: form.isUrgent,
        method: form.method,
        status: form.status,
        assigneeTesterId: form.assigneeTesterId || null,
        note: form.note || null,
      }
      if (!isAutoOrder) {
        patch.productCode = form.productCode.trim()
        patch.productName = form.productName.trim()
        patch.batchNo = form.batchNo.trim()
      }
      const res = await fetch("/api/pct-orders", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, patch, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패")
    } finally { setSaving(false) }
  }

  return (
    <SlideOver title={`오더 수정 — ${order.productName}`} onClose={onClose}>
      <p className={cn(
        "mb-3 rounded-md border px-3 py-2 text-[11px]",
        isAutoOrder
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-blue-200 bg-blue-50 text-blue-700",
      )}>
        {isAutoOrder
          ? "자동 적재 오더입니다. 품목코드·제조번호·품목명은 제조팀 원본 기준으로 고정됩니다."
          : "수동 등록 오더입니다. 품목코드·제조번호·품목명까지 수정할 수 있으며 변경 내용은 이력에 남습니다."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="품목코드"><input value={form.productCode} disabled={isAutoOrder} onChange={e => setForm({ ...form, productCode: e.target.value })} className={cn(inputCls, "font-mono disabled:bg-muted disabled:text-muted-foreground")} /></Field>
        <Field label="제조번호"><input value={form.batchNo} disabled={isAutoOrder} onChange={e => setForm({ ...form, batchNo: e.target.value })} className={cn(inputCls, "font-mono disabled:bg-muted disabled:text-muted-foreground")} /></Field>
        <Field label="품목명" full><input value={form.productName} disabled={isAutoOrder} onChange={e => setForm({ ...form, productName: e.target.value })} className={cn(inputCls, "disabled:bg-muted disabled:text-muted-foreground")} /></Field>
        <Field label="제형"><input value={form.dosageForm} onChange={e => setForm({ ...form, dosageForm: e.target.value })} placeholder="예: 내용고형제 (선택)" className={inputCls} /></Field>
        <Field label="포장일"><DateField noLabel value={form.packagingDate} onChange={v => setForm({ ...form, packagingDate: v })} /></Field>
        <Field label="완료예정일"><DateField noLabel value={form.dueDate} onChange={v => setForm({ ...form, dueDate: v })} /></Field>
        <Field label="긴급">
          <Select value={form.isUrgent ? "긴급" : "일반"} onValueChange={v => setForm({ ...form, isUrgent: v === "긴급" })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="일반">일반</SelectItem>
              <SelectItem value="긴급">긴급</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="진행방법">
          <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METHOD_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="상태">
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="담당자">
          <Select value={form.assigneeTesterId || "none"} onValueChange={v => setForm({ ...form, assigneeTesterId: v === "none" ? "" : v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">미배정</SelectItem>
              {assignableTesters(testers, form.assigneeTesterId).map(t => (
                <SelectItem key={t.id} value={t.id}>
                  <TesterOptionLabel testerId={t.id} name={t.name} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="비고" full><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputCls} /></Field>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-foreground">수정 사유 <span className="text-red-500">*</span></label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
          placeholder="변경 사유를 입력하세요 (필수)"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" />
      </div>

      {err && <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="lg" onClick={onClose}>취소</Button>
        <Button size="lg" onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}저장
        </Button>
      </div>
    </SlideOver>
  )
}

// ─── 수정이력 모달 ────────────────────────────────────────────────────────────
// 수정이력 값 보기 좋게 변환 (담당자 id→이름, 긴급 boolean→라벨)
function fmtEditValue(field: string, v: string | null, testers: Tester[]): string {
  if (v == null || v === "") return field === "assigneeTesterId" ? "미배정" : "(없음)"
  if (field === "assigneeTesterId") return testers.find(t => t.id === v)?.name ?? v
  if (field === "isUrgent") return v === "true" ? "긴급" : "일반"
  return v
}

function HistoryModal({ order, testers, onClose }: { order: OrderRow; testers: Tester[]; onClose: () => void }) {
  const [rows, setRows] = useState<EditRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/pct-orders/${order.id}/edits`, { credentials: "include" })
        const data = await res.json()
        setRows(data.rows ?? [])
      } finally { setLoading(false) }
    })()
  }, [order.id])

  // 한 번의 저장(동일 시각·사유·작성자)으로 발생한 필드 변경들을 하나의 이력 카드로 묶는다.
  const sessions = useMemo(() => {
    const m = new Map<string, { key: string; editedAt: string; reason: string; editorName: string | null; edits: EditRow[] }>()
    for (const e of rows) {
      const key = `${e.editedAt}|${e.reason}|${e.editedBy ?? ""}`
      if (!m.has(key)) m.set(key, { key, editedAt: e.editedAt, reason: e.reason, editorName: e.editedByName, edits: [] })
      m.get(key)!.edits.push(e)
    }
    return Array.from(m.values())
  }, [rows])

  return (
    <Modal title={`수정이력 — ${order.productName}`} onClose={onClose}>
      {loading ? (
        <div className="flex flex-col gap-2.5 py-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-5 w-10 rounded-md" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">수정 이력이 없습니다.</p>
      ) : (
        <ul className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto">
          {sessions.map((s, i) => (
            <li key={s.key} className="rounded-lg border bg-muted/40 px-3 py-2.5">
              {/* 헤더: 작성자 · 시각 · 변경 필드 수 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                    {sessions.length - i}회차
                  </span>
                  <span className="text-sm font-semibold text-foreground">{s.editorName ?? "시스템/미상"}</span>
                  <Badge variant="secondary" className="text-[10px]">{s.edits.length}개 변경</Badge>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {new Date(s.editedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>

              {/* 필드별 변경 내역 */}
              <div className="mt-2 flex flex-col gap-1.5">
                {s.edits.map(e => (
                  <div key={e.id} className="grid grid-cols-[auto_1fr] items-baseline gap-2 text-xs">
                    <span className="rounded bg-card px-1.5 py-0.5 font-medium text-muted-foreground ring-1 ring-border">
                      {FIELD_LABEL[e.field] ?? e.field}
                    </span>
                    <span className="text-muted-foreground">
                      <span className="text-muted-foreground line-through">{fmtEditValue(e.field, e.oldValue, testers)}</span>
                      <span className="mx-1 text-muted-foreground/60">→</span>
                      <span className="font-semibold text-foreground">{fmtEditValue(e.field, e.newValue, testers)}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* 사유 */}
              <p className="mt-2 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">사유</span> · {s.reason}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

// ─── 적재 이력 모달 ───────────────────────────────────────────────────────────
interface IngestLog {
  id: string; runAt: string; orderKey: string
  batchNo: string; productCode: string; productName: string | null
  changeType: string; status: string | null
}
const CHANGE_META: Record<string, { label: string; desc: string; cls: string }> = {
  new:     { label: "신규 추가", desc: "생산계획에서 새로 들어온 오더",  cls: "border-blue-200 text-blue-700" },
  updated: { label: "내용 변경", desc: "기존 오더 정보가 갱신됨",        cls: "border-amber-200 text-amber-700" },
  blocked: { label: "변경 차단", desc: "작업 진행·확정 상태라 미반영됨", cls: "border-purple-200 text-purple-700" },
  deleted: { label: "삭제됨",   desc: "생산계획에서 사라져 제외됨",      cls: "border-red-200 text-red-700" },
}
const CHANGE_ORDER = ["new", "updated", "blocked", "deleted"] as const

/** 같은 적재 회차로 묶기 위해 분 단위로 자른 키 */
function runBucket(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
}

/** "방금 전 / N분 전 / N시간 전 / N일 전" */
function relativeKo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "방금 전"
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

function IngestLogModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<IngestLog[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/pct-ingest-log?limit=200`, { credentials: "include" })
        const data = await res.json()
        setRows(data.rows ?? [])
      } finally { setLoading(false) }
    })()
  }, [])

  // 적재 회차(분 단위)로 그룹핑 — 최신순 유지
  const groups = useMemo(() => {
    const map = new Map<string, IngestLog[]>()
    for (const r of rows) {
      const k = runBucket(r.runAt)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return Array.from(map.entries()).map(([bucket, items]) => {
      const counts: Record<string, number> = {}
      for (const it of items) counts[it.changeType] = (counts[it.changeType] ?? 0) + 1
      return { bucket, runAt: items[0].runAt, items, counts }
    })
  }, [rows])

  return (
    <Modal title="적재 이력 (생산계획 가져오기)" onClose={onClose}>
      {loading ? (
        <div className="flex flex-col gap-4 py-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="mb-2 flex items-center gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-12" />
              </div>
              <div className="mb-2 flex gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 2 }).map((_, j) => (
                  <div key={j} className="rounded-lg border bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-14 rounded-full" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                    <div className="mt-1 flex gap-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">아직 적재한 이력이 없습니다.</p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {groups.map(g => {
            const d = new Date(g.runAt)
            const dateLabel = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
            const timeLabel = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
            return (
              <section key={g.bucket}>
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-foreground">{dateLabel} {timeLabel}</span>
                  <span className="text-[11px] text-muted-foreground">{relativeKo(g.runAt)}</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {CHANGE_ORDER.filter(t => g.counts[t]).map(t => (
                    <Badge key={t} variant="outline" className={CHANGE_META[t].cls}>
                      {CHANGE_META[t].label} {g.counts[t]}건
                    </Badge>
                  ))}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {g.items.map(r => {
                    const meta = CHANGE_META[r.changeType] ?? CHANGE_META.new
                    return (
                      <li key={r.id} className="rounded-lg border bg-muted/30 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn("shrink-0", meta.cls)}>{meta.label}</Badge>
                          <span className="truncate text-sm font-semibold text-foreground">{r.productName ?? "(품목명 미확인)"}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>{meta.desc}</span>
                          <span className="text-border">·</span>
                          <span className="font-mono">제조 {r.batchNo || "-"}</span>
                          <span className="text-border">·</span>
                          <span className="font-mono">코드 {r.productCode || "-"}</span>
                          {r.status && (
                            <>
                              <span className="text-border">·</span>
                              <span>당시 상태 {r.status}</span>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// ─── 공용 UI ──────────────────────────────────────────────────────────────────
const inputCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-semibold text-foreground">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// ─── 우측 슬라이드오버(드로어) — 수정 모달용 ─────────────────────────────────────
function SlideOver({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
