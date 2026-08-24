"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  RefreshCw, Sparkles, History, AlertCircle, X, Loader2, Database, Plus,
  ChevronDown, ChevronRight, ChevronLeft, Lock, LockOpen, Search, CalendarDays, Users, ListChecks, Layers,
  Check, UserMinus,
} from "lucide-react"
import { CLOSED_STAGE, JOB_STAGES, stageStyle } from "@shared/qc-status"
import { describeConflicts, type TesterAbsence } from "@shared/leave"
import { cn } from "@frontend/lib/utils"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { AssigneeDetailModal } from "@frontend/components/schedule/assignee-detail-modal"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import {
  LeaveChip, LeaveConflictNotice, bulkConflictSummary, conflictsFor, useTesterAbsences,
} from "@frontend/components/schedule/leave-warning"
import { OrderTestItemsSection } from "@frontend/components/schedule/order-test-items-section"
import { TesterAvatar, TesterOptionLabel, primeTesterProfileCache } from "@frontend/lib/tester-profiles"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"
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

// ─── Types ──────────────────────────────────────────────────────────────────
/** 반차와 겹친 자동배정 (서버 AssignResult.halfDayNotices) */
interface HalfDayNotice {
  orderId: string
  productName: string
  batchNo: string
  testerId: string
  testerName: string
  dates: string[]
}

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

// 오더 상태 = 대기 + 작업 단계(진행중→검토전→검토중→승인전→승인완료) + 지연 (types/qc-status.ts)
const STATUS_OPTIONS = ["대기", ...JOB_STAGES, "지연"]
const STATUS_SUMMARY_OPTIONS = ["", ...STATUS_OPTIONS, "삭제"]
const METHOD_OPTIONS = ["전항목", "개별항목"]

// 상태 점 색 (템플릿 스타일의 outline 뱃지 + 컬러 도트)
const statusDot = (s: string) => stageStyle(s).dot

/**
 * 그룹 머리의 점 색.
 *
 * 주차·담당자마다 무지개색을 돌려 쓰면 색이 아무 뜻도 없어 눈만 시끄럽다.
 * 색은 상태 탭(statusDot)에서만 뜻을 갖고, 나머지는 "지금 주간인가"만 말한다.
 */
const DOT_CURRENT = "bg-primary"
const DOT_NEUTRAL = "bg-muted-foreground/40"
const DOT_NONE = "bg-slate-400"

const FIELD_LABEL: Record<string, string> = {
  productCode: "품목코드", productName: "품목명", batchNo: "제조번호", dosageForm: "제형",
  packagingDate: "포장일", dueDate: "완료예정일", isUrgent: "긴급",
  method: "진행방법", status: "상태", note: "비고", assigneeTesterId: "담당자",
}

const AUTO_UNASSIGNED_NOTE_PREFIX = "자동배정 미배정 사유:"

function getAutoUnassignedReason(note: string | null): string | null {
  const line = (note ?? "")
    .split(/\r?\n/)
    .find(value => value.trim().startsWith(AUTO_UNASSIGNED_NOTE_PREFIX))
  if (!line) return null
  const reason = line.trim().slice(AUTO_UNASSIGNED_NOTE_PREFIX.length).trim()
  return reason || null
}

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

