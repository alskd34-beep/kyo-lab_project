"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  Plus, Trash2, Loader2, Check, ChevronLeft, ChevronRight, CheckCircle2,
  Sparkles, Users,
} from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"

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
/* 연차와 출장이 같은 파랑이라 캘린더에서 둘을 구분할 수 없었다.
   출장은 휴가가 아니라 성격이 다른 일정이므로 중립색(slate)으로 떼어 놓는다. */
/* 연한 칩은 밝은 배경을 전제하므로 다크에선 명도를 뒤집은 짝을 함께 준다(색상은 그대로).
   출장의 중립색은 회색이라 색 램프 대신 시맨틱 토큰으로 간다. */
const TYPE_CLS: Record<ScheduleType, string> = {
  ANNUAL:        "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  HALF_DAY:      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  BUSINESS_TRIP: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-muted dark:text-muted-foreground dark:border-border",
}
// 연속 막대 색(채움)
/*
 * 막대 채움색. 흰 글자를 얹으므로 600 대를 쓴다 —
 * 500 대에서는 흰 글자가 amber 2.1:1 · blue 3.8:1 로 본문 기준(4.5:1)에
 * 한참 못 미쳐 막대 안 이름이 읽히지 않았다.
 */
const TYPE_BAR: Record<ScheduleType, string> = {
  ANNUAL:        "bg-blue-600 hover:bg-blue-700",
  HALF_DAY:      "bg-amber-700 hover:bg-amber-800",
  BUSINESS_TRIP: "bg-slate-600 hover:bg-slate-700",
}
/**
 * 막대·범례·목록이 같은 색을 쓰도록 채움 색만 떼어 낸다(hover 변주 제외).
 * 서버가 예상 밖의 유형을 내려도 화면이 죽지 않게 기본값을 둔다 —
 * 폴백이 없으면 값 하나가 어긋나는 순간 `.split()` 에서 페이지 전체가 흰 화면이 된다.
 */
function typeDot(t: ScheduleType): string {
  return (TYPE_BAR[t] ?? "bg-muted-foreground").split(" ")[0]
}

const DOW_KOR = ["일", "월", "화", "수", "목", "금", "토"] as const

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
const HOLIDAY_H = 16 // 공휴일 라벨 줄 높이(공휴일이 있는 주에만 가산)

