"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { useLockBodyScroll } from "@frontend/hooks/use-lock-body-scroll"
import {
  CalendarDays, Plus, Trash2, X, Loader2, Check, ChevronLeft, ChevronRight, CheckCircle2,
  Sparkles, Lightbulb, Ban, AlertTriangle, Users, FlaskConical,
} from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"

// ─── Types ──────────────────────────────────────────────────────────────────
type ScheduleType = "ANNUAL" | "HALF_DAY" | "BUSINESS_TRIP"

interface ScheduleRow {
  id: string
  userId: string
  userName: string | null
  startDate: string
  endDate: string
  type: ScheduleType
  managerChecked: boolean
  memo: string | null
  createdAt: string
}
interface UserOption { id: string; displayName: string | null; username: string }

interface ProductSuggestion {
  productCode: string
  productName: string
  waitingCount: number
  testItems: string[]
  blockingCapabilities?: string[]
  recoverableBy?: string[]
}
interface SuggestionResult {
  from: string
  to: string
  excludedTesters: { id: string; name: string }[]
  availableTesters: { id: string; name: string }[]
  testable: ProductSuggestion[]
  blockedByLeave: ProductSuggestion[]
  blockedAlways: ProductSuggestion[]
}

const TYPE_LABEL: Record<ScheduleType, string> = {
  ANNUAL: "연차", HALF_DAY: "반차", BUSINESS_TRIP: "출장",
}
const TYPE_CLS: Record<ScheduleType, string> = {
  ANNUAL:        "bg-blue-50 text-blue-700 border-blue-200",
  HALF_DAY:      "bg-amber-50 text-amber-700 border-amber-200",
  BUSINESS_TRIP: "bg-violet-50 text-violet-700 border-violet-200",
}
// Monday 스타일 연속 막대 색(채움)
const TYPE_BAR: Record<ScheduleType, string> = {
  ANNUAL:        "bg-blue-500 hover:bg-blue-600",
  HALF_DAY:      "bg-amber-500 hover:bg-amber-600",
  BUSINESS_TRIP: "bg-violet-500 hover:bg-violet-600",
}

// ─── Date utils (UTC 기준 yyyy-MM-dd) ─────────────────────────────────────────
function iso(d: Date): string { return d.toISOString().slice(0, 10) }
function monthRange(year: number, month: number): { from: string; to: string } {
  // 6주 그리드가 전후 달을 물어 제안/막대가 잘리지 않도록 그리드 시작~끝 기준으로 넉넉히 조회
  const first = new Date(Date.UTC(year, month, 1))
  const startDow = first.getUTCDay()
  const gridStart = new Date(first); gridStart.setUTCDate(first.getUTCDate() - startDow)
  const gridEnd = new Date(gridStart); gridEnd.setUTCDate(gridStart.getUTCDate() + 41)
  return { from: iso(gridStart), to: iso(gridEnd) }
}
function buildCalendar(year: number, month: number): Date[] {
  const first = new Date(Date.UTC(year, month, 1))
  const startDow = first.getUTCDay()
  const gridStart = new Date(first)
  gridStart.setUTCDate(first.getUTCDate() - startDow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setUTCDate(gridStart.getUTCDate() + i)
    return d
  })
}

// 주(7일) 단위 막대 레이아웃 — 겹치지 않게 레인(lane) 배치
interface Seg { row: ScheduleRow; startCol: number; endCol: number; isStart: boolean; isEnd: boolean }
function layoutWeek(weekDays: Date[], rows: ScheduleRow[]): Seg[][] {
  const weekStart = iso(weekDays[0]); const weekEnd = iso(weekDays[6])
  const segs: Seg[] = []
  for (const r of rows) {
    if (r.endDate < weekStart || r.startDate > weekEnd) continue
    const startCol = r.startDate <= weekStart ? 0 : weekDays.findIndex(d => iso(d) === r.startDate)
    const endCol   = r.endDate   >= weekEnd   ? 6 : weekDays.findIndex(d => iso(d) === r.endDate)
    if (startCol < 0 || endCol < 0) continue
    segs.push({ row: r, startCol, endCol, isStart: r.startDate >= weekStart, isEnd: r.endDate <= weekEnd })
  }
  segs.sort((a, b) =>
    a.startCol - b.startCol ||
    a.row.startDate.localeCompare(b.row.startDate) ||
    a.row.id.localeCompare(b.row.id))
  const lanes: Seg[][] = []
  for (const s of segs) {
    const lane = lanes.find(l => l[l.length - 1].endCol < s.startCol)
    if (lane) lane.push(s)
    else lanes.push([s])
  }
  return lanes
}

