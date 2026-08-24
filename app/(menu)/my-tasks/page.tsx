"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Play, CheckCircle2, Circle, Loader2, AlertTriangle, Clock, XCircle, ShieldAlert, ClipboardList,
} from "lucide-react"
import { ACTIVE_JOB_STATUSES, CLOSED_STAGE, stageStyle } from "@shared/qc-status"
import { useAuth } from "@frontend/lib/auth-context"
import { cn } from "@frontend/lib/utils"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateField } from "@frontend/components/ui/date-field"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"
import { formatItemElapsed } from "@frontend/lib/elapsed-format"

interface JobItem {
  id: string; testItemName: string; sequenceOrder: number
  status: string; clearedAt: string | null
  /** 직전 항목 완료 이후 구간 소요 분 */
  elapsedMinutes: number | null
  /** 작업 시작부터 이 항목 완료까지 누적 소요 분 */
  elapsedTotalMinutes: number | null
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

/**
 * 시험자가 직접 바꿀 수 있는 상태만 남긴다.
 * 검토전은 시험항목을 모두 완료하면 자동 전환되고,
 * 검토중·승인전·승인완료는 관리자가 작업 현황 화면에서 넘긴다. (types/qc-status.ts)
 */
const STATUS_OPTIONS = ["진행중", "지연"]
const statusCls = (s: string) => stageStyle(s).cls

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
  const blocked = result.checks.filter(c => c.blocked)
  const warnings = result.checks.filter(c => c.warning && !c.blocked)
  const notes = result.pretestNotes ?? []
  const isBlocked = !result.ok && blocked.length > 0

