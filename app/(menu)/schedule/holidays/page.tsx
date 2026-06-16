"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { CalendarDays, Plus, Trash2, X, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"

// ─── Types ───────────────────────────────────────────────────────────────────
interface HolidayRow {
  date: string
  description: string
  createdAt?: string
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function HolidaysPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear())
  const [rows, setRows] = useState<HolidayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgType, setMsgType] = useState<"ok" | "err">("ok")
  const [showAdd, setShowAdd] = useState(false)

  const flash = (m: string, type: "ok" | "err" = "ok") => {
    setMsg(m)
    setMsgType(type)
    setTimeout(() => setMsg(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/holidays?year=${year}`, { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch {
      flash("목록 조회 중 오류가 발생했습니다.", "err")
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const remove = async (date: string) => {
    if (!confirm(`${date} 공휴일을 삭제할까요?`)) return
    setBusy(date)
    try {
      const res = await fetch("/api/holidays", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      })
      if (!res.ok) {
        const d = await res.json()
        flash(d.error ?? "삭제 실패", "err")
        return
      }
      flash("삭제되었습니다.")
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">공휴일 관리</h1>
            <p className="text-xs text-slate-500">등록된 공휴일은 PCT 시험 스케줄 자동배정 시 비근무일로 처리됩니다.</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={16} /> 공휴일 추가
          </button>
        )}
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          msgType === "err"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}>
          {msg}
        </div>
      )}

      {/* Year nav */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setYear(y => y - 1)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-20 text-center text-base font-bold text-slate-900">{year}년</span>
        <button
          onClick={() => setYear(y => y + 1)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Holiday list */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          {year}년 공휴일 ({rows.length}일)
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> 불러오는 중…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            {year}년에 등록된 공휴일이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => (
              <div key={r.date} className="flex items-center gap-3 px-4 py-3">
                <span className="w-28 shrink-0 font-mono text-sm font-medium text-slate-800">
                  {r.date}
                </span>
                <span className="flex-1 text-sm text-slate-600">{r.description || "—"}</span>
                {isAdmin && (
                  <button
                    onClick={() => void remove(r.date)}
                    disabled={busy === r.date}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="삭제"
                  >
                    {busy === r.date
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Trash2 size={14} />
                    }
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            void load()
            flash("공휴일이 추가되었습니다.")
          }}
          onError={(m) => flash(m, "err")}
        />
      )}
    </div>
  )
}

// ─── 추가 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [date, setDate] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!date) { onError("날짜를 입력하세요."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, description }),
      })
      if (!res.ok) {
        const d = await res.json()
        onError(d.error ?? "추가 실패")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">공휴일 추가</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <DateField label="날짜" value={date} onChange={setDate} />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">설명</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="예) 설날, 어린이날"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={15} className="animate-spin" />} 추가
          </button>
        </div>
      </div>
    </div>
  )
}
