"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { ClipboardList, Plus, Pencil, Trash2, X, Loader2, AlertTriangle, AlertCircle } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"

// ─── Types ───────────────────────────────────────────────────────────────────

type EquipmentStatus = "active" | "calibrating" | "out_of_service"

interface EquipmentMasterRow {
  id: string
  code: string
  name: string
  category: string | null
  status: EquipmentStatus
  calibrationDate: string | null
  calibrationDueDate: string | null
  location: string | null
  note: string | null
  createdAt: string
  updatedAt: string | null
}

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  active:          "사용 중",
  calibrating:     "검교정 중",
  out_of_service:  "사용 불가",
}

const STATUS_CLS: Record<EquipmentStatus, string> = {
  active:         "bg-emerald-50 text-emerald-700 border-emerald-200",
  calibrating:    "bg-amber-50 text-amber-700 border-amber-200",
  out_of_service: "bg-red-50 text-red-700 border-red-200",
}

// ─── 검교정 만료 판정 ─────────────────────────────────────────────────────────

function getCalibrationUrgency(dueDate: string | null): "expired" | "soon" | "ok" | "none" {
  if (!dueDate) return "none"
  const today = new Date().toISOString().slice(0, 10)
  if (dueDate < today) return "expired"
  const soon = new Date()
  soon.setDate(soon.getDate() + 30)
  const soonStr = soon.toISOString().slice(0, 10)
  if (dueDate <= soonStr) return "soon"
  return "ok"
}

function CalibrationDueBadge({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return <span className="text-slate-400 text-xs">미등록</span>
  const urgency = getCalibrationUrgency(dueDate)
  if (urgency === "expired") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
        <AlertCircle size={12} /> {dueDate} <span className="font-normal">(만료)</span>
      </span>
    )
  }
  if (urgency === "soon") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
        <AlertTriangle size={12} /> {dueDate} <span className="font-normal">(30일 이내)</span>
      </span>
    )
  }
  return <span className="text-xs text-slate-700">{dueDate}</span>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EquipmentMasterPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<EquipmentMasterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: "info" | "error" } | null>(null)

  const [editTarget, setEditTarget] = useState<EquipmentMasterRow | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const flash = (text: string, type: "info" | "error" = "info") => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/equipment-master", { credentials: "include" })
      const data = await res.json() as { rows?: EquipmentMasterRow[]; error?: string }
      if (!res.ok) { flash(data.error ?? "목록 로드 실패", "error"); return }
      setRows(data.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (row: EquipmentMasterRow) => {
    if (!confirm(`장비 '${row.name}(${row.code})'을 삭제할까요?`)) return
    setBusy(row.id)
    try {
      const res = await fetch(`/api/equipment-master/${row.id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; flash(d.error ?? "삭제 실패", "error"); return }
      flash("삭제되었습니다.")
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ClipboardList size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">장비 마스터</h1>
            <p className="text-xs text-slate-500">장비 등록·검교정 이력·가용성 관리</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus size={16} /> 장비 등록
          </button>
        )}
      </div>

      {/* 플래시 메시지 */}
      {msg && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          msg.type === "error"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}>
          {msg.text}
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          장비 목록 ({rows.length})
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> 불러오는 중…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">등록된 장비가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500">
                  <th className="px-4 py-2.5 text-left">코드</th>
                  <th className="px-4 py-2.5 text-left">장비명</th>
                  <th className="px-4 py-2.5 text-left">카테고리</th>
                  <th className="px-4 py-2.5 text-left">상태</th>
                  <th className="px-4 py-2.5 text-left">최근 검교정</th>
                  <th className="px-4 py-2.5 text-left">차기 검교정</th>
                  <th className="px-4 py-2.5 text-left">위치</th>
                  {isAdmin && <th className="px-4 py-2.5 text-left">관리</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(row => {
                  const urgency = getCalibrationUrgency(row.calibrationDueDate)
                  const rowHighlight =
                    urgency === "expired" ? "bg-red-50/40" :
                    urgency === "soon"    ? "bg-amber-50/40" : ""
                  return (
                    <tr key={row.id} className={`${rowHighlight} hover:bg-slate-50`}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{row.code}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                      <td className="px-4 py-3 text-slate-500">{row.category ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[row.status]}`}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {row.calibrationDate ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <CalibrationDueBadge dueDate={row.calibrationDueDate} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{row.location ?? "—"}</td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setEditTarget(row)}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                              title="수정"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => void handleDelete(row)}
                              disabled={busy === row.id}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              title="삭제"
                            >
                              {busy === row.id
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 추가 모달 */}
      {showAdd && (
        <EquipmentModal
          mode="add"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            flash("장비가 등록되었습니다.")
            void load()
          }}
          onError={(m) => flash(m, "error")}
        />
      )}

      {/* 수정 모달 */}
      {editTarget && (
        <EquipmentModal
          mode="edit"
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            flash("수정되었습니다.")
            void load()
          }}
          onError={(m) => flash(m, "error")}
        />
      )}
    </div>
  )
}

