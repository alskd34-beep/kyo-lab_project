"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { Wrench, Plus, Trash2, X, Loader2, CheckCircle2, Ban } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"

// ─── Types ──────────────────────────────────────────────────────────────────
type ReservationStatus = "RESERVED" | "WAITING" | "CANCELLED" | "COMPLETED"

interface ReservationRow {
  id: string
  equipmentId: string
  userId: string
  userName: string | null
  startDate: string
  endDate: string
  status: ReservationStatus
  waitOrder: number | null
  createdAt: string
}

const STATUS_LABEL: Record<ReservationStatus, string> = {
  RESERVED: "예약", WAITING: "대기", CANCELLED: "취소", COMPLETED: "완료",
}
const STATUS_CLS: Record<ReservationStatus, string> = {
  RESERVED:  "bg-blue-50 text-blue-700 border-blue-200",
  WAITING:   "bg-amber-50 text-amber-700 border-amber-200",
  CANCELLED: "bg-slate-100 text-slate-500 border-slate-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function EquipmentReservationPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<ReservationRow[]>([])
  const [equipmentIds, setEquipmentIds] = useState<string[]>([])
  const [filterEquipment, setFilterEquipment] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = filterEquipment.trim() ? `?equipmentId=${encodeURIComponent(filterEquipment.trim())}` : ""
      const res = await fetch(`/api/equipment-reservation${qs}`, { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
      // 화면 datalist 용 장비 목록(현재 목록에서 distinct)
      const ids = new Set<string>(equipmentIds)
      for (const r of (data.rows ?? []) as ReservationRow[]) ids.add(r.equipmentId)
      setEquipmentIds([...ids].sort())
    } finally { setLoading(false) }
  }, [filterEquipment]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  const cancel = async (id: string) => {
    if (!confirm("이 예약을 취소할까요?")) return
    setBusy(id)
    try {
      const res = await fetch(`/api/equipment-reservation/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "취소 실패"); return }
      flash("취소되었습니다.")
      await load()
    } finally { setBusy(null) }
  }

  const complete = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/equipment-reservation/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "처리 실패"); return }
      flash("완료 처리되었습니다.")
      await load()
    } finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    if (!confirm("이 예약을 삭제할까요?")) return
    setBusy(id)
    try {
      const res = await fetch(`/api/equipment-reservation/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "삭제 실패"); return }
      flash("삭제되었습니다.")
      await load()
    } finally { setBusy(null) }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Wrench size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">장비 예약</h1>
            <p className="text-xs text-slate-500">선착순 예약. 기간이 겹치면 대기열에 등록됩니다.</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={16} /> 예약 등록
        </button>
      </div>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">{msg}</div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48">
          <label className="mb-1 block text-xs font-medium text-slate-600">장비 필터</label>
          <input
            list="equipment-ids-filter"
            value={filterEquipment}
            onChange={e => setFilterEquipment(e.target.value)}
            placeholder="장비 선택 또는 입력"
            className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
          />
          <datalist id="equipment-ids-filter">
            {equipmentIds.map(id => <option key={id} value={id} />)}
          </datalist>
        </div>
        {filterEquipment && (
          <button
            onClick={() => setFilterEquipment("")}
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            전체
          </button>
        )}
      </div>

      {/* List */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          예약 목록 ({rows.length})
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> 불러오는 중…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">등록된 예약이 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => {
              const canModify = (isAdmin || r.userId === user?.id) && (r.status === "RESERVED" || r.status === "WAITING")
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                    {r.status === "WAITING" && r.waitOrder != null && ` #${r.waitOrder}`}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{r.equipmentId}</span>
                  <span className="text-sm text-slate-500">{r.startDate} ~ {r.endDate}</span>
                  <span className="text-xs text-slate-400">{r.userName ?? "이름없음"}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {canModify && r.status === "RESERVED" && (
                      <button
                        onClick={() => void complete(r.id)}
                        disabled={busy === r.id}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        <CheckCircle2 size={13} /> 완료
                      </button>
                    )}
                    {canModify && (
                      <button
                        onClick={() => void cancel(r.id)}
                        disabled={busy === r.id}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-amber-50 hover:text-amber-700"
                      >
                        <Ban size={13} /> 취소
                      </button>
                    )}
                    {isAdmin && (
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
              )
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <AddModal
          equipmentIds={equipmentIds}
          onClose={() => setShowAdd(false)}
          onSaved={(status) => {
            setShowAdd(false)
            void load()
            flash(status === "WAITING" ? "대기열에 등록되었습니다." : "예약되었습니다.")
          }}
          onError={flash}
        />
      )}
    </div>
  )
}

// ─── 등록 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  equipmentIds, onClose, onSaved, onError,
}: {
  equipmentIds: string[]
  onClose: () => void
  onSaved: (status: ReservationStatus) => void
  onError: (m: string) => void
}) {
  const [equipmentId, setEquipmentId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!equipmentId.trim()) { onError("장비를 입력하세요."); return }
    if (!startDate || !endDate) { onError("시작일과 종료일을 입력하세요."); return }
    if (endDate < startDate) { onError("종료일은 시작일 이후여야 합니다."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/equipment-reservation", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentId: equipmentId.trim(), startDate, endDate }),
      })
      if (!res.ok) { const d = await res.json(); onError(d.error ?? "등록 실패"); return }
      const d = await res.json()
      onSaved((d.row?.status as ReservationStatus) ?? "RESERVED")
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">장비 예약 등록</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">장비</label>
            <input
              list="equipment-ids-add"
              value={equipmentId}
              onChange={e => setEquipmentId(e.target.value)}
              placeholder="장비 선택 또는 입력"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
            <datalist id="equipment-ids-add">
              {equipmentIds.map(id => <option key={id} value={id} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DateField label="시작일" value={startDate} onChange={setStartDate} />
            <DateField label="종료일" value={endDate} onChange={setEndDate} />
          </div>

          <p className="text-[11px] text-slate-400">
            같은 장비에 기간이 겹치는 예약이 있으면 대기(WAITING)로 등록됩니다.
          </p>
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