  return (
    <ManagementDrawer
      open
      onOpenChange={(next) => { if (!next && !confirming) onCancel() }}
      size="md"
      title={(
        <span className="flex items-center gap-2">
          <span className={cn(
            "flex size-8 items-center justify-center rounded-md",
            isBlocked ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
          )}>
            {isBlocked ? <XCircle className="size-4" /> : <ShieldAlert className="size-4" />}
          </span>
          <span>{isBlocked ? "장비 검증 실패 — 시작 불가" : "시작 전 확인 — 확인 후 시작 가능"}</span>
        </span>
      )}
      description={isBlocked
        ? "아래 장비 문제를 해결한 후 다시 시도하세요."
        : "장비 경고·시험 전 확인사항을 확인하고 계속 진행할 수 있습니다."}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel} disabled={confirming}>취소</Button>
          {!isBlocked && (
            <Button onClick={onConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="animate-spin" /> : <Play />}
              확인 후 시작
            </Button>
          )}
        </>
      )}
    >
        <div className="grid gap-3">
          {blocked.length > 0 && (
            <ul className="flex flex-col gap-2">
              {blocked.map(c => (
                <li key={c.code} className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs dark:border-red-800 dark:bg-red-950">
                  <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <div>
                    {/* 마스터 미등록 장비는 name이 없으므로 코드로 대체 */}
                    <span className="font-semibold text-red-800 dark:text-red-200">{c.name ?? c.code}</span>
                    {c.reason && <p className="text-red-700 dark:text-red-300">{c.reason}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className={blocked.length > 0 ? "mt-3" : ""}>
              {/* 한글에는 대문자가 없다 — uppercase·tracking-wide 를 걷어내고 자간을 원래대로 둔다 */}
              <p className="mb-1.5 flex items-center gap-1.5 text-xs leading-normal font-semibold text-muted-foreground">
                <AlertTriangle size={12} /> 장비 경고 <span className="tabular-nums">{warnings.length}</span>건
              </p>
              <ul className="flex flex-col gap-2">
                {warnings.map(c => (
                  <li key={c.code} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    <div>
                      {/* 마스터 미등록 장비는 name이 없으므로 코드로 대체 */}
                      <span className="font-semibold text-amber-800 dark:text-amber-200">{c.name ?? c.code}</span>
                      {/* 경고 사유는 warning 필드에 담긴다(reason은 blocked 전용) */}
                      {c.warning && <p className="text-amber-700 dark:text-amber-300">{c.warning}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.length > 0 && (
            <div className={blocked.length > 0 || warnings.length > 0 ? "mt-3" : ""}>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs leading-normal font-semibold text-muted-foreground">
                <ClipboardList size={12} /> 시험 전 확인사항 <span className="tabular-nums">{notes.length}</span>건
              </p>
              <ul className="flex flex-col gap-2">
                {notes.map(n => (
                  <li key={n.id} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-800 dark:bg-blue-950">
                    <p className="font-semibold text-blue-900 dark:text-blue-200">{n.content}</p>
                    {n.remark && <p className="mt-0.5 text-blue-700 dark:text-blue-300">특이사항: {n.remark}</p>}
                    {(n.issueLot || n.createdByName) && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-normal text-blue-600 dark:text-blue-300">
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
    </ManagementDrawer>
  )
}

export default function MyTasksPage() {
  // 화면 이름은 역할에 따라 다르다 — 시험자 메뉴는 「할 일」, 관리자 메뉴는 「내 작업」.
  const { user } = useAuth()
  const pageTitle = user?.role === "admin" ? "내 작업" : "할 일"
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
  const [bulkStatus, setBulkStatus] = useState<string>("진행중")

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
      const ids = new Set(jobs.filter(j => ACTIVE_JOB_STATUSES.has(j.status)).map(j => j.id))
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
      const data = await res.json() as { error?: string; statusChangedTo?: string | null }
      if (!res.ok) throw new Error(data.error)
      await load()
      // 마지막 항목이었으면 서버가 상태를 자동 전환한다 — 사용자가 알 수 있게 안내
      if (data.statusChangedTo) {
        flash(`모든 시험항목 완료 — 상태가 "${data.statusChangedTo}" 로 자동 변경되었습니다.`)
      }
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
  const activeJobs = jobs.filter(j => ACTIVE_JOB_STATUSES.has(j.status))
  const doneJobs = jobs.filter(j => j.status === CLOSED_STAGE)

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 뼈대는 실제 화면과 같은 자리에 놓는다 — 머리말은 카드가 아니라 한 줄이다 */}
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      {/* ① 배정완료 · 시작 대기 */}
      <section className="shrink-0">
        <Skeleton className="mb-3 h-4 w-36" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="min-w-0 rounded-md border bg-card p-3">
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
              <Skeleton className="mt-3 h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      </section>
      {/* ② 진행 중 */}
      <section className="shrink-0">
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-md border bg-card">
              <div className="flex flex-col gap-3 border-b px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-56" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-36 rounded-md" />
                  <Skeleton className="h-8 w-36 rounded-md" />
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              </div>
              <div className="px-4 py-3">
                <Skeleton className="mb-2 h-3 w-32" />
                <div className="flex flex-col divide-y">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center justify-between py-1.5">
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
      <div className="p-4 md:p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-center dark:border-amber-800 dark:bg-amber-950">
          <AlertTriangle className="mx-auto mb-2 text-amber-500" size={24} />
          {/* break-keep: 좁은 폭에서 한글이 단어 중간에서 끊기지 않게 */}
          <p className="text-sm font-semibold break-keep text-amber-800 dark:text-amber-200">계정에 시험자(담당자)가 연결되어 있지 않습니다.</p>
          <p className="mt-1 text-xs leading-normal break-keep text-amber-700 dark:text-amber-300">관리자에게 계정-시험자 연결을 요청하세요.</p>
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        {/* 화면 이름을 되풀이하는 부제 대신, 지금 무엇이 몇 건인지를 적는다 */}
        <header className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-foreground">{pageTitle}</h1>
          <p className="text-xs leading-normal break-keep text-muted-foreground">
            시작 대기 <span className="font-semibold tabular-nums text-foreground">{pending.length}</span>건
            <span className="px-1 text-border">·</span>
            진행 중 <span className="font-semibold tabular-nums text-foreground">{activeJobs.length}</span>건
          </p>
        </header>

        {msg && (
          <div className={cn(
            "shrink-0 rounded-md border px-3 py-2 text-sm font-medium",
            msgType === "error"
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/5 text-foreground",
          )}>{msg}</div>
        )}

        {/* ① 배정완료 · 시작 대기 */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-2">
            <h2 className="text-sm font-semibold text-foreground">
              ① 배정완료 · 시작 대기
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{pending.length}건</span>
            </h2>
            {pending.length > 0 && (
              /* flex-wrap: 320px 에서 「전체 선택 + 선택 실행」이 한 줄에 안 들어간다 */
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={bulkBusy}
                    className="cb-custom"
                  />
                  전체 선택
                </label>
                <Button
                  size="sm"
                  onClick={() => void startSelected()}
                  disabled={selected.size === 0 || bulkBusy || busy !== null}
                >
                  {bulkBusy ? <Loader2 className="animate-spin" /> : <Play />}
                  선택 실행 ({selected.size})
                </Button>
              </div>
            )}
          </div>
          {pending.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">대기 중인 오더가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map(o => {
                const dd = dDay(o.dueDate)
                const isBusy = busy === o.id
                const isChecked = selected.has(o.id)
                return (
                  /* min-w-0: 그리드 칸의 기본 최소폭은 내용 크기라, 긴 품목명이 칸을 화면 밖으로 밀어낸다 */
                  <Card key={o.id} className={cn("min-w-0 gap-0 px-3 py-3", isChecked && "ring-2 ring-primary/30")}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(o.id)}
                        disabled={bulkBusy}
                        aria-label={`${o.productName} ${o.batchNo} 선택`}
                        className="cb-custom mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{o.productName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{o.batchNo}</p>
                      </div>
                      {o.isUrgent && <Badge variant="destructive">긴급</Badge>}
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                      <span className="min-w-0 truncate">{o.method}</span>
                      {o.dueDate && (
                        <span className="shrink-0 tabular-nums">
                          · 완료예정 {o.dueDate}
                          {dd != null && dd <= 7 && (
                            <span className="ml-1 font-semibold text-destructive">
                              D{dd >= 0 ? `-${dd}` : `+${-dd}`}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <Button
                      className="mt-3 w-full"
                      onClick={() => start(o.id)}
                      disabled={busy !== null || bulkBusy}
                    >
                      {isBusy ? <Loader2 className="animate-spin" /> : <Play />}
                      작업 시작
                    </Button>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* ② 진행 중 */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-2">
            <h2 className="text-sm font-semibold text-foreground">
              ② 진행 중
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{activeJobs.length}건</span>
            </h2>
            {activeJobs.length > 0 && (
              /* flex-wrap: 320px 에서 「전체 선택 + 상태 + 선택 적용」이 한 줄에 안 들어간다 */
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allJobsSelected}
                    onChange={toggleAllJobs}
                    disabled={jobBulkBusy}
                    className="cb-custom"
                  />
                  전체 선택
                </label>
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="h-8 w-20 rounded-md text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => void applyBulkStatus()}
                  disabled={selectedJobs.size === 0 || jobBulkBusy}
                >
                  {jobBulkBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  선택 적용 ({selectedJobs.size})
                </Button>
              </div>
            )}
          </div>
          {activeJobs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">진행 중인 작업이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {activeJobs.map(job => renderJobCard(job, true))}
            </div>
          )}
        </section>

        {/* ③ 종료 (완료) */}
        {/* 끝난 작업은 위계가 한 단 아래다 — 실선 없이 조용한 제목만 둔다(섹션마다 리듬을 다르게) */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            ③ 종료 · 완료
            <span className="ml-1.5 text-xs font-normal tabular-nums">{doneJobs.length}건</span>
          </h2>
          {doneJobs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">완료된 작업이 없습니다.</p>
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
    const isDone = job.status === CLOSED_STAGE
    return (
      <Card key={job.id} className={cn("gap-0 overflow-hidden py-0", isDone && "border-blue-300 dark:border-blue-700")}>
        <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            {selectable && (
              <input
                type="checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleJob(job.id)}
                disabled={jobBulkBusy}
                aria-label={`QC ${job.qcNo} 선택`}
                className="cb-custom mt-1"
              />
            )}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-semibold text-primary">QC {job.qcNo}</span>
              {job.isUrgent && <Badge variant="destructive">긴급</Badge>}
              {dd != null && dd <= 7 && !isDone && (
                <Badge variant="outline" className="gap-1 border-destructive/30 tabular-nums text-destructive">
                  <Clock size={10} />D{dd >= 0 ? `-${dd}` : `+${-dd}`}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {job.productName} <span className="font-mono text-xs font-normal text-muted-foreground">/ {job.batchNo}</span>
            </p>
            </div>
          </div>
          {/* 모바일에서는 날짜 두 칸을 각각 한 줄 꽉 채워 손가락으로 누르기 쉽게 하고,
              sm 이상에서만 고정 폭으로 나란히 세운다. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:justify-end">
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:shrink-0">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">시작</span>
              <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
                <DateField
                  size="sm"
                  noLabel
                  value={job.workStartDate ?? ""}
                  onChange={v => patchJob(job.id, { workStartDate: v })}
                  placeholder="시작일"
                />
              </div>
            </div>
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:shrink-0">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">종료</span>
              <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
                <DateField
                  size="sm"
                  noLabel
                  value={job.workEndDate ?? ""}
                  onChange={v => patchJob(job.id, { workEndDate: v })}
                  placeholder="종료일"
                />
              </div>
            </div>
            {/* 담당자가 바꿀 수 있는 단계(진행중·지연)만 선택형으로 둔다.
                검토전 이후 단계는 관리자가 작업 현황에서 넘기므로 읽기 전용으로 표시한다.
                (STATUS_OPTIONS 에 없는 값을 Select 에 넣으면 라벨이 빈칸으로 렌더된다) */}
            {STATUS_OPTIONS.includes(job.status) ? (
              <Select
                value={job.status}
                onValueChange={v => patchJob(job.id, { status: v })}
              >
                <SelectTrigger className={`h-8 shrink-0 rounded-md border px-2.5 text-xs leading-normal font-semibold focus-visible:outline-none ${statusCls(job.status)}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <span
                title="검토·승인 단계는 관리자가 변경합니다."
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs leading-normal font-semibold',
                  statusCls(job.status),
                )}
              >
                <span className={cn('size-1.5 rounded-full', stageStyle(job.status).dot)} />
                {job.status}
              </span>
            )}
          </div>
        </div>

        {/* 항목 체크리스트 */}
        <div className="px-4 py-3">
          {/* 카드 안에 또 카드를 넣지 않는다 — 항목마다 두르던 테두리를 걷고 실선 한 겹으로 나눈다 */}
          <p className="mb-1 text-xs leading-normal font-semibold text-muted-foreground">
            시험항목 진행 <span className="tabular-nums text-foreground">{cleared}/{job.items.length}</span>
          </p>
          {job.items.length === 0 ? (
            <p className="py-2 text-xs leading-normal text-muted-foreground">등록된 시험항목이 없습니다. (품목-시험항목 매핑 확인 필요)</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {job.items.map(it => {
                const done = it.status === "cleared"
                return (
                  <li
                    key={it.id}
                    /* flex-wrap: 좁은 폭에서 완료 시각·소요시간이 항목명을 짓누르지 않고 아랫줄로 내려간다 */
                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {done
                        ? <CheckCircle2 size={16} className="shrink-0 text-blue-600 dark:text-blue-300" />
                        : <Circle size={16} className="shrink-0 text-muted-foreground" />}
                      <span className={cn("min-w-0 truncate text-sm", done ? "font-medium text-blue-800 dark:text-blue-200" : "text-foreground")}>
                        {it.testItemName}
                      </span>
                    </div>
                    {done ? (
                      <span className="shrink-0 text-xs leading-normal tabular-nums text-blue-700 dark:text-blue-300">
                        {it.clearedAt && new Date(it.clearedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {/* 작업 시작 기준 누적 소요시간 (구간이 다르면 함께 표기) */}
                        {(() => {
                          const label = formatItemElapsed(it.elapsedTotalMinutes, it.elapsedMinutes)
                          return label && ` · ${label}`
                        })()}
                      </span>
                    ) : (
                      !isDone && (
                        <Button
                          size="sm"
                          onClick={() => clearItem(job.id, it.id)}
                          disabled={busy !== null}
                        >
                          {busy === it.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}완료
                        </Button>
                      )
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>
    )
  }
}
