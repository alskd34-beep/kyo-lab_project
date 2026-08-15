"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Play, CheckCircle2, Circle, Loader2, AlertTriangle, Clock, XCircle, ShieldAlert, ClipboardList,
} from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateField } from "@frontend/components/ui/date-field"
import { useLockBodyScroll } from "@frontend/hooks/use-lock-body-scroll"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"

interface JobItem {
  id: string; testItemName: string; sequenceOrder: number
  status: string; clearedAt: string | null; elapsedMinutes: number | null
}
interface Job {
  id: string; orderId: string; qcNo: string; productName: string; batchNo: string
  workStartDate: string | null; workEndDate: string | null; status: string
  isUrgent: boolean; dueDate: string | null; items: JobItem[]
}
interface PendingOrder {
  id: string; productCode: string; productName: string; batchNo: string
  dueDate: string | null; isUrgent: boolean; method: string
}

/** equipmentMaster ReadinessResult (UI 전용 타입) */
interface EquipmentCheck {
  code: string; name: string | null; found: boolean; status: string | null
  calibrationOk: boolean; calibrationDueDate: string | null
  available: boolean
  blocked: boolean          // 하드 차단 — 사유는 reason
  warning: string | null    // 소프트 경고 문구 (미등록/검교정 중/예약 점유 등)
  reason: string | null     // blocked 사유
}
/** 시험 전 확인사항 (product_pretest_notes) */
interface PretestNote {
  id: string; content: string; remark: string | null; issueLot: string | null
  occurredAt: string | null; createdByName: string | null
}
interface ReadinessResult {
  ok: boolean; checks: EquipmentCheck[]; equipmentCodes: string[]
  pretestNotes?: PretestNote[]
}

const STATUS_OPTIONS = ["진행중", "검토중", "완료", "지연"]
const STATUS_CLS: Record<string, string> = {
  진행중: "bg-violet-50 text-violet-700 border-violet-200",
  검토중: "bg-blue-50 text-blue-700 border-blue-200",
  완료:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  지연:   "bg-red-50 text-red-700 border-red-200",
}

