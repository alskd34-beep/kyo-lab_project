"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  RefreshCw, Sparkles, History, AlertCircle, Pencil, X, Loader2, Database,
} from "lucide-react"

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
  manhours: number | null
  hasJob: boolean
}
interface Tester { id: string; name: string }
interface EditRow {
  id: string; field: string; oldValue: string | null; newValue: string | null
  reason: string; editedAt: string
}

const STATUS_OPTIONS = ["대기", "진행중", "검토중", "완료", "지연"]
const METHOD_OPTIONS = ["전항목", "개별항목"]

const STATUS_CLS: Record<string, string> = {
  대기:   "bg-slate-100 text-slate-600 border-slate-200",
  진행중: "bg-violet-50 text-violet-700 border-violet-200",
  검토중: "bg-blue-50 text-blue-700 border-blue-200",
  완료:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  지연:   "bg-red-50 text-red-700 border-red-200",
  삭제:   "bg-slate-100 text-slate-400 border-slate-200",
}

const FIELD_LABEL: Record<string, string> = {
  packagingDate: "포장일", dueDate: "완료예정일", isUrgent: "긴급",
  method: "진행방법", status: "상태", note: "비고", assigneeTesterId: "담당자",
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

  const [editTarget, setEditTarget] = useState<OrderRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<OrderRow | null>(null)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ""
      const [oRes, tRes] = await Promise.all([
        fetch(`/api/pct-orders${qs}`, { credentials: "include" }),
        fetch(`/api/testers`, { credentials: "include" }),
      ])
      const oData = await oRes.json()
      const tData = await tRes.json()
      setRows(oData.rows ?? [])
      setTesters((tData.rows ?? []).map((t: Tester) => ({ id: t.id, name: t.name })))
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

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between md:py-4">
        <div>
          <h1 className="text-base font-bold text-slate-900 sm:text-lg">오더 배정 · 관리</h1>
          <p className="mt-1 text-xs font-medium text-slate-600">
            제조부서 PCT 적재 오더의 담당자 배정과 수정을 관리합니다.
            {unsyncedCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <AlertCircle size={12} /> 미동기화 {unsyncedCount}
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runIngest} disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              {busy === "ingest" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              지금 적재
            </button>
            <button
              onClick={runAutoAssign} disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "assign" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              AI 자동배정
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{msg}</div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none"
        >
          <option value="">전체 상태</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs font-medium text-slate-500">총 {rows.length}건</span>
        <button
          onClick={() => setShowLog(true)}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          <Database size={15} />적재 이력
        </button>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2.5">품목명</th>
              <th className="px-3 py-2.5">품목코드</th>
              <th className="px-3 py-2.5">제조번호</th>
              <th className="px-3 py-2.5">제형</th>
              <th className="px-3 py-2.5">포장일</th>
              <th className="px-3 py-2.5">완료예정</th>
              <th className="px-3 py-2.5">긴급</th>
              <th className="px-3 py-2.5">진행방법</th>
              <th className="px-3 py-2.5">공수</th>
              <th className="px-3 py-2.5">담당자</th>
              <th className="px-3 py-2.5">상태</th>
              <th className="px-3 py-2.5 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-slate-400">불러오는 중…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-slate-400">적재된 오더가 없습니다. “지금 적재”로 시트를 불러오세요.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-slate-100 text-slate-700 hover:bg-slate-50">
                <td className="px-3 py-2.5 font-medium text-slate-900">
                  <div className="flex items-center gap-1.5">
                    {r.productName}
                    {!r.productSynced && (
                      <span title="품목마스터 미동기화" className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">미동기화</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{r.productCode}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{r.batchNo}</td>
                <td className="px-3 py-2.5">{r.dosageForm ?? "-"}</td>
                <td className="px-3 py-2.5">{r.packagingDate ?? "-"}</td>
                <td className="px-3 py-2.5">{r.dueDate ?? "-"}</td>
                <td className="px-3 py-2.5">
                  {r.isUrgent
                    ? <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">긴급</span>
                    : <span className="text-slate-400">일반</span>}
                </td>
                <td className="px-3 py-2.5">{r.method}</td>
                <td className="px-3 py-2.5">{r.manhours != null ? `${r.manhours}h` : "-"}</td>
                <td className="px-3 py-2.5">{r.assigneeName ?? <span className="text-slate-400">미배정</span>}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLS[r.status] ?? STATUS_CLS["대기"]}`}>{r.status}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setHistoryTarget(r)} title="수정이력" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <History size={15} />
                    </button>
                    {isAdmin && (
                      <button onClick={() => setEditTarget(r)} title="수정" className="rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
      {showLog && <IngestLogModal onClose={() => setShowLog(false)} />}
    </div>
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
          <select value={form.isUrgent ? "긴급" : "일반"} onChange={e => setForm({ ...form, isUrgent: e.target.value === "긴급" })} className={inputCls}>
            <option>일반</option><option>긴급</option>
          </select>
        </Field>
        <Field label="진행방법">
          <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} className={inputCls}>
            {METHOD_OPTIONS.map(m => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="상태">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputCls}>
            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="담당자">
          <select value={form.assigneeTesterId} onChange={e => setForm({ ...form, assigneeTesterId: e.target.value })} className={inputCls}>
            <option value="">미배정</option>
            {testers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="비고" full><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={inputCls} /></Field>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-slate-700">수정 사유 <span className="text-red-500">*</span></label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
          placeholder="변경 사유를 입력하세요 (필수)"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none" />
      </div>

      {err && <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100">취소</button>
        <button onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving && <Loader2 size={15} className="animate-spin" />}저장
        </button>
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
        <p className="py-6 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">수정 이력이 없습니다.</p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {rows.map(e => (
            <li key={e.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">{FIELD_LABEL[e.field] ?? e.field}</span>
                <span className="text-[11px] text-slate-400">{new Date(e.editedAt).toLocaleString("ko-KR")}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                <span className="text-slate-400 line-through">{e.oldValue ?? "(없음)"}</span>
                {" → "}
                <span className="font-medium text-slate-800">{e.newValue ?? "(없음)"}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">사유: {e.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

// ─── 적재 이력 모달 ───────────────────────────────────────────────────────────
interface IngestLog { id: string; runAt: string; orderKey: string; changeType: string; status: string | null }
const CHANGE_META: Record<string, { label: string; cls: string }> = {
  new:     { label: "신규", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  updated: { label: "수정", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  deleted: { label: "삭제", cls: "bg-red-50 text-red-700 border-red-200" },
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

  return (
    <Modal title="적재 이력 (가져온 이력)" onClose={onClose}>
      {loading ? (
        <p className="py-6 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">적재 이력이 없습니다.</p>
      ) : (
        <ul className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto">
          {rows.map(r => {
            const meta = CHANGE_META[r.changeType] ?? CHANGE_META.new
            const [batch, code] = r.orderKey.split("|")
            return (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                  <span className="font-mono text-xs text-slate-600">{batch} · {code}</span>
                  {r.status && <span className="text-[11px] text-slate-400">({r.status})</span>}
                </div>
                <span className="text-[11px] text-slate-400">{new Date(r.runAt).toLocaleString("ko-KR")}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// ─── 공용 UI ──────────────────────────────────────────────────────────────────
const inputCls = "h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none"

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-semibold text-slate-700">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