const DAY_NUM_H = 26
const LANE_H = 22

// ─── Component ────────────────────────────────────────────────────────────────
export default function VacationPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth())
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [addDefaults, setAddDefaults] = useState<{ start: string; end: string } | null>(null)
  const [detail, setDetail] = useState<ScheduleRow | null>(null)
  const [rangeCheck, setRangeCheck] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = monthRange(year, month)
      const res = await fetch(`/api/operator-schedule?from=${from}&to=${to}`, { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
    } finally { setLoading(false) }
  }, [year, month])

  useEffect(() => { void load() }, [load])

  // 관리자만 사용자 목록 조회 (대상 지정용)
  useEffect(() => {
    if (!isAdmin) return
    void fetch("/api/users", { credentials: "include" })
      .then(r => r.json())
      .then(d => setUsers((d.users ?? []).map((u: UserOption) => ({ id: u.id, displayName: u.displayName, username: u.username }))))
      .catch(() => {})
  }, [isAdmin])

  const cells = useMemo(() => buildCalendar(year, month), [year, month])
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)), [cells])

  const prevMonth = () => { const d = new Date(Date.UTC(year, month - 1, 1)); setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth()) }
  const nextMonth = () => { const d = new Date(Date.UTC(year, month + 1, 1)); setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth()) }
  const goToday   = () => { setYear(now.getUTCFullYear()); setMonth(now.getUTCMonth()) }

  const openCreate = (day: string) => setAddDefaults({ start: day, end: day })

  const remove = async (id: string) => {
    if (!confirm("이 일정을 삭제할까요?")) return
    setBusy(id)
    try {
      const res = await fetch(`/api/operator-schedule/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "삭제 실패"); return }
      flash("삭제되었습니다.")
      setDetail(null)
      await load()
    } finally { setBusy(null) }
  }

  const toggleChecked = async (r: ScheduleRow) => {
    setBusy(r.id)
    try {
      const res = await fetch(`/api/operator-schedule/${r.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerChecked: !r.managerChecked }),
      })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "처리 실패"); return }
      const next = { ...r, managerChecked: !r.managerChecked }
      setDetail(d => (d && d.id === r.id ? next : d))
      await load()
    } finally { setBusy(null) }
  }

  const todayIso = iso(now)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-3 md:p-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">휴가 캘린더</h1>
            <p className="text-xs text-slate-500">막대를 클릭하면 그 기간에 가능한 시험 품목을 제안합니다 · 빈 날짜를 클릭해 빠르게 등록</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRangeCheck(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
          >
            <Sparkles size={16} /> 기간 가능 품목
          </button>
          <button
            onClick={() => openCreate(todayIso)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={16} /> 휴가 등록
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">{msg}</div>
      )}

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft size={18} /></button>
          <span className="min-w-32 text-center text-base font-bold text-slate-900">{year}년 {month + 1}월</span>
          <button onClick={nextMonth} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronRight size={18} /></button>
          <button onClick={goToday} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">오늘</button>
        </div>
        {/* 범례 */}
        <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
          {(Object.keys(TYPE_LABEL) as ScheduleType[]).map(t => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${TYPE_BAR[t].split(" ")[0]}`} /> {TYPE_LABEL[t]}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar (Monday 스타일 연속 막대) */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold text-slate-500">
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div key={d} className={`py-2 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}`}>{d}</div>
          ))}
        </div>

        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 6 }).map((_, wi) => (
              <div key={wi} className="grid grid-cols-7" style={{ height: DAY_NUM_H + LANE_H + 6 }}>
                {Array.from({ length: 7 }).map((_, di) => (
                  <div key={di} className="border-r border-slate-100 px-1.5 pt-1 last:border-r-0">
                    <Skeleton className="h-4 w-5" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {weeks.map((week, wi) => {
              const lanes = layoutWeek(week, rows)
              const height = DAY_NUM_H + Math.max(lanes.length, 1) * LANE_H + 6
              return (
                <div key={wi} className="relative" style={{ height }}>
                  {/* 배경 날짜 칸 — 클릭 시 빠른 등록 */}
                  <div className="absolute inset-0 grid grid-cols-7">
                    {week.map((d, di) => {
                      const inMonth = d.getUTCMonth() === month
                      const isToday = iso(d) === todayIso
                      return (
                        <button
                          key={di}
                          onClick={() => openCreate(iso(d))}
                          title="이 날짜로 휴가 등록"
                          className={`border-r border-slate-100 text-left transition-colors last:border-r-0 ${
                            inMonth ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/50 hover:bg-slate-100/60"
                          } ${isToday ? "bg-blue-50/50" : ""}`}
                        />
                      )
                    })}
                  </div>

                  {/* 날짜 숫자 */}
                  <div className="pointer-events-none relative grid grid-cols-7">
                    {week.map((d, di) => {
                      const inMonth = d.getUTCMonth() === month
                      const isToday = iso(d) === todayIso
                      return (
                        <div key={di} className="px-1.5 pt-1">
                          <span className={`inline-flex h-5 min-w-5 items-center justify-center px-1 text-[11px] font-semibold ${
                            isToday ? "rounded-full bg-blue-600 text-white"
                            : inMonth ? (di === 0 ? "text-red-500" : di === 6 ? "text-blue-500" : "text-slate-600")
                            : "text-slate-300"
                          }`}>{d.getUTCDate()}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* 휴가 막대 레인 */}
                  <div className="pointer-events-none relative mt-0.5 flex flex-col gap-0.5">
                    {lanes.map((lane, li) => (
                      <div key={li} className="grid grid-cols-7 gap-x-1 px-1">
                        {lane.map(seg => {
                          const showLabel = seg.isStart || seg.startCol === 0
                          return (
                            <button
                              key={seg.row.id}
                              onClick={() => setDetail(seg.row)}
                              title={`${seg.row.userName ?? ""} · ${TYPE_LABEL[seg.row.type]} · ${seg.row.startDate}~${seg.row.endDate}${seg.row.memo ? ` · ${seg.row.memo}` : ""}`}
                              style={{ gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}` }}
                              className={`pointer-events-auto flex h-[18px] items-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-[10px] font-semibold text-white transition-colors ${TYPE_BAR[seg.row.type]} ${
                                seg.isStart ? "rounded-l-md" : ""} ${seg.isEnd ? "rounded-r-md" : ""}`}
                            >
                              {showLabel && (
                                <>
                                  {seg.row.managerChecked && <Check size={11} className="shrink-0 opacity-90" />}
                                  <span className="truncate">{seg.row.userName ?? "?"} · {TYPE_LABEL[seg.row.type]}</span>
                                </>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 이번 화면 일정 목록 (컴팩트) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          표시 기간 일정 ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">등록된 휴가/출장이 없습니다. 캘린더의 빈 날짜를 클릭해 등록하세요.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => (
              <button
                key={r.id}
                onClick={() => setDetail(r)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
              >
                <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${TYPE_CLS[r.type]}`}>{TYPE_LABEL[r.type]}</span>
                <span className="text-sm font-medium text-slate-800">{r.userName ?? "이름없음"}</span>
                <span className="text-sm text-slate-500">{r.startDate} ~ {r.endDate}</span>
                {r.memo && <span className="text-xs text-slate-400">{r.memo}</span>}
                {r.managerChecked && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <CheckCircle2 size={14} /> 확인됨
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {addDefaults && (
        <AddModal
          isAdmin={isAdmin}
          users={users}
          defaults={addDefaults}
          onClose={() => setAddDefaults(null)}
          onSaved={() => { setAddDefaults(null); void load(); flash("등록되었습니다.") }}
          onError={flash}
        />
      )}

      {detail && (
        <RightDrawer onClose={() => setDetail(null)}>
          <EventDetail
            row={detail}
            isAdmin={isAdmin}
            isOwner={detail.userId === user?.id}
            busy={busy === detail.id}
            onToggleChecked={() => void toggleChecked(detail)}
            onDelete={() => void remove(detail.id)}
          />
          <SuggestionPanel key={`${detail.startDate}-${detail.endDate}`} from={detail.startDate} to={detail.endDate} />
        </RightDrawer>
      )}

      {rangeCheck && (
        <RightDrawer onClose={() => setRangeCheck(false)}>
          <RangeCheck />
        </RightDrawer>
      )}
    </div>
  )
}

// ─── 우측 슬라이드 패널 ──────────────────────────────────────────────────────────
function RightDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useLockBodyScroll()
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto overscroll-contain bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <span className="text-sm font-bold text-slate-900">일정 상세 · 가능 품목</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </div>
    </div>
  )
}

// ─── 일정 상세 (드로어 상단) ───────────────────────────────────────────────────
function EventDetail({
  row, isAdmin, isOwner, busy, onToggleChecked, onDelete,
}: {
  row: ScheduleRow
  isAdmin: boolean
  isOwner: boolean
  busy: boolean
  onToggleChecked: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${TYPE_CLS[row.type]}`}>{TYPE_LABEL[row.type]}</span>
        <span className="text-base font-bold text-slate-900">{row.userName ?? "이름없음"}</span>
      </div>
      <div className="mt-2 text-sm text-slate-600">{row.startDate} ~ {row.endDate}</div>
      {row.memo && <div className="mt-1 text-xs text-slate-500">{row.memo}</div>}
      <div className="mt-3 flex items-center gap-2">
        {row.managerChecked ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600">
            <CheckCircle2 size={14} /> 관리자 확인됨
          </span>
        ) : isAdmin ? (
          <button
            onClick={onToggleChecked}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 확인 처리
          </button>
        ) : (
          <span className="text-xs text-slate-400">관리자 확인 대기</span>
        )}
        {(isAdmin || isOwner) && (
          <button
            onClick={onDelete}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 기간 직접 선택 점검 (드로어) ──────────────────────────────────────────────
function RangeCheck() {
  const today = new Date().toISOString().slice(0, 10)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Sparkles size={15} className="text-blue-600" /> 기간 가용성 점검
        </div>
        <p className="mb-3 text-xs text-slate-500">기간을 정하면 그 기간 휴가/출장으로 빠지는 인원을 빼고, 남은 인원으로 가능한 대기 품목을 제안합니다.</p>
        <DateRangeField
          label="점검 기간"
          startDate={start}
          endDate={end}
          onChange={(s, e) => { setStart(s); setEnd(e || s) }}
        />
      </div>
      {start && end && <SuggestionPanel key={`${start}-${end}`} from={start} to={end} />}
    </>
  )
}

// ─── 가능 품목 제안 패널 ───────────────────────────────────────────────────────
function SuggestionPanel({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<SuggestionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // from/to 변경 시 부모가 key 를 바꿔 리마운트 → loading 초기상태가 곧 로딩 표시.
  useEffect(() => {
    let alive = true
    fetch(`/api/operator-schedule/suggestions?from=${from}&to=${to}`, { credentials: "include" })
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? "조회 실패")
        return d as SuggestionResult
      })
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "조회 실패") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to])

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton className="mb-3 h-4 w-36" />
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex flex-col divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
  }
  if (!data) return null

  return (
    <div className="flex flex-col gap-3">
      {/* 인원 요약 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Users size={15} className="text-slate-500" /> {data.from} ~ {data.to} 인원
        </div>
        {data.excludedTesters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">휴가/출장 제외:</span>
            {data.excludedTesters.map(t => (
              <span key={t.id} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{t.name}</span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500">이 기간에 빠지는 시험자가 없습니다 (전원 가용).</div>
        )}
        <div className="mt-1.5 text-xs text-slate-400">가용 시험자 {data.availableTesters.length}명</div>
      </div>

      {/* 가능 품목 */}
      <Group
        icon={<Lightbulb size={15} className="text-emerald-600" />}
        title="지금 가능한 품목"
        count={data.testable.length}
        tone="emerald"
        empty="가용 인원으로 진행 가능한 대기 품목이 없습니다."
      >
        {data.testable.map(p => (
          <li key={p.productCode} className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{p.productName}</div>
              <div className="truncate text-[11px] text-slate-400">{p.productCode} · {p.testItems.slice(0, 4).join(", ")}{p.testItems.length > 4 ? " 외" : ""}</div>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">대기 {p.waitingCount}</span>
          </li>
        ))}
      </Group>

      {/* 휴가로 불가 */}
      {data.blockedByLeave.length > 0 && (
        <Group
          icon={<AlertTriangle size={15} className="text-amber-600" />}
          title="휴가로 불가 (복귀 시 가능)"
          count={data.blockedByLeave.length}
          tone="amber"
        >
          {data.blockedByLeave.map(p => (
            <li key={p.productCode} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{p.productName}</div>
                  <div className="truncate text-[11px] text-slate-400">{p.productCode}</div>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">대기 {p.waitingCount}</span>
              </div>
              {p.recoverableBy && p.recoverableBy.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-700">복귀 시 가능: {p.recoverableBy.join(", ")}</div>
              )}
              {p.blockingCapabilities && p.blockingCapabilities.length > 0 && (
                <div className="mt-0.5 text-[11px] text-slate-400">부족 역량: {p.blockingCapabilities.join(", ")}</div>
              )}
            </li>
          ))}
        </Group>
      )}

      {/* 자격자 자체 없음 */}
      {data.blockedAlways.length > 0 && (
        <Group
          icon={<Ban size={15} className="text-slate-400" />}
          title="자격 시험자 없음 (휴가 무관)"
          count={data.blockedAlways.length}
          tone="slate"
        >
          {data.blockedAlways.map(p => (
            <li key={p.productCode} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{p.productName}</div>
                  <div className="truncate text-[11px] text-slate-400">{p.productCode}</div>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">대기 {p.waitingCount}</span>
              </div>
              {p.blockingCapabilities && p.blockingCapabilities.length > 0 && (
                <div className="mt-0.5 text-[11px] text-slate-400">부족 역량: {p.blockingCapabilities.join(", ")}</div>
              )}
            </li>
          ))}
        </Group>
      )}
    </div>
  )
}