// ─── Component ────────────────────────────────────────────────────────────────
export default function VacationPage() {
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
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
  // 공휴일(읽기 전용): 날짜(yyyy-MM-dd) → 명칭. public_holidays 를 기존 API 로만 읽는다.
  const [holidays, setHolidays] = useState<Record<string, string>>({})

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

  // 공휴일 조회(읽기 전용): 현재 표시 범위(그리드)에 걸치는 연도를 기존 API 로 가져와 병합.
  // 월 뷰가 연도 경계를 걸칠 수 있으므로 단일 연도로 가정하지 않는다(예: 12월~다음해 1월).
  useEffect(() => {
    const { from, to } = monthRange(year, month)
    const years = Array.from(new Set([from.slice(0, 4), to.slice(0, 4)])).map(Number)
    let alive = true
    void Promise.all(
      years.map(y =>
        fetch(`/api/holidays?year=${y}`, { credentials: "include" })
          .then(r => (r.ok ? r.json() : { rows: [] }))
          .catch(() => ({ rows: [] })),
      ),
    ).then(results => {
      if (!alive) return
      const map: Record<string, string> = {}
      for (const res of results) {
        for (const h of (res.rows ?? []) as { date: string; description: string }[]) {
          // 실제 표시 범위만 보관(api/manual 구분 없이 전부)
          if (h.date >= from && h.date <= to) map[h.date] = h.description || "공휴일"
        }
      }
      setHolidays(map)
    })
    return () => { alive = false }
  }, [year, month])

  const cells = useMemo(() => buildCalendar(year, month), [year, month])
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)), [cells])

  /* 모바일용 날짜별 묶음 — 320px 에서 한 칸이 41px 라 날짜 숫자도 막대 라벨도 잘린다.
     그리드를 억지로 줄이는 대신 같은 데이터를 "날짜 → 그 날의 일정" 목록으로 편다.
     이 달에 속하면서 일정이나 공휴일이 있는 날만 남긴다(빈 날 31줄은 목록이 아니라 소음이다). */
  const monthDays = useMemo(() => {
    return cells
      .filter(d => d.getUTCMonth() === month)
      .map(d => {
        const ds = iso(d)
        return {
          ds,
          dayNum: d.getUTCDate(),
          dow: d.getUTCDay(),
          holiday: holidays[ds],
          items: rows
            .filter(r => r.startDate <= ds && ds <= r.endDate)
            .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)),
        }
      })
      .filter(d => d.items.length > 0 || d.holiday)
  }, [cells, month, rows, holidays])

  const prevMonth = () => { const d = new Date(Date.UTC(year, month - 1, 1)); setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth()) }
  const nextMonth = () => { const d = new Date(Date.UTC(year, month + 1, 1)); setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth()) }
  const goToday   = () => { setYear(now.getUTCFullYear()); setMonth(now.getUTCMonth()) }

  const openCreate = (day: string) => setAddDefaults({ start: day, end: day })

  const remove = async (id: string) => {
    const target = rows.find(row => row.id === id)
    const confirmed = await requestConfirm({
      title: "휴가 일정을 삭제할까요?",
      description: target
        ? `${target.userName ?? "사용자"}의 ${target.startDate} ~ ${target.endDate} 일정을 삭제합니다.`
        : "선택한 휴가 일정을 삭제합니다.",
      confirmLabel: "일정 삭제",
      variant: "danger",
    })
    if (!confirmed) return

    setBusy(id)
    try {
      const res = await fetch(`/api/operator-schedule/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "삭제 실패"); return }
      flash("삭제되었습니다.")
      setDetail(null)
      setRows(prev => prev.filter(row => row.id !== id))
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
    /* 본문 영역이 overflow-hidden 이라 화면이 스스로 스크롤을 가져야 한다.
       min-h-0 · flex-1 · overflow-y-auto 가 없으면 아래 표가 화면 밖에서 잘린다. */
    <div className="mx-auto flex min-h-0 w-full max-w-6xl min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* ── 페이지 머리 ────────────────────────────────────────────────────
          파란 아이콘 사각형은 제목을 그림으로 되풀이하는 장식이라 걷어냈다.
          부제는 이 화면의 조작법이라 사실이므로 남긴다. */}
      <header className="flex min-w-0 shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">휴가 캘린더</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            막대를 누르면 그 기간에 가능한 시험 품목을 제안합니다
            <span className="px-1 text-border">·</span>
            빈 날짜를 누르면 바로 등록됩니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => setRangeCheck(true)}>
            <Sparkles /> 기간 가능 품목
          </Button>
          <Button size="lg" onClick={() => openCreate(todayIso)}>
            <Plus /> 휴가 등록
          </Button>
        </div>
      </header>

      {msg && (
        <p className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs break-keep text-primary">{msg}</p>
      )}

      {/* Month nav */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" type="button" onClick={prevMonth} aria-label="이전 달"><ChevronLeft /></Button>
          <span className="min-w-28 text-center text-sm font-semibold tabular-nums text-foreground">{year}년 {month + 1}월</span>
          <Button variant="ghost" size="icon" type="button" onClick={nextMonth} aria-label="다음 달"><ChevronRight /></Button>
          <Button variant="outline" size="sm" type="button" onClick={goToday} className="ml-1">오늘</Button>
        </div>
        {/* 범례 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-normal text-muted-foreground">
          {(Object.keys(TYPE_LABEL) as ScheduleType[]).map(t => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className={`size-2.5 rounded-md ${typeDot(t)}`} /> {TYPE_LABEL[t]}
            </span>
          ))}
          {/* 공휴일 rose 는 뜻이 곧 색이다 — 일요일(destructive)과 겹치지 않게 일부러 다른 빨강을 쓴다 */}
          <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-300">
            <span className="size-2.5 rounded-md bg-rose-500" /> 공휴일
          </span>
        </div>
      </div>

      {/* shrink-0: Card 는 overflow-hidden 이라 flex 열 안에서 높이가 0 으로 눌린다 */}
      <Card className="shrink-0 gap-0 py-0">
        {/* ── 모바일(sm 미만) — 달력을 날짜별 목록으로 편다 ────────────────────
            320px 에서 한 칸은 41px 다. 날짜 숫자도 "이름 · 유형" 막대도 잘려서 달력이
            달력 노릇을 못 한다. 글자를 줄이는 대신(13.5px 이 최소다) 격자를 세로로 편다.
            데이터·유형 색은 그리드와 같은 것을 쓰고, 날짜 줄을 누르면 그 날짜로 등록한다. */}
        <div className="divide-y sm:hidden">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 px-4 py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))
          ) : monthDays.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm break-keep text-muted-foreground">
              <span className="tabular-nums">{year}년 {month + 1}월</span>에 등록된 휴가/출장이 없습니다.
              위 &lsquo;휴가 등록&rsquo; 버튼으로 추가하세요.
            </p>
          ) : (
            monthDays.map(day => (
              <div key={day.ds}>
                {/* 날짜 줄 — 달력의 "빈 날짜를 눌러 등록"을 목록에서도 이어 간다 */}
                <button
                  type="button"
                  onClick={() => openCreate(day.ds)}
                  aria-label={`${day.ds} 휴가 등록`}
                  className="flex min-h-9 w-full min-w-0 items-center gap-2 bg-muted/40 px-4 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                >
                  {/* 요일 색은 뜻이라 그대로 둔다(일=destructive · 토=primary · 공휴일=rose) */}
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${
                    day.ds === todayIso ? "text-primary"
                    : day.holiday ? "text-rose-600 dark:text-rose-300"
                    : day.dow === 0 ? "text-destructive"
                    : day.dow === 6 ? "text-primary"
                    : "text-foreground"
                  }`}>
                    {month + 1}월 {day.dayNum}일
                  </span>
                  <span className="shrink-0 text-xs leading-normal text-muted-foreground">({DOW_KOR[day.dow]})</span>
                  {day.ds === todayIso && (
                    <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-xs leading-normal font-medium text-primary-foreground">오늘</span>
                  )}
                  {day.holiday && (
                    <span className="min-w-0 truncate text-xs leading-normal font-medium text-rose-600 dark:text-rose-300">{day.holiday}</span>
                  )}
                  <Plus size={14} className="ml-auto shrink-0 text-muted-foreground" />
                </button>

                {day.items.length === 0 ? (
                  <p className="px-4 py-2 text-xs leading-normal break-keep text-muted-foreground">이 날 등록된 일정 없음</p>
                ) : (
                  <ul className="divide-y">
                    {day.items.map(r => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          aria-label={`${r.userName ?? "이름없음"} ${TYPE_LABEL[r.type]} ${r.startDate} ~ ${r.endDate} 상세 보기`}
                          className="flex min-h-9 w-full min-w-0 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                        >
                          <span className={`size-2 shrink-0 rounded-full ${typeDot(r.type)}`} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.userName ?? "이름없음"}</span>
                          <span className="shrink-0 text-xs leading-normal text-muted-foreground">{TYPE_LABEL[r.type]}</span>
                          {/* 하루짜리는 위 날짜 줄이 이미 말했다 — 여러 날 걸칠 때만 기간을 덧붙인다 */}
                          {r.startDate !== r.endDate && (
                            <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">
                              {r.startDate.slice(5)}~{r.endDate.slice(5)}
                            </span>
                          )}
                          {/* 관리자 확인은 '승인'이라 이 프로젝트의 승인색(짙은 파랑)을 쓴다.
                              연차 막대의 blue-500 과는 농도가 달라 섞이지 않는다. */}
                          {r.managerChecked && <CheckCircle2 size={13} className="shrink-0 text-blue-700 dark:text-blue-300" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>

        {/* ── sm 이상 — 달력 그리드 ─────────────────────────────────────────
            요일 7칸은 의미상 줄일 수 없다. 640px 부터 한 칸이 80px 을 넘어 읽히므로
            그 위로만 격자를 쓴다. grid-cols-7 은 repeat(7, minmax(0,1fr)) 이라 밖으로 밀리지 않는다. */}
        <div className="hidden sm:block">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs leading-normal font-medium text-muted-foreground">
          {DOW_KOR.map((d, i) => (
            <div key={d} className={`py-2 ${i === 0 ? "text-destructive" : i === 6 ? "text-primary" : ""}`}>{d}</div>
          ))}
        </div>

        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, wi) => (
              <div key={wi} className="grid grid-cols-7" style={{ height: DAY_NUM_H + LANE_H + 6 }}>
                {Array.from({ length: 7 }).map((_, di) => (
                  <div key={di} className="border-r px-1.5 pt-1 last:border-r-0">
                    <Skeleton className="h-4 w-5" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {weeks.map((week, wi) => {
              const lanes = layoutWeek(week, rows)
              const weekHasHoliday = week.some(d => holidays[iso(d)])
              const dayBlockH = DAY_NUM_H + (weekHasHoliday ? HOLIDAY_H : 0)
              const height = dayBlockH + Math.max(lanes.length, 1) * LANE_H + 6
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
                          type="button"
                          onClick={() => openCreate(iso(d))}
                          title="이 날짜로 휴가 등록"
                          aria-label={`${iso(d)} 휴가 등록`}
                          className={`border-r text-left transition-colors last:border-r-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none ${
                            inMonth ? "bg-card hover:bg-muted/60" : "bg-muted/30 hover:bg-muted/60"
                          } ${isToday ? "bg-primary/5" : ""}`}
                        />
                      )
                    })}
                  </div>

                  {/* 날짜 숫자 */}
                  <div className="pointer-events-none relative grid grid-cols-7">
                    {week.map((d, di) => {
                      const inMonth = d.getUTCMonth() === month
                      const isToday = iso(d) === todayIso
                      const holidayName = holidays[iso(d)]
                      return (
                        <div key={di} className="px-1.5 pt-1">
                          {/* 요일 색은 뜻이 있어 그대로 두되, 머리글 줄(일=destructive·토=primary)과 같은 색으로 맞춘다. */}
                          <span className={`inline-flex h-5 min-w-5 items-center justify-center px-1 text-xs leading-normal font-semibold tabular-nums ${
                            isToday ? "rounded-md bg-primary text-primary-foreground"
                            : holidayName ? "text-rose-600 dark:text-rose-300"
                            : inMonth ? (di === 0 ? "text-destructive" : di === 6 ? "text-primary" : "text-foreground")
                            : "text-muted-foreground/50"
                          }`}>{d.getUTCDate()}</span>
                          {holidayName && (
                            <div
                              title={holidayName}
                              /* leading-tight 유지: HOLIDAY_H(16px)에 맞춘 줄 높이라 늘리면 주 높이가 어긋난다 */
                              /* 다른 달 칸은 흐리게 두는 자리다 — 다크에선 명도가 뒤집혀 rose-700 이 그 자리를 맡는다 */
                              className={`mt-0.5 truncate text-xs leading-tight font-medium ${inMonth ? "text-rose-600 dark:text-rose-300" : "text-rose-300 dark:text-rose-700"}`}
                            >
                              {holidayName}
                            </div>
                          )}
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
                              type="button"
                              onClick={() => setDetail(seg.row)}
                              title={`${seg.row.userName ?? ""} · ${TYPE_LABEL[seg.row.type]} · ${seg.row.startDate}~${seg.row.endDate}${seg.row.memo ? ` · ${seg.row.memo}` : ""}`}
                              style={{ gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}` }}
                              className={`pointer-events-auto flex h-[18px] min-w-0 items-center gap-1 overflow-hidden px-1.5 text-xs leading-normal font-medium whitespace-nowrap text-white transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${TYPE_BAR[seg.row.type] ?? "bg-muted-foreground"} ${
                                seg.isStart ? "rounded-l-md" : ""} ${seg.isEnd ? "rounded-r-md" : ""}`}
                            >
                              {showLabel && (
                                <>
                                  {seg.row.managerChecked && <Check size={11} className="shrink-0 opacity-90" />}
                                  {/* min-w-0: flex 자식은 최소폭이 내용 크기라, 없으면 truncate 가 먹지 않고
                                      좁은 폭에서 막대가 칸 밖으로 밀린다. 320px 에서 특히. */}
                                  <span className="min-w-0 truncate">{seg.row.userName ?? "?"} · {TYPE_LABEL[seg.row.type]}</span>
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
      </Card>

      <Card className="shrink-0 gap-0 py-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">표시 기간 일정</h2>
          <p className="text-xs leading-normal text-muted-foreground">
            <span className="tabular-nums">{year}년 {month + 1}월</span> 기준
            {!loading && (
              <>
                <span className="px-1 text-border">·</span>
                <span className="font-semibold tabular-nums text-foreground">{rows.length}</span>건
              </>
            )}
          </p>
        </div>
        {/* ── 모바일 — 표를 표로 두지 않는다 ────────────────────────────────
            다섯 열 대신 이름을 주 값으로 올리고 유형·기간·확인 여부만 남긴다. */}
        <div className="divide-y md:hidden">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-40" />
                </div>
              ))
            : rows.length === 0
              ? (
                  <p className="px-4 py-12 text-center text-sm break-keep text-muted-foreground">
                    등록된 휴가/출장이 없습니다. 캘린더의 빈 날짜를 눌러 등록하세요.
                  </p>
                )
              : rows.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setDetail(r)}
                    className="flex w-full min-w-0 flex-col px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {r.userName ?? "이름없음"}
                      </span>
                      <Badge variant="outline" className="shrink-0">{TYPE_LABEL[r.type]}</Badge>
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                      <span className="font-mono tabular-nums">{r.startDate} ~ {r.endDate}</span>
                      {r.managerChecked && (
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-blue-700 dark:text-blue-300">
                          <CheckCircle2 size={13} /> 확인됨
                        </span>
                      )}
                    </span>
                    {r.memo && (
                      <span className="mt-0.5 truncate text-xs leading-normal break-keep text-muted-foreground">{r.memo}</span>
                    )}
                  </button>
                ))}
        </div>

        {/* ── 데스크톱 ─────────────────────────────────────────────────────── */}
        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>유형</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>기간</TableHead>
              <TableHead>메모</TableHead>
              <TableHead>확인</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* 로딩 중에도 rows 가 비어 있어 "등록된 일정이 없습니다"가 잠깐 뜨던 자리다 — 스켈레톤으로 덮는다. */}
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-12 rounded-md" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-14 text-center text-sm break-keep text-muted-foreground">
                  등록된 휴가/출장이 없습니다. 캘린더의 빈 날짜를 눌러 등록하세요.
                </TableCell>
              </TableRow>
            ) : rows.map(r => (
              <TableRow
                key={r.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => setDetail(r)}
              >
                <TableCell>
                  <Badge variant="outline">{TYPE_LABEL[r.type]}</Badge>
                </TableCell>
                <TableCell className="font-medium text-foreground">{r.userName ?? "이름없음"}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{r.startDate} ~ {r.endDate}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.memo || "—"}</TableCell>
                <TableCell>
                  {r.managerChecked && (
                    <span className="inline-flex items-center gap-1 text-xs leading-normal font-medium text-blue-700 dark:text-blue-300">
                      <CheckCircle2 size={13} /> 확인됨
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </Card>

      {addDefaults && (
        <AddModal
          open
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
  return (
    <ManagementDrawer
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      size="md"
      title="일정 상세 · 가능 품목"
      description="휴가·출장 일정과 가능한 품목을 확인합니다."
      footer={<Button variant="outline" onClick={onClose}>닫기</Button>}
    >
      <div className="flex flex-col gap-4">{children}</div>
    </ManagementDrawer>
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
    /* 드로어 안에 카드를 또 두르지 않는다 — 아래 제안 목록만 테두리를 갖고, 여기는 실선으로만 끊는다. */
    <div className="border-b pb-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs leading-normal font-medium ${TYPE_CLS[row.type]}`}>{TYPE_LABEL[row.type]}</span>
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{row.userName ?? "이름없음"}</span>
      </div>
      <p className="mt-2 text-sm tabular-nums text-muted-foreground">{row.startDate} ~ {row.endDate}</p>
      {row.memo && <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">{row.memo}</p>}
      <div className="mt-3 flex items-center gap-2">
        {row.managerChecked ? (
          <span className="inline-flex items-center gap-1 text-xs leading-normal font-medium text-blue-700 dark:text-blue-300">
            <CheckCircle2 size={13} /> 관리자 확인됨
          </span>
        ) : isAdmin ? (
          <Button variant="outline" size="sm" type="button" onClick={onToggleChecked} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} 확인 처리
          </Button>
        ) : (
          <span className="text-xs leading-normal text-muted-foreground">관리자 확인 대기</span>
        )}
        {(isAdmin || isOwner) && (
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label="일정 삭제"
            className="ml-auto text-muted-foreground hover:text-destructive"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
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
      <div className="border-b pb-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Sparkles size={14} className="text-muted-foreground" /> 기간 가용성 점검
        </h3>
        <p className="mt-1 mb-3 text-xs leading-normal break-keep text-muted-foreground">
          기간을 정하면 그 기간 휴가/출장으로 빠지는 인원을 빼고, 남은 인원으로 가능한 대기 품목을 제안합니다.
        </p>
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
      <div className="flex flex-col gap-4">
        <div className="border-b pb-4">
          <Skeleton className="mb-3 h-4 w-36" />
          <div className="flex flex-wrap gap-1.5">
            <Skeleton className="h-5 w-16 rounded-md" />
            <Skeleton className="h-5 w-20 rounded-md" />
          </div>
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
        <div className="overflow-hidden rounded-md border">
          <div className="border-b px-3 py-2">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex flex-col divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (error) {
    return <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs break-keep text-destructive">{error}</p>
  }
  if (!data) return null

  return (
    <div className="flex flex-col gap-4">
      {/* 인원 요약 — 아래 목록만 테두리를 갖게 두고, 여기는 실선으로만 끊는다 */}
      <div className="border-b pb-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Users size={14} className="text-muted-foreground" />
          <span className="tabular-nums">{data.from} ~ {data.to}</span> 인원
        </h3>
        {data.excludedTesters.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs leading-normal text-muted-foreground">휴가/출장 제외</span>
            {data.excludedTesters.map(t => (
              <span key={t.id} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs leading-normal font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">{t.name}</span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs leading-normal break-keep text-muted-foreground">이 기간에 빠지는 시험자가 없습니다 (전원 가용).</p>
        )}
        <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
          가용 시험자 <span className="font-semibold tabular-nums text-foreground">{data.availableTesters.length}</span>명
        </p>
      </div>

      {/* 가능 품목 — '가능'은 정상 상태라 브랜드 파랑. 아래 불가 사유만 앰버·회색으로 갈린다 */}
      <Group
        title="지금 가능한 품목"
        count={data.testable.length}
        tone="bg-blue-500"
        empty="가용 인원으로 진행 가능한 대기 품목이 없습니다."
      >
        {data.testable.map(p => (
          <li key={p.productCode} className="flex min-w-0 items-start justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{p.productName}</p>
              <p className="truncate text-xs leading-normal text-muted-foreground">{p.productCode} · {p.testItems.slice(0, 4).join(", ")}{p.testItems.length > 4 ? " 외" : ""}</p>
            </div>
            <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">대기 {p.waitingCount}</span>
          </li>
        ))}
      </Group>

      {/* 휴가로 불가 */}
      {data.blockedByLeave.length > 0 && (
        <Group
          title="휴가로 불가 (복귀 시 가능)"
          count={data.blockedByLeave.length}
          tone="bg-amber-500"
        >
          {data.blockedByLeave.map(p => (
            <li key={p.productCode} className="min-w-0 px-3 py-2">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{p.productName}</p>
                  <p className="truncate text-xs leading-normal text-muted-foreground">{p.productCode}</p>
                </div>
                <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">대기 {p.waitingCount}</span>
              </div>
              {p.recoverableBy && p.recoverableBy.length > 0 && (
                <p className="mt-1 text-xs leading-normal break-keep text-amber-700 dark:text-amber-300">복귀 시 가능: {p.recoverableBy.join(", ")}</p>
              )}
              {p.blockingCapabilities && p.blockingCapabilities.length > 0 && (
                <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">부족 역량: {p.blockingCapabilities.join(", ")}</p>
              )}
            </li>
          ))}
        </Group>
      )}

      {/* 자격자 자체 없음 */}
      {data.blockedAlways.length > 0 && (
        <Group
          title="자격 시험자 없음 (휴가 무관)"
          count={data.blockedAlways.length}
          tone="bg-slate-400"
        >
          {data.blockedAlways.map(p => (
            <li key={p.productCode} className="min-w-0 px-3 py-2">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{p.productName}</p>
                  <p className="truncate text-xs leading-normal text-muted-foreground">{p.productCode}</p>
                </div>
                <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">대기 {p.waitingCount}</span>
              </div>
              {p.blockingCapabilities && p.blockingCapabilities.length > 0 && (
                <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">부족 역량: {p.blockingCapabilities.join(", ")}</p>
              )}
            </li>
          ))}
        </Group>
      )}
    </div>
  )
}

/**
 * 제안 목록 한 묶음.
 *
 * 머리줄 전체를 색으로 칠하던 것(초록·앰버·회색 띠 세 개)을 걷어냈다 — 좁은 드로어에서
 * 색 띠 셋이 번갈아 나오면 목록보다 띠가 먼저 읽힌다. 뜻은 점 하나로만 남긴다.
 */
function Group({
  title, count, tone, empty, children,
}: {
  title: string
  count: number
  /** 점 색 — 가능(초록)·휴가로 불가(앰버)·자격자 없음(회색) */
  tone: string
  empty?: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex min-w-0 items-center gap-1.5 border-b px-3 py-2">
        <span className={`size-1.5 shrink-0 rounded-full ${tone}`} />
        <h3 className="min-w-0 truncate text-xs leading-normal font-semibold text-foreground">{title}</h3>
        <span className="ml-auto shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">{count}</span>
      </div>
      {count === 0 && empty ? (
        <p className="px-3 py-4 text-xs leading-normal break-keep text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto">{children}</ul>
      )}
    </div>
  )
}

// ─── 등록 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  open, isAdmin, users, defaults, onClose, onSaved, onError,
}: {
  open: boolean
  isAdmin: boolean
  users: UserOption[]
  defaults: { start: string; end: string }
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const uid = useId()
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
    <ManagementDrawer
      open={open}
      onOpenChange={(next) => { if (!next && !saving) onClose() }}
      size="md"
      title="휴가 / 출장 등록"
      description="기간과 유형을 지정해 일정을 등록합니다."
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} 등록
          </Button>
        </>
      )}
    >
        <div className="grid gap-3">
          {isAdmin && (
            <div>
              <label htmlFor={`${uid}-user`} className="mb-1 block text-xs font-medium text-muted-foreground">대상자</label>
              <Select value={userId || "self"} onValueChange={v => setUserId(v === "self" ? "" : v)}>
                <SelectTrigger id={`${uid}-user`} className="w-full">
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
            <span id={`${uid}-type-label`} className="mb-1 block text-xs font-medium text-muted-foreground">유형</span>
            <div role="group" aria-labelledby={`${uid}-type-label`} className="flex gap-2">
              {(Object.keys(TYPE_LABEL) as ScheduleType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  className={`flex-1 rounded-md border px-2 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    type === t ? TYPE_CLS[t] : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >{TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>

          <DateRangeField
            label="조회기간"
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s)
              setEndDate(e)
            }}
          />

          <div>
            <label htmlFor={`${uid}-memo`} className="mb-1 block text-xs font-medium text-muted-foreground">메모</label>
            <Input
              id={`${uid}-memo`}
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="선택 입력"
            />
          </div>
        </div>
    </ManagementDrawer>
  )
}