function dDay(due: string | null): number | null {
  if (!due) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

/** 장비 준비상태 모달 */
function ReadinessModal({
  result,
  onConfirm,
  onCancel,
  confirming,
}: {
  result: ReadinessResult
  onConfirm: () => void
  onCancel: () => void
  confirming: boolean
}) {
  useLockBodyScroll()
  const blocked = result.checks.filter(c => c.blocked)
  const warnings = result.checks.filter(c => c.warning && !c.blocked)
  const notes = result.pretestNotes ?? []
  const isBlocked = !result.ok && blocked.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className={`rounded-t-2xl px-5 py-4 ${isBlocked ? "bg-red-50" : "bg-amber-50"}`}>
          <div className="flex items-center gap-2">
            {isBlocked
              ? <XCircle className="text-red-500" size={20} />
              : <ShieldAlert className="text-amber-500" size={20} />}
            <h2 className={`text-sm font-bold ${isBlocked ? "text-red-800" : "text-amber-800"}`}>
              {isBlocked ? "장비 검증 실패 — 시작 불가" : "시작 전 확인 — 확인 후 시작 가능"}
            </h2>
          </div>
          <p className={`mt-1 text-xs ${isBlocked ? "text-red-700" : "text-amber-700"}`}>
            {isBlocked
              ? "아래 장비 문제를 해결한 후 다시 시도하세요."
              : "장비 경고·시험 전 확인사항을 확인하고 계속 진행할 수 있습니다."}
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto overscroll-contain px-5 py-3">
          {blocked.length > 0 && (
            <ul className="flex flex-col gap-2">
              {blocked.map(c => (
                <li key={c.code} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
                  <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <div>
                    {/* 마스터 미등록 장비는 name이 없으므로 코드로 대체 */}
                    <span className="font-semibold text-red-800">{c.name ?? c.code}</span>
                    {c.reason && <p className="text-red-700">{c.reason}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className={blocked.length > 0 ? "mt-3" : ""}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <AlertTriangle size={12} /> 장비 경고 ({warnings.length})
              </p>
              <ul className="flex flex-col gap-2">
                {warnings.map(c => (
                  <li key={c.code} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    <div>
                      {/* 마스터 미등록 장비는 name이 없으므로 코드로 대체 */}
                      <span className="font-semibold text-amber-800">{c.name ?? c.code}</span>
                      {/* 경고 사유는 warning 필드에 담긴다(reason은 blocked 전용) */}
                      {c.warning && <p className="text-amber-700">{c.warning}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.length > 0 && (
            <div className={blocked.length > 0 || warnings.length > 0 ? "mt-3" : ""}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <ClipboardList size={12} /> 시험 전 확인사항 ({notes.length})
              </p>
              <ul className="flex flex-col gap-2">
                {notes.map(n => (
                  <li key={n.id} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs">
                    <p className="font-semibold text-sky-900">{n.content}</p>
                    {n.remark && <p className="mt-0.5 text-sky-700">특이사항: {n.remark}</p>}
                    {(n.issueLot || n.createdByName) && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-sky-600">
                        {n.issueLot && <span>이슈 로트 {n.issueLot}</span>}
                        {n.createdByName && <span>작성 {n.createdByName}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            취소
          </button>
          {!isBlocked && (
            <button
              onClick={onConfirm}
              disabled={confirming}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {confirming ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              확인 후 시작
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MyTasksPage() {
  const [linked, setLinked] = useState(true)
  const [pending, setPending] = useState<PendingOrder[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgType, setMsgType] = useState<"info" | "error">("info")
  // 다중 선택(배정완료·시작 대기) 일괄 실행
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // 다중 선택(진행 중) 일괄 상태 변경
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [jobBulkBusy, setJobBulkBusy] = useState(false)
  const [bulkStatus, setBulkStatus] = useState<string>("검토중")

  /** 장비 준비상태 모달 상태 */
  const [readinessModal, setReadinessModal] = useState<{
    orderId: string
    result: ReadinessResult
  } | null>(null)
  const [startingFromModal, setStartingFromModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/qc-jobs", { credentials: "include" })
      const data = await res.json()
      setLinked(data.testerLinked ?? false)
      setPending(data.pendingOrders ?? [])
      setJobs(data.jobs ?? [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // pending 갱신 시(시작 완료 등) 더 이상 없는 항목은 선택에서 제거
  useEffect(() => {
    setSelected(prev => {
      const ids = new Set(pending.map(o => o.id))
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [pending])

  // jobs 갱신 시 더 이상 진행 중이 아닌(완료된 등) 항목은 선택에서 제거
  useEffect(() => {
    setSelectedJobs(prev => {
      const ids = new Set(jobs.filter(j => j.status === "진행중" || j.status === "검토중" || j.status === "지연").map(j => j.id))
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [jobs])

  const flash = (m: string, type: "info" | "error" = "info") => {
    setMsg(m); setMsgType(type); setTimeout(() => setMsg(null), 4000)
  }

  /**
   * 장비 준비상태 조회.
   * 응답이 실패(401 세션만료·500 등)면 body 에 checks 가 없으므로, 그대로 쓰면
   * "reading 'some'" 같은 엉뚱한 오류가 뜬다. 여기서 실제 사유로 바꿔 던진다.
   */
  const fetchReadiness = async (orderId: string): Promise<ReadinessResult> => {
    const res = await fetch(`/api/qc-jobs/readiness?orderId=${orderId}`, { credentials: "include" })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해주세요.")
    if (!res.ok) throw new Error(data?.error ?? `준비상태 조회 실패 (HTTP ${res.status})`)
    if (!Array.isArray(data?.checks)) throw new Error("준비상태 응답 형식이 올바르지 않습니다.")
    return data as ReadinessResult
  }

  /** 시작 API 호출(코어) — 알림/새로고침 없이 결과만 반환 (일괄 실행에서 재사용) */
  const doStartCore = async (orderId: string): Promise<{ qcNo: string; warnings?: string[] }> => {
    const res = await fetch("/api/qc-jobs", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해주세요.")
    if (!res.ok) throw new Error(data?.error ?? `작업 시작 실패 (HTTP ${res.status})`)
    return data
  }

  /** 단건 시작 — 알림 + 새로고침 */
  const doStart = async (orderId: string) => {
    const data = await doStartCore(orderId)
    const warnNote = data.warnings?.length ? ` (경고: ${(data.warnings as string[]).join(", ")})` : ""
    flash(`작업 시작 — QC ${data.qcNo}${warnNote}`)
    await load()
  }

  /** 시작 버튼 클릭 — 준비상태 먼저 조회 */
  const start = async (orderId: string) => {
    setBusy(orderId)
    try {
      // 장비 준비상태 조회
      const readiness = await fetchReadiness(orderId)

      const hasBlocked = readiness.checks.some(c => c.blocked)
      const hasWarning = readiness.checks.some(c => c.warning && !c.blocked)
      const hasPretestNotes = (readiness.pretestNotes?.length ?? 0) > 0

      if (hasBlocked || hasWarning || hasPretestNotes) {
        // 모달 표시 (blocked이면 시작 불가, warning·시험 전 확인사항이면 확인 후 가능)
        setReadinessModal({ orderId, result: readiness })
        setBusy(null)
        return
      }

      // 문제 없으면 바로 시작
      await doStart(orderId)
    } catch (e) {
      flash(`시작 실패: ${e instanceof Error ? e.message : ""}`, "error")
    } finally {
      setBusy(null)
    }
  }

  /** 모달에서 경고 확인 후 시작 */
  const confirmStartFromModal = async () => {
    if (!readinessModal) return
    setStartingFromModal(true)
    try {
      await doStart(readinessModal.orderId)
      setReadinessModal(null)
    } catch (e) {
      flash(`시작 실패: ${e instanceof Error ? e.message : ""}`, "error")
      setReadinessModal(null)
    } finally {
      setStartingFromModal(false)
    }
  }

  /** 선택 실행 — 선택된 대기 오더를 순차 시작. 장비 차단(blocked) 건은 제외, 결과 요약 표시. */
  const startSelected = async () => {
    const ids = pending.filter(o => selected.has(o.id)).map(o => o.id)
    if (ids.length === 0) return
    setBulkBusy(true)
    const nameById = new Map(pending.map(o => [o.id, o.productName] as const))
    let started = 0
    const blocked: string[] = []
    const failed: string[] = []
    let lastError = ""
    try {
      for (const id of ids) {
        try {
          const readiness = await fetchReadiness(id)
          // 장비 차단 건은 단건 모달과 동일하게 시작 불가 → 제외
          if (readiness.checks.some(c => c.blocked)) { blocked.push(nameById.get(id) ?? id); continue }
          await doStartCore(id)
          started++
        } catch (e) {
          failed.push(nameById.get(id) ?? id)
          lastError = e instanceof Error ? e.message : ""
        }
      }
      await load()
      setSelected(new Set())
      const parts: string[] = [`${started}건 시작`]
      if (blocked.length) parts.push(`장비 차단 ${blocked.length}건 제외(${blocked.join(", ")})`)
      // 실패는 건수만 알려주면 원인을 알 수 없으므로 마지막 사유를 함께 표시한다.
      if (failed.length) parts.push(`실패 ${failed.length}건${lastError ? ` — ${lastError}` : ""}`)
      flash(parts.join(" · "), failed.length ? "error" : "info")
    } finally {
      setBulkBusy(false)
    }
  }

  const allSelected = pending.length > 0 && selected.size === pending.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pending.map(o => o.id)))
  const toggleOne = (id: string) =>
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const clearItem = async (jobId: string, itemId: string) => {
    setBusy(itemId)
    try {
      const res = await fetch(`/api/qc-jobs/${jobId}/items`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action: "clear" }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await load()
    } catch (e) { flash(`처리 실패: ${e instanceof Error ? e.message : ""}`, "error") }
    finally { setBusy(null) }
  }

  /** 잡 PATCH 코어 — 새로고침/알림 없음 (일괄에서 재사용) */
  const patchJobCore = async (jobId: string, patch: Record<string, string>) => {
    const res = await fetch(`/api/qc-jobs/${jobId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error((await res.json()).error)
  }

  const patchJob = async (jobId: string, patch: Record<string, string>) => {
    try {
      await patchJobCore(jobId, patch)
      await load()
    } catch (e) { flash(`저장 실패: ${e instanceof Error ? e.message : ""}`, "error") }
  }

  // 작업을 상태별로 분리
  const activeJobs = jobs.filter(j => j.status === "진행중" || j.status === "검토중" || j.status === "지연")
  const doneJobs = jobs.filter(j => j.status === "완료")

  const allJobsSelected = activeJobs.length > 0 && selectedJobs.size === activeJobs.length
  const toggleAllJobs = () => setSelectedJobs(allJobsSelected ? new Set() : new Set(activeJobs.map(j => j.id)))
  const toggleJob = (id: string) =>
    setSelectedJobs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  /** 선택 적용 — 선택된 진행 중 작업의 상태를 콤보 박스 값으로 일괄 변경 */
  const applyBulkStatus = async () => {
    const ids = activeJobs.filter(j => selectedJobs.has(j.id)).map(j => j.id)
    if (ids.length === 0) return
    setJobBulkBusy(true)
    const nameById = new Map(activeJobs.map(j => [j.id, `QC ${j.qcNo}`] as const))
    let ok = 0
    const failed: string[] = []
    try {
      for (const id of ids) {
        try { await patchJobCore(id, { status: bulkStatus }); ok++ }
        catch { failed.push(nameById.get(id) ?? id) }
      }
      await load()
      setSelectedJobs(new Set())
      const parts: string[] = [`${ok}건 '${bulkStatus}' 적용`]
      if (failed.length) parts.push(`실패 ${failed.length}건`)
      flash(parts.join(" · "), failed.length ? "error" : "info")
    } finally {
      setJobBulkBusy(false)
    }
  }

  if (loading) return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      {/* 헤더 */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-1.5 h-3 w-72" />
      </div>
      {/* ① 배정완료 · 시작 대기 */}
      <section>
        <Skeleton className="mb-2 h-3 w-36" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-1 h-3 w-1/2" />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="mt-3 h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </section>
      {/* ② 진행 중 */}
      <section>
        <Skeleton className="mb-2 h-3 w-24" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-56" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-36 rounded-lg" />
                  <Skeleton className="h-8 w-36 rounded-lg" />
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
              </div>
              <div className="px-4 py-3">
                <Skeleton className="mb-2 h-3 w-32" />
                <div className="flex flex-col gap-1">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                      <Skeleton className="h-7 w-14 rounded-md" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )

  if (!linked) {
    return (
      <div className="p-3 md:p-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <AlertTriangle className="mx-auto mb-2 text-amber-500" size={24} />
          <p className="text-sm font-semibold text-amber-800">계정에 시험자(담당자)가 연결되어 있지 않습니다.</p>
          <p className="mt-1 text-xs text-amber-700">관리자에게 계정-시험자 연결을 요청하세요.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {readinessModal && (
        <ReadinessModal
          result={readinessModal.result}
          onConfirm={confirmStartFromModal}
          onCancel={() => setReadinessModal(null)}
          confirming={startingFromModal}
        />
      )}

      <div className="flex flex-col gap-4 p-3 md:p-5">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <h1 className="text-base font-bold text-slate-900 sm:text-lg">내 작업</h1>
          <p className="mt-1 text-xs font-medium text-slate-600">배정된 오더를 시작하고 시험항목별로 진행 상황을 기록합니다.</p>
        </div>

        {msg && (
          <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            msgType === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-blue-200 bg-blue-50 text-blue-700"
          }`}>{msg}</div>
        )}

        {/* ① 배정완료 · 시작 대기 */}
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              ① 배정완료 · 시작 대기 ({pending.length})
            </h2>
            {pending.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={bulkBusy}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  전체 선택
                </label>
                <button
                  onClick={() => void startSelected()}
                  disabled={selected.size === 0 || bulkBusy || busy !== null}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  선택 실행 ({selected.size})
                </button>
              </div>
            )}
          </div>
          {pending.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">대기 중인 오더가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map(o => {
                const dd = dDay(o.dueDate)
                const isBusy = busy === o.id
                const isChecked = selected.has(o.id)
                return (
                  <div key={o.id} className={`rounded-xl border bg-white p-3 shadow-sm transition-colors ${isChecked ? "border-blue-400 ring-1 ring-blue-300" : "border-slate-200"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(o.id)}
                        disabled={bulkBusy}
                        aria-label={`${o.productName} ${o.batchNo} 선택`}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{o.productName}</p>
                        <p className="font-mono text-xs text-slate-500">{o.batchNo}</p>
                      </div>
                      {o.isUrgent && <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">긴급</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      <span>{o.method}</span>
                      {o.dueDate && (
                        <span>
                          · 완료예정 {o.dueDate}
                          {dd != null && dd <= 7 && (
                            <span className="ml-1 font-semibold text-red-600">
                              D{dd >= 0 ? `-${dd}` : `+${-dd}`}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => start(o.id)}
                      disabled={busy !== null || bulkBusy}
                      className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                      작업 시작
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ② 진행 중 */}
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              ② 진행 중 ({activeJobs.length})
            </h2>
            {activeJobs.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={allJobsSelected}
                    onChange={toggleAllJobs}
                    disabled={jobBulkBusy}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  전체 선택
                </label>
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="h-8 w-[88px] rounded-lg border-slate-200 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => void applyBulkStatus()}
                  disabled={selectedJobs.size === 0 || jobBulkBusy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {jobBulkBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  선택 적용 ({selectedJobs.size})
                </button>
              </div>
            )}
          </div>
          {activeJobs.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">진행 중인 작업이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {activeJobs.map(job => renderJobCard(job, true))}
            </div>
          )}
        </section>

        {/* ③ 종료 (완료) */}
        <section>
          <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            ③ 종료 · 완료 ({doneJobs.length})
          </h2>
          {doneJobs.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">완료된 작업이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {doneJobs.map(job => renderJobCard(job))}
            </div>
          )}
        </section>
      </div>
    </>
  )

  function renderJobCard(job: Job, selectable = false) {
    const cleared = job.items.filter(i => i.status === "cleared").length
    const dd = dDay(job.dueDate)
    const isDone = job.status === "완료"
    return (
      <div key={job.id} className={`rounded-xl border shadow-sm ${isDone ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-white"}`}>
        {/* 헤더 */}
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            {selectable && (
              <input
                type="checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleJob(job.id)}
                disabled={jobBulkBusy}
                aria-label={`QC ${job.qcNo} 선택`}
                className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
            )}
            <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-blue-700">QC {job.qcNo}</span>
              {job.isUrgent && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">긴급</span>}
              {dd != null && dd <= 7 && !isDone && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                  <Clock size={10} />D{dd >= 0 ? `-${dd}` : `+${-dd}`}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
              {job.productName} <span className="font-mono text-xs font-normal text-slate-500">/ {job.batchNo}</span>
            </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:justify-end">
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-slate-500">시작</span>
              <div className="w-32">
                <DateField
                  size="sm"
                  noLabel
                  value={job.workStartDate ?? ""}
                  onChange={v => patchJob(job.id, { workStartDate: v })}
                  placeholder="시작일"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-slate-500">종료</span>
              <div className="w-32">
                <DateField
                  size="sm"
                  noLabel
                  value={job.workEndDate ?? ""}
                  onChange={v => patchJob(job.id, { workEndDate: v })}
                  placeholder="종료일"
                />
              </div>
            </div>
            <Select
              value={job.status}
              onValueChange={v => patchJob(job.id, { status: v })}
            >
              <SelectTrigger className={`h-8 shrink-0 rounded-full border px-2.5 text-[11px] font-semibold focus-visible:outline-none ${STATUS_CLS[job.status] ?? ""}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 항목 체크리스트 */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">시험항목 진행 {cleared}/{job.items.length}</span>
          </div>
          {job.items.length === 0 ? (
            <p className="py-2 text-xs text-slate-400">등록된 시험항목이 없습니다. (품목-시험항목 매핑 확인 필요)</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {job.items.map(it => {
                const done = it.status === "cleared"
                return (
                  <li
                    key={it.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 ${done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-center gap-2">
                      {done
                        ? <CheckCircle2 size={16} className="text-emerald-500" />
                        : <Circle size={16} className="text-slate-300" />}
                      <span className={`text-sm ${done ? "font-medium text-emerald-800" : "text-slate-700"}`}>
                        {it.testItemName}
                      </span>
                    </div>
                    {done ? (
                      <span className="text-[11px] text-emerald-600">
                        {it.clearedAt && new Date(it.clearedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {it.elapsedMinutes != null && ` · ${it.elapsedMinutes}분`}
                      </span>
                    ) : (
                      !isDone && (
                        <button
                          onClick={() => clearItem(job.id, it.id)}
                          disabled={busy !== null}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busy === it.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}완료
                        </button>
                      )
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    )
  }
}