// 완료예정일 임박 여부 (오늘 기준 3일 이내·기한 경과 포함, 완료·삭제 제외)
function isDueSoon(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === CLOSED_STAGE || status === "삭제") return false
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
          className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
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
  const { requestConfirm } = useConfirmMessage()
  // 담당자 선택 시 휴가 겹침을 경고하기 위한 부재 목록 (배정을 막지는 않는다)
  const { absences } = useTesterAbsences()

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
  // 자동배정 직후 반차와 겹친 배정 목록 (닫으면 사라지는 확인용 배너)
  const [halfDayNotices, setHalfDayNotices] = useState<HalfDayNotice[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [oRes, tRes, fRes] = await Promise.all([
        fetch("/api/pct-orders", { credentials: "include" }),
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
  }, [])

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

  /**
   * 선택된 오더의 담당자를 일괄 변경한다. testerId=null 이면 배정 해제.
   * 확정(LOCK)된 건은 제외한다(확정 해제된 것만 변경 가능 — 서버에서도 동일하게 막는다).
   */
  const applyAssignTo = async (
    testerId: string | null,
    opts: { busyKey: string; reason: string; onlyAssigned?: boolean },
  ) => {
    const targets = Array.from(selected)
      .map(id => rows.find(x => x.id === id))
      .filter((r): r is OrderRow => !!r && !r.locked && (!opts.onlyAssigned || !!r.assigneeTesterId))
    if (targets.length === 0) {
      flash(opts.onlyAssigned
        ? "해제할 담당자가 있는 미확정 오더가 없습니다."
        : "확정 해제된 오더만 담당자 변경이 가능합니다.")
      return
    }

    // 휴가·출장과 겹치는 배정은 막지 않고 확인만 받는다(현장 예외 허용).
    if (testerId) {
      const conflicted = targets
        .map(r => ({
          label: `${r.productName} (${r.batchNo})`,
          conflicts: conflictsFor(testerId, r, absences),
        }))
        .filter(i => i.conflicts.length > 0)
      if (conflicted.length > 0) {
        const testerName = testers.find(t => t.id === testerId)?.name ?? "담당자"
        const ok = await requestConfirm({
          title: "휴가 기간과 겹칩니다. 그대로 배정할까요?",
          description: (
            <span className="block">
              {testerName} 담당자의 휴가·출장 일정과 겹치는 오더가 {conflicted.length}건 있습니다.
              그대로 배정하면 관리자 알림이 남습니다.
              <span className="mt-2 block whitespace-pre-line rounded-md border bg-muted/50 p-2 font-mono text-xs leading-normal">
                {bulkConflictSummary(conflicted)}
              </span>
            </span>
          ),
          confirmLabel: "그대로 배정",
          variant: "warning",
        })
        if (!ok) return
      }
    }

    setBusy(opts.busyKey)
    try {
      const results = await Promise.all(targets.map(async ({ id }) => {
        const res = await fetch("/api/pct-orders", {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, patch: { assigneeTesterId: testerId }, reason: opts.reason }),
        })
        return { id, ok: res.ok }
      }))
      const okIds = new Set(results.filter(r => r.ok).map(r => r.id))
      const failed = results.length - okIds.size
      const name = testerId ? (testers.find(t => t.id === testerId)?.name ?? "") : "미배정"
      setRows(prev => prev.map(r => okIds.has(r.id)
        ? { ...r, assigneeTesterId: testerId, assigneeName: testerId ? name : null }
        : r))
      setSelected(new Set())
      setBulkTester("")
      const done = testerId ? `담당자 '${name}' 배정 완료` : "배정 해제 완료"
      flash(`${okIds.size}건 ${done}${failed > 0 ? ` (실패 ${failed}건)` : ""}`)
    } catch (e) {
      const what = testerId ? "담당자 배정" : "배정 해제"
      flash(`${what} 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const applyAssign = async () => {
    if (!bulkTester) return
    await applyAssignTo(bulkTester === "none" ? null : bulkTester, {
      busyKey: "assign-bulk",
      reason: bulkTester === "none" ? "일괄 배정 해제" : "일괄 담당자 배정",
    })
  }

  // AI 배정 결과만 지우기 — 오더는 남기고 담당자만 미배정으로 되돌린다
  const applyUnassign = () =>
    applyAssignTo(null, { busyKey: "unassign-bulk", reason: "배정 해제", onlyAssigned: true })

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
      // [반차 확인] 연차·출장은 후보에서 제외되지만 반차는 근무일이라 배정된다.
      // 엔진이 잡아둔 겹침을 관리자가 그대로 둘지 확인할 수 있게 보여준다.
      setHalfDayNotices(data.halfDayNotices ?? [])
      await load()
    } catch (e) {
      flash(`자동배정 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const unsyncedCount = rows.filter(r => r.source === "auto" && !r.productSynced).length

  // ─── 이름 검색 (품목명·담당자·품목코드·제조번호) ──────────────────────────
  const searchRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.productName.toLowerCase().includes(q) ||
      r.productCode.toLowerCase().includes(q) ||
      r.batchNo.toLowerCase().includes(q) ||
      (r.assigneeName ?? "").toLowerCase().includes(q)
    )
  }, [rows, search])

  const filteredRows = useMemo(
    () => statusFilter ? searchRows.filter(r => r.status === statusFilter) : searchRows,
    [searchRows, statusFilter],
  )

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of searchRows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
    return counts
  }, [searchRows])

  // ─── 주차별 그룹 (정렬: 이번주 최상단 → 최신순) ────────────────────────────
  const weekGroups = useMemo(() => {
    const buckets = new Map<string, { label: string; rows: OrderRow[] }>()
    for (const r of filteredRows) {
      const { weekKey, weekLabel } = isoToWeek(r.packagingDate)
      if (!buckets.has(weekKey)) buckets.set(weekKey, { label: weekLabel, rows: [] })
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
    return sorted.map(([key, val]) => ({
      key,
      ...val,
      // 점 색은 주차 번호가 아니라 "이번 주인가"만 말한다
      color: key === tw ? DOT_CURRENT : key === "no-date" ? DOT_NONE : DOT_NEUTRAL,
      isThisWeek: key === tw,
    }))
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
      return Array.from(m.entries())
        .map(([key, rs]) => {
          const assigneeName = rs.find(r => r.assigneeName)?.assigneeName ?? null
          return {
          key: `as:${key}`,
          label: key === "__none" ? "미배정" : assigneeName ?? "이름없음",
          // 배정된 사람 자리는 아바타가 차지한다 — 점 색은 미배정일 때만 보인다
          color: key === "__none" ? DOT_NONE : DOT_NEUTRAL,
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
        color: statusDot(status), rows: rs, meta: `${rs.length}건`,
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
    const byAssigneeThenName = (a: Sortable, b: Sortable) => byKo(a.assignee, b.assignee) || byKo(a.name, b.name)
    familyItems.sort(byAssigneeThenName)
    singleItems.sort(byAssigneeThenName)
    return [...familyItems, ...singleItems].map(x => x.item)
  }

  // 단일 오더 행 렌더 (트리 들여쓰기 옵션)
  const renderOrderCard = (r: OrderRow, indented = false) => {
    const dueSoon = isDueSoon(r.dueDate, r.status)
    const unassignedReason = !r.assigneeName ? getAutoUnassignedReason(r.note) : null
    return (
      <article
        key={r.id}
        /* 카드 전체가 수정 패널을 여는 버튼이다. 안에 체크박스·아이콘 버튼이 들어 있어
           <button> 으로 감쌀 수 없으므로(중첩 금지) role/tabIndex 로 같은 조작을 만든다.
           마우스로만 열리고 키보드로는 못 열던 문제를 여기서 없앤다. */
        role={isAdmin ? "button" : undefined}
        tabIndex={isAdmin ? 0 : undefined}
        aria-label={isAdmin ? `${r.productName} 오더 수정` : undefined}
        onClick={isAdmin ? () => setEditTarget(r) : undefined}
        onKeyDown={isAdmin ? (e) => {
          // 안쪽 체크박스·버튼에서 올라온 키는 무시한다 — 스페이스로 체크하다 수정 패널이 열리지 않게.
          if (e.target !== e.currentTarget) return
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditTarget(r) }
        } : undefined}
        /* min-w-0: 그리드 칸의 기본 최소폭은 내용 크기라, 긴 품목명 한 줄이
           칸을 화면 밖까지 밀어낸다. 0 으로 낮춰야 안쪽 truncate 가 동작한다. */
        className={cn(
          "min-w-0 rounded-md border bg-card p-3 transition-colors",
          isAdmin && "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          /* 기한임박은 이 앱의 경고색인 앰버다. 오렌지는 앰버와 눈으로 구분도 안 되면서
             베이스 밖의 색을 하나 더 늘리기만 했다. 확정(아래)보다 테두리를 한 단 진하게 둔다. */
          dueSoon && "border-amber-300 bg-amber-50/60",
          /* 확정(LOCK)은 승인 성격이라 파랑 램프를 쓴다.
             앰버로 두면 기한임박(앰버)과 겹쳐 급한 건과 확정 건을 못 가른다. */
          r.locked && "border-blue-200 bg-blue-50/40",
          selected.has(r.id) && "border-primary/40 bg-primary/5 ring-1 ring-primary/20",
        )}
      >
        {/* 1번째 구역(체크박스·제목)은 클릭을 흘리지 않는다 — 체크박스를 누르다 수정 패널이 열리는 오작동 방지 */}
        <div className="flex cursor-default items-start gap-2.5" onClick={e => e.stopPropagation()}>
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
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={r.productName}>
                {r.productName}
              </p>
              <SourceBadge source={r.source} />
              {r.source === "auto" && !r.productSynced && (
                <Badge variant="outline" className="border-amber-200 text-amber-700">미동기화</Badge>
              )}
              {r.isUrgent && <Badge variant="outline" className="border-red-200 text-red-700">긴급</Badge>}
            </div>
            {/* 코드·제조번호는 부가정보다 — 품목명과 같은 굵기로 두면 위계가 없어진다 */}
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-normal text-muted-foreground">
              <span className="font-mono tabular-nums">품목코드 {r.productCode}</span>
              <span aria-hidden="true" className="text-border">·</span>
              <span className="font-mono tabular-nums">제조번호 {r.batchNo}</span>
            </div>
          </div>

          {/* icon-sm(31.5px)은 손가락으로 누르기엔 작다 — 터치 타깃을 36px 로 올린다 */}
          <Button
            variant="ghost" size="icon"
            onClick={(e) => { e.stopPropagation(); setHistoryTarget(r) }}
            title="수정이력"
            aria-label={`${r.productName} 수정이력`}
            className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
          >
            <History />
          </Button>
        </div>

        {/* 값은 medium, 라벨은 xs muted — 품목명(semibold)까지 세 단계로 위계를 만든다.
            여섯 칸이 전부 semibold 면 어느 것이 그 카드의 제목인지 읽히지 않는다. */}
        <dl className={cn("mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs leading-normal", isAdmin && "cursor-pointer active:bg-muted/50")}>
          <div className="min-w-0">
            <dt className="text-muted-foreground">제형</dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{r.dosageForm ?? "-"}</dd>
          </div>
          <div className="min-w-0">
            {/* 진행방법은 시트 원본값 — 실제 배정 항목은 수정 패널의 「시험항목」이 정한다 */}
            <dt className="text-muted-foreground">진행방법 (시트)</dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{r.method}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">포장일</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{r.packagingDate ?? "-"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">완료예정</dt>
            <dd className={cn("mt-0.5 text-sm font-medium tabular-nums text-foreground", dueSoon && "font-semibold text-amber-700")}>
              {r.dueDate ?? "-"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">공수</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{r.workdays != null ? `${r.workdays}일` : "-"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">담당자</dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-foreground">
              {r.assigneeName && r.assigneeTesterId
                ? <button
                    onClick={(e) => { e.stopPropagation(); setAssigneeTarget({ id: r.assigneeTesterId!, name: r.assigneeName! }) }}
                    title={`${r.assigneeName} 담당 오더 보기`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <TesterAvatar testerId={r.assigneeTesterId} name={r.assigneeName} size="sm" />
                    <span className="truncate underline-offset-2 hover:underline">{r.assigneeName}</span>
                  </button>
                : <span className="text-muted-foreground">미배정</span>}
            </dd>
          </div>
        </dl>

        {/* 미배정 사유 — 카드 안에 또 카드를 두지 않는다. 실선 하나로 나누고 잉크 색으로만 구분한다 */}
        {unassignedReason && (
          <div className="mt-3 border-t border-amber-200 pt-2.5 text-xs leading-normal text-amber-800">
            <p className="font-medium">미배정 사유</p>
            <p className="mt-0.5 break-keep break-words">{unassignedReason}</p>
          </div>
        )}

        <div className={cn("mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5", isAdmin && "cursor-pointer active:bg-muted/50")}>
          <div className="flex items-center gap-1">
            <StatusBadge status={r.status} />
            {r.locked && (
              <Badge variant="outline" className="gap-0.5 border-amber-200 text-amber-700">
                <Lock className="size-2.5" />확정
              </Badge>
            )}
          </div>
          {isAdmin && <span className="text-xs leading-normal text-muted-foreground">카드를 눌러 수정</span>}
        </div>
      </article>
    )
  }

  // 카운트 라벨 (탭별 단위)
  const groupUnit =
    tab === "week"
      ? (viewMode === "recent" && weekGroups.length > 5 ? `최근 5주 (전체 ${weekGroups.length}주차)` : `${scopedWeekGroups.length}주차`)
      : tab === "assignee" ? `${renderGroups.length}명`
      : `${renderGroups.length}개 상태`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* 헤더 · 조회조건 — 스크롤하지 않음 */}
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">AI 스케줄 · 관리</h1>
          {/* 화면 이름을 되풀이하는 부제 대신, 지금 무엇이 얼마나 있는지를 적는다 */}
          {/* <p> 안에는 <div>(Skeleton)를 넣을 수 없다 — HTML 규격 위반이라
              하이드레이션이 깨진다. 문단이 아니라 값 묶음이므로 div 로 둔다. */}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-normal break-keep text-muted-foreground">
            {loading ? (
              <Skeleton className="h-3 w-56" />
            ) : (
              <>
                <span className="tabular-nums">
                  오더 {rows.length}건
                  <span className="px-1 text-border">·</span>
                  배정 {rows.filter(r => r.assigneeTesterId).length}건
                  <span className="px-1 text-border">·</span>
                  확정 {rows.filter(r => r.locked).length}건
                </span>
                {unsyncedCount > 0 && (
                  <Badge variant="outline" className="gap-1 border-amber-200 text-amber-700">
                    <AlertCircle className="size-3" /> 미동기화 {unsyncedCount}
                  </Badge>
                )}
              </>
            )}
          </div>
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
        <div className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium break-keep text-blue-700">{msg}</div>
      )}

      {/* 반차 겹침 배정 확인 — 연차·출장은 자동배정에서 제외되지만 반차는 근무일이라 배정된다 */}
      {halfDayNotices.length > 0 && (
        <div className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <AlertCircle className="size-3.5" />
                반차 기간과 겹치는 배정 {halfDayNotices.length}건
              </p>
              {/* text-xs(13.5px)가 이 프로젝트의 최소 글자 크기다 — 그보다 작게 줄이지 않는다 */}
              <p className="mt-0.5 text-xs leading-normal break-keep">
                반차는 근무일이라 배정에서 제외하지 않고 가용 공수만 차감했습니다. 그대로 둘지 확인해 주세요.
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5 text-xs leading-normal">
                {halfDayNotices.map(n => (
                  <li key={`${n.orderId}-${n.testerId}`} className="truncate">
                    · {n.productName} ({n.batchNo}) → <strong>{n.testerName}</strong>
                    <span className="ml-1 font-mono tabular-nums">{n.dates.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setHalfDayNotices([])}
              className="shrink-0 rounded-md p-1 text-amber-700 transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              title="닫기"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 탭 (주차별 / 담당자별 / 상태별)
          세 탭을 합치면 300px 남짓이라 320px 폭에서 한 줄에 안 들어간다.
          글자를 줄이지 않고 줄을 바꾼다 — 좁으면 두 줄, sm 부터 한 줄. */}
      <div className="flex w-full shrink-0 flex-wrap items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground sm:inline-flex sm:h-9 sm:w-fit sm:flex-nowrap">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              tab === t.id ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5 shrink-0" />{t.label}
          </button>
        ))}
      </div>

      {/* 상태 요약 — 숫자를 누르면 해당 상태만 즉시 필터링.
          모바일은 3칸(320px 기준 한 칸 ~85px)까지가 한계다. 글자를 줄이는 대신
          타일 높이·여백을 줄여 9칸이 세로로 덜 잡아먹게 한다. */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2 xl:grid-cols-9">
        {STATUS_SUMMARY_OPTIONS.map(status => {
          const active = statusFilter === status
          const count = status ? (statusCounts.get(status) ?? 0) : searchRows.length
          const dot = status ? statusDot(status) : "bg-primary"
          return (
            <button
              key={status || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "flex min-h-14 min-w-0 flex-col justify-center gap-0.5 rounded-md border bg-card px-2 py-1.5 text-left transition-colors",
                "sm:min-h-16 sm:gap-1 sm:px-2.5 sm:py-2",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs leading-normal font-medium text-muted-foreground">
                <span className={cn("size-2 shrink-0 rounded-full", dot)} />
                <span className="min-w-0 truncate">{status || "전체"}</span>
              </span>
              <span className="text-lg font-semibold tabular-nums text-foreground">{count}</span>
            </button>
          )
        })}
      </div>

      {/* 기간·검색 필터 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">

        {/* 보기 모드: 최근 5주 / 연단위 (기간 범위) */}
        <div className="inline-flex h-9 items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
          <button
            type="button"
            aria-pressed={viewMode === "recent"}
            onClick={() => setViewMode("recent")}
            className={cn("h-8 rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              viewMode === "recent" ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
          >
            최근 5주
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "year"}
            onClick={() => setViewMode("year")}
            className={cn("h-8 rounded-md px-3 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              viewMode === "year" ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
          >
            연단위
          </button>
        </div>
        {viewMode === "year" && (
          <YearPicker year={year} years={years} onChange={setYear} />
        )}

        <span className="text-xs leading-normal break-keep text-muted-foreground tabular-nums">
          {search.trim() ? `검색 ${scopedRows.length}건` : `${scopedRows.length}건`} · {groupUnit}
        </span>

        {renderGroups.length > 0 && (
          <Button variant="outline" size="lg" onClick={toggleAll}>
            {allCollapsed ? <ChevronDown /> : <ChevronRight />}
            {allCollapsed ? "전체 펼치기" : "전체 접기"}
          </Button>
        )}

        {/* 이름 검색 — 모바일에선 한 줄을 다 쓴다(w-56=252px 를 320px 폭에 끼워 넣지 않는다) */}
        <div className="relative w-full min-w-0 sm:ml-auto sm:w-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="품목명·담당자·코드·제조번호"
            aria-label="오더 검색"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-7 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-56"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-px flex-1" />
                <Skeleton className="h-3 w-14" />
              </div>
              <div className="grid w-full justify-start grid-cols-[repeat(auto-fit,minmax(min(100%,300px),400px))] gap-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Card key={j} className="gap-3 p-3">
                    <div className="flex items-start gap-2.5">
                      <Skeleton className="size-4 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <Skeleton className="size-7 rounded-md" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 border-t pt-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  </Card>
                ))}
                </div>
            </div>
          ))}
        </div>
        </div>
      ) : rows.length === 0 ? (
        <Card className="min-h-0 flex-1 items-center px-4 py-10 text-center text-sm break-keep text-muted-foreground">
          적재된 오더가 없습니다. &quot;지금 적재&quot;로 시트를 불러오세요.
        </Card>
      ) : renderGroups.length === 0 ? (
        <Card className="min-h-0 flex-1 items-center px-4 py-10 text-center text-sm break-keep text-muted-foreground">
          {search.trim() ? `"${search.trim()}" 검색 결과가 없습니다.` : "해당 기간에 표시할 오더가 없습니다."}
        </Card>
      ) : (
        <div className="relative min-h-0 flex-1 basis-0">
        {/* [&>*]:shrink-0 — 없으면 카드들이 컨테이너 높이에 맞춰 찌그러져 스크롤이 생기지 않는다 */}
        <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto overscroll-contain [&>*]:shrink-0">
          {renderGroups.map(g => {
            const isCollapsed = collapsed.has(g.key)
            return (
              /* 3% 배경 틴트는 보이지도 않으면서 그룹마다 안쪽 여백만 어긋나게 한다.
                 "이번주"는 배지와 점 색(bg-primary)이 이미 말하고 있다. */
              <section key={g.key} className="min-w-0 space-y-2">
                {/* 날짜 기간 구분선 */}
                <div className="flex min-w-0 items-center gap-2 px-1">
                  {tab === "assignee" && g.label !== "미배정"
                    ? <TesterAvatar testerId={g.assigneeTesterId} name={g.label} size="md" />
                    : <span className={cn("size-2 shrink-0 rounded-full", g.color)} />}
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(g.key)}
                    /* inline-flex + min-w-0: 좁은 폭에서 안쪽 truncate 가 실제로 동작하려면
                       버튼 자체가 줄어들 수 있어야 한다(기본 inline-block 은 안 줄어든다). */
                    className="inline-flex min-w-0 items-center rounded-md text-left text-sm font-semibold text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="min-w-0 truncate tabular-nums">{g.label}</span>
                    {g.isThisWeek && <Badge className="ml-2 shrink-0">이번주</Badge>}
                  </button>
                  <span className="h-px flex-1 bg-border" />
                  <span className="shrink-0 text-xs leading-normal text-muted-foreground tabular-nums">{g.meta}</span>
                  <button
                    type="button"
                    aria-label={`${g.label} ${isCollapsed ? "펼치기" : "접기"}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(g.key)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="grid w-full justify-start grid-cols-[repeat(auto-fit,minmax(min(100%,300px),400px))] gap-2 p-0.5">
                    {buildRowTree(g.key, g.rows).map(item => {
                      if (item.type === "single") return renderOrderCard(item.row)
                      const fc = famCollapsed.has(item.familyId)
                      return (
                        /* 테두리를 가진 층은 안쪽 오더 카드 하나뿐이어야 한다 —
                           묶음은 옅은 바탕과 머리줄로만 구분한다(카드 안 카드 방지). */
                        <div key={item.familyId} className="min-w-0 rounded-md bg-primary/5 p-2.5 xl:col-span-2">
                          <button
                            type="button"
                            aria-expanded={!fc}
                            onClick={() => toggleFamily(item.familyId)}
                            className="flex w-full items-center gap-2 rounded-md text-left transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {fc
                              ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                              : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                            <Layers className="size-3.5 shrink-0 text-primary" />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.familyName}</span>
                            {/* 제목 옆 배지로 되풀이하지 않는다 — 건수는 부가정보다 */}
                            <span className="shrink-0 text-xs leading-normal text-muted-foreground tabular-nums">
                              동시분석 {item.rows.length}건
                            </span>
                          </button>
                          {!fc && (
                            <div className="mt-2 grid w-full justify-start grid-cols-[repeat(auto-fit,minmax(min(100%,300px),400px))] gap-2 border-t border-primary/15 pt-2">
                              {item.rows.map(r => renderOrderCard(r, true))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
        </div>
      )}

      {createOpen && (
        <CreateModal
          testers={testers}
          absences={absences}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); flash("오더가 추가되었습니다."); void load() }}
        />
      )}
      {editTarget && (
        <EditModal
          order={editTarget} testers={testers} absences={absences}
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

      {/* 선택 시 하단 미니 모달 — 담당자 배정·해제 / 확정·해제 */}
      {selected.size > 0 && (() => {
        const selectedRows = Array.from(selected).map(id => rows.find(r => r.id === id)).filter((r): r is OrderRow => !!r)
        const lockedCount = selectedRows.filter(r => r.locked).length
        const unlockedCount = selected.size - lockedCount
        // 배정 해제 대상 = 미확정이면서 담당자가 있는 건
        const unassignableCount = selectedRows.filter(r => !r.locked && !!r.assigneeTesterId).length
        return (
          /* 모바일: 요약 → 배정 → 확정 순으로 세로로 쌓는다.
             한 줄에 Select 1개 + 버튼 4개 + 구분선 2개를 밀어 넣으면 320px 에서는
             바가 화면 밖으로 나가 아무 버튼도 누를 수 없다. 구분선은 가로 배치일 때만 쓴다. */
          <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-3 sm:bottom-5 sm:px-4">
            <div className="pointer-events-auto relative flex w-full max-w-3xl flex-col gap-2 rounded-md border border-background/10 bg-foreground px-3 py-2.5 text-background shadow-lg sm:flex-row sm:items-center sm:gap-3 sm:px-4">
              {/* 왼쪽 — 선택 요약. pr-9: 모바일에선 닫기 버튼이 오른쪽 위에 겹쳐 앉는다 */}
              <div className="flex min-w-0 flex-col pr-9 leading-tight sm:flex-1 sm:pr-0">
                <span className="text-sm font-semibold text-background tabular-nums">{selected.size}건 선택됨</span>
                <span className="text-xs leading-normal text-background/60 tabular-nums">확정 {lockedCount} · 미확정 {unlockedCount}</span>
              </div>

              <span className="hidden h-8 w-px shrink-0 bg-background/15 sm:block" />

              {/* 가운데 — 담당자 일괄 배정 (확정 해제된 미확정 건만) */}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-1 sm:flex-nowrap sm:justify-center">
                {unlockedCount === 0 ? (
                  <span className="text-sm font-medium break-keep text-amber-300">확정된 대상은 배정불가합니다.</span>
                ) : (
                  <>
                    <Select value={bulkTester} onValueChange={setBulkTester}>
                      <SelectTrigger className="h-9 w-full border-background/20 bg-background/10 text-background data-placeholder:text-background/60 sm:w-40 [&_svg]:text-background/60"><SelectValue placeholder="담당자 선택" /></SelectTrigger>
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
                      className="flex-1 sm:flex-none"
                    >
                      {busy === "assign-bulk" ? <Loader2 className="animate-spin" /> : <Users />}배정
                    </Button>
                    <Button
                      size="default"
                      variant="outline"
                      onClick={applyUnassign}
                      disabled={busy !== null || unassignableCount === 0}
                      title="선택한 오더의 담당자 배정만 지웁니다 (오더는 그대로 유지)"
                      className="flex-1 border-background/20 bg-transparent text-background hover:bg-background/10 hover:text-background sm:flex-none"
                    >
                      {busy === "unassign-bulk" ? <Loader2 className="animate-spin" /> : <UserMinus />}
                      배정 해제{unassignableCount > 0 ? ` ${unassignableCount}` : ""}
                    </Button>
                  </>
                )}
              </div>

              <span className="hidden h-8 w-px shrink-0 bg-background/15 sm:block" />

              {/* 오른쪽 — 확정 / 확정 해제 */}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-1 sm:flex-nowrap sm:justify-end">
                <Button
                  size="default"
                  onClick={() => applyLock(true)}
                  disabled={busy !== null}
                  className="flex-1 sm:flex-none"
                >
                  {busy === "lock" ? <Loader2 className="animate-spin" /> : <Lock />}확정
                </Button>
                <Button
                  size="default"
                  variant="outline"
                  onClick={() => applyLock(false)}
                  disabled={busy !== null}
                  className="flex-1 border-background/20 bg-transparent text-background hover:bg-background/10 hover:text-background sm:flex-none"
                >
                  <LockOpen />확정 해제
                </Button>
              </div>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => { setSelected(new Set()); setBulkTester("") }}
                title="선택 해제"
                className="absolute top-1.5 right-1.5 shrink-0 text-background/70 hover:bg-background/10 hover:text-background sm:static sm:top-auto sm:right-auto"
              >
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
      <span className={cn("size-1.5 rounded-full", statusDot(status))} />
      {status}
    </Badge>
  )
}

/* 자동/수동은 좋고 나쁨이 아니라 출처다. 대부분이 자동이므로 자동을 중립색으로 두고,
   드문 쪽인 수동에만 잉크(브랜드 파랑)를 남긴다 — 초록은 여기서 뜻이 없었다. */
function SourceBadge({ source }: { source: OrderRow["source"] }) {
  return source === "manual" ? (
    <Badge variant="outline" className="border-blue-200 text-blue-700">수동</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">자동</Badge>
  )
}

// ─── 시험항목 선택 팝업 (진행방법 = 개별항목) ─────────────────────────────────
interface ProductTestItem { testItemId: string; testItemName: string; isMandatory: boolean; sequenceOrder: number }

/**
 * 선택한 품목에 등록된 시험항목을 보여주고 배정할 항목만 고르게 한다.
 * 필수 항목(is_mandatory)은 기본으로 켜 두되, 해제도 가능하게 둔다 —
 * 개별항목 오더는 "일부만 시험한다"는 뜻이라 강제하면 기능이 무의미해진다.
 */
function TestItemPickerDialog({
  productId, productName, initialSelected, onClose, onConfirm,
}: {
  productId: string
  productName: string
  initialSelected: OrderTestItem[]
  onClose: () => void
  onConfirm: (items: OrderTestItem[]) => void
}) {
  const [rows, setRows] = useState<ProductTestItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialSelected.map(i => i.testItemName)),
  )

  useEffect(() => {
    // 팝업은 열 때마다 새로 마운트되므로 error/rows 초기화는 useState 기본값이 담당한다
    let alive = true
    fetch(`/api/product-test-items?productId=${encodeURIComponent(productId)}`, { credentials: "include" })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "불러오기 실패")
        return r.json() as Promise<{ rows: ProductTestItem[] }>
      })
      .then(({ rows }) => {
        if (!alive) return
        setRows(rows)
        // 처음 여는 경우에만 필수 항목을 기본 선택으로 채운다
        if (initialSelected.length === 0) {
          setChecked(new Set(rows.filter(r => r.isMandatory).map(r => r.testItemName)))
        }
      })
      .catch(e => { if (alive) { setRows([]); setError(e instanceof Error ? e.message : "불러오기 실패") } })
    return () => { alive = false }
    // initialSelected 는 열 때 한 번만 반영한다
  }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (name: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })

  const allOn = (rows?.length ?? 0) > 0 && rows!.every(r => checked.has(r.testItemName))
  const toggleAll = () =>
    setChecked(allOn ? new Set() : new Set((rows ?? []).map(r => r.testItemName)))

  const confirm = () => {
    const picked = (rows ?? [])
      .filter(r => checked.has(r.testItemName))
      .map((r, idx) => ({ testItemId: r.testItemId, testItemName: r.testItemName, sequenceOrder: idx }))
    onConfirm(picked)
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent size="lg" className="max-h-[85dvh]">
        <DialogHeader>
          <DialogTitle>시험항목 선택</DialogTitle>
          <DialogDescription>
            {productName} — 배정할 시험항목을 고르세요. 선택한 항목만 담당자에게 배정됩니다.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-2">
          {rows === null ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
            </div>
          ) : error ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-6 text-center text-sm text-amber-800">
              시험항목을 불러오지 못했습니다. {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm break-keep text-muted-foreground">
              이 품목에 등록된 시험항목이 없습니다.
              <br />
              기준 설정 › 품목별 시험항목 관리에서 먼저 등록하세요.
            </p>
          ) : (
            /* 항목마다 테두리를 두르면 칩이 줄지어 선 것처럼 보인다 —
               테두리는 목록 전체에 한 겹만 두고 안쪽은 실선으로 나눈다. */
            <div className="divide-y rounded-md border">
              <label className="flex cursor-pointer items-center gap-2 bg-muted/30 px-3 py-2 text-xs leading-normal font-medium">
                <input type="checkbox" checked={allOn} onChange={toggleAll} className="cb-custom" />
                전체 선택 <span className="tabular-nums">({checked.size}/{rows.length})</span>
              </label>
              <ul className="divide-y">
                {rows.map(r => (
                  <li key={r.testItemId}>
                    <label className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/40",
                      checked.has(r.testItemName) && "bg-primary/5",
                    )}>
                      <input
                        type="checkbox"
                        checked={checked.has(r.testItemName)}
                        onChange={() => toggle(r.testItemName)}
                        className="cb-custom"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.testItemName}</span>
                      {r.isMandatory && (
                        <Badge variant="outline" className="border-amber-200 text-amber-700">필수</Badge>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={confirm} disabled={checked.size === 0}>
            <Check />{checked.size}개 선택 적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 오더 추가 모달 (수동 생성) ───────────────────────────────────────────────
interface ProductHit { id: string; productCode: string; name: string }
interface OrderTestItem { testItemId: string; testItemName: string; sequenceOrder: number }
function CreateModal({ testers, absences, onClose, onCreated }: {
  testers: Tester[]; absences: TesterAbsence[]; onClose: () => void; onCreated: () => void
}) {
  const { requestConfirm } = useConfirmMessage()
  const uid = useId()
  const [form, setForm] = useState({
    productCode: "", productName: "", batchNo: "", dosageForm: "",
    packagingDate: "", dueDate: "", isUrgent: false,
    method: "전항목", status: "대기", assigneeTesterId: "", note: "",
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 진행방법=개별항목 일 때 배정할 시험항목
  const [productId, setProductId] = useState("")
  const [testItems, setTestItems] = useState<OrderTestItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

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
    // 품목이 바뀌면 이전 품목 기준으로 고른 항목은 무효다
    setProductId(p.id)
    setTestItems([])
  }

  // 담당자·날짜가 바뀔 때마다 휴가 겹침을 다시 판정한다
  const leaveConflicts = useMemo(
    () => conflictsFor(
      form.assigneeTesterId || null,
      { packagingDate: form.packagingDate || null, dueDate: form.dueDate || null },
      absences,
    ),
    [form.assigneeTesterId, form.packagingDate, form.dueDate, absences],
  )
  const assigneeName = testers.find(t => t.id === form.assigneeTesterId)?.name ?? "선택한"

  const save = async () => {
    if (!form.productCode.trim() || !form.productName.trim() || !form.batchNo.trim()) {
      setErr("품목코드·품목명·제조번호는 필수입니다."); return
    }
    if (form.method === "개별항목" && testItems.length === 0) {
      setErr("진행방법이 「개별항목」이면 시험항목을 1개 이상 선택하세요."); return
    }
    // 휴가 겹침은 차단하지 않고 확인만 받는다
    if (leaveConflicts.length > 0) {
      const ok = await requestConfirm({
        title: "휴가 기간과 겹칩니다. 그대로 배정할까요?",
        description: `${assigneeName} 담당자는 이 오더의 시험 기간에 ${describeConflicts(leaveConflicts)} 일정이 있습니다. 그대로 저장하면 관리자 알림이 남습니다.`,
        confirmLabel: "그대로 저장",
        variant: "warning",
      })
      if (!ok) return
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
          testItems: form.method === "개별항목" ? testItems : [],
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
    <SlideOver
      title="오더 추가"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="lg" onClick={onClose}>취소</Button>
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}오더 추가
          </Button>
        </>
      }
    >
      <p className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-normal break-keep text-blue-700">
        제조 시트 적재가 아닌 수동 등록 오더입니다. 등록 후 담당자를 지정하세요.
      </p>

      {/* 품목 검색 (자동완성) */}
      <div className="relative mb-3">
        <label htmlFor={`${uid}-productSearch`} className="mb-1 block text-xs font-semibold text-foreground">품목 검색</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id={`${uid}-productSearch`}
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
          <Select
            value={form.method}
            onValueChange={v => {
              setForm({ ...form, method: v })
              // 전항목으로 되돌리면 고른 항목은 의미가 없다
              if (v !== "개별항목") setTestItems([])
            }}
          >
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METHOD_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        {form.method === "개별항목" && (
          <Field label="배정 시험항목" full>
            {!productId ? (
              <p className="rounded-md border border-dashed px-3 py-2.5 text-xs leading-normal break-keep text-muted-foreground">
                먼저 위에서 품목을 검색해 선택하세요. 그 품목에 등록된 시험항목 중에서 고릅니다.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    <ListChecks />시험항목 선택
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {testItems.length > 0
                      ? `${testItems.length}개 선택됨 — 선택한 항목만 배정됩니다.`
                      : "선택된 항목이 없습니다."}
                  </span>
                </div>
                {testItems.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {testItems.map(it => (
                      <Badge key={it.testItemName} variant="secondary" className="font-normal">
                        {it.testItemName}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}
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
                  <LeaveChip
                    conflicts={conflictsFor(
                      t.id,
                      { packagingDate: form.packagingDate || null, dueDate: form.dueDate || null },
                      absences,
                    )}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="비고" full><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputCls} /></Field>
      </div>

      <LeaveConflictNotice conflicts={leaveConflicts} testerName={assigneeName} className="mt-2" />

      {err && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-normal break-keep text-destructive">
          {err}
        </p>
      )}

      {pickerOpen && productId && (
        <TestItemPickerDialog
          productId={productId}
          productName={form.productName}
          initialSelected={testItems}
          onClose={() => setPickerOpen(false)}
          onConfirm={items => { setTestItems(items); setPickerOpen(false); setErr(null) }}
        />
      )}
    </SlideOver>
  )
}

// ─── 수정 모달 (사유 필수) ────────────────────────────────────────────────────
function EditModal({ order, testers, absences, onClose, onSaved }: {
  order: OrderRow; testers: Tester[]; absences: TesterAbsence[]
  onClose: () => void; onSaved: () => void
}) {
  const { requestConfirm } = useConfirmMessage()
  const uid = useId()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
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

  // 담당자·날짜가 바뀔 때마다 휴가 겹침을 다시 판정한다
  const leaveConflicts = useMemo(
    () => conflictsFor(
      form.assigneeTesterId || null,
      { packagingDate: form.packagingDate || null, dueDate: form.dueDate || null },
      absences,
    ),
    [form.assigneeTesterId, form.packagingDate, form.dueDate, absences],
  )
  const assigneeName = testers.find(t => t.id === form.assigneeTesterId)?.name ?? "선택한"
  // 담당자가 그대로면(원래부터 그 사람이면) 다시 확인받지 않는다 — 날짜·비고만 고치는 경우
  const assigneeChanged = (form.assigneeTesterId || null) !== (order.assigneeTesterId ?? null)

  const save = async () => {
    if (!isAutoOrder && (!form.productCode.trim() || !form.productName.trim() || !form.batchNo.trim())) {
      setErr("품목코드·품목명·제조번호는 비울 수 없습니다."); return
    }
    if (!reason.trim()) { setErr("수정 사유는 필수입니다."); return }
    // 휴가 겹침은 차단하지 않고 확인만 받는다
    if (leaveConflicts.length > 0 && assigneeChanged) {
      const ok = await requestConfirm({
        title: "휴가 기간과 겹칩니다. 그대로 배정할까요?",
        description: `${assigneeName} 담당자는 이 오더의 시험 기간에 ${describeConflicts(leaveConflicts)} 일정이 있습니다. 그대로 저장하면 관리자 알림이 남습니다.`,
        confirmLabel: "그대로 저장",
        variant: "warning",
      })
      if (!ok) return
    }
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
    <SlideOver
      title={`오더 수정 — ${order.productName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="lg" onClick={onClose}>취소</Button>
          <Button size="lg" onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}저장
          </Button>
        </>
      }
    >
      <p className={cn(
        "mb-3 rounded-md border px-3 py-2 text-xs leading-normal break-keep",
        isAutoOrder
          /* SourceBadge 와 같은 규칙 — 자동은 중립, 수동만 파랑 */
          ? "bg-muted text-muted-foreground"
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
        {/*
          진행방법은 제조 시트에서 들어온 원본값이라 여기서 고르지 않는다(읽기 전용).
          무엇을 배정할지는 아래 「시험항목」 목록이 결정한다.
        */}
        <Field label="진행방법 (시트 원본)">
          <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted px-3">
            <span className="truncate text-sm text-muted-foreground">{order.method || "-"}</span>
          </div>
        </Field>
        <Field label="상태">
          <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {/* 담당자 — '미배정' 선택이 곧 배정 해제. 확정(LOCK)된 오더는 변경 불가(원칙3) */}
        <Field label="담당자">
          <Select
            value={form.assigneeTesterId || "none"}
            disabled={order.locked}
            onValueChange={v => setForm({ ...form, assigneeTesterId: v === "none" ? "" : v })}
          >
            <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">미배정</SelectItem>
              {assignableTesters(testers, form.assigneeTesterId).map(t => (
                <SelectItem key={t.id} value={t.id}>
                  <TesterOptionLabel testerId={t.id} name={t.name} />
                  <LeaveChip
                    conflicts={conflictsFor(
                      t.id,
                      { packagingDate: form.packagingDate || null, dueDate: form.dueDate || null },
                      absences,
                    )}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {order.locked && (
            <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
              확정(LOCK)된 오더입니다. 확정 해제 후 배정을 변경·해제할 수 있습니다.
            </p>
          )}
        </Field>
        <Field label="비고" full><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputCls} /></Field>
      </div>

      <LeaveConflictNotice conflicts={leaveConflicts} testerName={assigneeName} className="mt-3" />

      {/*
        시험항목 가감 — 위 폼(저장 버튼)과 달리 체크할 때마다 즉시 서버에 반영된다.
        품목 기준은 그대로 두고 이 오더에서만 빼거나 더한다.
      */}
      <OrderTestItemsSection
        orderId={order.id}
        productName={order.productName}
        canEdit={isAdmin && !order.locked}
        locked={order.locked}
      />

      <div className="mt-3">
        <label htmlFor={`${uid}-reason`} className="mb-1 block text-xs font-semibold text-foreground">수정 사유 <span className="text-red-500">*</span></label>
        <textarea id={`${uid}-reason`} value={reason} onChange={e => setReason(e.target.value)} rows={2}
          placeholder="변경 사유를 입력하세요 (필수)"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" />
      </div>

      {err && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-normal break-keep text-destructive">
          {err}
        </p>
      )}

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
            <div key={i} className="rounded-md border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-5 w-10 rounded-md" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-14 rounded-md" />
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
        <ul className="flex flex-col gap-2.5">
          {sessions.map((s, i) => (
            <li key={s.key} className="rounded-md border px-3 py-2.5">
              {/* 헤더: 작성자 · 시각 · 변경 필드 수 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="inline-flex shrink-0 items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs leading-normal font-semibold text-primary tabular-nums">
                    {sessions.length - i}회차
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{s.editorName ?? "시스템/미상"}</span>
                  {/* 건수는 배지가 아니라 부가정보로 — 배지는 상태를 말할 때만 쓴다 */}
                  <span className="shrink-0 text-xs leading-normal text-muted-foreground tabular-nums">{s.edits.length}개 변경</span>
                </div>
                <span className="shrink-0 text-xs leading-normal text-muted-foreground tabular-nums">
                  {new Date(s.editedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>

              {/* 필드별 변경 내역 */}
              <div className="mt-2 flex flex-col gap-1.5">
                {s.edits.map(e => (
                  <div key={e.id} className="grid grid-cols-[auto_1fr] items-baseline gap-2 text-xs">
                    <span className="rounded-md bg-card px-1.5 py-0.5 font-medium text-muted-foreground ring-1 ring-border">
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
/* 적재 상태(ingest_state)는 서버가 주는 값이라 여기 없는 키가 올 수 있다.
   타입이 Record<string, ...> 이라 컴파일러도 못 잡아 준다 - 조회는 반드시
   changeMeta() 를 거쳐 기본값을 받는다(값 하나에 화면 전체가 죽지 않도록). */
const CHANGE_META: Record<string, { label: string; desc: string; cls: string }> = {
  new:     { label: "신규 추가", desc: "생산계획에서 새로 들어온 오더",  cls: "border-blue-200 text-blue-700" },
  updated: { label: "내용 변경", desc: "기존 오더 정보가 갱신됨",        cls: "border-amber-200 text-amber-700" },
  blocked: { label: "변경 차단", desc: "작업 진행·확정 상태라 미반영됨", cls: "border-blue-200 text-blue-700" },
  deleted: { label: "삭제됨",   desc: "생산계획에서 사라져 제외됨",      cls: "border-red-200 text-red-700" },
}

function changeMeta(key: string): { label: string; desc: string; cls: string } {
  return CHANGE_META[key] ?? { label: key || '기타', desc: '알 수 없는 변경 유형', cls: 'border-border text-muted-foreground' }
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
                <Skeleton className="h-5 w-16 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
              <div className="divide-y rounded-md border">
                {Array.from({ length: 2 }).map((_, j) => (
                  <div key={j} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-14 rounded-md" />
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
        <div className="flex flex-col gap-4">
          {groups.map(g => {
            const d = new Date(g.runAt)
            const dateLabel = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
            const timeLabel = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
            return (
              <section key={g.bucket}>
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-foreground tabular-nums">{dateLabel} {timeLabel}</span>
                  <span className="text-xs leading-normal text-muted-foreground">{relativeKo(g.runAt)}</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {CHANGE_ORDER.filter(t => g.counts[t]).map(t => (
                    <Badge key={t} variant="outline" className={changeMeta(t).cls}>
                      {changeMeta(t).label} {g.counts[t]}건
                    </Badge>
                  ))}
                </div>
                {/* 같은 모양의 행이 죽 이어지는 목록이다 — 칸마다 테두리를 두르는 대신 실선 하나로 나눈다 */}
                <ul className="divide-y rounded-md border">
                  {g.items.map(r => {
                    const meta = CHANGE_META[r.changeType] ?? CHANGE_META.new
                    return (
                      <li key={r.id} className="min-w-0 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className={cn("shrink-0", meta.cls)}>{meta.label}</Badge>
                          <span className="min-w-0 truncate text-sm font-medium text-foreground">{r.productName ?? "(품목명 미확인)"}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal break-keep text-muted-foreground">
                          <span>{meta.desc}</span>
                          <span className="text-border">·</span>
                          <span className="font-mono tabular-nums">제조 {r.batchNo || "-"}</span>
                          <span className="text-border">·</span>
                          <span className="font-mono tabular-nums">코드 {r.productCode || "-"}</span>
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
      {/* 라벨이 컨트롤을 감싸 암묵적으로 연결된다(별도 id 불필요). */}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-foreground">{label}</span>
        {children}
      </label>
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <ManagementDrawer
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      size="lg"
      title={title}
      description={title}
      footer={<Button variant="outline" onClick={onClose}>닫기</Button>}
    >
      {children}
    </ManagementDrawer>
  )
}

// ─── 우측 슬라이드오버(드로어) — 수정 모달용 ─────────────────────────────────────
function SlideOver({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <ManagementDrawer
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      size="lg"
      title={title}
      description={title}
      footer={footer}
    >
      {children}
    </ManagementDrawer>
  )
}