const GROUP_HEAD: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber:   "border-amber-200 bg-amber-50 text-amber-700",
  slate:   "border-slate-200 bg-slate-50 text-slate-600",
}
function Group({
  icon, title, count, tone, empty, children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  tone: "emerald" | "amber" | "slate"
  empty?: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className={`flex items-center gap-1.5 border-b px-3 py-2 text-xs font-semibold ${GROUP_HEAD[tone]}`}>
        {icon} {title} <span className="ml-auto rounded-full bg-white/70 px-1.5 py-0.5">{count}</span>
      </div>
      {count === 0 && empty ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-400">
          <FlaskConical size={14} /> {empty}
        </div>
      ) : (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">{children}</ul>
      )}
    </div>
  )
}

// ─── 등록 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  isAdmin, users, defaults, onClose, onSaved, onError,
}: {
  isAdmin: boolean
  users: UserOption[]
  defaults: { start: string; end: string }
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  useLockBodyScroll()
  const [userId, setUserId] = useState("")
  const [type, setType] = useState<ScheduleType>("ANNUAL")
  const [startDate, setStartDate] = useState(defaults.start)
  const [endDate, setEndDate] = useState(defaults.end)
  const [memo, setMemo] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!startDate || !endDate) { onError("시작일과 종료일을 입력하세요."); return }
    if (endDate < startDate) { onError("종료일은 시작일 이후여야 합니다."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/operator-schedule", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: isAdmin ? (userId || undefined) : undefined,
          type, startDate, endDate, memo: memo || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); onError(d.error ?? "등록 실패"); return }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">휴가 / 출장 등록</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-3">
          {isAdmin && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">대상자</label>
              <Select value={userId || "self"} onValueChange={v => setUserId(v === "self" ? "" : v)}>
                <SelectTrigger className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                  <SelectValue placeholder="본인 (관리자)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">본인 (관리자)</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.displayName ?? u.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">유형</label>
            <div className="flex gap-2">
              {(Object.keys(TYPE_LABEL) as ScheduleType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    type === t ? TYPE_CLS[t] : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >{TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>

          <DateRangeField
            label="기간 (시작일 ~ 종료일)"
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s)
              setEndDate(e)
            }}
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">메모</label>
            <input
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="선택 입력"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">취소</button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={15} className="animate-spin" />} 등록
          </button>
        </div>
      </div>
    </div>
  )
}
