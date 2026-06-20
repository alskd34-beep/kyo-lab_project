"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  RefreshCw, Sparkles, History, AlertCircle, Pencil, X, Loader2, Database,
  ChevronDown, ChevronRight, ChevronLeft, Lock, Search, CalendarDays, Users, ListChecks, Layers,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@frontend/components/ui/popover"

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
  workdays: number | null
  hasJob: boolean
  locked: boolean
}
interface Tester { id: string; name: string }
interface EditRow {
  id: string; field: string; oldValue: string | null; newValue: string | null
  reason: string; editedAt: string
}

// 화면에 렌더링할 그룹(주차/담당자/상태 공통 형태)
interface RenderGroup {
  key: string; label: string; color: string; rows: OrderRow[]; meta: string; isThisWeek?: boolean
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
  packagingDate: "포장일", dueDate: "완료예정일", isUrgent: "긴급",
  method: "진행방법", status: "상태", note: "비고", assigneeTesterId: "담당자",
}

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

// 담당자 프로필 이미지가 아직 없어 이름 기반으로 일관된 이모지 아바타를 부여한다.
// (같은 이름은 항상 같은 이모지 → 식별성 유지)
const AVATAR_EMOJIS = ["🧑‍🔬", "👩‍🔬", "🧑‍⚕️", "👨‍⚕️", "🦊", "🐼", "🐯", "🐨", "🐵", "🦁", "🐱", "🐶", "🐧", "🐰"]
function avatarEmoji(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_EMOJIS[h % AVATAR_EMOJIS.length]
}
function AssigneeAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border",
        size === "sm" ? "size-5 text-[12px]" : "size-7 text-[16px]",
      )}
    >
      {avatarEmoji(name)}
    </span>
  )
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

  const [editTarget, setEditTarget] = useState<OrderRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<OrderRow | null>(null)
  const [assigneeTarget, setAssigneeTarget] = useState<{ id: string; name: string } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [families, setFamilies] = useState<{ id: string; name: string; codes: string[] }[]>([])
  const [famCollapsed, setFamCollapsed] = useState<Set<string>>(new Set())

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
      setRows(oData.rows ?? [])
      setTesters((tData.rows ?? []).map((t: Tester) => ({ id: t.id, name: t.name })))
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

  const unsyncedCount = rows.filter(r => !r.productSynced).length

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
      for (const r of scopedRows) pushTo(m, r.assigneeName ?? "__none", r)
      let ci = 0
      return Array.from(m.entries())
        .map(([key, rs]) => ({
          key: `as:${key}`,
          label: key === "__none" ? "미배정" : key,
          color: key === "__none" ? "bg-slate-400" : GROUP_COLORS[ci++ % GROUP_COLORS.length],
          rows: rs,
          meta: `${rs.length}건`,
        }))
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
  const buildRowTree = (groupKey: string, rows: OrderRow[]): RowItem[] => {
    const famRows = new Map<string, OrderRow[]>()
    for (const r of rows) {
      const fam = familyByCode.get(r.productCode)
      if (fam) {
        const arr = famRows.get(fam.id) ?? []; arr.push(r); famRows.set(fam.id, arr)
      }
    }
    // 그룹(동시분석 묶음) 먼저, 그 다음 개별 행 순으로 정렬
    const familyItems: RowItem[] = []
    const singleItems: RowItem[] = []
    const emitted = new Set<string>()
    for (const r of rows) {
      const fam = familyByCode.get(r.productCode)
      const group = fam ? famRows.get(fam.id)! : null
      if (fam && group && group.length >= 2) {
        if (emitted.has(fam.id)) continue
        emitted.add(fam.id)
        familyItems.push({ type: "family", familyId: `${groupKey}::${fam.id}`, familyName: fam.name, rows: group })
      } else {
        singleItems.push({ type: "single", row: r })
      }
    }
    return [...familyItems, ...singleItems]
  }

  // 단일 오더 행 렌더 (트리 들여쓰기 옵션)
  const renderOrderRow = (r: OrderRow, indented = false) => {
    const dueSoon = isDueSoon(r.dueDate, r.status)
    return (
      <TableRow key={r.id} className={cn(dueSoon && "bg-orange-50 hover:bg-orange-100/70", r.locked && "bg-amber-50/40", selected.has(r.id) && "bg-primary/5")}>
        <TableCell className="px-3 py-2.5 text-center">
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
        <TableCell className="px-3 py-2.5 font-medium text-foreground">
          <div className={cn("flex items-center gap-1.5", indented && "pl-6")}>
            {indented && <span className="text-muted-foreground/60">└</span>}
            {r.productName}
            {!r.productSynced && (
              <Badge variant="outline" className="border-amber-200 text-amber-700">미동기화</Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.productCode}</TableCell>
        <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.batchNo}</TableCell>
        <TableCell className="px-3 py-2.5">{r.dosageForm ?? "-"}</TableCell>
        <TableCell className="px-3 py-2.5">{r.packagingDate ?? "-"}</TableCell>
        <TableCell className={cn("px-3 py-2.5", dueSoon && "font-semibold text-orange-700")}>{r.dueDate ?? "-"}</TableCell>
        <TableCell className="px-3 py-2.5">
          {r.isUrgent
            ? <Badge variant="outline" className="border-red-200 text-red-700">긴급</Badge>
            : <span className="text-muted-foreground">일반</span>}
        </TableCell>
        <TableCell className="px-3 py-2.5">{r.method}</TableCell>
        <TableCell className="px-3 py-2.5">{r.workdays != null ? `${r.workdays}일` : "-"}</TableCell>
        <TableCell className="px-3 py-2.5">
          {r.assigneeName && r.assigneeTesterId
            ? <button
                onClick={() => setAssigneeTarget({ id: r.assigneeTesterId!, name: r.assigneeName! })}
                title={`${r.assigneeName} 담당 오더 보기`}
                className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary"
              >
                <AssigneeAvatar name={r.assigneeName} />
                <span className="underline-offset-2 hover:underline">{r.assigneeName}</span>
              </button>
            : <span className="text-muted-foreground">미배정</span>}
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            <StatusBadge status={r.status} />
            {r.locked && (
              <Badge variant="outline" className="gap-0.5 border-amber-200 text-amber-700">
                <Lock className="size-2.5" />확정
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => setHistoryTarget(r)} title="수정이력" className="text-muted-foreground">
              <History />
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="icon-sm" onClick={() => setEditTarget(r)} title="수정" className="text-muted-foreground">
                <Pencil />
              </Button>
            )}
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
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">오더 배정 · 관리</h1>
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
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{msg}</div>
      )}

      {/* 탭 (주차별 / 담당자별 / 상태별) */}
      <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground">
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
      <div className="flex flex-wrap items-center gap-2">
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

      {/* 그룹 카드 */}
      {loading ? (
        <Card className="items-center py-10 text-center text-sm text-muted-foreground">불러오는 중…</Card>
      ) : rows.length === 0 ? (
        <Card className="items-center py-10 text-center text-sm text-muted-foreground">
          적재된 오더가 없습니다. &quot;지금 적재&quot;로 시트를 불러오세요.
        </Card>
      ) : renderGroups.length === 0 ? (
        <Card className="items-center py-10 text-center text-sm text-muted-foreground">
          {search.trim() ? `"${search.trim()}" 검색 결과가 없습니다.` : "해당 기간에 표시할 오더가 없습니다."}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {renderGroups.map(g => {
            const isCollapsed = collapsed.has(g.key)
            return (
              <Card
                key={g.key}
                className={cn("gap-0 py-0", g.isThisWeek && "border-primary/40 ring-1 ring-primary/20")}
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
                    ? <AssigneeAvatar name={g.label} size="md" />
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
                    <Table className="min-w-[920px]">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-12 px-3 text-center text-muted-foreground">확정</TableHead>
                          <TableHead className="px-3 text-muted-foreground">품목명</TableHead>
                          <TableHead className="px-3 text-muted-foreground">품목코드</TableHead>
                          <TableHead className="px-3 text-muted-foreground">제조번호</TableHead>
                          <TableHead className="px-3 text-muted-foreground">제형</TableHead>
                          <TableHead className="px-3 text-muted-foreground">포장일</TableHead>
                          <TableHead className="px-3 text-muted-foreground">완료예정</TableHead>
                          <TableHead className="px-3 text-muted-foreground">긴급</TableHead>
                          <TableHead className="px-3 text-muted-foreground">진행방법</TableHead>
                          <TableHead className="px-3 text-muted-foreground">공수</TableHead>
                          <TableHead className="px-3 text-muted-foreground">담당자</TableHead>
                          <TableHead className="px-3 text-muted-foreground">상태</TableHead>
                          <TableHead className="px-3 text-right text-muted-foreground">관리</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {buildRowTree(g.key, g.rows).map(item => {
                          if (item.type === "single") return renderOrderRow(item.row)
                          const fc = famCollapsed.has(item.familyId)
                          return (
                            <Fragment key={item.familyId}>
                              <TableRow className="bg-primary/5 hover:bg-primary/10">
                                <TableCell colSpan={13} className="px-3 py-2">
                                  <button onClick={() => toggleFamily(item.familyId)} className="flex items-center gap-2 text-left">
                                    {fc
                                      ? <ChevronRight className="size-4 text-muted-foreground" />
                                      : <ChevronDown className="size-4 text-muted-foreground" />}
                                    <Layers className="size-3.5 text-primary" />
                                    <span className="text-sm font-semibold text-foreground">{item.familyName}</span>
                                    <Badge variant="secondary">동시분석 {item.rows.length}건</Badge>
                                  </button>
                                </TableCell>
                              </TableRow>
                              {!fc && item.rows.map(r => renderOrderRow(r, true))}
                            </Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {editTarget && (
        <EditModal
          order={editTarget} testers={testers}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); flash("수정되었습니다."); void load() }}
        />
      )}
      {historyTarget && (
        <HistoryModal order={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
      {assigneeTarget && (
        <AssigneeOrdersModal
          tester={assigneeTarget}
          rows={scopedRows.filter(r => r.assigneeTesterId === assigneeTarget.id)}
          onClose={() => setAssigneeTarget(null)}
        />
      )}
      {showLog && <IngestLogModal onClose={() => setShowLog(false)} />}

      {/* 선택 시 하단 미니 모달 — 확정/해제 */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-lg">
            <span className="px-1 text-sm font-medium text-foreground tabular-nums">{selected.size}건 선택됨</span>
            <span className="h-4 w-px bg-border" />
            <Button size="default" onClick={() => applyLock(true)} disabled={busy === "lock"}>
              {busy === "lock" ? <Loader2 className="animate-spin" /> : <Lock />}확정
            </Button>
            <Button size="default" variant="outline" onClick={() => applyLock(false)} disabled={busy === "lock"}>
              확정 해제
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setSelected(new Set())} title="선택 해제">
              <X />
            </Button>
          </div>
        </div>
      )}
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

// ─── 담당자별 현재 오더 모달 ──────────────────────────────────────────────────
// 진행 중(완료·삭제 제외)을 먼저, 완료·기타는 아래에 별도 표시. 데이터는 화면과 동일 조건.
const ACTIVE_STATUSES = new Set(["대기", "진행중", "검토중", "지연"])

function AssigneeOrdersModal({ tester, rows, onClose }: {
  tester: { id: string; name: string }; rows: OrderRow[]; onClose: () => void
}) {
  const active = rows.filter(r => ACTIVE_STATUSES.has(r.status))
  const others = rows.filter(r => !ACTIVE_STATUSES.has(r.status))
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1; return acc
  }, {})
  const urgentCount = active.filter(r => r.isUrgent).length

  const renderRow = (r: OrderRow) => (
    <li key={r.id} className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{r.productName}</span>
            {r.isUrgent && <Badge variant="outline" className="border-red-200 text-red-700">긴급</Badge>}
            {r.locked && (
              <Badge variant="outline" className="gap-0.5 border-amber-200 text-amber-700">
                <Lock className="size-2.5" />확정
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">제조 {r.batchNo || "-"}</span>
            <span className="text-border">·</span>
            <span>완료예정 {r.dueDate ?? "미정"}</span>
            <span className="text-border">·</span>
            <span>{r.method}</span>
            {r.workdays != null && (
              <>
                <span className="text-border">·</span>
                <span>공수 {r.workdays}일</span>
              </>
            )}
          </div>
        </div>
        <StatusBadge status={r.status} />
      </div>
    </li>
  )

  return (
    <Modal title={`${tester.name} 담당 오더`} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <AssigneeAvatar name={tester.name} size="md" />
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">진행 중 {active.length}건</Badge>
          {urgentCount > 0 && <Badge variant="outline" className="border-red-200 text-red-700">긴급 {urgentCount}건</Badge>}
          {STATUS_OPTIONS.filter(s => counts[s]).map(s => <StatusBadge key={s} status={s} />)}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">현재 맡고 있는 오더가 없습니다.</p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <section>
            <h3 className="mb-1.5 text-xs font-bold text-muted-foreground">진행 중 ({active.length})</h3>
            {active.length === 0 ? (
              <p className="py-3 text-center text-[13px] text-muted-foreground">진행 중인 오더가 없습니다.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">{active.map(renderRow)}</ul>
            )}
          </section>
          {others.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold text-muted-foreground">완료·기타 ({others.length})</h3>
              <ul className="flex flex-col gap-1.5">{others.map(renderRow)}</ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── 수정 모달 (사유 필수) ────────────────────────────────────────────────────
function EditModal({ order, testers, onClose, onSaved }: {
  order: OrderRow; testers: Tester[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
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
    if (!reason.trim()) { setErr("수정 사유는 필수입니다."); return }
    setSaving(true); setErr(null)
    try {
      const patch: Record<string, string | boolean | null> = {
        packagingDate: form.packagingDate || null,
        dueDate: form.dueDate || null,
        isUrgent: form.isUrgent,
        method: form.method,
        status: form.status,
        assigneeTesterId: form.assigneeTesterId || null,
        note: form.note || null,
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
    <Modal title={`오더 수정 — ${order.productName}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="포장일"><input type="date" value={form.packagingDate} onChange={e => setForm({ ...form, packagingDate: e.target.value })} className={inputCls} /></Field>
        <Field label="완료예정일"><input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className={inputCls} /></Field>
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
              {testers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
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
    </Modal>
  )
}

// ─── 수정이력 모달 ────────────────────────────────────────────────────────────
function HistoryModal({ order, onClose }: { order: OrderRow; onClose: () => void }) {
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

  return (
    <Modal title={`수정이력 — ${order.productName}`} onClose={onClose}>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">수정 이력이 없습니다.</p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {rows.map(e => (
            <li key={e.id} className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{FIELD_LABEL[e.field] ?? e.field}</span>
                <span className="text-[11px] text-muted-foreground">{new Date(e.editedAt).toLocaleString("ko-KR")}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="text-muted-foreground line-through">{e.oldValue ?? "(없음)"}</span>
                {" → "}
                <span className="font-medium text-foreground">{e.newValue ?? "(없음)"}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">사유: {e.reason}</p>
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
        <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