// ─── 장비 등록/수정 모달 ──────────────────────────────────────────────────────

interface ModalProps {
  mode: "add" | "edit"
  initial?: EquipmentMasterRow
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}

function EquipmentModal({ mode, initial, onClose, onSaved, onError }: ModalProps) {
  const [code,               setCode]               = useState(initial?.code ?? "")
  const [name,               setName]               = useState(initial?.name ?? "")
  const [category,           setCategory]           = useState(initial?.category ?? "")
  const [status,             setStatus]             = useState<EquipmentStatus>(initial?.status ?? "active")
  const [calibrationDate,    setCalibrationDate]    = useState(initial?.calibrationDate ?? "")
  const [calibrationDueDate, setCalibrationDueDate] = useState(initial?.calibrationDueDate ?? "")
  const [location,           setLocation]           = useState(initial?.location ?? "")
  const [note,               setNote]               = useState(initial?.note ?? "")
  const [saving,             setSaving]             = useState(false)

  const submit = async () => {
    if (!code.trim())  { onError("장비코드를 입력하세요."); return }
    if (!name.trim())  { onError("장비명을 입력하세요."); return }
    setSaving(true)
    try {
      const body = {
        code:               code.trim(),
        name:               name.trim(),
        category:           category.trim() || null,
        status,
        calibrationDate:    calibrationDate || null,
        calibrationDueDate: calibrationDueDate || null,
        location:           location.trim() || null,
        note:               note.trim() || null,
      }

      let res: Response
      if (mode === "add") {
        res = await fetch("/api/equipment-master", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/equipment-master/${initial!.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const d = await res.json() as { error?: string }
        onError(d.error ?? "저장 실패")
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
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            {mode === "add" ? "장비 등록" : "장비 수정"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* 코드 / 장비명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                장비코드 <span className="text-red-500">*</span>
              </label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="예) HPLC-01"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                장비명 <span className="text-red-500">*</span>
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="예) HPLC 분석장비 1호"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* 카테고리 / 상태 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">카테고리</label>
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="예) 분석기기"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">상태</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as EquipmentStatus)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="active">사용 중</option>
                <option value="calibrating">검교정 중</option>
                <option value="out_of_service">사용 불가</option>
              </select>
            </div>
          </div>

          {/* 검교정 날짜 */}
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="최근 검교정일"
              value={calibrationDate}
              onChange={setCalibrationDate}
            />
            <DateField
              label="차기 검교정 예정일"
              value={calibrationDueDate}
              onChange={setCalibrationDueDate}
            />
          </div>

          {/* 위치 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">위치</label>
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="예) QC실 3번 랙"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* 비고 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">비고</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="기타 메모"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
            />
          </div>
        </div>

        {/* 버튼 */}
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
            {saving && <Loader2 size={15} className="animate-spin" />}
            {mode === "add" ? "등록" : "저장"}
          </button>
        </div>
      </div>
    </div>
  )
}
