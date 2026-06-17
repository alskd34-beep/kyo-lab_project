"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  CalendarDays, Plus, Trash2, X, Loader2, Check, ChevronLeft, ChevronRight, CheckCircle2,
} from "lucide-react"
import { DateRangeField } from "@frontend/components/ui/date-range-field"

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

const TYPE_LABEL: Record<ScheduleType, string> = {
  ANNUAL: "연차", HALF_DAY: "반차", BUSINESS_TRIP: "출장",
}
const TYPE_CLS: Record<ScheduleType, string> = {
  ANNUAL:        "bg-blue-50 text-blue-700 border-blue-200",
  HALF_DAY:      "bg-amber-50 text-amber-700 border-amber-200",
  BUSINESS_TRIP: "bg-violet-50 text-violet-700 border-violet-200",
}
const TYPE_BAR: Record<ScheduleType, string> = {
  ANNUAL: "bg-blue-500", HALF_DAY: "bg-amber-500", BUSINESS_TRIP: "bg-violet-500",
}

// ─── Date utils (UTC 기준 yyyy-MM-dd) ─────────────────────────────────────────
function iso(d: Date): string { return d.toISOString().slice(0, 10) }
function monthRange(year: number, month: number): { from: string; to: string } {
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))
  return { from: iso(first), to: iso(last) }
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
  const [showAdd, setShowAdd] = useState(false)

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

  // 날짜별 휴가 막대
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleRow[]>()
    for (const r of rows) {
      for (const c of cells) {
        const day = iso(c)
        if (day >= r.startDate && day <= r.endDate) {
          const arr = m.get(day) ?? []
          arr.push(r)
          m.set(day, arr)
        }
      }
    }
    return m
  }, [rows, cells])

  const prevMonth = () => { const d = new Date(Date.UTC(year, month - 1, 1)); setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth()) }
  const nextMonth = () => { const d = new Date(Date.UTC(year, month + 1, 1)); setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth()) }

  const remove = async (id: string) => {
    if (!confirm("이 일정을 삭제할까요?")) return
    setBusy(id)
    try {
      const res = await fetch(`/api/operator-schedule/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "삭제 실패"); return }
      flash("삭제되었습니다.")
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
      await load()
    } finally { setBusy(null) }
  }

  const todayIso = iso(now)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">휴가 캘린더</h1>
            <p className="text-xs text-slate-500">휴가·출장 기간 중인 시험자는 AI 자동배정에서 제외됩니다.</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={16} /> 휴가 등록
        </button>
      </div>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">{msg}</div>
      )}

      {/* Month nav */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={prevMonth} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft size={18} /></button>
        <span className="min-w-32 text-center text-base font-bold text-slate-900">{year}년 {month + 1}월</span>
        <button onClick={nextMonth} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ChevronRight size={18} /></button>
      </div>

      {/* Calendar */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold text-slate-500">
          {["일", "월", "화", "수", "목", "금", "토"].map(d => (
            <div key={d} className="py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const day = iso(c)
            const inMonth = c.getUTCMonth() === month
            const items = byDay.get(day) ?? []
            return (
              <div
                key={i}
                className={`min-h-20 border-b border-r border-slate-100 p-1.5 ${inMonth ? "bg-white" : "bg-slate-50/60"}`}
              >
                <div className={`mb-1 text-[11px] font-medium ${
                  day === todayIso ? "flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white"
                  : inMonth ? "text-slate-600" : "text-slate-300"
                }`}>{c.getUTCDate()}</div>
                <div className="flex flex-col gap-0.5">
                  {items.slice(0, 3).map(r => (
                    <div
                      key={r.id}
                      title={`${r.userName ?? ""} · ${TYPE_LABEL[r.type]}${r.memo ? ` · ${r.memo}` : ""}`}
                      className={`truncate rounded px-1 py-0.5 text-[10px] font-medium text-white ${TYPE_BAR[r.type]}`}
                    >
                      {r.userName ?? "?"} {TYPE_LABEL[r.type]}
                    </div>
                  ))}
                  {items.length > 3 && <span className="px-1 text-[10px] text-slate-400">+{items.length - 3}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          이번 달 일정 ({rows.length})
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> 불러오는 중…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">등록된 휴가/출장이 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${TYPE_CLS[r.type]}`}>
                  {TYPE_LABEL[r.type]}
                </span>
                <span className="text-sm font-medium text-slate-800">{r.userName ?? "이름없음"}</span>
                <span className="text-sm text-slate-500">{r.startDate} ~ {r.endDate}</span>
                {r.memo && <span className="text-xs text-slate-400">{r.memo}</span>}
                <div className="ml-auto flex items-center gap-2">
                  {r.managerChecked ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2 size={14} /> 확인됨
                    </span>
                  ) : isAdmin ? (
                    <button
                      onClick={() => void toggleChecked(r)}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Check size={13} /> 확인
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">확인 대기</span>
                  )}
                  {(isAdmin || r.userId === user?.id) && (
                    <button
                      onClick={() => void remove(r.id)}
                      disabled={busy === r.id}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      {busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddModal
          isAdmin={isAdmin}
          users={users}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); void load(); flash("등록되었습니다.") }}
          onError={flash}
        />
      )}
    </div>
  )
}

// ─── 등록 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  isAdmin, users, onClose, onSaved, onError,
}: {
  isAdmin: boolean
  users: UserOption[]
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [userId, setUserId] = useState("")
  const [type, setType] = useState<ScheduleType>("ANNUAL")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
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
              <select
                value={userId}
                onChange={e => setUserId(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="">본인 ({/* 미지정 시 로그인 사용자 */}관리자)</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.displayName ?? u.username}</option>
                ))}
              </select>
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
